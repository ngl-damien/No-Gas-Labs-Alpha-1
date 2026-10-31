import test from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, writeFile, open, link, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServiceStore } from '../game/service-store.mjs';
import { inspectWriterLock } from '../src/institution/lock-inspector.mjs';

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

test('service-store applies the revision guard to the canonical world payload', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-world-revision-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const validateWorldPayload = async value => {
    if (!value?.world || !Number.isInteger(value.world.revision)) throw new Error('invalid test world payload');
    return structuredClone(value);
  };
  const initial = { world: { revision: 0 }, events: [] };
  const store = await createServiceStore({ dataDir, initial, validate: validateWorldPayload });
  const results = await Promise.allSettled([
    store.commit({ world: { revision: 1 }, events: ['first'] }),
    store.commit({ world: { revision: 1 }, events: ['second'] })
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'SERVICE_STALE_REVISION');
  assert.equal(store.value.world.revision, 1);
  assert.equal(store.value.events.length, 1);
  await store.close();

  const reopened = await createServiceStore({ dataDir, initial, validate: validateWorldPayload });
  assert.equal(reopened.value.world.revision, 1);
  assert.equal(reopened.value.events.length, 1, 'replay must retain exactly one winning world event');
  await reopened.close();
});


test('service-store value and commit results cannot mutate the retained projection', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-immutable-view-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const initial = { revision: 0, nested: { label: 'initial' }, items: [{ value: 1 }] };
  const store = await createServiceStore({ dataDir, initial, validate: async value => value });

  const view = store.value;
  initial.nested.label = 'mutated through the caller-owned initial object';
  assert.equal(view.nested.label, 'initial', 'initial caller references must be detached at open');
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.nested), true);
  assert.equal(Object.isFrozen(view.items), true);
  assert.equal(Reflect.set(view.nested, 'label', 'tampered'), false);
  assert.equal(Reflect.set(view.items[0], 'value', 99), false);
  assert.equal(store.value.nested.label, 'initial');
  assert.equal(store.value.items[0].value, 1);

  const committed = await store.commit({ revision: 1, nested: { label: 'committed' }, items: [{ value: 2 }] });
  assert.equal(Object.isFrozen(committed), true);
  assert.equal(Reflect.set(committed.nested, 'label', 'tampered-result'), false);
  assert.equal(store.value.nested.label, 'committed');

  await store.close();
  const reopened = await createServiceStore({ dataDir, initial: { revision: 0 }, validate: async value => value });
  assert.deepEqual(reopened.value, { revision: 1, nested: { label: 'committed' }, items: [{ value: 2 }] });
  await reopened.close();
});


test('service-store revision guard rejects missing or malformed canonical world revisions', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-revision-shape-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const initial = { revision: 0, world: { revision: 0 }, events: [] };
  const store = await createServiceStore({ dataDir, initial, validate });

  await assert.rejects(
    store.commit({ revision: 1, events: ['world field removed'] }),
    error => error.code === 'SERVICE_STALE_REVISION' && error.status === 409
  );
  await assert.rejects(
    store.commit({ revision: 1, world: { revision: 'invalid' }, events: ['nested revision malformed'] }),
    error => error.code === 'SERVICE_STALE_REVISION' && error.status === 409
  );
  assert.deepEqual(store.value, initial, 'rejected revision-shape changes must not alter retained state');

  await store.commit({ revision: 1, world: { revision: 1 }, events: ['valid progression'] });
  assert.equal(store.value.world.revision, 1);
  assert.deepEqual(store.value.events, ['valid progression']);
  await store.close();
});


test('service-store preserves explicit top-level revision mode when world has no revision field', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-top-level-revision-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const initial = { revision: 0, world: { label: 'legacy payload' }, events: [] };
  const store = await createServiceStore({ dataDir, initial, validate });

  await store.commit({ revision: 1, world: { label: 'updated legacy payload' }, events: ['one'] });
  assert.equal(store.value.revision, 1);
  assert.equal(store.value.world.label, 'updated legacy payload');
  await store.close();
});


