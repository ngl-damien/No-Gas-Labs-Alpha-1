import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../game/server.mjs';

const FOUNDER_KEY = 'test-restart-idempotency-key-not-production';

function makeClient(origin) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    setOrigin(next) { origin = next; },
    async request(path, payload) {
      const headers = cookie ? { cookie } : {};
      if (payload !== undefined) {
        headers.origin = origin;
        headers['content-type'] = 'application/json';
      }
      const response = await fetch(origin + path, {
        method: payload === undefined ? 'GET' : 'POST',
        headers,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { response, body: await response.json() };
    },
    async sendAndDiscard(path, payload) {
      const headers = cookie ? { cookie } : {};
      headers.origin = origin;
      headers['content-type'] = 'application/json';
      const response = await fetch(origin + path, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const status = response.status;
      // Do not parse, clone, or inspect the action response body. This client
      // intentionally loses the response payload as a disconnected phone would.
      await response.body?.cancel();
      return { status };
    }
  };
}

test('a client that loses its action response can replay safely after server restart', { timeout: 20000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-restart-idempotency-'));
  let game = await createGameServer({ dataDir, founderKey: FOUNDER_KEY });
  await new Promise(resolve => game.listen(0, '127.0.0.1', resolve));
  let origin = `http://127.0.0.1:${game.address().port}`;
  const client = makeClient(origin);
  t.after(async () => {
    await game.closeGame();
    await rm(dataDir, { recursive: true, force: true });
  });

  const initial = await client.request('/api/state');
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.viewer.role, 'witness');

  const payload = {
    type: 'post-message',
    text: 'This action must remain exactly-once even if its response is lost during a restart.',
    requestId: 'restart-replay-commons-001'
  };
  const lostResponse = await client.sendAndDiscard('/api/action', payload);
  assert.equal(lostResponse.status, 200,
    'the action endpoint must accept the request even though its body is discarded');

  // This is a separate, independently observable state read—not the action
  // response. It establishes what the server committed before it is restarted.
  const committedState = await client.request('/api/state');
  assert.equal(committedState.response.status, 200);
  assert.equal(committedState.body.viewer.id, initial.body.viewer.id);
  const committedEvent = committedState.body.world.events.find(event =>
    event.requestId === payload.requestId
  );
  assert.ok(committedEvent, 'the independent state read must expose the committed event');
  assert.equal(committedEvent.actor.id, initial.body.viewer.id);
  assert.ok(committedEvent.messageId, 'the retained event must identify its Commons message');
  const committedRevision = committedState.body.world.revision;
  const committedXp = committedState.body.world.xp;
  const committedEventIds = committedState.body.world.events.map(event => event.id);
  assert.equal(committedRevision, initial.body.world.revision + 1);
  assert.equal(committedXp, initial.body.world.xp,
    'Commons communication is not earned progression');
  assert.equal(committedState.body.world.events.filter(event =>
    event.requestId === payload.requestId
  ).length, 1);

  // Restart against the same durable directory, retaining only the opaque
  // client cookie and request identity—not the lost action response.
  await game.closeGame();
  game = await createGameServer({ dataDir, founderKey: FOUNDER_KEY });
  await new Promise(resolve => game.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${game.address().port}`;
  client.setOrigin(origin);

  const restored = await client.request('/api/state');
  assert.equal(restored.response.status, 200);
  assert.equal(restored.body.viewer.id, initial.body.viewer.id,
    'the surviving session cookie must still identify the original actor');
  assert.equal(restored.body.world.revision, committedRevision);
  assert.deepEqual(restored.body.world.events.map(event => event.id), committedEventIds);
  assert.equal(restored.body.world.xp, committedXp);

  const replay = await client.request('/api/action', payload);
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.idempotentReplay, true,
    'the restarted server must identify the retry as a replay');
  assert.equal(replay.body.requestId, payload.requestId);
  assert.equal(replay.body.result.messageId, committedEvent.messageId,
    'the retry must return the message identified by independent retained state');
  assert.equal(replay.body.world.revision, committedRevision);
  assert.equal(replay.body.world.xp, committedXp);
  assert.deepEqual(replay.body.world.events.map(event => event.id), committedEventIds);
  assert.equal(replay.body.world.events.filter(event =>
    event.requestId === payload.requestId
  ).length, 1, 'exactly one canonical event must exist after the retry');
  assert.equal(replay.body.world.events.find(event =>
    event.requestId === payload.requestId
  ).id, committedEvent.id);

  const conflictingReplay = await client.request('/api/action', {
    ...payload,
    text: 'Changed content must not reuse the original request identity.'
  });
  assert.equal(conflictingReplay.response.status, 409);
  assert.equal(conflictingReplay.body.error?.code, 'IDEMPOTENCY_CONFLICT');
  const afterConflict = await client.request('/api/state');
  assert.equal(afterConflict.body.world.revision, committedRevision);
  assert.equal(afterConflict.body.world.xp, committedXp);
  assert.deepEqual(afterConflict.body.world.events.map(event => event.id), committedEventIds);
});
