import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const MAX_RECOVERY_STATE_BYTES = 1024 * 1024;
export const MAX_RECOVERY_REFERENCE_BYTES = 64 * 1024 * 1024;
export const MAX_RECOVERY_REFERENCES = 128;
export const MAX_RECOVERY_TOTAL_BYTES = 128 * 1024 * 1024;

function sameSnapshot(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid &&
    a.mode === b.mode && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeReferenceDescriptor(reference) {
  const referencePath = reference?.path;
  if (!isPlainRecord(reference) ||
      typeof referencePath !== 'string' || !referencePath.trim() ||
      referencePath.includes('\\\\') || isAbsolute(referencePath) ||
      /(^|\\/)(\\.runtime|\\.git|secrets|credentials)(\\/|$)|\\.(key|pem)$/i.test(referencePath) ||
      referencePath.split('/').some(part => !part || part === '.' || part === '..') ||
      !/^[a-f0-9]{64}$/.test(reference?.sha256 ?? '')) {
    throw new Error('Unsafe recovery reference');
  }
  return referencePath;
}

function assertReferenceList(references, { maxReferences = MAX_RECOVERY_REFERENCES } = {}) {
  if (!Array.isArray(references) || references.length === 0) {
    throw new Error('Continuity record must contain at least one recovery reference');
  }
  if (!Number.isSafeInteger(maxReferences) || maxReferences < 1 ||
      maxReferences > MAX_RECOVERY_REFERENCES) {
    throw new TypeError('Recovery reference count limit is invalid');
  }
  if (references.length > maxReferences) {
    throw new Error(`Continuity record exceeds the ${maxReferences}-reference limit`);
  }

  const seen = new Set();
  for (const reference of references) {
    const referencePath = assertSafeReferenceDescriptor(reference);
    if (seen.has(referencePath)) {
      throw new Error(`Duplicate recovery reference path: ${referencePath}`);
    }
    seen.add(referencePath);
  }
  return references;
}

/** Validate the continuity record's control fields before any reference I/O. */
export function validateContinuityRecord(state) {
  if (!isPlainRecord(state) ||
      state.schema !== 'ngl.institution-continuity.v1' ||
      state.principal !== 'Damien Featherstone' ||
      typeof state.mission !== 'string' || !state.mission.trim() ||
      typeof state.authority !== 'string' || !state.authority.trim() ||
      typeof state.nextAction !== 'string' || !state.nextAction.trim() ||
      typeof state.rollback !== 'string' || !state.rollback.trim() ||
      !Array.isArray(state.assignments) || state.assignments.length === 0 ||
      !isPlainRecord(state.machinery) ||
      !isPlainRecord(state.machinery.M0) ||
      !isPlainRecord(state.machinery.M1) ||
      !Array.isArray(state.openFailures) ||
      !state.openFailures.every(item => typeof item === 'string') ||
      !isPlainRecord(state.taskB) ||
      !isPlainRecord(state.founderDecision)) {
    throw new Error('Incomplete continuity record');
  }
  assertReferenceList(state.references);
  return state;
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
  let total = 0;
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
    let position = 0;
    while (total < maxBytes) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
      position += bytesRead;
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
  } catch (error) {
    // The recovery budget accounts for bytes read even when a concurrent
    // replacement makes the read unusable. This keeps repeated failures from
    // silently resetting the aggregate I/O budget.
    if (error && typeof error === 'object' && !Object.hasOwn(error, 'bytesRead')) {
      Object.defineProperty(error, 'bytesRead', { value: total, enumerable: false });
    }
    throw error;
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
export async function readVerifiedReference(rootPath, reference, {
  maxBytes = MAX_RECOVERY_REFERENCE_BYTES
} = {}) {
  const referencePath = assertSafeReferenceDescriptor(reference);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
      maxBytes > MAX_RECOVERY_REFERENCE_BYTES) {
    throw new TypeError('Recovery reference byte limit is invalid');
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
    maxBytes,
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

/**
 * Verify a bounded reference set. Duplicate paths are rejected before any
 * reads; aggregate byte limits include bytes consumed by reads that fail due
 * to a detected concurrent change.
 */
export async function verifyRecoveryReferences(rootPath, references, {
  maxReferences = MAX_RECOVERY_REFERENCES,
  maxTotalBytes = MAX_RECOVERY_TOTAL_BYTES,
  maxReferenceBytes = MAX_RECOVERY_REFERENCE_BYTES
} = {}) {
  assertReferenceList(references, { maxReferences });
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1) {
    throw new TypeError('Total recovery byte limit is invalid');
  }
  if (!Number.isSafeInteger(maxReferenceBytes) || maxReferenceBytes < 1 ||
      maxReferenceBytes > MAX_RECOVERY_REFERENCE_BYTES) {
    throw new TypeError('Per-reference recovery byte limit is invalid');
  }

  const recovered = [];
  const receipts = [];
  const failures = [];
  let bytesRead = 0;

  for (const reference of references) {
    const referencePath = reference.path;
    const remaining = maxTotalBytes - bytesRead;
    if (remaining <= 0) {
      const message = `Total recovery reference byte budget (${maxTotalBytes} bytes) exhausted`;
      receipts.push({ path: referencePath, status: 'error', error: message });
      failures.push({ path: referencePath, reason: message, message: `Recovery reference error: ${referencePath}: ${message}` });
      continue;
    }

    try {
      const verified = await readVerifiedReference(rootPath, reference, {
        maxBytes: Math.min(maxReferenceBytes, remaining)
      });
      bytesRead += verified.size;
      const status = verified.verified ? 'verified' : 'mismatch';
      receipts.push({
        path: referencePath,
        status,
        expectedSha256: verified.expectedSha256,
        actualSha256: verified.actualSha256,
        size: verified.size
      });
      if (verified.verified) {
        recovered.push(referencePath);
      } else {
        failures.push({
          path: referencePath,
          reason: 'sha256-mismatch',
          expectedSha256: verified.expectedSha256,
          actualSha256: verified.actualSha256,
          message: `Recovery reference changed: ${referencePath} (expected SHA-256 ${verified.expectedSha256}, observed ${verified.actualSha256})`
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      bytesRead += Number.isSafeInteger(error?.bytesRead) && error.bytesRead > 0 ? error.bytesRead : 0;
      receipts.push({ path: referencePath, status: 'error', error: message });
      failures.push({ path: referencePath, reason: message, message: `Recovery reference error: ${referencePath}: ${message}` });
    }
  }

  return { recovered, receipts, failures, bytesRead };
}