test('service-store fails closed when current UID verification is unavailable, throws, or is invalid', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ngl-store-owner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const moduleUrl = new URL('../game/service-store.mjs', import.meta.url).href;
  const cases = [
    ['missing', "Object.defineProperty(process, 'getuid', { value: undefined, configurable: true, writable: true });",
      'SERVICE_DIRECTORY_OWNER_VERIFICATION_UNAVAILABLE'],
    ['getter-throws', "Object.defineProperty(process, 'getuid', { get() { throw new Error('fixture UID getter failure'); }, configurable: true });",
      'SERVICE_DIRECTORY_OWNER_VERIFICATION_UNAVAILABLE'],
    ['wrong-owner', "const original = process.getuid.bind(process); Object.defineProperty(process, 'getuid', { value: () => original() + 1, configurable: true, writable: true });",
      'SERVICE_DIRECTORY_OWNER_MISMATCH'],
    ['throwing', "Object.defineProperty(process, 'getuid', { value: () => { throw new Error('fixture UID failure'); }, configurable: true, writable: true });",
      'SERVICE_DIRECTORY_OWNER_VERIFICATION_FAILED'],
    ['invalid', "Object.defineProperty(process, 'getuid', { value: () => -1, configurable: true, writable: true });",
      'SERVICE_DIRECTORY_OWNER_VERIFICATION_INVALID']
  ];

  for (const [label, override, expectedCode] of cases) {
    const dataDir = join(root, label);
    const preload = join(root, label + '.mjs');
    await writeFile(preload, override + '\n');
    const probe = `
      const { createServiceStore } = await import(${JSON.stringify(moduleUrl)});
      try {
        await createServiceStore({
          dataDir: process.env.NGL_TEST_DATA_DIR,
          initial: { revision: 0 },
          validate: async value => value
        });
        console.log(JSON.stringify({ unexpected: 'store opened' }));
        process.exitCode = 2;
      } catch (error) {
        console.log(JSON.stringify({ code: error.code, message: error.message }));
        if (error.code !== process.env.NGL_EXPECTED_ERROR_CODE) process.exitCode = 3;
      }
    `;
    const result = spawnSync(process.execPath, ['--import', preload, '--input-type=module', '-e', probe], {
      cwd: process.cwd(),
      env: { ...process.env, NGL_TEST_DATA_DIR: dataDir, NGL_EXPECTED_ERROR_CODE: expectedCode },
      encoding: 'utf8',
      timeout: 10_000
    });
    assert.equal(result.error, undefined, `${label} UID probe must complete: ${result.error?.message}`);
    assert.equal(result.status, 0, `${label} UID probe failed: ${result.stderr}`);
    const outcome = JSON.parse(result.stdout.trim());
    assert.equal(outcome.code, expectedCode);
    await assert.rejects(lstat(join(dataDir, '.service.lock')), { code: 'ENOENT' });
    await assert.rejects(lstat(join(dataDir, 'service.json')), { code: 'ENOENT' });
  }
});

