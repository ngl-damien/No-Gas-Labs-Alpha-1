import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceObservationRequestMaterial, projectResearchRecords, projectSourceObservationRecords, hasSourcePredicatePublicRetentionAcknowledgement, SOURCE_PREDICATE_PUBLIC_RETENTION_ACK_VERSION, SOURCE_PREDICATE_PUBLIC_RETENTION_ACK_REQUIRED_AFTER } from '../game/research-records.mjs';

const proposal = (overrides = {}) => ({
  id: 'proposal-event-1',
  type: 'moonshot-proposed',
  moonshotId: 'moonshot-1',
  title: 'Can the observation be reproduced?',
  hypothesis: 'A bounded hypothesis',
  falsifier: 'A repeatable counterexample',
  evidenceNeeded: 'A retained source version',
  actor: { id: 'founder-1', role: 'founder', name: 'Founder' },
  at: '2026-10-28T17:00:00.000Z',
  ...overrides
});
const report = (overrides = {}) => ({
  id: 'report-event-1',
  type: 'experiment-reported',
  reportId: 'report-1',
  moonshotId: 'moonshot-1',
  procedure: 'Repeat the documented procedure',
  observation: 'The record is incomplete',
  reportedOutcome: 'inconclusive',
  actor: { id: 'witness-1', role: 'witness', name: 'Witness' },
  at: '2026-10-28T17:01:00.000Z',
  ...overrides
});
const publication = (overrides = {}) => ({
  id: 'publish-source-1',
  type: 'publish',
  creationId: 'source-1',
  version: 1,
  actor: { id: 'founder-1', role: 'founder', name: 'Founder' },
  at: '2026-10-28T16:59:00.000Z',
  ...overrides
});
const challenge = (overrides = {}) => ({
  id: 'challenge-event-1',
  type: 'experiment-challenged',
  challengeId: 'challenge-1',
  reportId: 'report-1',
  moonshotId: 'moonshot-1',
  challengeType: 'missing-evidence',
  challengeText: 'The method cannot be reproduced from the supplied record.',
  actor: { id: 'founder-1', role: 'founder', name: 'Founder' },
  at: '2026-10-28T17:02:00.000Z',
  ...overrides
});

const challengeResponseEvent = (overrides = {}) => ({
  id: 'response-event-1',
  type: 'experiment-challenge-responded',
  responseId: 'response-1',
  challengeId: 'challenge-1',
  reportId: 'report-1',
  moonshotId: 'moonshot-1',
  responseText: 'The original author preserves the limitation and requests another test.',
  actor: { id: 'witness-1', role: 'witness', name: 'Witness' },
  at: '2026-10-28T17:03:00.000Z',
  ...overrides
});

const retainedSource = (overrides = {}) => ({
  id: 'source-1',
  kind: 'observatory',
  title: 'Retained source',
  version: 1,
  publishedAt: '2026-10-28T16:59:00.000Z',
  versions: [],
  ...overrides
});
const project = (events, creations = [retainedSource()]) => projectResearchRecords(events, creations);

test('Source Observation normalized identity binds a retained snapshot revision without rewriting legacy IDs', () => {
  const base = {
    actorId: 'witness-1', actorRole: 'witness', creationId: 'source-1', version: 1,
    claim: 'A bounded author-entered observation.', sourceKind: 'user-report',
    source: 'A participant report.', falsifier: null, uncertainty: null, nextTest: null
  };
  const legacy = sourceObservationRequestMaterial(base);
  const firstSnapshot = sourceObservationRequestMaterial({ ...base, sourceSnapshotRevision: 1 });
  const laterSnapshot = sourceObservationRequestMaterial({ ...base, sourceSnapshotRevision: 2 });
  assert.equal(JSON.parse(legacy).protocol, 'ngl.source-observation-id.v1');
  assert.equal(JSON.parse(firstSnapshot).protocol, 'ngl.source-observation-id.v2');
  assert.equal(JSON.parse(firstSnapshot).sourceSnapshotRevision, 1);
  assert.notEqual(firstSnapshot, laterSnapshot);
  assert.throws(
    () => sourceObservationRequestMaterial({ ...base, sourceSnapshotRevision: -1 }),
    /snapshot revision/i
  );
});

