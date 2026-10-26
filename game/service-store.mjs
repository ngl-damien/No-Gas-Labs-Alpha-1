import { lstat, mkdir, readFile, open, rename, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalStringify, artifactReceipt } from '../src/institution/kernel.mjs';

const digest = value => artifactReceipt(canonicalStringify(value)).digest;

// This module is also consumed directly by tests and recovery tools, so do not
// rely solely on the HTTP host's earlier check of the same directory path.
async function assertPrivateStoreDirectory(dataDir) {
  const directory = await lstat(dataDir);
  if (directory.isSymbolicLink() || !directory.isDirectory()) {
    throw new Error('Service store data directory must be a regular, non-symlink directory');
  }
  if ((directory.mode & 0o077) !== 0) {
    throw new Error('Service store data directory permissions must exclude group and other access (0700)');
  }
  return { dev: directory.dev, ino: directory.ino };
}

// Remove a lock only while the path still names the exact inode acquired with
// exclusive creation. A replacement file may copy the old contents/token.
async function unlinkOwnedLock(path, identity) {
  if (!identity) return false;
  let current;
  try { current = await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) return false;
  await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  return true;
}

async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

function durabilityUncertain(cause) {
  return Object.assign(new Error(
    'Service store replacement succeeded but directory sync failed; commit durability is uncertain. Reopen and validate the store before writing again.'
  ), { code: 'COMMIT_DURABILITY_UNCERTAIN', status: 503, ...(cause ? { cause } : {}) });
}

/** One replaceable envelope prevents partial world / kernel / artifact commits. */
export async function createServiceStore({ dataDir, initial, validate, syncDirectory: syncDirectoryFn = syncDirectory }) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const dataDirectory = await assertPrivateStoreDirectory(dataDir);
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
    const currentDirectory = await assertPrivateStoreDirectory(dataDir);
    if (currentDirectory.dev !== dataDirectory.dev || currentDirectory.ino !== dataDirectory.ino) {
      throw new Error('Service store data directory changed while acquiring the writer lease');
    }
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
    // File contents are not an ownership proof: a replacement can copy the token.
    await unlinkOwnedLock(lockPath, leaseIdentity);
  }
  let current;
  try {
    const raw = await readFile(path, 'utf8');
    const envelope = JSON.parse(raw);
    if (envelope.schema !== 'ngl.service-store.v1' || !envelope.payload || envelope.digest !== digest(envelope.payload)) throw new Error('Service store integrity check failed');
    current = await validate(envelope.payload);
  } catch (error) {
    if (error.code !== 'ENOENT') { await close(); throw error; }
    try { current = await validate(initial); await persist(current); } catch (initialError) { await close(); throw initialError; }
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
