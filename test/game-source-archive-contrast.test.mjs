import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildGitHubSourceArchiveBody,
  GITHUB_SOURCE_ARCHIVE_INTENT_PREFIX
} from '../game/artifacts.mjs';
import { applyAction, createWorld, validateWorld } from '../game/model.mjs';
import { getQuestTrail } from '../game/quests.mjs';
import {
  projectResearchRecords,
  projectSourceArchivePredicateContrasts,
  SOURCE_PREDICATE_PUBLIC_RETENTION_ACK_VERSION
} from '../game/research-records.mjs';

const founder = Object.freeze({ id: 'founder-session', role: 'founder', name: 'Founder' });
const witness = Object.freeze({ id: 'witness-session', role: 'witness', name: 'Witness' });
const repository = 'ngl-damien/No-Gas-Labs-Alpha-1';
const sourceBytes = Buffer.from(
  'NGL_CONTRAST_PRESENT\nThis is a test-only pinned source fixture.\n',
  'utf8'
);
let clock = Date.parse('2026-11-17T05:00:00.000Z');
const tick = () => new Date(clock += 1000).toISOString();

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitBlobSha(bytes) {
  const header = Buffer.from('blob ' + bytes.length + '\0', 'utf8');
  return createHash('sha1').update(Buffer.concat([header, bytes])).digest('hex');
}

async function publishFixture(world, { commitSha, path }) {
  const capturedAt = tick();
  const digest = sha256(sourceBytes);
  const capture = {
    schema: 'ngl.github-source-capture.v1',
    integrityStatus: 'hashes-match',
    repository,
    commitSha,
    path,
    permalink: 'https://github.com/' + repository + '/blob/' + commitSha + '/' + path,
    captureId: JSON.stringify([repository, commitSha, path, digest]),
    gitBlobSha: gitBlobSha(sourceBytes),
    sha256: digest,
    size: sourceBytes.length,
    text: sourceBytes.toString('utf8'),
    bytesBase64: sourceBytes.toString('base64'),
    fetchedAt: capturedAt,
    capturedAt,
    retrievalMode: 'server-rechecked'
  };
  const html = await buildGitHubSourceArchiveBody(capture);
  const draft = await applyAction(world, {
    type: 'draft',
    kind: 'custom',
    title: 'Source contrast test fixture',
    intent: GITHUB_SOURCE_ARCHIVE_INTENT_PREFIX + ' test-only fixture',
    html
  }, founder, { now: tick() });
  const published = await applyAction(draft.world, {
    type: 'publish',
    draftId: draft.result.draftId,
    expectedVersion: 0
  }, founder, { now: tick() });
  return {
    world: published.world,
    archive: {
      creationId: published.result.creationId,
      version: published.result.version,
      sha256: digest,
      size: sourceBytes.length
    }
  };
}

async function evaluatePredicate(world, actor, archive, literal, predicateKind = 'contains-literal') {
  const result = await applyAction(world, {
    type: 'evaluate-source-archive-predicate',
    creationId: archive.creationId,
    version: archive.version,
    predicateKind,
    literal,
    publicRetentionAcknowledgementVersion: SOURCE_PREDICATE_PUBLIC_RETENTION_ACK_VERSION
  }, actor, { now: tick(), allowSourceArchivePredicate: true });
  return { world: result.world, event: result.world.events.at(-1) };
}

function contrastObjective(world, actor) {
  return getQuestTrail(world, actor).find(objective =>
    objective.id === actor.role + '-source-archive-contrast'
  );
}

