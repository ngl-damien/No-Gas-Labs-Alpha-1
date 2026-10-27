import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, open, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
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

test('rejects malformed UTF-8 in a persisted Founder key before service initialization', async t => {
  const dataDir = await directory(t);
  const path = join(dataDir, 'founder.key');
  await writeFile(path, Buffer.concat([Buffer.from(VALID_KEY, 'utf8'), Buffer.from([0xff])]), { mode: 0o600 });

  await assert.rejects(createGameServer({ dataDir }), /Founder key file is not valid UTF-8/);
  await assert.rejects(stat(join(dataDir, 'service.json')), { code: 'ENOENT' });
});

test('accepts the maximum supported persisted Founder key size', async t => {
  const dataDir = await directory(t);
  const path = join(dataDir, 'founder.key');
  await writeFile(path, 'k'.repeat(1024) + '\n', { mode: 0o600 });
  const server = await createGameServer({ dataDir });
  await server.closeGame();
});

test('rejects oversized persisted Founder keys before creating service state', async t => {
  const dataDir = await directory(t);
  const path = join(dataDir, 'founder.key');
  const handle = await open(path, 'w', 0o600);
  try {
    await handle.writeFile(VALID_KEY + '\n');
    await handle.truncate(1026);
  } finally {
    await handle.close();
  }

  await assert.rejects(createGameServer({ dataDir }), /Founder key file exceeds the 1025-byte limit/);
  await assert.rejects(stat(join(dataDir, 'service.json')), { code: 'ENOENT' });
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


test('unauthenticated session churn cannot evict a live Founder session', async t => {
  const dataDir = await directory(t);
  const server = await createGameServer({ dataDir });
  t.after(() => server.closeGame());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  const origin = `http://127.0.0.1:${server.address().port}`;
  const key = (await readFile(join(dataDir, 'founder.key'), 'utf8')).trim();
  const login = await fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ key })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
  assert.match(cookie || '', /^ngl_session=[A-Za-z0-9_-]{43}$/);

  // Node fetch does not persist Set-Cookie between requests here: each request
  // represents a new unauthenticated client trying to churn the bounded session map.
  let firstWitnessCookie = null;
  for (let index = 0; index < 520; index += 1) {
    const response = await fetch(`${origin}/api/state`);
    if (index < 511) {
      assert.equal(response.status, 200, `unauthenticated request ${index + 1}`);
      if (index === 0) firstWitnessCookie = response.headers.get('set-cookie')?.split(';', 1)[0] || null;
    } else {
      assert.equal(response.status, 429, `over-capacity request ${index + 1} must not evict a live session`);
    }
  }

  const founderState = await fetch(`${origin}/api/state`, { headers: { cookie } });
  assert.equal(founderState.status, 200);
  assert.equal((await founderState.json()).viewer.role, 'founder');
  assert.match(firstWitnessCookie || '', /^ngl_session=[A-Za-z0-9_-]{43}$/);
  const witnessState = await fetch(`${origin}/api/state`, { headers: { cookie: firstWitnessCookie } });
  assert.equal(witnessState.status, 200);
  assert.equal((await witnessState.json()).viewer.role, 'witness');

  // Invalid credentials cannot displace a live session even at capacity.
  const rejectedLogin = await fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ key: 'wrong-founder-key' })
  });
  assert.equal(rejectedLogin.status, 401);
  assert.equal(rejectedLogin.headers.get('set-cookie'), null);
  const witnessAfterRejectedLogin = await fetch(`${origin}/api/state`, { headers: { cookie: firstWitnessCookie } });
  assert.equal(witnessAfterRejectedLogin.status, 200);
  assert.equal((await witnessAfterRejectedLogin.json()).viewer.role, 'witness');

  // A valid Founder can still authenticate at capacity; only that successful
  // authorization may reclaim one Witness slot to keep the map bounded.
  const founderLoginAtCapacity = await fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ key })
  });
  assert.equal(founderLoginAtCapacity.status, 200);
  assert.equal((await founderLoginAtCapacity.json()).viewer.role, 'founder');
});


test('rejected cross-origin and malformed writes do not allocate sessions', async t => {
  const dataDir = await directory(t);
  const server = await createGameServer({ dataDir });
  t.after(() => server.closeGame());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const crossOrigin = await fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
    body: JSON.stringify({ key: VALID_KEY })
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.headers.get('set-cookie'), null, 'cross-origin rejection must not create a session');

  const malformed = await fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', origin },
    body: '{}'
  });
  assert.equal(malformed.status, 415);
  assert.equal(malformed.headers.get('set-cookie'), null, 'content-type rejection must not create a session');
});
