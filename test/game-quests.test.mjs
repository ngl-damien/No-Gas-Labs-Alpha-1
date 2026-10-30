import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocationAction, findStudyReview, getQuestTrail, getActiveQuest } from '../game/quests.mjs';
import { COLLABORATOR_ROLES, compactCollaboratorSourceRecord, projectCollaboratorPackets } from '../game/collaborator-contracts.mjs';
import { projectResearchRecords } from '../game/research-records.mjs';
import { createHash } from 'node:crypto';
import { projectCollaboratorResponseWorldObjects } from '../game/collaborator-world-objects.mjs';

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
    id: 'quest-world',
    revision: events.length,
    creations: [artifact],
    events,
    discoveries: [],
    contributions: [],
    reports: []
  };
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


function collaboratorArchiveEvent({
  world, id, role, actor = founder, responseId = 'response-' + id,
  validationStatus = 'valid-for-human-review', at = '2026-10-28T17:04:00.000Z',
  sourceEventIds = null
}) {
  // Fixtures use the same packet builder as the runtime. Witness packets see
  // the same redacted event slice as publicWorld(); their revision remains the
  // underlying world revision while their supplied-event count is redacted.
  const packetWorld = actor.role === 'founder'
    ? world
    : { ...world, events: world.events.filter(event => !['draft', 'repair'].includes(event.type)) };
  const packets = projectCollaboratorPackets(packetWorld);
  const packet = packets.find(candidate => candidate.id === role && candidate.available) ||
    packets.find(candidate => candidate.id === 'tutor' && candidate.available);
  assert.ok(packet, 'the fixture world must provide a source-bound Tutor packet');
  const payload = JSON.parse(packet.packetJson);
  if (payload.role !== role) payload.role = role;
  let refs = sourceEventIds ?? [...payload.inputRefs];
  if (sourceEventIds) {
    const projectedById = new Map(projectResearchRecords(packetWorld.events, packetWorld.creations)
      .map(record => [record.id, record]));
    payload.inputRefs = [...refs];
    payload.inputRecords = refs.map(sourceId => {
      const source = projectedById.get(sourceId);
      return source ? compactCollaboratorSourceRecord(source) : {
        eventId: sourceId,
        type: 'missing',
        at,
        actor: { id: 'missing-actor', role: 'founder' },
        moonshotId: 'moon-1',
        truncatedFields: []
      };
    });
  }
  const packetJson = JSON.stringify(payload);
  const responseText = JSON.stringify({ externalText: 'Untrusted response retained for human review.' });
  const receipt = value => ({
    algorithm: 'sha256',
    digest: createHash('sha256').update(value, 'utf8').digest('hex'),
    size: new TextEncoder().encode(value).length
  });
  return {
    id, type: 'collaborator-response-recorded', responseId, role, moonshotId: 'moon-1',
    sourceEventIds: refs, packetJson, packetReceipt: receipt(packetJson),
    responseText, responseReceipt: receipt(responseText),
    validationStatus,
    validationReason: validationStatus === 'rejected' ? 'RESPONSE_SCHEMA_OR_SCOPE_INVALID' : null,
    validator: 'ngl.collaborator-response.v1',
    actor, at,
    semantics: 'Preserved external text; no truth, execution, approval or authority claim.'
  };
}

function appendCollaboratorArchive(world, options) {
  const event = collaboratorArchiveEvent({ world, ...options });
  world.events.push(event);
  world.revision = world.events.length;
  return event;
}

function refreshPacketReceipt(event) {
  event.packetReceipt = {
    algorithm: 'sha256',
    digest: createHash('sha256').update(event.packetJson, 'utf8').digest('hex'),
    size: new TextEncoder().encode(event.packetJson).length
  };
}

