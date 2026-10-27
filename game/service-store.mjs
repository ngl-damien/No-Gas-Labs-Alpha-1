import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, rename, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalStringify, artifactReceipt } from '../src/institution/kernel.mjs';

const MAX_SERVICE_STORE_BYTES = 64 * 1024 * 1024;
const digest = value => artifactReceipt(canonicalStringify(value)).digest;
const storeReadError = (code, message) => Object.assign(new Error(message), { code });

async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

// Persisted state is untrusted input: bound allocation and verify the opened
// regular file still matches the path inspected before and after the read.
async function readBoundedStoreEnvelope(path) {
  const label = 'Service store envelope';
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw storeReadError('SERVICE_STORE_NOT_REGULAR', `${label} must be a regular, non-symlink file`);
  }
  if ((before.mode & 0o077) !== 0) {
    throw storeReadError('SERVICE_STORE_PERMISSIONS_TOO_BROAD', `${label} must exclude group and other permissions (0600)`);
  }
  if (typeof process.getuid === 'function' && before.uid !== process.getuid()) {
    throw storeReadError('SERVICE_STORE_OWNER_MISMATCH', `${label} must be owned by the current process user`);
  }
  if (before.size > MAX_SERVICE_STORE_BYTES) {
    throw storeReadError('SERVICE_STORE_TOO_LARGE', `${label} exceeds its ${MAX_SERVICE_STORE_BYTES}-byte limit`);
  }

  let handle;
  try {
    try {
      handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
    } catch (error) {
      if (error.code === 'ELOOP') {
        throw storeReadError('SERVICE_STORE_NOT_REGULAR', `${label} must not be a symlink`);
      }
      if (error.code === 'ENOENT') {
        throw storeReadError('SERVICE_STORE_CHANGED', `${label} disappeared while opening`);
      }
      throw error;
    }

    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw storeReadError('SERVICE_STORE_CHANGED', `${label} changed while opening`);
    }
    if ((opened.mode & 0o077) !== 0) {
      throw storeReadError('SERVICE_STORE_PERMISSIONS_TOO_BROAD', `${label} must exclude group and other permissions (0600)`);
    }
    if (typeof process.getuid === 'function' && opened.uid !== process.getuid()) {
      throw storeReadError('SERVICE_STORE_OWNER_MISMATCH', `${label} must be owned by the current process user`);
    }
    if (opened.size > MAX_SERVICE_STORE_BYTES) {
      throw storeReadError('SERVICE_STORE_TOO_LARGE', `${label} exceeds its ${MAX_SERVICE_STORE_BYTES}-byte limit`);
    }
    if (opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) {
      throw storeReadError('SERVICE_STORE_CHANGED', `${label} changed before reading`);
    }

    const chunks = [];
    let total = 0;
    let position = 0;
    while (total <= MAX_SERVICE_STORE_BYTES) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_SERVICE_STORE_BYTES + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
      position += bytesRead;
      if (total > MAX_SERVICE_STORE_BYTES) {
        throw storeReadError('SERVICE_STORE_TOO_LARGE', `${label} exceeds its ${MAX_SERVICE_STORE_BYTES}-byte limit`);
      }
    }

    let after;
    try { after = await lstat(path); }
    catch (error) {
      if (error.code === 'ENOENT') {
        throw storeReadError('SERVICE_STORE_CHANGED', `${label} disappeared during reading`);
      }
      throw error;
    }
    const afterHandle = await handle.stat();
    if (after.isSymbolicLink() || !after.isFile() ||
        after.dev !== opened.dev || after.ino !== opened.ino) {
      throw storeReadError('SERVICE_STORE_CHANGED', `${label} path changed during reading`);
    }
    const unchanged = stat => stat.size === opened.size &&
      stat.mtimeMs === opened.mtimeMs && stat.ctimeMs === opened.ctimeMs;
    if (!unchanged(after) || !unchanged(afterHandle) || total !== opened.size) {
      throw storeReadError('SERVICE_STORE_CHANGED', `${label} changed during reading`);
    }
    return Buffer.concat(chunks, total).toString('utf8');
  } finally {
    await handle?.close().catch(() => {});
  }
}

function durabilityUncertain(cause) {
  return Object.assign(new Error(
    'Service store replacement succeeded but directory sync failed; commit durability is uncertain. Reopen and validate the store before writing again.'
  ), { code: 'COMMIT_DURABILITY_UNCERTAIN', status: 503, ...(cause ? { cause } : {}) });
}

// Lock contents are not ownership proof: an external recovery action can
// replace the pathname with a new inode carrying the same token.
async function unlinkOwnedLock(path, identity) {
  if (!identity) return false;
  let current;
  try { current = await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) return false;
  await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  return true;
}

/** One replaceable envelope prevents partial world / kernel / artifact commits. */
export async function createServiceStore({ dataDir, initial, validate, syncDirectory: syncDirectoryFn = syncDirectory }) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, 'service.json');
  const lockPath = join(dataDir, '.service.lock');
  let lease;
  try { lease = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw Object.assign(new Error('Exclusive service writer lock already exists; stop the owner before opening this store. Stale locks require manual offline recovery.'), { code: 'SERVICE_LOCKED' }); throw error; }
  const ownership = randomUUID();
  let leaseIdentity;
  try {
    const stat = await lease.stat();
    leaseIdentity = { dev: stat.dev, ino: stat.ino };
    await lease.writeFile(ownership);
  } catch (error) {
    await lease.close().catch(() => {});
    await unlinkOwnedLock(lockPath, leaseIdentity).catch(() => {});
    throw error;
  }
  let released = false;
  let durabilityUncertainState = false;
  async function close() {
    if (released) return; released = true;
    await lease.close();
    await unlinkOwnedLock(lockPath, leaseIdentity);
  }
  let current;
  let raw;
  try { raw = await readBoundedStoreEnvelope(path); }
  catch (error) {
    if (error.code !== 'ENOENT') { await close(); throw error; }
  }
  if (raw !== undefined) {
    try {
      const envelope = JSON.parse(raw);
      if (envelope.schema !== 'ngl.service-store.v1' || !envelope.payload || envelope.digest !== digest(envelope.payload)) throw new Error('Service store integrity check failed');
      current = await validate(envelope.payload);
    } catch (error) { await close(); throw error; }
  } else {
    try { current = await validate(initial); await persist(current); }
    catch (error) { await close(); throw error; }
  }
  async function persist(payload) {
    const pending = join(dataDir, `.service-${randomUUID()}.tmp`);
    let file;
    let renamed = false;
    try {
      file = await open(pending, 'wx', 0o600);
      await file.writeFile(canonicalStringify({ schema: 'ngl.service-store.v1', payload, digest: digest(payload) }));
      await file.sync();
      await file.close(); file = null;
      await rename(pending, path);
      renamed = true;
      try { await syncDirectoryFn(dataDir); }
      catch (error) {
        durabilityUncertainState = true;
        throw durabilityUncertain(error);
      }
    } catch (error) {
      if (file) await file.close().catch(() => {});
      // Once rename succeeds, the target may already contain the new envelope.
      // Do not misrepresent that state by trying to roll it back.
      if (!renamed) await rm(pending, { force: true }).catch(() => {});
      throw error;
    }
  }
  return {
    get value() { return current; },
    close,
    async commit(candidate) {
      if (released) throw new Error('Service writer lease has closed');
      if (durabilityUncertainState) throw durabilityUncertain();
      const valid = await validate(candidate);
      await persist(valid);
      current = valid;
      return current;
    }
  };
}
