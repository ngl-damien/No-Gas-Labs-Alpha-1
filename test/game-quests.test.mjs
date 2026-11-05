import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getLocationAction, findStudyReview, getQuestTrail, getActiveQuest } from '../game/quests.mjs';
import { sourceObservationRequestMaterial } from '../game/research-records.mjs';
import { projectGuildFieldSatchel } from '../game/social.mjs';

const founder = { id: 'founder-1', role: 'founder' };
const witness = { id: 'witness-1', role: 'witness' };
const empty = { creations: [] };
const world = { creations: [
  { id: 'oldest', kind: 'custom', title: 'First place', version: 2, versions: [{ version: 1 }] },
  { id: 'comic-1', kind: 'comic', title: 'Recovered comic', version: 1 },
  { id: 'observatory-1', kind: 'observatory', title: 'Source notes', version: 1 },
  { id: 'newest', kind: 'loom', title: 'Latest place', version: 1 }
] };

test('Founder guide actions launch the matching institutional activity', () => {
  assert.deepEqual(
    (({ type, recipe }) => ({ type, recipe }))(getLocationAction('relay', empty, founder)),
    { type: 'workbench', recipe: 'custom' }
  );
  assert.deepEqual(
    (({ type, recipe }) => ({ type, recipe }))(getLocationAction('river', empty, founder)),
    { type: 'workbench', recipe: 'observatory' }
  );
  assert.equal(getLocationAction('overlook', empty, founder).recipe, 'custom');
  assert.equal(getLocationAction('ruins', empty, founder).recipe, 'comic');
});

test('Long View opens the earliest real creation and River reuses an existing observatory', () => {
  assert.equal(getLocationAction('overlook', world, founder).creationId, 'oldest');
  assert.equal(getLocationAction('river', world, founder).creationId, 'observatory-1');
  assert.equal(getLocationAction('ruins', world, founder).creationId, 'comic-1');
});

test('Witness guide actions inspect published work and never route to the Founder workbench', () => {
  for (const location of ['relay', 'river', 'overlook', 'ruins']) {
    const action = getLocationAction(location, world, witness);
    assert.equal(action.type, 'inspect', location);
    assert.ok(action.creationId, location);
  }
});

test('Witnesses without published work can explore, but cannot manufacture an artifact', () => {
  for (const location of ['relay', 'river', 'overlook', 'ruins']) {
    const action = getLocationAction(location, empty, witness);
    assert.equal(action.type, 'places', location);
    assert.equal('recipe' in action, false, location);
  }
});

test('unknown locations fail closed and selecting an activity never mutates the world', () => {
  const before = structuredClone(world);
  assert.equal(getLocationAction('imaginary', world, founder), null);
  getLocationAction('overlook', world, founder);
  assert.deepEqual(world, before);
});


test('Long View only promises a version comparison when an earlier version is retained', () => {
  const firstOnly = { creations: [{ id: 'first-only', kind: 'custom', version: 1, versions: [] }] };
  assert.equal(getLocationAction('overlook', firstOnly, founder).label, 'Inspect the first version →');
  assert.equal(getLocationAction('overlook', firstOnly, witness).label, 'Inspect the first version →');
  assert.match(getLocationAction('overlook', firstOnly, witness).explanation, /no retained earlier version/i);

  const retained = { creations: [{ id: 'retained', kind: 'custom', version: 2, versions: [{ version: 1 }] }] };
  assert.equal(getLocationAction('overlook', retained, founder).label, 'Inspect retained versions →');
  assert.equal(getLocationAction('overlook', retained, witness).label, 'Compare a retained version →');
});


test('Academy review lookup searches the full history beyond the eight reviews shown', () => {
  const actor = { id: 'witness-1', role: 'witness' };
  const notes = Array.from({ length: 9 }, (_, index) => ({
    id: 'study-event-' + index, type: 'study', studyId: 'study-' + index,
    creationId: 'source-' + index, version: 1, at: '2026-10-28T16:00:00.000Z', actor
  }));
  // The newest note is reviewed first; eight older notes are reviewed later.
  // The UI's recent-eight display therefore omits the newest note's older review.
  const allReviews = [
    { id: 'review-event-8', type: 'study-reviewed', reviewId: 'review-8', studyId: 'study-8',
      creationId: 'source-8', version: 1, at: '2026-10-28T16:01:00.000Z', actor,
      response: 'Rechecked the retained source.', reflection: 'Repeat the check.' },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: 'review-event-' + index, type: 'study-reviewed', reviewId: 'review-' + index,
      studyId: 'study-' + index, creationId: 'source-' + index, version: 1,
      at: '2026-10-28T16:0' + (2 + index) + ':00.000Z', actor,
      response: 'Rechecked the retained source.', reflection: 'Repeat the check.'
    }))
  ];
  const visibleReviews = allReviews.slice().reverse().slice(0, 8);
  assert.equal(visibleReviews.some(review => review.studyId === 'study-8'), false);
  assert.equal(findStudyReview(notes[8], [notes[8], ...allReviews])?.reviewId, 'review-8');
  assert.equal(findStudyReview(notes[8], visibleReviews), null);
});


function experimentQuestWorld({ reportActor = founder, evidence = true, publicationAfterReport = false, duplicatePublication = false } = {}) {
  const publishedAt = '2026-10-28T17:00:00.000Z';
  const proposalAt = '2026-10-28T17:01:00.000Z';
  const reportAt = '2026-10-28T17:03:00.000Z';
  const artifact = {
    id: 'evidence-1', kind: 'observatory', title: 'Evidence packet',
    version: 1, publishedAt, receipt: { digest: 'a'.repeat(64), size: 12 }, versions: []
  };
  const publication = {
    id: 'publish-evidence-1', type: 'publish', creationId: artifact.id,
    version: 1, at: publishedAt, actor: founder
  };
  const proposal = {
    id: 'proposal-1', type: 'moonshot-proposed', moonshotId: 'moon-1',
    actor: founder, at: proposalAt, title: 'Test a bounded claim',
    hypothesis: 'A bounded hypothesis', falsifier: 'An observable counterexample',
    evidenceNeeded: 'A retained artifact'
  };
  const report = {
    id: 'report-event-1', type: 'experiment-reported', reportId: 'report-1',
    moonshotId: 'moon-1', actor: reportActor, at: reportAt,
    procedure: 'Run the stated procedure', observation: 'Record the observed result',
    reportedOutcome: 'failed',
    evidenceCreationId: evidence ? artifact.id : null,
    evidenceVersion: evidence ? 1 : null
  };
  const events = publicationAfterReport
    ? [proposal, report, publication]
    : [publication, proposal, report];
  if (duplicatePublication) events.splice(publicationAfterReport ? 3 : 1, 0, {
    ...publication, id: 'publish-evidence-duplicate'
  });
  return {
    creations: [artifact],
    events,
    discoveries: [],
    contributions: [],
    reports: []
  };
}

