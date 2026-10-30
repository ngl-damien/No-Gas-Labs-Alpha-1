import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, writeFile, rm, rename, mkdir, symlink, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createGameServer } from '../game/server.mjs';
import { createWorld, applyAction } from '../game/model.mjs';
import { createLoginRateLimiter } from '../game/login-rate-limit.mjs';
import { artifactReceipt, canonicalStringify } from '../src/institution/kernel.mjs';

const KEY = 'test-founder-key-not-a-production-secret';
async function fixture(t, dataDir, options = {}) {
  dataDir ??= await mkdtemp(join(tmpdir(), 'ngl-http-'));
  const server = await createGameServer({ dataDir, founderKey: KEY, ...options });
  const game = { server, closeGame: () => server.closeGame() };
  await new Promise(resolve => game.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  t.after(async () => { await game.closeGame(); await rm(dataDir, { recursive: true, force: true }); });
  function client() {
    let cookie = '';
    return {
      get cookie() { return cookie; },
      async request(path, body, extra = {}) {
        const headers = { ...(cookie ? { cookie } : {}), ...extra.headers };
        if (body !== undefined) { headers['content-type'] = 'application/json'; headers.origin ??= url; }
        const response = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body), ...extra, headers });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const content = response.headers.get('content-type') || '';
        return { response, body: content.includes('json') ? await response.json() : await response.text() };
      },
      async login() { const r = await this.request('/api/login', { key: KEY, name: 'Damien' }); assert.equal(r.response.status, 200); return r.body; },
      async stream() {
        const controller = new AbortController();
        const response = await fetch(url + '/api/events', { headers: { cookie }, signal: controller.signal });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const reader = response.body.getReader(); let pending = '';
        return { close() { controller.abort(); }, async next(type) {
          for (;;) {
            const split = pending.indexOf('\n\n');
            if (split >= 0) {
              const block = pending.slice(0, split); pending = pending.slice(split + 2);
              const event = /^event: (.+)$/m.exec(block)?.[1];
              const data = /^data: (.+)$/m.exec(block)?.[1];
              if (data && (!type || event === type)) return JSON.parse(data);
            } else { const chunk = await reader.read(); if (chunk.done) throw new Error('SSE ended'); pending += new TextDecoder().decode(chunk.value); }
          }
        } };
      }
    };
  }
  return { ...game, dataDir, url, client };
}
async function publish(founder, title = 'Observed bytes') {
  const draft = await founder.request('/api/action', { type: 'draft', kind: 'custom', title, intent: 'Preserve exact locally authored bytes', html: '<!doctype html><html><body><button onclick="this.textContent=\'Done\'">Try</button></body></html>' });
  assert.equal(draft.response.status, 200, JSON.stringify(draft.body));
  const result = await founder.request('/api/action', { type: 'publish', draftId: draft.body.result.draftId, expectedVersion: 0 });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body;
}


test('PWA metadata and the offline shell are served without exposing API responses to the cache', async t => {
  const f = await fixture(t);
  const client = f.client();
  const manifest = await client.request('/manifest.webmanifest');
  assert.equal(manifest.response.status, 200);
  assert.ok(manifest.response.headers.get('content-type').includes('application/manifest+json'));
  assert.equal(manifest.body.start_url, './');
  assert.equal(manifest.body.display, 'standalone');
  assert.equal(manifest.body.icons[0].src, './assets/app-icon.svg');

  const worker = await client.request('/sw.js');
  assert.equal(worker.response.status, 200);
  assert.match(worker.response.headers.get('content-type'), /javascript/);
  assert.ok(worker.body.includes("url.pathname === '/api' || url.pathname.startsWith('/api/')"));
  assert.match(worker.body, /const CORE_SHELL =/);

  const icon = await client.request('/assets/app-icon.svg');
  assert.equal(icon.response.status, 200);
  assert.ok(icon.response.headers.get('content-type').includes('image/svg+xml'));
  assert.ok(icon.body.includes('<svg'));
});

test('IPv4-mapped socket addresses share the canonical IPv4 login bucket', () => {
  const limiter = createLoginRateLimiter({ maxFailures: 1, windowMs: 1000, lockoutMs: 1000 });
  limiter.failure('::ffff:192.0.2.44', 0);
  assert.throws(() => limiter.assertAllowed('192.0.2.44', 1), error =>
    error.code === 'LOGIN_RATE_LIMITED' && error.status === 429);
});

test('login limiter uses a rolling window and blocks a boundary-burst of failures', () => {
  const limiter = createLoginRateLimiter({ maxFailures: 5, windowMs: 100, lockoutMs: 100 });
  const peer = '192.0.2.44';
  limiter.assertAllowed(peer, 0); limiter.failure(peer, 0);
  for (const now of [80, 81, 82]) { limiter.assertAllowed(peer, now); limiter.failure(peer, now); }
  // The first failure has expired, but the next three are still within the last 100 ms.
  limiter.assertAllowed(peer, 101); limiter.failure(peer, 101);
  limiter.assertAllowed(peer, 102); limiter.failure(peer, 102);
  assert.throws(() => limiter.assertAllowed(peer, 103), error =>
    error.code === 'LOGIN_RATE_LIMITED' && error.status === 429);
});

test('invalid Founder login throttle configuration fails before creating runtime state', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-invalid-login-throttle-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await assert.rejects(
    createGameServer({ dataDir, founderKey: KEY, loginRateLimit: { maxFailures: 0 } }),
    /INVALID_LOGIN_RATE_LIMIT_CONFIG/
  );
  await assert.rejects(readFile(join(dataDir, 'founder.key')), error => error.code === 'ENOENT');
  await assert.rejects(readFile(join(dataDir, 'service.json')), error => error.code === 'ENOENT');
});

test('Founder login rate-limits repeated bad credentials by socket peer, not spoofable forwarding headers', async t => {
  const f = await fixture(t, undefined, { loginRateLimit: { maxFailures: 2, windowMs: 500, lockoutMs: 500 } });
  const client = f.client();
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const rejected = await client.request('/api/login', { key: 'wrong-key-' + attempt }, {
      headers: { 'x-forwarded-for': '198.51.100.' + attempt }
    });
    assert.equal(rejected.response.status, 401);
    assert.equal(rejected.response.headers.get('set-cookie'), null, 'failed login must not allocate a session');
  }
  const blocked = await client.request('/api/login', { key: KEY }, {
    headers: { 'x-forwarded-for': '203.0.113.44' }
  });
  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.body.error.code, 'LOGIN_RATE_LIMITED');
  assert.equal(blocked.response.headers.get('retry-after'), '1');
  assert.equal(blocked.response.headers.get('set-cookie'), null, 'rate-limited login must not allocate a session');
  await new Promise(resolve => setTimeout(resolve, 520));
  const unlocked = await client.request('/api/login', { key: KEY, name: 'Damien' });
  assert.equal(unlocked.response.status, 200, JSON.stringify(unlocked.body));
  assert.equal(unlocked.body.viewer.role, 'founder');
});

