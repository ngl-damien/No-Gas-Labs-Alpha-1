import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, open, rename, rm, symlink } from 'node:fs/promises';
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
