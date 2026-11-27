import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../game/server.mjs';

const FOUNDER_KEY = 'test-multiplayer-presence-key-not-production';

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
      const body = await response.json();
      return { response, body };
    },
    async stream() {
      const controller = new AbortController();
      const response = await fetch(origin + '/api/events', {
        headers: { cookie },
        signal: controller.signal
      });
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      return {
        close() { controller.abort(); },
        async next(expectedType) {
          for (;;) {
            const boundary = pending.indexOf('\n\n');
            if (boundary >= 0) {
              const block = pending.slice(0, boundary);
              pending = pending.slice(boundary + 2);
              const type = /^event: (.+)$/m.exec(block)?.[1];
              const data = /^data: (.+)$/m.exec(block)?.[1];
              if (data && (!expectedType || type === expectedType)) return JSON.parse(data);
              continue;
            }
            const chunk = await reader.read();
            if (chunk.done) throw new Error('Shared event stream ended before the expected event.');
            pending += decoder.decode(chunk.value, { stream: true });
          }
        }
      };
    }
  };
}

function playerById(presence, actorId) {
  return presence.find(player => player.actorId === actorId);
}

test('two independent Witness clients share authoritative world events and recover identity and position after server restart', { timeout: 20000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-two-client-world-'));
  let movementTime = 0;
  let game = await createGameServer({
    dataDir,
    founderKey: FOUNDER_KEY,
    movementClock: () => movementTime
  });
  await new Promise(resolve => game.listen(0, '127.0.0.1', resolve));
  let origin = `http://127.0.0.1:${game.address().port}`;
  const first = makeClient(origin);
  const second = makeClient(origin);
  let firstStream, secondStream;
  t.after(async () => {
    firstStream?.close();
    secondStream?.close();
    await game.closeGame();
    await rm(dataDir, { recursive: true, force: true });
  });

  const firstInitial = await first.request('/api/state');
  const secondInitial = await second.request('/api/state');
  assert.equal(firstInitial.response.status, 200);
  assert.equal(secondInitial.response.status, 200);
  assert.equal(firstInitial.body.viewer.role, 'witness');
  assert.equal(secondInitial.body.viewer.role, 'witness');
  assert.notEqual(first.cookie, second.cookie, 'each HTTP client must hold a distinct session cookie');
  assert.notEqual(firstInitial.body.viewer.id, secondInitial.body.viewer.id,
    'separate sessions must not collapse into one player identity');
  assert.notEqual(firstInitial.body.viewer.presenceId, secondInitial.body.viewer.presenceId);
  assert.equal(firstInitial.body.world.revision, secondInitial.body.world.revision);

  firstStream = await first.stream();
  assert.equal((await firstStream.next('world')).viewer.id, firstInitial.body.viewer.id);
  const firstOnlyPresence = await firstStream.next('presence');
  assert.ok(playerById(firstOnlyPresence, firstInitial.body.viewer.id));
  assert.equal(playerById(firstOnlyPresence, secondInitial.body.viewer.id), undefined);

  secondStream = await second.stream();
  assert.equal((await secondStream.next('world')).viewer.id, secondInitial.body.viewer.id);
  const presenceAtFirst = await firstStream.next('presence');
  const presenceAtSecond = await secondStream.next('presence');
  for (const presence of [presenceAtFirst, presenceAtSecond]) {
    assert.ok(playerById(presence, firstInitial.body.viewer.id));
    assert.ok(playerById(presence, secondInitial.body.viewer.id));
    assert.equal(presence.length, 2);
  }

  movementTime += 2000;
  const moved = await first.request('/api/presence', {
    x: 220,
    y: 640,
    positionEpoch: firstInitial.body.viewer.positionEpoch,
    positionRevision: firstInitial.body.viewer.positionRevision
  });
  assert.equal(moved.response.status, 200, JSON.stringify(moved.body));
  assert.deepEqual(moved.body.position, { x: 220, y: 640 });
  const movementAtFirst = await firstStream.next('presence');
  const movementAtSecond = await secondStream.next('presence');
  for (const presence of [movementAtFirst, movementAtSecond]) {
    assert.deepEqual(
      { x: playerById(presence, firstInitial.body.viewer.id).x, y: playerById(presence, firstInitial.body.viewer.id).y },
      { x: 220, y: 640 }
    );
    assert.deepEqual(
      { x: playerById(presence, secondInitial.body.viewer.id).x, y: playerById(presence, secondInitial.body.viewer.id).y },
      { x: 180, y: 640 },
      'one session movement must not borrow or overwrite the other session position'
    );
  }

  const message = await second.request('/api/action', {
    type: 'post-message',
    text: 'Two independent sessions can contribute to one retained Commons stream.',
    requestId: 'two-client-shared-commons-001'
  });
  assert.equal(message.response.status, 200, JSON.stringify(message.body));
  const worldAtFirst = await firstStream.next('world');
  const worldAtSecond = await secondStream.next('world');
  const retained = worldAtFirst.world.events.find(event => event.messageId === message.body.result.messageId);
  assert.ok(retained, 'the first client must receive the second client’s retained world event');
  assert.equal(retained.type, 'message-posted');
  assert.equal(retained.actor.id, secondInitial.body.viewer.id);
  assert.equal(retained.actor.role, 'witness');
  assert.equal(worldAtSecond.world.events.find(event => event.messageId === message.body.result.messageId)?.id, retained.id,
    'both clients must observe the same canonical event identity');
  assert.equal(worldAtFirst.world.revision, worldAtSecond.world.revision);
  assert.equal(worldAtFirst.world.xp, firstInitial.body.world.xp,
    'presence and Commons communication do not award progression XP');

  const firstState = await first.request('/api/state');
  const secondState = await second.request('/api/state');
  assert.equal(firstState.body.world.revision, secondState.body.world.revision);
  assert.deepEqual(firstState.body.world.events.map(event => event.id), secondState.body.world.events.map(event => event.id));
  assert.equal(firstState.body.viewer.id, firstInitial.body.viewer.id);
  assert.equal(secondState.body.viewer.id, secondInitial.body.viewer.id);
  assert.deepEqual(firstState.body.viewer.position, { x: 220, y: 640 });
  assert.deepEqual(secondState.body.viewer.position, { x: 180, y: 640 });
  assert.equal(firstState.body.world.xp, secondState.body.world.xp);

  // Simulate both mobile clients losing their streams while the authoritative
  // process is replaced. Keep their opaque Witness cookies: the server must
  // reconstruct the same pseudonymous identities and saved positions, not mint
  // fresh players or infer Founder authority.
  firstStream.close();
  secondStream.close();
  firstStream = undefined;
  secondStream = undefined;
  await game.closeGame();

  game = await createGameServer({
    dataDir,
    founderKey: FOUNDER_KEY,
    movementClock: () => movementTime
  });
  await new Promise(resolve => game.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${game.address().port}`;
  first.setOrigin(origin);
  second.setOrigin(origin);

  const firstRestored = await first.request('/api/state');
  const secondRestored = await second.request('/api/state');
  assert.equal(firstRestored.response.status, 200);
  assert.equal(secondRestored.response.status, 200);
  assert.equal(firstRestored.body.viewer.id, firstInitial.body.viewer.id,
    'the first surviving opaque cookie must recover the same pseudonymous player identity');
  assert.equal(secondRestored.body.viewer.id, secondInitial.body.viewer.id,
    'the second surviving opaque cookie must recover the same pseudonymous player identity');
  assert.equal(firstRestored.body.viewer.presenceId, firstInitial.body.viewer.presenceId);
  assert.equal(secondRestored.body.viewer.presenceId, secondInitial.body.viewer.presenceId);
  assert.deepEqual(firstRestored.body.viewer.position, { x: 220, y: 640 });
  assert.deepEqual(secondRestored.body.viewer.position, { x: 180, y: 640 });
  assert.equal(firstRestored.body.world.revision, firstState.body.world.revision);
  assert.equal(secondRestored.body.world.revision, firstState.body.world.revision);
  assert.deepEqual(firstRestored.body.world.events.map(event => event.id),
    secondRestored.body.world.events.map(event => event.id));
  const restoredMessage = firstRestored.body.world.events.find(event => event.id === retained.id);
  assert.deepEqual(restoredMessage, retained,
    'the exact shared Commons event and actor attribution must survive process replacement');
  assert.equal(firstRestored.body.world.xp, firstState.body.world.xp);
  assert.equal(secondRestored.body.world.xp, secondState.body.world.xp);

  firstStream = await first.stream();
  assert.equal((await firstStream.next('world')).viewer.id, firstInitial.body.viewer.id);
  const restoredFirstOnlyPresence = await firstStream.next('presence');
  assert.ok(playerById(restoredFirstOnlyPresence, firstInitial.body.viewer.id));
  assert.equal(playerById(restoredFirstOnlyPresence, secondInitial.body.viewer.id), undefined);

  secondStream = await second.stream();
  assert.equal((await secondStream.next('world')).viewer.id, secondInitial.body.viewer.id);
  const rejoinedAtFirst = await firstStream.next('presence');
  const rejoinedAtSecond = await secondStream.next('presence');
  for (const presence of [rejoinedAtFirst, rejoinedAtSecond]) {
    assert.equal(presence.length, 2,
      'both reconnected clients must converge on the same two-player presence set');
    assert.deepEqual(
      { x: playerById(presence, firstInitial.body.viewer.id).x, y: playerById(presence, firstInitial.body.viewer.id).y },
      { x: 220, y: 640 }
    );
    assert.deepEqual(
      { x: playerById(presence, secondInitial.body.viewer.id).x, y: playerById(presence, secondInitial.body.viewer.id).y },
      { x: 180, y: 640 }
    );
  }
});
