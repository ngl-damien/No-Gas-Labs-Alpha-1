import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldView, institutionActivityCount, projectMoonshotWorldObjects } from '../game/world-view.mjs';

function proposal(eventId, moonshotId, title = 'A testable question') {
  return {
    id: eventId,
    type: 'moonshot-proposed',
    moonshotId,
    actor: { id: 'damien', role: 'founder' },
    at: '2026-10-28T17:00:00.000Z',
    title,
    hypothesis: 'A bounded hypothesis',
    falsifier: 'An observable counterexample',
    evidenceNeeded: 'A retained source or independent observation',
  };
}

test('projects retained moonshot proposals as deterministic navigable world objects', () => {
  const world = { events: [
    proposal('event-1', 'moon-1', 'First question'),
    { id: 'study-1', type: 'study', studyId: 'study-1' },
    proposal('event-2', 'moon-2', 'Second question'),
  ] };
  const objects = projectMoonshotWorldObjects(world);
  assert.deepEqual(objects.map(({ id, type, moonshotId, eventId, title, actorId, actorRole, x, y }) =>
    ({ id, type, moonshotId, eventId, title, actorId, actorRole, x, y })), [
    { id: 'moonshot-object:moon-1', type: 'research-object', moonshotId: 'moon-1', eventId: 'event-1', title: 'First question', actorId: 'damien', actorRole: 'founder', x: 1320, y: 520 },
    { id: 'moonshot-object:moon-2', type: 'research-object', moonshotId: 'moon-2', eventId: 'event-2', title: 'Second question', actorId: 'damien', actorRole: 'founder', x: 1374, y: 520 },
  ]);
  assert.ok(Object.isFrozen(objects));
  assert.ok(objects.every(Object.isFrozen));
});

test('ambiguous event IDs and reused moonshot IDs cannot create world objects', () => {
  const world = { events: [
    proposal('event-duplicate', 'moon-ambiguous'),
    { id: 'event-duplicate', type: 'study', studyId: 'study-1' },
    proposal('event-3', 'moon-reused'),
    proposal('event-4', 'moon-reused'),
    proposal('event-5', 'moon-valid'),
  ] };
  assert.deepEqual(projectMoonshotWorldObjects(world).map(object => object.moonshotId), ['moon-valid']);
});

test('invalid proposals and accessor-backed fields are ignored without invoking getters', () => {
  let titleReads = 0;
  const accessorProposal = proposal('event-accessor', 'moon-accessor');
  Object.defineProperty(accessorProposal, 'title', {
    enumerable: true,
    get() { titleReads += 1; throw new Error('getter must not run'); },
  });
  const invalidDate = { ...proposal('event-date', 'moon-date'), at: 'not-a-date' };
  const invalidActor = { ...proposal('event-actor', 'moon-actor'), actor: { id: 'someone', role: 'npc' } };
  assert.deepEqual(projectMoonshotWorldObjects({ events: [accessorProposal, invalidDate, invalidActor] }), []);
  assert.equal(titleReads, 0);

  let eventsReads = 0;
  const unsafeWorld = {};
  Object.defineProperty(unsafeWorld, 'events', {
    get() { eventsReads += 1; throw new Error('world getter must not run'); },
  });
  assert.deepEqual(projectMoonshotWorldObjects(unsafeWorld), []);
  assert.equal(eventsReads, 0);

  let iteratorReads = 0;
  const events = [proposal('event-iterator', 'moon-iterator')];
  Object.defineProperty(events, Symbol.iterator, {
    get() { iteratorReads += 1; throw new Error('array iterator getter must not run'); },
  });
  assert.equal(projectMoonshotWorldObjects({ events }).length, 1);
  const activityEvent = { id: 'event-count', type: 'contribute' };
  Object.defineProperty(activityEvent, Symbol.iterator, {
    get() { iteratorReads += 1; throw new Error('event iterator getter must not run'); },
  });
  const activityEvents = [activityEvent];
  Object.defineProperty(activityEvents, Symbol.iterator, {
    get() { iteratorReads += 1; throw new Error('activity array iterator getter must not run'); },
  });
  assert.equal(institutionActivityCount('town-square', { events: activityEvents }), 1);
  assert.equal(iteratorReads, 0);
});

