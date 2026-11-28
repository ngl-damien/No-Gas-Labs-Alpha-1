import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../game/server.mjs';

const FOUNDER_KEY = 'test-total-response-loss-key-not-production';

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

/**
 * A one-request fault-injection proxy that lets the upstream game finish its
 * response, consumes that response itself, and then resets the downstream
 * socket before sending any HTTP status or headers to the simulated phone.
 */
async function loseEntireActionResponse({ origin, cookie, payload }) {
  let upstreamStatus = null;
  const proxy = createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const upstream = await fetch(origin + incoming.url, {
        method: incoming.method,
        headers: {
          cookie,
          origin,
          'content-type': incoming.headers['content-type'] || 'application/json'
        },
        body: Buffer.concat(chunks)
      });
      upstreamStatus = upstream.status;
      await upstream.arrayBuffer();
      // No response headers or body are forwarded. The client sees a transport
      // failure even though the upstream action has already completed.
      outgoing.destroy();
    } catch {
      outgoing.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', resolve);
  });
  const proxyOrigin = `http://127.0.0.1:${proxy.address().port}`;
  let clientError = null;
  try {
    await fetch(proxyOrigin + '/api/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    clientError = error;
  } finally {
    await new Promise(resolve => proxy.close(resolve));
  }
  return { clientError, upstreamStatus };
}

test('a client receiving no HTTP response can recover a committed action after restart', { timeout: 20000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-total-response-loss-'));
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
    text: 'The server commits this action, but the phone receives no HTTP response at all.',
    requestId: 'restart-total-response-loss-001'
  };
  const dropped = await loseEntireActionResponse({ origin, cookie: client.cookie, payload });
  assert.ok(dropped.clientError, 'the simulated phone must observe a transport failure, not an HTTP response');
  assert.equal(dropped.upstreamStatus, 200,
    'the proxy must observe successful upstream completion before dropping the entire downstream response');

  // Independently observe the committed event; never infer commit from the
  // transport failure or from a response body that the client did not receive.
  const committed = await client.request('/api/state');
  assert.equal(committed.response.status, 200);
  assert.equal(committed.body.viewer.id, initial.body.viewer.id);
  const event = committed.body.world.events.find(item => item.requestId === payload.requestId);
  assert.ok(event, 'the server must have committed the action before the response was dropped');
  assert.equal(event.actor.id, initial.body.viewer.id);
  assert.ok(event.messageId);
  const revision = committed.body.world.revision;
  const xp = committed.body.world.xp;
  const eventIds = committed.body.world.events.map(item => item.id);
  assert.equal(revision, initial.body.world.revision + 1);
  assert.equal(xp, initial.body.world.xp, 'Commons communication is not earned progression');
  assert.equal(committed.body.world.events.filter(item => item.requestId === payload.requestId).length, 1);

  // Recreate the process with the same durable directory. Keep only the
  // original opaque session cookie and request identity.
  await game.closeGame();
  game = await createGameServer({ dataDir, founderKey: FOUNDER_KEY });
  await new Promise(resolve => game.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${game.address().port}`;
  client.setOrigin(origin);

  const restored = await client.request('/api/state');
  assert.equal(restored.response.status, 200);
  assert.equal(restored.body.viewer.id, initial.body.viewer.id);
  assert.equal(restored.body.world.revision, revision);
  assert.equal(restored.body.world.xp, xp);
  assert.deepEqual(restored.body.world.events.map(item => item.id), eventIds);

  const replay = await client.request('/api/action', payload);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(replay.body.requestId, payload.requestId);
  assert.equal(replay.body.result.messageId, event.messageId);
  assert.equal(replay.body.world.revision, revision);
  assert.equal(replay.body.world.xp, xp);
  assert.deepEqual(replay.body.world.events.map(item => item.id), eventIds);
  assert.equal(replay.body.world.events.filter(item => item.requestId === payload.requestId).length, 1);
  assert.equal(replay.body.world.events.find(item => item.requestId === payload.requestId).id, event.id);

  const conflict = await client.request('/api/action', {
    ...payload,
    text: 'A different action must not reuse the request identity.'
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error?.code, 'IDEMPOTENCY_CONFLICT');
  const afterConflict = await client.request('/api/state');
  assert.equal(afterConflict.body.world.revision, revision);
  assert.equal(afterConflict.body.world.xp, xp);
  assert.deepEqual(afterConflict.body.world.events.map(item => item.id), eventIds);
});
