import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorld, applyAction, validateWorld, publicWorld } from '../game/model.mjs';
import { getQuestTrail } from '../game/quests.mjs';
import { projectSourceArchiveFailureObjects } from '../game/world-view.mjs';
import { projectSourceObservationRecords, sourceObservationRequestMaterial } from '../game/research-records.mjs';
import { buildGitHubSourceArchiveBody, GITHUB_SOURCE_ARCHIVE_INTENT_PREFIX } from '../game/artifacts.mjs';

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

async function worldWithPublishedObservatory() {
  const start = createWorld({ id: 'source-failure-origin-world', now: '2026-11-22T10:00:00.000Z' });
  const draft = await applyAction(start, {
    type: 'draft', kind: 'observatory', title: 'Source Observatory',
    intent: 'Retain attributed failure-context leads without converting them into truth verdicts.'
  }, founder, { now: '2026-11-22T10:00:01.000Z' });
  const published = await applyAction(draft.world, {
    type: 'publish', draftId: draft.result.draftId, expectedVersion: 0
  }, founder, { now: '2026-11-22T10:00:02.000Z' });
  return { world: published.world, creationId: published.result.creationId };
}

async function worldWithFailure() {
  const base = await worldWithPublishedObservatory();
  const world = structuredClone(base.world);
  const failure = failureEvent();
  world.events.push(failure);
  world.revision = world.events.length;
  world.updatedAt = failure.at;
  return { ...base, world, failure };
}

