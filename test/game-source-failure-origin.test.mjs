import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorld, applyAction, validateWorld } from '../game/model.mjs';
import { getQuestTrail } from '../game/quests.mjs';
import { projectSourceArchiveFailureObjects } from '../game/world-view.mjs';
import { projectSourceObservationRecords, sourceObservationRequestMaterial } from '../game/research-records.mjs';

const founder = { id: 'damien', name: 'Damien Featherstone', role: 'founder' };
const witness = { id: 'origin-witness', name: 'Witness', role: 'witness' };
const note = {
  claim: 'One retained Source Archive retrieval attempt failed.',
  sourceKind: 'tool-output',
  source: 'Service-observed failure event source-archive-failure-event-1',
  falsifier: 'A new explicit capture succeeds and returns matching bytes.',
  uncertainty: 'This attempt does not establish source availability beyond itself, authorship, claim accuracy, independent verification, or truth.',
  nextTest: 'Start a new explicit capture with a new request ID and retain that attempt separately.'
};

function failureEvent(id = 'source-archive-failure-event-1', at = '2026-11-22T10:00:03.000Z') {
  return {
    id,
    type: 'source-archive-attempt-failed',
    actor: founder,
    at,
    semantics: 'Operational retrieval failure only; no source-truth, XP, publication or authority conclusion.',
    attemptId: 'source-archive-attempt-1',
    requestIdDigest: 'a'.repeat(64),
    actionDigest: 'b'.repeat(64),
    repository: 'ngl-damien/No-Gas-Labs-Alpha-1',
    commitSha: 'f'.repeat(40),
    path: 'test/fixtures/failure-ledger.mjs',
    failureCode: 'GITHUB_SOURCE_UNAVAILABLE',
    retryable: true,
    observedBy: 'shared-source-archive-service'
  };
}

async function worldWithFailure() {
  const start = createWorld({ id: 'source-failure-origin-world', now: '2026-11-22T10:00:00.000Z' });
  const draft = await applyAction(start, {
    type: 'draft', kind: 'observatory', title: 'Source Observatory',
    intent: 'Retain attributed failure-context leads without converting them into truth verdicts.'
  }, founder, { now: '2026-11-22T10:00:01.000Z' });
  const published = await applyAction(draft.world, {
    type: 'publish', draftId: draft.result.draftId, expectedVersion: 0
  }, founder, { now: '2026-11-22T10:00:02.000Z' });
  const world = structuredClone(published.world);
  const failure = failureEvent();
  world.events.push(failure);
  world.revision = world.events.length;
  world.updatedAt = failure.at;
  return { world, creationId: published.result.creationId, failure };
}

function actionFor(world, creationId, options = {}) {
  const actor = options.actor || founder;
  const originFailureEventId = options.originFailureEventId;
  const sourceSnapshotRevision = options.sourceSnapshotRevision ?? world.revision;
  const binding = originFailureEventId === undefined ? {} : { originFailureEventId };
  const material = sourceObservationRequestMaterial({
    actorId: actor.id, actorRole: actor.role, creationId, version: 1,
    sourceSnapshotRevision, ...note, ...binding
  });
  const digest = createHash('sha256').update(material).digest('hex');
  const observationId = 'source-observation-' + digest;
  return {
    observationId,
    action: {
      type: 'record-source-observation', requestId: observationId, observationId,
      creationId, version: 1, sourceSnapshotRevision, ...note, ...binding
    }
  };
}

test('failure-origin Source Observation identity uses v3 and binds the exact failure event ID', () => {
  const base = {
    actorId: founder.id, actorRole: founder.role, creationId: 'source-observatory-1',
    version: 1, sourceSnapshotRevision: 3, ...note
  };
  const legacy = sourceObservationRequestMaterial(base);
  const first = sourceObservationRequestMaterial({
    ...base, originFailureEventId: 'source-archive-failure-event-1'
  });
  const second = sourceObservationRequestMaterial({
    ...base, originFailureEventId: 'source-archive-failure-event-2'
  });
  assert.equal(JSON.parse(legacy).protocol, 'ngl.source-observation-id.v2');
  assert.equal(JSON.parse(first).protocol, 'ngl.source-observation-id.v3');
  assert.equal(JSON.parse(first).originFailureEventId, 'source-archive-failure-event-1');
  assert.notEqual(first, legacy);
  assert.notEqual(first, second);
  assert.throws(() => sourceObservationRequestMaterial({
    ...base, originFailureEventId: '../not-an-event'
  }), /failure event/i);
});

