import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyAction, validateWorld } from '../game/model.mjs';
import { projectChronicle } from '../game/chronicle.mjs';
import { institutionActivityCount } from '../game/world-view.mjs';
import { getQuestTrail } from '../game/quests.mjs';
import { projectCharacter } from '../game/character-sheet.mjs';

const founder = { id: 'damien', name: 'Damien', role: 'founder' };
const witness = { id: 'witness-moonshot-1', name: 'Witness', role: 'witness' };

async function publishedSource() {
  const initial = createWorld({ id: 'moonshot-test-world', founderName: 'Damien', now: '2026-10-27T00:00:00.000Z' });
  const draft = await applyAction(initial, {
    type: 'draft', kind: 'observatory', title: 'Source artifact',
    intent: 'A retained source claim with explicit uncertainty.'
  }, founder, { now: '2026-10-27T00:00:01.000Z' });
  return applyAction(draft.world, {
    type: 'publish', draftId: draft.result.draftId, expectedVersion: 0
  }, founder, { now: '2026-10-27T00:00:02.000Z' });
}

test('Moonshot Field retains a falsifiable proposal without implying execution or reward', async () => {
  const published = await publishedSource();
  const proposal = await applyAction(published.world, {
    type: 'propose-moonshot',
    title: 'Does the claim survive?',
    hypothesis: 'The source claim holds under the stated conditions.',
    falsifier: 'A reproducible counterexample appears under those conditions.',
    evidenceNeeded: 'Independent observation plus the exact retained source version.',
    sourceCreationId: published.result.creationId,
    sourceVersion: 1
  }, witness, {
    now: '2026-10-27T00:00:03.000Z',
    requestId: 'moonshot-model-test-1',
    actionFingerprint: 'a'.repeat(64)
  });

  const event = proposal.world.events.at(-1);
  assert.equal(event.type, 'moonshot-proposed');
  assert.equal(event.actor.role, 'witness');
  assert.equal(event.sourceCreationId, published.result.creationId);
  assert.equal(event.sourceVersion, 1);
  assert.equal(event.status, undefined);
  assert.equal(event.outcome, undefined);
  assert.equal(proposal.world.xp, published.world.xp);
  assert.equal(proposal.world.revision, published.world.revision + 1);

  const valid = await validateWorld(proposal.world);
  assert.equal(institutionActivityCount('moonshot_field', valid), 1);
  const chronicle = projectChronicle({ world: valid });
  const entry = chronicle.entries.find(item => item.eventType === 'moonshot-proposed');
  assert.ok(entry);
  assert.equal(entry.category, 'MOONSHOT FIELD');
  assert.match(entry.summary, /not an executed experiment/i);
  assert.match(entry.detail, /Falsifier: A reproducible counterexample/);
  assert.match(entry.detail, /Source: Source artifact v1/);
});

test('Moonshot Field rejects unretained source versions and malformed retained proposals', async () => {
  const published = await publishedSource();
  const before = published.world.events.length;
  await assert.rejects(applyAction(published.world, {
    type: 'propose-moonshot',
    title: 'Stale source proposal',
    hypothesis: 'A bounded hypothesis.',
    falsifier: 'A clear counterexample.',
    evidenceNeeded: 'A retained source.',
    sourceCreationId: published.result.creationId,
    sourceVersion: 9
  }, witness, { now: '2026-10-27T00:00:03.000Z' }), error => error.code === 'STALE_VERSION');
  assert.equal(published.world.events.length, before);

  const proposal = await applyAction(published.world, {
    type: 'propose-moonshot',
    title: 'A standalone question',
    hypothesis: 'This may be true.',
    falsifier: 'A counterexample may refute it.',
    evidenceNeeded: 'Independent observation.',
    sourceCreationId: null,
    sourceVersion: null
  }, witness, { now: '2026-10-27T00:00:03.000Z' });
  const tampered = structuredClone(proposal.world);
  tampered.events.at(-1).falsifier = '';
  await assert.rejects(validateWorld(tampered), error => error.code === 'INVALID_WORLD');
});


