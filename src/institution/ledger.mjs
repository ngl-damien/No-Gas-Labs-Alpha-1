import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { KernelError, createKernel, applyEvent, canonicalStringify, artifactReceipt } from './kernel.mjs';

const schema = 'ngl.institution.ledger.v1';
const digestPattern = /^[a-f0-9]{64}$/;
const clone = value => JSON.parse(canonicalStringify(value));
const hash = value => createHash('sha256').update(canonicalStringify(value)).digest('hex');
const fail = (code, message) => { throw new KernelError(code, message); };

async function syncDirectory(directory) {
  const parent = await open(directory, 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}

// A copied lock token does not prove that the path still names our lease.
async function unlinkOwnedLock(path, identity) {
  if (!identity) return false;
  let current;
  try { current = await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) return false;
  await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  return true;
}

async function atomicWrite(file, bytes, directory, syncDirectoryFn, { commitBoundary = false } = {}) {
  const temporary = join(directory, `.atomic-${randomUUID()}`);
  let handle;
  let renamed = false;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
    renamed = true;
    try { await syncDirectoryFn(directory); }
    catch (error) {
      if (!commitBoundary) throw error;
      const uncertain = new KernelError(
        'COMMIT_DURABILITY_UNCERTAIN',
        'Ledger replacement succeeded but directory sync failed; close and reopen the ledger to validate the committed envelope before writing again'
      );
      uncertain.cause = error;
      throw uncertain;
    }
  } finally {
    await handle?.close().catch(() => {});
    // After a successful rename the target may already contain the new envelope.
    if (!renamed) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** One live writer per directory. A stale lock after process death requires explicit operator recovery. */
export async function openLedger({ directory, actors, founderId, syncDirectory: syncDirectoryFn = syncDirectory } = {}) {
  if (typeof directory !== 'string' || !directory) fail('INVALID_CONFIG', 'A private ledger directory is required');
  const location = resolve(directory);
  await mkdir(location, { recursive: true, mode: 0o700 });
  const lockPath = join(location, '.writer.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('LEDGER_LOCKED', 'A writer already owns this ledger; inspect any stale lock before recovery'); throw error; }
  let lockIdentity;
  try {
    const stat = await lock.stat();
    lockIdentity = { dev: stat.dev, ino: stat.ino };
    await lock.writeFile(JSON.stringify({ pid: process.pid, openedAt: new Date().toISOString() }));
    await lock.sync();
    let state = createKernel({ actors, founderId });
    const config = { actors: state.actors, founderId: state.founderId };
    const genesis = hash({ schema, config });
    const file = join(location, 'ledger.json');
    const blobDirectory = join(location, 'blobs');
    await mkdir(blobDirectory, { recursive: true, mode: 0o700 });
    let records = [];

    async function getArtifact(digest) {
      if (typeof digest !== 'string' || !digestPattern.test(digest)) fail('INVALID_ARTIFACT', 'Artifact lookup requires a SHA-256 digest');
      let bytes;
      try { bytes = await readFile(join(blobDirectory, digest)); }
      catch (error) { if (error.code === 'ENOENT') fail('ARTIFACT_MISSING', `Persisted artifact is missing: ${digest}`); throw error; }
      if (artifactReceipt(bytes).digest !== digest) fail('ARTIFACT_MISMATCH', `Persisted artifact digest mismatch: ${digest}`);
      return bytes;
    }
    async function eventArtifacts(event, supplied) {
      const result = new Map();
      if (!['execute', 'observe'].includes(event.type) || !Array.isArray(event.outputs)) return result;
      for (const receipt of event.outputs) {
        if (!receipt || typeof receipt.digest !== 'string' || !digestPattern.test(receipt.digest)) fail('INVALID_EVENT', 'Invalid output digest');
        const bytes = supplied instanceof Map ? supplied.get(receipt.digest) : supplied && Object.hasOwn(supplied, receipt.digest) ? supplied[receipt.digest] : undefined;
        result.set(receipt.digest, bytes === undefined ? await getArtifact(receipt.digest) : bytes);
      }
      return result;
    }

    let serialized;
    try { serialized = await readFile(file, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (serialized !== undefined) {
      let saved;
      try { saved = JSON.parse(serialized); }
      catch { fail('LEDGER_TAMPERED', 'Ledger is not valid JSON'); }
      if (saved?.schema !== schema || !Array.isArray(saved.records)) fail('LEDGER_TAMPERED', 'Unrecognized ledger schema or records');
      if (canonicalStringify(saved.config) !== canonicalStringify(config)) fail('CONFIG_MISMATCH', 'Saved roster differs from the trusted configured roster');
      let previousHash = genesis;
      for (let index = 0; index < saved.records.length; index += 1) {
        const record = saved.records[index];
        if (!record || Object.keys(record).sort().join(',') !== 'event,hash,index,previousHash' || record.index !== index || record.previousHash !== previousHash || record.hash !== hash({ index, previousHash, event: record.event })) fail('LEDGER_TAMPERED', `Invalid ledger chain at record ${index}`);
        const before = state.revision;
        state = applyEvent(state, record.event, { artifacts: await eventArtifacts(record.event) });
        if (state.revision !== before + 1) fail('LEDGER_TAMPERED', 'Committed history contains a duplicate event');
        previousHash = record.hash;
      }
      if (canonicalStringify(saved.projection) !== canonicalStringify(state)) fail('PROJECTION_MISMATCH', 'Saved projection differs from deterministic full replay');
      records = clone(saved.records);
    }

    let queue = Promise.resolve();
    let closing = false;
    let closed = false;
    let durabilityUncertain = false;
    return {
      get state() { return clone(state); },
      get events() { return clone(state.events); },
      get head() { return records.at(-1)?.hash ?? genesis; },
      directory: location,
      getArtifact,
      append(input, { artifacts } = {}) {
        if (closing || closed) return Promise.reject(new KernelError('LEDGER_CLOSED', 'Ledger writer is closed'));
        // Snapshot caller-owned input before it can change while queued.
        let event;
        let supplied;
        try {
          event = clone(input);
          supplied = new Map();
          for (const [digest, bytes] of artifacts instanceof Map ? artifacts : Object.entries(artifacts ?? {})) {
            if (typeof bytes !== 'string' && !(bytes instanceof Uint8Array)) fail('INVALID_ARTIFACT', 'Artifact must contain actual bytes');
            supplied.set(digest, typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes));
          }
        } catch (error) { return Promise.reject(error); }
        const operation = queue.then(async () => {
          if (durabilityUncertain) fail('COMMIT_DURABILITY_UNCERTAIN', 'A previous ledger replacement had uncertain durability; close and reopen the ledger before writing again');
          const existing = state.events.find(candidate => candidate.id === event.id);
          if (existing) return clone(applyEvent(state, event));
          const actual = await eventArtifacts(event, supplied);
          const candidate = applyEvent(state, event, { artifacts: actual });
          for (const receipt of event.outputs ?? []) {
            if (!actual.has(receipt.digest)) continue;
            const bytes = actual.get(receipt.digest);
            // Content is verified by applyEvent before any disk mutation.
            await atomicWrite(join(blobDirectory, receipt.digest), bytes, blobDirectory, syncDirectoryFn);
          }
          const index = records.length;
          const previousHash = records.at(-1)?.hash ?? genesis;
          const record = { index, previousHash, event, hash: hash({ index, previousHash, event }) };
          const candidateRecords = [...records, record];
          try {
            await atomicWrite(file, canonicalStringify({ schema, config, records: candidateRecords, projection: candidate }), location, syncDirectoryFn, { commitBoundary: true });
          } catch (error) {
            if (error.code === 'COMMIT_DURABILITY_UNCERTAIN') durabilityUncertain = true;
            throw error;
          }
          // No in-memory authority or projection is adopted before durable replacement.
          records = candidateRecords;
          state = candidate;
          return clone(state);
        });
        queue = operation.catch(() => {});
        return operation;
      },
      async close() {
        if (closed) return;
        closing = true;
        await queue;
        if (closed) return;
        closed = true;
        await lock.close();
        await unlinkOwnedLock(lockPath, lockIdentity);
      },
    };
  } catch (error) {
    await lock.close().catch(() => {});
    await unlinkOwnedLock(lockPath, lockIdentity).catch(() => {});
    throw error;
  }
}
