import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../game/server.mjs';
import { GITHUB_SOURCE_ARCHIVE_SERVER_RETRIEVED_LABEL } from '../game/artifacts.mjs';
import { projectSourceArchiveFailureObjects } from '../game/world-view.mjs';
import { projectCharacter } from '../game/character-sheet.mjs';
import { getQuestTrail } from '../game/quests.mjs';

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

function makeClient(origin, initialCookie = '') {
  let cookie = initialCookie;
  return {
    get cookie() { return cookie; },
    async request(path, body) {
      const headers = { ...(cookie ? { cookie } : {}) };
      if (body !== undefined) {
        headers.origin = origin;
        headers['content-type'] = 'application/json';
      }
      let response;
      try {
        response = await fetch(origin + path, {
          method: body === undefined ? 'GET' : 'POST',
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
      } catch (error) {
        throw new Error(`HTTP ${body === undefined ? 'GET' : 'POST'} ${path} failed: ${error.message} (${error.cause?.code || 'no-cause-code'})`, { cause: error });
      }
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const contentType = response.headers.get('content-type') || '';
      const result = contentType.includes('json') ? await response.json() : await response.text();
      return { response, body: result };
    },
    async stream() {
      const controller = new AbortController();
      let response;
      try {
        response = await fetch(origin + '/api/events', {
          headers: cookie ? { cookie } : {},
          signal: controller.signal
        });
      } catch (error) {
        throw new Error(`SSE GET /api/events failed: ${error.message} (${error.cause?.code || 'no-cause-code'})`, { cause: error });
      }
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

  let founder = makeClient(current.origin);
  const login = await founder.request('/api/login', { key: FOUNDER_KEY, name: 'Damien' });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.viewer.role, 'founder');

  let witness = makeClient(current.origin);
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
  const failureProjection=projectSourceArchiveFailureObjects(afterFailure.world);
  assert.ok(failureProjection);
  assert.equal(failureProjection.total,1);
  assert.equal(failureProjection.records[0].eventId,failure.id);
  assert.equal(failureProjection.records[0].locationId,'evidence_archive');
  assert.equal(failureProjection.records[0].retryable,true);
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
  // Rebind clients to the restarted server's new ephemeral port. The durable
  // world/request ID survive restart; in-memory HTTP origins and sessions do not.
  founder = makeClient(current.origin);
  witness = makeClient(current.origin);

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
  const retainedFailureProjection=projectSourceArchiveFailureObjects(afterRetry.world);
  assert.ok(retainedFailureProjection);
  assert.equal(retainedFailureProjection.total,1,'successful retry must not erase the earlier failure object');
  assert.equal(retainedFailureProjection.records[0].eventId,failure.id);
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


test('a server-observed Source Archive failure unlocks a Recovery Ledger whose pending Armor Bearer handoff survives another restart', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-source-archive-recovery-restart-'));
  const source = 'export const RECOVERY_LEDGER_RESTART = true;\n';
  const capture = sourceArchiveCaptureFixture(source);
  let attempts = 0;
  const fetchImpl = async (url, options) => {
    attempts += 1;
    if (attempts === 1) {
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

  let founder = makeClient(current.origin);
  const firstLogin = await founder.request('/api/login', { key: FOUNDER_KEY, name: 'Damien' });
  assert.equal(firstLogin.response.status, 200);
  assert.equal(firstLogin.body.viewer.role, 'founder');

  // Preserve one pseudonymous Witness cookie so the designated recipient can
  // rejoin with the same actor identity after both service restarts.
  const witnessSeed = makeClient(current.origin);
  const witnessSeedState = (await witnessSeed.request('/api/state')).body;
  assert.equal(witnessSeedState.viewer.role, 'witness');
  const witnessId = witnessSeedState.viewer.id;
  const witnessCookie = witnessSeed.cookie;

  const failed = await founder.request('/api/action', {
    ...capture.action,
    requestId: 'source-archive-recovery-restart-failure-001'
  });
  assert.equal(failed.response.status, 502);
  assert.equal(failed.body.error.code, 'GITHUB_SOURCE_UNAVAILABLE');
  assert.equal(attempts, 1);

  const beforeRestart = (await founder.request('/api/state')).body;
  const failure = beforeRestart.world.events.find(event =>
    event.type === 'source-archive-attempt-failed'
  );
  assert.ok(failure);
  assert.equal(failure.retryable, true);
  assert.equal(beforeRestart.world.drafts.length, 0);
  assert.equal(beforeRestart.world.xp, 0);
  const beforeProjection = projectSourceArchiveFailureObjects(beforeRestart.world, {
    includeRecoveryLinks: true
  });
  assert.equal(beforeProjection.captureProjectionComplete, true);
  assert.equal(beforeProjection.recoveryLinks.length, 0);
  assert.equal(
    beforeProjection.records.find(record => record.eventId === failure.id).laterCaptureStatus,
    'not-observed'
  );

  await current.server.closeGame();
  current = await startServer(dataDir, fetchImpl);
  servers.push(current.server);

  founder = makeClient(current.origin);
  const resumedLogin = await founder.request('/api/login', { key: FOUNDER_KEY, name: 'Damien' });
  assert.equal(resumedLogin.response.status, 200);
  assert.equal(resumedLogin.body.viewer.role, 'founder');

  let witness = makeClient(current.origin, witnessCookie);
  const witnessInitial = (await witness.request('/api/state')).body;
  assert.equal(witnessInitial.viewer.role, 'witness');
  assert.equal(witnessInitial.viewer.id, witnessId,
    'the same opaque Witness cookie restores the same pseudonymous actor after restart');
  assert.equal(witnessInitial.world.events.some(event => event.id === failure.id), true);
  const witnessStream = await witness.stream();
  streams.push(witnessStream);
  await witnessStream.next('world');

  const afterRestart = (await founder.request('/api/state')).body;
  assert.equal(afterRestart.world.events.filter(event =>
    event.type === 'source-archive-attempt-failed'
  ).length, 1);
  assert.equal(afterRestart.world.events.find(event => event.id === failure.id).id, failure.id);
  assert.equal(afterRestart.world.drafts.length, 0);
  assert.equal(afterRestart.world.xp, 0);
  const afterRestartProjection = projectSourceArchiveFailureObjects(afterRestart.world, {
    includeRecoveryLinks: true
  });
  assert.equal(afterRestartProjection.captureProjectionComplete, true);
  assert.equal(afterRestartProjection.records.find(record => record.eventId === failure.id).laterCaptureStatus,
    'not-observed');

  const draft = await founder.request('/api/action', {
    ...capture.action,
    requestId: 'source-archive-recovery-restart-capture-002'
  });
  assert.equal(draft.response.status, 200, JSON.stringify(draft.body));
  assert.equal(attempts, 2);
  assert.equal(capture.calls.length, 1);
  const afterDraft = (await founder.request('/api/state')).body;
  assert.equal(afterDraft.world.drafts.length, 1);
  assert.equal(afterDraft.world.xp, 0, 'private capture after restart is not progression');

  const publication = await founder.request('/api/action', {
    type: 'publish',
    draftId: draft.body.result.draftId,
    expectedVersion: 0,
    requestId: 'source-archive-recovery-restart-publish-003'
  });
  assert.equal(publication.response.status, 200, JSON.stringify(publication.body));
  const afterPublish = (await founder.request('/api/state')).body;
  const publicationEvent = afterPublish.world.events.find(event =>
    event.type === 'publish' &&
    event.creationId === publication.body.result.creationId &&
    event.version === 1
  );
  assert.ok(publicationEvent);
  assert.equal(afterPublish.world.xp, 100, 'only the explicit publication earns its existing reward');

  const projection = projectSourceArchiveFailureObjects(afterPublish.world, {
    includeRecoveryLinks: true
  });
  assert.equal(projection.captureProjectionComplete, true);
  assert.equal(projection.recoveryLinkScanComplete, true);
  assert.equal(projection.recoveryLinks.length, 1);
  assert.deepEqual(
    [projection.recoveryLinks[0].failureEventId, projection.recoveryLinks[0].publicationEventId],
    [failure.id, publicationEvent.id]
  );
  assert.equal(projection.recoveryLinks[0].sha256, capture.action.sha256);
  assert.equal(projection.recoveryLinks[0].gitBlobSha, capture.action.gitBlobSha);
  const failureRecord = projection.records.find(record => record.eventId === failure.id);
  assert.equal(failureRecord.laterCaptureStatus, 'observed');
  assert.equal(failureRecord.laterCapture.publicationEventId, publicationEvent.id);

  const founderCharacter = projectCharacter(afterPublish.world, afterPublish.viewer);
  const recoverySource = founderCharacter.fieldItemSources.recovery.find(item =>
    item.eventId === publicationEvent.id
  );
  assert.ok(recoverySource);
  assert.equal(recoverySource.kind, 'source-archive-recovery');
  assert.equal(recoverySource.recovery.failureEventId, failure.id);
  assert.equal(recoverySource.recovery.publicationEventId, publicationEvent.id);

  const laterCaptureQuest = getQuestTrail(afterPublish.world, afterPublish.viewer).find(item =>
    item.id === 'founder-source-archive-later-capture'
  );
  assert.ok(laterCaptureQuest);
  assert.deepEqual(
    [laterCaptureQuest.progress, laterCaptureQuest.target, laterCaptureQuest.complete],
    [2, 2, true]
  );
  assert.deepEqual(laterCaptureQuest.evidenceIds, [failure.id, publicationEvent.id]);

  const recoveryQuestId = 'founder-source-archive-recovery-ledger-' + failure.id;
  const initialRecoveryQuest = getQuestTrail(afterPublish.world, afterPublish.viewer).find(item =>
    item.id === recoveryQuestId
  );
  assert.ok(initialRecoveryQuest);
  assert.deepEqual(
    [initialRecoveryQuest.progress, initialRecoveryQuest.target, initialRecoveryQuest.complete],
    [2, 4, false]
  );
  assert.deepEqual(initialRecoveryQuest.evidenceIds, [failure.id, publicationEvent.id]);

  const witnessAfterPublish = (await witness.request('/api/state')).body;
  const witnessCharacter = projectCharacter(witnessAfterPublish.world, witnessAfterPublish.viewer);
  assert.equal(witnessCharacter.fieldItemSources.recovery.length, 0);
  assert.equal(getQuestTrail(witnessAfterPublish.world, witnessAfterPublish.viewer).some(item =>
    item.id === recoveryQuestId
  ), false);

  const revisionBeforeDeniedForge = witnessAfterPublish.world.revision;
  const deniedForge = await witness.request('/api/action', {
    type: 'forge-field-item',
    slotId: 'recovery',
    sourceEventId: publicationEvent.id,
    requestId: 'source-archive-recovery-restart-witness-forge-004'
  });
  assert.equal(deniedForge.response.status, 409);
  assert.equal(deniedForge.body.error.code, 'INVALID_FIELD_ITEM_SOURCE');
  const afterDeniedForge = (await witness.request('/api/state')).body;
  assert.equal(afterDeniedForge.world.revision, revisionBeforeDeniedForge);
  assert.equal(afterDeniedForge.world.events.some(event => event.type === 'field-item-forged'), false);
  assert.equal(afterDeniedForge.world.xp, 100);

  const forged = await founder.request('/api/action', {
    type: 'forge-field-item',
    slotId: 'recovery',
    sourceEventId: publicationEvent.id,
    requestId: 'source-archive-recovery-restart-founder-forge-005'
  });
  assert.equal(forged.response.status, 200, JSON.stringify(forged.body));
  const afterForge = (await founder.request('/api/state')).body;
  const forgeEvent = afterForge.world.events.at(-1);
  assert.equal(forgeEvent.type, 'field-item-forged');
  assert.equal(forgeEvent.actor.id, 'damien');
  assert.equal(forgeEvent.sourceEventId, publicationEvent.id);
  assert.equal(afterForge.world.xp, 100, 'Forge does not award XP');
  const forgedQuest = getQuestTrail(afterForge.world, afterForge.viewer).find(item =>
    item.id === recoveryQuestId
  );
  assert.deepEqual([forgedQuest.progress, forgedQuest.target, forgedQuest.complete], [3, 4, false]);
  assert.deepEqual(forgedQuest.evidenceIds, [failure.id, publicationEvent.id, forgeEvent.id]);

  const equipped = await founder.request('/api/action', {
    type: 'equip-field-item',
    slotId: 'recovery',
    sourceEventId: forgeEvent.id,
    requestId: 'source-archive-recovery-restart-founder-equip-006'
  });
  assert.equal(equipped.response.status, 200, JSON.stringify(equipped.body));
  const afterEquip = (await founder.request('/api/state')).body;
  const equipEvent = afterEquip.world.events.at(-1);
  assert.equal(equipEvent.type, 'field-item-equipped');
  assert.equal(equipEvent.actor.id, 'damien');
  assert.equal(equipEvent.sourceEventId, forgeEvent.id);
  assert.equal(afterEquip.world.xp, 100, 'equipment and quest completion do not award XP');

  const finalCharacter = projectCharacter(afterEquip.world, afterEquip.viewer);
  const item = finalCharacter.fieldInventory.find(candidate => candidate.eventId === forgeEvent.id);
  assert.ok(item);
  assert.equal(item.sourceKind, 'source-archive-recovery');
  assert.equal(item.sourceEventId, publicationEvent.id);
  assert.equal(item.sourceRecovery.failureEventId, failure.id);
  assert.equal(item.sourceRecovery.publicationEventId, publicationEvent.id);
  assert.equal(item.sourceRecovery.sha256, capture.action.sha256);
  assert.equal(finalCharacter.equipment.find(slot => slot.id === 'recovery').source.eventId, forgeEvent.id);

  const completedQuest = getQuestTrail(afterEquip.world, afterEquip.viewer).find(item =>
    item.id === recoveryQuestId
  );
  assert.deepEqual([completedQuest.progress, completedQuest.target, completedQuest.complete], [4, 4, true]);
  assert.deepEqual(completedQuest.evidenceIds, [failure.id, publicationEvent.id, forgeEvent.id, equipEvent.id]);
  assert.equal(completedQuest.action, null);
  assert.equal(completedQuest.countsForQuestkeeper, false);
  assert.equal(attempts, 2);
  assert.equal(capture.calls.length, 1, 'the restarted capture is the only successful fixture retrieval');

  // The Recovery Ledger is now a real field item, not just a completed quest.
  // Offer it to the rejoined Witness, restart again while the offer is pending,
  // and require the exact recipient to accept the same retained offer.
  const unequipped = await founder.request('/api/action', {
    type: 'unequip-field-item',
    slotId: 'recovery',
    requestId: 'source-archive-recovery-restart-founder-unequip-007'
  });
  assert.equal(unequipped.response.status, 200, JSON.stringify(unequipped.body));
  const unequipEvent = unequipped.body.world.events.at(-1);
  assert.equal(unequipEvent.type, 'field-item-unequipped');
  assert.equal(unequipEvent.actor.id, 'damien');
  assert.equal(unequipped.body.world.xp, 100);

  const offered = await founder.request('/api/action', {
    type: 'offer-field-item-transfer',
    itemEventId: forgeEvent.id,
    recipientId: witnessId,
    recipientRole: 'witness',
    requestId: 'source-archive-recovery-restart-founder-offer-008'
  });
  assert.equal(offered.response.status, 200, JSON.stringify(offered.body));
  const offerEvent = offered.body.world.events.at(-1);
  assert.equal(offerEvent.type, 'field-item-transfer-offered');
  assert.equal(offerEvent.actor.id, 'damien');
  assert.equal(offerEvent.itemEventId, forgeEvent.id);
  assert.equal(offerEvent.recipientId, witnessId);
  assert.equal(offerEvent.recipientRole, 'witness');
  assert.equal(offered.body.world.xp, 100);

  const founderPending = projectCharacter(offered.body.world, offered.body.viewer);
  const witnessPending = projectCharacter(offered.body.world, witnessInitial.viewer);
  assert.equal(founderPending.fieldInventoryTotal, 1);
  assert.equal(witnessPending.fieldInventoryTotal, 0,
    'an offer is not a transfer of ownership');
  const pendingOffer = witnessPending.fieldItemTransferOffers.find(item =>
    item.offerId === offerEvent.offerId
  );
  assert.ok(pendingOffer);
  assert.equal(pendingOffer.status, 'offered');
  assert.equal(pendingOffer.item.sourceKind, 'source-archive-recovery');
  assert.equal(pendingOffer.item.sourceRecovery.failureEventId, failure.id);
  assert.equal(pendingOffer.item.sourceRecovery.publicationEventId, publicationEvent.id);
  assert.equal(pendingOffer.item.sourceRecovery.sha256, capture.action.sha256);

  const streamedOffer = await witnessStream.next('world');
  assert.equal(streamedOffer.world.events.at(-1).id, offerEvent.id);
  const pendingRevision = offered.body.world.revision;
  const pendingEventIds = offered.body.world.events.map(event => event.id);

  witnessStream.close();
  await current.server.closeGame();
  current = await startServer(dataDir, fetchImpl);
  servers.push(current.server);

  founder = makeClient(current.origin);
  const founderLoginAfterSecondRestart = await founder.request('/api/login', {
    key: FOUNDER_KEY,
    name: 'Damien'
  });
  assert.equal(founderLoginAfterSecondRestart.response.status, 200);
  assert.equal(founderLoginAfterSecondRestart.body.viewer.role, 'founder');
  assert.equal(founderLoginAfterSecondRestart.body.viewer.id, 'damien');

  witness = makeClient(current.origin, witnessCookie);
  const witnessAfterSecondRestart = (await witness.request('/api/state')).body;
  assert.equal(witnessAfterSecondRestart.viewer.id, witnessId);
  assert.equal(witnessAfterSecondRestart.viewer.role, 'witness');
  assert.deepEqual(witnessAfterSecondRestart.presence, [],
    'restart clears ephemeral presence but preserves the pseudonymous actor identity');
  assert.equal(witnessAfterSecondRestart.world.revision, pendingRevision);
  assert.deepEqual(witnessAfterSecondRestart.world.events.map(event => event.id), pendingEventIds);
  assert.equal(witnessAfterSecondRestart.world.xp, 100);

  const witnessStreamAfterSecondRestart = await witness.stream();
  streams.push(witnessStreamAfterSecondRestart);
  const witnessRejoined = await witnessStreamAfterSecondRestart.next('world');
  assert.equal(witnessRejoined.world.revision, pendingRevision);
  assert.deepEqual(witnessRejoined.world.events.map(event => event.id), pendingEventIds);

  const restoredPending = projectCharacter(
    witnessAfterSecondRestart.world,
    witnessAfterSecondRestart.viewer
  ).fieldItemTransferOffers.find(item => item.offerId === offerEvent.offerId);
  assert.ok(restoredPending, 'the pending offer is reconstructed from retained events after restart');
  assert.equal(restoredPending.status, 'offered');
  assert.equal(restoredPending.fromActorId, 'damien');
  assert.equal(restoredPending.recipientId, witnessId);
  assert.equal(restoredPending.item.sourceRecovery.failureEventId, failure.id);
  assert.equal(restoredPending.item.sourceRecovery.publicationEventId, publicationEvent.id);

  const unrelated = makeClient(current.origin);
  const unrelatedState = (await unrelated.request('/api/state')).body;
  assert.equal(unrelatedState.viewer.role, 'witness');
  assert.notEqual(unrelatedState.viewer.id, witnessId);
  const wrongRecipient = await unrelated.request('/api/action', {
    type: 'accept-field-item-transfer',
    offerId: offerEvent.offerId,
    requestId: 'source-archive-recovery-restart-unrelated-accept-009'
  });
  assert.equal(wrongRecipient.response.status, 409);
  assert.equal(wrongRecipient.body.error.code, 'FIELD_ITEM_TRANSFER_NOT_ADDRESSED');
  const afterWrongRecipient = (await witness.request('/api/state')).body;
  assert.equal(afterWrongRecipient.world.revision, pendingRevision);
  assert.deepEqual(afterWrongRecipient.world.events.map(event => event.id), pendingEventIds);
  assert.equal(afterWrongRecipient.world.xp, 100);

  const acceptAction = {
    type: 'accept-field-item-transfer',
    offerId: offerEvent.offerId,
    requestId: 'source-archive-recovery-restart-witness-accept-010'
  };
  const accepted = await witness.request('/api/action', acceptAction);
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
  const transferEvent = accepted.body.world.events.at(-1);
  assert.equal(transferEvent.type, 'field-item-transferred');
  assert.equal(transferEvent.offerId, offerEvent.offerId);
  assert.equal(transferEvent.itemId, forgeEvent.itemId);
  assert.equal(transferEvent.itemEventId, forgeEvent.id);
  assert.equal(transferEvent.fromActorId, 'damien');
  assert.equal(transferEvent.fromActorRole, 'founder');
  assert.equal(transferEvent.actor.id, witnessId);
  assert.equal(accepted.body.world.xp, 100);

  const acceptedStreamSnapshot = await witnessStreamAfterSecondRestart.next('world');
  assert.equal(acceptedStreamSnapshot.world.events.at(-1).id, transferEvent.id);

  const acceptedReplay = await witness.request('/api/action', acceptAction);
  assert.equal(acceptedReplay.response.status, 200);
  assert.equal(acceptedReplay.body.idempotentReplay, true);
  assert.equal(acceptedReplay.body.world.revision, accepted.body.world.revision);
  assert.equal(acceptedReplay.body.world.events.filter(event =>
    event.type === 'field-item-transferred'
  ).length, 1);
  assert.equal(acceptedReplay.body.world.xp, 100);

  const recipientEquipped = await witness.request('/api/action', {
    type: 'equip-field-item',
    slotId: 'recovery',
    sourceEventId: forgeEvent.id,
    requestId: 'source-archive-recovery-restart-witness-equip-011'
  });
  assert.equal(recipientEquipped.response.status, 200, JSON.stringify(recipientEquipped.body));
  const recipientEquipEvent = recipientEquipped.body.world.events.at(-1);
  assert.equal(recipientEquipEvent.type, 'field-item-equipped');
  assert.equal(recipientEquipEvent.actor.id, witnessId);
  assert.equal(recipientEquipEvent.sourceEventId, forgeEvent.id);
  assert.equal(recipientEquipped.body.world.xp, 100);

  const equippedStreamSnapshot = await witnessStreamAfterSecondRestart.next('world');
  assert.equal(equippedStreamSnapshot.world.events.at(-1).id, recipientEquipEvent.id);

  const finalWorld = recipientEquipped.body.world;
  const founderViewer = founderLoginAfterSecondRestart.body.viewer;
  const witnessViewer = witnessAfterSecondRestart.viewer;
  const founderFinal = projectCharacter(finalWorld, founderViewer);
  const witnessFinal = projectCharacter(finalWorld, witnessViewer);
  assert.equal(founderFinal.fieldInventoryTotal, 0);
  assert.equal(witnessFinal.fieldInventoryTotal, 1);
  const transferredItem = witnessFinal.fieldInventory.find(item =>
    item.eventId === forgeEvent.id
  );
  assert.ok(transferredItem);
  assert.equal(transferredItem.sourceKind, 'source-archive-recovery');
  assert.equal(transferredItem.creatorId, 'damien');
  assert.equal(transferredItem.ownerId, witnessId);
  assert.equal(transferredItem.sourceRecovery.failureEventId, failure.id);
  assert.equal(transferredItem.sourceRecovery.publicationEventId, publicationEvent.id);
  assert.equal(transferredItem.sourceRecovery.sha256, capture.action.sha256);
  assert.equal(transferredItem.transferHistory.length, 1);
  assert.equal(transferredItem.transferHistory[0].status, 'accepted');
  assert.equal(transferredItem.transferHistory[0].transferEventId, transferEvent.id);
  assert.equal(witnessFinal.equipment.find(slot => slot.id === 'recovery').source.eventId, forgeEvent.id);

  const founderArmorBearer = getQuestTrail(finalWorld, founderViewer).find(item =>
    item.id === 'founder-armor-bearer-delivery'
  );
  assert.ok(founderArmorBearer);
  assert.deepEqual(
    [founderArmorBearer.progress, founderArmorBearer.target, founderArmorBearer.complete],
    [4, 4, true]
  );
  assert.deepEqual(founderArmorBearer.evidenceIds, [
    forgeEvent.id, equipEvent.id, transferEvent.id, recipientEquipEvent.id
  ]);
  assert.equal(founderArmorBearer.countsForQuestkeeper, false);

  const witnessArmorBearer = getQuestTrail(finalWorld, witnessViewer).find(item =>
    item.id === 'witness-armor-bearer-delivery'
  );
  assert.ok(witnessArmorBearer);
  assert.deepEqual(
    [witnessArmorBearer.progress, witnessArmorBearer.target, witnessArmorBearer.complete],
    [2, 4, false]
  );
  assert.deepEqual(witnessArmorBearer.evidenceIds, [forgeEvent.id, recipientEquipEvent.id]);

  const completedRecoveryQuest = getQuestTrail(finalWorld, founderViewer).find(item =>
    item.id === recoveryQuestId
  );
  assert.ok(completedRecoveryQuest);
  assert.deepEqual(
    [completedRecoveryQuest.progress, completedRecoveryQuest.target, completedRecoveryQuest.complete],
    [4, 4, true]
  );
  assert.deepEqual(completedRecoveryQuest.evidenceIds, [
    failure.id, publicationEvent.id, forgeEvent.id, equipEvent.id
  ]);
  assert.equal(getQuestTrail(finalWorld, witnessViewer).some(item =>
    item.id === recoveryQuestId
  ), false);
  assert.equal(finalWorld.xp, 100,
    'publication is the only XP-producing action across both restart boundaries');
  assert.equal(finalWorld.events.filter(event =>
    event.type === 'source-archive-attempt-failed'
  ).length, 1);
  assert.equal(finalWorld.events.filter(event =>
    event.type === 'field-item-transferred'
  ).length, 1);
  assert.equal(attempts, 2);
  assert.equal(capture.calls.length, 1,
    'the successful later capture is the only successful fixture retrieval');
});