test('proposal source links require one earlier publication with consistent time', () => {
  const source = { sourceCreationId: 'source-1', sourceVersion: 1 };
  const status = events => project(events)
    .find(event => event.id === 'proposal-event-1')._projection.sourceStatus;

  assert.equal(status([publication(), proposal(source)]), 'linked');
  assert.equal(status([proposal(source)]), 'unavailable');
  assert.equal(status([proposal(source), publication()]), 'not-earlier');
  assert.equal(status([publication({ at: '2026-10-28T18:00:00.000Z' }), proposal(source)]), 'timestamp-conflict');
  assert.equal(status([publication(), publication({ id: 'publish-source-2' }), proposal(source)]), 'ambiguous');
  assert.equal(status([publication(), publication({ creationId: 'other-source', id: 'publish-source-1' }), proposal(source)]), 'ambiguous');
  assert.equal(status([proposal()]), 'not-provided');
  assert.equal(status([proposal({ sourceCreationId: 'source-1' })]), 'invalid');
});

test('report and challenge evidence links require unique earlier publications', () => {
  const evidence = { evidenceCreationId: 'source-1', evidenceVersion: 1 };
  const byId = events => new Map(project(events).map(event => [event.id, event]));
  const linked = byId([publication(), proposal(), report(evidence), challenge(evidence)]);
  assert.equal(linked.get('report-event-1')._projection.evidenceStatus, 'linked');
  assert.equal(linked.get('challenge-event-1')._projection.evidenceStatus, 'linked');

  const future = byId([proposal(), report(evidence), publication()]);
  assert.equal(future.get('report-event-1')._projection.evidenceStatus, 'not-earlier');

  const timestampConflict = byId([
    publication({ at: '2026-10-28T18:00:00.000Z' }),
    proposal(),
    report(evidence),
    challenge(evidence)
  ]);
  assert.equal(timestampConflict.get('report-event-1')._projection.evidenceStatus, 'timestamp-conflict');
  assert.equal(timestampConflict.get('challenge-event-1')._projection.evidenceStatus, 'timestamp-conflict');

  const duplicate = byId([
    publication(),
    publication({ id: 'publish-source-2' }),
    proposal(),
    report(evidence),
    challenge(evidence)
  ]);
  assert.equal(duplicate.get('report-event-1')._projection.evidenceStatus, 'ambiguous');
  assert.equal(duplicate.get('challenge-event-1')._projection.evidenceStatus, 'ambiguous');
});

test('unique, earlier research records receive only explicit chronological links', () => {
  const projected = project([proposal(), report(), challenge()]);
  const byId = new Map(projected.map(event => [event.id, event]));
  assert.equal(byId.get('report-event-1')._projection.proposal?.id, 'proposal-event-1');
  assert.equal(byId.get('report-event-1')._projection.proposalStatus, 'linked');
  assert.equal(byId.get('report-event-1')._projection.reportIdUnique, true);
  assert.equal(byId.get('challenge-event-1')._projection.proposal?.id, 'proposal-event-1');
  assert.equal(byId.get('challenge-event-1')._projection.targetReport?.id, 'report-event-1');
  assert.equal(byId.get('challenge-event-1')._projection.targetReportStatus, 'linked');
  assert.deepEqual(projected.map(event => event.id), ['challenge-event-1', 'report-event-1', 'proposal-event-1']);
});

test('research links and Archive order follow retained append positions when clocks regress', () => {
  const publishedAt = '2026-10-28T17:07:00.000Z';
  const events = [
    publication({ at: publishedAt }),
    proposal({
      at: '2026-10-28T17:06:00.000Z',
      sourceCreationId: 'source-1',
      sourceVersion: 1
    }),
    report({
      at: '2026-10-28T17:05:00.000Z',
      evidenceCreationId: 'source-1',
      evidenceVersion: 1
    }),
    challenge({
      at: '2026-10-28T17:04:00.000Z',
      evidenceCreationId: 'source-1',
      evidenceVersion: 1
    }),
    challengeResponseEvent({ at: '2026-10-28T17:03:00.000Z' })
  ];
  const before = structuredClone(events);
  const projected = project(events, [retainedSource({ publishedAt })]);
  const byId = new Map(projected.map(record => [record.id, record]));

  assert.equal(byId.get('proposal-event-1')._projection.sourceStatus, 'linked');
  assert.equal(byId.get('report-event-1')._projection.proposalStatus, 'linked');
  assert.equal(byId.get('report-event-1')._projection.evidenceStatus, 'linked');
  assert.equal(byId.get('challenge-event-1')._projection.targetReportStatus, 'linked');
  assert.equal(byId.get('challenge-event-1')._projection.evidenceStatus, 'linked');
  assert.equal(byId.get('response-event-1')._projection.targetChallengeStatus, 'linked');
  assert.deepEqual(projected.map(record => record.id), [
    'response-event-1',
    'challenge-event-1',
    'report-event-1',
    'proposal-event-1'
  ]);
  assert.deepEqual(events, before, 'append-order research projection is read-only');
});

