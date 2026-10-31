import { constants as fsConstants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

const CHUNK_BYTES = 16 * 1024;
const MAX_CONFIGURED_BYTES = 16 * 1024 * 1024;

function fail(code) {
  throw new Error(code);
}

function checkPermissions(stat, label, { requirePrivatePermissions, requireCurrentUserOwnership }) {
  if (requirePrivatePermissions && process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    fail('FOUNDER_KEY_PERMISSIONS_TOO_BROAD');
  }
  if (requireCurrentUserOwnership) {
    if (typeof process.getuid !== 'function') fail(`${label}_OWNER_VERIFICATION_UNAVAILABLE`);
    if (stat.uid !== process.getuid()) fail(`${label}_OWNER_MISMATCH`);
  }
}

function unchanged(stat, original) {
  return stat.size === original.size &&
    stat.mtimeMs === original.mtimeMs &&
    stat.ctimeMs === original.ctimeMs;
}

/**
 * Read an untrusted regular file without allocating beyond maxBytes + 1.
 * Path/handle identity and metadata are rechecked before returning. This is a
 * best-effort filesystem-race defense, not an atomic openat capability boundary.
 */
export async function readBoundedRegularFile(path, maxBytes, label, {
  requirePrivatePermissions = false,
  requireCurrentUserOwnership = false
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_CONFIGURED_BYTES ||
      typeof label !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(label)) {
    fail('BOUNDED_FILE_READER_INVALID_CONFIG');
  }

  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile()) fail(`${label}_NOT_REGULAR_FILE`);
  if (before.size > maxBytes) fail(`${label}_FILE_TOO_LARGE`);
  checkPermissions(before, label, { requirePrivatePermissions, requireCurrentUserOwnership });

  const flags = fsConstants.O_RDONLY |
    (fsConstants.O_NOFOLLOW ?? 0) |
    (fsConstants.O_NONBLOCK ?? 0);
  let handle;
  try {
    try {
      handle = await open(path, flags);
    } catch (error) {
      if (error.code === 'ELOOP') fail(`${label}_NOT_REGULAR_FILE`);
      if (error.code === 'ENOENT') fail(`${label}_FILE_CHANGED_DURING_OPEN`);
      throw error;
    }

    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      fail(`${label}_FILE_CHANGED_DURING_OPEN`);
    }
    if (opened.size > maxBytes) fail(`${label}_FILE_TOO_LARGE`);
    checkPermissions(opened, label, { requirePrivatePermissions, requireCurrentUserOwnership });
    if (!unchanged(opened, before)) fail(`${label}_FILE_CHANGED_DURING_OPEN`);

    const chunks = [];
    let total = 0;
    let position = 0;
    while (total <= maxBytes) {
      const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, maxBytes + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
      position += bytesRead;
      if (total > maxBytes) fail(`${label}_FILE_TOO_LARGE`);
    }

    let after;
    try {
      after = await lstat(path);
    } catch (error) {
      if (error.code === 'ENOENT') fail(`${label}_FILE_CHANGED_DURING_READ`);
      throw error;
    }
    const afterHandle = await handle.stat();
    if (after.isSymbolicLink() || !after.isFile() ||
        after.dev !== opened.dev || after.ino !== opened.ino ||
        !unchanged(after, opened) || !unchanged(afterHandle, opened) ||
        total !== opened.size) {
      fail(`${label}_FILE_CHANGED_DURING_READ`);
    }

    const bytes = Buffer.concat(chunks, total);
    const decoded = bytes.toString('utf8');
    if (!Buffer.from(decoded, 'utf8').equals(bytes)) fail(`${label}_INVALID_UTF8`);
    return decoded;
  } finally {
    await handle?.close().catch(() => {});
  }
}