function guildExperimentQuestWorld() {
  const outsider = { id: 'outsider-1', role: 'witness', name: 'Outsider' };
  const guildFounder = { ...founder, name: 'Damien' };
  const guildWitness = { ...witness, name: 'Witness' };
  const world = experimentQuestWorld({ reportActor: outsider });
  world.xp = 0;
  world.creations[0].receipt.algorithm = 'sha256';
  world.events.unshift(
    {
      id: 'guild-created-1', type: 'guild-created', guildId: 'guild-1',
      name: 'Field Researchers', charter: 'Compare observations and preserve dissent.',
      actor: guildFounder, at: '2026-10-28T16:58:00.000Z',
      semantics: 'Game projection only; membership is not authority or proof of distinct humans.'
    },
    {
      id: 'guild-joined-1', type: 'guild-joined', guildId: 'guild-1',
      actor: guildWitness, at: '2026-10-28T16:59:00.000Z',
      semantics: 'Game projection only; membership is not authority or proof of distinct humans.'
    }
  );
  world.events.push(
    {
      id: 'member-report-event', type: 'experiment-reported', reportId: 'member-report',
      moonshotId: 'moon-1', actor: guildWitness, at: '2026-10-28T17:04:00.000Z',
      procedure: 'Repeat the bounded procedure.',
      observation: 'The member records a conflicting measurement.',
      reportedOutcome: 'contradicts', evidenceCreationId: 'evidence-1', evidenceVersion: 1
    },
    {
      id: 'outsider-challenge-event', type: 'experiment-challenged', challengeId: 'outsider-challenge',
      reportId: 'report-1', moonshotId: 'moon-1', actor: guildFounder,
      at: '2026-10-28T17:05:00.000Z', challengeType: 'methodology',
      challengeText: 'The outsider report needs reproducible method details.'
    }
  );
  return { world, guildFounder, guildWitness };
}

test('moonshot quest requires a report linked to one earlier retained publication, without certifying its claim', () => {
  for (const actor of [founder, witness]) {
    const world = experimentQuestWorld({ reportActor: actor });
    const trail = getQuestTrail(world, actor);
    const milestone = trail.find(item => item.id === actor.role + '-experiment-evidence');
    assert.ok(milestone, actor.role);
    assert.equal(milestone.complete, true, actor.role);
    assert.equal(milestone.progress, 1, actor.role);
    assert.deepEqual(milestone.evidence.map(item => [item.creationId, item.version]), [['evidence-1', 1]]);
    assert.equal(milestone.evidence[0].type, 'experiment-reported');
    assert.match(milestone.interpretation, /^Linkage only:/);
    assert.match(milestone.interpretation, /does not verify the procedure, observation, outcome, or hypothesis/i);
    // A failed self-report can satisfy the artifact-linkage objective; it does not
    // become a verified outcome or imply the hypothesis was true.
    assert.equal(world.events.find(event => event.type === 'experiment-reported').reportedOutcome, 'failed');
    assert.equal(Object.hasOwn(milestone, 'verifiedOutcome'), false);
  }
});

test('moonshot evidence objective stays open when an attempt has no retained artifact', () => {
  const world = experimentQuestWorld({ evidence: false });
  const milestone = getQuestTrail(world, founder).find(item => item.id === 'founder-experiment-evidence');
  assert.equal(milestone.complete, false);
  assert.equal(milestone.progress, 0);
  assert.deepEqual(milestone.action, { type: 'research-activity', id: 'research-activity:report-event-1', moonshotId: 'moon-1', activityId: 'report-1' });
  assert.equal(milestone.blockedReason, null);
});

test('research quests target the exact proposal or retained report they need', () => {
  const withoutReport = experimentQuestWorld();
  withoutReport.events = withoutReport.events.filter(event => event.type !== 'experiment-reported');
  const attempt = getQuestTrail(withoutReport, founder)
    .find(item => item.id === 'founder-experiment-report');
  assert.deepEqual(attempt.action, {
    type: 'research-object', id: 'moonshot-object:moon-1', moonshotId: 'moon-1'
  });

  const unlinked = getQuestTrail(experimentQuestWorld({ evidence: false }), founder)
    .find(item => item.id === 'founder-experiment-evidence');
  assert.deepEqual(unlinked.action, {
    type: 'research-activity', id: 'research-activity:report-event-1',
    moonshotId: 'moon-1', activityId: 'report-1'
  });

  const challenge = getQuestTrail(experimentQuestWorld(), witness)
    .find(item => item.id === 'witness-challenge-experiment-report');
  assert.deepEqual(challenge.action, {
    type: 'research-activity', id: 'research-activity:report-event-1',
    moonshotId: 'moon-1', activityId: 'report-1'
  });
});

test('research quest targets the latest appended eligible records even when their timestamps are backdated', () => {
  const proposals = experimentQuestWorld();
  proposals.events = proposals.events.filter(event => event.type !== 'experiment-reported');
  proposals.events.push({
    id: 'proposal-2', type: 'moonshot-proposed', moonshotId: 'moon-2',
    actor: founder, at: '2026-10-28T17:00:30.000Z', title: 'Second retained question',
    hypothesis: 'A second bounded hypothesis', falsifier: 'An observable counterexample',
    evidenceNeeded: 'A retained source or independent observation'
  });
  const attempt = getQuestTrail(proposals, founder)
    .find(item => item.id === 'founder-experiment-report');
  assert.deepEqual(attempt.action, {
    type: 'research-object', id: 'moonshot-object:moon-2', moonshotId: 'moon-2'
  }, 'the latest appended proposal is the target even when its timestamp is earlier');

  const reports = experimentQuestWorld();
  reports.events.push({
    id: 'report-event-2', type: 'experiment-reported', reportId: 'report-2',
    moonshotId: 'moon-1', actor: founder, at: '2026-10-28T17:02:00.000Z',
    procedure: 'Repeat the bounded procedure', observation: 'The second report remains inconclusive',
    reportedOutcome: 'inconclusive', evidenceCreationId: null, evidenceVersion: null
  });
  const challenge = getQuestTrail(reports, witness)
    .find(item => item.id === 'witness-challenge-experiment-report');
  assert.deepEqual(challenge.action, {
    type: 'research-activity', id: 'research-activity:report-event-2',
    moonshotId: 'moon-1', activityId: 'report-2'
  }, 'the newest appended other-actor report is the challenge target, not the oldest');
});