test('a challenge response cannot point forward to a later challenge despite a later timestamp', () => {
  const projected = project([
    proposal(),
    report(),
    challengeResponseEvent({ at: '2026-10-28T17:10:00.000Z' }),
    challenge({ at: '2026-10-28T17:02:00.000Z' })
  ]);
  const responseRecord = projected.find(event => event.id === 'response-event-1');

  assert.equal(responseRecord._projection.targetChallenge, null);
  assert.equal(responseRecord._projection.targetChallengeStatus, 'not-earlier');
  assert.deepEqual(projected.map(record => record.id), [
    'challenge-event-1',
    'response-event-1',
    'report-event-1',
    'proposal-event-1'
  ]);
});

test('duplicate proposal identity is preserved but never used to infer report context', () => {
  const projected = project([
    proposal(),
    proposal({ id: 'proposal-event-2', title: 'Conflicting proposal title' }),
    report(),
    challenge()
  ]);
  const byId = new Map(projected.map(event => [event.id, event]));
  assert.equal(byId.get('proposal-event-1')._projection.proposalStatus, 'ambiguous');
  assert.equal(byId.get('report-event-1')._projection.proposal, null);
  assert.equal(byId.get('report-event-1')._projection.proposalStatus, 'ambiguous');
  assert.equal(byId.get('challenge-event-1')._projection.targetReport, null);
  assert.equal(byId.get('challenge-event-1')._projection.targetReportStatus, 'unavailable');
});

test('duplicate report identifiers cannot silently choose a challenge target', () => {
  const projected = project([
    proposal(),
    report(),
    report({ id: 'report-event-2', observation: 'A conflicting second record' }),
    challenge()
  ]);
  const duplicateReports = projected.filter(event => event.type === 'experiment-reported');
  assert.equal(duplicateReports.length, 2);
  assert.ok(duplicateReports.every(event => event._projection.reportIdUnique === false));
  const target = projected.find(event => event.id === 'challenge-event-1');
  assert.equal(target._projection.targetReport, null);
  assert.equal(target._projection.targetReportStatus, 'ambiguous');
});

test('a challenge cannot point forward to a later report in append-only history', () => {
  const projected = project([proposal(), challenge(), report()]);
  const target = projected.find(event => event.id === 'challenge-event-1');
  assert.equal(target._projection.targetReport, null);
  assert.equal(target._projection.targetReportStatus, 'not-earlier');
});

test('duplicate event IDs remain visible but cannot establish linked context', () => {
  const source = [proposal(), { id: 'proposal-event-1', type: 'unrelated-event' }, report(), challenge()];
  const before = structuredClone(source);
  const projected = project(source);
  const byId = new Map(projected.map(event => [event.id, event]));
  assert.equal(byId.get('proposal-event-1')._projection.eventIdUnique, false);
  assert.equal(byId.get('report-event-1')._projection.proposal, null);
  assert.equal(byId.get('challenge-event-1')._projection.targetReport, null);
  assert.deepEqual(source, before, 'projection must not mutate canonical input');
});

test('a challenge by the report author is not linked as an independent challenge', () => {
  const sameActorChallenge = challenge({ actor: { id: 'witness-1', role: 'witness' } });
  const target = project([proposal(), report(), sameActorChallenge])
    .find(event => event.type === 'experiment-challenged');
  assert.equal(target._projection.targetReport, null);
  assert.equal(target._projection.targetReportStatus, 'same-actor');
});

