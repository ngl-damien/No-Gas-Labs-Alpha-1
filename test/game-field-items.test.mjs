import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { projectArmorBearerChains, projectFieldItemState, projectValidFieldItemForgeEvents, projectValidFieldItemSourceEventIds, FIELD_ITEM_SOURCE_TYPES } from '../game/field-items.mjs';
import { sourceObservationRequestMaterial } from '../game/research-records.mjs';

const founder = { id: 'founder-1', role: 'founder' };
const witness = { id: 'witness-1', role: 'witness' };
const third = { id: 'witness-2', role: 'witness' };
const slotIds = ['scouting'];
const validForgeEventIds = new Set(['forge']);
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
const project = events => projectFieldItemState(events, { slotIds, validForgeEventIds });

function sourceObservationChallengeWorld({
  challengeActor = witness,
  challengeAt = '2026-10-25T11:59:00.000Z',
  duplicateChallengeId = false,
  challengeBeforeObservation = false
} = {}) {
  const creationId = 'observatory-1';
  const note = {
    claim: 'A model response asserts that the archive is complete.',
    sourceKind: 'model-assertion',
    source: 'Model response; no source bytes retrieved.',
    falsifier: 'A fresh retrieval contradicts the claim.',
    uncertainty: 'The original bytes are not retained.',
    nextTest: 'Retrieve the source independently.'
  };
  const digest = createHash('sha256').update(sourceObservationRequestMaterial({
    actorId: founder.id, actorRole: founder.role, creationId, version: 1, ...note
  })).digest('hex');
  const observationId = 'source-observation-' + digest;
  const publication = {
    id: 'publish-observatory', type: 'publish', actor: founder, at: t1,
    creationId, version: 1, reward: 100
  };
  const observation = {
    id: 'observation-event', type: 'source-observation-recorded', actor: founder, at: t2,
    observationId, creationId, version: 1, ...note,
    originSchema: 'ngl.source-observatory.v2', bindingMode: 'USER_SELECTED',
    sourceRetrieval: 'NOT_PERFORMED', independentVerification: 'NOT_PERFORMED',
    modelAssertions: 'LEADS_ONLY', execution: 'NOT_EXECUTED',
    normalizedRecordDigest: digest
  };
  const challenge = {
    id: 'challenge-event', type: 'source-observation-challenged', actor: challengeActor,
    at: challengeAt, challengeId: 'source-challenge-1', observationId, creationId, version: 1,
    challengeType: 'missing-evidence', challengeText: 'No independently retrieved bytes are retained.'
  };
  const events = challengeBeforeObservation
    ? [publication, challenge, observation]
    : [publication, observation, challenge];
  if (duplicateChallengeId) events.push({ ...challenge, id: 'duplicate-challenge-event' });
  return {
    creations: [{
      id: creationId, kind: 'observatory', title: 'Source Observatory', version: 1,
      publishedAt: t1, receipt: { algorithm: 'sha256', digest: 'a'.repeat(64), size: 1 },
      versions: []
    }],
    events
  };
}

test('Source Observatory challenges become adversarial Forge sources only when uniquely linked and cross-actor', () => {
  assert.ok(FIELD_ITEM_SOURCE_TYPES.adversarial.includes('source-observation-challenged'));
  const valid = projectValidFieldItemSourceEventIds(sourceObservationChallengeWorld());
  assert.deepEqual([...valid.adversarial], ['challenge-event']);

  const selfChallenge = projectValidFieldItemSourceEventIds(sourceObservationChallengeWorld({
    challengeActor: founder
  }));
  assert.equal(selfChallenge.adversarial.has('challenge-event'), false);

  const ambiguousChallenge = projectValidFieldItemSourceEventIds(sourceObservationChallengeWorld({
    duplicateChallengeId: true
  }));
  assert.equal(ambiguousChallenge.adversarial.has('challenge-event'), false);

  const forwardChallenge = projectValidFieldItemSourceEventIds(sourceObservationChallengeWorld({
    challengeBeforeObservation: true
  }));
  assert.equal(forwardChallenge.adversarial.has('challenge-event'), false);
});

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


test('field-item reducer fails closed when validated forge IDs are omitted or malformed', () => {
  const events = sourceAndForge();
  for (const options of [
    { slotIds },
    { slotIds, validForgeEventIds: null },
    { slotIds, validForgeEventIds: ['forge'] }
  ]) {
    assert.equal(projectFieldItemState(events, options).items.size, 0);
  }
});

test('shared field-item source projection rejects prototype-sensitive source IDs', () => {
  assert.deepEqual(projectValidFieldItemForgeEvents(sourceAndForge(), {
    validSourceEventIdsBySlot: { scouting: new Set(['source']) }
  }).map(event => event.id), ['forge']);
  for (const reserved of ['__proto__', 'constructor', 'prototype']) {
    const events = sourceAndForge();
    events[0].id = reserved;
    events[1].sourceEventId = reserved;
    assert.deepEqual(projectValidFieldItemForgeEvents(events), []);
    const state = projectFieldItemState(events, {
      slotIds, validForgeEventIds: new Set(['forge'])
    });
    assert.equal(state.items.size, 0);
  }
});


