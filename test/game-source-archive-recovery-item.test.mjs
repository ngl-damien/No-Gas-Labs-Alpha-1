import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorld, applyAction, validateWorld } from '../game/model.mjs';
import { projectCharacter, FIELD_EQUIPMENT_SLOTS } from '../game/character-sheet.mjs';
import { getQuestTrail } from '../game/quests.mjs';
import { projectSourceArchiveFailureObjects } from '../game/world-view.mjs';
import { recordSourceArchiveAttemptFailure } from '../game/source-archive-failures.mjs';
import { buildGitHubSourceArchiveBody, GITHUB_SOURCE_ARCHIVE_INTENT_PREFIX } from '../game/artifacts.mjs';

const founder = { id: 'damien', name: 'Damien Featherstone', role: 'founder' };
const witness = { id: 'recovery-witness', name: 'Witness', role: 'witness' };
const repository = 'ngl-damien/No-Gas-Labs-Alpha-1';
const commitSha = 'f'.repeat(40);
const sourcePath = 'test/fixtures/recovery-ledger.mjs';

function failureDetails(requestDigit = 'a', actionDigit = 'b', failureCode = 'GITHUB_SOURCE_UNAVAILABLE') {
  return {
    requestIdDigest: requestDigit.repeat(64),
    actionDigest: actionDigit.repeat(64),
    repository,
    commitSha,
    path: sourcePath,
    failureCode
  };
}

async function worldWithFailure(failureCode = 'GITHUB_SOURCE_UNAVAILABLE') {
  const start = createWorld({
    id: 'source-archive-recovery-world',
    now: '2026-11-23T10:00:00.000Z'
  });
  const failed = recordSourceArchiveAttemptFailure(
    start,
    founder,
    failureDetails('a', 'b', failureCode),
    { now: '2026-11-23T10:00:03.000Z' }
  );
  return {
    world: failed.world,
    failure: failed.world.events.at(-1),
    attemptId: failed.attemptId
  };
}