test('appending a retained proposal does not move existing research objects', () => {
  const first = proposal('event-1', 'moon-1');
  const second = proposal('event-2', 'moon-2');
  const before = projectMoonshotWorldObjects({ events: [first, second] });
  const after = projectMoonshotWorldObjects({ events: [first, second, proposal('event-3', 'moon-3')] });
  assert.deepEqual(after.slice(0, 2), before);
  assert.notDeepEqual(after[2], before[1]);
});


function experimentReport(eventId, reportId, moonshotId, actorId, at, overrides = {}) {
  return {
    id: eventId,
    type: 'experiment-reported',
    reportId,
    moonshotId,
    actor: { id: actorId, role: actorId === 'damien' ? 'founder' : 'witness' },
    at,
    procedure: 'Run the bounded procedure',
    observation: 'Record what happened',
    reportedOutcome: 'inconclusive',
    evidenceCreationId: null,
    evidenceVersion: null,
    ...overrides,
  };
}

function experimentChallenge(eventId, challengeId, reportId, moonshotId, actorId, at, overrides = {}) {
  return {
    id: eventId,
    type: 'experiment-challenged',
    challengeId,
    reportId,
    moonshotId,
    actor: { id: actorId, role: actorId === 'damien' ? 'founder' : 'witness' },
    at,
    challengeType: 'reproducibility',
    challengeText: 'The procedure is not independently reproducible yet.',
    evidenceCreationId: null,
    evidenceVersion: null,
    ...overrides,
  };
}

test('moonshot objects project retained attempt reports and dissent without claiming adjudication', () => {
  const events = [
    proposal('proposal-1', 'moon-1'),
    experimentReport('report-event-1', 'report-1', 'moon-1', 'witness-1', '2026-10-28T17:01:00.000Z'),
    experimentChallenge('challenge-event-1', 'challenge-1', 'report-1', 'moon-1', 'witness-2', '2026-10-28T17:02:00.000Z'),
  ];
  const [object] = projectMoonshotWorldObjects({ events });
  assert.equal(object.attemptCount, 1);
  assert.equal(object.challengeCount, 1);
  assert.equal(object.type, 'research-object');
  assert.equal(object.title, 'A testable question');
  assert.ok(!Object.hasOwn(object, 'verifiedOutcome'));
  assert.ok(Object.isFrozen(object));
});

test('ambiguous, unlinked, out-of-order and same-actor records cannot inflate moonshot activity', () => {
  const events = [
    experimentReport('before-event', 'before-report', 'moon-1', 'witness-1', '2026-10-28T16:59:00.000Z'),
    proposal('proposal-1', 'moon-1'),
    proposal('proposal-2', 'moon-2'),
    experimentReport('good-event', 'good-report', 'moon-1', 'witness-1', '2026-10-28T17:01:00.000Z'),
    experimentReport('duplicate-event', 'duplicate-report-a', 'moon-1', 'witness-1', '2026-10-28T17:02:00.000Z'),
    experimentReport('duplicate-event', 'duplicate-report-b', 'moon-1', 'witness-1', '2026-10-28T17:03:00.000Z'),
    experimentReport('report-event-a', 'reused-report', 'moon-1', 'witness-1', '2026-10-28T17:04:00.000Z'),
    experimentReport('report-event-b', 'reused-report', 'moon-1', 'witness-1', '2026-10-28T17:05:00.000Z'),
    experimentReport('invalid-outcome', 'invalid-outcome-report', 'moon-1', 'witness-1', '2026-10-28T17:06:00.000Z', { reportedOutcome: 'proved' }),
    experimentReport('wrong-moonshot', 'wrong-moonshot-report', 'missing-moonshot', 'witness-1', '2026-10-28T17:07:00.000Z'),
    experimentChallenge('same-actor-challenge', 'same-actor-id', 'good-report', 'moon-1', 'witness-1', '2026-10-28T17:08:00.000Z'),
    experimentChallenge('valid-challenge', 'valid-challenge-id', 'good-report', 'moon-1', 'witness-2', '2026-10-28T17:09:00.000Z'),
    experimentChallenge('challenge-duplicate-a', 'reused-challenge', 'good-report', 'moon-1', 'witness-3', '2026-10-28T17:10:00.000Z'),
    experimentChallenge('challenge-duplicate-b', 'reused-challenge', 'good-report', 'moon-1', 'witness-4', '2026-10-28T17:11:00.000Z'),
  ];
  const objects = projectMoonshotWorldObjects({ events });
  assert.deepEqual(objects.map(object => [object.moonshotId, object.attemptCount, object.challengeCount]), [
    ['moon-1', 1, 1],
    ['moon-2', 0, 0],
  ]);
});