test('Armor Bearer projection requires Forge → bearer equip → accepted transfer → recipient equip', () => {
  const events = [
    ...sourceAndForge(),
    { id:'bearer-equip', type:'field-item-equipped', sourceEventId:'forge',
      slotId:'scouting', actor:witness, at:t3 },
    { id:'bearer-unequip', type:'field-item-unequipped',
      slotId:'scouting', actor:witness, at:t4 },
    offer(t5, witness, founder),
    transfer(t6, founder, 'offer-1', witness),
    { id:'recipient-equip', type:'field-item-equipped', sourceEventId:'forge',
      slotId:'scouting', actor:founder, at:'2026-10-25T12:06:00.000Z' }
  ];
  const before = structuredClone(events);
  const state = project(events);
  const bearerChain = projectArmorBearerChains(events, state, witness)[0];
  assert.deepEqual(bearerChain.evidenceEvents.map(event => event.id), [
    'forge', 'bearer-equip', 'transfer-event-offer-1', 'recipient-equip'
  ]);
  assert.equal(bearerChain.progress, 4);
  assert.equal(bearerChain.complete, true);
  assert.deepEqual([bearerChain.bearer, bearerChain.recipient], [witness, founder]);

  const recipientChain = projectArmorBearerChains(events, state, founder)[0];
  assert.deepEqual(recipientChain.evidenceEvents.map(event => event.id), ['forge', 'recipient-equip']);
  assert.equal(recipientChain.progress, 2);
  assert.equal(recipientChain.complete, false,
    'receiving and equipping an item prepares the recipient to carry it onward; it does not make them the prior bearer');
  assert.deepEqual(events, before, 'Armor Bearer projection is read-only');
});

test('Armor Bearer projection rejects a transfer before bearer equipment and waits for recipient equipment', () => {
  const premature = [
    ...sourceAndForge(),
    offer(t3, witness, founder),
    transfer(t4, founder, 'offer-1', witness),
    { id:'recipient-equip-after-premature-transfer', type:'field-item-equipped',
      sourceEventId:'forge', slotId:'scouting', actor:founder, at:t5 }
  ];
  const prematureState = project(premature);
  const prematureChain = projectArmorBearerChains(premature, prematureState, witness)[0];
  assert.equal(prematureChain.progress, 1);
  assert.equal(prematureChain.complete, false);
  assert.match(prematureChain.blockedReason, /before this bearer equipped the item/i);

  const waiting = [
    ...sourceAndForge(),
    { id:'bearer-equip-waiting', type:'field-item-equipped', sourceEventId:'forge',
      slotId:'scouting', actor:witness, at:t3 },
    { id:'bearer-unequip-waiting', type:'field-item-unequipped',
      slotId:'scouting', actor:witness, at:t4 },
    offer(t5, witness, founder),
    { id:'recipient-equip-before-transfer', type:'field-item-equipped',
      sourceEventId:'forge', slotId:'scouting', actor:founder, at:'2026-10-25T12:04:30.000Z' },
    transfer(t6, founder, 'offer-1', witness)
  ];
  const waitingState = project(waiting);
  const waitingChain = projectArmorBearerChains(waiting, waitingState, witness)[0];
  assert.equal(waitingChain.progress, 3);
  assert.equal(waitingChain.complete, false);
  assert.match(waitingChain.blockedReason, /designated recipient must equip/i,
    'an attempted recipient equip before ownership transfer is rejected by the field-item reducer');
  assert.equal(waitingState.equipmentEvents.some(event => event.id === 'recipient-equip-before-transfer'), false);
});


test('Armor Bearer projection rejects mismatched recipient equipment and duplicate transfer evidence', () => {
  const mismatched = [
    ...sourceAndForge(),
    { id:'bearer-equip-mismatch', type:'field-item-equipped', sourceEventId:'forge',
      slotId:'scouting', actor:witness, at:t3 },
    { id:'bearer-unequip-mismatch', type:'field-item-unequipped',
      slotId:'scouting', actor:witness, at:t4 },
    offer(t5, witness, founder),
    transfer(t6, founder, 'offer-1', witness),
    { id:'recipient-equip-wrong-item', type:'field-item-equipped',
      sourceEventId:'different-forge', slotId:'scouting', actor:founder,
      at:'2026-10-25T12:06:00.000Z' }
  ];
  const mismatchedState = project(mismatched);
  const mismatchedChain = projectArmorBearerChains(mismatched, mismatchedState, witness)[0];
  assert.equal(mismatchedChain.progress, 3);
  assert.equal(mismatchedChain.complete, false);
  assert.match(mismatchedChain.blockedReason, /designated recipient must equip/i);
  assert.equal(mismatchedState.equipmentEvents.some(event => event.id === 'recipient-equip-wrong-item'), false);

  const duplicateTransfer = [
    ...sourceAndForge(),
    { id:'bearer-equip-duplicate', type:'field-item-equipped', sourceEventId:'forge',
      slotId:'scouting', actor:witness, at:t3 },
    { id:'bearer-unequip-duplicate', type:'field-item-unequipped',
      slotId:'scouting', actor:witness, at:t4 },
    offer(t5, witness, founder),
    transfer(t6, founder, 'offer-1', witness),
    { ...transfer('2026-10-25T12:06:00.000Z', founder, 'offer-1', witness),
      id:'duplicate-transfer-event' }
  ];
  const duplicateState = project(duplicateTransfer);
  const duplicateChain = projectArmorBearerChains(duplicateTransfer, duplicateState, witness)[0];
  assert.equal(duplicateState.offers.get('offer-1').status, 'offered');
  assert.equal(duplicateChain.progress, 2);
  assert.equal(duplicateChain.complete, false);
});
