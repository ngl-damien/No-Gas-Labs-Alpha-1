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

test('unique, earlier research records receive only explicit chronological links', () => {
  const projected = projectResearchRecords([proposal(), report(), challenge()]);
  const byId = new Map(projected.map(event => [event.id, event]));
  assert.equal(byId.get('report-event-1')._projection.proposal?.id, 'proposal-event-1');
  assert.equal(byId.get('report-event-1')._projection.proposalStatus, 'linked');
  assert.equal(byId.get('challenge-event-1')._projection.proposal?.id, 'proposal-event-1');
  assert.equal(byId.get('challenge-event-1')._projection.targetReport?.id, 'report-event-1');
  assert.equal(byId.get('challenge-event-1')._projection.targetReportStatus, 'linked');
  assert.deepEqual(projected.map(event => event.id), ['challenge-event-1', 'report-event-1', 'proposal-event-1']);
});

test('duplicate proposal identity is preserved but never used to infer report context', () => {
  const projected = projectResearchRecords([
    proposal(),
    proposal({ id: 'proposal-event-2', title: 'Conflicting proposal title' }),
    report(),
    challenge()
  ]);
  const byId = new Map(projected.map(event => [event.id, event]));
  assert.equal(byId.get('report-event-1')._projection.proposal, null);
  assert.equal(byId.get('report-event-1')._projection.proposalStatus, 'ambiguous');
  assert.equal(byId.get('challenge-event-1')._projection.targetReport, null);
  assert.equal(byId.get('challenge-event-1')._projection.targetReportStatus, 'unavailable');
});

test('duplicate report identifiers cannot silently choose a challenge target', () => {
  const projected = projectResearchRecords([
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
  const projected = projectResearchRecords([proposal(), challenge(), report()]);
  const target = projected.find(event => event.id === 'challenge-event-1');
  assert.equal(target._projection.targetReport, null);
  assert.equal(target._projection.targetReportStatus, 'not-earlier');
});

test('duplicate event IDs remain visible but cannot establish linked context', () => {
  const source = [proposal(), { id: 'proposal-event-1', type: 'unrelated-event' }, report(), challenge()];
  const before = structuredClone(source);
  const projected = projectResearchRecords(source);
  const byId = new Map(projected.map(event => [event.id, event]));
  assert.equal(byId.get('proposal-event-1')._projection.eventIdUnique, false);
  assert.equal(byId.get('report-event-1')._projection.proposal, null);
  assert.equal(byId.get('challenge-event-1')._projection.targetReport, null);
  assert.deepEqual(source, before, 'projection must not mutate canonical input');
});

test('a challenge by the report author is not linked as an independent challenge', () => {
  const sameActorChallenge = challenge({ actor: { id: 'witness-1', role: 'witness' } });
  const target = projectResearchRecords([proposal(), report(), sameActorChallenge])
    .find(event => event.type === 'experiment-challenged');
  assert.equal(target._projection.targetReport, null);
  assert.equal(target._projection.targetReportStatus, 'same-actor');
});

test('records with missing or invalid timestamps stay visible without invented links', () => {
  const projected = projectResearchRecords([
    proposal({ at: 'not-a-time' }),
    report({ at: 'not-a-time' }),
    challenge({ at: 'not-a-time' })
  ]);
  assert.equal(projected.length, 3);
  assert.ok(projected.every(event => event._projection.eventIdUnique));
  assert.equal(projected.find(event => event.type === 'experiment-challenged')._projection.targetReport, null);
});

test('duplicate challenge identity cannot establish a target report', () => {
  const projected = projectResearchRecords([
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
  const missingActorProjection = projectResearchRecords([proposal(), report(), missingActor])
    .find(event => event.type === 'experiment-challenged');
  assert.equal(missingActorProjection._projection.targetReport, null);
  assert.equal(missingActorProjection._projection.targetReportStatus, 'invalid-challenge');

  const duplicateIdProjection = projectResearchRecords([
    proposal(), report(), challenge(),
    { id: 'challenge-event-1', type: 'unrelated-event' }
  ]).find(event => event.type === 'experiment-challenged');
  assert.equal(duplicateIdProjection._projection.targetReport, null);
  assert.equal(duplicateIdProjection._projection.targetReportStatus, 'ambiguous');
});
