import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { link, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { resolve, join, parse, sep } from 'node:path';
import { KernelError, createKernel, applyEvent, canonicalStringify, artifactReceipt } from './kernel.mjs';

const schema = 'ngl.institution.ledger.v1';
const digestPattern = /^[a-f0-9]{64}$/;
const MAX_LEDGER_BYTES = 64 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const clone = value => JSON.parse(canonicalStringify(value));
const hash = value => createHash('sha256').update(canonicalStringify(value)).digest('hex');
const fail = (code, message) => { throw new KernelError(code, message); };

async function syncDirectory(directory) {
  const parent = await open(directory, 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}

// Reject redirected path components before creating a private store. This is a
// best-effort path walk, not an atomic openat-style capability boundary.
async function assertNoSymlinkPathComponents(path) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let stat;
    try { stat = await lstat(current); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink()) fail('LEDGER_PATH_SYMLINK', 'Ledger paths may not contain symlink components');
    if (!stat.isDirectory()) fail('LEDGER_DIRECTORY_UNSAFE', 'Every ledger path component must be a directory');
  }
}

async function assertPrivateDirectory(path, expectedIdentity) {
  await assertNoSymlinkPathComponents(path);
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('LEDGER_DIRECTORY_UNSAFE', 'Ledger storage must be a regular directory');
  if ((stat.mode & 0o077) !== 0) fail('LEDGER_DIRECTORY_PERMISSIONS_TOO_BROAD', 'Ledger directories must exclude group and other access (0700)');
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    fail('LEDGER_DIRECTORY_OWNER_MISMATCH', 'Ledger directory must be owned by the current process user');
  }
  if (expectedIdentity && (stat.dev !== expectedIdentity.dev || stat.ino !== expectedIdentity.ino)) {
    fail('LEDGER_DIRECTORY_CHANGED', 'Ledger directory changed while acquiring the writer lease');
  }
  return { dev: stat.dev, ino: stat.ino };
}