test('linked attempt evidence requires a unique earlier Founder publication event matching the retained version', () => {
  const proposalEvent = proposal('proposal-evidence', 'moon-evidence');
  const publicationEvent = {
    id: 'publish-artifact-1',
    type: 'publish',
    creationId: 'artifact-1',
    version: 1,
    actor: { id: 'damien', role: 'founder' },
    at: '2026-10-28T17:00:00.000Z',
  };
  const validReport = experimentReport('valid-linked-event', 'valid-linked-report', 'moon-evidence', 'witness-1', '2026-10-28T17:02:00.000Z', {
    evidenceCreationId: 'artifact-1', evidenceVersion: 1,
  });
  const missingVersionReport = experimentReport('missing-linked-event', 'missing-linked-report', 'moon-evidence', 'witness-2', '2026-10-28T17:03:00.000Z', {
    evidenceCreationId: 'artifact-1', evidenceVersion: 9,
  });
  const world = events => ({
    events,
    creations: [{
      id: 'artifact-1',
      version: 2,
      publishedAt: '2026-10-28T17:00:30.000Z',
      versions: [{ id: 'artifact-1', version: 1, publishedAt: '2026-10-28T17:00:00.000Z' }],
    }],
  });
  const valid = projectMoonshotWorldObjects(world([proposalEvent, publicationEvent, validReport, missingVersionReport]))[0];
  assert.equal(valid.attemptCount, 1);
  assert.equal(valid.challengeCount, 0);
  assert.equal(projectMoonshotWorldObjects(world([proposalEvent, validReport]))[0].attemptCount, 0,
    'a retained version without a publication event is not an active evidence link');
  assert.equal(projectMoonshotWorldObjects(world([proposalEvent, { ...publicationEvent, at: '2026-10-28T17:00:01.000Z' }, validReport]))[0].attemptCount, 0,
    'publication time must match the retained version');
  assert.equal(projectMoonshotWorldObjects(world([proposalEvent, { ...publicationEvent, actor: { id: 'witness-9', role: 'witness' } }, validReport]))[0].attemptCount, 0,
    'a Witness-attributed publication cannot activate the link');
  assert.equal(projectMoonshotWorldObjects(world([proposalEvent, publicationEvent, { ...publicationEvent, id: 'publish-artifact-2' }, validReport]))[0].attemptCount, 0,
    'duplicate publication references are ambiguous');
  assert.equal(projectMoonshotWorldObjects(world([proposalEvent, validReport, publicationEvent]))[0].attemptCount, 0,
    'publication must precede the report in append-only history');
});

test('challenge evidence uses the same publication-event gate as attempt evidence', () => {
  const proposalEvent = proposal('proposal-challenge-evidence', 'moon-challenge-evidence');
  const reportEvent = experimentReport('report-event-challenge-evidence', 'report-challenge-evidence', 'moon-challenge-evidence', 'witness-1', '2026-10-28T17:01:00.000Z');
  const challengeEvent = experimentChallenge('challenge-event-evidence', 'challenge-evidence', 'report-challenge-evidence', 'moon-challenge-evidence', 'witness-2', '2026-10-28T17:02:00.000Z', {
    evidenceCreationId: 'artifact-1', evidenceVersion: 1,
  });
  const publicationEvent = {
    id: 'publish-challenge-evidence',
    type: 'publish',
    creationId: 'artifact-1',
    version: 1,
    actor: { id: 'damien', role: 'founder' },
    at: '2026-10-28T17:00:30.000Z',
  };
  const world = events => ({
    events,
    creations: [{ id: 'artifact-1', version: 1, publishedAt: '2026-10-28T17:00:30.000Z', versions: [] }],
  });
  const withoutPublication = projectMoonshotWorldObjects(world([proposalEvent, reportEvent, challengeEvent]))[0];
  assert.equal(withoutPublication.attemptCount, 1);
  assert.equal(withoutPublication.challengeCount, 0);
  const withPublication = projectMoonshotWorldObjects(world([proposalEvent, publicationEvent, reportEvent, challengeEvent]))[0];
  assert.equal(withPublication.attemptCount, 1);
  assert.equal(withPublication.challengeCount, 1);
});