test('quest projection preserves exact evidence joins across a large retained history', () => {
  const world = experimentQuestWorld();
  const unrelated = Array.from({ length: 300 }, (_, index) => ({
    id: 'unrelated-' + index,
    type: 'unrelated',
    actor: founder,
    at: '2026-10-28T16:00:00.000Z'
  }));
  world.events = [...unrelated, ...world.events];

  for (let index = 0; index < 300; index += 1) {
    const at = new Date(Date.parse('2026-10-28T17:04:00.000Z') + index * 1000).toISOString();
    world.contributions.push({
      id: 'note-' + index,
      creationId: 'evidence-1',
      version: 1,
      text: 'Retained field note ' + index,
      actor: founder,
      at
    });
    world.events.push({
      id: 'note-event-' + index,
      type: 'contribute',
      creationId: 'evidence-1',
      version: 1,
      actor: founder,
      at
    });
  }

  const trail = getQuestTrail(world, founder);
  const fieldNote = trail.find(item => item.id === 'founder-field-note');
  assert.equal(fieldNote.complete, true);
  assert.equal(fieldNote.evidence.length, 300, 'all unique note/event pairs remain visible');
  assert.equal(new Set(fieldNote.evidence).size, 300, 'no note event is counted twice');
  assert.equal(trail.find(item => item.id === 'founder-experiment-evidence').complete, true,
    'indexed chronology still accepts the one retained publication preceding its report');
});

test('moonshot evidence objective rejects future-in-history and ambiguous publication references', () => {
  const after = getQuestTrail(experimentQuestWorld({ publicationAfterReport: true }), founder)
    .find(item => item.id === 'founder-experiment-evidence');
  assert.equal(after.complete, false);
  assert.equal(after.progress, 0);

  const duplicate = getQuestTrail(experimentQuestWorld({ duplicatePublication: true }), founder)
    .find(item => item.id === 'founder-experiment-evidence');
  assert.equal(duplicate.complete, false);
  assert.equal(duplicate.progress, 0);
});

test('moonshot quest refuses loose or rolled-over timestamps for retained publication, proposal, and report', () => {
  const invalidPublication = experimentQuestWorld();
  const publication = invalidPublication.events.find(event => event.type === 'publish');
  publication.at = '2026-02-30T17:00:00.000Z';
  invalidPublication.creations[0].publishedAt = publication.at;
  const publicationMilestone = getQuestTrail(invalidPublication, founder)
    .find(item => item.id === 'founder-experiment-evidence');
  assert.equal(publicationMilestone.complete, false);
  assert.equal(publicationMilestone.progress, 0);

  const invalidProposal = experimentQuestWorld();
  invalidProposal.events.find(event => event.type === 'moonshot-proposed').at = '2026-10-28';
  const proposalTrail = getQuestTrail(invalidProposal, founder);
  assert.equal(proposalTrail.find(item => item.id === 'founder-moonshot-proposal').complete, false);
  assert.equal(proposalTrail.find(item => item.id === 'founder-experiment-evidence').complete, false);

  const invalidReport = experimentQuestWorld();
  invalidReport.events.find(event => event.type === 'experiment-reported').at = '2026-10-29';
  const reportMilestone = getQuestTrail(invalidReport, founder)
    .find(item => item.id === 'founder-experiment-evidence');
  assert.equal(reportMilestone.complete, false);
  assert.equal(reportMilestone.progress, 0);
});

test('Guild Hall challenge quest targets current-member reports, excludes outsiders, and reopens after departure', () => {
  const { world, guildFounder, guildWitness } = guildExperimentQuestWorld();
  const before = structuredClone(world);
  const satchel = projectGuildFieldSatchel(world, guildFounder);
  assert.equal(satchel.available, true);
  assert.ok(satchel.items.some(item => item.eventId === 'member-report-event'));
  assert.equal(satchel.items.some(item => item.eventId === 'report-event-1'), false,
    'an outsider report is not a current guild work item');
  assert.ok(satchel.items.some(item => item.eventId === 'outsider-challenge-event'),
    'the satchel may retain a member-authored challenge even when its target is not guild work');

  const founderOpen = getQuestTrail(world, founder)
    .find(item => item.id === 'founder-challenge-experiment-report');
  assert.equal(founderOpen.complete, false,
    'a challenge against an outsider report must not complete a guild-scoped objective');
  assert.equal(founderOpen.title, 'Challenge a guild member’s experiment report');
  assert.deepEqual(founderOpen.action, {
    type: 'research-activity', id: 'research-activity:member-report-event',
    moonshotId: 'moon-1', activityId: 'member-report'
  });
  assert.match(founderOpen.interpretation, /target report and challenger are current members/i);

  const witnessOpen = getQuestTrail(world, witness)
    .find(item => item.id === 'witness-challenge-experiment-report');
  assert.equal(witnessOpen.complete, false);
  assert.equal(witnessOpen.action, null);
  assert.match(witnessOpen.blockedReason, /another current guild member/i,
    'the only other report belongs to an outsider, not a current member');
  assert.deepEqual(world, before, 'opening the satchel and projecting quest state do not mutate the world');

  world.events.push({
    id: 'member-challenge-event', type: 'experiment-challenged', challengeId: 'member-challenge',
    reportId: 'member-report', moonshotId: 'moon-1', actor: guildFounder,
    at: '2026-10-28T17:06:00.000Z', challengeType: 'contradiction',
    challengeText: 'The member report conflicts with the retained procedure.'
  });
  const founderComplete = getQuestTrail(world, founder)
    .find(item => item.id === 'founder-challenge-experiment-report');
  assert.equal(founderComplete.complete, true);
  assert.deepEqual(founderComplete.evidenceIds, ['member-challenge-event']);

  world.events.push(
    {
      id: 'founder-report-event', type: 'experiment-reported', reportId: 'founder-report',
      moonshotId: 'moon-1', actor: guildFounder, at: '2026-10-28T17:07:00.000Z',
      procedure: 'Repeat the bounded procedure.', observation: 'The Founder records an inconclusive result.',
      reportedOutcome: 'inconclusive', evidenceCreationId: null, evidenceVersion: null
    },
    {
      id: 'founder-challenge-event', type: 'experiment-challenged', challengeId: 'founder-challenge',
      reportId: 'founder-report', moonshotId: 'moon-1', actor: guildWitness,
      at: '2026-10-28T17:08:00.000Z', challengeType: 'reproducibility',
      challengeText: 'The Founder report needs a repeatable measurement.'
    }
  );
  const witnessComplete = getQuestTrail(world, witness)
    .find(item => item.id === 'witness-challenge-experiment-report');
  assert.equal(witnessComplete.complete, true);
  assert.deepEqual(witnessComplete.evidenceIds, ['founder-challenge-event']);

  world.events.push({
    id: 'guild-left-1', type: 'guild-left', guildId: 'guild-1', actor: guildWitness,
    at: '2026-10-28T17:09:00.000Z',
    semantics: 'Game projection only; departure does not erase retained work or history.'
  });
  const afterDeparture = getQuestTrail(world, founder)
    .find(item => item.id === 'founder-challenge-experiment-report');
  assert.equal(afterDeparture.complete, false,
    'a departed member’s report no longer satisfies the active guild objective');
  assert.equal(afterDeparture.progress, 0);
  assert.equal(afterDeparture.action, null);
  assert.match(afterDeparture.blockedReason, /another current guild member/i);
  assert.ok(world.events.some(event => event.id === 'member-challenge-event'),
    'the challenge remains in world history after its target leaves the guild');
  assert.equal(world.xp, 0, 'guild review and challenge objectives grant no XP');
  const finalSnapshot = structuredClone(world);
  getQuestTrail(world, founder);
  assert.deepEqual(world, finalSnapshot, 'quest projection does not mutate canonical world state');
});

