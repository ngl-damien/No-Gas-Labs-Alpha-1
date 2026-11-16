import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../game/server.mjs';
import { buildGitHubSourceArchiveBody } from '../game/artifacts.mjs';

const FOUNDER_KEY = 'test-source-archive-restart-founder-key';

async function sourceArchiveHtml(source) {
  const bytes = Buffer.from(source, 'utf8');
  const repository = 'ngl-damien/No-Gas-Labs-Alpha-1';
  const commitSha = 'f'.repeat(40);
  const path = 'test/fixtures/restart-private-source.mjs';
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const gitBlobSha = createHash('sha1')
    .update('blob ' + bytes.length + String.fromCharCode(0))
    .update(bytes)
    .digest('hex');
  return buildGitHubSourceArchiveBody({
    schema: 'ngl.github-source-capture.v1',
    captureId: JSON.stringify([repository, commitSha, path, sha256]),
    repository,
    commitSha,
    path,
    permalink: 'https://github.com/' + repository + '/blob/' + commitSha + '/' + path,
    gitBlobSha,
    sha256,
    size: bytes.length,
    bytesBase64: bytes.toString('base64'),
    fetchedAt: '2026-11-16T05:00:00.000Z',
    capturedAt: '2026-11-16T05:01:00.000Z',
    text: source,
    integrityStatus: 'hashes-match'
  });
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

async function startServer(dataDir) {
  const server = await createGameServer({ dataDir, founderKey: FOUNDER_KEY });
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

  const first = await startServer(dataDir);
  servers.push(first.server);
  const founderBeforeRestart = makeClient(first.origin);
  assert.equal((await founderBeforeRestart.request('/api/login', {
    key: FOUNDER_KEY,
    name: 'Damien'
  })).body.viewer.role, 'founder');

  const source = 'export const PRIVATE_SOURCE = "NGL_SOURCE_ARCHIVE_RESTART_PRIVATE";\n';
  const sourceBytesBase64 = Buffer.from(source, 'utf8').toString('base64');
  const html = await sourceArchiveHtml(source);
  const draft = await founderBeforeRestart.request('/api/action', {
    type: 'draft',
    kind: 'custom',
    title: 'Private Source Archive · Restart Boundary',
    intent: 'Client-rechecked bytes; source origin and truth remain unverified.',
    html
  });
  assert.equal(draft.response.status, 200, JSON.stringify(draft.body));
  const draftId = draft.body.result.draftId;
  const founderDraft = (await founderBeforeRestart.request('/api/state')).body;
  assert.equal(founderDraft.world.drafts.length, 1);
  const retainedHtml = founderDraft.world.drafts[0].html;
  assert.ok(retainedHtml.includes(html));
  assert.ok(retainedHtml.includes(sourceBytesBase64));
  assert.equal(founderDraft.world.xp, 0, 'private drafting is not progression');
  const privateRevision = founderDraft.world.revision;

  await first.server.closeGame();

  const restarted = await startServer(dataDir);
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
  const creation = published.body.world.creations.find(item => item.title === 'Private Source Archive · Restart Boundary');
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
