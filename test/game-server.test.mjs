import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, rename, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createGameServer } from '../game/server.mjs';
import { artifactReceipt, canonicalStringify } from '../src/institution/kernel.mjs';

const KEY = 'test-founder-key-not-a-production-secret';
async function fixture(t, dataDir) {
  dataDir ??= await mkdtemp(join(tmpdir(), 'ngl-http-'));
  const server = await createGameServer({ dataDir, founderKey: KEY });
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
  for (const module of ['model', 'quests', 'character-sheet', 'world-view', 'launchpad', 'institution-view', 'contradiction-clerk']) {
    assert.match(source.body, new RegExp(`from ['"]\\./${module}\\.mjs['"]`), `client import: ${module}`);
  }
  const institutionView = await client.request('/institution-view.mjs');
  assert.match(institutionView.body, /from ['\"]\.\/chronicle\.mjs['\"]/, 'institution view imports the read-only chronicle');
  for (const module of ['client', 'quests', 'character-sheet', 'world-view', 'model', 'artifacts', 'launchpad', 'institution-view', 'contradiction-clerk', 'chronicle']) {
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

test('invalid or unsupported action payloads fail before session allocation', async t => {
  const f = await fixture(t);
  const invalid = [
    {},
    { type: 'not-an-action' },
    { type: 'discover', locationId: 'relay', xp: 999 }
  ];
  for (const payload of invalid) {
    const response = await fetch(f.url + '/api/action', {
      method: 'POST',
      headers: { origin: f.url, 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('set-cookie'), null, 'invalid action must not allocate a session');
    await response.text();
  }
});