// A copied lock token does not prove that the path still names our lease.
async function readBoundedRegularFile(path, limit, {
  notRegularCode, tooLargeCode, changedCode, permissionsCode, ownerCode, label
}) {
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile()) fail(notRegularCode, `${label} must be a regular, non-symlink file`);
  if ((before.mode & 0o077) !== 0) fail(permissionsCode, `${label} must exclude group and other permissions (0600)`);
  if (typeof process.getuid === 'function' && before.uid !== process.getuid()) {
    fail(ownerCode, `${label} must be owned by the current process user`);
  }
  if (before.size > limit) fail(tooLargeCode, `${label} exceeds its ${limit}-byte limit`);

  let handle;
  try {
    try {
      handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
    } catch (error) {
      if (error.code === 'ELOOP') fail(notRegularCode, `${label} must not be a symlink`);
      throw error;
    }
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      fail(changedCode, `${label} changed while opening`);
    }
    if ((opened.mode & 0o077) !== 0) fail(permissionsCode, `${label} must exclude group and other permissions (0600)`);
    if (typeof process.getuid === 'function' && opened.uid !== process.getuid()) {
      fail(ownerCode, `${label} must be owned by the current process user`);
    }
    if (opened.size > limit) fail(tooLargeCode, `${label} exceeds its ${limit}-byte limit`);
    if (opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) {
      fail(changedCode, `${label} changed before reading`);
    }

    const chunks = [];
    let total = 0;
    let position = 0;
    while (total <= limit) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
      position += bytesRead;
      if (total > limit) fail(tooLargeCode, `${label} exceeds its ${limit}-byte limit`);
    }

    let after;
    try { after = await lstat(path); }
    catch (error) {
      if (error.code === 'ENOENT') fail(changedCode, `${label} disappeared during reading`);
      throw error;
    }
    const afterHandle = await handle.stat();
    if (after.isSymbolicLink() || !after.isFile() ||
        after.dev !== opened.dev || after.ino !== opened.ino) {
      fail(changedCode, `${label} path changed during reading`);
    }
    const unchanged = stat => stat.size === opened.size &&
      stat.mtimeMs === opened.mtimeMs && stat.ctimeMs === opened.ctimeMs;
    if (!unchanged(after) || !unchanged(afterHandle) || total !== opened.size) {
      fail(changedCode, `${label} changed during reading`);
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle?.close().catch(() => {});
  }
}

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
  await assertNoSymlinkPathComponents(location);
  await mkdir(location, { recursive: true, mode: 0o700 });
  const directoryIdentity = await assertPrivateDirectory(location);
  const lockPath = join(location, '.writer.lock');
  const lockTemporaryPath = join(location, `.writer-lock-${randomUUID()}.tmp`);
  let lock;
  let lockIdentity;
  let lockPublished = false;
  try {
    // Prepare and sync the complete private lock record away from the canonical
    // pathname. A same-directory hard link publishes the complete inode atomically
    // and fails with EEXIST rather than replacing a competing writer's lock.
    lock = await open(lockTemporaryPath, 'wx', 0o600);
    const stat = await lock.stat();
    lockIdentity = { dev: stat.dev, ino: stat.ino };
    await lock.writeFile(canonicalStringify({ schema: 'ngl.ledger-lock.v1', pid: process.pid, openedAt: new Date().toISOString() }));
    await lock.sync();
    await assertPrivateDirectory(location, directoryIdentity);
    try {
      await link(lockTemporaryPath, lockPath);
      lockPublished = true;
    } catch (error) {
      if (error.code === 'EEXIST') {
        fail('LEDGER_LOCKED', 'A writer already owns this ledger; inspect any stale lock before recovery');
      }
      throw error;
    }
    await unlink(lockTemporaryPath);
  } catch (error) {
    await lock?.close().catch(() => {});
    await unlink(lockTemporaryPath).catch(() => {});
    if (lockPublished) await unlinkOwnedLock(lockPath, lockIdentity).catch(() => {});
    throw error;
  }
  try {
    await assertPrivateDirectory(location, directoryIdentity);
    let state = createKernel({ actors, founderId });
    const config = { actors: state.actors, founderId: state.founderId };
    const genesis = hash({ schema, config });
    const file = join(location, 'ledger.json');
    const blobDirectory = join(location, 'blobs');
    await assertNoSymlinkPathComponents(blobDirectory);
    await mkdir(blobDirectory, { recursive: true, mode: 0o700 });
    await assertPrivateDirectory(blobDirectory);
    let records = [];

    async function getArtifact(digest, expectedSize) {
      if (typeof digest !== 'string' || !digestPattern.test(digest)) fail('INVALID_ARTIFACT', 'Artifact lookup requires a SHA-256 digest');
      if (expectedSize !== undefined &&
          (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > MAX_ARTIFACT_BYTES)) {
        fail('ARTIFACT_TOO_LARGE', `Artifact exceeds the ${MAX_ARTIFACT_BYTES}-byte persistence limit`);
      }
      let bytes;
      try {
        bytes = await readBoundedRegularFile(join(blobDirectory, digest), MAX_ARTIFACT_BYTES, {
          notRegularCode: 'ARTIFACT_NOT_REGULAR_FILE', tooLargeCode: 'ARTIFACT_TOO_LARGE',
          changedCode: 'ARTIFACT_CHANGED_DURING_READ', permissionsCode: 'ARTIFACT_FILE_PERMISSIONS_TOO_BROAD',
          ownerCode: 'ARTIFACT_FILE_OWNER_MISMATCH', label: 'Persisted artifact'
        });
      } catch (error) {
        if (error.code === 'ENOENT') fail('ARTIFACT_MISSING', `Persisted artifact is missing: ${digest}`);
        throw error;
      }
      if (expectedSize !== undefined && bytes.byteLength !== expectedSize) {
        fail('ARTIFACT_MISMATCH', `Persisted artifact size differs from receipt: ${digest}`);
      }
      if (artifactReceipt(bytes).digest !== digest) fail('ARTIFACT_MISMATCH', `Persisted artifact digest mismatch: ${digest}`);
      return bytes;
    }
    async function eventArtifacts(event, supplied) {
      const result = new Map();
      if (!['execute', 'observe'].includes(event.type) || !Array.isArray(event.outputs)) return result;
      for (const receipt of event.outputs) {
        if (!receipt || typeof receipt.digest !== 'string' || !digestPattern.test(receipt.digest) ||
            !Number.isSafeInteger(receipt.size) || receipt.size < 0) fail('INVALID_EVENT', 'Invalid output digest or size');
        if (receipt.size > MAX_ARTIFACT_BYTES) {
          fail('ARTIFACT_TOO_LARGE', `Artifact exceeds the ${MAX_ARTIFACT_BYTES}-byte persistence limit`);
        }
        const bytes = supplied instanceof Map ? supplied.get(receipt.digest) : supplied && Object.hasOwn(supplied, receipt.digest) ? supplied[receipt.digest] : undefined;
        if (bytes === undefined) {
          result.set(receipt.digest, await getArtifact(receipt.digest, receipt.size));
        } else {
          if (bytes.byteLength > MAX_ARTIFACT_BYTES) fail('ARTIFACT_TOO_LARGE', 'Supplied artifact exceeds the persistence limit');
          if (bytes.byteLength !== receipt.size) fail('ARTIFACT_MISMATCH', 'Supplied artifact size differs from its receipt');
          result.set(receipt.digest, bytes);
        }
      }
      return result;
    }

    let serialized;
    try {
      const bytes = await readBoundedRegularFile(file, MAX_LEDGER_BYTES, {
        notRegularCode: 'LEDGER_NOT_REGULAR_FILE', tooLargeCode: 'LEDGER_TOO_LARGE',
        changedCode: 'LEDGER_CHANGED_DURING_READ', permissionsCode: 'LEDGER_FILE_PERMISSIONS_TOO_BROAD',
        ownerCode: 'LEDGER_FILE_OWNER_MISMATCH', label: 'Ledger file'
      });
      serialized = bytes.toString('utf8');
      if (!Buffer.from(serialized, 'utf8').equals(bytes)) {
        fail('LEDGER_TAMPERED', 'Ledger is not valid UTF-8');
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (serialized !== undefined) {
      let saved;
      try { saved = JSON.parse(serialized); }
      catch { fail('LEDGER_TAMPERED', 'Ledger is not valid JSON'); }
      let canonicalSaved;
      try { canonicalSaved = canonicalStringify(saved); }
      catch { fail('LEDGER_TAMPERED', 'Ledger is not canonical JSON'); }
      if (canonicalSaved !== serialized) fail('LEDGER_TAMPERED', 'Ledger is not canonical JSON');
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
    function assertReadable() {
      if (durabilityUncertain) {
        fail('COMMIT_DURABILITY_UNCERTAIN', 'A previous ledger replacement had uncertain durability; close and reopen the ledger to validate the committed envelope before reading again');
      }
    }
    return {
      get state() { assertReadable(); return clone(state); },
      get events() { assertReadable(); return clone(state.events); },
      get head() { assertReadable(); return records.at(-1)?.hash ?? genesis; },
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
            const byteLength = typeof bytes === 'string' ? Buffer.byteLength(bytes, 'utf8') : bytes.byteLength;
            if (byteLength > MAX_ARTIFACT_BYTES) fail('ARTIFACT_TOO_LARGE', `Artifact exceeds the ${MAX_ARTIFACT_BYTES}-byte persistence limit`);
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
