import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, rename, rm, unlink } from 'node:fs/promises';
import { join, parse, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalStringify, artifactReceipt } from '../src/institution/kernel.mjs';

const MAX_SERVICE_STORE_BYTES = 64 * 1024 * 1024;
const digest = value => artifactReceipt(canonicalStringify(value)).digest;

// The public value getter and commit result must not expose the mutable object
// retained as the in-memory projection. Normalize through the same strict JSON
// representation used on disk, then freeze the detached JSON graph once.
function immutableSnapshot(value) {
  const snapshot = JSON.parse(canonicalStringify(value));
  const freeze = item => {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
    return item;
  };
  return freeze(snapshot);
}
const storeReadError = (code, message) => Object.assign(new Error(message), { code });

// Best-effort path walk: reject symlinked ancestors before recursive creation,
// then validate the final directory's identity, owner and privacy. This is not
// an atomic openat-style boundary against a hostile process racing path changes.
async function assertNoSymlinkPathComponents(path) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let stat;
    try { stat = await lstat(current); }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw storeReadError('SERVICE_DIRECTORY_SYMLINK', 'Service store paths may not contain symbolic links');
    }
    if (!stat.isDirectory()) {
      throw storeReadError('SERVICE_DIRECTORY_UNSAFE', 'Every service store path component must be a directory');
    }
  }
}

async function assertPrivateDirectory(path, expectedIdentity) {
  await assertNoSymlinkPathComponents(path);
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw storeReadError('SERVICE_DIRECTORY_UNSAFE', 'Service store storage must be a regular directory');
  }
  if ((stat.mode & 0o077) !== 0) {
    throw storeReadError('SERVICE_DIRECTORY_PERMISSIONS_TOO_BROAD', 'Service store directories must exclude group and other access (0700)');
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw storeReadError('SERVICE_DIRECTORY_OWNER_MISMATCH', 'Service store directory must be owned by the current process user');
  }
  if (expectedIdentity && (stat.dev !== expectedIdentity.dev || stat.ino !== expectedIdentity.ino)) {
    throw storeReadError('SERVICE_DIRECTORY_CHANGED', 'Service store directory changed while acquiring the writer lease');
  }
  return { dev: stat.dev, ino: stat.ino };
}

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
    const bytes = Buffer.concat(chunks, total);
    const decoded = bytes.toString('utf8');
    if (!Buffer.from(decoded, 'utf8').equals(bytes)) {
      throw storeReadError('SERVICE_STORE_INVALID_UTF8', `${label} is not valid UTF-8`);
    }
    return decoded;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function durabilityUncertain(cause) {
  return Object.assign(new Error(
    'Service store replacement succeeded but directory durability could not be confirmed; reopen and validate the store before reading or writing again.'
  ), { code: 'COMMIT_DURABILITY_UNCERTAIN', status: 503, ...(cause ? { cause } : {}) });
}