test('successful Founder authentication clears the prior failure budget', async t => {
  const f = await fixture(t, undefined, { loginRateLimit: { maxFailures: 2, windowMs: 5_000, lockoutMs: 1_000 } });
  const first = f.client();
  const rejected = await first.request('/api/login', { key: 'wrong-before-success' });
  assert.equal(rejected.response.status, 401);
  const founder = f.client();
  assert.equal((await founder.request('/api/login', { key: KEY, name: 'Damien' })).response.status, 200);
  const second = f.client();
  assert.equal((await second.request('/api/login', { key: 'wrong-after-success' })).response.status, 401);
  const third = f.client();
  assert.equal((await third.request('/api/login', { key: 'wrong-after-success-again' })).response.status, 401,
    'successful authentication must reset the prior failure count for this peer');
});

test('unknown sessions are Witness; role/reward injection, cross-origin and invalid bodies are rejected', async t => {
  const f = await fixture(t); const guest = f.client();
  assert.equal((await guest.request('/api/state')).body.viewer.role, 'witness');
  assert.equal((await guest.request('/api/action', { type: 'draft', role: 'founder', kind: 'comic', title: 'No', intent: 'No' })).response.status, 400);
  assert.equal((await guest.request('/api/login', { key: 'wrong' })).response.status, 401);
  assert.equal((await guest.request('/api/login', { key: KEY }, { headers: { origin: 'https://elsewhere.invalid' } })).response.status, 403);
  const founder = f.client(); await founder.login();
  assert.equal((await founder.request('/api/action', { type: 'discover', locationId: 'relay', xp: 999 })).response.status, 400);
  assert.equal((await founder.request('/api/action', { type: '__proto__' })).response.status, 400);
  assert.equal((await founder.request('/api/action', { type: 'draft', kind: 'custom', title: 'Too large', intent: 'bounds', html: 'x'.repeat(131073) })).response.status, 413);
  assert.equal((await founder.request('/api/action', { type: 'draft', kind: 'custom', title: 'oversize', intent: 'test', html: 'x'.repeat(270000) })).response.status, 413);
  const malformed = await fetch(f.url + '/api/action', { method: 'POST', headers: { origin: f.url, 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await guest.request('/api/launch', {})).response.status, 403);
});

test('draft privacy, exact publication bytes, stale version rejection and real institution records', async t => {
  const f = await fixture(t); const founder = f.client(); const witness = f.client(); await founder.login();
  const draft = await founder.request('/api/action', { type: 'draft', kind: 'comic', title: 'Private title', intent: 'Private intent' });
  assert.equal(draft.response.status, 200);
  const guestState = (await witness.request('/api/state')).body;
  assert.equal(JSON.stringify(guestState).includes('Private title'), false);
  assert.equal((await witness.request('/api/export')).body.world.drafts?.length || 0, 0);
  const published = await founder.request('/api/action', { type: 'publish', draftId: draft.body.result.draftId, expectedVersion: 0 });
  assert.equal(published.response.status, 200, JSON.stringify(published.body));
  const creation = published.body.world.creations[0];
  assert.equal(published.body.world.xp, 100);
  assert.equal((await founder.request('/api/action', { type: 'publish', draftId: draft.body.result.draftId, expectedVersion: 0 })).response.status, 409);
  const artifact = await witness.request(`/api/artifacts/${creation.id}?version=1`);
  assert.equal(artifact.body, creation.html);
  assert.match(artifact.response.headers.get('content-security-policy'), /sandbox allow-scripts allow-forms allow-downloads/);
  assert.doesNotMatch(artifact.response.headers.get('content-security-policy'), /allow-same-origin/);
  assert.match(artifact.response.headers.get('content-security-policy'), /frame-src 'self' about:/);
  assert.equal((await witness.request('/assets/comic/p3.jpg')).response.headers.get('cross-origin-resource-policy'), 'cross-origin');
  const institution = (await witness.request('/api/institution')).body;
  assert.equal(institution.kernel.accepted.length, 1);
  assert.equal(institution.kernel.accepted[0].action, 'preserve-artifact-bytes');
  assert.equal(institution.capabilities.externalProviders.configured, false);
  assert.equal(JSON.stringify(institution).includes(KEY), false);
});

test('SSE filters drafts per viewer and logout/login rotation demotes an existing stream', async t => {
  const f = await fixture(t); const founder = f.client(); const witness = f.client(); await founder.login();
  const fs = await founder.stream(); const ws = await witness.stream(); t.after(() => { fs.close(); ws.close(); });
  assert.equal((await fs.next('world')).viewer.role, 'founder'); await ws.next('world');
  await founder.request('/api/action', { type: 'draft', kind: 'comic', title: 'SSE private', intent: 'Only Founder' });
  assert.equal((await fs.next('world')).world.drafts.length, 1);
  assert.equal(JSON.stringify(await ws.next('world')).includes('SSE private'), false);
  const oldCookie = founder.cookie;
  await founder.request('/api/logout', {});
  assert.equal((await fs.next('world')).viewer.role, 'witness');
  const old = await fetch(f.url + '/api/state', { headers: { cookie: oldCookie } });
  assert.equal((await old.json()).viewer.role, 'witness');
  await founder.login(); const rotated = await founder.stream(); t.after(() => rotated.close());
  assert.equal((await rotated.next('world')).viewer.role, 'founder');
  await founder.login();
  assert.equal((await rotated.next('world')).viewer.role, 'witness');
});

test('presence is bounded, belongs to real connected sessions, and clears on disconnect', async t => {
  const f = await fixture(t); const one = f.client(); const two = f.client();
  await one.request('/api/state'); await two.request('/api/state');
  const stream = await one.stream(); await stream.next('world');
  assert.equal((await one.request('/api/presence', { x: -1, y: 100 })).response.status, 400);
  assert.equal((await one.request('/api/presence', { x: 300, y: 500, name: 'Real session' })).response.status, 200);
  const otherState = (await two.request('/api/state')).body; assert.equal(otherState.presence.length, 1);
  const selfState = (await one.request('/api/state')).body; assert.equal(selfState.presence[0].id, selfState.viewer.presenceId);
  stream.close();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await two.request('/api/state')).body.presence.length, 0);
});

test('Founder data directory requires owner access and excludes group/other access', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-private-data-dir-'));
  t.after(async () => {
    await chmod(dataDir, 0o700).catch(() => {});
    await rm(dataDir, { recursive: true, force: true });
  });

  await chmod(dataDir, 0o500);
  await assert.rejects(
    createGameServer({ dataDir, founderKey: KEY }),
    /owner permissions must include read, write and execute/
  );
  await assert.rejects(readFile(join(dataDir, 'founder.key')), { code: 'ENOENT' },
    'unsafe owner mode must be rejected before any Founder key is created');

  await chmod(dataDir, 0o755);
  await assert.rejects(
    createGameServer({ dataDir, founderKey: KEY }),
    /permissions must exclude group and other access/
  );
  await assert.rejects(readFile(join(dataDir, 'founder.key')), { code: 'ENOENT' },
    'group/other access must be rejected before any Founder key is created');
});

test('Founder data directory rejects symlinked ancestors before creating runtime state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ngl-symlink-parent-'));
  const realParent = join(root, 'real-parent');
  const alias = join(root, 'alias');
  await mkdir(realParent, { mode: 0o700 });
  await symlink(realParent, alias, 'dir');
  const dataDir = join(alias, 'runtime');
  t.after(async () => { await rm(root, { recursive: true, force: true }); });

  await assert.rejects(
    createGameServer({ dataDir, founderKey: KEY }),
    /symbolic link components/
  );
  await assert.rejects(
    lstat(join(realParent, 'runtime')),
    { code: 'ENOENT' },
    'the runtime directory must not be created through a symlinked ancestor'
  );
});