test('Source Archive contrast quest requires both operators on one actor, literal and exact retained version', async () => {
  clock = Date.parse('2026-11-17T05:00:00.000Z');
  let world = createWorld({
    id: 'source-archive-contrast-test',
    founderName: 'Damien Featherstone',
    now: new Date(clock).toISOString()
  });

  const first = await publishFixture(world, {
    commitSha: 'a'.repeat(40),
    path: 'docs/contrast-a.md'
  });
  world = first.world;
  const second = await publishFixture(world, {
    commitSha: 'b'.repeat(40),
    path: 'docs/contrast-b.md'
  });
  world = second.world;
  const publicationXp = world.xp;
  assert.equal(publicationXp, 200);

  const literal = 'NGL_CONTRAST_PRESENT';
  const absentLiteral = 'NGL_CONTRAST_ABSENT';
  const founderContains = await evaluatePredicate(
    world, founder, first.archive, literal, 'contains-literal'
  );
  world = founderContains.world;
  const witnessContains = await evaluatePredicate(
    world, witness, first.archive, literal, 'contains-literal'
  );
  world = witnessContains.world;
  const founderOtherVersionDoesNot = await evaluatePredicate(
    world, founder, second.archive, literal, 'does-not-contain-literal'
  );
  world = founderOtherVersionDoesNot.world;
  const founderOtherLiteralDoesNot = await evaluatePredicate(
    world, founder, first.archive, absentLiteral, 'does-not-contain-literal'
  );
  world = founderOtherLiteralDoesNot.world;

  assert.equal(founderContains.event.outcome, 'MATCH');
  assert.equal(witnessContains.event.outcome, 'MATCH');
  assert.equal(founderOtherVersionDoesNot.event.outcome, 'NO_MATCH');
  assert.equal(founderOtherLiteralDoesNot.event.outcome, 'MATCH');

  const projected = projectResearchRecords(world.events, world.creations);
  const founderGroups = projectSourceArchivePredicateContrasts(projected, founder);
  assert.deepEqual(
    founderGroups.map(group => ({
      creationId: group.creationId,
      literal: group.literal,
      progress: group.progress,
      complete: group.complete
    })),
    [
      { creationId: first.archive.creationId, literal, progress: 1, complete: false },
      { creationId: second.archive.creationId, literal, progress: 1, complete: false },
      { creationId: first.archive.creationId, literal: absentLiteral, progress: 1, complete: false }
    ]
  );

  const founderPartial = contrastObjective(world, founder);
  assert.equal(founderPartial.progress, 1);
  assert.equal(founderPartial.target, 2);
  assert.equal(founderPartial.complete, false);
  assert.deepEqual(founderPartial.evidenceIds, [founderContains.event.id]);
  assert.equal(founderPartial.countsForQuestkeeper, false);

  const witnessPartial = contrastObjective(world, witness);
  assert.equal(witnessPartial.progress, 1);
  assert.equal(witnessPartial.target, 2);
  assert.equal(witnessPartial.complete, false);
  assert.deepEqual(witnessPartial.evidenceIds, [witnessContains.event.id]);

  const witnessDoesNotContain = await evaluatePredicate(
    world, witness, first.archive, literal, 'does-not-contain-literal'
  );
  world = witnessDoesNotContain.world;
  assert.equal(witnessDoesNotContain.event.outcome, 'NO_MATCH');
  const founderAfterWitnessActivity = contrastObjective(world, founder);
  assert.equal(founderAfterWitnessActivity.progress, 1,
    'A Witness operator result must not complete the Founder objective.');
  const witnessComplete = contrastObjective(world, witness);
  assert.equal(witnessComplete.progress, 2);
  assert.equal(witnessComplete.target, 2);
  assert.equal(witnessComplete.complete, true);
  assert.deepEqual(witnessComplete.evidenceIds, [
    witnessContains.event.id,
    witnessDoesNotContain.event.id
  ]);

  const founderDoesNotContain = await evaluatePredicate(
    world, founder, first.archive, literal, 'does-not-contain-literal'
  );
  world = founderDoesNotContain.world;
  assert.equal(founderDoesNotContain.event.outcome, 'NO_MATCH');

  const founderComplete = contrastObjective(world, founder);
  assert.equal(founderComplete.progress, 2);
  assert.equal(founderComplete.target, 2);
  assert.equal(founderComplete.complete, true);
  assert.deepEqual(founderComplete.evidenceIds, [
    founderContains.event.id,
    founderDoesNotContain.event.id
  ]);

  const duplicateFounderContains = await evaluatePredicate(
    world, founder, first.archive, literal, 'contains-literal'
  );
  world = duplicateFounderContains.world;
  const founderAfterDuplicate = contrastObjective(world, founder);
  assert.equal(founderAfterDuplicate.progress, 2);
  assert.deepEqual(founderAfterDuplicate.evidenceIds, founderComplete.evidenceIds);

  const predicateEvents = world.events.filter(event =>
    event.type === 'source-archive-predicate-evaluated'
  );
  assert.equal(predicateEvents.length, 7);
  assert.ok(predicateEvents.every(event =>
    event.sourceTruth === 'NOT_ASSESSED' &&
    event.independentVerification === 'NOT_PERFORMED' &&
    event.modelAssertions === 'LEADS_ONLY'
  ));
  assert.equal(world.xp, publicationXp, 'Predicate and contrast activity must award no XP.');

  const beforeProjection = structuredClone(world);
  contrastObjective(world, founder);
  contrastObjective(world, witness);
  assert.deepEqual(world, beforeProjection, 'Quest inspection must remain read-only.');
  await validateWorld(world);
});