test('challenge quest requires canonical chronology even when report attribution is valid', () => {
  const world = experimentQuestWorld();
  world.events.push({
    id: 'challenge-event-1',
    type: 'experiment-challenged',
    challengeId: 'challenge-1',
    reportId: 'report-1',
    moonshotId: 'moon-1',
    actor: witness,
    at: '2026-10-29T12:00:00.000Z',
    challengeType: 'methodology',
    challengeText: 'The procedure needs an independent reproduction.'
  });

  const valid = getQuestTrail(world, witness)
    .find(item => item.id === 'witness-challenge-experiment-report');
  assert.equal(valid.complete, true);
  assert.equal(valid.progress, 1);

  const malformed = structuredClone(world);
  malformed.events.find(event => event.type === 'experiment-challenged').at = '2026-10-29';
  const rejected = getQuestTrail(malformed, witness)
    .find(item => item.id === 'witness-challenge-experiment-report');
  assert.equal(rejected.complete, false);
  assert.equal(rejected.progress, 0);
});

test('challenge evidence is blocked when retained version identity is ambiguous', () => {
  const world = experimentQuestWorld();
  const creation = world.creations[0];
  creation.versions.push({
    ...creation,
    versions: [],
    publishedAt: '2026-10-28T17:00:30.000Z'
  });
  world.events.push({
    id: 'challenge-ambiguous-version-event',
    type: 'experiment-challenged',
    challengeId: 'challenge-ambiguous-version',
    reportId: 'report-1',
    moonshotId: 'moon-1',
    actor: witness,
    at: '2026-10-29T12:00:00.000Z',
    challengeType: 'methodology',
    challengeText: 'The cited retained version is ambiguous.',
    evidenceCreationId: 'evidence-1',
    evidenceVersion: 1
  });

  const challenge = getQuestTrail(world, witness)
    .find(item => item.id === 'witness-challenge-experiment-report');
  assert.equal(challenge.complete, false);
  assert.equal(challenge.progress, 0,
    'a challenge cannot choose one of multiple retained objects sharing the same version identity');
});

test('quest preserve-version objective requires an actual earlier retained snapshot', () => {
  const publishedAt = '2026-10-28T17:00:00.000Z';
  const current = {
    id: 'creation-without-prior',
    kind: 'loom',
    title: 'Current version only',
    version: 2,
    publishedAt,
    receipt: { digest: 'b'.repeat(64), size: 12 },
    versions: []
  };
  const withoutPrior = {
    creations: [current],
    events: [{
      id: 'publish-current-only',
      type: 'publish',
      creationId: current.id,
      version: 2,
      at: publishedAt,
      actor: founder
    }],
    discoveries: [],
    contributions: [],
    reports: []
  };
  const blocked = getQuestTrail(withoutPrior, founder)
    .find(item => item.id === 'founder-preserve-version');
  assert.equal(blocked.complete, false);
  assert.equal(blocked.progress, 0);

  const withPrior = structuredClone(withoutPrior);
  const creation = withPrior.creations[0];
  creation.versions.push({
    ...creation,
    version: 1,
    publishedAt: '2026-10-28T16:59:00.000Z',
    versions: []
  });
  withPrior.events.unshift({
    id: 'publish-retained-prior',
    type: 'publish',
    creationId: creation.id,
    version: 1,
    at: '2026-10-28T16:59:00.000Z',
    actor: founder
  });
  const preserved = getQuestTrail(withPrior, founder)
    .find(item => item.id === 'founder-preserve-version');
  assert.equal(preserved.complete, true);
  assert.equal(preserved.progress, 1);
});

test('quest projection rejects a publication with a non-positive retained version', () => {
  const publishedAt = '2026-10-28T17:00:00.000Z';
  const world = {
    creations: [{
      id: 'invalid-version-source',
      kind: 'observatory',
      title: 'Malformed source',
      version: 0,
      publishedAt,
      receipt: { digest: 'c'.repeat(64), size: 12 },
      versions: []
    }],
    events: [{
      id: 'publish-version-zero',
      type: 'publish',
      creationId: 'invalid-version-source',
      version: 0,
      at: publishedAt,
      actor: founder
    }],
    discoveries: [],
    contributions: [],
    reports: []
  };
  const observatory = getQuestTrail(world, founder)
    .find(item => item.id === 'founder-source-observatory');
  assert.equal(observatory.complete, false);
  assert.equal(observatory.progress, 0);
});

test('quest preserve-version objective ignores invalid prior version numbers', () => {
  const publishedAt = '2026-10-28T17:00:00.000Z';
  const creation = {
    id: 'creation-with-invalid-prior',
    kind: 'loom',
    title: 'Current version',
    version: 2,
    publishedAt,
    receipt: { digest: 'd'.repeat(64), size: 12 },
    versions: [{
      id: 'creation-with-invalid-prior',
      version: -1,
      publishedAt: '2026-10-28T16:59:00.000Z',
      receipt: { digest: 'e'.repeat(64), size: 12 },
      versions: []
    }]
  };
  const world = {
    creations: [creation],
    events: [{
      id: 'publish-current-with-invalid-prior',
      type: 'publish',
      creationId: creation.id,
      version: 2,
      at: publishedAt,
      actor: founder
    }],
    discoveries: [],
    contributions: [],
    reports: []
  };
  const preserve = getQuestTrail(world, founder)
    .find(item => item.id === 'founder-preserve-version');
  assert.equal(preserve.complete, false);
  assert.equal(preserve.progress, 0);
});

function academyQuestWorld(publicationFirst) {
  const publishedAt = '2026-10-28T17:00:00.000Z';
  const source = {
    id: 'academy-source', kind: 'observatory', title: 'A retained study source',
    version: 1, publishedAt, receipt: { digest: 'a'.repeat(64), size: 12 }, versions: []
  };
  const publication = {
    id: 'academy-publication-event', type: 'publish',
    creationId: source.id, version: 1, at: publishedAt, actor: founder
  };
  const study = {
    id: 'academy-study-event', type: 'study', studyId: 'academy-study',
    creationId: source.id, version: 1, actor: founder,
    at: '2026-10-28T17:01:00.000Z',
    question: 'What does this source establish?',
    attempt: 'It records a claim but not independent confirmation.',
    nextCheck: 'Inspect the exact cited passage.'
  };
  const review = {
    id: 'academy-review-event', type: 'study-reviewed', reviewId: 'academy-review',
    studyId: study.studyId, creationId: source.id, version: 1, actor: founder,
    at: '2026-10-28T17:02:00.000Z',
    response: 'The source records the claim.',
    reflection: 'Independent support remains unknown.'
  };
  return {
    creations: [source],
    events: publicationFirst ? [publication, study, review] : [study, publication, review],
    discoveries: [], contributions: [], reports: []
  };
}