test('published world and accepted kernel history survive restart; generated key stays private', async t => {
  const f = await fixture(t); const founder = f.client(); await founder.login(); const result = await publish(founder);
  await f.closeGame();
  const restarted = await createGameServer({ dataDir: f.dataDir, founderKey: KEY }); t.after(() => restarted.closeGame());
  await new Promise(resolve => restarted.listen(0, '127.0.0.1', resolve));
  const response = await fetch(`http://127.0.0.1:${restarted.address().port}/api/state`); const state = await response.json();
  assert.equal(state.world.creations[0].id, result.result.creationId);
  assert.equal(state.institution.kernel.accepted.length, 1);
  const secretDir = await mkdtemp(join(tmpdir(), 'ngl-key-')); const generated = await createGameServer({ dataDir: secretDir });
  t.after(async () => { await generated.closeGame(); await rm(secretDir, { recursive: true, force: true }); });
  const secret = (await readFile(join(secretDir, 'founder.key'), 'utf8')).trim(); assert.ok(secret.length >= 32);
  await new Promise(resolve => generated.listen(0, '127.0.0.1', resolve));
  const exported = await fetch(`http://127.0.0.1:${generated.address().port}/api/export`);
  assert.equal((await exported.text()).includes(secret), false);
});

test('failed atomic persistence adopts neither world nor institutional acceptance', async t => {
  const f = await fixture(t); const founder = f.client(); await founder.login();
  const draft = await founder.request('/api/action', { type: 'draft', kind: 'comic', title: 'Atomic', intent: 'Only adopt on disk success' });
  const file = join(f.dataDir, 'service.json'); await rename(file, file + '.saved'); await mkdir(file);
  const rejected = await founder.request('/api/action', { type: 'publish', draftId: draft.body.result.draftId, expectedVersion: 0 });
  assert.equal(rejected.response.status, 503);
  const current = (await founder.request('/api/state')).body;
  assert.equal(current.world.creations.length, 0); assert.equal(current.institution.kernel.accepted.length, 0);
  await rm(file, { recursive: true }); await rename(file + '.saved', file);
  assert.equal((await founder.request('/api/action', { type: 'publish', draftId: draft.body.result.draftId, expectedVersion: 0 })).response.status, 200);
});

