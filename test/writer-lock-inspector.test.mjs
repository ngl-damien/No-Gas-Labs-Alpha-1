import test from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { renameSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectWriterLock } from '../src/institution/lock-inspector.mjs';
import { createServiceStore } from '../game/service-store.mjs';
import { openLedger } from '../src/institution/ledger.mjs';
import { openDecisions } from '../src/institution/decisions.mjs';

const config = {
  founderId: 'founder',
  actors: [
    { id: 'founder', roles: ['founder'], kind: 'human' },
    { id: 'builder', roles: ['executor'], kind: 'local-process' },
    { id: 'verifier', roles: ['observer'], kind: 'local-process' }
  ]
};

async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-lock-inspector-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('missing lock is reported without implying recovery is safe', async t => {
  const directory = await temp(t);
  const result = await inspectWriterLock(join(directory, 'missing.lock'));
  assert.equal(result.status, 'missing');
  assert.equal(result.safeToRemove, false);
});

test('inspects active service, ledger, and decision locks with owner metadata', async t => {
  const root = await temp(t);
  const handles = [];
  t.after(async () => {
    for (const handle of handles.reverse()) await handle.close().catch(() => {});
  });

  const serviceDir = join(root, 'service');
  await mkdir(serviceDir, { mode: 0o700 });
  handles.push(await createServiceStore({
    dataDir: serviceDir,
    initial: { revision: 0 },
    validate: async value => structuredClone(value)
  }));
  const ledgerDir = join(root, 'ledger');
  handles.push(await openLedger({ directory: ledgerDir, ...config }));
  const decisionsDir = join(root, 'decisions');
  handles.push(await openDecisions({
    directory: decisionsDir,
    now: () => Date.parse('2026-10-28T06:00:00.000Z')
  }));

  const targets = [
    [join(serviceDir, '.service.lock'), 'ngl.service-lock.v1'],
    [join(ledgerDir, '.writer.lock'), 'ngl.ledger-lock.v1'],
    [join(decisionsDir, '.decisions.lock'), 'ngl.decisions-lock.v1']
  ];
  for (const [path, schema] of targets) {
    const result = await inspectWriterLock(path);
    assert.equal(result.status, 'present', path);
    assert.equal(result.format, 'owner-metadata', path);
    assert.equal(result.owner.schema, schema, path);
    assert.equal(result.owner.pid, process.pid, path);
    assert.equal(result.owner.processProbe, 'possibly-alive', path);
    assert.equal(result.safeToRemove, false, path);
  }
});

test('opaque legacy tokens are not echoed into the diagnostic report', async t => {
  const directory = await temp(t);
  const path = join(directory, '.service.lock');
  const token = 'opaque-legacy-lock-secret';
  await writeFile(path, token, { mode: 0o600 });
  const result = await inspectWriterLock(path);
  assert.equal(result.status, 'present');
  assert.equal(result.format, 'opaque-token');
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(result.safeToRemove, false);
});

test('symlink lock paths are rejected without reading their target', async t => {
  const directory = await temp(t);
  const target = join(directory, 'target');
  const path = join(directory, '.writer.lock');
  await writeFile(target, JSON.stringify({ pid: process.pid, openedAt: new Date().toISOString() }), { mode: 0o600 });
  await symlink(target, path);
  const result = await inspectWriterLock(path);
  assert.equal(result.status, 'unsafe');
  assert.equal(result.reason, 'symlink');
  assert.equal(result.safeToRemove, false);
});

test('oversized lock files fail closed before content parsing', async t => {
  const directory = await temp(t);
  const path = join(directory, '.writer.lock');
  await writeFile(path, 'x'.repeat(4097), { mode: 0o600 });
  const result = await inspectWriterLock(path);
  assert.equal(result.status, 'unsafe');
  assert.equal(result.reason, 'size-limit');
  assert.equal(result.safeToRemove, false);
});

