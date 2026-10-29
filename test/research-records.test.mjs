import test from 'node:test';
import assert from 'node:assert/strict';
import { projectResearchRecords } from '../game/research-records.mjs';

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
  assert.equal(byId.get('challenge-event-1')._projection.proposal?.id, 'proposal-event-1');
  assert.equal(byId.get('challenge-event-1')._projection.targetReport?.id, 'report-event-1');
  assert.equal(byId.get('challenge-event-1')._projection.targetReportStatus, 'linked');
  assert.deepEqual(projected.map(event => event.id), ['challenge-event-1', 'report-event-1', 'proposal-event-1']);
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
