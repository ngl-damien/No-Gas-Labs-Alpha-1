import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocationAction, findStudyReview, getQuestTrail } from '../game/quests.mjs';

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
  const notes = Array.from({ length: 9 }, (_, index) => ({ studyId: 'study-' + index, actor }));
  // The newest note is reviewed first; eight older notes are reviewed later.
  // The UI's recent-eight display therefore omits the newest note's older review.
  const allReviews = [
    { type: 'study-reviewed', reviewId: 'review-8', studyId: 'study-8', actor },
    ...Array.from({ length: 8 }, (_, index) => ({
      type: 'study-reviewed', reviewId: 'review-' + index, studyId: 'study-' + index, actor
    }))
  ];
  const visibleReviews = allReviews.slice().reverse().slice(0, 8);
  assert.equal(visibleReviews.some(review => review.studyId === 'study-8'), false);
  assert.equal(findStudyReview(notes[8], allReviews)?.reviewId, 'review-8');
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
  assert.deepEqual(milestone.action, { type: 'location', id: 'moonshot_field' });
  assert.equal(milestone.blockedReason, null);
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