test('partially written JSON lock metadata is malformed and never removable', async t => {
  const directory = await temp(t);
  const path = join(directory, '.writer.lock');
  await writeFile(path, '{"schema":"ngl.service-lock.v1","pid":', { mode: 0o600 });
  const result = await inspectWriterLock(path);
  assert.equal(result.status, 'malformed');
  assert.equal(result.reason, 'invalid-json-lock-metadata');
  assert.equal(result.safeToRemove, false);
});


test('reports changed if the lock path is replaced during the PID probe', async t => {
  const directory = await temp(t);
  const path = join(directory, '.writer.lock');
  const replacement = join(directory, '.replacement.lock');
  await writeFile(path, JSON.stringify({
    schema: 'ngl.service-lock.v1',
    pid: process.pid,
    openedAt: '2026-10-28T11:00:00.000Z'
  }), { mode: 0o600 });

  const originalKill = process.kill;
  let replaced = false;
  process.kill = function(pid, signal) {
    if (!replaced && signal === 0) {
      writeFileSync(replacement, JSON.stringify({
        schema: 'ngl.service-lock.v1',
        pid: process.pid,
        openedAt: '2026-10-28T11:00:00.000Z'
      }), { mode: 0o600 });
      unlinkSync(path);
      renameSync(replacement, path);
      replaced = true;
      return true;
    }
    return originalKill.call(process, pid, signal);
  };
  try {
    const result = await inspectWriterLock(path);
    assert.equal(replaced, true);
    assert.equal(result.status, 'changed');
    assert.equal(result.reason, 'lock-changed-during-owner-probe');
    assert.equal(result.safeToRemove, false);
  } finally {
    process.kill = originalKill;
  }
});

test('reports changed if the lock disappears during the PID probe', async t => {
  const directory = await temp(t);
  const path = join(directory, '.writer.lock');
  await writeFile(path, JSON.stringify({
    schema: 'ngl.service-lock.v1',
    pid: process.pid,
    openedAt: '2026-10-28T11:00:00.000Z'
  }), { mode: 0o600 });

  const originalKill = process.kill;
  let removed = false;
  process.kill = function(pid, signal) {
    if (!removed && signal === 0) {
      unlinkSync(path);
      removed = true;
      return true;
    }
    return originalKill.call(process, pid, signal);
  };
  try {
    const result = await inspectWriterLock(path);
    assert.equal(removed, true);
    assert.equal(result.status, 'changed');
    assert.equal(result.reason, 'lock-disappeared-during-owner-probe');
    assert.equal(result.safeToRemove, false);
  } finally {
    process.kill = originalKill;
  }
});


test('reports changed if owner metadata changes in place during the PID probe', async t => {
  const directory = await temp(t);
  const path = join(directory, '.writer.lock');
  await writeFile(path, JSON.stringify({
    schema: 'ngl.service-lock.v1',
    pid: process.pid,
    openedAt: '2026-10-28T11:00:00.000Z'
  }), { mode: 0o600 });
  const oldTime = new Date('2020-01-01T00:00:00.000Z');
  utimesSync(path, oldTime, oldTime);

  const originalKill = process.kill;
  let changed = false;
  process.kill = function(pid, signal) {
    if (!changed && signal === 0) {
      writeFileSync(path, JSON.stringify({
        schema: 'ngl.service-lock.v1',
        pid: process.pid,
        openedAt: '2026-10-28T11:00:00.001Z'
      }), { mode: 0o600 });
      changed = true;
      return true;
    }
    return originalKill.call(process, pid, signal);
  };
  try {
    const result = await inspectWriterLock(path);
    assert.equal(changed, true);
    assert.equal(result.status, 'changed');
    assert.equal(result.reason, 'lock-changed-during-owner-probe');
    assert.equal(result.safeToRemove, false);
  } finally {
    process.kill = originalKill;
  }
});