test('service-store rechecks persisted-envelope ownership before and after opening the file', async t => {
  if (typeof process.getuid !== 'function') {
    t.skip('persisted-envelope owner probes require a platform UID API');
    return;
  }
  const root = await mkdtemp(join(tmpdir(), 'ngl-store-envelope-owner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, 'store');
  const seed = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  await seed.close();
  const moduleUrl = new URL('../game/service-store.mjs', import.meta.url).href;

  for (const [label, failAt] of [['path', 7], ['descriptor', 8]]) {
    const preload = join(root, label + '-uid-failure.mjs');
    const override = `
      const original = process.getuid.bind(process);
      let calls = 0;
      Object.defineProperty(process, 'getuid', {
        value: () => {
          calls += 1;
          if (calls === ${failAt}) throw new Error('injected UID failure');
          return original();
        },
        configurable: true,
        writable: true
      });
      globalThis.__nglUidCalls = () => calls;
    `;
    await writeFile(preload, override + '\n');
    const probe = `
      const { createServiceStore } = await import(${JSON.stringify(moduleUrl)});
      try {
        const store = await createServiceStore({
          dataDir: process.env.NGL_TEST_DATA_DIR,
          initial: { revision: 0 },
          validate: async value => value
        });
        await store.close();
        console.log(JSON.stringify({ unexpected: 'store opened', calls: globalThis.__nglUidCalls() }));
        process.exitCode = 2;
      } catch (error) {
        console.log(JSON.stringify({ code: error.code, calls: globalThis.__nglUidCalls() }));
        if (error.code !== 'SERVICE_STORE_OWNER_VERIFICATION_FAILED') process.exitCode = 3;
      }
    `;
    const result = spawnSync(process.execPath, ['--import', preload, '--input-type=module', '-e', probe], {
      cwd: process.cwd(),
      env: { ...process.env, NGL_TEST_DATA_DIR: dataDir },
      encoding: 'utf8',
      timeout: 10_000
    });
    assert.equal(result.error, undefined, `${label} envelope UID probe must complete: ${result.error?.message}`);
    assert.equal(result.status, 0, `${label} envelope UID probe failed: ${result.stderr}`);
    const outcome = JSON.parse(result.stdout.trim());
    assert.equal(outcome.code, 'SERVICE_STORE_OWNER_VERIFICATION_FAILED');
    assert.equal(outcome.calls, failAt, 'the injected failure must occur at the intended owner-check boundary');
    await assert.rejects(lstat(join(dataDir, '.service.lock')), { code: 'ENOENT' }, 'failed reopen must release its writer lock');
  }
});


test('service-store rejects persisted-envelope owner mismatches at path and descriptor boundaries', async t => {
  if (typeof process.getuid !== 'function') {
    t.skip('persisted-envelope owner probes require a platform UID API');
    return;
  }
  const root = await mkdtemp(join(tmpdir(), 'ngl-store-envelope-owner-mismatch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, 'store');
  const seed = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  await seed.close();
  const originalBytes = await readFile(join(dataDir, 'service.json'));
  const moduleUrl = new URL('../game/service-store.mjs', import.meta.url).href;

  for (const [label, mismatchAt] of [['path', 7], ['descriptor', 8]]) {
    const preload = join(root, label + '-uid-mismatch.mjs');
    const override = `
      const original = process.getuid.bind(process);
      let calls = 0;
      Object.defineProperty(process, 'getuid', {
        value: () => {
          calls += 1;
          const uid = original();
          return calls === ${mismatchAt} ? uid + 1 : uid;
        },
        configurable: true,
        writable: true
      });
      globalThis.__nglUidCalls = () => calls;
    `;
    await writeFile(preload, override + '\n');
    const probe = `
      const { createServiceStore } = await import(${JSON.stringify(moduleUrl)});
      try {
        const store = await createServiceStore({
          dataDir: process.env.NGL_TEST_DATA_DIR,
          initial: { revision: 0 },
          validate: async value => value
        });
        await store.close();
        console.log(JSON.stringify({ unexpected: 'store opened', calls: globalThis.__nglUidCalls() }));
        process.exitCode = 2;
      } catch (error) {
        console.log(JSON.stringify({ code: error.code, calls: globalThis.__nglUidCalls() }));
        if (error.code !== 'SERVICE_STORE_OWNER_MISMATCH') process.exitCode = 3;
      }
    `;
    const result = spawnSync(process.execPath, ['--import', preload, '--input-type=module', '-e', probe], {
      cwd: process.cwd(),
      env: { ...process.env, NGL_TEST_DATA_DIR: dataDir },
      encoding: 'utf8',
      timeout: 10_000
    });
    assert.equal(result.error, undefined, `${label} owner mismatch probe must complete: ${result.error?.message}`);
    assert.equal(result.status, 0, `${label} owner mismatch probe failed: ${result.stderr}`);
    const outcome = JSON.parse(result.stdout.trim());
    assert.equal(outcome.code, 'SERVICE_STORE_OWNER_MISMATCH');
    assert.equal(outcome.calls, mismatchAt, 'the injected mismatch must occur at the intended ownership boundary');
    await assert.rejects(lstat(join(dataDir, '.service.lock')), { code: 'ENOENT' }, 'rejected reopen must release its writer lock');
    assert.deepEqual(await readFile(join(dataDir, 'service.json')), originalBytes, 'rejected reopen must not rewrite persisted state');
  }
});

test('service-store enforces its writer lease across independent processes', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-cross-process-lock-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  const lockPath = join(dataDir, '.service.lock');
  const lockBefore = await lstat(lockPath);
  const moduleUrl = new URL('../game/service-store.mjs', import.meta.url).href;
  const probe = `
    const { createServiceStore } = await import(${JSON.stringify(moduleUrl)});
    try {
      const childStore = await createServiceStore({
        dataDir: process.env.NGL_TEST_DATA_DIR,
        initial: { revision: 0 },
        validate: async value => value
      });
      await childStore.close();
      console.log(JSON.stringify({ opened: true }));
    } catch (error) {
      console.log(JSON.stringify({ opened: false, code: error.code }));
      if (error.code !== process.env.NGL_EXPECTED_ERROR_CODE) process.exitCode = 3;
    }
  `;
  const contender = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NGL_TEST_DATA_DIR: dataDir,
      NGL_EXPECTED_ERROR_CODE: 'SERVICE_LOCKED'
    },
    encoding: 'utf8',
    timeout: 10_000
  });
  assert.equal(contender.error, undefined, `independent contender must complete: ${contender.error?.message}`);
  assert.equal(contender.status, 0, `independent contender failed: ${contender.stderr}`);
  assert.deepEqual(JSON.parse(contender.stdout.trim()), { opened: false, code: 'SERVICE_LOCKED' });
  const lockAfter = await lstat(lockPath);
  assert.equal(lockAfter.dev, lockBefore.dev);
  assert.equal(lockAfter.ino, lockBefore.ino, 'a rejected contender must not remove or replace the live writer lock');

  await store.close();
  const successor = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NGL_TEST_DATA_DIR: dataDir,
      NGL_EXPECTED_ERROR_CODE: 'SERVICE_LOCKED'
    },
    encoding: 'utf8',
    timeout: 10_000
  });
  assert.equal(successor.error, undefined, `successor writer must complete: ${successor.error?.message}`);
  assert.equal(successor.status, 0, `successor writer failed: ${successor.stderr}`);
  assert.deepEqual(JSON.parse(successor.stdout.trim()), { opened: true });
  const persisted = JSON.parse(await readFile(join(dataDir, 'service.json'), 'utf8'));
  assert.deepEqual(persisted.payload, { revision: 0 }, 'the successor must reopen the same validated store');
  await assert.rejects(lstat(lockPath), { code: 'ENOENT' }, 'the successor must release its own writer lock');
});

