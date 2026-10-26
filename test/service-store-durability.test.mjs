import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServiceStore } from '../game/service-store.mjs';

const validate = async value => {
  if (!value || !Number.isInteger(value.revision)) throw new Error('invalid test store state');
  return structuredClone(value);
};

async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-service-store-durability-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('service-store commit survives a validated reopen', async t => {
  const dataDir = await temp(t);
  const store = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  assert.deepEqual(await store.commit({ revision: 1 }), { revision: 1 });
  await store.close();

  const reopened = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  assert.deepEqual(reopened.value, { revision: 1 });
  await reopened.close();
});

test('post-rename directory-sync failure blocks writes until validated reopen', async t => {
  const dataDir = await temp(t);
  let failNextSync = false;
  const store = await createServiceStore({
    dataDir,
    initial: { revision: 0 },
    validate,
    syncDirectory: async directory => {
      if (failNextSync) {
        failNextSync = false;
        throw new Error('injected directory-sync failure');
      }
      await syncDirectory(directory);
    }
  });

  failNextSync = true;
  await assert.rejects(store.commit({ revision: 1 }), error =>
    error.code === 'COMMIT_DURABILITY_UNCERTAIN' && error.status === 503
  );
  // The rename already happened, but the live projection must not advance.
  assert.deepEqual(store.value, { revision: 0 });
  await assert.rejects(store.commit({ revision: 2 }), error =>
    error.code === 'COMMIT_DURABILITY_UNCERTAIN' && error.status === 503
  );

  const visible = JSON.parse(await readFile(join(dataDir, 'service.json'), 'utf8'));
  assert.equal(visible.payload.revision, 1);
  await store.close();

  // Reopen validates the complete envelope and determines the actual state.
  const reopened = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  assert.deepEqual(reopened.value, { revision: 1 });
  await reopened.close();
});