test('Guild Hall role-coverage quest counts only source-bound folios and routes to the next NPC', () => {
  const world = experimentQuestWorld();
  const coverage = () => getQuestTrail(world, founder)
    .find(item => item.id === 'founder-guild-council-coverage');
  const initial = coverage();
  assert.deepEqual([initial.progress, initial.target, initial.complete], [0, COLLABORATOR_ROLES.length, false]);
  assert.deepEqual(initial.action, { type: 'location', id: 'guild-npc-' + COLLABORATOR_ROLES[0].id });

  appendCollaboratorArchive(world, {
    id: 'archivist-rejected', role: 'archivist', validationStatus: 'rejected'
  });
  let current = coverage();
  assert.equal(current.progress, 1, 'a rejected but properly source-bound response remains a preserved attempt');
  assert.equal(current.evidence[0].collaboratorRole, 'archivist');
  assert.equal(current.evidence[0].validationStatus, 'rejected');
  assert.deepEqual(current.action, { type: 'location', id: 'guild-npc-adversary' });

  appendCollaboratorArchive(world, {
    id: 'archivist-repeat', role: 'archivist', at: '2026-10-28T17:05:00.000Z'
  });
  current = coverage();
  assert.equal(current.progress, 1, 'repeated responses from one role cannot fill another role slot');
  assert.equal(current.evidenceIds.length, 1);
  assert.deepEqual(current.action, { type: 'location', id: 'guild-npc-adversary' });

  for (const [index, role] of COLLABORATOR_ROLES.slice(1).entries()) {
    appendCollaboratorArchive(world, {
      id: role.id + '-response',
      role: role.id,
      at: new Date(Date.parse('2026-10-28T17:06:00.000Z') + index * 60_000).toISOString()
    });
  }
  current = coverage();
  assert.equal(current.progress, COLLABORATOR_ROLES.length);
  assert.equal(current.complete, true);
  assert.equal(current.action, null);
  assert.deepEqual(current.evidence.map(item => item.collaboratorRole), COLLABORATOR_ROLES.map(role => role.id));
});

test('Guild Hall role coverage rejects unknown roles, other actors, malformed receipts, invalid statuses and ambiguous IDs', () => {
  const world = experimentQuestWorld();
  appendCollaboratorArchive(world, { id: 'unknown-role', role: 'oracle' });
  appendCollaboratorArchive(world, { id: 'other-actor', role: 'tutor', actor: witness });
  appendCollaboratorArchive(world, { id: 'invalid-status', role: 'synthesizer', validationStatus: 'accepted' });
  appendCollaboratorArchive(world, { id: 'missing-source', role: 'adversary', sourceEventIds: ['not-in-history'] });
  appendCollaboratorArchive(world, { id: 'no-proposal-reference', role: 'tutor', sourceEventIds: ['report-event-1'] });
  appendCollaboratorArchive(world, { id: 'backdated-response', role: 'archivist', at: '2026-10-28T17:00:30.000Z' });
  appendCollaboratorArchive(world, {
    id: 'duplicate-a', role: 'archivist', responseId: 'same-response'
  });
  appendCollaboratorArchive(world, {
    id: 'duplicate-b', role: 'adversary', responseId: 'same-response',
    at: '2026-10-28T17:05:00.000Z'
  });
  const badReceipt = appendCollaboratorArchive(world, { id: 'bad-receipt', role: 'synthesizer' });
  badReceipt.packetReceipt.digest = 'not-a-sha256-digest';
  const coverage = getQuestTrail(world, founder)
    .find(item => item.id === 'founder-guild-council-coverage');
  assert.equal(coverage.progress, 0);
  assert.deepEqual(coverage.evidenceIds, []);
  assert.deepEqual(coverage.action, { type: 'location', id: 'guild-npc-archivist' });
});

test('Guild Hall quest progress and Relay folio navigation share the same strict packet/source checks', () => {
  const world = experimentQuestWorld();
  const event = appendCollaboratorArchive(world, { id: 'mismatched-snapshot', role: 'archivist' });
  const payload = JSON.parse(event.packetJson);
  payload.sourceSnapshot.worldId = 'another-world';
  event.packetJson = JSON.stringify(payload);
  refreshPacketReceipt(event);
  assert.deepEqual(projectCollaboratorResponseWorldObjects(world), [],
    'the mismatched source snapshot must not become a navigable folio');
  const coverage = getQuestTrail(world, founder)
    .find(item => item.id === 'founder-guild-council-coverage');
  assert.equal(coverage.progress, 0,
    'the same mismatched archive must not advance the quest');
});