async function publishSourceArchive(world, {
  repository = 'ngl-damien/No-Gas-Labs-Alpha-1',
  commitSha = 'f'.repeat(40),
  path = 'test/fixtures/failure-ledger.mjs',
  fetchedAt = '2026-11-22T10:00:05.000Z',
  capturedAt = '2026-11-22T10:00:06.000Z',
  draftedAt = capturedAt,
  publishedAt = '2026-11-22T10:00:07.000Z',
  retrievalMode = 'server-rechecked'
} = {}) {
  const bytes = Buffer.from('export const ARCHIVE_RECOVERY = "later-capture";\\n', 'utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const gitBlobSha = createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + String.fromCharCode(0)))
    .update(bytes)
    .digest('hex');
  const html = await buildGitHubSourceArchiveBody({
    schema: 'ngl.github-source-capture.v1',
    retrievalMode,
    captureId: JSON.stringify([repository, commitSha, path, sha256]),
    repository, commitSha, path,
    permalink: 'https://github.com/' + repository + '/blob/' + commitSha + '/' + path,
    gitBlobSha, sha256, size: bytes.length,
    fetchedAt, capturedAt, bytesBase64: bytes.toString('base64'),
    text: bytes.toString('utf8'), integrityStatus: 'hashes-match'
  });
  const draft = await applyAction(world, {
    type: 'draft', kind: 'custom', title: 'Source Archive capture',
    intent: GITHUB_SOURCE_ARCHIVE_INTENT_PREFIX + ' · ' + retrievalMode + ' projection fixture',
    html
  }, founder, { now: draftedAt });
  const published = await applyAction(draft.world, {
    type: 'publish', draftId: draft.result.draftId, expectedVersion: 0
  }, founder, { now: publishedAt });
  return {
    world: published.world,
    creationId: published.result.creationId,
    publicationEvent: published.world.events.at(-1)
  };
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

test('a failure-derived Source Observation links one exact earlier event and records a provenance-only actor-scoped objective', async () => {
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
  assert.equal(founderQuest.title, 'Link a Source Archive failure to a Source Observation');
  assert.equal(founderQuest.complete, true);
  assert.deepEqual(founderQuest.evidenceIds, [event.id]);
  assert.equal(founderQuest.countsForQuestkeeper, false);
  assert.match(founderQuest.interpretation, /provenance link only.*not a source retry.*NOT_PERFORMED.*no XP/i);

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


test('a failure-only later-capture objective routes the Founder to the Evidence Archive without creating progress', async () => {
  const fixture = await worldWithFailure();
  const before = JSON.stringify(fixture.world);
  const beforeXp = fixture.world.xp;
  const projection = projectSourceArchiveFailureObjects(fixture.world);
  assert.equal(projection.complete, true);
  assert.equal(projection.captureProjectionComplete, true);
  const record = projection.records.find(candidate => candidate.eventId === fixture.failure.id);
  assert.ok(record);
  assert.equal(record.laterCaptureStatus, 'not-observed');
  assert.equal(record.laterCapture, null);

  const quest = getQuestTrail(fixture.world, founder).find(candidate =>
    candidate.id === 'founder-source-archive-later-capture'
  );
  assert.ok(quest);
  assert.equal(quest.target, 2);
  assert.equal(quest.progress, 1);
  assert.equal(quest.complete, false);
  assert.deepEqual(quest.evidenceIds, [fixture.failure.id]);
  assert.deepEqual(quest.action, { type: 'location', id: 'evidence_archive' });
  assert.equal(quest.countsForQuestkeeper, false);
  assert.equal(fixture.world.xp, beforeXp);
  assert.equal(JSON.stringify(fixture.world), before);
  assert.equal(getQuestTrail(fixture.world, witness).some(candidate =>
    candidate.id === 'founder-source-archive-later-capture'
  ), false);
});

test('a later server-rechecked capture of the same pinned target completes a two-event Founder objective without claiming receipt equality or source truth', async () => {
  const fixture = await worldWithFailure();
  const beforeXp = fixture.world.xp;
  const captured = await publishSourceArchive(fixture.world);
  const projection = projectSourceArchiveFailureObjects(captured.world);
  assert.equal(projection.captureProjectionComplete, true);
  const record = projection.records.find(candidate => candidate.eventId === fixture.failure.id);
  assert.ok(record);
  assert.equal(record.laterCaptureStatus, 'observed');
  assert.equal(record.laterCaptureStatusLabel, 'LATER SERVER-RECHECKED CAPTURE OBSERVED');
  assert.equal(record.laterCaptureCount, 1);
  assert.equal(record.laterCapture.creationId, captured.creationId);
  assert.equal(record.laterCapture.version, 1);
  assert.equal(record.laterCapture.publicationEventId, captured.publicationEvent.id);
  assert.equal(record.laterCapture.repository, fixture.failure.repository);
  assert.equal(record.laterCapture.commitSha, fixture.failure.commitSha);
  assert.equal(record.laterCapture.path, fixture.failure.path);
  assert.ok(Date.parse(record.laterCapture.fetchedAt) > Date.parse(fixture.failure.at));
  assert.ok(Date.parse(record.laterCapture.capturedAt) > Date.parse(fixture.failure.at));
  assert.ok(record.laterCapture.publicationPosition > record.historyPosition);
  assert.equal(projection.mostRecentVisibleRetryableFailure.eventId, fixture.failure.id);

  const beforeQuest = JSON.stringify(captured.world);
  const quest = getQuestTrail(captured.world, founder).find(candidate =>
    candidate.id === 'founder-source-archive-later-capture'
  );
  assert.ok(quest);
  assert.equal(quest.title, 'Capture the same pinned source after a recorded failure');
  assert.equal(quest.target, 2);
  assert.equal(quest.progress, 2);
  assert.equal(quest.complete, true);
  assert.deepEqual(quest.evidenceIds, [fixture.failure.id, captured.publicationEvent.id]);
  assert.equal(quest.countsForQuestkeeper, false);
  assert.match(quest.interpretation, /same repository.*full commit SHA.*path.*expected.*not retained.*not proof.*no XP/i);
  assert.equal(JSON.stringify(captured.world), beforeQuest);
  assert.equal(captured.world.xp, beforeXp + 100);

  assert.equal(getQuestTrail(captured.world, witness).some(candidate =>
    candidate.id === 'founder-source-archive-later-capture'
  ), false);
});

test('client-reported or different-target Source Archive publications do not count as later server captures', async () => {
  const fixture = await worldWithFailure();
  const clientReported = await publishSourceArchive(fixture.world, { retrievalMode: 'client-reported' });
  const clientProjection = projectSourceArchiveFailureObjects(clientReported.world);
  const clientRecord = clientProjection.records.find(candidate => candidate.eventId === fixture.failure.id);
  assert.equal(clientProjection.captureProjectionComplete, true);
  assert.equal(clientRecord.laterCaptureStatus, 'not-observed');
  assert.equal(clientRecord.laterCapture, null);

  const differentPath = await publishSourceArchive(fixture.world, { path: 'test/fixtures/other-source.mjs' });
  const pathProjection = projectSourceArchiveFailureObjects(differentPath.world);
  const pathRecord = pathProjection.records.find(candidate => candidate.eventId === fixture.failure.id);
  assert.equal(pathProjection.captureProjectionComplete, true);
  assert.equal(pathRecord.laterCaptureStatus, 'not-observed');
  assert.equal(pathRecord.laterCapture, null);
});

test('pre-failure captures, partial history, and duplicate publication bindings fail closed', async () => {
  const base = await worldWithPublishedObservatory();
  const earlier = await publishSourceArchive(base.world, {
    fetchedAt: '2026-11-22T10:00:02.100Z',
    capturedAt: '2026-11-22T10:00:02.200Z',
    publishedAt: '2026-11-22T10:00:02.500Z'
  });
  const earlierWorld = structuredClone(earlier.world);
  const failure = failureEvent();
  earlierWorld.events.push(failure);
  earlierWorld.revision = earlierWorld.events.length;
  earlierWorld.updatedAt = failure.at;
  const earlierProjection = projectSourceArchiveFailureObjects(earlierWorld);
  const earlierRecord = earlierProjection.records.find(candidate => candidate.eventId === failure.id);
  assert.equal(earlierProjection.captureProjectionComplete, true);
  assert.equal(earlierRecord.laterCaptureStatus, 'not-observed');

  const fixture = await worldWithFailure();
  const partialWorld = structuredClone(fixture.world);
  partialWorld.revision += 1;
  const partialProjection = projectSourceArchiveFailureObjects(partialWorld);
  const partialRecord = partialProjection.records.find(candidate => candidate.eventId === fixture.failure.id);
  assert.equal(partialProjection.complete, false);
  assert.equal(partialProjection.captureProjectionComplete, false);
  assert.equal(partialRecord.laterCaptureStatus, 'unknown');
  const partialQuest = getQuestTrail(partialWorld, founder).find(candidate =>
    candidate.id === 'founder-source-archive-later-capture'
  );
  assert.ok(partialQuest);
  assert.equal(partialQuest.progress, 1);
  assert.equal(partialQuest.complete, false);
  assert.equal(partialQuest.action, null);
  assert.match(partialQuest.blockedReason, /partial|incomplete|ambiguous/i);

  const later = await publishSourceArchive(fixture.world);
  const ambiguousWorld = structuredClone(later.world);
  const originalPublication = ambiguousWorld.events.find(event =>
    event.id === later.publicationEvent.id
  );
  ambiguousWorld.events.push({
    ...originalPublication,
    id: 'duplicate-source-archive-publication-1'
  });
  ambiguousWorld.revision = ambiguousWorld.events.length;
  const ambiguousProjection = projectSourceArchiveFailureObjects(ambiguousWorld);
  const ambiguousRecord = ambiguousProjection.records.find(candidate =>
    candidate.eventId === fixture.failure.id
  );
  assert.equal(ambiguousProjection.captureProjectionComplete, false);
  assert.equal(ambiguousRecord.laterCaptureStatus, 'unknown');
  assert.equal(ambiguousRecord.laterCapture, null);
});

test('later-capture projection fails closed when aggregate retained-version scan exceeds its budget', async () => {
  const fixture = await worldWithFailure();
  const captured = await publishSourceArchive(fixture.world);
  const completeProjection = projectSourceArchiveFailureObjects(captured.world);
  const completeRecord = completeProjection.records.find(candidate => candidate.eventId === fixture.failure.id);
  assert.equal(completeRecord.laterCaptureStatus, 'observed');

  const world = structuredClone(captured.world);
  for (const suffix of ['a', 'b']) {
    const id = 'unrelated-history-' + suffix;
    world.creations.push({
      id,
      kind: 'loom',
      intent: '',
      html: '',
      version: 50_001,
      versions: Array.from({ length: 50_000 }, (_, index) => ({
        id, version: index + 1, kind: 'loom', intent: '', html: ''
      }))
    });
  }

  const projection = projectSourceArchiveFailureObjects(world);
  assert.equal(projection.complete, true);
  assert.equal(projection.captureProjectionComplete, false);
  assert.equal(projection.captureProjectionReason, 'retained-version-scan-budget-exhausted');
  const record = projection.records.find(candidate => candidate.eventId === fixture.failure.id);
  assert.ok(record);
  assert.equal(record.laterCaptureStatus, 'unknown');
  assert.equal(record.laterCaptureCount, null);
  assert.equal(record.laterCapture, null);
});

test('later-capture matching fails closed when aggregate failure-by-capture comparisons exceed their budget', async () => {
  const fixture = await worldWithFailure();
  const later = await publishSourceArchive(fixture.world);
  const earlier = await publishSourceArchive(fixture.world, {
    fetchedAt: '2026-11-22T09:59:58.000Z',
    capturedAt: '2026-11-22T09:59:59.000Z',
    draftedAt: '2026-11-22T10:00:04.000Z',
    publishedAt: '2026-11-22T10:00:08.000Z'
  });

  const baseEvents = fixture.world.events.filter(event => event.id !== fixture.failure.id);
  const baseEventIds = new Set(baseEvents.map(event => event.id));
  const captureDraftEvent = later.world.events.find(event =>
    event.type === 'draft' && !baseEventIds.has(event.id)
  );
  assert.ok(captureDraftEvent);

  const failureEvents = [structuredClone(fixture.failure)];
  for (let index = 1; index < 317; index++) {
    const suffix = String(index).padStart(3, '0');
    failureEvents.push({
      ...structuredClone(fixture.failure),
      id: 'source-archive-failure-budget-' + suffix,
      attemptId: 'source-archive-attempt-budget-' + suffix,
      requestIdDigest: createHash('sha256').update('source-archive-request-budget-' + suffix).digest('hex'),
      actionDigest: createHash('sha256').update('source-archive-action-budget-' + suffix).digest('hex')
    });
  }

  const earlierCreation = earlier.world.creations.find(creation => creation.id === earlier.creationId);
  assert.ok(earlierCreation);
  const extraCreations = [];
  const extraPublications = [];
  for (let index = 1; index < 317; index++) {
    const suffix = String(index).padStart(3, '0');
    const creationId = 'source-capture-budget-' + suffix;
    const creation = structuredClone(earlierCreation);
    creation.id = creationId;
    creation.version = 1;
    creation.publishedAt = earlier.publicationEvent.at;
    creation.versions = [];
    extraCreations.push(creation);

    const publication = structuredClone(earlier.publicationEvent);
    publication.id = 'source-capture-publication-budget-' + suffix;
    publication.creationId = creationId;
    publication.version = 1;
    publication.at = earlier.publicationEvent.at;
    publication.requestId = 'source-capture-publication-request-budget-' + suffix;
    publication.actionFingerprint = createHash('sha256')
      .update('source-capture-publication-action-budget-' + suffix).digest('hex');
    if (publication.actionResult && typeof publication.actionResult === 'object') {
      publication.actionResult = { ...publication.actionResult, creationId, version: 1 };
    }
    extraPublications.push(publication);
  }

  const world = structuredClone(later.world);
  world.creations.push(...extraCreations);
  world.events = [
    ...baseEvents.map(event => structuredClone(event)),
    ...failureEvents,
    structuredClone(captureDraftEvent),
    structuredClone(later.publicationEvent),
    ...extraPublications
  ];
  world.revision = world.events.length;
  world.updatedAt = later.publicationEvent.at;
  world.xp = fixture.world.xp + (317 * 100);

  const projection = projectSourceArchiveFailureObjects(world);
  assert.equal(projection.complete, true);
  assert.equal(projection.captureProjectionComplete, false);
  assert.equal(projection.captureProjectionReason, 'capture-match-scan-budget-exhausted');
  const latestFailure = failureEvents.at(-1);
  const record = projection.records.find(candidate => candidate.eventId === latestFailure.id);
  assert.ok(record);
  assert.equal(record.laterCaptureStatus, 'unknown');
  assert.equal(record.laterCaptureCount, null);
  assert.equal(record.laterCapture, null);

  const beforeQuest = JSON.stringify(world);
  const quest = getQuestTrail(world, founder).find(candidate =>
    candidate.id === 'founder-source-archive-later-capture'
  );
  assert.ok(quest);
  assert.equal(quest.progress, 1);
  assert.equal(quest.target, 2);
  assert.equal(quest.complete, false);
  assert.equal(quest.action, null);
  assert.deepEqual(quest.evidenceIds, [latestFailure.id]);
  assert.match(quest.blockedReason, /bounded later-capture matching budget.*UNKNOWN.*No capture or absence is inferred/i);
  assert.equal(JSON.stringify(world), beforeQuest);
});


test('partial public projections preserve server-assigned global failure positions without upgrading capture completeness', async () => {
  const fixture = await worldWithFailure();
  const partial = publicWorld(fixture.world, witness);
  const before = JSON.stringify(partial);
  const beforeXp = partial.xp;

  const projection = projectSourceArchiveFailureObjects(partial);
  assert.ok(projection);
  assert.equal(projection.complete, false);
  assert.equal(projection.unseenEventCount, fixture.world.events.length - partial.events.length);
  assert.equal(projection.captureProjectionComplete, false);

  const record = projection.records.find(candidate => candidate.eventId === fixture.failure.id);
  assert.ok(record);
  assert.equal(
    record.historyPosition,
    fixture.world.events.findIndex(event => event.id === fixture.failure.id) + 1
  );
  assert.equal(
    record.visiblePosition,
    partial.events.findIndex(event => event.id === fixture.failure.id) + 1
  );
  assert.notEqual(record.historyPosition, record.visiblePosition);
  assert.equal(record.laterCaptureStatus, 'unknown');
  assert.equal(record.laterCapture, null);

  const founderQuest = getQuestTrail(partial, founder).find(candidate =>
    candidate.id === 'founder-source-archive-later-capture'
  );
  assert.ok(founderQuest);
  assert.equal(founderQuest.progress, 1);
  assert.equal(founderQuest.complete, false);
  assert.equal(founderQuest.action, null);
  assert.match(founderQuest.blockedReason, /partial|incomplete|ambiguous/i);
  assert.equal(partial.xp, beforeXp);
  assert.equal(JSON.stringify(partial), before);

  const malformed = structuredClone(partial);
  const malformedFailure = malformed.events.find(event => event.id === fixture.failure.id);
  malformedFailure.historyPosition = malformed.events[0].historyPosition;
  assert.equal(
    projectSourceArchiveFailureObjects(malformed),
    null,
    'duplicate or non-monotonic response-only history positions must not be trusted'
  );
});
