import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocationAction, findStudyReview, getQuestTrail, getActiveQuest } from '../game/quests.mjs';

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
