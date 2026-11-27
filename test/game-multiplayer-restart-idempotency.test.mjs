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
    }
  };
}

test('a committed action replayed after server restart returns its original result without duplicating world history', { timeout: 20000 }, async t => {
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
  const committed = await client.request('/api/action', payload);
  assert.equal(committed.response.status, 200, JSON.stringify(committed.body));
  assert.equal(committed.body.idempotentReplay, false);
  const originalResult = committed.body.result;
  const originalEvent = committed.body.world.events.find(event => event.messageId === originalResult.messageId);
  assert.ok(originalEvent, 'the accepted response must identify the retained canonical event');
  const committedRevision = committed.body.world.revision;
  const committedXp = committed.body.world.xp;
  const committedEventIds = committed.body.world.events.map(event => event.id);

  // Deliberately discard the first response as a mobile client would after a
  // connection loss. The server has committed the event before it is stopped.
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
  assert.deepEqual(replay.body.result, originalResult,
    'the retry must return the original action result, not mint a replacement');
  assert.equal(replay.body.world.revision, committedRevision);
  assert.equal(replay.body.world.xp, committedXp);
  assert.deepEqual(replay.body.world.events.map(event => event.id), committedEventIds);
  assert.equal(replay.body.world.events.filter(event => event.id === originalEvent.id).length, 1,
    'exactly one canonical event must exist after the retry');

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
