import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidFieldItemSourceEventIndex, MAX_FIELD_INVENTORY_ITEMS, projectFieldItemState,
  projectValidFieldItemForgeEvents, projectValidFieldItemSourceEventIds
} from '../game/field-items.mjs';
import { projectCharacter } from '../game/character-sheet.mjs';
import { getQuestTrail } from '../game/quests.mjs';

const founder = { id: 'founder-1', role: 'founder' };
const witness = { id: 'witness-1', role: 'witness' };
const third = { id: 'witness-2', role: 'witness' };
const slotIds = ['scouting'];
const t1 = '2026-10-25T12:00:00.000Z';
const t2 = '2026-10-25T12:01:00.000Z';
const t3 = '2026-10-25T12:02:00.000Z';
const t4 = '2026-10-25T12:03:00.000Z';
const t5 = '2026-10-25T12:04:00.000Z';
const t6 = '2026-10-25T12:05:00.000Z';

function sourceAndForge() {
  return [
    { id: 'source', type: 'discover', actor: witness, at: t1, locationId: 'river' },
    { id: 'forge', type: 'field-item-forged', itemId: 'item-1', slotId: 'scouting',
      sourceEventId: 'source', actor: witness, at: t2 }
  ];
}
function sourceWorld(events = sourceAndForge(), { discoveries = null } = {}) {
  const discoveryRecords = discoveries ?? events
    .filter(event => event?.type === 'discover')
    .map((event, index) => ({
      id: 'discovery-record-' + index,
      locationId: event.locationId,
      actor: event.actor,
      at: event.at
    }));
  return {
    id: 'field-item-test-world',
    revision: events.length,
    events,
    creations: [],
    discoveries: discoveryRecords,
    contributions: [],
    reports: [],
    methods: []
  };
}

function contributionForgeWorld(count, otherActor = null) {
  const creationId = 'source-creation';
  const publicationAt = t1;
  const creation = {
    id: creationId, kind: 'custom', title: 'Retained source', intent: '',
    version: 1, publishedAt: publicationAt,
    receipt: { algorithm: 'sha256', digest: 'a'.repeat(64), size: 0 },
    versions: []
  };
  const events = [{
    id: 'publication', type: 'publish', actor: founder, at: publicationAt,
    creationId, version: 1, reward: 100
  }];
  const contributions = [];
  const addSourceAndForge = (actor, index, label) => {
    const sourceAt = new Date(Date.parse(publicationAt) + 1000 + index * 2000).toISOString();
    const forgeAt = new Date(Date.parse(sourceAt) + 1000).toISOString();
    const sourceEventId = 'source-' + label;
    events.push({
      id: sourceEventId, type: 'contribute', actor, at: sourceAt, creationId, version: 1
    });
    contributions.push({
      id: 'note-' + label, creationId, version: 1, text: 'Field note ' + label, actor, at: sourceAt
    });
    events.push({
      id: 'forge-' + label, type: 'field-item-forged', itemId: 'item-' + label,
      slotId: 'observation', sourceEventId, actor, at: forgeAt
    });
  };
  for (let index = 0; index < count; index += 1) {
    addSourceAndForge(witness, index, 'witness-' + index);
  }
  if (otherActor) addSourceAndForge(otherActor, count, otherActor.id + '-0');
  return {
    id: 'field-item-forge-cap-world', revision: events.length, xp: 0, events,
    creations: [creation], discoveries: [], contributions, reports: [], methods: []
  };
}

function offer(at = t3, actor = witness, recipient = founder, offerId = 'offer-1',
  eventId = 'offer-event-' + offerId) {
  return { id: eventId, type: 'field-item-transfer-offered',
    offerId, itemId: 'item-1', itemEventId: 'forge', recipientId: recipient.id,
    recipientRole: recipient.role, actor, at };
}
function transfer(at = t4, actor = founder, offerId = 'offer-1', from = witness) {
  return { id: 'transfer-event-' + offerId, type: 'field-item-transferred',
    offerId, itemId: 'item-1', itemEventId: 'forge', fromActorId: from.id,
    fromActorRole: from.role, actor, at };
}
const project = events => projectFieldItemState(sourceWorld(events), { slotIds });

