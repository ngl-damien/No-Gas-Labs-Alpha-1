import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, writeFile, open, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServiceStore } from '../game/service-store.mjs';

const validate = async value => {
  if (!value || !Number.isInteger(value.revision)) throw new Error('invalid test store state');
  return structuredClone(value);
};

test('service-store latches post-rename directory-sync uncertainty until validated reopen', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-uncertain-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let failNextSync = false;
  const syncDirectory = async directory => {
    if (failNextSync) {
      failNextSync = false;
      throw Object.assign(new Error('injected directory sync failure'), { code: 'EIO' });
    }
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  };

  const store = await createServiceStore({
    dataDir, initial: { revision: 0 }, validate, syncDirectory
  });
  failNextSync = true;
  await assert.rejects(
    store.commit({ revision: 1 }),
    error => error.code === 'COMMIT_DURABILITY_UNCERTAIN' && error.status === 503
  );
  assert.throws(() => store.value, error => error.code === 'COMMIT_DURABILITY_UNCERTAIN' && error.status === 503, 'uncertain commit must not expose a possibly stale projection');

  const onDisk = JSON.parse(await readFile(join(dataDir, 'service.json'), 'utf8'));
  assert.deepEqual(onDisk.payload, { revision: 1 }, 'atomic rename may already expose the replacement');
  await assert.rejects(
    store.commit({ revision: 2 }),
    error => error.code === 'COMMIT_DURABILITY_UNCERTAIN'
  );
  await store.close();

  const reopened = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  assert.deepEqual(reopened.value, { revision: 1 }, 'reopen must validate the actual retained envelope');
  await reopened.close();
});


test('service-store rejects invalid UTF-8 even when replacement decoding would preserve canonical JSON', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-invalid-utf8-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const initial = { revision: 0, note: '\uFFFD' };
  const seed = await createServiceStore({ dataDir, initial, validate });
  await seed.close();

  const file = join(dataDir, 'service.json');
  const original = await readFile(file);
  const replacement = Buffer.from('\uFFFD', 'utf8');
  const index = original.indexOf(replacement);
  assert.notEqual(index, -1, 'fixture must contain the UTF-8 replacement character');
  const malformed = Buffer.concat([
    original.subarray(0, index),
    Buffer.from([0xff]),
    original.subarray(index + replacement.length)
  ]);
  await writeFile(file, malformed);

  await assert.rejects(
    createServiceStore({ dataDir, initial, validate }),
    error => error.code === 'SERVICE_STORE_INVALID_UTF8'
  );
  await assert.rejects(lstat(join(dataDir, '.service.lock')), { code: 'ENOENT' });
});

test('service-store rejects oversized persisted envelopes before reading them', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-oversized-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const seed = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  await seed.close();

  const path = join(dataDir, 'service.json');
  const handle = await open(path, 'r+');
  try { await handle.truncate(64 * 1024 * 1024 + 1); } finally { await handle.close(); }

  await assert.rejects(
    createServiceStore({ dataDir, initial: { revision: 0 }, validate }),
    error => error.code === 'SERVICE_STORE_TOO_LARGE'
  );
  await assert.rejects(lstat(join(dataDir, '.service.lock')), { code: 'ENOENT' });
});

test('service-store rejects symlinked persisted envelopes and releases its lock', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-symlink-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const seed = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  await seed.close();

  const path = join(dataDir, 'service.json');
  await rename(path, join(dataDir, 'service-target.json'));
  await symlink('service-target.json', path);

  await assert.rejects(
    createServiceStore({ dataDir, initial: { revision: 0 }, validate }),
    error => error.code === 'SERVICE_STORE_NOT_REGULAR'
  );
  await assert.rejects(lstat(join(dataDir, '.service.lock')), { code: 'ENOENT' });
});

test('service-store rejects noncanonical persisted envelopes, including duplicate JSON keys', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-noncanonical-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const seed = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  await seed.close();

  const file = join(dataDir, 'service.json');
  const canonical = await readFile(file, 'utf8');
  const ambiguous = canonical.replace('"schema":"ngl.service-store.v1"', '"schema":"wrong","schema":"ngl.service-store.v1"');
  assert.notEqual(ambiguous, canonical, 'fixture must contain a duplicate schema key');
  await writeFile(file, ambiguous);

  await assert.rejects(
    createServiceStore({ dataDir, initial: { revision: 0 }, validate }),
    error => error.code === 'SERVICE_STORE_NONCANONICAL'
  );
  await assert.rejects(lstat(join(dataDir, '.service.lock')), { code: 'ENOENT' });
});

test('service-store rejects group/world-accessible persisted envelopes', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-permissions-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const seed = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  await seed.close();
  await chmod(join(dataDir, 'service.json'), 0o644);

  await assert.rejects(
    createServiceStore({ dataDir, initial: { revision: 0 }, validate }),
    error => error.code === 'SERVICE_STORE_PERMISSIONS_TOO_BROAD'
  );
  await assert.rejects(lstat(join(dataDir, '.service.lock')), { code: 'ENOENT' });
});


