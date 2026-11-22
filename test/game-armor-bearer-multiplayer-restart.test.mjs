import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../game/server.mjs';
import { projectCharacter } from '../game/character-sheet.mjs';
import { getQuestTrail } from '../game/quests.mjs';
import { findRoute, PLACES } from '../game/world-view.mjs';

const FOUNDER_KEY = 'test-founder-key-not-a-production-secret';

function makeClient(origin, initialCookie = '') {
  let cookie = initialCookie;
  let positionEpoch = null;
  let positionRevision = null;

  return {
    get cookie() { return cookie; },

    async request(path, body) {
      let payload = body;
      if (path === '/api/presence' && body && typeof body === 'object' &&
          !Object.hasOwn(body, 'positionEpoch') && !Object.hasOwn(body, 'positionRevision')) {
        if (typeof positionEpoch !== 'string' || !Number.isSafeInteger(positionRevision)) {
          throw new Error('Read shared state before submitting a position in this test client.');
        }
        payload = { ...body, positionEpoch, positionRevision };
      }

      const headers = { ...(cookie ? { cookie } : {}) };
      if (payload !== undefined) {
        headers['content-type'] = 'application/json';
        headers.origin = origin;
      }
      const response = await fetch(origin + path, {
        method: payload === undefined ? 'GET' : 'POST',
        body: payload === undefined ? undefined : JSON.stringify(payload),
        headers
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const contentType = response.headers.get('content-type') || '';
      const result = contentType.includes('json') ? await response.json() : await response.text();

      if (response.ok && path === '/api/state') {
        positionEpoch = result.viewer.positionEpoch;
        positionRevision = result.viewer.positionRevision;
      } else if (response.ok && path === '/api/presence') {
        positionEpoch = result.positionEpoch;
        positionRevision = result.positionRevision;
      }
      return { response, body: result };
    },

    async login() {
      const result = await this.request('/api/login', { key: FOUNDER_KEY, name: 'Damien' });
      assert.equal(result.response.status, 200, JSON.stringify(result.body));
      return result.body;
    },

    async stream() {
      const controller = new AbortController();
      const response = await fetch(origin + '/api/events', {
        headers: { cookie },
        signal: controller.signal
      });
      assert.equal(response.status, 200);
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const reader = response.body.getReader();
      let pending = '';

      return {
        close() { controller.abort(); },
        async next(type) {
          for (;;) {
            const split = pending.indexOf('\n\n');
            if (split >= 0) {
              const block = pending.slice(0, split);
              pending = pending.slice(split + 2);
              const event = /^event: (.+)$/m.exec(block)?.[1];
              const data = /^data: (.+)$/m.exec(block)?.[1];
              if (data && (!type || event === type)) return JSON.parse(data);
            }
            const chunk = await reader.read();
            if (chunk.done) throw new Error('Shared event stream ended before the expected event.');
            pending += new TextDecoder().decode(chunk.value);
          }
        }
      };
    }
  };
}

async function startRuntime(dataDir, movementClock) {
  const server = await createGameServer({ dataDir, founderKey: FOUNDER_KEY, movementClock });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    origin: 'http://127.0.0.1:' + server.address().port
  };
}

async function walkToGuide(advanceMovementTime, client, locationId) {
  const before = (await client.request('/api/state')).body;
  const target = PLACES.find(place => place.id === locationId && place.type === 'discovery');
  assert.ok(target, 'guide location must be part of the authored map');
  const route = findRoute(before.viewer.position, target, before.world.creations);
  assert.ok(route.length, 'a walkable route to the guide must exist');

  let cursor = before.viewer.position;
  let segmentDistance = 0;
  for (const point of [...route.slice(1), { x: target.x, y: target.y }]) {
    const step = Math.hypot(point.x - cursor.x, point.y - cursor.y);
    if (segmentDistance > 0 && segmentDistance + step > 300) {
      advanceMovementTime(2000);
      const moved = await client.request('/api/presence', { x: cursor.x, y: cursor.y });
      assert.equal(moved.response.status, 200, JSON.stringify(moved.body));
      segmentDistance = 0;
    }
    segmentDistance += step;
    cursor = point;
  }

  advanceMovementTime(2000);
  const moved = await client.request('/api/presence', { x: target.x, y: target.y });
  assert.equal(moved.response.status, 200, JSON.stringify(moved.body));
  assert.deepEqual(moved.body.position, { x: target.x, y: target.y });
}

function questMilestone(world, viewer) {
  const milestone = getQuestTrail(world, viewer).find(item =>
    item.id === viewer.role + '-armor-bearer-delivery'
  );
  assert.ok(milestone, 'the actor-scoped Armor Bearer objective must be present on the Quest Board');
  return milestone;
}

function skillCount(world, viewer, id) {
  const skill = projectCharacter(world, viewer).skills.find(item => item.id === id);
  assert.ok(skill, 'the character projection must expose the ' + id + ' skill');
  return skill.count;
}

test('the full Armor Bearer handoff is a two-session quest and survives a shared-world restart', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-armor-bearer-restart-'));
  let movementTime = 0;
  let runtime = await startRuntime(dataDir, () => movementTime);
  const closeRuntime = async () => {
    if (!runtime) return;
    const current = runtime;
    runtime = null;
    await current.server.closeGame();
  };
  t.after(async () => {
    await closeRuntime();
    await rm(dataDir, { recursive: true, force: true });
  });

  const advanceMovementTime = ms => { movementTime += ms; };
  const witness = makeClient(runtime.origin);
  const witnessInitial = await witness.request('/api/state');
  assert.equal(witnessInitial.response.status, 200);
  const witnessViewer = witnessInitial.body.viewer;

  await walkToGuide(advanceMovementTime, witness, 'river');
  const discovered = await witness.request('/api/action', {
    type: 'discover',
    locationId: 'river',
    requestId: 'armor-bearer-restart-discover'
  });
  assert.equal(discovered.response.status, 200, JSON.stringify(discovered.body));
  const sourceEvent = discovered.body.world.events.find(event =>
    event.type === 'discover' && event.actor?.id === witnessViewer.id &&
    event.actor?.role === 'witness'
  );
  assert.ok(sourceEvent, 'the source must be a retained discovery by the initiating bearer');
  const baselineXp = discovered.body.world.xp;

  const forgeAction = {
    type: 'forge-field-item',
    slotId: 'scouting',
    sourceEventId: sourceEvent.id,
    requestId: 'armor-bearer-restart-forge'
  };
  const forged = await witness.request('/api/action', forgeAction);
  assert.equal(forged.response.status, 200, JSON.stringify(forged.body));
  const forgeEvent = forged.body.world.events.at(-1);
  assert.equal(forgeEvent.type, 'field-item-forged');

  const bearerEquipAction = {
    type: 'equip-field-item',
    slotId: 'scouting',
    sourceEventId: forgeEvent.id,
    requestId: 'armor-bearer-restart-bearer-equip'
  };
  const bearerEquipped = await witness.request('/api/action', bearerEquipAction);
  assert.equal(bearerEquipped.response.status, 200, JSON.stringify(bearerEquipped.body));
  const bearerEquipEvent = bearerEquipped.body.world.events.at(-1);

  const bearerUnequipAction = {
    type: 'unequip-field-item',
    slotId: 'scouting',
    requestId: 'armor-bearer-restart-bearer-unequip'
  };
  const bearerUnequipped = await witness.request('/api/action', bearerUnequipAction);
  assert.equal(bearerUnequipped.response.status, 200, JSON.stringify(bearerUnequipped.body));

  const founder = makeClient(runtime.origin);
  await founder.login();
  const founderInitial = await founder.request('/api/state');
  assert.equal(founderInitial.response.status, 200);
  const founderViewer = founderInitial.body.viewer;
  assert.equal(founderViewer.role, 'founder');

  // The shared transfer protocol requires both actor sessions to be live.
  const witnessStream = await witness.stream();
  const founderStream = await founder.stream();
  t.after(() => {
    witnessStream.close();
    founderStream.close();
  });
  await witnessStream.next('world');
  await founderStream.next('world');

  const online = (await founder.request('/api/state')).body;
  assert.ok(online.presence.some(player =>
    player.actorId === witnessViewer.id && player.role === 'witness'
  ));
  assert.ok(online.presence.some(player =>
    player.actorId === founderViewer.id && player.role === 'founder'
  ));

  const offerAction = {
    type: 'offer-field-item-transfer',
    itemEventId: forgeEvent.id,
    recipientId: founderViewer.id,
    recipientRole: 'founder',
    requestId: 'armor-bearer-restart-offer'
  };
  const offered = await witness.request('/api/action', offerAction);
  assert.equal(offered.response.status, 200, JSON.stringify(offered.body));
  const offerEvent = offered.body.world.events.at(-1);
  assert.equal(offerEvent.type, 'field-item-transfer-offered');
  assert.equal(offerEvent.actor.id, witnessViewer.id);
  assert.equal(offerEvent.recipientId, founderViewer.id);

  const acceptAction = {
    type: 'accept-field-item-transfer',
    offerId: offerEvent.offerId,
    requestId: 'armor-bearer-restart-accept'
  };
  const accepted = await founder.request('/api/action', acceptAction);
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
  const transferEvent = accepted.body.world.events.at(-1);
  assert.equal(transferEvent.type, 'field-item-transferred');
  assert.equal(transferEvent.actor.id, founderViewer.id);
  assert.equal(accepted.body.world.xp, baselineXp, 'transfer acceptance must not award XP');

  const beforeRecipientEquip = await witness.request('/api/state');
  assert.equal(beforeRecipientEquip.response.status, 200);
  const incomplete = questMilestone(beforeRecipientEquip.body.world, beforeRecipientEquip.body.viewer);
  assert.equal(incomplete.progress, 3);
  assert.equal(incomplete.target, 4);
  assert.equal(incomplete.complete, false,
    'the original bearer must not complete the objective before the designated recipient equips');
  assert.deepEqual(incomplete.evidenceIds, [
    forgeEvent.id, bearerEquipEvent.id, transferEvent.id
  ]);

  const witnessBeforeRecipientEquip = projectCharacter(
    beforeRecipientEquip.body.world, beforeRecipientEquip.body.viewer
  );
  const founderBeforeRecipientEquip = projectCharacter(
    beforeRecipientEquip.body.world, founderViewer
  );
  assert.equal(witnessBeforeRecipientEquip.fieldInventoryTotal, 0);
  assert.equal(founderBeforeRecipientEquip.fieldInventoryTotal, 1);
  assert.equal(skillCount(beforeRecipientEquip.body.world, beforeRecipientEquip.body.viewer, 'forger'), 1);
  assert.equal(skillCount(beforeRecipientEquip.body.world, beforeRecipientEquip.body.viewer, 'armorer'), 1);
  assert.equal(skillCount(beforeRecipientEquip.body.world, beforeRecipientEquip.body.viewer, 'armor-bearer'), 1);
  assert.equal(skillCount(beforeRecipientEquip.body.world, founderViewer, 'forger'), 0);
  assert.equal(skillCount(beforeRecipientEquip.body.world, founderViewer, 'armorer'), 0);
  assert.equal(skillCount(beforeRecipientEquip.body.world, founderViewer, 'armor-bearer'), 0);

  const recipientEquipAction = {
    type: 'equip-field-item',
    slotId: 'scouting',
    sourceEventId: forgeEvent.id,
    requestId: 'armor-bearer-restart-recipient-equip'
  };
  const recipientEquipped = await founder.request('/api/action', recipientEquipAction);
  assert.equal(recipientEquipped.response.status, 200, JSON.stringify(recipientEquipped.body));
  const recipientEquipEvent = recipientEquipped.body.world.events.at(-1);
  assert.equal(recipientEquipEvent.type, 'field-item-equipped');
  assert.equal(recipientEquipEvent.actor.id, founderViewer.id);

  const completed = questMilestone(recipientEquipped.body.world, witnessViewer);
  assert.equal(completed.progress, 4);
  assert.equal(completed.complete, true);
  assert.deepEqual(completed.evidenceIds, [
    forgeEvent.id, bearerEquipEvent.id, transferEvent.id, recipientEquipEvent.id
  ]);
  const recipientMilestone = questMilestone(recipientEquipped.body.world, founderViewer);
  assert.equal(recipientMilestone.progress, 2);
  assert.equal(recipientMilestone.complete, false,
    'receiving and equipping prepares the recipient to carry an item onward; it does not award the prior bearer’s completed chain');

  const witnessRecord = projectCharacter(recipientEquipped.body.world, witnessViewer);
  const founderRecord = projectCharacter(recipientEquipped.body.world, founderViewer);
  assert.equal(witnessRecord.fieldInventoryTotal, 0);
  assert.equal(founderRecord.fieldInventoryTotal, 1);
  assert.equal(witnessRecord.fieldInventory[0], undefined);
  assert.equal(founderRecord.fieldInventory[0].sourceEventId, sourceEvent.id);
  assert.equal(founderRecord.fieldInventory[0].creatorId, witnessViewer.id);
  assert.equal(founderRecord.fieldInventory[0].ownerId, founderViewer.id);
  assert.equal(skillCount(recipientEquipped.body.world, witnessViewer, 'armor-bearer'), 1);
  assert.equal(skillCount(recipientEquipped.body.world, founderViewer, 'armor-bearer'), 0);
  assert.equal(skillCount(recipientEquipped.body.world, founderViewer, 'armorer'), 1);
  assert.equal(recipientEquipped.body.world.xp, baselineXp,
    'all four Armor Bearer steps are progression records, not XP');

  const finalRevision = recipientEquipped.body.world.revision;
  const finalEventIds = recipientEquipped.body.world.events.map(event => event.id);
  const witnessCookie = witness.cookie;
  const founderCookie = founder.cookie;
  witnessStream.close();
  founderStream.close();
  await closeRuntime();

  runtime = await startRuntime(dataDir, () => movementTime);
  const restoredWitness = makeClient(runtime.origin, witnessCookie);
  const restoredWitnessState = await restoredWitness.request('/api/state');
  assert.equal(restoredWitnessState.response.status, 200, JSON.stringify(restoredWitnessState.body));
  assert.equal(restoredWitnessState.body.viewer.id, witnessViewer.id);

  const restoredFounder = makeClient(runtime.origin, founderCookie);
  const founderLogin = await restoredFounder.login();
  assert.equal(founderLogin.viewer.id, founderViewer.id);
  assert.notEqual(restoredFounder.cookie, founderCookie,
    'Founder re-authentication rotates the session cookie after restart');
  const restoredFounderState = await restoredFounder.request('/api/state');
  assert.equal(restoredFounderState.response.status, 200, JSON.stringify(restoredFounderState.body));

  for (const state of [restoredWitnessState.body, restoredFounderState.body]) {
    assert.equal(state.world.revision, finalRevision);
    assert.deepEqual(state.world.events.map(event => event.id), finalEventIds);
    assert.equal(state.world.xp, baselineXp);
  }

  const restoredCompleted = questMilestone(
    restoredWitnessState.body.world, restoredWitnessState.body.viewer
  );
  assert.equal(restoredCompleted.progress, 4);
  assert.equal(restoredCompleted.complete, true);
  assert.deepEqual(restoredCompleted.evidenceIds, completed.evidenceIds);

  const restoredRecipientMilestone = questMilestone(
    restoredFounderState.body.world, restoredFounderState.body.viewer
  );
  assert.equal(restoredRecipientMilestone.progress, 2);
  assert.equal(restoredRecipientMilestone.complete, false);

  const restoredWitnessRecord = projectCharacter(
    restoredWitnessState.body.world, restoredWitnessState.body.viewer
  );
  const restoredFounderRecord = projectCharacter(
    restoredFounderState.body.world, restoredFounderState.body.viewer
  );
  assert.equal(restoredWitnessRecord.fieldInventoryTotal, 0);
  assert.equal(restoredFounderRecord.fieldInventoryTotal, 1);
  assert.equal(restoredFounderRecord.fieldInventory[0].ownerId, founderViewer.id);
  assert.equal(skillCount(restoredWitnessState.body.world, restoredWitnessState.body.viewer, 'forger'), 1);
  assert.equal(skillCount(restoredWitnessState.body.world, restoredWitnessState.body.viewer, 'armorer'), 1);
  assert.equal(skillCount(restoredWitnessState.body.world, restoredWitnessState.body.viewer, 'armor-bearer'), 1);
  assert.equal(skillCount(restoredFounderState.body.world, restoredFounderState.body.viewer, 'forger'), 0);
  assert.equal(skillCount(restoredFounderState.body.world, restoredFounderState.body.viewer, 'armorer'), 1);
  assert.equal(skillCount(restoredFounderState.body.world, restoredFounderState.body.viewer, 'armor-bearer'), 0);

  const replay = await restoredFounder.request('/api/action', recipientEquipAction);
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(replay.body.world.revision, finalRevision);
  assert.equal(replay.body.world.events.filter(event => event.type === 'field-item-transferred').length, 1);
  assert.equal(replay.body.world.events.filter(event => event.type === 'field-item-equipped').length, 2);
  assert.equal(replay.body.world.events.filter(event => event.type === 'field-item-unequipped').length, 1);
  assert.equal(replay.body.world.xp, baselineXp);
  assert.equal(questMilestone(replay.body.world, restoredWitnessState.body.viewer).progress, 4);
});
