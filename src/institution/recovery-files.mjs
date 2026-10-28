import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const MAX_RECOVERY_STATE_BYTES = 1024 * 1024;
export const MAX_RECOVERY_REFERENCE_BYTES = 64 * 1024 * 1024;

function sameSnapshot(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid &&
    a.mode === b.mode && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

/**
 * Read a bounded regular file from one stable inode. This is a best-effort
 * pathname check, not an openat-style capability boundary, but it avoids
 * following a final symlink and rejects a path or file that changes mid-read.
 */
export async function readStableRegularFile(filePath, {
  maxBytes = MAX_RECOVERY_STATE_BYTES,
  label = 'Recovery file'
} = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new TypeError(`${label} path is required`);
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('A positive safe byte limit is required');
  }

  const before = await lstat(filePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`${label} must be a regular, non-symlink file`);
  }
  if (before.size > maxBytes) {
    throw new Error(`${label} exceeds its ${maxBytes}-byte limit`);
  }

  let handle;
  try {
    try {
      handle = await open(filePath, fsConstants.O_RDONLY |
        (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
    } catch (error) {
      if (error.code === 'ELOOP') {
        throw new Error(`${label} must not be a symlink`);
      }
      throw error;
    }

    const opened = await handle.stat();
    if (!opened.isFile() || !sameSnapshot(before, opened)) {
      throw new Error(`${label} changed while opening`);
    }

    const chunks = [];
    let total = 0;
    let position = 0;
    while (total <= maxBytes) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
      position += bytesRead;
    }
    if (total > maxBytes) {
      throw new Error(`${label} exceeds its ${maxBytes}-byte limit during reading`);
    }

    const afterHandle = await handle.stat();
    let afterPath;
    try {
      afterPath = await lstat(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`${label} disappeared while reading`);
      }
      throw error;
    }
    if (afterPath.isSymbolicLink() || !afterPath.isFile() ||
        !sameSnapshot(opened, afterHandle) || !sameSnapshot(opened, afterPath) ||
        total !== opened.size) {
      throw new Error(`${label} changed while reading`);
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function readRecoveryState(filePath) {
  return readStableRegularFile(filePath, {
    maxBytes: MAX_RECOVERY_STATE_BYTES,
    label: 'Continuity record'
  });
}

/**
 * Read a hash-pinned repository reference without following symlinks. The
 * content hash is checked only after a bounded read from a stable file handle.
 * A hash mismatch is returned as data so the caller can report every stale
 * reference in one run; callers must still fail closed when verified is false.
 */
export async function readVerifiedReference(rootPath, reference) {
  const referencePath = reference?.path;
  if (typeof referencePath !== 'string' || !referencePath.trim() ||
      referencePath.includes('\\') || isAbsolute(referencePath) ||
      /(^|\/)(\.runtime|\.git|secrets|credentials)(\/|$)|\.(key|pem)$/i.test(referencePath) ||
      referencePath.split('/').some(part => !part || part === '.' || part === '..') ||
      !/^[a-f0-9]{64}$/.test(reference?.sha256 ?? '')) {
    throw new Error('Unsafe recovery reference');
  }

  const root = await realpath(resolve(rootPath));
  let candidate = root;
  const parts = referencePath.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    candidate = join(candidate, parts[index]);
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink()) {
      throw new Error(`Recovery reference contains a symlink: ${referencePath}`);
    }
    if (index < parts.length - 1 && !stat.isDirectory()) {
      throw new Error(`Recovery reference parent is not a directory: ${referencePath}`);
    }
    if (index === parts.length - 1 && !stat.isFile()) {
      throw new Error(`Recovery reference is not a regular file: ${referencePath}`);
    }
  }

  const target = await realpath(candidate);
  const relativeTarget = relative(root, target);
  if (relativeTarget === '..' || relativeTarget.startsWith('..' + sep) || isAbsolute(relativeTarget)) {
    throw new Error('Recovery reference escapes repository');
  }

  const bytes = await readStableRegularFile(target, {
    maxBytes: MAX_RECOVERY_REFERENCE_BYTES,
    label: `Recovery reference ${referencePath}`
  });
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    target,
    size: bytes.length,
    expectedSha256: reference.sha256,
    actualSha256,
    verified: actualSha256 === reference.sha256
  };
}