test('service-store leaves an abruptly terminated writer lock for read-only inspection', async t => {
  if (typeof process.getuid !== 'function') {
    t.skip('service-store owner verification requires a platform UID API');
    return;
  }
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-abrupt-writer-exit-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const moduleUrl = new URL('../game/service-store.mjs', import.meta.url).href;
  const probe = `
    const { createServiceStore } = await import(${JSON.stringify(moduleUrl)});
    try {
      await createServiceStore({
        dataDir: process.env.NGL_TEST_DATA_DIR,
        initial: { revision: 0 },
        validate: async value => value
      });
      process.stdout.write(JSON.stringify({ opened: true }) + '\\n', () => process.exit(0));
    } catch (error) {
      console.log(JSON.stringify({ opened: false, code: error.code }));
      if (error.code !== process.env.NGL_EXPECTED_ERROR_CODE) process.exitCode = 3;
    }
  `;
  const crashedOwner = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: process.cwd(),
    env: { ...process.env, NGL_TEST_DATA_DIR: dataDir, NGL_EXPECTED_ERROR_CODE: '' },
    encoding: 'utf8',
    timeout: 10_000
  });
  assert.equal(crashedOwner.error, undefined, `writer process must terminate: ${crashedOwner.error?.message}`);
  assert.equal(crashedOwner.status, 0, `writer process failed: ${crashedOwner.stderr}`);
  assert.deepEqual(JSON.parse(crashedOwner.stdout.trim()), { opened: true });

  const lockPath = join(dataDir, '.service.lock');
  const lockAfterExit = await lstat(lockPath);
  const inspection = await inspectWriterLock(lockPath);
  assert.equal(inspection.status, 'present');
  assert.equal(inspection.format, 'owner-metadata');
  assert.equal(inspection.owner.schema, 'ngl.service-lock.v1');
  assert.equal(inspection.safeToRemove, false, 'a dead PID must never authorize automatic lock deletion');

  const contender = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NGL_TEST_DATA_DIR: dataDir,
      NGL_EXPECTED_ERROR_CODE: 'SERVICE_LOCKED'
    },
    encoding: 'utf8',
    timeout: 10_000
  });
  assert.equal(contender.error, undefined, `post-crash contender must complete: ${contender.error?.message}`);
  assert.equal(contender.status, 0, `post-crash contender failed: ${contender.stderr}`);
  assert.deepEqual(JSON.parse(contender.stdout.trim()), { opened: false, code: 'SERVICE_LOCKED' });
  const lockAfterContender = await lstat(lockPath);
  assert.equal(lockAfterContender.dev, lockAfterExit.dev);
  assert.equal(lockAfterContender.ino, lockAfterExit.ino, 'inspection and rejected reopen must preserve the stale lock for offline recovery');
});



