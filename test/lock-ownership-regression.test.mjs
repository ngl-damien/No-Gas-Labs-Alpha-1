import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, unlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServiceStore } from '../game/service-store.mjs';
import { openLedger } from '../src/institution/ledger.mjs';

const config = {
  founderId: 'founder',
  actors: [
    { id: 'founder', roles: ['founder'], kind: 'human' },
    { id: 'builder', roles: ['executor'], kind: 'local-process' },
    { id: 'verifier', roles: ['observer'], kind: 'local-process' }
  ]
};
const validate = async value => {
  if (!value || !Number.isInteger(value.revision)) throw new Error('invalid test store state');
  return structuredClone(value);
};
async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-lock-owner-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function replaceLockWithIdenticalBytes(path) {
  const original = await readFile(path);
  await unlink(path);
  await writeFile(path, original, { mode: 0o600 });
  return original;
}

test('service-store close preserves a replacement lock even when it copies the owner token', async t => {
  const dataDir = await temp(t);
  const store = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  const lockPath = join(dataDir, '.service.lock');
  const replacement = await replaceLockWithIdenticalBytes(lockPath);
  await store.close();
  assert.deepEqual(await readFile(lockPath), replacement);
});

test('service-store initialization failure preserves a replacement lock', async t => {
  const dataDir = await temp(t);
  const seed = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  await seed.close();
  const lockPath = join(dataDir, '.service.lock');
  let replacement;
  const replaceThenFail = async value => {
    const bytes = await replaceLockWithIdenticalBytes(lockPath);
    replacement = bytes;
    throw new Error('injected validation failure');
  };
  await assert.rejects(
    createServiceStore({ dataDir, initial: { revision: 0 }, validate: replaceThenFail }),
    /injected validation failure/
  );
  assert.deepEqual(await readFile(lockPath), replacement);
});

test('ledger close preserves a replacement writer lock even when bytes are identical', async t => {
  const directory = await temp(t);
  const ledger = await openLedger({ directory, ...config });
  const lockPath = join(directory, '.writer.lock');
  const replacement = await replaceLockWithIdenticalBytes(lockPath);
  await ledger.close();
  assert.deepEqual(await readFile(lockPath), replacement);
});
