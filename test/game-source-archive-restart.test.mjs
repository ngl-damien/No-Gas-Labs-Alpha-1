import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../game/server.mjs';
import { GITHUB_SOURCE_ARCHIVE_SERVER_RETRIEVED_LABEL } from '../game/artifacts.mjs';

const FOUNDER_KEY = 'test-source-archive-restart-founder-key';

function sourceArchiveCaptureFixture(source) {
  const bytes = Buffer.from(source, 'utf8'), repository = 'ngl-damien/No-Gas-Labs-Alpha-1';
  const commitSha = 'f'.repeat(40), path = 'test/fixtures/restart-private-source.mjs';
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const gitBlobSha = createHash('sha1').update('blob ' + bytes.length + String.fromCharCode(0)).update(bytes).digest('hex');
  const permalink = 'https://github.com/' + repository + '/blob/' + commitSha + '/' + path;
  const apiUrl = 'https://api.github.com/repos/' + repository + '/contents/' + path + '?ref=' + commitSha;
  const payload = { type: 'file', encoding: 'base64', path, size: bytes.length, sha: gitBlobSha, content: bytes.toString('base64') };
  const body = JSON.stringify(payload), calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options }); assert.equal(url, apiUrl);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } });
  };
  return { action: { type: 'draft-github-source-archive', permalink, gitBlobSha, sha256, size: bytes.length },
    fetchImpl, calls, sourceBytesBase64: bytes.toString('base64') };
}

function makeClient(origin) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async request(path, body) {
      const headers = { ...(cookie ? { cookie } : {}) };
      if (body !== undefined) {
        headers.origin = origin;
        headers['content-type'] = 'application/json';
      }
      const response = await fetch(origin + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const contentType = response.headers.get('content-type') || '';
      const result = contentType.includes('json') ? await response.json() : await response.text();
      return { response, body: result };
    },
    async stream() {
      const controller = new AbortController();
      const response = await fetch(origin + '/api/events', {
        headers: cookie ? { cookie } : {},
        signal: controller.signal
      });
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      let pending = '';
      return {
        close() { controller.abort(); },
        async next(expectedType = 'world') {
          for (;;) {
            const split = pending.indexOf('\n\n');
            if (split >= 0) {
              const block = pending.slice(0, split);
              pending = pending.slice(split + 2);
              const event = /^event: (.+)$/m.exec(block)?.[1];
              const data = /^data: (.+)$/m.exec(block)?.[1];
              if (data && (!expectedType || event === expectedType)) return JSON.parse(data);
            } else {
              const chunk = await reader.read();
              if (chunk.done) throw new Error('SSE ended');
              pending += new TextDecoder().decode(chunk.value);
            }
          }
        }
      };
    }
  };
}

async function startServer(dataDir, githubSourceFetch) {
  const server = await createGameServer({ dataDir, founderKey: FOUNDER_KEY, githubSourceFetch });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, origin: 'http://127.0.0.1:' + server.address().port };
}