test('adding retained research activity changes only the matching object counts, not its identity or position', () => {
  const first = proposal('stable-proposal', 'stable-moon');
  const before = projectMoonshotWorldObjects({ events: [first] })[0];
  const after = projectMoonshotWorldObjects({
    events: [first, experimentReport('stable-report-event', 'stable-report', 'stable-moon', 'witness-1', '2026-10-28T17:01:00.000Z')],
  })[0];
  assert.equal(after.id, before.id);
  assert.equal(after.x, before.x);
  assert.equal(after.y, before.y);
  assert.equal(before.attemptCount, 0);
  assert.equal(after.attemptCount, 1);
});


test('accessor-backed attempt and challenge fields are ignored without invoking getters', () => {
  let reads = 0;
  const accessorReport = experimentReport(
    'accessor-report-event', 'accessor-report', 'moon-accessor', 'witness-1', '2026-10-28T17:01:00.000Z'
  );
  Object.defineProperty(accessorReport, 'reportedOutcome', {
    enumerable: true,
    get() { reads += 1; throw new Error('report getter must not run'); },
  });
  const validReport = experimentReport(
    'valid-report-event', 'valid-report', 'moon-accessor', 'witness-2', '2026-10-28T17:02:00.000Z'
  );
  const accessorChallenge = experimentChallenge(
    'accessor-challenge-event', 'accessor-challenge', 'valid-report', 'moon-accessor', 'witness-3', '2026-10-28T17:03:00.000Z'
  );
  Object.defineProperty(accessorChallenge, 'challengeText', {
    enumerable: true,
    get() { reads += 1; throw new Error('challenge getter must not run'); },
  });
  const [object] = projectMoonshotWorldObjects({
    events: [proposal('proposal-accessor', 'moon-accessor'), accessorReport, validReport, accessorChallenge],
  });
  assert.equal(object.attemptCount, 1);
  assert.equal(object.challengeCount, 0);
  assert.equal(reads, 0);
});


test('individual attempt and dissent records become stable navigable world objects', () => {
  const events = [
    proposal('proposal-activity', 'moon-activity'),
    experimentReport('report-event-activity', 'report-activity', 'moon-activity', 'witness-1', '2026-10-28T17:01:00.000Z'),
    experimentChallenge('challenge-event-activity', 'challenge-activity', 'report-activity', 'moon-activity', 'witness-2', '2026-10-28T17:02:00.000Z'),
  ];
  const [before] = projectMoonshotWorldObjects({ events });
  assert.deepEqual(before.activityObjects.map(object => [object.recordType, object.activityId, object.title]), [
    ['experiment-reported', 'report-activity', 'Attempt · inconclusive'],
    ['experiment-challenged', 'challenge-activity', 'Dissent · reproducibility'],
  ]);
  assert.ok(Object.isFrozen(before.activityObjects));
  assert.ok(before.activityObjects.every(Object.isFrozen));
  assert.ok(before.activityObjects.every(object => object.mapVisible && Number.isFinite(object.x) && Number.isFinite(object.y)));
  assert.ok(before.activityObjects.every(object => !Object.hasOwn(object, 'verifiedOutcome') && !Object.hasOwn(object, 'xp') && !Object.hasOwn(object, 'authority')));

  const after = projectMoonshotWorldObjects({
    events: [...events, experimentReport('report-event-later', 'report-later', 'moon-activity', 'witness-3', '2026-10-28T17:03:00.000Z')],
  })[0].activityObjects;
  assert.deepEqual(after.slice(0, 2).map(object => [object.id, object.x, object.y]),
    before.activityObjects.map(object => [object.id, object.x, object.y]));
});

