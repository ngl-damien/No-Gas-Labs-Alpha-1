import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { lstat, mkdtemp, readFile, rename, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  // Keep the original inode alive under another name so the replacement
  // cannot accidentally receive the same inode number on immediate reuse.
  await rename(path, path + '.displaced');
  await writeFile(path, original, { mode: 0o600 });
  return original;
}

async function replaceLockWithSymlink(path) {
  const original = await readFile(path);
  await rename(path, path + '.displaced');
  const target = path + '.target';
  await writeFile(target, original, { mode: 0o600 });
  await symlink(target, path);
  return original;
}


async function startChildHoldingLock(t, { modulePath, openExpression, env = {} }) {
  const moduleUrl = pathToFileURL(join(process.cwd(), modulePath)).href;
  const source = `
    const mod = await import(${JSON.stringify(moduleUrl)});
    const validate = async value => structuredClone(value);
    const config = JSON.parse(process.env.NGL_TEST_CONFIG || '{}');
    const handle = await ${openExpression};
    console.log('LOCK_HELD');
    await new Promise(resolve => process.stdin.once('data', resolve));
    await handle.close();
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  let ready = false;
  let timer;
  const readyPromise = new Promise((resolve, reject) => {
    const fail = error => {
      clearTimeout(timer);
      reject(error);
    };
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(new Error(`Lock owner did not become ready within 10 seconds: ${stderr}`));
    }, 10_000);
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (!ready && stdout.includes('LOCK_HELD')) {
        ready = true;
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', fail);
    child.once('exit', (code, signal) => {
      if (!ready) fail(new Error(`Lock owner exited before acquiring its lease (code ${code}, signal ${signal}): ${stderr}`));
    });
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit').catch(() => {});
    }
  });
  await readyPromise;
  return {
    async release() {
      child.stdin.end('release');
      const [code, signal] = await once(child, 'exit');
      assert.equal(code, 0, `Lock owner child failed (signal ${signal}): ${stderr}`);
    }
  };
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


test('decision-store close preserves a replacement lock even when bytes are identical', async t => {
  const directory = await temp(t);
  const store = await openDecisions({ directory, now: () => Date.parse('2026-10-27T00:00:00.000Z') });
  const lockPath = join(directory, '.decisions.lock');
  const replacement = await replaceLockWithIdenticalBytes(lockPath);
  await store.close();
  assert.deepEqual(await readFile(lockPath), replacement);
});

test('decision-store close preserves a symlink replacement lock', async t => {
  const directory = await temp(t);
  const store = await openDecisions({ directory, now: () => Date.parse('2026-10-27T00:00:00.000Z') });
  const lockPath = join(directory, '.decisions.lock');
  const replacement = await replaceLockWithSymlink(lockPath);
  await store.close();
  assert.equal((await lstat(lockPath)).isSymbolicLink(), true);
  assert.deepEqual(await readFile(lockPath), replacement);
});

test('concurrent service-store opens admit exactly one writer', async t => {
  const dataDir = await temp(t);
  const results = await Promise.allSettled([
    createServiceStore({ dataDir, initial: { revision: 0 }, validate }),
    createServiceStore({ dataDir, initial: { revision: 0 }, validate })
  ]);
  const opened = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(opened.length, 1, 'only one service-store writer may acquire the directory lease');
  assert.equal(rejected.length, 1, 'the competing initializer must be rejected');
  assert.equal(rejected[0].reason.code, 'SERVICE_LOCKED');
  await opened[0].value.close();
  const reopened = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  await reopened.close();
});

test('concurrent institutional-ledger opens admit exactly one writer', async t => {
  const directory = await temp(t);
  const results = await Promise.allSettled([
    openLedger({ directory, ...config }),
    openLedger({ directory, ...config })
  ]);
  const opened = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(opened.length, 1, 'only one ledger writer may acquire the directory lease');
  assert.equal(rejected.length, 1, 'the competing ledger initializer must be rejected');
  assert.equal(rejected[0].reason.code, 'LEDGER_LOCKED');
  await opened[0].value.close();
  const reopened = await openLedger({ directory, ...config });
  await reopened.close();
});

test('service-store close preserves a symlink replacement lock', async t => {
  const dataDir = await temp(t);
  const store = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  const lockPath = join(dataDir, '.service.lock');
  const replacement = await replaceLockWithSymlink(lockPath);
  await store.close();
  assert.equal((await lstat(lockPath)).isSymbolicLink(), true);
  assert.deepEqual(await readFile(lockPath), replacement);
});

test('ledger close preserves a symlink replacement writer lock', async t => {
  const directory = await temp(t);
  const ledger = await openLedger({ directory, ...config });
  const lockPath = join(directory, '.writer.lock');
  const replacement = await replaceLockWithSymlink(lockPath);
  await ledger.close();
  assert.equal((await lstat(lockPath)).isSymbolicLink(), true);
  assert.deepEqual(await readFile(lockPath), replacement);
});


test('service-store writer lock excludes a competing process and reopens after owner release', async t => {
  const dataDir = await temp(t);
  const owner = await startChildHoldingLock(t, {
    modulePath: 'game/service-store.mjs',
    openExpression: "mod.createServiceStore({ dataDir: process.env.NGL_TEST_DIR, initial: { revision: 0 }, validate })",
    env: { NGL_TEST_DIR: dataDir }
  });

  await assert.rejects(
    createServiceStore({ dataDir, initial: { revision: 0 }, validate }),
    error => error.code === 'SERVICE_LOCKED'
  );
  await owner.release();
  const reopened = await createServiceStore({ dataDir, initial: { revision: 0 }, validate });
  await reopened.close();
});

test('institutional ledger writer lock excludes a competing process and reopens after owner release', async t => {
  const directory = await temp(t);
  const owner = await startChildHoldingLock(t, {
    modulePath: 'src/institution/ledger.mjs',
    openExpression: "mod.openLedger({ directory: process.env.NGL_TEST_DIR, ...config })",
    env: { NGL_TEST_DIR: directory, NGL_TEST_CONFIG: JSON.stringify(config) }
  });

  await assert.rejects(
    openLedger({ directory, ...config }),
    error => error.code === 'LEDGER_LOCKED'
  );
  await owner.release();
  const reopened = await openLedger({ directory, ...config });
  await reopened.close();
});


test('decision-store writer lock excludes a competing process and reopens after owner release', async t => {
  const directory = await temp(t);
  const now = () => Date.parse('2026-10-27T00:00:00.000Z');
  const owner = await startChildHoldingLock(t, {
    modulePath: 'src/institution/decisions.mjs',
    openExpression: "mod.openDecisions({ directory: process.env.NGL_TEST_DIR, now: () => Date.parse('2026-10-27T00:00:00.000Z') })",
    env: { NGL_TEST_DIR: directory }
  });

  await assert.rejects(
    openDecisions({ directory, now }),
    error => error.code === 'DECISIONS_LOCKED'
  );
  await owner.release();
  const reopened = await openDecisions({ directory, now });
  await reopened.close();
});