test('field-item reducer changes ownership only after one valid designated-recipient acceptance', () => {
  const state = project([...sourceAndForge(), offer(), transfer()]);
  assert.equal(state.items.get('item-1').owner.id, founder.id);
  assert.equal(state.offers.get('offer-1').status, 'accepted');
  assert.equal(state.offers.get('offer-1').transferEvent.id, 'transfer-event-offer-1');
});

test('field-item reducer rejects a transfer timestamp earlier than its retained offer', () => {
  const state = project([...sourceAndForge(), offer(), transfer('2026-10-25T12:01:30.000Z')]);
  assert.equal(state.items.get('item-1').owner.id, witness.id);
  assert.equal(state.offers.get('offer-1').status, 'offered');
  assert.equal(state.activeOffersByItem.get('item-1'), 'offer-1');
});

test('field-item reducer ignores an out-of-order cancellation but accepts a later valid transfer', () => {
  const state = project([...sourceAndForge(), offer(), {
    id: 'cancel-event', type: 'field-item-transfer-cancelled',
    offerId: 'offer-1', actor: witness, at: '2026-10-25T12:01:30.000Z'
  }, transfer()]);
  assert.equal(state.items.get('item-1').owner.id, founder.id);
  assert.equal(state.offers.get('offer-1').status, 'accepted');
});

test('field-item reducer preserves ownership after a valid cancellation', () => {
  const state = project([...sourceAndForge(), offer(), {
    id: 'cancel-event', type: 'field-item-transfer-cancelled',
    offerId: 'offer-1', actor: witness, at: '2026-10-25T12:03:30.000Z'
  }, transfer(t5)]);
  assert.equal(state.items.get('item-1').owner.id, witness.id);
  assert.equal(state.offers.get('offer-1').status, 'cancelled');
});

test('field-item reducer rejects a former owner trying to offer an item after transfer', () => {
  const state = project([...sourceAndForge(), offer(), transfer(),
    offer(t5, witness, third, 'former-owner-offer'),
    transfer(t6, third, 'former-owner-offer', witness)]);
  assert.equal(state.items.get('item-1').owner.id, founder.id);
  assert.equal(state.offers.has('former-owner-offer'), false);
});

test('field-item reducer requires monotonic equip, replacement and unequip timestamps', () => {
  const state = project([...sourceAndForge(),
    { id: 'early-equip', type: 'field-item-equipped', sourceEventId: 'forge',
      slotId: 'scouting', actor: witness, at: '2026-10-25T12:00:30.000Z' },
    { id: 'valid-equip', type: 'field-item-equipped', sourceEventId: 'forge',
      slotId: 'scouting', actor: witness, at: t3 },
    { id: 'early-unequip', type: 'field-item-unequipped',
      slotId: 'scouting', actor: witness, at: '2026-10-25T12:01:30.000Z' },
    offer(t4)]);
  assert.equal(state.equippedByActorSlot.get(JSON.stringify([witness.id, witness.role, 'scouting'])), 'forge');
  assert.equal(state.offers.has('offer-1'), false);
});

test('ambiguous duplicate offer or transfer IDs cannot change ownership', () => {
  const duplicateOffers = project([...sourceAndForge(),
    offer(t3, witness, founder, 'duplicate', 'duplicate-offer-event-1'),
    offer(t4, witness, third, 'duplicate', 'duplicate-offer-event-2'),
    transfer(t5, founder, 'duplicate')]);
  assert.equal(duplicateOffers.items.get('item-1').owner.id, witness.id);
  assert.equal(duplicateOffers.offers.has('duplicate'), false);

  const duplicateTransfers = project([...sourceAndForge(), offer(), transfer(),
    { ...transfer(t5), id: 'duplicate-transfer-event' }]);
  assert.equal(duplicateTransfers.items.get('item-1').owner.id, witness.id);
  assert.equal(duplicateTransfers.offers.get('offer-1').status, 'offered');
});