test('records with missing or invalid timestamps stay visible without invented links', () => {
  const projected = project([
    proposal({ at: 'not-a-time' }),
    report({ at: 'not-a-time' }),
    challenge({ at: 'not-a-time' })
  ]);
  assert.equal(projected.length, 3);
  assert.ok(projected.every(event => event._projection.eventIdUnique));
  assert.equal(projected.find(event => event.type === 'experiment-challenged')._projection.targetReport, null);
});

test('chronology accepts only canonical UTC timestamps with real calendar dates', () => {
  const invalidTimes = [
    '1',
    '2026-10-28',
    '2026-10-28T17:00:00.000',
    '2026-13-01T17:00:00.000Z',
    '2026-10-28T25:00:00Z',
    '2026-02-30T17:00:00.000Z',
    'October 28, 2026'
  ];

  for (const at of invalidTimes) {
    const invalidProposal = project([proposal({ at }), report(), challenge()]);
    assert.equal(invalidProposal.find(event => event.type === 'moonshot-proposed')._projection.proposalStatus, 'ambiguous', at);
    assert.equal(invalidProposal.find(event => event.type === 'experiment-reported')._projection.proposal, null, at);

    const invalidReport = project([proposal(), report({ at }), challenge()]);
    assert.equal(invalidReport.find(event => event.type === 'experiment-reported')._projection.proposal, null, at);
    assert.equal(invalidReport.find(event => event.type === 'experiment-challenged')._projection.targetReport, null, at);

    const invalidChallenge = project([proposal(), report(), challenge({ at })]);
    assert.equal(invalidChallenge.find(event => event.type === 'experiment-challenged')._projection.targetReport, null, at);
  }

  const valid = project([proposal(), report(), challenge()]);
  assert.equal(valid.find(event => event.type === 'experiment-reported')._projection.proposalStatus, 'linked');
  assert.equal(valid.find(event => event.type === 'experiment-challenged')._projection.targetReportStatus, 'linked');
});

test('duplicate challenge identity cannot establish a target report', () => {
  const projected = project([
    proposal(),
    report(),
    challenge(),
    challenge({ id: 'challenge-event-2', challengeText: 'A second conflicting challenge' })
  ]);
  const target = projected.find(event => event.id === 'challenge-event-1');
  assert.equal(target._projection.targetReport, null);
  assert.equal(target._projection.targetReportStatus, 'ambiguous');
});

test('a challenge with no attributable actor or a duplicate event ID gets no target link', () => {
  const missingActor = challenge({ actor: null });
  const missingActorProjection = project([proposal(), report(), missingActor])
    .find(event => event.type === 'experiment-challenged');
  assert.equal(missingActorProjection._projection.targetReport, null);
  assert.equal(missingActorProjection._projection.targetReportStatus, 'invalid-challenge');

  const duplicateIdProjection = project([
    proposal(), report(), challenge(),
    { id: 'challenge-event-1', type: 'unrelated-event' }
  ]).find(event => event.type === 'experiment-challenged');
  assert.equal(duplicateIdProjection._projection.targetReport, null);
  assert.equal(duplicateIdProjection._projection.targetReportStatus, 'ambiguous');
});

test('incomplete or unattributed proposals remain visible but cannot anchor research context', () => {
  const invalidProposals = [
    { title: '' },
    { title: 'x'.repeat(81) },
    { hypothesis: 'x'.repeat(1001) },
    { falsifier: '' },
    { evidenceNeeded: '' },
    { actor: null },
    { actor: { id: 'untrusted', role: 'system' } }
  ];
  for (const invalid of invalidProposals) {
    const projected = project([proposal(invalid), report()]);
    const proposalRecord = projected.find(event => event.type === 'moonshot-proposed');
    const reportRecord = projected.find(event => event.type === 'experiment-reported');
    assert.equal(proposalRecord._projection.proposalStatus, 'ambiguous');
    assert.equal(reportRecord._projection.proposal, null);
    assert.equal(reportRecord._projection.proposalStatus, 'missing');
  }
});