test('Academy study and review objectives require the publication event to precede them in history', () => {
  const valid = getQuestTrail(academyQuestWorld(true), founder);
  assert.equal(valid.find(item => item.id === 'founder-academy-study-note').complete, true);
  assert.equal(valid.find(item => item.id === 'founder-academy-study-review').complete, true);

  // The later publication is deliberately backdated. A timestamp alone must not
  // make a source available before its publication event exists in append-only history.
  const outOfOrder = getQuestTrail(academyQuestWorld(false), founder);
  const study = outOfOrder.find(item => item.id === 'founder-academy-study-note');
  const review = outOfOrder.find(item => item.id === 'founder-academy-study-review');
  assert.equal(study.complete, false);
  assert.equal(study.progress, 0);
  assert.deepEqual(study.evidenceIds, []);
  assert.equal(review.complete, false);
  assert.equal(review.progress, 0);
  assert.deepEqual(review.evidenceIds, []);
});



test('main quest stops repeating the generic task when every current objective has a retained record', () => {
  const founderWorld = {
    creations: [{ id: 'first' }, { id: 'second' }],
    discoveries: [{ actor: founder, locationId: 'relay' }],
    contributions: [{ actor: founder, creationId: 'first', version: 1 }]
  };
  const witnessWorld = {
    creations: [{ id: 'published' }],
    discoveries: ['relay', 'river', 'overlook', 'ruins'].map(locationId => ({ actor: witness, locationId })),
    contributions: [{ actor: witness, creationId: 'published', version: 1 }],
    reports: [{ actor: witness, creationId: 'published', version: 1 }]
  };
  const allRecorded = [{ id: 'objective-one', complete: true }, { id: 'objective-two', complete: true }];

  for (const [world, actor] of [[founderWorld, founder], [witnessWorld, witness]]) {
    const quest = getActiveQuest(world, actor, allRecorded);
    assert.equal(quest.id, actor.role + '-current-trail-recorded');
    assert.equal(quest.title, 'Current quest trail · all objectives recorded');
    assert.equal(quest.action, 'trail');
    assert.equal(quest.button, 'Inspect retained quest trail →');
    assert.match(quest.copy, /not approval, truth verification, mastery, or proof of external execution/i);
  }
});


test('an empty objective list does not imply that the current quest trail is complete', () => {
  const founderWorld = {
    creations: [{ id: 'first' }, { id: 'second' }],
    discoveries: [{ actor: founder, locationId: 'relay' }],
    contributions: [{ actor: founder, creationId: 'first', version: 1 }]
  };
  const quest = getActiveQuest(founderWorld, founder, []);
  assert.equal(quest.id, 'founder-connect');
  assert.notEqual(quest.id, 'founder-current-trail-recorded');
});

test('the main quest continues to select the first unfinished objective', () => {
  const founderWorld = {
    creations: [{ id: 'first' }, { id: 'second' }],
    discoveries: [{ actor: founder, locationId: 'relay' }],
    contributions: [{ actor: founder, creationId: 'first', version: 1 }]
  };
  const trail = [
    { id: 'already-recorded', complete: true },
    { id: 'next-objective', title: 'Preserve the exact source', complete: false, progress: 0, target: 1,
      action: { type: 'location', id: 'evidence_archive' }, interpretation: 'Inspect a retained version.' }
  ];
  const quest = getActiveQuest(founderWorld, founder, trail);
  assert.equal(quest.id, 'next-objective');
  assert.equal(quest.title, 'Preserve the exact source');
  assert.equal(quest.button, 'Go do this →');
  assert.equal(quest.action, 'trail');
  assert.deepEqual(quest.nextAction, { type: 'location', id: 'evidence_archive' });
});


test('challenge evidence requires exactly one matching publication earlier in retained history', () => {
  const worldWithChallenge = () => {
    const world = experimentQuestWorld();
    world.events.push({
      id: 'challenge-event-1',
      type: 'experiment-challenged',
      challengeId: 'challenge-1',
      reportId: 'report-1',
      moonshotId: 'moon-1',
      actor: witness,
      at: '2026-10-28T17:04:00.000Z',
      challengeType: 'methodology',
      challengeText: 'The procedure needs an independent reproduction.',
      evidenceCreationId: 'evidence-1',
      evidenceVersion: 1
    });
    return world;
  };
  const milestone = world => getQuestTrail(world, witness)
    .find(item => item.id === 'witness-challenge-experiment-report');

  assert.equal(milestone(worldWithChallenge()).complete, true, 'one matching earlier publication is accepted');

  const missingPublication = worldWithChallenge();
  missingPublication.events = missingPublication.events.filter(event => event.type !== 'publish');
  assert.equal(milestone(missingPublication).complete, false, 'a retained version object alone is not enough');

  const publicationAfterChallenge = worldWithChallenge();
  const publication = publicationAfterChallenge.events.find(event => event.type === 'publish');
  publicationAfterChallenge.events = publicationAfterChallenge.events.filter(event => event.type !== 'publish');
  publicationAfterChallenge.events.push(publication);
  assert.equal(milestone(publicationAfterChallenge).complete, false, 'a backdated publication after the challenge is rejected');

  const duplicatePublication = worldWithChallenge();
  const original = duplicatePublication.events.find(event => event.type === 'publish');
  duplicatePublication.events.push({ ...original, id: 'publish-evidence-duplicate' });
  assert.equal(milestone(duplicatePublication).complete, false, 'ambiguous duplicate publication references are rejected');
});


test('quest trail does not unlock research progress from incomplete or unattributed proposals', () => {
  const invalidProposals = [
    { title: '' },
    { hypothesis: '' },
    { falsifier: '' },
    { evidenceNeeded: '' },
    { actor: null },
    { actor: { id: 'untrusted', role: 'system' } }
  ];
  for (const invalid of invalidProposals) {
    const world = experimentQuestWorld();
    const proposal = world.events.find(event => event.type === 'moonshot-proposed');
    Object.assign(proposal, invalid);
    const trail = getQuestTrail(world, founder);
    const proposalMilestone = trail.find(item => item.id === 'founder-moonshot-proposal');
    const reportMilestone = trail.find(item => item.id === 'founder-experiment-report');
    assert.equal(proposalMilestone.complete, false);
    assert.equal(reportMilestone.complete, false);
    assert.equal(reportMilestone.progress, 0);
    assert.equal(reportMilestone.blockedReason, 'Propose a falsifiable moonshot first.');
  }
});