test('a failure-derived Source Observation links one exact earlier event and unlocks an actor-scoped research objective', async () => {
  const fixture = await worldWithFailure();
  const world = fixture.world;
  const failure = fixture.failure;
  const creationId = fixture.creationId;
  const failureProjection = projectSourceArchiveFailureObjects(world);
  assert.ok(failureProjection);
  assert.equal(failureProjection.records.some(record => record.eventId === failure.id), true);
  const beforeXp = world.xp;
  const prepared = actionFor(world, creationId, { originFailureEventId: failure.id });
  const recorded = await applyAction(world, prepared.action, founder, {
    now: '2026-11-22T10:00:04.000Z',
    requestId: prepared.observationId,
    actionFingerprint: 'c'.repeat(64)
  });
  const event = recorded.world.events.at(-1);
  assert.equal(event.type, 'source-observation-recorded');
  assert.equal(event.originFailureEventId, failure.id);
  assert.equal(event.sourceSnapshotRevision, world.revision);
  assert.equal(recorded.world.xp, beforeXp);
  await validateWorld(recorded.world);

  const records = projectSourceObservationRecords(
    recorded.world.events, recorded.world.creations,
    { revision: recorded.world.revision, revisionPresent: true }
  );
  const record = records.find(candidate => candidate.observationId === prepared.observationId);
  assert.ok(record);
  assert.equal(record.originFailureEventId, failure.id);
  assert.equal(record.failureOriginStatus, 'linked');
  assert.equal(record.projectionStatus, 'linked');

  const founderQuest = getQuestTrail(recorded.world, founder).find(candidate =>
    candidate.id === 'founder-source-archive-failure-investigation'
  );
  assert.ok(founderQuest);
  assert.equal(founderQuest.complete, true);
  assert.deepEqual(founderQuest.evidenceIds, [event.id]);
  assert.equal(founderQuest.countsForQuestkeeper, false);
  assert.match(founderQuest.interpretation, /free text does not count.*provenance only.*NOT_PERFORMED.*no XP/i);

  const witnessQuest = getQuestTrail(recorded.world, witness).find(candidate =>
    candidate.id === 'witness-source-archive-failure-investigation'
  );
  assert.ok(witnessQuest);
  assert.equal(witnessQuest.complete, false);
  assert.equal(witnessQuest.progress, 0);
  assert.deepEqual(witnessQuest.action, { type: 'location', id: 'moonshot_field' });
  assert.equal(recorded.world.xp, beforeXp);
});

test('a free-text failure event ID is not enough to complete the failure-investigation objective', async () => {
  const fixture = await worldWithFailure();
  const prepared = actionFor(fixture.world, fixture.creationId);
  prepared.action.source = 'The failure event was ' + fixture.failure.id + ', copied into free text only.';
  const material = sourceObservationRequestMaterial({
    actorId: founder.id, actorRole: founder.role, creationId: fixture.creationId,
    version: 1, sourceSnapshotRevision: fixture.world.revision,
    ...note, source: prepared.action.source
  });
  const digest = createHash('sha256').update(material).digest('hex');
  prepared.action.observationId = 'source-observation-' + digest;
  prepared.action.requestId = prepared.action.observationId;
  const recorded = await applyAction(fixture.world, prepared.action, founder, {
    now: '2026-11-22T10:00:04.000Z',
    requestId: prepared.action.observationId,
    actionFingerprint: 'd'.repeat(64)
  });
  const objective = getQuestTrail(recorded.world, founder).find(candidate =>
    candidate.id === 'founder-source-archive-failure-investigation'
  );
  assert.ok(objective);
  assert.equal(objective.complete, false);
  assert.equal(objective.progress, 0);
  assert.deepEqual(objective.action, { type: 'location', id: 'moonshot_field' });
});

test('unknown, wrong-type, or snapshot-excluded failure origins are rejected', async () => {
  const fixture = await worldWithFailure();
  const unknown = actionFor(fixture.world, fixture.creationId, {
    originFailureEventId: 'missing-failure-event'
  });
  await assert.rejects(
    applyAction(fixture.world, unknown.action, founder, {
      now: '2026-11-22T10:00:04.000Z',
      requestId: unknown.observationId,
      actionFingerprint: 'e'.repeat(64)
    }),
    error => error.code === 'INVALID_SOURCE_FAILURE_ORIGIN'
  );
  const publication = fixture.world.events.find(event => event.type === 'publish');
  const wrongType = actionFor(fixture.world, fixture.creationId, {
    originFailureEventId: publication.id
  });
  await assert.rejects(
    applyAction(fixture.world, wrongType.action, founder, {
      now: '2026-11-22T10:00:04.000Z',
      requestId: wrongType.observationId,
      actionFingerprint: 'f'.repeat(64)
    }),
    error => error.code === 'INVALID_SOURCE_FAILURE_ORIGIN'
  );
  const stale = actionFor(fixture.world, fixture.creationId, {
    originFailureEventId: fixture.failure.id,
    sourceSnapshotRevision: fixture.world.revision - 1
  });
  await assert.rejects(
    applyAction(fixture.world, stale.action, founder, {
      now: '2026-11-22T10:00:04.000Z',
      requestId: stale.observationId,
      actionFingerprint: '1'.repeat(64)
    }),
    error => error.code === 'SOURCE_FAILURE_ORIGIN_PREDATES_SNAPSHOT'
  );
});