test('duplicate JSON keys are malformed and never removable', async t => {
  const directory = await temp(t);
  const path = join(directory, '.writer.lock');
  await writeFile(path, '{"schema":"ngl.service-lock.v1","pid":1,"pid":2,"openedAt":"2026-10-28T11:00:00.000Z"}', { mode: 0o600 });
  const result = await inspectWriterLock(path);
  assert.equal(result.status, 'malformed');
  assert.equal(result.reason, 'duplicate-json-key');
  assert.equal(result.safeToRemove, false);
});

test('escaped spellings of duplicate JSON keys are rejected', async t => {
  const directory = await temp(t);
  const path = join(directory, '.writer.lock');
  await writeFile(path, '{"schema":"ngl.service-lock.v1","pid":1,"p\\u0069d":2,"openedAt":"2026-10-28T11:00:00.000Z"}', { mode: 0o600 });
  const result = await inspectWriterLock(path);
  assert.equal(result.status, 'malformed');
  assert.equal(result.reason, 'duplicate-json-key');
  assert.equal(result.safeToRemove, false);
});


test('recognizes each current writer-lock schema', async t => {
  const directory = await temp(t);
  for (const schema of ['ngl.service-lock.v1', 'ngl.ledger-lock.v1', 'ngl.decisions-lock.v1', 'ngl.courier-lock.v1']) {
    const path = join(directory, schema + '.lock');
    await writeFile(path, JSON.stringify({
      schema,
      pid: process.pid,
      openedAt: '2026-10-28T11:00:00.000Z'
    }), { mode: 0o600 });
    const result = await inspectWriterLock(path);
    assert.equal(result.status, 'present');
    assert.equal(result.format, 'owner-metadata');
    assert.equal(result.owner.schema, schema);
    assert.equal(result.safeToRemove, false);
  }
});

test('does not interpret an unknown writer-lock schema as owner metadata', async t => {
  const directory = await temp(t);
  const path = join(directory, '.writer.lock');
  await writeFile(path, JSON.stringify({
    schema: 'ngl.future-lock.v99',
    pid: process.pid,
    openedAt: '2026-10-28T11:00:00.000Z'
  }), { mode: 0o600 });
  const result = await inspectWriterLock(path);
  assert.equal(result.status, 'present');
  assert.equal(result.format, 'unrecognized-json');
  assert.equal(result.reason, 'unsupported-lock-schema');
  assert.equal(result.owner, undefined);
  assert.equal(result.safeToRemove, false);
});


test('lock inspector reports failed UID ownership lookups as unsafe instead of throwing', async t => {
  const directory = await temp(t);
  const path = join(directory, '.writer.lock');
  await writeFile(path, JSON.stringify({
    schema: 'ngl.service-lock.v1',
    pid: process.pid,
    openedAt: '2026-10-31T00:00:00.000Z'
  }), { mode: 0o600 });
  const moduleUrl = new URL('../src/institution/lock-inspector.mjs', import.meta.url).href;
  const setups = [
    "Object.defineProperty(process, 'getuid', { configurable: true, writable: true, value: () => { throw new Error('UID_LOOKUP_FAILED'); } });",
    "Object.defineProperty(process, 'getuid', { configurable: true, writable: true, value: () => Number.NaN });",
    "Object.defineProperty(process, 'getuid', { configurable: true, get() { throw new Error('UID_PROPERTY_LOOKUP_FAILED'); } });"
  ];
  for (const setup of setups) {
    const script = [
      'import { inspectWriterLock } from ' + JSON.stringify(moduleUrl) + ';',
      setup,
      'const result = await inspectWriterLock(' + JSON.stringify(path) + ');',
      'process.stdout.write(JSON.stringify(result));'
    ].join('\n');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 5000
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const result = JSON.parse(child.stdout);
    assert.equal(result.status, 'unsafe');
    assert.equal(result.reason, 'owner-verification-failed');
    assert.equal(result.safeToRemove, false);
    assert.equal(result.owner, undefined);
  }
});