test('service-store refuses to publish a lock when its temporary pathname is replaced before linking', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-lock-replaced-before-link-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const lockPath = join(dataDir, '.service.lock');
  const movedOriginal = join(dataDir, '.service-lock-original');
  let temporaryPath;
  const linkFile = async (source, target) => {
    temporaryPath = source;
    await rename(source, movedOriginal);
    await writeFile(source, 'replacement lock path', { mode: 0o600 });
    await link(source, target);
  };

  await assert.rejects(
    createServiceStore({ dataDir, initial: { revision: 0 }, validate, linkFile }),
    error => error.code === 'SERVICE_LOCK_CHANGED'
  );

  const [published, temporary, original] = await Promise.all([
    lstat(lockPath), lstat(temporaryPath), lstat(movedOriginal)
  ]);
  assert.equal(published.dev, temporary.dev);
  assert.equal(published.ino, temporary.ino);
  assert.notEqual(published.ino, original.ino, 'the published replacement must not be mistaken for the opened lease inode');
  assert.equal(await readFile(lockPath, 'utf8'), 'replacement lock path');
  assert.equal(await readFile(temporaryPath, 'utf8'), 'replacement lock path');
});

test('service-store removes only its own published lock when the temporary pathname changes after linking', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-lock-replaced-after-link-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const lockPath = join(dataDir, '.service.lock');
  const movedOriginal = join(dataDir, '.service-lock-original');
  let temporaryPath;
  const linkFile = async (source, target) => {
    temporaryPath = source;
    await link(source, target);
    await rename(source, movedOriginal);
    await writeFile(source, 'replacement temporary path', { mode: 0o600 });
  };

  await assert.rejects(
    createServiceStore({ dataDir, initial: { revision: 0 }, validate, linkFile }),
    error => error.code === 'SERVICE_LOCK_CHANGED'
  );

  await assert.rejects(lstat(lockPath), { code: 'ENOENT' }, 'cleanup must release the inode opened by this process');
  assert.equal(await readFile(temporaryPath, 'utf8'), 'replacement temporary path', 'cleanup must not unlink a replacement temporary path');
  assert.equal((await lstat(movedOriginal)).isFile(), true, 'the original opened inode remains reachable for inspection');
});


test('service-store close preserves a replacement lock even when its metadata is identical', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-close-replaced-lock-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const lockPath = join(dataDir, '.service.lock');
  const movedOriginal = join(dataDir, '.service-lock-original');
  const store = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  const originalBytes = await readFile(lockPath);
  const original = await lstat(lockPath);

  await rename(lockPath, movedOriginal);
  await writeFile(lockPath, originalBytes, { mode: 0o600 });
  const replacement = await lstat(lockPath);
  assert.notEqual(replacement.ino, original.ino, 'replacement must be a different inode');
  assert.deepEqual(await readFile(lockPath), originalBytes, 'replacement deliberately reuses the same owner metadata');

  await assert.rejects(
    store.close(),
    error => error.code === 'SERVICE_LOCK_CHANGED' && error.status === 503,
    'close must report that it could not release a replacement lock'
  );

  const afterClose = await lstat(lockPath);
  assert.equal(afterClose.dev, replacement.dev);
  assert.equal(afterClose.ino, replacement.ino, 'close must not unlink a replacement lock based only on matching contents');
  assert.deepEqual(await readFile(lockPath), originalBytes);
  assert.equal((await lstat(movedOriginal)).ino, original.ino, 'the original lease inode remains available for inspection');
});