test('serves every first-party module imported by the playable game client', async t => {
  const f = await fixture(t); const client = f.client();
  const source = await client.request('/client.mjs');
  assert.equal(source.response.status, 200);
  assert.match(source.response.headers.get('content-type') || '', /^text\/javascript/);
  for (const module of ['model', 'quests', 'character-sheet', 'player-position', 'world-view', 'launchpad', 'institution-view', 'contradiction-clerk']) {
    assert.match(source.body, new RegExp(`from ['"]\\./${module}\\.mjs['"]`), `client import: ${module}`);
  }
  const institutionView = await client.request('/institution-view.mjs');
  assert.match(institutionView.body, /from ['\"]\.\/chronicle\.mjs['\"]/, 'institution view imports the read-only chronicle');
  for (const module of ['client', 'quests', 'character-sheet', 'player-position', 'world-view', 'model', 'artifacts', 'launchpad', 'institution-view', 'contradiction-clerk', 'chronicle']) {
    const response = await client.request(`/${module}.mjs`);
    assert.equal(response.response.status, 200, `/${module}.mjs must be served`);
    assert.match(response.response.headers.get('content-type') || '', /^text\/javascript/);
    assert.ok(response.body.length > 0, `/${module}.mjs must not be empty`);
  }
});

test('stored history tampering fails closed and static routes never serve source, keys or traversal', async t => {
  const f = await fixture(t); const founder = f.client(); await founder.login(); await publish(founder);
  for (const path of ['/server.mjs', '/game/server.mjs', '/service-store.mjs', '/.runtime/founder.key', '/.git/config', '/assets/comic/../../server.mjs', '/%2e%2e/.git/config']) {
    assert.equal((await founder.request(path)).response.status, 404, path);
  }
  await f.closeGame(); const file = join(f.dataDir, 'service.json'); const stored = JSON.parse(await readFile(file, 'utf8'));
  stored.payload.world.creations[0].html += '<p>tampered</p>';
  await writeFile(file, JSON.stringify(stored));
  await assert.rejects(createGameServer({ dataDir: f.dataDir, founderKey: KEY }), /integrity|receipt|digest|corrupt|tamper/i);
});


test('concurrent publication accepts once; repairs retain artifact history and launch checks pack actual assets without XP', async t => {
  const f = await fixture(t); const founder = f.client(); const witness = f.client(); await founder.login();
  const draft = await founder.request('/api/action', { type: 'draft', kind: 'comic', title: 'Versioned artwork', intent: 'Real local asset bytes' });
  const action = { type: 'publish', draftId: draft.body.result.draftId, expectedVersion: 0 };
  const attempts = await Promise.all([founder.request('/api/action', action), founder.request('/api/action', action)]);
  assert.deepEqual(attempts.map(r => r.response.status).sort(), [200, 409]);
  const first = attempts.find(r => r.response.status === 200).body.world.creations[0];
  const note = await witness.request('/api/action', { type: 'contribute', creationId: first.id, version: 1, text: '𓂀 café <script>京都 🐚' });
  assert.equal(note.response.status, 200); assert.equal(note.body.world.xp, 100);
  const repair = await founder.request('/api/action', { type: 'repair', creationId: first.id, expectedVersion: 1, intent: 'Version two' });
  const second = await founder.request('/api/action', { type: 'publish', draftId: repair.body.result.draftId, expectedVersion: 1 });
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.world.creations[0].versions[0].html, first.html);
  assert.equal(second.body.institution.kernel.accepted.length, 2);
  assert.equal(second.body.world.methods.length, 1); assert.equal(second.body.world.methods[0].version, 2);
  assert.equal((await witness.request(`/api/artifacts/${first.id}?version=1`)).body, first.html);
  const launch = await founder.request('/api/launch', {});
  assert.equal(launch.response.status, 200, JSON.stringify(launch.body)); assert.equal(launch.body.ready, true);
  assert.match(launch.body.exhibit[0].html, /data:image\/jpeg;base64,/);
  assert.equal((await founder.request('/api/state')).body.world.xp, 200);
  await f.closeGame();
  const file = join(f.dataDir, 'service.json'), valid = JSON.parse(await readFile(file, 'utf8'));
  const next = await createGameServer({ dataDir: f.dataDir, founderKey: KEY }); await next.closeGame();
  for (const corrupt of [payload => { payload.world.methods[0].version = 1; }, payload => { payload.world.methods[0].actor.role = 'witness'; }, payload => { payload.world.methods[0].description = 'fabricated independent truth'; }]) {
    const changed = structuredClone(valid); corrupt(changed.payload); changed.digest = artifactReceipt(canonicalStringify(changed.payload)).digest; await writeFile(file, JSON.stringify(changed));
    await assert.rejects(createGameServer({ dataDir: f.dataDir, founderKey: KEY }));
  }
});

test('recomputed envelope checksums cannot conceal version, retained-byte or actor-history tampering', async t => {
  const f = await fixture(t); const founder = f.client(); await founder.login(); await publish(founder); await f.closeGame();
  const file = join(f.dataDir, 'service.json'); const original = JSON.parse(await readFile(file, 'utf8'));
  for (const corrupt of [
    payload => { payload.publicationBindings[0].version = 2; },
    payload => { payload.institutionalEvents[3].actor = 'local-forge'; },
    payload => { payload.world.events[0].actor.id = 'pretend-founder'; },
    payload => { payload.world.events[0].type = 'fabricated-execution'; },
    payload => { payload.world.events[1].at = new Date(0).toISOString(); }
  ]) {
    const changed = structuredClone(original); corrupt(changed.payload); changed.digest = artifactReceipt(canonicalStringify(changed.payload)).digest;
    await writeFile(file, JSON.stringify(changed));
    await assert.rejects(createGameServer({ dataDir: f.dataDir, founderKey: KEY }));
  }
});


test('an exclusive store lease rejects a second writer and is released by closeGame', async t => {
  const f = await fixture(t); const founder = f.client(); await founder.login(); await publish(founder);
  await assert.rejects(createGameServer({ dataDir: f.dataDir, founderKey: KEY }), /exclusive|lock|writer/i);
  await f.closeGame();
  const next = await createGameServer({ dataDir: f.dataDir, founderKey: KEY }); t.after(() => next.closeGame());
  await new Promise(resolve => next.listen(0, '127.0.0.1', resolve));
  const state = await (await fetch(`http://127.0.0.1:${next.address().port}/api/state`)).json();
  assert.equal(state.world.creations.length, 1); assert.equal(state.institution.kernel.accepted.length, 1);
});


test('the direct CLI starts the HTTP service and releases its exclusive writer lease on SIGTERM without logging secrets', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-cli-'));
  const child = spawn(process.execPath, ['game/server.mjs'], { cwd: new URL('../', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: '0', NGL_DATA_DIR: dataDir, NGL_FOUNDER_KEY: KEY }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } await rm(dataDir, { recursive: true, force: true }); });
  const port = await new Promise((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error('CLI did not become ready')), 5000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', () => { clearTimeout(timer); reject(new Error('CLI exited before readiness')); });
    child.stdout.on('data', chunk => { output += chunk; const match = /listening on 127\.0\.0\.1:(\d+)/.exec(output); if (match) { clearTimeout(timer); resolvePort(Number(match[1])); } });
  });
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/state`)).json()).viewer.role, 'witness');
  assert.equal(output.includes(KEY), false);
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
  const reopened = await createGameServer({ dataDir, founderKey: KEY }); await reopened.closeGame();
});


test('the host CSP permits authored srcdoc instrument scripts while its iframe remains opaque', async t => {
  const f = await fixture(t); const guest = f.client(); const page = await guest.request('/');
  assert.equal(page.response.status, 200);
  const csp = page.response.headers.get('content-security-policy');
  const scriptPolicy = csp.split(';').find(directive => directive.trim().startsWith('script-src '));
  assert.match(scriptPolicy, /'unsafe-inline'/, 'srcdoc inherits the host CSP, so authored inline instrument code needs this permission');
  const sandbox = /<iframe[^>]*id="artifact-frame"[^>]*sandbox="([^"]+)"/.exec(page.body)?.[1];
  assert.ok(sandbox?.includes('allow-scripts')); assert.ok(!sandbox?.includes('allow-same-origin'));
});

test('concurrent retries with the same request ID commit one shared action', async t => {
  const f = await fixture(t); const founder = f.client(); await founder.login();
  const published = await publish(founder, 'Concurrent retry target');
  const creation = published.world.creations[0];
  const action = { type: 'report', creationId: creation.id, version: 1, text: 'Concurrent identical requests must be applied once.' };
  const requestId = 'concurrent-report-001';
  const [left, right] = await Promise.all([
    founder.request('/api/action', { ...action, requestId }),
    founder.request('/api/action', { ...action, requestId })
  ]);
  assert.equal(left.response.status, 200, JSON.stringify(left.body));
  assert.equal(right.response.status, 200, JSON.stringify(right.body));
  assert.equal(left.body.result.id, right.body.result.id);
  assert.deepEqual([left.body.idempotentReplay, right.body.idempotentReplay].sort(), [false, true]);
  assert.equal(left.body.world.revision, right.body.world.revision);
  assert.equal(left.body.world.reports.filter(report => report.text === action.text).length, 1);
  const finalState = await founder.request('/api/state');
  assert.equal(finalState.body.world.reports.filter(report => report.text === action.text).length, 1);
  assert.equal(finalState.body.world.revision, published.world.revision + 1);
});

test('an idempotency receipt cannot be replayed by a different Witness actor', async t => {
  const f = await fixture(t); const founder = f.client(); await founder.login();
  const published = await publish(founder, 'Actor-bound retry target');
  const creation = published.world.creations[0];
  const firstWitness = f.client(), secondWitness = f.client();
  const firstState = await firstWitness.request('/api/state');
  const secondState = await secondWitness.request('/api/state');
  assert.equal(firstState.body.viewer.role, 'witness');
  assert.equal(secondState.body.viewer.role, 'witness');
  assert.notEqual(firstState.body.viewer.id, secondState.body.viewer.id);
  const action = { type: 'report', creationId: creation.id, version: 1, text: 'This report belongs to one session.' };
  const requestId = 'actor-bound-report-001';
  const first = await firstWitness.request('/api/action', { ...action, requestId });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  const replay = await secondWitness.request('/api/action', { ...action, requestId });
  assert.equal(replay.response.status, 409);
  assert.equal(replay.body.error.code, 'IDEMPOTENCY_CONFLICT');
  const state = await secondWitness.request('/api/state');
  assert.equal(state.body.world.reports.filter(report => report.text === action.text).length, 1);
  assert.equal(state.body.world.events.filter(event => event.requestId === requestId).length, 1);
});

test('shared action request IDs replay the original result across lost responses and service restart', async t => {
  const f = await fixture(t); const founder = f.client(); await founder.login();
  const published = await publish(founder, 'Idempotent report target');
  const creation = published.world.creations[0];
  const action = { type: 'report', creationId: creation.id, version: 1, text: 'The observed outcome is still uncertain.' };
  const requestId = 'retry-report-001';
  const first = await founder.request('/api/action', { ...action, requestId });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.idempotentReplay, false);
  const revision = first.body.world.revision;
  const reportId = first.body.result.id;
  assert.equal(first.body.world.reports.filter(report => report.text === action.text).length, 1);

  const replay = await founder.request('/api/action', { ...action, requestId });
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(replay.body.result.id, reportId);
  assert.equal(replay.body.world.revision, revision);
  assert.equal(replay.body.world.reports.filter(report => report.text === action.text).length, 1);

  const conflict = await founder.request('/api/action', { ...action, text: 'Different payload, same request ID.', requestId });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
  await f.closeGame();

  const reopened = await createGameServer({ dataDir: f.dataDir, founderKey: KEY });
  try {
    await new Promise(resolve => reopened.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${reopened.address().port}`;
    let cookie = '';
    async function request(path, body) {
      const headers = { ...(cookie ? { cookie } : {}) };
      if (body !== undefined) { headers['content-type'] = 'application/json'; headers.origin = url; }
      const response = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return { response, body: await response.json() };
    }
    const login = await request('/api/login', { key: KEY, name: 'Damien' });
    assert.equal(login.response.status, 200);
    const afterRestart = await request('/api/action', { ...action, requestId });
    assert.equal(afterRestart.response.status, 200, JSON.stringify(afterRestart.body));
    assert.equal(afterRestart.body.idempotentReplay, true);
    assert.equal(afterRestart.body.result.id, reportId);
    assert.equal(afterRestart.body.world.reports.filter(report => report.text === action.text).length, 1);
  } finally {
    await reopened.closeGame();
  }
});