test('Source Observation quest progress is actor-scoped and routes an unfinished player to the latest retained Observatory version', () => {
  const creationId = 'observatory-quest';
  const creation = {
    id: creationId, kind: 'observatory', title: 'Source Observatory',
    version: 2, publishedAt: '2026-10-25T12:02:00.000Z',
    versions: [{ id: creationId, version: 1, kind: 'observatory', title: 'Source Observatory', publishedAt: '2026-10-25T12:00:00.000Z' }]
  };
  const note = {
    claim: 'A model says the bridge is open.',
    sourceKind: 'model-assertion',
    source: 'Model output only; no source retrieved.',
    falsifier: 'A direct inspection finds it closed.',
    uncertainty: 'No independent observation.',
    nextTest: 'Inspect the bridge.'
  };
  const digest = createHash('sha256').update(sourceObservationRequestMaterial({
    actorId: founder.id, actorRole: founder.role, creationId, version: 1, ...note
  })).digest('hex');
  const publication = {
    id: 'publish-observatory', type: 'publish', creationId, version: 1,
    actor: founder, at: '2026-10-25T12:00:00.000Z'
  };
  const latestPublication = {
    id: 'publish-observatory-v2', type: 'publish', creationId, version: 2,
    actor: founder, at: '2026-10-25T12:02:00.000Z'
  };
  const observation = {
    id: 'source-observation-event', type: 'source-observation-recorded',
    actor: founder, at: '2026-10-25T12:01:00.000Z',
    observationId: 'source-observation-' + digest, creationId, version: 1, ...note,
    originSchema: 'ngl.source-observatory.v2', bindingMode: 'USER_SELECTED',
    sourceRetrieval: 'NOT_PERFORMED', independentVerification: 'NOT_PERFORMED',
    modelAssertions: 'LEADS_ONLY', execution: 'NOT_EXECUTED',
    normalizedRecordDigest: digest
  };
  const world = { creations: [creation], events: [publication, observation, latestPublication], contributions: [], reports: [], discoveries: [] };
  const founderObjective = getQuestTrail(world, founder).find(item => item.id === 'founder-source-observation');
  assert.equal(founderObjective.progress, 1);
  assert.equal(founderObjective.complete, true);
  const witnessObjective = getQuestTrail(world, witness).find(item => item.id === 'witness-source-observation');
  assert.equal(witnessObjective.progress, 0);
  assert.equal(witnessObjective.complete, false);
  assert.equal(witnessObjective.title, 'Record a falsifiable source observation');
  assert.deepEqual(witnessObjective.action, { type: 'creation', id: creationId, version: 2 });
  assert.match(witnessObjective.interpretation, /NOT_PERFORMED/);
});

test('Founder and Witness challenge quests count only a different actor’s linked Source Observation dissent', () => {
  const creationId = 'quest-observatory';
  const publishedAt = '2026-10-28T17:00:00.000Z';
  const creation = {
    id: creationId, kind: 'observatory', title: 'Source Observatory',
    version: 1, publishedAt, versions: []
  };
  const observation = (actor, at, claim) => {
    const note = {
      claim, sourceKind: 'model-assertion',
      source: 'A model response; no primary source retrieved.',
      falsifier: 'A direct inspection contradicts the claim.',
      uncertainty: 'Independent observation is absent.',
      nextTest: 'Inspect the primary source.'
    };
    const digest = createHash('sha256').update(sourceObservationRequestMaterial({
      actorId: actor.id, actorRole: actor.role, creationId, version: 1, ...note
    })).digest('hex');
    const observationId = 'source-observation-' + digest;
    return {
      id: 'note-event-' + actor.id, type: 'source-observation-recorded',
      observationId, creationId, version: 1, actor, at, ...note,
      originSchema: 'ngl.source-observatory.v2', bindingMode: 'USER_SELECTED',
      sourceRetrieval: 'NOT_PERFORMED', independentVerification: 'NOT_PERFORMED',
      modelAssertions: 'LEADS_ONLY', execution: 'NOT_EXECUTED', normalizedRecordDigest: digest
    };
  };
  const founderNote = observation(founder, '2026-10-28T17:01:00.000Z', 'Founder claim');
  const witnessChallenge = {
    id: 'witness-challenge-event', type: 'source-observation-challenged',
    challengeId: 'witness-challenge', observationId: founderNote.observationId,
    creationId, version: 1, actor: witness, at: '2026-10-28T17:02:00.000Z',
    challengeType: 'contradiction', challengeText: 'The note has no independent source.'
  };
  const witnessNote = observation(witness, '2026-10-28T17:03:00.000Z', 'Witness claim');
  const founderChallenge = {
    id: 'founder-challenge-event', type: 'source-observation-challenged',
    challengeId: 'founder-challenge', observationId: witnessNote.observationId,
    creationId, version: 1, actor: founder, at: '2026-10-28T17:04:00.000Z',
    challengeType: 'methodology', challengeText: 'The cited method is not reproducible.'
  };
  const founderResponse = {
    id: 'founder-response-event', type: 'source-observation-challenge-responded',
    responseId: 'founder-response', challengeId: 'witness-challenge', observationId: founderNote.observationId,
    creationId, version: 1, actor: founder, at: '2026-10-28T17:02:30.000Z',
    responseText: 'The note is a lead only; retrieval is still required.'
  };
  const witnessResponse = {
    id: 'witness-response-event', type: 'source-observation-challenge-responded',
    responseId: 'witness-response', challengeId: 'founder-challenge', observationId: witnessNote.observationId,
    creationId, version: 1, actor: witness, at: '2026-10-28T17:04:30.000Z',
    responseText: 'The method is a proposal, not an executed procedure.'
  };
  const world = {
    creations: [creation],
    events: [
      { id: 'publish-observatory', type: 'publish', creationId, version: 1, actor: founder, at: publishedAt, reward: 100 },
      founderNote, witnessChallenge, founderResponse, witnessNote, founderChallenge, witnessResponse
    ],
    discoveries: [], contributions: [], reports: [], methods: []
  };
  const founderQuest = getQuestTrail(world, founder).find(item => item.id === 'founder-source-observation-challenge');
  const witnessQuest = getQuestTrail(world, witness).find(item => item.id === 'witness-source-observation-challenge');
  assert.equal(founderQuest.complete, true);
  assert.equal(founderQuest.progress, 1);
  assert.deepEqual(founderQuest.evidence.map(item => item.id), ['founder-challenge-event']);
  assert.equal(witnessQuest.complete, true);
  assert.equal(witnessQuest.progress, 1);
  assert.deepEqual(witnessQuest.evidence.map(item => item.id), ['witness-challenge-event']);
  const founderResponseQuest = getQuestTrail(world, founder).find(item => item.id === 'founder-source-observation-response');
  const witnessResponseQuest = getQuestTrail(world, witness).find(item => item.id === 'witness-source-observation-response');
  assert.equal(founderResponseQuest.complete, true);
  assert.deepEqual(founderResponseQuest.evidence.map(item => item.id), ['founder-response-event']);
  assert.equal(witnessResponseQuest.complete, true);
  assert.deepEqual(witnessResponseQuest.evidence.map(item => item.id), ['witness-response-event']);
});