test('field-item reducer refuses to equip an item while a transfer offer is pending', () => {
  const state = project([...sourceAndForge(), offer(), {
    id: 'equip-during-offer', type: 'field-item-equipped', sourceEventId: 'forge',
    slotId: 'scouting', actor: witness, at: t4
  }]);
  assert.equal(state.equippedByActorSlot.has(JSON.stringify([witness.id, witness.role, 'scouting'])), false);
  assert.deepEqual(state.equipmentEvents, []);
  assert.equal(state.offers.get('offer-1').status, 'offered');
});


test('field-item projections reject caller-invented, stale, and cross-world source indexes', () => {
  const events = sourceAndForge();
  const validWorld = sourceWorld(events);
  const invalidWorld = sourceWorld(events, { discoveries: [] });
  const validIndex = projectValidFieldItemSourceEventIds(validWorld);

  assert.equal(Object.isFrozen(validIndex), true);
  assert.equal(typeof validIndex.scouting.add, 'undefined');
  assert.equal(isValidFieldItemSourceEventIndex(validIndex, validWorld), true);
  assert.deepEqual(projectValidFieldItemForgeEvents(validWorld, {
    validSourceEventIdsBySlot: validIndex
  }).map(event => event.id), ['forge']);

  // A valid index must not survive in-place mutation when world identity,
  // array references/lengths and revision remain unchanged.
  const changedEventWorld = sourceWorld(sourceAndForge());
  const changedEventIndex = projectValidFieldItemSourceEventIds(changedEventWorld);
  changedEventWorld.events[0].locationId = 'not-a-guide-location';
  assert.equal(changedEventWorld.revision, 2);
  assert.equal(changedEventWorld.events.length, 2);
  assert.equal(changedEventWorld.discoveries.length, 1);
  assert.equal(isValidFieldItemSourceEventIndex(changedEventIndex, changedEventWorld), false);
  assert.deepEqual(projectValidFieldItemForgeEvents(changedEventWorld, {
    validSourceEventIdsBySlot: changedEventIndex
  }), []);
  assert.equal(projectFieldItemState(changedEventWorld, {
    slotIds, validSourceEventIdsBySlot: changedEventIndex
  }).items.size, 0);

  const changedRecordWorld = sourceWorld(sourceAndForge());
  const changedRecordIndex = projectValidFieldItemSourceEventIds(changedRecordWorld);
  changedRecordWorld.discoveries[0].locationId = 'not-a-guide-location';
  assert.equal(changedRecordWorld.revision, 2);
  assert.equal(changedRecordWorld.events.length, 2);
  assert.equal(changedRecordWorld.discoveries.length, 1);
  assert.equal(isValidFieldItemSourceEventIndex(changedRecordIndex, changedRecordWorld), false);
  assert.deepEqual(projectValidFieldItemForgeEvents(changedRecordWorld, {
    validSourceEventIdsBySlot: changedRecordIndex
  }), []);

  const inventedIndex = { scouting: new Set(['source']) };
  assert.deepEqual(projectValidFieldItemForgeEvents(invalidWorld, {
    validSourceEventIdsBySlot: inventedIndex
  }), []);
  assert.deepEqual(projectValidFieldItemForgeEvents(invalidWorld, {
    validSourceEventIdsBySlot: validIndex
  }), []);

  const staleWorld = sourceWorld(events);
  const staleIndex = projectValidFieldItemSourceEventIds(staleWorld);
  staleWorld.discoveries.length = 0;
  staleWorld.revision += 1;
  assert.deepEqual(projectValidFieldItemForgeEvents(staleWorld, {
    validSourceEventIdsBySlot: staleIndex
  }), []);

  assert.equal(projectFieldItemState(invalidWorld, {
    slotIds, validForgeEventIds: new Set(['forge'])
  }).items.size, 0);
  assert.equal(projectFieldItemState(validWorld, {
    slotIds, validForgeEventIds: new Set()
  }).items.size, 1);
});

