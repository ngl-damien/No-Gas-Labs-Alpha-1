import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
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
