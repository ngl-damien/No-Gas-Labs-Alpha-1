import test from 'node:test';
import assert from 'node:assert/strict';
import { institutionActivityCount } from '../game/world-view.mjs';

test('institution counters count only uniquely identified matching records', () => {
  const world = { events: [
    { id: 'contribution-1', type: 'contribute' },
    { event_id: 'comment-1', event_type: 'PUBLIC_COMMENT' },
    { id: 'decision-1', type: 'decision' },
    { type: 'contribute' },
    { id: '', type: 'contribute' },
  ] };

  assert.equal(institutionActivityCount('town-square', world), 2);
  assert.equal(institutionActivityCount('decision_chamber', world), 1);
  assert.equal(institutionActivityCount('not-a-place', world), 0);
});

test('duplicate identity is ambiguous even when only one duplicate matches the institution', () => {
  const world = { events: [
    { id: 'same-event', type: 'contribute' },
    { event_id: 'same-event', event_type: 'UNRELATED' },
    { id: 'unique-event', type: 'contribute' },
  ] };

  assert.equal(institutionActivityCount('town-square', world), 1);
});

test('conflicting current and donor event identities are not counted', () => {
  const world = { events: [
    { id: 'current-id', event_id: 'different-id', type: 'contribute' },
    { id: 'valid-id', event_id: 'valid-id', type: 'contribute' },
  ] };

  assert.equal(institutionActivityCount('town-square', world), 1);
});

test('accessor-backed records cannot influence institution activity counts', () => {
  let getterCalls = 0;
  const hostile = { id: 'hostile-event' };
  Object.defineProperty(hostile, 'type', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'contribute';
    },
  });
  const duplicate = { id: 'hostile-event', type: 'contribute' };
  const valid = { id: 'valid-event', type: 'contribute' };

  assert.equal(institutionActivityCount('town-square', { events: [hostile, duplicate, valid] }), 1);
  assert.equal(getterCalls, 0);
});

test('institution activity counts are order-independent and do not mutate world history', () => {
  const events = [
    { id: 'a', type: 'contribute' },
    { id: 'b', type: 'contribute' },
    { id: 'c', type: 'report' },
  ];
  const world = { events };
  const before = structuredClone(world);

  assert.equal(institutionActivityCount('town-square', world), 2);
  assert.equal(institutionActivityCount('town-square', { events: [...events].reverse() }), 2);
  assert.deepEqual(world, before);
});