test('unpublished Source Archive bytes remain private across server restart until explicit Founder publication', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-source-archive-restart-'));
  const servers = [];
  const streams = [];
  t.after(async () => {
    for (const stream of streams) stream.close();
    for (const server of servers.reverse()) await server.closeGame().catch(() => {});
    await rm(dataDir, { recursive: true, force: true });
  });

  const source = 'export const PRIVATE_SOURCE = "NGL_SOURCE_ARCHIVE_RESTART_PRIVATE";\n';
  const capture = sourceArchiveCaptureFixture(source);
  const first = await startServer(dataDir, capture.fetchImpl);
  servers.push(first.server);
  const founderBeforeRestart = makeClient(first.origin);
  assert.equal((await founderBeforeRestart.request('/api/login', {
    key: FOUNDER_KEY,
    name: 'Damien'
  })).body.viewer.role, 'founder');

  const sourceBytesBase64 = capture.sourceBytesBase64;
  const draft = await founderBeforeRestart.request('/api/action', { ...capture.action, requestId: 'source-archive-restart-20261116-001' });
  assert.equal(draft.response.status, 200, JSON.stringify(draft.body));
  const draftId = draft.body.result.draftId;
  const founderDraft = (await founderBeforeRestart.request('/api/state')).body;
  assert.equal(founderDraft.world.drafts.length, 1);
  const retainedHtml = founderDraft.world.drafts[0].html;
  assert.ok(retainedHtml.includes(GITHUB_SOURCE_ARCHIVE_SERVER_RETRIEVED_LABEL));
  assert.ok(retainedHtml.includes(sourceBytesBase64));
  assert.equal(capture.calls.length, 1);
  assert.equal(founderDraft.world.xp, 0, 'private drafting is not progression');
  const privateRevision = founderDraft.world.revision;

  await first.server.closeGame();

  const restarted = await startServer(dataDir, capture.fetchImpl);
  servers.push(restarted.server);
  const witness = makeClient(restarted.origin);
  const founder = makeClient(restarted.origin);
  const witnessState = (await witness.request('/api/state')).body;
  assert.equal(witnessState.viewer.role, 'witness');
  const witnessStream = await witness.stream();
  streams.push(witnessStream);
  const streamedDraftSnapshot = await witnessStream.next('world');

  const founderLogin = await founder.request('/api/login', {
    key: FOUNDER_KEY,
    name: 'Damien'
  });
  assert.equal(founderLogin.response.status, 200);
  assert.equal(founderLogin.body.viewer.role, 'founder');
  const resumedFounder = (await founder.request('/api/state')).body;
  assert.equal(resumedFounder.world.drafts.length, 1, 'the Founder can recover the private draft after restart');
  assert.equal(resumedFounder.world.drafts[0].id, draftId);
  assert.equal(resumedFounder.world.drafts[0].html, retainedHtml);
  assert.equal(resumedFounder.world.xp, 0);
  assert.equal(capture.calls.length, 1, 'restart recovery must not repeat the original GitHub retrieval');

  for (const projection of [witnessState, streamedDraftSnapshot]) {
    assert.equal(projection.world.drafts.length, 0);
    assert.equal(projection.world.events.some(event => event.type === 'draft'), false);
    assert.equal(JSON.stringify(projection).includes(sourceBytesBase64), false);
    assert.equal(JSON.stringify(projection).includes(source), false);
  }
  assert.equal(witnessState.world.revision, privateRevision);
  const witnessExport = await witness.request('/api/export');
  assert.equal(witnessExport.response.status, 200);
  assert.equal(witnessExport.body.world.drafts.length, 0);
  assert.equal(JSON.stringify(witnessExport.body).includes(sourceBytesBase64), false);
  assert.equal(JSON.stringify(witnessExport.body).includes(source), false);

  const guessedDraftArtifact = await witness.request('/api/artifacts/' + draftId + '?version=1');
  assert.equal(guessedDraftArtifact.response.status, 404);
  const deniedPublish = await witness.request('/api/action', {
    type: 'publish',
    draftId,
    expectedVersion: 0
  });
  assert.equal(deniedPublish.response.status, 403);
  const afterDeniedPublish = (await witness.request('/api/state')).body;
  assert.equal(afterDeniedPublish.world.revision, witnessState.world.revision);
  assert.equal(afterDeniedPublish.world.xp, 0);

  const published = await founder.request('/api/action', {
    type: 'publish',
    draftId,
    expectedVersion: 0
  });
  assert.equal(published.response.status, 200, JSON.stringify(published.body));
  const creation = published.body.world.creations.find(item => item.title.startsWith('Source Archive · restart-private-source.mjs'));
  assert.ok(creation);
  assert.equal(creation.html, retainedHtml);
  assert.equal(published.body.world.xp, 100, 'only explicit publication earns its existing reward');

  const streamedPublication = await witnessStream.next('world');
  const streamedCreation = streamedPublication.world.creations.find(item => item.id === creation.id);
  assert.equal(streamedCreation.html, retainedHtml);
  assert.ok(JSON.stringify(streamedPublication).includes(sourceBytesBase64));
  const witnessAfterPublication = (await witness.request('/api/state')).body;
  assert.equal(witnessAfterPublication.world.creations.find(item => item.id === creation.id).html, retainedHtml);
  const artifact = await witness.request('/api/artifacts/' + creation.id + '?version=1');
  assert.equal(artifact.response.status, 200);
  assert.equal(artifact.body, retainedHtml);
});