test('Moonshot quest completes only from the active character\'s unique retained proposal event', async () => {
  const published = await publishedSource();
  const initial = await validateWorld(published.world);
  const founderBefore = getQuestTrail(initial, founder).find(item => item.id === 'founder-moonshot-proposal');
  const witnessBefore = getQuestTrail(initial, witness).find(item => item.id === 'witness-moonshot-proposal');
  assert.equal(founderBefore.complete, false);
  assert.deepEqual(founderBefore.action, { type: 'location', id: 'moonshot_field' });
  assert.equal(witnessBefore.complete, false);
  assert.deepEqual(witnessBefore.action, { type: 'location', id: 'moonshot_field' });

  const proposal = await applyAction(published.world, {
    type: 'propose-moonshot',
    title: 'Can the source claim be falsified?',
    hypothesis: 'The claim holds under stated conditions.',
    falsifier: 'A reproducible counterexample appears.',
    evidenceNeeded: 'Independent observation.',
    sourceCreationId: published.result.creationId,
    sourceVersion: 1
  }, witness, { now: '2026-10-27T00:00:03.000Z' });
  const after = await validateWorld(proposal.world);
  const founderAfter = getQuestTrail(after, founder).find(item => item.id === 'founder-moonshot-proposal');
  const witnessAfter = getQuestTrail(after, witness).find(item => item.id === 'witness-moonshot-proposal');
  assert.equal(founderAfter.complete, false, 'Witness work cannot complete the Founder objective');
  assert.equal(witnessAfter.complete, true);
  assert.deepEqual(witnessAfter.evidenceIds, [proposal.world.events.at(-1).id]);
  assert.equal(witnessAfter.evidence[0].creationId, published.result.creationId);
  assert.equal(witnessAfter.evidence[0].version, 1);

  const duplicate = structuredClone(after);
  duplicate.events.push({ ...duplicate.events.at(-1), at: '2026-10-27T00:00:04.000Z' });
  assert.equal(
    getQuestTrail(duplicate, witness).find(item => item.id === 'witness-moonshot-proposal').complete,
    false,
    'Duplicated event identity cannot manufacture quest completion'
  );
});

test('experiment reports preserve failed and contradictory attempts without adjudicating them', async () => {
  const published = await publishedSource();
  const proposal = await applyAction(published.world, {
    type: 'propose-moonshot',
    title: 'Can the source claim be falsified?',
    hypothesis: 'The source claim holds under its stated conditions.',
    falsifier: 'A reproducible counterexample appears.',
    evidenceNeeded: 'A retained artifact and an independent observation.',
    sourceCreationId: published.result.creationId,
    sourceVersion: 1
  }, witness, { now: '2026-10-27T00:00:03.000Z' });
  const report = await applyAction(proposal.world, {
    type: 'report-experiment',
    moonshotId: proposal.result.moonshotId,
    procedure: 'Compare the source claim against the stated condition.',
    observation: 'The observed comparison contradicted the prediction.',
    reportedOutcome: 'contradicts',
    evidenceCreationId: published.result.creationId,
    evidenceVersion: 1
  }, witness, { now: '2026-10-27T00:00:04.000Z' });

  const event = report.world.events.at(-1);
  assert.equal(event.type, 'experiment-reported');
  assert.equal(event.reportedOutcome, 'contradicts');
  assert.equal(event.outcome, undefined, 'the report must not manufacture a canonical outcome');
  assert.equal(event.status, undefined, 'the report must not manufacture an adjudication status');
  assert.equal(report.world.xp, proposal.world.xp);
  assert.equal(report.world.revision, proposal.world.revision + 1);
  assert.equal(event.evidenceCreationId, published.result.creationId);
  assert.equal(event.evidenceVersion, 1);

  const valid = await validateWorld(report.world);
  const chronicle = projectChronicle({ world: valid });
  const entry = chronicle.entries.find(item => item.eventType === 'experiment-reported');
  assert.ok(entry);
  assert.equal(entry.category, 'MOONSHOT FIELD');
  assert.match(entry.title, /CONTRADICTS/);
  assert.match(entry.summary, /not independently observed, adjudicated, or accepted/i);
  assert.match(entry.detail, /Observation: The observed comparison contradicted the prediction/);
  assert.match(entry.detail, /Linked artifact: Source artifact v1/);
  assert.equal(entry.warning, '');

  const witnessQuest = getQuestTrail(valid, witness).find(item => item.id === 'witness-experiment-report');
  const founderQuest = getQuestTrail(valid, founder).find(item => item.id === 'founder-experiment-report');
  assert.equal(witnessQuest.complete, true, 'a unique retained report completes only the reporting actor\'s objective');
  assert.equal(founderQuest.complete, false);
  assert.equal(projectCharacter(valid, witness).skills.find(skill => skill.id === 'experimenter').count, 1);
});