test('Guild response and council coverage quests route to the next available role and count one retained response per role', () => {
  const world = experimentQuestWorld({ reportActor: witness });
  const initial = structuredClone(world);
  const initialTrail = getQuestTrail(world, founder);
  const responseQuest = initialTrail.find(item => item.id === 'founder-guild-response');
  const coverageQuest = initialTrail.find(item => item.id === 'founder-guild-council-coverage');
  assert.deepEqual(responseQuest.action, { type: 'location', id: 'guild-npc-archivist' });
  assert.equal(coverageQuest.target, 4);
  assert.equal(coverageQuest.progress, 0);
  assert.deepEqual(coverageQuest.action, { type: 'location', id: 'guild-npc-archivist' });
  assert.deepEqual(world, initial, 'quest projection and navigation hints do not mutate the world');

  const response = (role, index, actor = founder, validationStatus = 'valid-for-human-review') => ({
    id: 'collaborator-response-event-' + role + '-' + index,
    type: 'collaborator-response-recorded',
    responseId: 'collaborator-response-' + role + '-' + index,
    role,
    moonshotId: 'moon-1',
    actor,
    at: '2026-10-28T17:' + String(10 + index).padStart(2, '0') + ':00.000Z',
    validationStatus,
    validationReason: validationStatus === 'rejected' ? 'RESPONSE_SCHEMA_OR_SCOPE_INVALID' : null,
    sourceEventIds: [],
    validator: 'ngl.collaborator-response.v1'
  });

  world.events.push(response('archivist', 1, founder, 'rejected'));
  let trail = getQuestTrail(world, founder);
  let oneRole = trail.find(item => item.id === 'founder-guild-council-coverage');
  assert.equal(trail.find(item => item.id === 'founder-guild-response').complete, true);
  assert.equal(oneRole.progress, 1);
  assert.deepEqual(oneRole.evidenceIds, ['collaborator-response-event-archivist-1']);
  assert.equal(oneRole.evidence[0].responseId, 'collaborator-response-archivist-1');
  assert.equal(oneRole.evidence[0].validator, 'ngl.collaborator-response.v1');
  assert.equal(oneRole.evidence[0].validationStatus, 'rejected');
  assert.equal(oneRole.evidence[0].validationReason, 'RESPONSE_SCHEMA_OR_SCOPE_INVALID');
  assert.deepEqual(oneRole.evidence[0].sourceEventIds, []);
  assert.deepEqual(oneRole.action, { type: 'location', id: 'guild-npc-adversary' });
  assert.match(oneRole.interpretation, /Rejected responses count as preserved attempts, not endorsements/i);

  world.events.push(response('archivist', 2));
  trail = getQuestTrail(world, founder);
  oneRole = trail.find(item => item.id === 'founder-guild-council-coverage');
  assert.equal(oneRole.progress, 1, 'a second response from the same role does not inflate role coverage');
  assert.deepEqual(oneRole.evidenceIds, ['collaborator-response-event-archivist-1']);

  world.events.push(
    response('adversary', 3),
    response('synthesizer', 4),
    response('tutor', 5)
  );
  const beforeFinalProjection = structuredClone(world);
  trail = getQuestTrail(world, founder);
  const complete = trail.find(item => item.id === 'founder-guild-council-coverage');
  assert.equal(complete.complete, true);
  assert.equal(complete.progress, 4);
  assert.deepEqual(complete.evidenceIds, [
    'collaborator-response-event-archivist-1',
    'collaborator-response-event-adversary-3',
    'collaborator-response-event-synthesizer-4',
    'collaborator-response-event-tutor-5'
  ]);
  assert.equal(complete.action, null);
  assert.deepEqual(world, beforeFinalProjection, 'coverage is a read-only projection of retained actor-attributed responses');
});

test('Guild council coverage ignores another actor and malformed response-validation states', () => {
  const world = experimentQuestWorld({ reportActor: witness });
  world.events.push(
    {
      id: 'other-actor-response',
      type: 'collaborator-response-recorded',
      responseId: 'other-actor-response-id',
      role: 'archivist',
      moonshotId: 'moon-1',
      actor: witness,
      at: '2026-10-28T17:10:00.000Z',
      validationStatus: 'valid-for-human-review',
      validator: 'ngl.collaborator-response.v1'
    },
    {
      id: 'invalid-status-response',
      type: 'collaborator-response-recorded',
      responseId: 'invalid-status-response-id',
      role: 'synthesizer',
      moonshotId: 'moon-1',
      actor: founder,
      at: '2026-10-28T17:11:00.000Z',
      validationStatus: 'maybe-valid',
      validator: 'ngl.collaborator-response.v1'
    }
  );
  const quest = getQuestTrail(world, founder).find(item => item.id === 'founder-guild-council-coverage');
  assert.equal(quest.progress, 0);
  assert.deepEqual(quest.evidenceIds, []);
  assert.deepEqual(quest.action, { type: 'location', id: 'guild-npc-archivist' });
});


test('Guild Adversary stays unavailable until a retained experiment report supplies its bounded packet', () => {
  const world = experimentQuestWorld({ reportActor: witness });
  const report = world.events.find(event => event.type === 'experiment-reported');
  world.events = world.events.filter(event => event.type !== 'experiment-reported');
  const response = (role, index) => ({
    id: 'adversary-unlock-response-' + role,
    type: 'collaborator-response-recorded',
    responseId: 'adversary-unlock-response-id-' + role,
    role,
    moonshotId: 'moon-1',
    actor: founder,
    at: '2026-10-28T17:' + String(20 + index).padStart(2, '0') + ':00.000Z',
    validationStatus: 'valid-for-human-review',
    validator: 'ngl.collaborator-response.v1'
  });

  let quest = getQuestTrail(world, founder).find(item => item.id === 'founder-guild-council-coverage');
  assert.deepEqual(quest.action, { type: 'location', id: 'guild-npc-archivist' });

  world.events.push(response('archivist', 1), response('synthesizer', 2), response('tutor', 3));
  quest = getQuestTrail(world, founder).find(item => item.id === 'founder-guild-council-coverage');
  assert.equal(quest.progress, 3);
  assert.equal(quest.complete, false);
  assert.equal(quest.action, null);
  assert.match(quest.blockedReason, /No remaining role has a currently available source-bound packet/i);

  world.events.push(report);
  quest = getQuestTrail(world, founder).find(item => item.id === 'founder-guild-council-coverage');
  assert.equal(quest.progress, 3);
  assert.deepEqual(quest.action, { type: 'location', id: 'guild-npc-adversary' });
  assert.equal(quest.complete, false);
});


