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
  assert.deepEqual(store.value, { revision: 0 }, 'uncertain commit must not promote in-memory state');

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