function revisionOf(value) {
  const revision = Number.isSafeInteger(value?.world?.revision) ? value.world.revision : value?.revision;
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function staleRevisionError() {
  return Object.assign(new Error(
    'Service store candidate is stale or skips the current revision; rebuild it from the latest committed value.'
  ), { code: 'SERVICE_STALE_REVISION', status: 409 });
}

function closedStoreError() {
  return Object.assign(new Error('Service writer lease has closed'), { code: 'SERVICE_STORE_CLOSED', status: 503 });
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
  dataDir = resolve(dataDir);
  await assertNoSymlinkPathComponents(dataDir);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const directoryIdentity = await assertPrivateDirectory(dataDir);
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
    await assertPrivateDirectory(dataDir, directoryIdentity);
  } catch (error) {
    await lease.close().catch(() => {});
    await unlinkOwnedLock(lockPath, leaseIdentity).catch(() => {});
    throw error;
  }
  let released = false;
  let closing = false;
  let closePromise;
  let durabilityUncertainState = false;
  let directoryUncertainState = false;
  // Serialize all commits made through this lease. The HTTP server has its own
  // action queue, but the store primitive must also be safe for direct callers.
  let commitQueue = Promise.resolve();
  async function close() {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      // A commit accepted before close must finish before the writer lease is
      // released. New commits are rejected as soon as closing begins.
      await commitQueue;
      if (released) return;
      released = true;
      await lease.close();
      await unlinkOwnedLock(lockPath, leaseIdentity);
    })();
    return closePromise;
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
      if (canonicalStringify(envelope) !== raw) {
        throw storeReadError('SERVICE_STORE_NONCANONICAL', 'Service store envelope must use canonical JSON encoding');
      }
      if (envelope.schema !== 'ngl.service-store.v1' || !envelope.payload || envelope.digest !== digest(envelope.payload)) throw new Error('Service store integrity check failed');
      current = immutableSnapshot(await validate(envelope.payload));
    } catch (error) { await close(); throw error; }
  } else {
    try { current = immutableSnapshot(await validate(initial)); await persist(current); }
    catch (error) { await close(); throw error; }
  }
  async function assertStableDirectory() {
    try { await assertPrivateDirectory(dataDir, directoryIdentity); }
    catch (error) {
      directoryUncertainState = true;
      throw storeReadError('SERVICE_DIRECTORY_CHANGED', 'Service store directory changed; close and reopen to validate storage before continuing');
    }
  }
  async function persist(payload) {
    // The caller may retain this store while the directory pathname is replaced.
    // Revalidate its identity before any path-based write.
    await assertStableDirectory();
    const pending = join(dataDir, `.service-${randomUUID()}.tmp`);
    let file;
    let renamed = false;
    try {
      file = await open(pending, 'wx', 0o600);
      await file.writeFile(canonicalStringify({ schema: 'ngl.service-store.v1', payload, digest: digest(payload) }));
      await file.sync();
      await file.close(); file = null;
      // Do not replace the envelope if the directory changed while the temp
      // file was being written.
      await assertStableDirectory();
      await rename(pending, path);
      renamed = true;
      try {
        // A post-rename path change is itself an uncertain durability boundary:
        // never expose stale in-memory state or permit another write.
        await assertPrivateDirectory(dataDir, directoryIdentity);
        await syncDirectoryFn(dataDir);
      } catch (error) {
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
    get value() {
      if (directoryUncertainState) throw storeReadError('SERVICE_DIRECTORY_CHANGED', 'Service store directory changed; close and reopen to validate storage before continuing');
      if (durabilityUncertainState) throw durabilityUncertain();
      return current;
    },
    close,
    async commit(candidate) {
      if (released || closing) throw closedStoreError();
      if (directoryUncertainState) throw storeReadError('SERVICE_DIRECTORY_CHANGED', 'Service store directory changed; close and reopen to validate storage before continuing');
      if (durabilityUncertainState) throw durabilityUncertain();
      // Snapshot as strict canonical JSON at call time. This rejects accessors,
      // exotic objects and sparse arrays without invoking getters, and prevents
      // caller mutation while the write waits behind another commit.
      const snapshot = JSON.parse(canonicalStringify(candidate));
      const operation = commitQueue.then(async () => {
        if (released) throw closedStoreError();
        if (directoryUncertainState) throw storeReadError('SERVICE_DIRECTORY_CHANGED', 'Service store directory changed; close and reopen to validate storage before continuing');
        if (durabilityUncertainState) throw durabilityUncertain();
        const valid = immutableSnapshot(await validate(snapshot));
        const previousRevision = revisionOf(current);
        const candidateRevision = revisionOf(valid);
        if (previousRevision !== null && candidateRevision !== null &&
            candidateRevision !== previousRevision + 1) {
          throw staleRevisionError();
        }
        await persist(valid);
        current = valid;
        return current;
      });
      commitQueue = operation.catch(() => {});
      return operation;
    }
  };
}