test('Guild Hall folios and quest progress reject byte-valid packets that substitute retained source content', () => {
  const cases = [
    { id: 'proposal-content-substitution', role: 'archivist', sourceId: 'proposal-1', field: 'hypothesis' },
    { id: 'report-content-substitution', role: 'adversary', sourceId: 'report-event-1', field: 'observation' }
  ];
  for (const item of cases) {
    const world = experimentQuestWorld();
    const event = appendCollaboratorArchive(world, { id: item.id, role: item.role });
    const payload = JSON.parse(event.packetJson);
    const source = payload.inputRecords.find(record => record.eventId === item.sourceId);
    assert.ok(source, item.id + ' source input exists');
    source[item.field] = 'Substituted text that was never retained in the source event.';
    event.packetJson = JSON.stringify(payload);
    refreshPacketReceipt(event);

    assert.deepEqual(projectCollaboratorResponseWorldObjects(world), [],
      item.id + ' must not create a Relay folio even with a recomputed byte receipt');
    const coverage = getQuestTrail(world, founder)
      .find(milestone => milestone.id === 'founder-guild-council-coverage');
    assert.equal(coverage.progress, 0,
      item.id + ' must not advance the Guild Hall quest');
  }
});

test('Adversary folio requires a retained experiment report, not merely a Moonshot proposal', () => {
  const world = experimentQuestWorld();
  appendCollaboratorArchive(world, {
    id: 'adversary-without-report',
    role: 'adversary',
    sourceEventIds: ['proposal-1']
  });
  assert.deepEqual(projectCollaboratorResponseWorldObjects(world), []);
  const coverage = getQuestTrail(world, founder)
    .find(item => item.id === 'founder-guild-council-coverage');
  assert.equal(coverage.progress, 0);
});

test('Synthesis Clerk folio must disclose and include the canonical bounded slice of retained attempts', () => {
  const world = experimentQuestWorld();
  for (let index = 2; index <= 8; index += 1) {
    world.events.push({
      id: 'report-event-' + index,
      type: 'experiment-reported',
      reportId: 'report-' + index,
      moonshotId: 'moon-1',
      actor: founder,
      at: new Date(Date.parse('2026-10-28T17:03:00.000Z') + index * 60_000).toISOString(),
      procedure: 'Repeat the bounded procedure ' + index,
      observation: 'Retain attempt ' + index,
      reportedOutcome: index % 2 ? 'failed' : 'inconclusive',
      evidenceCreationId: null,
      evidenceVersion: null
    });
  }
  world.revision = world.events.length;
  const generated = projectCollaboratorPackets(world).find(packet => packet.id === 'synthesizer');
  assert.ok(generated?.available);
  const generatedPayload = JSON.parse(generated.packetJson);
  assert.equal(generatedPayload.omittedCount, 2);
  assert.equal(generatedPayload.inputRecords.length, 7,
    'the canonical packet includes the proposal and the six newest activities');

  const event = appendCollaboratorArchive(world, { id: 'forged-incomplete-synthesis', role: 'synthesizer' });
  const payload = JSON.parse(event.packetJson);
  payload.inputRefs = ['proposal-1'];
  payload.inputRecords = [payload.inputRecords[0]];
  payload.omittedEventIds = [];
  payload.omittedCount = 0;
  payload.omittedEventIdListTruncated = false;
  event.sourceEventIds = ['proposal-1'];
  event.packetJson = JSON.stringify(payload);
  refreshPacketReceipt(event);

  assert.deepEqual(projectCollaboratorResponseWorldObjects(world), [],
    'a byte-valid packet that hides retained activities must not become a Relay folio');
  const coverage = getQuestTrail(world, founder)
    .find(item => item.id === 'founder-guild-council-coverage');
  assert.equal(coverage.progress, 0,
    'a forged synthesis packet must not advance Guild Hall role coverage');
});

test('Witness Guild Hall role coverage counts only the Witness own preserved role response', () => {
  const world = experimentQuestWorld({ reportActor: witness });
  appendCollaboratorArchive(world, {
    id: 'witness-tutor-response', role: 'tutor', actor: witness
  });
  const coverage = getQuestTrail(world, witness)
    .find(item => item.id === 'witness-guild-council-coverage');
  assert.equal(coverage.progress, 1);
  assert.deepEqual(coverage.evidence.map(item => item.collaboratorRole), ['tutor']);
  assert.deepEqual(coverage.action, { type: 'location', id: 'guild-npc-archivist' });
});
