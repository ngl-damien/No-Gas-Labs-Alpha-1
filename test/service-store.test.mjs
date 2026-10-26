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

test('service-store replacement survives close and validated reopen', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-service-store-sync-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  assert.deepEqual(await store.commit({ revision: 1 }), { revision: 1 });
  await store.close();

  const reopened = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  assert.deepEqual(reopened.value, { revision: 1 });
  await reopened.close();
});

test('a post-rename directory-sync failure is explicit and blocks later writes until reopen', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-service-store-uncertain-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
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
  // The in-memory state is not promoted after an uncertain commit.
  assert.deepEqual(store.value, { revision: 0 });
  await assert.rejects(store.commit({ revision: 2 }), error =>
    error.code === 'COMMIT_DURABILITY_UNCERTAIN' && error.status === 503
  );

  // Rename already happened. Preserve the file and require a validated reopen
  // to determine which complete envelope is present; do not attempt rollback.
  const envelope = JSON.parse(await readFile(join(dataDir, 'service.json'), 'utf8'));
  assert.equal(envelope.payload.revision, 1);
  await store.close();

  const reopened = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  assert.deepEqual(reopened.value, { revision: 1 });
  await reopened.close();
});