test('service-store refuses commits after the published writer lock pathname is replaced', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-lost-lease-before-commit-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  const lockPath = join(dataDir, '.service.lock');
  const movedOriginal = join(dataDir, '.service-lock-original');
  const originalBytes = await readFile(lockPath);
  const original = await lstat(lockPath);

  await rename(lockPath, movedOriginal);
  await writeFile(lockPath, originalBytes, { mode: 0o600 });
  const replacement = await lstat(lockPath);
  assert.notEqual(replacement.ino, original.ino, 'replacement must have a different inode');
  assert.deepEqual(await readFile(lockPath), originalBytes, 'replacement deliberately reuses the original metadata');

  await assert.rejects(
    store.commit({ revision: 1 }),
    error => error.code === 'SERVICE_LOCK_CHANGED' && error.status === 503
  );
  assert.throws(
    () => store.value,
    error => error.code === 'SERVICE_LOCK_CHANGED',
    'a store that lost its writer lease must not expose a possibly stale projection'
  );
  const retained = JSON.parse(await readFile(join(dataDir, 'service.json'), 'utf8'));
  assert.equal(retained.payload.revision, 0, 'a lost writer must not persist a new revision');
  await assert.rejects(
    store.commit({ revision: 1 }),
    error => error.code === 'SERVICE_LOCK_CHANGED'
  );

  await assert.rejects(store.close(), error => error.code === 'SERVICE_LOCK_CHANGED');
  const afterClose = await lstat(lockPath);
  assert.equal(afterClose.ino, replacement.ino, 'close must preserve the replacement lock');
  await assert.rejects(
    createServiceStore({ dataDir, initial: { revision: 0 }, validate }),
    error => error.code === 'SERVICE_LOCKED',
    'the replacement lock must continue to exclude another writer'
  );
});

test('service-store marks a commit uncertain when the writer lease is replaced during atomic rename', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-store-lost-lease-during-rename-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const seed = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  await seed.close();

  const lockPath = join(dataDir, '.service.lock');
  const movedOriginal = join(dataDir, '.service-lock-original');
  let replacement;
  const store = await createServiceStore({
    dataDir,
    initial: { revision: 0 },
    validate,
    renameFile: async (pending, target) => {
      const originalBytes = await readFile(lockPath);
      await rename(lockPath, movedOriginal);
      await writeFile(lockPath, originalBytes, { mode: 0o600 });
      replacement = await lstat(lockPath);
      await rename(pending, target);
    }
  });

  await assert.rejects(
    store.commit({ revision: 1 }),
    error => error.code === 'COMMIT_LEASE_LOST' && error.status === 503
  );
  assert.throws(
    () => store.value,
    error => error.code === 'COMMIT_LEASE_LOST',
    'a renamed envelope with a lost lease must not be exposed as a confirmed commit'
  );
  const onDisk = JSON.parse(await readFile(join(dataDir, 'service.json'), 'utf8'));
  assert.equal(onDisk.payload.revision, 1, 'the atomic rename may have committed before lease loss was detected');
  await assert.rejects(
    store.commit({ revision: 2 }),
    error => error.code === 'COMMIT_LEASE_LOST'
  );

  await assert.rejects(store.close(), error => error.code === 'COMMIT_LEASE_LOST');
  const afterClose = await lstat(lockPath);
  assert.equal(afterClose.ino, replacement.ino, 'close must preserve the replacement lock after an uncertain commit');
  await assert.rejects(
    createServiceStore({ dataDir, initial: { revision: 0 }, validate }),
    error => error.code === 'SERVICE_LOCKED',
    'no successor may open while the replacement lock remains'
  );
});