test('conflicting duplicate predicate outcomes remain visible and withhold Source Analyst contrast progress', async () => {
  clock = Date.parse('2026-11-17T06:00:00.000Z');
  let world = createWorld({
    id: 'source-archive-contrast-conflicting-duplicate',
    founderName: 'Damien Featherstone',
    now: new Date(clock).toISOString()
  });
  const published = await publishFixture(world, {
    commitSha: 'c'.repeat(40),
    path: 'docs/contrast-conflicting-duplicate.md'
  });
  world = published.world;
  const literal = 'NGL_CONTRAST_PRESENT';
  const contains = await evaluatePredicate(world, founder, published.archive, literal, 'contains-literal');
  world = contains.world;
  const doesNotContain = await evaluatePredicate(world, founder, published.archive, literal, 'does-not-contain-literal');
  world = doesNotContain.world;
  const duplicateContains = await evaluatePredicate(world, founder, published.archive, literal, 'contains-literal');
  world = duplicateContains.world;

  const conflicted = structuredClone(world);
  const duplicate = conflicted.events.find(event => event.id === duplicateContains.event.id);
  assert.ok(duplicate);
  assert.equal(duplicate.outcome, 'MATCH');
  duplicate.outcome = 'NO_MATCH';

  const projected = projectResearchRecords(conflicted.events, conflicted.creations);
  const group = projectSourceArchivePredicateContrasts(projected, founder).find(item =>
    item.creationId === published.archive.creationId && item.version === published.archive.version &&
    item.literal === literal
  );
  assert.ok(group);
  assert.equal(group.complete, false);
  assert.equal(group.progress, 1);
  assert.deepEqual(group.conflictedPredicateKinds, ['contains-literal']);
  assert.deepEqual(group.conflictEventIds, [contains.event.id, duplicateContains.event.id]);
  assert.deepEqual(group.evidenceIds, [doesNotContain.event.id]);

  const objective = contrastObjective(conflicted, founder);
  assert.equal(objective.progress, 1);
  assert.equal(objective.target, 2);
  assert.equal(objective.complete, false);
  assert.deepEqual(objective.evidenceIds, [doesNotContain.event.id]);
  assert.match(objective.blockedReason, /conflicting outcomes/i);
  assert.ok(conflicted.events.some(event => event.id === contains.event.id));
  assert.ok(conflicted.events.some(event => event.id === doesNotContain.event.id));
  assert.ok(conflicted.events.some(event => event.id === duplicateContains.event.id));

  const beforeInspection = structuredClone(conflicted);
  contrastObjective(conflicted, founder);
  assert.deepEqual(conflicted, beforeInspection, 'conflict projection and quest inspection remain read-only');
  assert.equal(conflicted.xp, 100, 'predicate conflicts create no XP or reward');
});