test('artifact links require one retained version and a matching Founder publication', () => {
  const sourceLink = { sourceCreationId: 'source-1', sourceVersion: 1 };
  const evidenceLink = { evidenceCreationId: 'source-1', evidenceVersion: 1 };
  const statuses = (creations, publicationEvent = publication()) => {
    const projected = project([
      publicationEvent,
      proposal(sourceLink),
      report(evidenceLink)
    ], creations);
    const proposalRecord = projected.find(event => event.type === 'moonshot-proposed');
    const reportRecord = projected.find(event => event.type === 'experiment-reported');
    return [proposalRecord._projection.sourceStatus, reportRecord._projection.evidenceStatus];
  };

  assert.deepEqual(statuses([retainedSource()]), ['linked', 'linked']);
  assert.deepEqual(statuses([]), ['unavailable', 'unavailable']);
  assert.deepEqual(statuses([retainedSource(), retainedSource()]), ['ambiguous', 'ambiguous']);
  assert.deepEqual(statuses([retainedSource({ publishedAt: '2026-10-28T18:00:00.000Z' })]),
    ['timestamp-conflict', 'timestamp-conflict']);
  assert.deepEqual(statuses([retainedSource()], publication({
    actor: { id: 'witness-1', role: 'witness', name: 'Witness' }
  })), ['invalid', 'invalid']);
});


test('accessor-backed research records are never evaluated and cannot establish links', () => {
  let getterCalls = 0;
  const unsafeProposal = proposal();
  Object.defineProperty(unsafeProposal, 'title', {
    enumerable: true,
    configurable: true,
    get() { getterCalls += 1; return 'getter-authored title'; }
  });

  const projected = project([publication(), unsafeProposal, report()]);
  const proposalRecord = projected.find(event => event.id === 'proposal-event-1');
  const reportRecord = projected.find(event => event.id === 'report-event-1');

  assert.equal(getterCalls, 0);
  assert.equal(proposalRecord._projection.recordSafe, false);
  assert.equal(proposalRecord._projection.proposalStatus, 'ambiguous');
  assert.equal(reportRecord._projection.proposal, null);
});

test('accessor-backed nested actors and retained versions cannot activate research links', () => {
  let getterCalls = 0;
  const unsafeReport = report();
  Object.defineProperty(unsafeReport.actor, 'id', {
    enumerable: true,
    configurable: true,
    get() { getterCalls += 1; return 'witness-1'; }
  });

  const retained = retainedSource();
  Object.defineProperty(retained, 'publishedAt', {
    enumerable: true,
    configurable: true,
    get() { getterCalls += 1; return '2026-10-28T16:59:00.000Z'; }
  });

  const projected = project([
    publication(),
    proposal({ sourceCreationId: 'source-1', sourceVersion: 1 }),
    unsafeReport
  ], [retained]);
  const proposalRecord = projected.find(event => event.id === 'proposal-event-1');
  const reportRecord = projected.find(event => event.id === 'report-event-1');

  assert.equal(getterCalls, 0);
  assert.equal(reportRecord._projection.recordSafe, false);
  assert.equal(proposalRecord._projection.sourceStatus, 'invalid');
  assert.equal(reportRecord._projection.evidenceStatus, 'invalid');
});

test('accessor-backed array entries and revoked input proxies fail closed without execution', () => {
  let getterCalls = 0;
  const events = [publication(), proposal(), report()];
  Object.defineProperty(events, '1', {
    enumerable: true,
    configurable: true,
    get() { getterCalls += 1; return proposal(); }
  });

  const projected = projectResearchRecords(events, [retainedSource()]);
  assert.equal(getterCalls, 0);
  assert.equal(projected.some(event => event.type === 'moonshot-proposed'), false);

  const revoked = Proxy.revocable([], {});
  revoked.revoke();
  assert.doesNotThrow(() => projectResearchRecords(revoked.proxy, [retainedSource()]));
  assert.deepEqual(projectResearchRecords(revoked.proxy, [retainedSource()]), []);
});


test('Source Analyst retention acknowledgement is versioned while pre-enforcement history remains readable', () => {
  const beforeEnforcement = {
    at: '2026-11-17T03:59:59.999Z'
  };
  const atEnforcement = {
    at: SOURCE_PREDICATE_PUBLIC_RETENTION_ACK_REQUIRED_AFTER
  };
  assert.equal(hasSourcePredicatePublicRetentionAcknowledgement(beforeEnforcement), true,
    'Legacy events before enforcement remain readable without rewriting history.');
  assert.equal(hasSourcePredicatePublicRetentionAcknowledgement(atEnforcement), false);
  assert.equal(hasSourcePredicatePublicRetentionAcknowledgement({
    ...atEnforcement,
    publicRetentionAcknowledgementVersion: SOURCE_PREDICATE_PUBLIC_RETENTION_ACK_VERSION
  }), true);
  assert.equal(hasSourcePredicatePublicRetentionAcknowledgement({
    ...atEnforcement,
    publicRetentionAcknowledgementVersion: 'ngl.source-predicate-public-retention.v0'
  }), false);
  assert.equal(hasSourcePredicatePublicRetentionAcknowledgement({
    ...beforeEnforcement,
    publicRetentionAcknowledgementVersion: 'unknown-version'
  }), false);
});


