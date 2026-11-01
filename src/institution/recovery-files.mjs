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
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function snapshotPlainDataRecord(value, { requiredKeys = [], optionalKeys = [] } = {}) {
  try {
    if (!isPlainRecord(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const allowed = requiredKeys.length || optionalKeys.length
      ? new Set([...requiredKeys, ...optionalKeys])
      : null;
    if ((allowed && keys.some(key => typeof key !== 'string' || !allowed.has(key))) ||
        requiredKeys.some(key => !Object.hasOwn(descriptors, key))) return null;

    const snapshot = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (typeof key !== 'string' || !descriptor || descriptor.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value')) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function snapshotDenseDataArray(value) {
  try {
    if (!Array.isArray(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 ||
        keys.length !== length + 1 || !keys.includes('length')) return null;

    const snapshot = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || descriptor.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value')) return null;
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
}

function snapshotRecoveryReference(reference) {
  const snapshot = snapshotPlainDataRecord(reference, {
    requiredKeys: ['path', 'sha256']
  });
  if (!snapshot || Object.keys(snapshot).length !== 2) {
    throw new Error('Unsafe recovery reference');
  }
  const referencePath = snapshot.path;
  const sha256 = snapshot.sha256;
  if (typeof referencePath !== 'string' || !referencePath.trim() ||
      referencePath.includes('\\') || isAbsolute(referencePath) ||
      /(^|\/)(\.runtime|\.git|secrets|credentials)(\/|$)|\.(key|pem)$/i.test(referencePath) ||
      referencePath.split('/').some(part => !part || part === '.' || part === '..') ||
      typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('Unsafe recovery reference');
  }
  return Object.freeze({ path: referencePath, sha256 });
}

function assertReferenceList(references, { maxReferences = MAX_RECOVERY_REFERENCES } = {}) {
  const snapshot = snapshotDenseDataArray(references);
  if (!snapshot) throw new Error('Recovery references must be a dense data array');
  if (snapshot.length === 0) {
    throw new Error('Continuity record must contain at least one recovery reference');
  }
  if (!Number.isSafeInteger(maxReferences) || maxReferences < 1 ||
      maxReferences > MAX_RECOVERY_REFERENCES) {
    throw new TypeError('Recovery reference count limit is invalid');
  }
  if (snapshot.length > maxReferences) {
    throw new Error(`Continuity record exceeds the ${maxReferences}-reference limit`);
  }

  const seen = new Set();
  const normalized = snapshot.map(snapshotRecoveryReference);
  for (const reference of normalized) {
    if (seen.has(reference.path)) {
      throw new Error(`Duplicate recovery reference path: ${reference.path}`);
    }
    seen.add(reference.path);
  }
  return Object.freeze(normalized);
}

/** Validate the continuity record's control fields before any reference I/O. */
export function validateContinuityRecord(state) {
  const snapshot = snapshotPlainDataRecord(state, {
    requiredKeys: [
      'schema', 'principal', 'authority', 'nextAction', 'rollback',
      'assignments', 'machinery', 'openFailures', 'taskB', 'founderDecision', 'references'
    ],
    optionalKeys: ['mission']
  });
  const assignments = snapshot && snapshotDenseDataArray(snapshot.assignments);
  const openFailures = snapshot && snapshotDenseDataArray(snapshot.openFailures);
  const machinery = snapshot && snapshotPlainDataRecord(snapshot.machinery, {
    requiredKeys: ['M0', 'M1']
  });
  const taskB = snapshot && snapshotPlainDataRecord(snapshot.taskB);
  const founderDecision = snapshot && snapshotPlainDataRecord(snapshot.founderDecision);

  if (!snapshot ||
      snapshot.schema !== 'ngl.institution-continuity.v1' ||
      snapshot.principal !== 'Damien Featherstone' ||
      (Object.hasOwn(snapshot, 'mission') && (typeof snapshot.mission !== 'string' || !snapshot.mission.trim())) ||
      typeof snapshot.authority !== 'string' || !snapshot.authority.trim() ||
      typeof snapshot.nextAction !== 'string' || !snapshot.nextAction.trim() ||
      typeof snapshot.rollback !== 'string' || !snapshot.rollback.trim() ||
      !assignments || assignments.length === 0 ||
      !machinery ||
      (!isPlainRecord(machinery.M0) && typeof machinery.M0 !== 'string') ||
      (!isPlainRecord(machinery.M1) && typeof machinery.M1 !== 'string') ||
      !openFailures || !openFailures.every(item => typeof item === 'string') ||
      !taskB || !founderDecision) {
    throw new Error('Incomplete continuity record');
  }

  const references = assertReferenceList(snapshot.references);
  return Object.freeze({
    ...snapshot,
    assignments: Object.freeze(assignments),
    machinery: Object.freeze(machinery),
    openFailures: Object.freeze(openFailures),
    taskB: Object.freeze(taskB),
    founderDecision: Object.freeze(founderDecision),
    references
  });
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
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_RECOVERY_TOTAL_BYTES) {
    throw new TypeError(`A positive safe byte limit no greater than ${MAX_RECOVERY_TOTAL_BYTES} bytes is required`);
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
    // Count bytes even when a concurrent replacement makes the read unusable.
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
  const normalizedReference = snapshotRecoveryReference(reference);
  const referencePath = normalizedReference.path;
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
    expectedSha256: normalizedReference.sha256,
    actualSha256,
    verified: actualSha256 === normalizedReference.sha256
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
  const referenceList = assertReferenceList(references, { maxReferences });
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1 || maxTotalBytes > MAX_RECOVERY_TOTAL_BYTES) {
    throw new TypeError(`Total recovery byte limit must not exceed ${MAX_RECOVERY_TOTAL_BYTES} bytes`);
  }
  if (!Number.isSafeInteger(maxReferenceBytes) || maxReferenceBytes < 1 ||
      maxReferenceBytes > MAX_RECOVERY_REFERENCE_BYTES) {
    throw new TypeError('Per-reference recovery byte limit is invalid');
  }

  const recovered = [];
  const receipts = [];
  const failures = [];
  let bytesRead = 0;

  for (const reference of referenceList) {
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