test('experiment reports reject unbound proposals, invalid outcomes, incomplete evidence references, and tampering', async () => {
  const published = await publishedSource();
  const proposal = await applyAction(published.world, {
    type: 'propose-moonshot',
    title: 'Standalone test',
    hypothesis: 'A bounded hypothesis.',
    falsifier: 'A counterexample.',
    evidenceNeeded: 'An observation.',
    sourceCreationId: null,
    sourceVersion: null
  }, witness, { now: '2026-10-27T00:00:03.000Z' });
  const base = {
    type: 'report-experiment',
    moonshotId: proposal.result.moonshotId,
    procedure: 'Run the stated procedure.',
    observation: 'The attempt did not complete.',
    reportedOutcome: 'failed',
    evidenceCreationId: null,
    evidenceVersion: null
  };
  await assert.rejects(applyAction(proposal.world, { ...base, moonshotId: 'missing-moonshot' }, witness, { now: '2026-10-27T00:00:04.000Z' }), error => error.code === 'NOT_FOUND');
  await assert.rejects(applyAction(proposal.world, { ...base, reportedOutcome: 'accepted' }, witness, { now: '2026-10-27T00:00:04.000Z' }), error => error.code === 'INVALID_OUTCOME');
  await assert.rejects(applyAction(proposal.world, { ...base, evidenceCreationId: published.result.creationId }, witness, { now: '2026-10-27T00:00:04.000Z' }), error => error.code === 'INVALID_EVIDENCE');
  await assert.rejects(applyAction(proposal.world, { ...base, evidenceCreationId: published.result.creationId, evidenceVersion: 99 }, witness, { now: '2026-10-27T00:00:04.000Z' }), error => error.code === 'STALE_VERSION');

  const validReport = await applyAction(proposal.world, base, witness, { now: '2026-10-27T00:00:04.000Z' });
  const tampered = structuredClone(validReport.world);
  tampered.events.at(-1).reportedOutcome = 'verified';
  await assert.rejects(validateWorld(tampered), error => error.code === 'INVALID_WORLD');
  const duplicateReportId = structuredClone(validReport.world);
  duplicateReportId.events.push({ ...duplicateReportId.events.at(-1), id: 'different-event-id', at: '2026-10-27T00:00:05.000Z' });
  duplicateReportId.revision++;
  duplicateReportId.updatedAt = '2026-10-27T00:00:05.000Z';
  await assert.rejects(validateWorld(duplicateReportId), error => error.code === 'INVALID_WORLD');

  const reordered = structuredClone(validReport.world);
  const reportIndex = reordered.events.findIndex(event => event.type === 'experiment-reported');
  const [reportEvent] = reordered.events.splice(reportIndex, 1);
  const proposalIndex = reordered.events.findIndex(event => event.type === 'moonshot-proposed');
  reordered.events.splice(proposalIndex, 0, reportEvent);
  assert.equal(getQuestTrail(reordered, witness).find(item => item.id === 'witness-experiment-report').complete, false);
  assert.equal(projectCharacter(reordered, witness).skills.find(skill => skill.id === 'experimenter').count, 0);
  await assert.rejects(validateWorld(reordered), error => error.code === 'INVALID_WORLD');
});

