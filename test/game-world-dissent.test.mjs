import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld, applyAction} from '../game/model.mjs';
import {projectMoonshotWorldObjects} from '../game/world-view.mjs';

const founder = Object.freeze({id: 'founder-session-183', name: 'Damien', role: 'founder'});
const witness = Object.freeze({id: 'witness-session-183', name: 'Witness', role: 'witness'});

function clock() {
  let current = Date.parse('2026-11-17T09:00:00.000Z');
  return () => new Date(++current).toISOString();
}

async function publishEvidence(world, actor, title, next) {
  const drafted = await applyAction(world, {
    type: 'draft',
    kind: 'comic',
    title,
    intent: 'A retained test artifact used only to exercise evidence-linked research projection.',
  }, actor, {now: next()});
  const published = await applyAction(drafted.world, {
    type: 'publish',
    draftId: drafted.result.draftId,
    expectedVersion: 0,
  }, actor, {now: next()});
  return {
    world: published.world,
    creationId: published.result.creationId,
    version: published.result.version,
  };
}

async function propose(world, actor, next, title = 'Competing reports on one retained artifact') {
  const result = await applyAction(world, {
    type: 'propose-moonshot',
    title,
    hypothesis: 'The retained artifact supports one bounded interpretation.',
    falsifier: 'A reproducible observation from the same retained version contradicts that interpretation.',
    evidenceNeeded: 'Two attributed reports linked to the exact same published artifact version.',
  }, actor, {now: next()});
  return {world: result.world, moonshotId: result.result.moonshotId};
}

async function report(world, actor, next, moonshotId, evidence, reportedOutcome, suffix) {
  const result = await applyAction(world, {
    type: 'report-experiment',
    moonshotId,
    procedure: 'Inspect the exact retained artifact version using the declared procedure.',
    observation: 'This is a test fixture self-report; no independent adjudication is asserted.',
    reportedOutcome,
    evidenceCreationId: evidence.creationId,
    evidenceVersion: evidence.version,
  }, actor, {now: next()});
  const event = result.world.events.find(item => item.reportId === result.result.reportId);
  assert.ok(event, 'The report must be retained as an actor-attributed world event.');
  return {world: result.world, reportId: result.result.reportId, eventId: event.id, suffix};
}

function disagreementFor(world, moonshotId) {
  const moonshot = projectMoonshotWorldObjects(world).find(object => object.moonshotId === moonshotId);
  assert.ok(moonshot, 'The retained Moonshot must project into the world.');
  return moonshot.activityObjects.filter(object => object.recordType === 'experiment-disagreement');
}

test('opposing cross-actor reports on one exact evidence version become a map-visible read-only Moonshot object', async () => {
  const next = clock();
  let world = createWorld({now: next()});
  const evidence = await publishEvidence(world, founder, 'Shared evidence fixture', next);
  world = evidence.world;
  const proposal = await propose(world, founder, next);
  world = proposal.world;

  const support = await report(world, founder, next, proposal.moonshotId, evidence, 'supports', 'support');
  world = support.world;
  const xpBeforeSecondReport = world.xp;
  const contradiction = await report(world, witness, next, proposal.moonshotId, evidence, 'contradicts', 'contradict');
  world = contradiction.world;

  assert.equal(world.xp, xpBeforeSecondReport, 'An experiment report is not XP.');
  const eventsBeforeProjection = structuredClone(world.events);
  const projection = disagreementFor(world, proposal.moonshotId);
  assert.equal(projection.length, 1, 'One exact evidence group should produce one disagreement object.');

  const [dossier] = projection;
  assert.equal(dossier.projectionKind, 'DERIVED_READ_ONLY');
  assert.equal(dossier.evidenceCreationId, evidence.creationId);
  assert.equal(dossier.evidenceVersion, evidence.version);
  assert.deepEqual(dossier.derivedFromEventIds, [support.eventId, contradiction.eventId]);
  assert.deepEqual(dossier.supportingReportIds, [support.reportId]);
  assert.deepEqual(dossier.contradictingReportIds, [contradiction.reportId]);
  assert.deepEqual(dossier.actorIds, [founder.id, witness.id]);
  assert.equal(dossier.supportingReportCount, 1);
  assert.equal(dossier.contradictingReportCount, 1);
  assert.equal(dossier.mapVisible, true);
  assert.ok(Number.isFinite(dossier.x) && Number.isFinite(dossier.y));
  assert.match(dossier.title, /not adjudicated/i);
  assert.match(dossier.summary, /not a verdict/i);

  assert.deepEqual(world.events, eventsBeforeProjection, 'Projection must not append a canonical event.');
  assert.equal(world.xp, xpBeforeSecondReport, 'Projection must not award XP.');
  assert.deepEqual(projectMoonshotWorldObjects(world), projectMoonshotWorldObjects(world),
    'The same retained event history must produce the same map objects.');
});

test('self-contradiction and reports against different evidence versions do not become cross-actor disagreement', async () => {
  const next = clock();
  let world = createWorld({now: next()});
  const firstEvidence = await publishEvidence(world, founder, 'Evidence version A', next);
  world = firstEvidence.world;
  const secondEvidence = await publishEvidence(world, founder, 'Evidence version B', next);
  world = secondEvidence.world;
  const proposal = await propose(world, founder, next, 'Reports with distinct bases remain separate');
  world = proposal.world;

  const selfSupport = await report(world, founder, next, proposal.moonshotId, firstEvidence, 'supports', 'self-support');
  world = selfSupport.world;
  const selfContradiction = await report(world, {id: founder.id, name: 'Founder session', role: 'witness'}, next,
    proposal.moonshotId, firstEvidence, 'contradicts', 'same-session-other-role');
  world = selfContradiction.world;
  const otherEvidenceContradiction = await report(world, witness, next, proposal.moonshotId, secondEvidence,
    'contradicts', 'different-evidence');
  world = otherEvidenceContradiction.world;

  assert.equal(disagreementFor(world, proposal.moonshotId).length, 0,
    'Role labels do not turn one actor ID into two actors, and different evidence versions are not comparable.');
  const moonshot = projectMoonshotWorldObjects(world).find(object => object.moonshotId === proposal.moonshotId);
  assert.equal(moonshot.attemptCount, 3, 'All three original self-reports remain visible as attempts.');
  assert.equal(moonshot.activityObjects.filter(object => object.recordType === 'experiment-reported').length, 3);
  assert.equal(world.xp, 200, 'Only the two explicit artifact publications award XP.');
});