async function publishSourceArchive(world, {
  suffix = 'first',
  retrievalMode = 'server-rechecked',
  fetchedAt = '2026-11-23T10:00:05.000Z',
  capturedAt = '2026-11-23T10:00:06.000Z',
  draftedAt = '2026-11-23T10:00:06.500Z',
  publishedAt = '2026-11-23T10:00:07.000Z'
} = {}) {
  const bytes = Buffer.from('export const RECOVERY_LEDGER_FIXTURE = "later bytes";\n', 'utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const gitBlobSha = createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + String.fromCharCode(0)))
    .update(bytes)
    .digest('hex');
  const html = await buildGitHubSourceArchiveBody({
    schema: 'ngl.github-source-capture.v1',
    retrievalMode,
    captureId: JSON.stringify([repository, commitSha, sourcePath, sha256]),
    repository,
    commitSha,
    path: sourcePath,
    permalink: 'https://github.com/' + repository + '/blob/' + commitSha + '/' + sourcePath,
    gitBlobSha,
    sha256,
    size: bytes.length,
    fetchedAt,
    capturedAt,
    bytesBase64: bytes.toString('base64'),
    text: bytes.toString('utf8'),
    integrityStatus: 'hashes-match'
  });
  const draft = await applyAction(world, {
    type: 'draft',
    kind: 'custom',
    title: 'Source Archive capture ' + suffix,
    intent: GITHUB_SOURCE_ARCHIVE_INTENT_PREFIX + ' · recovery ledger fixture ' + suffix,
    html
  }, founder, { now: draftedAt });
  const published = await applyAction(draft.world, {
    type: 'publish',
    draftId: draft.result.draftId,
    expectedVersion: 0
  }, founder, { now: publishedAt });
  return {
    world: published.world,
    creationId: published.result.creationId,
    publicationEvent: published.world.events.at(-1),
    sha256,
    gitBlobSha,
    size: bytes.length
  };
}

function recoveryQuest(world, failureEventId) {
  return getQuestTrail(world, founder).find(item =>
    item.id === 'founder-source-archive-recovery-ledger-' + failureEventId
  );
}

test('a unique later server-rechecked capture becomes a forgeable, equippable Recovery Ledger without XP or authority', async () => {
  const fixture = await worldWithFailure();
  const capture = await publishSourceArchive(fixture.world);
  const world = capture.world;
  const failure = fixture.failure;
  const publication = capture.publicationEvent;
  const projection = projectSourceArchiveFailureObjects(world, { includeRecoveryLinks: true });

  assert.equal(projection.captureProjectionComplete, true);
  assert.equal(projection.recoveryLinks.length, 1);
  assert.deepEqual(
    [projection.recoveryLinks[0].failureEventId, projection.recoveryLinks[0].publicationEventId],
    [failure.id, publication.id]
  );
  assert.equal(projection.recoveryLinks[0].sha256, capture.sha256);
  assert.equal(projection.recoveryLinks[0].gitBlobSha, capture.gitBlobSha);

  assert.equal(FIELD_EQUIPMENT_SLOTS.some(slot => slot.id === 'recovery'), true);
  const founderRecord = projectCharacter(world, founder);
  const source = founderRecord.fieldItemSources.recovery.find(item => item.eventId === publication.id);
  assert.ok(source, 'the exact later publication must be a Recovery Ledger Forge source');
  assert.equal(source.kind, 'source-archive-recovery');
  assert.equal(source.recovery.failureEventId, failure.id);
  assert.equal(source.recovery.publicationEventId, publication.id);
  assert.equal(source.recovery.sha256, capture.sha256);
  assert.equal(
    founderRecord.fieldItemSources.provenance.some(item => item.eventId === publication.id),
    false,
    'one publication cannot be forged into both a Recovery Ledger and a Receipt Buckler'
  );

  const initialQuest = recoveryQuest(world, failure.id);
  assert.ok(initialQuest, 'the exact failure/capture pair must create a Founder-only follow-up objective');
  assert.deepEqual([initialQuest.progress, initialQuest.target, initialQuest.complete], [2, 4, false]);
  assert.deepEqual(initialQuest.evidenceIds, [failure.id, publication.id]);
  assert.deepEqual(initialQuest.action, { type: 'location', id: 'forge' });
  assert.equal(initialQuest.countsForQuestkeeper, false);
  assert.equal(projectCharacter(world, witness).fieldItemSources.recovery.length, 0);
  assert.equal(getQuestTrail(world, witness).some(item =>
    item.id.startsWith('founder-source-archive-recovery-ledger-')
  ), false);

  const xpBeforeForge = world.xp;
  const forged = await applyAction(world, {
    type: 'forge-field-item',
    slotId: 'recovery',
    sourceEventId: publication.id
  }, founder, { now: '2026-11-23T10:00:08.000Z' });
  const forgeEvent = forged.world.events.at(-1);
  assert.equal(forgeEvent.type, 'field-item-forged');
  assert.equal(forgeEvent.slotId, 'recovery');
  assert.equal(forgeEvent.sourceEventId, publication.id);
  assert.equal(forged.world.xp, xpBeforeForge);

  const forgedQuest = recoveryQuest(forged.world, failure.id);
  assert.deepEqual([forgedQuest.progress, forgedQuest.target, forgedQuest.complete], [3, 4, false]);
  assert.deepEqual(forgedQuest.evidenceIds, [failure.id, publication.id, forgeEvent.id]);
  assert.deepEqual(forgedQuest.action, { type: 'location', id: 'forge' });

  const equipped = await applyAction(forged.world, {
    type: 'equip-field-item',
    slotId: 'recovery',
    sourceEventId: forgeEvent.id
  }, founder, { now: '2026-11-23T10:00:09.000Z' });
  const equipEvent = equipped.world.events.at(-1);
  assert.equal(equipEvent.type, 'field-item-equipped');
  assert.equal(equipEvent.slotId, 'recovery');
  assert.equal(equipEvent.sourceEventId, forgeEvent.id);
  assert.equal(equipped.world.xp, xpBeforeForge);

  const finalRecord = projectCharacter(equipped.world, founder);
  const item = finalRecord.fieldInventory.find(candidate => candidate.eventId === forgeEvent.id);
  assert.ok(item);
  assert.equal(item.sourceKind, 'source-archive-recovery');
  assert.equal(item.sourceEventId, publication.id);
  assert.equal(item.sourceRecovery.failureEventId, failure.id);
  assert.equal(item.sourceRecovery.publicationEventId, publication.id);
  assert.equal(item.sourceRecovery.sha256, capture.sha256);
  assert.equal(finalRecord.equipment.find(slot => slot.id === 'recovery').source.eventId, forgeEvent.id);

  const completedQuest = recoveryQuest(equipped.world, failure.id);
  assert.deepEqual([completedQuest.progress, completedQuest.target, completedQuest.complete], [4, 4, true]);
  assert.deepEqual(completedQuest.evidenceIds, [failure.id, publication.id, forgeEvent.id, equipEvent.id]);
  assert.equal(completedQuest.action, null);
  assert.equal(completedQuest.countsForQuestkeeper, false);
  await validateWorld(equipped.world);

  const partial = {
    ...equipped.world,
    events: equipped.world.events.slice(0, -1)
  };
  const partialProjection = projectSourceArchiveFailureObjects(partial, { includeRecoveryLinks: true });
  assert.equal(partialProjection.captureProjectionComplete, false);
  assert.deepEqual(partialProjection.recoveryLinks, []);
});

test('a Recovery Ledger can complete the four-step Armor Bearer handoff without XP or authority', async () => {
  const fixture = await worldWithFailure();
  const capture = await publishSourceArchive(fixture.world);
  const publication = capture.publicationEvent;

  const forged = await applyAction(capture.world, {
    type: 'forge-field-item',
    slotId: 'recovery',
    sourceEventId: publication.id
  }, founder, { now: '2026-11-23T10:00:08.000Z' });
  const forgeEvent = forged.world.events.at(-1);
  const founderEquipped = await applyAction(forged.world, {
    type: 'equip-field-item',
    slotId: 'recovery',
    sourceEventId: forgeEvent.id
  }, founder, { now: '2026-11-23T10:00:09.000Z' });
  const founderEquipEvent = founderEquipped.world.events.at(-1);
  const founderUnequipped = await applyAction(founderEquipped.world, {
    type: 'unequip-field-item',
    slotId: 'recovery'
  }, founder, { now: '2026-11-23T10:00:10.000Z' });
  const founderUnequipEvent = founderUnequipped.world.events.at(-1);

  const offered = await applyAction(founderUnequipped.world, {
    type: 'offer-field-item-transfer',
    itemEventId: forgeEvent.id,
    recipientId: witness.id,
    recipientRole: witness.role
  }, founder, { now: '2026-11-23T10:00:11.000Z', allowTransfers: true });
  const offerEvent = offered.world.events.at(-1);
  assert.equal(offerEvent.type, 'field-item-transfer-offered');
  assert.equal(offerEvent.itemEventId, forgeEvent.id);
  assert.equal(offerEvent.recipientId, witness.id);
  assert.equal(offered.world.xp, capture.world.xp);
  const offeredChain = getQuestTrail(offered.world, founder).find(item =>
    item.id === 'founder-armor-bearer-delivery'
  );
  assert.deepEqual([offeredChain.progress, offeredChain.target, offeredChain.complete], [2, 4, false]);
  assert.deepEqual(offeredChain.evidenceIds, [forgeEvent.id, founderEquipEvent.id]);

  const accepted = await applyAction(offered.world, {
    type: 'accept-field-item-transfer',
    offerId: offerEvent.offerId
  }, witness, { now: '2026-11-23T10:00:12.000Z', allowTransfers: true });
  const transferEvent = accepted.world.events.at(-1);
  assert.equal(transferEvent.type, 'field-item-transferred');
  assert.equal(transferEvent.actor.id, witness.id);
  assert.equal(transferEvent.fromActorId, founder.id);
  assert.equal(transferEvent.itemEventId, forgeEvent.id);
  assert.equal(accepted.world.xp, capture.world.xp);

  const acceptedChain = getQuestTrail(accepted.world, founder).find(item =>
    item.id === 'founder-armor-bearer-delivery'
  );
  assert.deepEqual([acceptedChain.progress, acceptedChain.target, acceptedChain.complete], [3, 4, false]);
  assert.deepEqual(acceptedChain.evidenceIds, [
    forgeEvent.id, founderEquipEvent.id, transferEvent.id
  ]);
  assert.equal(acceptedChain.action, null);

  const founderAfterAcceptance = projectCharacter(accepted.world, founder);
  const witnessAfterAcceptance = projectCharacter(accepted.world, witness);
  assert.equal(founderAfterAcceptance.fieldInventoryTotal, 0);
  assert.equal(witnessAfterAcceptance.fieldInventoryTotal, 1);
  const transferredItem = witnessAfterAcceptance.fieldInventory.find(item =>
    item.eventId === forgeEvent.id
  );
  assert.ok(transferredItem);
  assert.equal(transferredItem.ownerId, witness.id);
  assert.equal(transferredItem.creatorId, founder.id);
  assert.equal(transferredItem.sourceRecovery.failureEventId, fixture.failure.id);
  assert.equal(transferredItem.sourceRecovery.publicationEventId, publication.id);
  assert.equal(transferredItem.transferHistory[0].status, 'accepted');
  assert.equal(founderAfterAcceptance.skills.find(skill => skill.id === 'armor-bearer').count, 1);
  assert.equal(witnessAfterAcceptance.skills.find(skill => skill.id === 'armor-bearer').count, 0);

  const recipientEquipped = await applyAction(accepted.world, {
    type: 'equip-field-item',
    slotId: 'recovery',
    sourceEventId: forgeEvent.id
  }, witness, { now: '2026-11-23T10:00:13.000Z' });
  const recipientEquipEvent = recipientEquipped.world.events.at(-1);
  assert.equal(recipientEquipEvent.type, 'field-item-equipped');
  assert.equal(recipientEquipEvent.actor.id, witness.id);
  assert.equal(recipientEquipEvent.sourceEventId, forgeEvent.id);
  assert.equal(recipientEquipped.world.xp, capture.world.xp);

  const founderFinal = projectCharacter(recipientEquipped.world, founder);
  const witnessFinal = projectCharacter(recipientEquipped.world, witness);
  assert.equal(founderFinal.fieldInventoryTotal, 0);
  assert.equal(witnessFinal.fieldInventoryTotal, 1);
  assert.equal(witnessFinal.equipment.find(slot => slot.id === 'recovery').source.eventId, forgeEvent.id);
  const finalItem = witnessFinal.fieldInventory.find(item => item.eventId === forgeEvent.id);
  assert.equal(finalItem.creatorId, founder.id);
  assert.equal(finalItem.ownerId, witness.id);
  assert.equal(finalItem.sourceRecovery.failureEventId, fixture.failure.id);
  assert.equal(finalItem.sourceRecovery.publicationEventId, publication.id);
  assert.equal(finalItem.transferHistory[0].transferEventId, transferEvent.id);

  const founderChain = getQuestTrail(recipientEquipped.world, founder).find(item =>
    item.id === 'founder-armor-bearer-delivery'
  );
  assert.deepEqual([founderChain.progress, founderChain.target, founderChain.complete], [4, 4, true]);
  assert.deepEqual(founderChain.evidenceIds, [
    forgeEvent.id, founderEquipEvent.id, transferEvent.id, recipientEquipEvent.id
  ]);
  assert.equal(founderChain.countsForQuestkeeper, false);
  const witnessChain = getQuestTrail(recipientEquipped.world, witness).find(item =>
    item.id === 'witness-armor-bearer-delivery'
  );
  assert.deepEqual([witnessChain.progress, witnessChain.target, witnessChain.complete], [2, 4, false]);
  assert.deepEqual(witnessChain.evidenceIds, [forgeEvent.id, recipientEquipEvent.id]);
  assert.deepEqual(witnessChain.action, { type: 'location', id: 'forge' });
  assert.equal(founderFinal.skills.find(skill => skill.id === 'armor-bearer').count, 1);
  assert.equal(witnessFinal.skills.find(skill => skill.id === 'armor-bearer').count, 0);

  const recoveryObjective = recoveryQuest(recipientEquipped.world, fixture.failure.id);
  assert.deepEqual([recoveryObjective.progress, recoveryObjective.target, recoveryObjective.complete], [4, 4, true]);
  assert.equal(recoveryObjective.countsForQuestkeeper, false);
  assert.equal(recipientEquipped.world.xp, capture.world.xp);
  assert.equal(founderUnequipEvent.type, 'field-item-unequipped');
  await validateWorld(recipientEquipped.world);
});

test('client-reported, non-retryable, shared-failure and ambiguous-capture histories cannot mint a Recovery Ledger source', async () => {
  const clientReported = await worldWithFailure();
  const clientCapture = await publishSourceArchive(clientReported.world, {
    retrievalMode: 'client-reported'
  });
  const clientProjection = projectSourceArchiveFailureObjects(clientCapture.world, {
    includeRecoveryLinks: true
  });
  assert.equal(clientProjection.captureProjectionComplete, true);
  assert.deepEqual(clientProjection.recoveryLinks, []);
  assert.equal(projectCharacter(clientCapture.world, founder).fieldItemSources.recovery.length, 0);

  const nonRetryable = await worldWithFailure('SOURCE_CAPTURE_MISMATCH');
  const nonRetryableCapture = await publishSourceArchive(nonRetryable.world);
  const nonRetryableProjection = projectSourceArchiveFailureObjects(nonRetryableCapture.world, {
    includeRecoveryLinks: true
  });
  assert.equal(nonRetryableProjection.captureProjectionComplete, true);
  assert.deepEqual(nonRetryableProjection.recoveryLinks, []);

  const twoFailures = await worldWithFailure();
  const secondFailure = recordSourceArchiveAttemptFailure(
    twoFailures.world,
    founder,
    failureDetails('c', 'd'),
    { now: '2026-11-23T10:00:04.000Z' }
  );
  const oneCaptureForTwoFailures = await publishSourceArchive(secondFailure.world);
  const sharedCaptureProjection = projectSourceArchiveFailureObjects(oneCaptureForTwoFailures.world, {
    includeRecoveryLinks: true
  });
  assert.equal(sharedCaptureProjection.captureProjectionComplete, true);
  assert.deepEqual(sharedCaptureProjection.recoveryLinks, [],
    'one later publication cannot be assigned to two distinct failure origins');

  const oneFailure = await worldWithFailure();
  const firstCapture = await publishSourceArchive(oneFailure.world);
  const secondCapture = await publishSourceArchive(firstCapture.world, {
    suffix: 'second',
    fetchedAt: '2026-11-23T10:00:08.000Z',
    capturedAt: '2026-11-23T10:00:09.000Z',
    draftedAt: '2026-11-23T10:00:09.500Z',
    publishedAt: '2026-11-23T10:00:10.000Z'
  });
  const ambiguousCaptureProjection = projectSourceArchiveFailureObjects(secondCapture.world, {
    includeRecoveryLinks: true
  });
  assert.equal(ambiguousCaptureProjection.captureProjectionComplete, false);
  assert.deepEqual(ambiguousCaptureProjection.recoveryLinks, []);
});


test('a pending Recovery Ledger offer exposes exact failure/capture lineage to its designated recipient before ownership changes', async () => {
  const fixture = await worldWithFailure();
  const capture = await publishSourceArchive(fixture.world);
  const forged = await applyAction(capture.world, {
    type: 'forge-field-item',
    slotId: 'recovery',
    sourceEventId: capture.publicationEvent.id
  }, founder, { now: '2026-11-23T10:00:08.000Z' });
  const forgeEvent = forged.world.events.at(-1);

  const offered = await applyAction(forged.world, {
    type: 'offer-field-item-transfer',
    itemEventId: forgeEvent.id,
    recipientId: witness.id,
    recipientRole: witness.role
  }, founder, { now: '2026-11-23T10:00:09.000Z', allowTransfers: true });
  const offerEvent = offered.world.events.at(-1);
  assert.equal(offerEvent.type, 'field-item-transfer-offered');
  assert.equal(offerEvent.itemEventId, forgeEvent.id);
  assert.equal(offerEvent.actor.id, founder.id);
  assert.equal(offerEvent.recipientId, witness.id);
  assert.equal(offerEvent.recipientRole, witness.role);

  const recipient = projectCharacter(offered.world, witness);
  assert.equal(recipient.fieldInventoryTotal, 0,
    'A pending offer is not recipient ownership.');
  assert.equal(recipient.fieldItemTransferOffers.length, 1);
  const incoming = recipient.fieldItemTransferOffers[0];
  assert.equal(incoming.offerId, offerEvent.offerId);
  assert.equal(incoming.status, 'offered');
  assert.equal(incoming.item.eventId, forgeEvent.id);
  assert.equal(incoming.item.ownerId, founder.id);
  assert.equal(incoming.item.ownerRole, founder.role);
  assert.equal(incoming.item.creatorId, founder.id);
  assert.equal(incoming.item.sourceKind, 'source-archive-recovery');
  assert.deepEqual([
    incoming.item.sourceRecovery.failureEventId,
    incoming.item.sourceRecovery.publicationEventId
  ], [fixture.failure.id, capture.publicationEvent.id]);
  assert.equal(incoming.item.sourceRecovery.failureCode, fixture.failure.failureCode);
  assert.equal(incoming.item.sourceRecovery.repository, repository);
  assert.equal(incoming.item.sourceRecovery.commitSha, commitSha);
  assert.equal(incoming.item.sourceRecovery.path, sourcePath);
  assert.equal(incoming.item.sourceRecovery.sha256, capture.sha256);
  assert.equal(incoming.item.sourceRecovery.gitBlobSha, capture.gitBlobSha);
  assert.equal(incoming.item.sourceRecovery.size, capture.size);
  assert.equal(incoming.item.transferHistory.length, 1);
  assert.equal(incoming.item.transferHistory[0].offerId, offerEvent.offerId);
  assert.equal(incoming.item.transferHistory[0].status, 'offered');
  assert.equal(recipient.fieldItemTransferHistory.length, 1);
  assert.equal(recipient.fieldItemTransferHistory[0].item.sourceRecovery.failureEventId, fixture.failure.id);
  assert.equal(recipient.fieldItemTransferHistory[0].item.sourceRecovery.publicationEventId, capture.publicationEvent.id);

  const objective = recoveryQuest(offered.world, fixture.failure.id);
  assert.deepEqual([objective.progress, objective.target, objective.complete], [3, 4, false]);
  assert.deepEqual(objective.evidenceIds, [fixture.failure.id, capture.publicationEvent.id, forgeEvent.id]);
  assert.equal(offered.world.xp, capture.world.xp,
    'Forging and offering the item do not award XP.');
  const beforeProjection = structuredClone(offered.world);
  projectCharacter(offered.world, founder);
  projectCharacter(offered.world, witness);
  assert.deepEqual(offered.world, beforeProjection,
    'Showing the pending offer and its provenance is a read-only projection.');
  await validateWorld(offered.world);
});