test('field-item forge projections enforce the canonical per-actor cap in append order', () => {
  const world = contributionForgeWorld(MAX_FIELD_INVENTORY_ITEMS + 1, third);
  const before = JSON.stringify(world);
  const sourceIndex = projectValidFieldItemSourceEventIds(world);
  const forgeEvents = projectValidFieldItemForgeEvents(world, {
    validSourceEventIdsBySlot: sourceIndex
  });
  const witnessForgeEvents = forgeEvents.filter(event => event.actor.id === witness.id && event.actor.role === witness.role);

  assert.equal(MAX_FIELD_INVENTORY_ITEMS, 100);
  assert.equal(witnessForgeEvents.length, MAX_FIELD_INVENTORY_ITEMS);
  assert.equal(witnessForgeEvents.at(-1).id, 'forge-witness-99');
  assert.equal(forgeEvents.some(event => event.id === 'forge-witness-100'), false,
    'the 101st otherwise-valid forge event for one actor cannot project');
  assert.equal(forgeEvents.some(event => event.id === 'forge-witness-99'), true);
  assert.equal(forgeEvents.some(event => event.id === 'forge-witness-2-0'), true,
    'another actor has an independent per-actor allowance');

  const state = projectFieldItemState(world, {
    slotIds: ['observation'], validSourceEventIdsBySlot: sourceIndex
  });
  assert.equal([...state.items.values()].filter(item => item.owner.id === witness.id).length, MAX_FIELD_INVENTORY_ITEMS);
  assert.equal(state.items.has('item-witness-100'), false);
  assert.equal(state.items.has('item-witness-99'), true);
  assert.equal(state.items.has('item-witness-2-0'), true);
  assert.equal(world.xp, 0);
  assert.equal(world.revision, world.events.length);
  assert.equal(JSON.stringify(world), before, 'source and forge projections remain read-only');
});

