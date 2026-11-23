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
