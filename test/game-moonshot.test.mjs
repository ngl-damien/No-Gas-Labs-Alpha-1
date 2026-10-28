import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyAction, validateWorld } from '../game/model.mjs';
import { projectChronicle } from '../game/chronicle.mjs';
import { institutionActivityCount } from '../game/world-view.mjs';
import { getQuestTrail } from '../game/quests.mjs';

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



test('Moonshot source chronology compares instants rather than timestamp spelling', async () => {
  const published = await publishedSource();
  const proposal = await applyAction(published.world, {
    type: 'propose-moonshot',
    title: 'Chronology boundary',
    hypothesis: 'A source claim is temporally available.',
    falsifier: 'The proposal predates its source.',
    evidenceNeeded: 'Compare parsed timestamps.',
    sourceCreationId: published.result.creationId,
    sourceVersion: 1
  }, witness, { now: '2026-10-27T00:00:03.000Z' });

  const tampered = structuredClone(proposal.world);
  // This timestamp string sorts before the proposal, but -10:00 places the
  // source publication after it in real time. Lexical comparison is unsafe.
  tampered.creations[0].publishedAt = '2026-10-26T23:00:00.000-10:00';
  const eventAt = tampered.events.at(-1).at;
  assert.ok(tampered.creations[0].publishedAt < eventAt, 'fixture must fool string ordering');
  assert.ok(Date.parse(tampered.creations[0].publishedAt) > Date.parse(eventAt), 'fixture must put the source in the future');
  await assert.rejects(validateWorld(tampered), error => error.code === 'INVALID_WORLD');
});

test('world validation rejects backward event instants across timezone offsets', async () => {
  const published = await publishedSource();
  const proposal = await applyAction(published.world, {
    type: 'propose-moonshot',
    title: 'Standalone chronology case',
    hypothesis: 'The event sequence is ordered.',
    falsifier: 'A later string represents an earlier instant.',
    evidenceNeeded: 'Compare parsed timestamps.',
    sourceCreationId: null,
    sourceVersion: null
  }, witness, { now: '2026-10-27T00:00:03.000Z' });

  const tampered = structuredClone(proposal.world);
  const previousAt = tampered.events.at(-2).at;
  tampered.events.at(-1).at = '2026-10-27T01:00:00.000+14:00';
  tampered.updatedAt = tampered.events.at(-1).at;
  assert.ok(tampered.events.at(-1).at > previousAt, 'fixture must sort forward as text');
  assert.ok(Date.parse(tampered.events.at(-1).at) < Date.parse(previousAt), 'fixture must move the instant backward');
  await assert.rejects(validateWorld(tampered), error => error.code === 'INVALID_WORLD');
});