test('date-only research timestamps cannot create proposal or activity map objects', () => {
  const looseProposal = { ...proposal('proposal-loose-time', 'moon-loose-time'), at: '2026-10-28' };
  assert.deepEqual(projectMoonshotWorldObjects({ events: [looseProposal] }), []);

  const validProposal = proposal('proposal-strict-time', 'moon-strict-time');
  const looseReport = experimentReport('report-event-loose-time', 'report-loose-time', 'moon-strict-time', 'witness-1', '2026-10-28');
  const [object] = projectMoonshotWorldObjects({ events: [validProposal, looseReport] });
  assert.equal(object.attemptCount, 0);
  assert.deepEqual(object.activityObjects, []);
});


function interactionView() {
  const interactions = [];
  const routes = [];
  const view = Object.create(WorldView.prototype);
  view.player = { x: 100, y: 100 };
  view.world = { creations: [] };
  view.researchObjects = [
    { id: 'moonshot-object:moon-1', moonshotId: 'moon-1', x: 100, y: 80, title: 'Proposal' },
  ];
  view.researchActivityObjects = [
    { id: 'research-activity:report-1', moonshotId: 'moon-1', activityId: 'report-1',
      recordType: 'experiment-reported', x: 130, y: 90, mapVisible: true, title: 'Attempt' },
  ];
  view.callbacks = {
    onInteract: interaction => interactions.push(interaction),
    onDiscover: id => interactions.push({ type: 'discovery', id }),
  };
  view.goTo = id => routes.push(id);
  return { view, interactions, routes };
}

test('targeted interaction selects the requested research activity over a closer proposal', () => {
  const { view, interactions, routes } = interactionView();
  assert.equal(view.nearest().id, 'moonshot-object:moon-1', 'generic interaction should still choose the closest object');
  assert.equal(view.nearest('research-activity:report-1', 'research-activity').id, 'research-activity:report-1',
    'explicit targeting must resolve the requested activity rather than the globally nearest object');
  view.interact('research-activity:report-1', 'research-activity');
  assert.deepEqual(interactions, [{
    type: 'research-activity', moonshotId: 'moon-1', activityId: 'report-1', recordType: 'experiment-reported',
  }]);
  assert.deepEqual(routes, [], 'a successful targeted interaction must not redirect the player');
});

test('targeted interaction fails closed for a missing or out-of-range target without workbench fallback', () => {
  const { view, interactions, routes } = interactionView();
  view.interact('missing-target', 'research-activity');
  assert.deepEqual(interactions, []);
  assert.deepEqual(routes, []);

  view.player = { x: 1590, y: 990 };
  view.interact('research-activity:report-1');
  assert.deepEqual(interactions, []);
  assert.deepEqual(routes, [], 'an explicit target miss must not silently route to the workbench');
});

test('untargeted interaction keeps the existing nearest-object and workbench fallback behavior', () => {
  const { view, interactions, routes } = interactionView();
  view.interact();
  assert.deepEqual(interactions, [{ type: 'research-object', id: 'moon-1' }]);

  interactions.length = 0;
  view.researchObjects = [];
  view.researchActivityObjects = [];
  view.player = { x: 1590, y: 990 };
  view.interact();
  assert.deepEqual(interactions, []);
  assert.deepEqual(routes, ['workbench']);
});


test('typed quest navigation disambiguates a colliding creation ID from its research activity', () => {
  const { view, interactions } = interactionView();
  view.world.creations = [{
    id: 'research-activity:report-1',
    position: { x: 500, y: 500 },
    title: 'A creation with a colliding identifier',
  }];
  view.researchActivityObjects[0].x = 100;
  view.researchActivityObjects[0].y = 90;
  view.player = { x: 100, y: 100 };
  view.route = [];
  view.target = null;
  view.targetType = null;

  delete view.goTo; // exercise the real WorldView route resolver, not the interaction spy
  view.goTo('research-activity:report-1', 'research-activity');
  assert.equal(view.target, 'research-activity:report-1');
  assert.equal(view.targetType, 'research-activity');
  assert.ok(view.route.length <= 1, 'typed navigation should route to the nearby activity, not the distant colliding creation');

  assert.equal(view.nearest('research-activity:report-1', 'research-activity').type, 'research-activity');
  view.interact('research-activity:report-1', 'research-activity');
  assert.deepEqual(interactions, [{
    type: 'research-activity', moonshotId: 'moon-1', activityId: 'report-1', recordType: 'experiment-reported',
  }]);
});
