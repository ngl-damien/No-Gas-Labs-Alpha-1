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


test('inherited accessors cannot influence activity counts or execute getters', () => {
  let getterCalls = 0;
  const prototype = {};
  Object.defineProperty(prototype, 'type', {
    get() {
      getterCalls += 1;
      return 'contribute';
    },
  });
  const inherited = Object.assign(Object.create(prototype), { id: 'inherited-event' });
  const valid = { id: 'valid-event', type: 'contribute' };

  assert.equal(institutionActivityCount('town-square', { events: [inherited, valid] }), 1);
  assert.equal(getterCalls, 0);
});

test('activity matching uses a data snapshot rather than invoking Proxy get traps', () => {
  let getCalls = 0;
  const record = new Proxy(
    { id: 'proxy-event', type: 'contribute' },
    {
      get(target, property, receiver) {
        getCalls += 1;
        return Reflect.get(target, property, receiver);
      },
    },
  );

  assert.equal(institutionActivityCount('town-square', { events: [record] }), 1);
  assert.equal(getCalls, 0);
});

test('accessor-backed world event containers are ignored without invoking getters', () => {
  let getterCalls = 0;
  const world = { history: [{ id: 'history-event', type: 'contribute' }] };
  Object.defineProperty(world, 'events', {
    get() {
      getterCalls += 1;
      return [{ id: 'getter-event', type: 'contribute' }];
    },
  });

  assert.equal(institutionActivityCount('town-square', world), 1);
  assert.equal(getterCalls, 0);
});

test('revoked Proxy records are skipped instead of crashing the projection', () => {
  const revocable = Proxy.revocable({}, {});
  revocable.revoke();

  assert.equal(institutionActivityCount('town-square', {
    events: [revocable.proxy, { id: 'valid-event', type: 'contribute' }],
  }), 1);
});

test('canonical Alpha 1 events light up the institutions that perform their functions', () => {
  const world = { xp: 0, events: [
    { id: 'draft-1', type: 'draft' },
    { id: 'repair-1', type: 'repair' },
    { id: 'publish-1', type: 'publish' },
    { id: 'contribute-1', type: 'contribute' },
    { id: 'report-1', type: 'report' },
    { id: 'study-1', type: 'study' },
    { id: 'review-1', type: 'study-reviewed' },
    { id: 'moonshot-1', type: 'moonshot-proposed' },
    { id: 'experiment-1', type: 'experiment-reported' },
    { id: 'challenge-1', type: 'experiment-challenged' },
    { id: 'policy-1', type: 'policy-set' },
    { id: 'proposal-created-1', type: 'proposal-created' },
    { id: 'decision-attempted-1', type: 'decision-attempted' },
    { id: 'expiry-1', type: 'expiry-observed' },
    { id: 'revocation-1', type: 'revocation' },
    { event_id: 'public-comment-1', event_type: 'PUBLIC_COMMENT' },
  ] };
  const before = structuredClone(world);

  // One retained event can serve more than one institution; these are
  // navigational activity counts, not exclusive ownership or quest rewards.
  assert.equal(institutionActivityCount('guild_hall', world), 3);
  assert.equal(institutionActivityCount('forge', world), 3);
  assert.equal(institutionActivityCount('evidence_archive', world), 7);
  assert.equal(institutionActivityCount('decision_chamber', world), 5);
  assert.equal(institutionActivityCount('town-square', world), 6);
  assert.equal(institutionActivityCount('academy', world), 2);
  assert.equal(institutionActivityCount('moonshot_field', world), 3);
  assert.equal(institutionActivityCount('publication_house', world), 1);

  assert.deepEqual(world, before);
  assert.equal(world.xp, 0);
});