test('service-store rejects a symlinked ancestor before creating redirected storage', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ngl-store-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const actual = join(root, 'actual');
  const alias = join(root, 'alias');
  await mkdir(actual);
  await symlink(actual, alias, 'dir');

  await assert.rejects(
    createServiceStore({ dataDir: join(alias, 'nested', 'store'), initial: { revision: 0 }, validate }),
    error => error.code === 'SERVICE_DIRECTORY_SYMLINK'
  );
  await assert.rejects(lstat(join(actual, 'nested')), error => error.code === 'ENOENT');
});

test('service-store rejects an exposed existing data directory before creating a writer lock', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-directory-mode-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await chmod(dataDir, 0o755);

  await assert.rejects(
    createServiceStore({ dataDir, initial: { revision: 0 }, validate }),
    error => error.code === 'SERVICE_DIRECTORY_PERMISSIONS_TOO_BROAD'
  );
  await assert.rejects(lstat(join(dataDir, '.service.lock')), error => error.code === 'ENOENT');
});



test('service-store fails closed when its directory path is replaced after open', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ngl-store-replaced-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, 'store');
  const moved = join(root, 'original-store');
  const replacement = join(root, 'replacement');
  const store = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });

  await rename(dataDir, moved);
  await mkdir(replacement);
  await symlink(replacement, dataDir, 'dir');

  await assert.rejects(
    store.commit({ revision: 1 }),
    error => error.code === 'SERVICE_DIRECTORY_CHANGED'
  );
  assert.throws(
    () => store.value,
    error => error.code === 'SERVICE_DIRECTORY_CHANGED'
  );
  const original = JSON.parse(await readFile(join(moved, 'service.json'), 'utf8'));
  assert.deepEqual(original.payload, { revision: 0 });
  await assert.rejects(lstat(join(replacement, 'service.json')), error => error.code === 'ENOENT');
  await store.close();
});

test('service-store serializes concurrent commits and rejects a stale revision', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-concurrent-commit-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });

  // Both callers prepared revision 1 from the same revision-0 snapshot.
  // Exactly one may commit; the other must not overwrite the winner.
  const results = await Promise.allSettled([
    store.commit({ revision: 1, winner: 'first' }),
    store.commit({ revision: 1, winner: 'second' })
  ]);
  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'SERVICE_STALE_REVISION');
  assert.equal(rejected[0].reason.status, 409);
  assert.equal(store.value.revision, 1);
  assert.ok(['first', 'second'].includes(store.value.winner));

  await store.close();
  const reopened = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  assert.deepEqual(reopened.value, store.value, 'reopen must retain the sole committed winner');
  await reopened.close();
});

test('service-store close drains accepted commits and rejects new commits', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-close-drain-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let pauseNextSync = false;
  let signalEntered;
  let releaseSync;
  const entered = new Promise(resolve => { signalEntered = resolve; });
  const gate = new Promise(resolve => { releaseSync = resolve; });
  const syncDirectory = async directory => {
    if (pauseNextSync) {
      pauseNextSync = false;
      signalEntered();
      await gate;
    }
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  };
  const store = await createServiceStore({ dataDir, initial: { revision: 0 }, validate, syncDirectory });

  pauseNextSync = true;
  const accepted = store.commit({ revision: 1 });
  await entered;
  const closing = store.close();
  await assert.rejects(
    store.commit({ revision: 2 }),
    error => error.code === 'SERVICE_STORE_CLOSED'
  );
  releaseSync();
  await accepted;
  await closing;

  const reopened = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  assert.equal(reopened.value.revision, 1, 'close must wait for the accepted durable commit');
  await reopened.close();
});

test('service-store snapshots a candidate before queued validation', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-snapshot-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let pauseNextValidation = false;
  let signalEntered;
  let releaseValidation;
  const entered = new Promise(resolve => { signalEntered = resolve; });
  const gate = new Promise(resolve => { releaseValidation = resolve; });
  const delayedValidate = async value => {
    if (pauseNextValidation) {
      pauseNextValidation = false;
      signalEntered();
      await gate;
    }
    if (!value || !Number.isInteger(value.revision)) throw new Error('invalid test store state');
    return structuredClone(value);
  };
  const store = await createServiceStore({ dataDir, initial: { revision: 0 }, validate: delayedValidate });
  pauseNextValidation = true;
  const candidate = { revision: 1, note: 'original at call time' };
  const pending = store.commit(candidate);
  await entered;
  candidate.note = 'mutated after call';
  releaseValidation();
  await pending;
  assert.equal(store.value.note, 'original at call time');
  await store.close();
});

test('service-store rejects accessor-backed commit candidates without invoking getters', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-accessor-candidate-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  let getterCalls = 0;
  const candidate = { revision: 1 };
  Object.defineProperty(candidate, 'note', {
    enumerable: true,
    get() { getterCalls += 1; return 'must not execute'; }
  });
  await assert.rejects(store.commit(candidate), error => error.code === 'INVALID_JSON');
  assert.equal(getterCalls, 0);
  assert.equal(store.value.revision, 0);
  await store.close();
});
