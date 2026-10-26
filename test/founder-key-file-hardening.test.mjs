import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../game/server.mjs';

const VALID_KEY = 'founder-key-fixture-that-is-long-enough-for-tests';

async function directory(t, prefix = 'ngl-founder-key-') {
  const path = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('rejects a symlink in place of the persisted Founder key', async t => {
  const dataDir = await directory(t);
  const target = join(dataDir, 'external-key');
  await writeFile(target, VALID_KEY + '\n', { mode: 0o600 });
  await symlink(target, join(dataDir, 'founder.key'));
  await assert.rejects(createGameServer({ dataDir }), /regular, non-symlink file/);
});

test('rejects persisted Founder keys readable by group or other users', async t => {
  const dataDir = await directory(t);
  const path = join(dataDir, 'founder.key');
  await writeFile(path, VALID_KEY + '\n', { mode: 0o600 });
  await chmod(path, 0o644);
  await assert.rejects(createGameServer({ dataDir }), /permissions must exclude group and other access/);
});

test('rejects a symlinked or non-private Founder data directory', async t => {
  const parent = await directory(t, 'ngl-founder-parent-');
  const target = await directory(t, 'ngl-founder-target-');
  const alias = join(parent, 'runtime-link');
  await symlink(target, alias, 'dir');
  await assert.rejects(createGameServer({ dataDir: alias }), /regular, non-symlink directory/);

  const publicDir = join(parent, 'public-runtime');
  await import('node:fs/promises').then(fs => fs.mkdir(publicDir, { mode: 0o700 }));
  await chmod(publicDir, 0o755);
  await assert.rejects(createGameServer({ dataDir: publicDir }), /directory permissions must exclude group and other access/);
});

test('generated Founder key is private and reused after restart', async t => {
  const dataDir = await directory(t);
  const first = await createGameServer({ dataDir });
  await first.closeGame();
  const path = join(dataDir, 'founder.key');
  const key1 = (await readFile(path, 'utf8')).trim();
  const metadata = await stat(path);
  assert.ok(key1.length >= 32);
  assert.equal(metadata.mode & 0o077, 0);

  const second = await createGameServer({ dataDir });
  t.after(() => second.closeGame());
  assert.equal((await readFile(path, 'utf8')).trim(), key1);
  await new Promise(resolve => second.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${second.address().port}`;
  const login = await fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ key: key1 })
  });
  assert.equal(login.status, 200, 'the generated key must still authenticate after restart');
});
