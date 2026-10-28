import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocationAction, findStudyReview } from '../game/quests.mjs';

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