test('field-item projections enforce current owned capacity after transfers', () => {
  const world = contributionForgeWorld(MAX_FIELD_INVENTORY_ITEMS, third);
  const base = Date.parse(t1) + 203_000;

  // Move 99 of the Witness's 100 items to the third actor. The third actor
  // already owns one forged item, so these transfers fill their inventory.
  for (let index = 0; index < 99; index += 1) {
    const itemId = 'item-witness-' + index;
    const itemEventId = 'forge-witness-' + index;
    const offerId = 'offer-to-third-' + index;
    const offerAt = new Date(base + index * 2_000).toISOString();
    const transferAt = new Date(base + index * 2_000 + 1_000).toISOString();
    world.events.push(
      {
        id: 'offer-event-to-third-' + index,
        type: 'field-item-transfer-offered',
        offerId, itemId, itemEventId,
        recipientId: third.id, recipientRole: third.role,
        actor: witness, at: offerAt
      },
      {
        id: 'transfer-event-to-third-' + index,
        type: 'field-item-transferred',
        offerId, itemId, itemEventId,
        fromActorId: witness.id, fromActorRole: witness.role,
        actor: third, at: transferAt
      }
    );
  }

  // The source and lifetime forge checks accept this second forge by the
  // recipient, but current owned capacity must withhold it from inventory and
  // the Forge quest because the recipient already owns 100 transferred items.
  const extraSourceAt = new Date(base + 99 * 2_000).toISOString();
  const extraForgeAt = new Date(base + 99 * 2_000 + 1_000).toISOString();
  world.events.push({
    id: 'source-third-extra', type: 'contribute', actor: third,
    at: extraSourceAt, creationId: 'source-creation', version: 1
  });
  world.contributions.push({
    id: 'note-third-extra', creationId: 'source-creation', version: 1,
    text: 'Extra field note', actor: third, at: extraSourceAt
  });
  world.events.push({
    id: 'forge-third-extra', type: 'field-item-forged',
    itemId: 'item-third-extra', slotId: 'observation',
    sourceEventId: 'source-third-extra', actor: third, at: extraForgeAt
  });

  // A further accepted-transfer-shaped event must not make the recipient's
  // current inventory exceed the same bound.
  const fullOfferAt = new Date(base + 100 * 2_000).toISOString();
  const fullTransferAt = new Date(base + 100 * 2_000 + 1_000).toISOString();
  world.events.push(
    {
      id: 'offer-full-recipient-event', type: 'field-item-transfer-offered',
      offerId: 'offer-full-recipient', itemId: 'item-witness-99',
      itemEventId: 'forge-witness-99',
      recipientId: third.id, recipientRole: third.role,
      actor: witness, at: fullOfferAt
    },
    {
      id: 'transfer-full-recipient-event', type: 'field-item-transferred',
      offerId: 'offer-full-recipient', itemId: 'item-witness-99',
      itemEventId: 'forge-witness-99',
      fromActorId: witness.id, fromActorRole: witness.role,
      actor: third, at: fullTransferAt
    }
  );
  world.revision = world.events.length;

  const before = JSON.stringify(world);
  const sourceIndex = projectValidFieldItemSourceEventIds(world);
  const sourceAndLifetimeValid = projectValidFieldItemForgeEvents(world, {
    validSourceEventIdsBySlot: sourceIndex
  });
  assert.ok(sourceAndLifetimeValid.some(event => event.id === 'forge-third-extra'));

  const state = projectFieldItemState(world, {
    slotIds: ['observation'], validSourceEventIdsBySlot: sourceIndex
  });
  const thirdItems = [...state.items.values()].filter(item =>
    item.owner.id === third.id && item.owner.role === third.role
  );
  const witnessItems = [...state.items.values()].filter(item =>
    item.owner.id === witness.id && item.owner.role === witness.role
  );
  assert.equal(thirdItems.length, MAX_FIELD_INVENTORY_ITEMS);
  assert.equal(witnessItems.length, 1);
  assert.equal(state.items.has('item-third-extra'), false);
  assert.equal(state.forgeEvents.some(event => event.id === 'forge-third-extra'), false);
  assert.equal(state.forgeEvents.length, MAX_FIELD_INVENTORY_ITEMS + 1);

  const rejectedOffer = state.offers.get('offer-full-recipient');
  assert.equal(rejectedOffer.status, 'offered');
  assert.equal(state.activeOffersByItem.get('item-witness-99'), 'offer-full-recipient');
  assert.deepEqual(state.items.get('item-witness-99').owner, witness);

  const character = projectCharacter(world, third);
  assert.equal(character.fieldInventoryTotal, MAX_FIELD_INVENTORY_ITEMS);
  assert.equal(character.fieldInventory.some(item => item.eventId === 'forge-third-extra'), false);

  const quests = getQuestTrail(world, third);
  const forgeQuest = quests.find(item => item.id === 'witness-forge-field-item');
  const transferQuest = quests.find(item => item.id === 'witness-complete-field-item-transfer');
  assert.ok(forgeQuest);
  assert.ok(transferQuest);
  assert.equal(forgeQuest.evidenceIds.includes('forge-third-extra'), false);
  assert.equal(transferQuest.evidenceIds.includes('transfer-full-recipient-event'), false);

  assert.equal(world.xp, 0);
  assert.equal(JSON.stringify(world), before, 'capacity projections are read-only and preserve rejected history');
});

test('shared field-item source projection rejects prototype-sensitive source IDs', () => {
  assert.deepEqual(projectValidFieldItemForgeEvents(sourceWorld(sourceAndForge())).map(event => event.id), ['forge']);
  for (const reserved of ['__proto__', 'constructor', 'prototype']) {
    const events = sourceAndForge();
    events[0].id = reserved;
    events[1].sourceEventId = reserved;
    const world = sourceWorld(events);
    assert.deepEqual(projectValidFieldItemForgeEvents(world), []);
    const state = projectFieldItemState(world, { slotIds });
    assert.equal(state.items.size, 0);
  }
});
