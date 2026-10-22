import { mkdir, readFile, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalStringify, artifactReceipt } from '../src/institution/kernel.mjs';

const digest = value => artifactReceipt(canonicalStringify(value)).digest;

/** One replaceable envelope prevents partial world / kernel / artifact commits. */
export async function createServiceStore({ dataDir, initial, validate }) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, 'service.json');
  const lockPath = join(dataDir, '.service.lock');
  let lease;
  try { lease = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw Object.assign(new Error('Exclusive service writer lock already exists; stop the owner before opening this store. Stale locks require manual offline recovery.'), { code: 'SERVICE_LOCKED' }); throw error; }
  const ownership = randomUUID();
  try { await lease.writeFile(ownership); } catch (error) { await lease.close(); await rm(lockPath, { force: true }); throw error; }
  let released = false;
  async function close() {
    if (released) return; released = true;
    await lease.close();
    // Never remove a replacement lease installed by an external recovery action.
    if ((await readFile(lockPath, 'utf8').catch(() => null)) === ownership) await rm(lockPath, { force: true });
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
    try {
      file = await open(pending, 'wx', 0o600);
      await file.writeFile(canonicalStringify({ schema: 'ngl.service-store.v1', payload, digest: digest(payload) }));
      await file.sync();
      await file.close(); file = null;
      await rename(pending, path);
    } catch (error) {
      if (file) await file.close().catch(() => {});
      await rm(pending, { force: true }).catch(() => {});
      throw error;
    }
  }
  return {
    get value() { return current; },
    close,
    async commit(candidate) {
      if (released) throw new Error('Service writer lease has closed');
      const valid = await validate(candidate);
      await persist(valid);
      current = valid;
      return current;
    }
  };
}