test('unknown API routes are rejected before session allocation', async t => {
  const f = await fixture(t);
  for (const path of ['/api/not-a-route', '/api/artifacts/not-a-creation-id']) {
    const response = await fetch(f.url + path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('set-cookie'), null, path + ' must not mint a session cookie');
    await response.text();
  }
  const unsupportedPost = await fetch(f.url + '/api/not-a-route', {
    method: 'POST',
    headers: { origin: f.url, 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(unsupportedPost.status, 404);
  assert.equal(unsupportedPost.headers.get('set-cookie'), null, 'unsupported POST must not mint a session cookie');
  await unsupportedPost.text();

  const supported = await fetch(f.url + '/api/state');
  assert.equal(supported.status, 200);
  assert.match(supported.headers.get('set-cookie') || '', /^ngl_session=/, 'supported state route still creates a session');
  await supported.text();
});


test('public catalog, institution summary, and retained artifacts do not allocate sessions', async t => {
  const f = await fixture(t);
  for (const path of ['/api/projects', '/api/institution']) {
    const response = await fetch(f.url + path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('set-cookie'), null, path + ' is public and must not mint a session');
    await response.text();
  }

  const founder = f.client();
  await founder.login();
  const published = await publish(founder, 'Public artifact route');
  const artifact = await fetch(f.url + '/api/artifacts/' + published.result.creationId + '?version=1');
  assert.equal(artifact.status, 200);
  assert.equal(artifact.headers.get('set-cookie'), null, 'public artifact reads must not mint a session');
  assert.match(artifact.headers.get('content-security-policy') || '', /sandbox allow-scripts/);
  await artifact.text();
});


test('event-stream capacity rejection happens before a new session is allocated', async t => {
  const f = await fixture(t);
  const agent = new http.Agent({ keepAlive: false, maxSockets: 140 });
  const active = [];
  function openStream() {
    return new Promise((resolve, reject) => {
      let request;
      request = http.get(f.url + '/api/events', { agent }, response => {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          response,
          close() { response.destroy(); request.destroy(); }
        });
      });
      request.on('error', reject);
    });
  }

  try {
    for (let i = 0; i < 128; i++) {
      const stream = await openStream();
      assert.equal(stream.status, 200, 'each slot below the cap should be accepted');
      active.push(stream);
    }
    const overflow = await openStream();
    assert.equal(overflow.status, 429);
    assert.equal(overflow.headers['set-cookie'], undefined, 'rejected stream must not allocate a session cookie');
    overflow.response.resume();
    await once(overflow.response, 'end');
  } finally {
    for (const stream of active) stream.close();
    agent.destroy();
  }
});

test('Founder-only routes reject missing or Witness sessions without allocating sessions', async t => {
  const f = await fixture(t);
  const founderOnly = [
    ['/api/launch', {}],
    ['/api/decisions/policy', {}],
    ['/api/decisions/proposals', {}],
    ['/api/decisions/choose', {}],
    ['/api/action', { type: 'draft', kind: 'comic', title: 'Denied draft', intent: 'Must not allocate a session' }],
    ['/api/action', { type: 'publish', draftId: 'draft-1', expectedVersion: 0 }],
    ['/api/action', { type: 'repair', creationId: 'creation-1', expectedVersion: 1 }]
  ];

  for (const [path, payload] of founderOnly) {
    const response = await fetch(f.url + path, {
      method: 'POST',
      headers: { origin: f.url, 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.equal(response.status, 403, path);
    assert.equal(response.headers.get('set-cookie'), null, path + ' must not allocate a denied Witness session');
    await response.text();
  }

  const witness = f.client();
  await witness.request('/api/state');
  const originalCookie = witness.cookie;
  assert.match(originalCookie, /^ngl_session=/);

  for (const [path, payload] of founderOnly) {
    const denied = await witness.request(path, payload);
    assert.equal(denied.response.status, 403, path);
    assert.equal(denied.response.headers.get('set-cookie'), null, path + ' must not replace the existing Witness cookie');
    assert.equal(witness.cookie, originalCookie, path + ' must preserve the existing Witness session');
  }

  const stillWitness = await witness.request('/api/state');
  assert.equal(stillWitness.response.status, 200);
  assert.equal(stillWitness.body.viewer.role, 'witness');
});

test('malformed supported actions fail before allocating a session', async t => {
  const f = await fixture(t);
  const invalid = [
    { payload: null, status: 400 },
    { payload: {}, status: 400 },
    { payload: [], status: 400 },
    { payload: { type: 'not-an-action' }, status: 400 },
    { payload: { type: 'discover', locationId: 'relay', xp: 999 }, status: 400 },
    { payload: { type: 'discover' }, status: 400 },
    { payload: { type: 'discover', locationId: 'not-on-map' }, status: 400 },
    { payload: { type: 'discover', locationId: 'relay', requestId: ' bad' }, status: 400 },
    { payload: { type: 'draft', kind: 'custom', title: '', intent: 'missing title' }, status: 400 },
    { payload: { type: 'draft', kind: 'unknown', title: 'Valid title', intent: '' }, status: 400 },
    { payload: { type: 'draft', kind: 'custom', title: 'Valid title', intent: '', html: 'x'.repeat(131073) }, status: 413 },
    { payload: { type: 'publish', draftId: 'draft-missing' }, status: 400 },
    { payload: { type: 'repair', creationId: 'creation-missing', expectedVersion: 0 }, status: 400 },
    { payload: { type: 'contribute', creationId: 'creation-missing', version: 0, text: 'note' }, status: 400 },
    { payload: { type: 'report', creationId: 'creation-missing', version: 1, text: 'x'.repeat(1001) }, status: 413 }
  ];
  for (const { payload, status } of invalid) {
    const response = await fetch(f.url + '/api/action', {
      method: 'POST',
      headers: { origin: f.url, 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.equal(response.status, status, JSON.stringify(payload).slice(0, 120));
    assert.equal(response.headers.get('set-cookie'), null, 'invalid action must not allocate a session');
    await response.text();
  }
});

test('invalid presence and logout payloads fail before allocating a session', async t => {
  const f = await fixture(t);
  const invalidPresence = [
    { x: -1, y: 0 },
    { x: 0, y: 1001 },
    { x: '0', y: 1 },
    { x: 0, y: 1, extra: true },
    { x: 0, y: 1, name: 'n'.repeat(81) }
  ];
  for (const payload of invalidPresence) {
    const response = await fetch(f.url + '/api/presence', {
      method: 'POST',
      headers: { origin: f.url, 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.equal(response.status, 400, JSON.stringify(payload).slice(0, 120));
    assert.equal(response.headers.get('set-cookie'), null, 'invalid presence must not allocate a session');
    await response.text();
  }

  const logout = await fetch(f.url + '/api/logout', {
    method: 'POST',
    headers: { origin: f.url, 'content-type': 'application/json' },
    body: JSON.stringify({ unexpected: true })
  });
  assert.equal(logout.status, 400);
  assert.equal(logout.headers.get('set-cookie'), null, 'malformed logout must not allocate a session');
  await logout.text();
});

test('an authenticated Founder retains access to the launch rehearsal after route preflight', async t => {
  const f = await fixture(t);
  const founder = f.client();
  await founder.login();
  const result = await founder.request('/api/launch', {
    title: 'Authorized local rehearsal',
    tagline: 'Test-only; no external publication'
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(typeof result.body, 'object');
  assert.equal(result.body?.title, 'Authorized local rehearsal');
});

test('HTTP JSON rejects malformed UTF-8, duplicate keys, and excessive nesting before session allocation', async t => {
  const f = await fixture(t);
  const escapedDuplicate = '{"key":"wrong","\\u006bey":"' + KEY + '","name":"Damien"}';
  const duplicateCredential = '{"key":"wrong","key":"' + KEY + '","name":"Damien"}';
  const malformedUtf8 = Buffer.concat([
    Buffer.from('{"key":"'),
    Buffer.from([0xff]),
    Buffer.from('"}')
  ]);
  const deeplyNested = '{"key":"wrong","extra":' + '['.repeat(130) + '0' + ']'.repeat(130) + '}';
  const invalidBodies = [
    ['duplicate credential key', Buffer.from(duplicateCredential)],
    ['escaped duplicate credential key', Buffer.from(escapedDuplicate)],
    ['malformed UTF-8', malformedUtf8],
    ['excessive nesting', Buffer.from(deeplyNested)]
  ];

  for (const [label, bytes] of invalidBodies) {
    const response = await fetch(f.url + '/api/login', {
      method: 'POST',
      headers: { origin: f.url, 'content-type': 'application/json' },
      body: bytes
    });
    assert.equal(response.status, 400, label);
    assert.equal(response.headers.get('set-cookie'), null, label + ' must not allocate a session');
    const payload = await response.json();
    assert.equal(payload.error.code, 'INVALID_JSON', label);
  }
});



test('Moonshot Field retains a bounded proposal and exact retry without duplicate world effects', async t => {
  const f = await fixture(t);
  const founder = f.client();
  await founder.login();
  const published = await publish(founder, 'Moonshot source artifact');
  const witness = f.client();
  const action = {
    type: 'propose-moonshot',
    title: 'Does the source claim survive?',
    hypothesis: 'The claim holds under its stated conditions.',
    falsifier: 'A reproducible counterexample appears.',
    evidenceNeeded: 'Independent observation and the retained source bytes.',
    sourceCreationId: published.result.creationId,
    sourceVersion: 1,
    requestId: 'moonshot-proposal-retry-001'
  };

  const first = await witness.request('/api/action', action);
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.idempotentReplay, false);
  const retry = await witness.request('/api/action', action);
  assert.equal(retry.response.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.idempotentReplay, true);
  assert.equal(retry.body.result.moonshotId, first.body.result.moonshotId);

  const state = await founder.request('/api/state');
  const proposals = state.body.world.events.filter(event => event.type === 'moonshot-proposed');
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].actor.role, 'witness');
  assert.equal(proposals[0].sourceCreationId, published.result.creationId);
  assert.equal(proposals[0].sourceVersion, 1);
  assert.equal(state.body.world.xp, published.world.xp);
  assert.equal(proposals[0].outcome, undefined);
  assert.equal(proposals[0].status, undefined);

  const stale = await witness.request('/api/action', {
    ...action,
    title: 'A stale-source proposal',
    sourceVersion: 99,
    requestId: 'moonshot-proposal-stale-001'
  });
  assert.equal(stale.response.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.error.code, 'STALE_VERSION');
  const afterStale = await founder.request('/api/state');
  assert.equal(afterStale.body.world.events.filter(event => event.type === 'moonshot-proposed').length, 1);
});

test('Moonshot experiment reports are replay-safe and remain self-reported claims', async t => {
  const f = await fixture(t);
  const founder = f.client();
  await founder.login();
  const published = await publish(founder, 'Experiment evidence artifact');
  const witness = f.client();
  const proposalResponse = await witness.request('/api/action', {
    type: 'propose-moonshot',
    title: 'Does the claim survive?',
    hypothesis: 'The claim holds under the stated condition.',
    falsifier: 'A reproducible counterexample appears.',
    evidenceNeeded: 'The exact retained artifact and an independent observation.',
    sourceCreationId: published.result.creationId,
    sourceVersion: 1,
    requestId: 'experiment-proposal-001'
  });
  assert.equal(proposalResponse.response.status, 200, JSON.stringify(proposalResponse.body));
  const action = {
    type: 'report-experiment',
    moonshotId: proposalResponse.body.result.moonshotId,
    procedure: 'Repeat the stated comparison under the documented condition.',
    observation: 'The attempt failed before a usable measurement was produced.',
    reportedOutcome: 'failed',
    evidenceCreationId: published.result.creationId,
    evidenceVersion: 1,
    requestId: 'experiment-report-retry-001'
  };
  const first = await witness.request('/api/action', action);
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.idempotentReplay, false);
  const retry = await witness.request('/api/action', action);
  assert.equal(retry.response.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.idempotentReplay, true);
  assert.equal(retry.body.result.reportId, first.body.result.reportId);

  const state = await founder.request('/api/state');
  const reports = state.body.world.events.filter(event => event.type === 'experiment-reported');
  assert.equal(reports.length, 1);
  assert.equal(reports[0].actor.role, 'witness');
  assert.equal(reports[0].reportedOutcome, 'failed');
  assert.equal(reports[0].outcome, undefined);
  assert.equal(reports[0].status, undefined);
  assert.equal(reports[0].evidenceCreationId, published.result.creationId);
  assert.equal(state.body.world.xp, published.world.xp);

  const invalid = await witness.request('/api/action', {
    ...action, reportedOutcome: 'verified', requestId: 'experiment-report-invalid-outcome'
  });
  assert.equal(invalid.response.status, 400, JSON.stringify(invalid.body));
  assert.equal(invalid.body.error.code, 'INVALID_OUTCOME');
  const afterInvalid = await founder.request('/api/state');
  assert.equal(afterInvalid.body.world.events.filter(event => event.type === 'experiment-reported').length, 1);
});


test('server startup rejects a persisted event history that moves backward in real time across offset timestamps', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-offset-chronology-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const witness = { id: 'witness-1', name: 'Witness', role: 'witness' };
  const start = createWorld({ id: 'offset-history-world', now: '2026-10-27T00:00:00.000Z' });
  const first = await applyAction(start, { type: 'discover', locationId: 'river' }, witness, { now: '2026-10-27T00:00:01.000Z' });
  const second = await applyAction(first.world, { type: 'discover', locationId: 'river' }, witness, { now: '2026-10-27T00:00:02.000Z' });
  const world = structuredClone(second.world);
  world.events[0].at = '2026-10-27T00:30:00-02:00';
  world.discoveries[0].at = world.events[0].at;
  world.events[1].at = '2026-10-27T01:00:00.000Z';
  world.updatedAt = world.events[1].at;
  const payload = { world, institutionalEvents: [], artifacts: {}, publicationBindings: [] };
  const envelope = {
    schema: 'ngl.service-store.v1',
    payload,
    digest: artifactReceipt(canonicalStringify(payload)).digest
  };
  await writeFile(join(dataDir, 'service.json'), canonicalStringify(envelope), { mode: 0o600 });

  await assert.rejects(
    createGameServer({ dataDir, founderKey: KEY }),
    error => error.code === 'INVALID_WORLD' || /World history authority \/ time mismatch/.test(error.message)
  );
});


test('server startup rejects persisted date-only timestamps even when parsed chronology is monotonic', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-loose-chronology-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const witness = { id: 'witness-1', name: 'Witness', role: 'witness' };
  const start = createWorld({ id: 'loose-history-world', now: '2026-10-27T00:00:00.000Z' });
  const first = await applyAction(start, { type: 'discover', locationId: 'river' }, witness, { now: '2026-10-27T00:00:01.000Z' });
  const world = structuredClone(first.world);
  world.events[0].at = '2026-10-28';
  world.discoveries[0].at = world.events[0].at;
  world.updatedAt = world.events[0].at;
  const payload = { world, institutionalEvents: [], artifacts: {}, publicationBindings: [] };
  const envelope = {
    schema: 'ngl.service-store.v1',
    payload,
    digest: artifactReceipt(canonicalStringify(payload)).digest
  };
  await writeFile(join(dataDir, 'service.json'), canonicalStringify(envelope), { mode: 0o600 });

  await assert.rejects(
    createGameServer({ dataDir, founderKey: KEY }),
    error => error.code === 'INVALID_WORLD' || /World history authority \/ time mismatch/.test(error.message)
  );
});

test('Moonshot report challenges are attributed, replay-safe dissent rather than adjudication', async t => {
  const f = await fixture(t);
  const founder = f.client();
  await founder.login();
  const published = await publish(founder, 'Challenge evidence artifact');
  const witness = f.client();
  const proposal = await witness.request('/api/action', {
    type: 'propose-moonshot',
    title: 'Can the observation be reproduced?',
    hypothesis: 'The observation repeats under the stated conditions.',
    falsifier: 'A controlled repeat fails to reproduce it.',
    evidenceNeeded: 'The procedure, retained artifact and a repeatable measurement.',
    sourceCreationId: published.result.creationId,
    sourceVersion: 1,
    requestId: 'challenge-proposal-001'
  });
  assert.equal(proposal.response.status, 200, JSON.stringify(proposal.body));
  const report = await witness.request('/api/action', {
    type: 'report-experiment',
    moonshotId: proposal.body.result.moonshotId,
    procedure: 'Repeat the documented comparison.',
    observation: 'The required measurement settings were not available.',
    reportedOutcome: 'inconclusive',
    evidenceCreationId: null,
    evidenceVersion: null,
    requestId: 'challenge-report-001'
  });
  assert.equal(report.response.status, 200, JSON.stringify(report.body));

  const challengeAction = {
    type: 'challenge-experiment-report',
    reportId: report.body.result.reportId,
    challengeType: 'missing-evidence',
    challengeText: 'The report lacks the measurement settings needed to reproduce the attempt.',
    evidenceCreationId: published.result.creationId,
    evidenceVersion: 1,
    requestId: 'experiment-challenge-retry-001'
  };
  const first = await founder.request('/api/action', challengeAction);
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.idempotentReplay, false);
  const retry = await founder.request('/api/action', challengeAction);
  assert.equal(retry.response.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.idempotentReplay, true);
  assert.equal(retry.body.result.challengeId, first.body.result.challengeId);

  const selfChallenge = await witness.request('/api/action', {
    ...challengeAction,
    requestId: 'experiment-self-challenge-001'
  });
  assert.equal(selfChallenge.response.status, 409, JSON.stringify(selfChallenge.body));
  assert.equal(selfChallenge.body.error.code, 'SELF_CHALLENGE');

  const state = await founder.request('/api/state');
  const challenges = state.body.world.events.filter(event => event.type === 'experiment-challenged');
  const reports = state.body.world.events.filter(event => event.type === 'experiment-reported');
  assert.equal(challenges.length, 1);
  assert.equal(reports.length, 1);
  assert.equal(challenges[0].reportId, reports[0].reportId);
  assert.equal(challenges[0].evidenceCreationId, published.result.creationId);
  assert.equal(challenges[0].evidenceVersion, 1);
  assert.equal(challenges[0].actor.role, 'founder');
  assert.equal(challenges[0].outcome, undefined);
  assert.equal(challenges[0].status, undefined);
  assert.equal(reports[0].outcome, undefined);
  assert.equal(reports[0].status, undefined);
  assert.equal(state.body.world.xp, published.world.xp);

  // An uncertain client response can be retried after a process restart without
  // creating a second challenge or losing its evidence reference.
  await f.closeGame();
  let restarted;
  t.after(async () => { if (restarted) await restarted.closeGame().catch(() => {}); });
  restarted = await createGameServer({ dataDir: f.dataDir, founderKey: KEY });
  await new Promise(resolve => restarted.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${restarted.address().port}`;
  const login = await fetch(origin + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ key: KEY, name: 'Damien' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const replay = await fetch(origin + '/api/action', {
    method: 'POST',
    headers: { cookie, origin, 'content-type': 'application/json' },
    body: JSON.stringify(challengeAction)
  });
  assert.equal(replay.status, 200);
  const replayBody = await replay.json();
  assert.equal(replayBody.idempotentReplay, true);
  assert.equal(replayBody.result.challengeId, first.body.result.challengeId);
  const restartedState = await (await fetch(origin + '/api/state', { headers: { cookie } })).json();
  const afterRestart = restartedState.world.events.filter(event => event.type === 'experiment-challenged');
  assert.equal(afterRestart.length, 1);
  assert.equal(afterRestart[0].evidenceCreationId, published.result.creationId);
  assert.equal(afterRestart[0].evidenceVersion, 1);
  await restarted.closeGame();
  restarted = null;
});

test('Witness request recovery survives service restart without restoring Founder authority from a cookie', async t => {
  const f = await fixture(t);
  const founder = f.client(); await founder.login();
  const published = await publish(founder, 'Witness restart receipt target');
  const creation = published.world.creations[0];
  const witness = f.client();
  const initial = await witness.request('/api/state');
  assert.equal(initial.body.viewer.role, 'witness');
  const witnessId = initial.body.viewer.id;
  const witnessToken = witness.cookie.slice('ngl_session='.length);
  assert.ok(witnessId.startsWith('witness-'));
  assert.notEqual(witnessId, witnessToken);

  const action = { type: 'report', creationId: creation.id, version: 1, text: 'Retry this exact report after restart.' };
  const requestId = 'restart-witness-report-001';
  const first = await witness.request('/api/action', { ...action, requestId });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  const reportId = first.body.result.id;
  assert.equal(first.body.world.reports.filter(report => report.text === action.text).length, 1);
  assert.equal(JSON.stringify(first.body.world.events).includes(witnessToken), false, 'raw session bearer token must not enter public event history');

  const witnessCookie = witness.cookie, founderCookie = founder.cookie;
  await f.closeGame();
  const reopened = await createGameServer({ dataDir: f.dataDir, founderKey: KEY });
  try {
    await new Promise(resolve => reopened.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${reopened.address().port}`;
    async function request(path, body, cookie) {
      const headers = { ...(cookie ? { cookie } : {}) };
      if (body !== undefined) { headers['content-type'] = 'application/json'; headers.origin = url; }
      const response = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const nextCookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
      return { response, body: await response.json(), cookie: nextCookie };
    }

    const restoredWitness = await request('/api/state', undefined, witnessCookie);
    assert.equal(restoredWitness.body.viewer.role, 'witness');
    assert.equal(restoredWitness.body.viewer.id, witnessId, 'surviving witness cookie must recover the same pseudonymous actor');
    const replay = await request('/api/action', { ...action, requestId }, restoredWitness.cookie);
    assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.idempotentReplay, true);
    assert.equal(replay.body.result.id, reportId);
    assert.equal(replay.body.world.reports.filter(report => report.text === action.text).length, 1);

    const staleFounder = await request('/api/state', undefined, founderCookie);
    assert.equal(staleFounder.body.viewer.role, 'witness', 'a pre-restart Founder cookie must be demoted');
    assert.notEqual(staleFounder.body.viewer.id, 'damien');
    const denied = await request('/api/action', { type: 'draft', kind: 'custom', title: 'Must not publish', intent: 'Stale cookie is not authority' }, staleFounder.cookie);
    assert.equal(denied.response.status, 403);
    const reauthenticated = await request('/api/login', { key: KEY, name: 'Damien' }, staleFounder.cookie);
    assert.equal(reauthenticated.response.status, 200);
    assert.equal(reauthenticated.body.viewer.role, 'founder');
  } finally {
    await reopened.closeGame();
  }
});


test('Polymath Academy study notes bind to retained versions and replay idempotently', async t => {
  const f = await fixture(t);
  const founder = f.client();
  await founder.login();
  const published = await publish(founder, 'Academy source version');
  const creation = published.world.creations[0];
  const beforeXp = published.world.xp;
  const action = {
    type: 'study', creationId: creation.id, version: 1,
    question: 'What does this artifact actually establish?',
    attempt: 'It establishes that these exact bytes were retained, not that the claims are true.',
    nextCheck: 'Find an independent source or counterexample.',
    requestId: 'academy-study-retry-001'
  };
  const first = await founder.request('/api/action', action);
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.idempotentReplay, false);
  const event = first.body.world.events.at(-1);
  assert.equal(event.type, 'study');
  assert.equal(event.creationId, creation.id);
  assert.equal(event.version, 1);
  assert.equal(event.question, action.question);
  assert.equal(event.status, undefined);
  assert.equal(event.outcome, undefined);
  assert.equal(first.body.world.xp, beforeXp);
  const retry = await founder.request('/api/action', action);
  assert.equal(retry.response.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.idempotentReplay, true);
  assert.equal(retry.body.result.studyId, first.body.result.studyId);
  assert.equal(retry.body.world.revision, first.body.world.revision);
  assert.equal(retry.body.world.events.filter(item => item.type === 'study').length, 1);
  const stale = await founder.request('/api/action', {
    ...action, version: 99, requestId: 'academy-study-stale-version-001'
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, 'STALE_VERSION');
  const finalState = await founder.request('/api/state');
  assert.equal(finalState.body.world.events.filter(item => item.type === 'study').length, 1);
  assert.equal(finalState.body.world.xp, beforeXp);
});


test('decision HTTP route returns 503 for post-rename durability uncertainty and fences retries', async t => {
  let failNextSync = false;
  const decisionSyncDirectory = async directory => {
    if (failNextSync) {
      failNextSync = false;
      throw Object.assign(new Error('injected decision directory sync failure'), { code: 'EIO' });
    }
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  };
  const f = await fixture(t, undefined, { decisionSyncDirectory });
  const founder = f.client();
  await founder.login();

  const policy = await founder.request('/api/decisions/policy', {
    id: 'policy:api-durability',
    reviewWindowMs: 60_000,
    basis: 'Synthetic fault-injection test only; not an operational policy.'
  });
  assert.equal(policy.response.status, 200, JSON.stringify(policy.body));

  const bytes = '{"schema":"test.evaluation.v1","result":"synthetic decision"}';
  const created = await founder.request('/api/decisions/proposals', {
    id: 'decision:api-durability',
    title: 'Synthetic post-rename durability test',
    evaluation: { bytes, receipt: artifactReceipt(bytes) },
    risks: ['Synthetic test only'],
    rollback: 'No external effect is executed by this test.',
    proposedEffect: 'Record a synthetic decision only.'
  });
  assert.equal(created.response.status, 200, JSON.stringify(created.body));

  failNextSync = true;
  const chosen = await founder.request('/api/decisions/choose', {
    decisionId: 'decision:api-durability',
    expectedRevision: 1,
    requestId: 'request:api-durability',
    action: 'APPROVE'
  });
  assert.equal(chosen.response.status, 503, JSON.stringify(chosen.body));
  assert.equal(chosen.body.error.code, 'COMMIT_DURABILITY_UNCERTAIN');

  const retry = await founder.request('/api/decisions/choose', {
    decisionId: 'decision:api-durability',
    expectedRevision: 1,
    requestId: 'request:api-durability-retry',
    action: 'REJECT'
  });
  assert.equal(retry.response.status, 503, JSON.stringify(retry.body));
  assert.equal(retry.body.error.code, 'COMMIT_DURABILITY_UNCERTAIN');
});


test('server startup indexes large interleaved retained proposal/report history', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-indexed-history-server-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const world = createWorld({ id: 'indexed-server-history', now: '2026-10-01T00:00:00.000Z' });
  const actor = { id: 'history-witness', name: 'History witness', role: 'witness' };
  const events = [];
  const origin = Date.parse(world.createdAt);
  for (let index = 0; index < 1000; index += 1) {
    const moonshotId = `server-moonshot-${index}`;
    events.push({
      id: `server-proposal-event-${index}`, type: 'moonshot-proposed', actor,
      at: new Date(origin + index * 2000 + 1).toISOString(),
      semantics: 'Research proposal only; not executed.', moonshotId,
      title: 'Bounded proposal', hypothesis: 'A falsifiable hypothesis',
      falsifier: 'An observable counterexample', evidenceNeeded: 'A retained source',
      sourceCreationId: null, sourceVersion: null
    });
    events.push({
      id: `server-report-event-${index}`, type: 'experiment-reported', actor,
      at: new Date(origin + index * 2000 + 1001).toISOString(),
      semantics: 'Self-reported attempt; not adjudicated.',
      reportId: `server-report-${index}`, moonshotId,
      procedure: 'Repeat the stated procedure', observation: 'Record what occurred',
      reportedOutcome: 'inconclusive', evidenceCreationId: null, evidenceVersion: null
    });
  }
  world.events = events;
  world.revision = events.length;
  world.updatedAt = events.at(-1).at;
  const payload = { world, institutionalEvents: [], artifacts: {}, publicationBindings: [] };
  const envelope = {
    schema: 'ngl.service-store.v1',
    payload,
    digest: artifactReceipt(canonicalStringify(payload)).digest
  };
  await writeFile(join(dataDir, 'service.json'), canonicalStringify(envelope), { mode: 0o600 });
  const server = await createGameServer({ dataDir, founderKey: KEY });
  t.after(() => server.closeGame());
});
