import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../game/server.mjs';

const FOUNDER_KEY = 'test-multiplayer-concurrency-key-not-production';

function client(origin) {
  let cookie = '';
  return {
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

test('concurrent multiplayer actions serialize, replay idempotently, and reject cross-player request-ID collisions', { timeout: 20000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-multiplayer-concurrency-'));
  const game = await createGameServer({ dataDir, founderKey: FOUNDER_KEY });
  await new Promise(resolve => game.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${game.address().port}`;
  const first = client(origin);
  const second = client(origin);
  t.after(async () => {
    await game.closeGame();
    await rm(dataDir, { recursive: true, force: true });
  });

  const [firstInitial, secondInitial] = await Promise.all([
    first.request('/api/state'),
    second.request('/api/state')
  ]);
  assert.equal(firstInitial.response.status, 200);
  assert.equal(secondInitial.response.status, 200);
  assert.notEqual(firstInitial.body.viewer.id, secondInitial.body.viewer.id);
  assert.equal(firstInitial.body.world.revision, secondInitial.body.world.revision);
  const initialRevision = firstInitial.body.world.revision;
  const initialXp = firstInitial.body.world.xp;

  const firstAction = {
    type: 'post-message',
    text: 'Concurrent player A contribution.',
    requestId: 'concurrent-player-a-001'
  };
  const secondAction = {
    type: 'post-message',
    text: 'Concurrent player B contribution.',
    requestId: 'concurrent-player-b-001'
  };
  const [firstPosted, secondPosted] = await Promise.all([
    first.request('/api/action', firstAction),
    second.request('/api/action', secondAction)
  ]);
  assert.equal(firstPosted.response.status, 200, JSON.stringify(firstPosted.body));
  assert.equal(secondPosted.response.status, 200, JSON.stringify(secondPosted.body));
  assert.equal(firstPosted.body.idempotentReplay, false);
  assert.equal(secondPosted.body.idempotentReplay, false);

  const [firstState, secondState] = await Promise.all([
    first.request('/api/state'),
    second.request('/api/state')
  ]);
  for (const state of [firstState, secondState]) {
    assert.equal(state.response.status, 200);
    assert.equal(state.body.world.revision, initialRevision + 2,
      'two accepted concurrent actions must append exactly two revisions');
    assert.equal(state.body.world.xp, initialXp,
      'Commons communication is not earned progression');
    assert.deepEqual(
      state.body.world.events.map(event => event.id),
      firstState.body.world.events.map(event => event.id),
      'both clients must observe one identical retained event sequence'
    );
  }

  const firstEvent = firstState.body.world.events.find(event => event.messageId === firstPosted.body.result.messageId);
  const secondEvent = firstState.body.world.events.find(event => event.messageId === secondPosted.body.result.messageId);
  assert.ok(firstEvent);
  assert.ok(secondEvent);
  assert.notEqual(firstEvent.id, secondEvent.id);
  assert.equal(firstEvent.actor.id, firstInitial.body.viewer.id);
  assert.equal(firstEvent.actor.role, 'witness');
  assert.equal(secondEvent.actor.id, secondInitial.body.viewer.id);
  assert.equal(secondEvent.actor.role, 'witness');

  const revisionAfterConcurrentActions = firstState.body.world.revision;
  const replay = await first.request('/api/action', firstAction);
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(replay.body.result.messageId, firstPosted.body.result.messageId);

  const collision = await second.request('/api/action', {
    ...firstAction,
    text: 'A different player attempts to reuse the first player request key.'
  });
  assert.equal(collision.response.status, 409);
  assert.equal(collision.body.error?.code, 'IDEMPOTENCY_CONFLICT');

  const [afterFirst, afterSecond] = await Promise.all([
    first.request('/api/state'),
    second.request('/api/state')
  ]);
  for (const state of [afterFirst, afterSecond]) {
    assert.equal(state.body.world.revision, revisionAfterConcurrentActions,
      'same-player replay and cross-player key collision must not append events');
    assert.equal(state.body.world.events.filter(event =>
      event.requestId === firstAction.requestId
    ).length, 1);
    assert.equal(state.body.world.events.length, afterFirst.body.world.events.length);
    assert.equal(state.body.world.xp, initialXp);
  }
  assert.deepEqual(
    afterFirst.body.world.events.map(event => event.id),
    afterSecond.body.world.events.map(event => event.id)
  );
});