test('Source Observation notes, challenges and responses retain server-projected global positions', () => {
  const digest = 'a'.repeat(64);
  const observationId = 'source-observation-' + digest;
  const witnessActor = { id: 'witness-1', role: 'witness', name: 'Witness' };
  const founderActor = { id: 'founder-1', role: 'founder', name: 'Founder' };
  const observation = {
    id: 'source-observation-event-1',
    type: 'source-observation-recorded',
    observationId,
    normalizedRecordDigest: digest,
    creationId: 'source-1',
    version: 1,
    sourceSnapshotRevision: 1,
    claim: 'A bounded author-entered observation.',
    sourceKind: 'user-report',
    source: 'A participant report.',
    falsifier: null,
    uncertainty: null,
    nextTest: null,
    actor: witnessActor,
    at: '2026-10-28T17:00:00.000Z',
    originSchema: 'ngl.source-observatory.v2',
    bindingMode: 'SERVER_SESSION_RECEIPT',
    sourceSnapshotReceiptDigest: 'b'.repeat(64),
    sourceRetrieval: 'NOT_PERFORMED',
    independentVerification: 'NOT_PERFORMED',
    modelAssertions: 'LEADS_ONLY',
    execution: 'NOT_EXECUTED',
    historyPosition: 3
  };
  const events = [
    publication({ historyPosition: 1 }),
    observation,
    {
      id: 'source-challenge-event-1',
      type: 'source-observation-challenged',
      challengeId: 'source-challenge-1',
      observationId,
      creationId: 'source-1',
      version: 1,
      challengeType: 'missing-evidence',
      challengeText: 'The report has no independently observed evidence.',
      actor: founderActor,
      at: '2026-10-28T17:01:00.000Z',
      historyPosition: 5
    },
    {
      id: 'source-response-event-1',
      type: 'source-observation-challenge-responded',
      responseId: 'source-response-1',
      challengeId: 'source-challenge-1',
      observationId,
      creationId: 'source-1',
      version: 1,
      responseText: 'The author preserves the limitation and requests another test.',
      actor: witnessActor,
      at: '2026-10-28T17:02:00.000Z',
      historyPosition: 6
    }
  ];
  const records = projectSourceObservationRecords(events, [retainedSource()], { revision: 6, revisionPresent: true });
  assert.equal(records.length, 1);
  assert.equal(records[0].historyPosition, 3);
  assert.equal(records[0].sourceSnapshotRevision, 1);
  assert.equal(records[0].bindingMode, 'SERVER_SESSION_RECEIPT');
  assert.equal(records[0].sourceSnapshotReceiptDigest, 'b'.repeat(64));
  const malformedReceiptEvents = events.map(event => event.id === observation.id
    ? { ...event, sourceSnapshotReceiptDigest: 'not-a-sha256-receipt' }
    : event);
  const malformedReceipt = projectSourceObservationRecords(
    malformedReceiptEvents, [retainedSource()], { revision: 6, revisionPresent: true }
  );
  assert.equal(malformedReceipt[0].projectionStatus, 'malformed');
  assert.equal(records[0].challenges[0].historyPosition, 5);
  assert.equal(records[0].challenges[0].responses[0].historyPosition, 6);

  const legacyPartial = events.map(event => {
    const { historyPosition, ...withoutPosition } = event;
    return withoutPosition;
  });
  const unsequenced = projectSourceObservationRecords(
    legacyPartial, [retainedSource()], { allowLocalPositions: false }
  );
  assert.equal(unsequenced[0].historyPosition, null);
  assert.equal(unsequenced[0].projectionStatus, 'malformed');
  assert.equal(unsequenced[0].challenges.length, 0,
    'challenge and response attribution requires retained global append positions');
});
