import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishAtomicLock } from './atomic-lock.mjs';
import { inspectWriterLock } from '../src/institution/lock-inspector.mjs';

async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-atomic-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function cleanup(path) {
  if (!path) return;
  await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
}

test('atomic lock publication exposes complete, private metadata to the read-only inspector', async t => {
  const directory = await temp(t);
  const lockPath = join(directory, 'institution.json.lock');
  const record = JSON.stringify({
    schema: 'ngl.ledger-lock.v1',
    pid: process.pid,
    openedAt: new Date().toISOString()
  });
  let lease;
  try {
    lease = await publishAtomicLock(lockPath, record);
    const stat = await lstat(lockPath);
    assert.equal(stat.mode & 0o777, 0o600);
    assert.equal(await readFile(lockPath, 'utf8'), record);
    const inspected = await inspectWriterLock(lockPath);
    assert.equal(inspected.status, 'present');
    assert.equal(inspected.format, 'owner-metadata');
    assert.equal(inspected.owner.schema, 'ngl.ledger-lock.v1');
    assert.equal(inspected.owner.pid, process.pid);
    assert.equal(inspected.safeToRemove, false);
    assert.deepEqual((await readdir(directory)).filter(name => name.startsWith('institution.json.lock.tmp-')), []);
  } finally {
    await cleanup(lease?.temporaryPath);
    await cleanup(lockPath);
  }
  assert.deepEqual(await readdir(directory), []);
});

test('a competing publisher fails closed and preserves the first lock inode and bytes', async t => {
  const directory = await temp(t);
  const lockPath = join(directory, 'institution.json.lock');
  const firstRecord = JSON.stringify({ schema: 'ngl.ledger-lock.v1', pid: process.pid, openedAt: new Date().toISOString() });
  const secondRecord = JSON.stringify({ schema: 'ngl.ledger-lock.v1', pid: process.pid, openedAt: new Date(Date.now() + 1).toISOString() });
  let first;
  try {
    first = await publishAtomicLock(lockPath, firstRecord);
    const before = await lstat(lockPath);
    await assert.rejects(
      publishAtomicLock(lockPath, secondRecord),
      error => error.code === 'LEDGER_LOCKED' && error.message === 'LEDGER_LOCKED'
    );
    const after = await lstat(lockPath);
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.equal(await readFile(lockPath, 'utf8'), firstRecord);
    assert.equal((await inspectWriterLock(lockPath)).status, 'present');
  } finally {
    await cleanup(first?.temporaryPath);
    await cleanup(lockPath);
  }
});

test('a symlink at the canonical lock path is preserved and never followed or replaced', async t => {
  const directory = await temp(t);
  const lockPath = join(directory, 'institution.json.lock');
  const targetPath = join(directory, 'target.json');
  await writeFile(targetPath, 'do-not-change', { mode: 0o600 });
  await symlink(targetPath, lockPath);
  const before = await lstat(lockPath);

  await assert.rejects(
    publishAtomicLock(lockPath, JSON.stringify({
      schema: 'ngl.ledger-lock.v1',
      pid: process.pid,
      openedAt: new Date().toISOString()
    })),
    error => error.code === 'LEDGER_LOCKED'
  );

  const after = await lstat(lockPath);
  assert.equal(after.isSymbolicLink(), true);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  assert.equal(await readFile(targetPath, 'utf8'), 'do-not-change');
  assert.deepEqual((await readdir(directory)).sort(), ['institution.json.lock', 'target.json']);
});
