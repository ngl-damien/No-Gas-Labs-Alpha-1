import test from 'node:test';
import assert from 'node:assert/strict';
import { institutionActivityCount, projectMoonshotWorldObjects } from '../game/world-view.mjs';

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