test('experiment-report quest can act on another actor\'s retained proposal without claiming proposal ownership', async () => {
  const published = await publishedSource();
  const proposal = await applyAction(published.world, {
    type: 'propose-moonshot',
    title: 'Shared research question',
    hypothesis: 'A bounded claim holds.',
    falsifier: 'A reproducible counterexample appears.',
    evidenceNeeded: 'An independent observation.',
    sourceCreationId: published.result.creationId,
    sourceVersion: 1
  }, founder, { now: '2026-10-27T00:00:03.000Z' });
  const witnessQuest = getQuestTrail(proposal.world, witness).find(item => item.id === 'witness-experiment-report');
  assert.equal(witnessQuest.complete, false);
  assert.deepEqual(witnessQuest.action, { type: 'research-object', id: 'moonshot-object:' + proposal.result.moonshotId, moonshotId: proposal.result.moonshotId });
  assert.equal(witnessQuest.blockedReason, null);
});


test('Moonshot Field challenge is an actor-scoped quest backed by a different actor’s earlier report', async () => {
  const published = await publishedSource();
  const proposal = await applyAction(published.world, {
    type: 'propose-moonshot',
    title: 'Can the claim survive a counterexample?',
    hypothesis: 'The source claim holds under the stated conditions.',
    falsifier: 'A reproducible counterexample appears.',
    evidenceNeeded: 'A retained source and an independent observation.',
    sourceCreationId: published.result.creationId,
    sourceVersion: 1
  }, witness, { now: '2026-10-27T00:00:03.000Z' });
  const report = await applyAction(proposal.world, {
    type: 'report-experiment',
    moonshotId: proposal.result.moonshotId,
    procedure: 'Compare the source claim with the stated condition.',
    observation: 'The observed comparison contradicted the prediction.',
    reportedOutcome: 'contradicts',
    evidenceCreationId: published.result.creationId,
    evidenceVersion: 1
  }, witness, { now: '2026-10-27T00:00:04.000Z' });

  const founderBefore = getQuestTrail(report.world, founder)
    .find(item => item.id === 'founder-challenge-experiment-report');
  assert.equal(founderBefore.complete, false);
  const targetReportEvent = report.world.events.find(event => event.type === 'experiment-reported');
  assert.deepEqual(founderBefore.action, {
    type: 'research-activity',
    id: 'research-activity:' + targetReportEvent.id,
    moonshotId: proposal.result.moonshotId,
    activityId: report.result.reportId
  });
  const witnessBefore = getQuestTrail(report.world, witness)
    .find(item => item.id === 'witness-challenge-experiment-report');
  assert.equal(witnessBefore.complete, false);
  assert.match(witnessBefore.blockedReason, /another actor must retain/i);

  const challenge = await applyAction(report.world, {
    type: 'challenge-experiment-report',
    reportId: report.result.reportId,
    challengeType: 'methodology',
    challengeText: 'The procedure does not control the stated condition.',
    evidenceCreationId: published.result.creationId,
    evidenceVersion: 1
  }, founder, { now: '2026-10-27T00:00:05.000Z' });

  const founderAfter = getQuestTrail(challenge.world, founder)
    .find(item => item.id === 'founder-challenge-experiment-report');
  assert.equal(founderAfter.complete, true);
  assert.deepEqual(founderAfter.evidenceIds, [challenge.world.events.at(-1).id]);
  assert.equal(challenge.world.xp, report.world.xp, 'dissent activity must not award XP or adjudicate the report');
  const witnessAfter = getQuestTrail(challenge.world, witness)
    .find(item => item.id === 'witness-challenge-experiment-report');
  assert.equal(witnessAfter.complete, false, 'another actor’s challenge cannot complete the Witness objective');
});