test('GitHub retrieval failures remain in Chronicle and the same request can retry across restart', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-source-archive-retry-'));
  let attempts = 0;
  const source = 'export const RETRY_SOURCE = "NGL_SOURCE_ARCHIVE_RETRY_FIXTURE";\n';
  const capture = sourceArchiveCaptureFixture(source);
  const fetchImpl = async (url, options) => {
    attempts += 1;
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    if (attempts <= 2) {
      return new Response(JSON.stringify({ message: 'fixture upstream unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' }
      });
    }
    return capture.fetchImpl(url, options);
  };
  const servers = [];
  const streams = [];
  let current = await startServer(dataDir, fetchImpl);
  servers.push(current.server);
  t.after(async () => {
    for (const stream of streams) stream.close();
    for (const server of servers.reverse()) await server.closeGame().catch(() => {});
    await rm(dataDir, { recursive: true, force: true });
  });

  const founder = makeClient(current.origin);
  const login = await founder.request('/api/login', { key: FOUNDER_KEY, name: 'Damien' });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.viewer.role, 'founder');

  const witness = makeClient(current.origin);
  const witnessStream = await witness.stream();
  streams.push(witnessStream);
  const witnessInitial = await witnessStream.next('world');
  assert.equal(witnessInitial.world.events.length, 0);

  const requestId = 'source-archive-retry-20261116-001';
  const action = { ...capture.action, requestId };
  const before = (await founder.request('/api/state')).body;
  assert.equal(before.world.revision, 0);
  assert.equal(before.world.xp, 0);
  assert.equal(before.world.drafts.length, 0);

  const forgedFailure = await founder.request('/api/action', {
    type: 'source-archive-attempt-failed',
    attemptId: 'client-invented-attempt',
    requestIdDigest: 'a'.repeat(64),
    actionDigest: 'b'.repeat(64),
    repository: 'ngl-damien/No-Gas-Labs-Alpha-1',
    commitSha: 'c'.repeat(40),
    path: 'docs/README.md',
    failureCode: 'GITHUB_SOURCE_UNAVAILABLE',
    retryable: true
  });
  assert.equal(forgedFailure.response.status, 400);
  assert.equal(forgedFailure.body.error.code, 'INVALID_ACTION');
  assert.equal(attempts, 0, 'clients cannot submit canonical service-failure events');

  const failed = await founder.request('/api/action', action);
  assert.equal(failed.response.status, 502);
  assert.equal(failed.body.error.code, 'GITHUB_SOURCE_UNAVAILABLE');
  assert.match(failed.body.error.message, /retained in Chronicle/i);
  assert.equal(attempts, 1);
  const afterFailure = (await founder.request('/api/state')).body;
  assert.equal(afterFailure.world.revision, before.world.revision + 1);
  assert.equal(afterFailure.world.events.length, before.world.events.length + 1);
  assert.equal(afterFailure.world.drafts.length, 0);
  assert.equal(afterFailure.world.xp, 0);
  const failureEvents = afterFailure.world.events.filter(event => event.type === 'source-archive-attempt-failed');
  assert.equal(failureEvents.length, 1);
  const failure = failureEvents[0];
  assert.equal(failure.actor.id, 'damien');
  assert.equal(failure.failureCode, 'GITHUB_SOURCE_UNAVAILABLE');
  assert.equal(failure.retryable, true);
  assert.equal(failure.repository, 'ngl-damien/No-Gas-Labs-Alpha-1');
  assert.equal(failure.commitSha, 'f'.repeat(40));
  assert.equal(failure.path, 'test/fixtures/restart-private-source.mjs');
  assert.equal(failure.requestIdDigest, createHash('sha256').update(requestId).digest('hex'));
  assert.match(failure.actionDigest, /^[a-f0-9]{64}$/);
  assert.match(failure.attemptId, /^source-archive-attempt-/);
  assert.equal(Object.hasOwn(failure, 'requestId'), false);
  assert.equal(Object.hasOwn(failure, 'actionFingerprint'), false);
  assert.equal(Object.hasOwn(failure, 'actionResult'), false);

  const witnessFailureStream = await witnessStream.next('world');
  assert.equal(witnessFailureStream.world.drafts.length, 0);
  assert.equal(witnessFailureStream.world.events.some(event => event.type === 'source-archive-attempt-failed'), true);
  assert.equal(JSON.stringify(witnessFailureStream).includes(source), false);

  const conflictingAction = await founder.request('/api/action', { ...action, sha256: '0'.repeat(64) });
  assert.equal(conflictingAction.response.status, 409);
  assert.equal(conflictingAction.body.error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(attempts, 1, 'a failed request ID cannot be rebound to different action content');

  const repeatedFailure = await founder.request('/api/action', action);
  assert.equal(repeatedFailure.response.status, 502);
  assert.equal(repeatedFailure.body.error.code, 'GITHUB_SOURCE_UNAVAILABLE');
  assert.equal(attempts, 2);
  const afterRepeatedFailure = (await founder.request('/api/state')).body;
  assert.equal(afterRepeatedFailure.world.revision, afterFailure.world.revision,
    'the same request/failure class is retained once rather than growing duplicate Chronicle entries');
  assert.equal(afterRepeatedFailure.world.events.filter(event => event.type === 'source-archive-attempt-failed').length, 1);
  assert.equal(afterRepeatedFailure.world.events.find(event => event.type === 'source-archive-attempt-failed').attemptId, failure.attemptId);

  await current.server.closeGame();
  current = await startServer(dataDir, fetchImpl);
  servers.push(current.server);

  const witnessAfterRestart = (await witness.request('/api/state')).body;
  assert.equal(witnessAfterRestart.world.drafts.length, 0);
  assert.equal(witnessAfterRestart.world.xp, 0);
  assert.equal(witnessAfterRestart.world.events.filter(event => event.type === 'source-archive-attempt-failed').length, 1,
    'the failed attempt survives server restart');
  const founderAfterRestart = await founder.request('/api/login', { key: FOUNDER_KEY, name: 'Damien' });
  assert.equal(founderAfterRestart.response.status, 200);
  assert.equal(founderAfterRestart.body.viewer.role, 'founder');

  const retried = await founder.request('/api/action', action);
  assert.equal(retried.response.status, 200, JSON.stringify(retried.body));
  assert.equal(retried.body.idempotentReplay, false);
  assert.equal(attempts, 3);
  const afterRetry = (await founder.request('/api/state')).body;
  assert.equal(afterRetry.world.drafts.length, 1);
  assert.equal(afterRetry.world.xp, 0, 'successful private drafting still awards no XP');
  assert.equal(afterRetry.world.events.filter(event => event.type === 'source-archive-attempt-failed').length, 1);
  assert.equal(afterRetry.world.events.filter(event => event.requestId === requestId).length, 1,
    'the failed attempt does not consume the action request ID');

  const witnessAfterRetry = (await witness.request('/api/state')).body;
  assert.equal(witnessAfterRetry.world.drafts.length, 0, 'the recovered private draft remains hidden from Witness');
  assert.equal(witnessAfterRetry.world.events.some(event => event.type === 'draft'), false);
  assert.equal(witnessAfterRetry.world.events.some(event => event.type === 'source-archive-attempt-failed'), true);

  const revisionAfterRetry = afterRetry.world.revision;
  const replay = await founder.request('/api/action', action);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(attempts, 3, 'a committed replay must not retrieve GitHub again');
  const afterReplay = (await founder.request('/api/state')).body;
  assert.equal(afterReplay.world.revision, revisionAfterRetry);
  assert.equal(afterReplay.world.drafts.length, 1);
  assert.equal(afterReplay.world.xp, 0);
});