test('player-guild objective follows current actor membership and fails closed on ambiguous history', () => {
  const founderActor = { id: founder.id, name: 'Damien', role: founder.role };
  const witnessActor = { id: witness.id, name: 'Witness', role: witness.role };
  const created = {
    id: 'guild-created-quest', type: 'guild-created', actor: founderActor,
    at: '2026-10-28T18:00:00.000Z', guildId: 'guild-quest-1',
    name: 'Field Researchers', charter: 'Compare observations and preserve dissent.',
    semantics: 'Membership is not evidence, authority, XP or approval.'
  };
  const joined = {
    id: 'guild-joined-quest', type: 'guild-joined', actor: witnessActor,
    at: '2026-10-28T18:01:00.000Z', guildId: 'guild-quest-1',
    semantics: 'Membership is not evidence, authority, XP or approval.'
  };
  const left = {
    id: 'guild-left-quest', type: 'guild-left', actor: witnessActor,
    at: '2026-10-28T18:02:00.000Z', guildId: 'guild-quest-1',
    semantics: 'Membership is reversible.'
  };
  const disbanded = {
    id: 'guild-disbanded-quest', type: 'guild-disbanded', actor: founderActor,
    at: '2026-10-28T18:03:00.000Z', guildId: 'guild-quest-1',
    semantics: 'Closed guild history remains retained.'
  };
  const world = {
    id: 'player-guild-quest-world', revision: 0, creations: [], events: [],
    discoveries: [], contributions: [], reports: []
  };
  const objective = (actor) => getQuestTrail(world, actor)
    .find(item => item.id === actor.role + '-player-guild-membership');

  const founderOpen = objective(founder);
  assert.equal(founderOpen.complete, false);
  assert.deepEqual(founderOpen.action, { type: 'location', id: 'guild_hall' });
  assert.equal(founderOpen.progress, 0);

  world.events.push(created);
  world.revision += 1;
  const founderJoined = objective(founder);
  assert.equal(founderJoined.complete, true);
  assert.equal(founderJoined.progress, 1);
  assert.deepEqual(founderJoined.evidenceIds, [created.id]);
  assert.match(founderJoined.interpretation, /not proof of distinct humans/i);

  world.events.push(joined);
  world.revision += 1;
  const witnessJoined = objective(witness);
  assert.equal(witnessJoined.complete, true);
  assert.deepEqual(witnessJoined.evidenceIds, [joined.id]);

  world.events.push(left);
  world.revision += 1;
  const witnessLeft = objective(witness);
  assert.equal(witnessLeft.complete, false);
  assert.deepEqual(witnessLeft.action, { type: 'location', id: 'guild_hall' });

  world.events.push(disbanded);
  world.revision += 1;
  const founderDisbanded = objective(founder);
  assert.equal(founderDisbanded.complete, false);
  assert.deepEqual(founderDisbanded.action, { type: 'location', id: 'guild_hall' });

  const ambiguous = {
    ...world,
    events: [created, { ...created, name: 'Duplicate history' }]
  };
  const blocked = getQuestTrail(ambiguous, founder)
    .find(item => item.id === 'founder-player-guild-membership');
  assert.equal(blocked.complete, false);
  assert.equal(blocked.action, null);
  assert.match(blocked.blockedReason, /ambiguous or invalid/i);
});



test('Synthesis Clerk quest requires a multi-source packet and preserves rejected attempts without claiming correctness', () => {
  const world = experimentQuestWorld({ reportActor: witness });
  const before = structuredClone(world);
  const open = getQuestTrail(world, founder).find(item => item.id === 'founder-multi-source-synthesis');
  assert.equal(open.progress, 0);
  assert.equal(open.complete, false);
  assert.deepEqual(open.action, { type: 'location', id: 'guild-npc-synthesizer' });
  assert.match(open.interpretation, /does not establish correctness, consensus, truth/i);
  assert.deepEqual(world, before, 'quest inspection is read-only');

  const response = (id, responseId, actor, sourceEventIds, at, moonshotId = 'moon-1') => ({
    id,
    type: 'collaborator-response-recorded',
    responseId,
    role: 'synthesizer',
    moonshotId,
    actor,
    at,
    validationStatus: 'rejected',
    validationReason: 'RESPONSE_SCHEMA_OR_SCOPE_INVALID',
    sourceEventIds,
    validator: 'ngl.collaborator-response.v1'
  });
  world.events.push(response(
    'synthesis-response-event', 'synthesis-response-id', founder,
    ['proposal-1', 'report-event-1'], '2026-10-28T17:04:00.000Z'
  ));
  const completed = getQuestTrail(world, founder).find(item => item.id === 'founder-multi-source-synthesis');
  assert.equal(completed.complete, true);
  assert.equal(completed.progress, 1);
  assert.deepEqual(completed.evidenceIds, ['synthesis-response-event']);
  assert.equal(completed.action, null);
  assert.match(completed.interpretation, /Rejected responses remain preserved attempts, not endorsements/i);

  const witnessTrail = getQuestTrail(world, witness);
  assert.equal(witnessTrail.find(item => item.id === 'witness-multi-source-synthesis').progress, 0,
    'a response by another actor cannot advance the Witness objective');

  const singleSourceWorld = experimentQuestWorld({ reportActor: witness });
  singleSourceWorld.events.push(response(
    'single-source-response-event', 'single-source-response-id', founder,
    ['proposal-1'], '2026-10-28T17:04:00.000Z'
  ));
  const singleSource = getQuestTrail(singleSourceWorld, founder)
    .find(item => item.id === 'founder-multi-source-synthesis');
  assert.equal(singleSource.progress, 0);
  assert.equal(singleSource.complete, false);
  assert.deepEqual(singleSource.action, { type: 'location', id: 'guild-npc-synthesizer' },
    'a prior single-source attempt does not block a later multi-source attempt');

  const duplicateSourceWorld = experimentQuestWorld({ reportActor: witness });
  duplicateSourceWorld.events.push(response(
    'duplicate-source-response-event', 'duplicate-source-response-id', founder,
    ['proposal-1', 'report-event-1', 'report-event-1'], '2026-10-28T17:04:00.000Z'
  ));
  const duplicateSource = getQuestTrail(duplicateSourceWorld, founder)
    .find(item => item.id === 'founder-multi-source-synthesis');
  assert.equal(duplicateSource.progress, 0);

  const crossMoonshotWorld = experimentQuestWorld({ reportActor: witness });
  crossMoonshotWorld.events.push(response(
    'cross-moonshot-response-event', 'cross-moonshot-response-id', founder,
    ['proposal-1', 'report-event-1'], '2026-10-28T17:04:00.000Z', 'moon-other'
  ));
  const crossMoonshot = getQuestTrail(crossMoonshotWorld, founder)
    .find(item => item.id === 'founder-multi-source-synthesis');
  assert.equal(crossMoonshot.progress, 0);
});
