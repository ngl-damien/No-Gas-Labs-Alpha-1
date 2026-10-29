import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decisionChamberMapLabel, institutionActivityCount, institutionSummaryFromState } from '../game/world-view.mjs';

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

  assert.equal(institutionActivityCount('town-square', world), 3);
  assert.equal(institutionActivityCount('town-square', { events: [...events].reverse() }), 3);
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

test('world map counts retained institutional kernel stages at their real locations', () => {
  const world = { xp: 0, events: [{ id: 'shared-id', type: 'contribute' }] };
  const institution = { schema: 'ngl.shared-institution-summary.v1', kernel: {
    schema: 'ngl.institution.v1',
    revision: 6,
    eventCount: 6,
    events: [
      { id: 'shared-id', type: 'claim' },
      { id: 'grant-1', type: 'authorize' },
      { id: 'execution-1', type: 'execute' },
      { id: 'observation-1', type: 'observe', passed: false },
      { id: 'adjudication-1', type: 'adjudicate', decision: 'reject' },
      { id: 'revocation-1', type: 'revoke' },
    ],
  } };
  const before = structuredClone({ world, institution });

  // Same IDs in separate retained stores do not collide. A failed observation
  // and rejected adjudication remain visible as records, never as success.
  assert.equal(institutionActivityCount('guild_hall', world, institution), 4);
  assert.equal(institutionActivityCount('forge', world, institution), 1);
  assert.equal(institutionActivityCount('evidence_archive', world, institution), 7);
  assert.equal(institutionActivityCount('decision_chamber', world, institution), 3);
  assert.equal(institutionActivityCount('town-square', world, institution), 7);
  assert.equal(institutionActivityCount('publication_house', world, institution), 0);

  assert.deepEqual({ world, institution }, before);
  assert.equal(world.xp, 0);
});

test('Decision Chamber includes only a valid aggregate from the separate decision ledger', () => {
  const world = { events: [{ id: 'world-decision-1', type: 'decision' }] };
  const institution = {
    schema: 'ngl.shared-institution-summary.v1',
    kernel: { schema: 'ngl.institution.v1', revision: 0, eventCount: 0, events: [] },
    decisionSummary: {
      schema: 'ngl.decisions.summary.v1',
      available: true,
      revision: 3,
      decisionCount: 1,
      counts: { PENDING: 0, APPROVED: 0, REJECTED: 1, DEFERRED: 0, EXPIRED: 0 }
    }
  };
  assert.equal(institutionActivityCount('decision_chamber', world, institution), 2);
  assert.equal(institutionActivityCount('town-square', world, institution), 0);

  for (const invalid of [
    { ...institution.decisionSummary, decisionCount: 2 },
    { ...institution.decisionSummary, revision: 0 },
    { ...institution.decisionSummary, counts: { ...institution.decisionSummary.counts, REJECTED: -1 } },
    { ...institution.decisionSummary, available: false }
  ]) {
    assert.equal(institutionActivityCount('decision_chamber', world, {
      ...institution, decisionSummary: invalid
    }), 1, 'invalid or unavailable gate summaries must not inflate map activity');
  }
  assert.equal(institutionActivityCount('decision_chamber', world, {
    ...institution, schema: 'ngl.shared-institution-summary.v2'
  }), 1, 'a decision aggregate outside the recognized institution envelope must be ignored');

  let getterCalls = 0;
  const hostile = { schema: 'ngl.decisions.summary.v1', available: true, revision: 1, decisionCount: 1 };
  Object.defineProperty(hostile, 'counts', { get() { getterCalls += 1; return institution.decisionSummary.counts; } });
  assert.equal(institutionActivityCount('decision_chamber', world, {
    ...institution, decisionSummary: hostile
  }), 1);
  assert.equal(getterCalls, 0);
});

test('Decision Chamber map labels missing or invalid summaries as unavailable, not zero', () => {
  assert.equal(decisionChamberMapLabel(null, 0), 'gate ledger unavailable');
  const institution = {
    schema: 'ngl.shared-institution-summary.v1',
    kernel: { schema: 'ngl.institution.v1', revision: 0, eventCount: 0, events: [] },
    decisionSummary: {
      schema: 'ngl.decisions.summary.v1',
      available: true,
      revision: 1,
      decisionCount: 0,
      counts: { PENDING: 0, APPROVED: 0, REJECTED: 0, DEFERRED: 0, EXPIRED: 0 }
    }
  };
  assert.equal(decisionChamberMapLabel(institution, 0), '0 records · 0 pending');
  assert.equal(decisionChamberMapLabel({ ...institution, decisionSummary: { schema: 'ngl.decisions.summary.v1', available: false } }, 0),
    'gate ledger unavailable');
  assert.equal(decisionChamberMapLabel({ ...institution, schema: 'ngl.shared-institution-summary.v2' }, 0),
    'gate ledger unavailable');
});

test('incomplete institutional kernel snapshots do not inflate map counters', () => {
  const world = { events: [] };
  const institution = { schema: 'ngl.shared-institution-summary.v1', kernel: {
    schema: 'ngl.institution.v1',
    revision: 3,
    eventCount: 3,
    events: [{ id: 'claim-1', type: 'claim' }, { id: 'execute-1', type: 'execute' }],
  } };

  assert.equal(institutionActivityCount('guild_hall', world, institution), 0);
  assert.equal(institutionActivityCount('forge', world, institution), 0);
  assert.equal(institutionActivityCount('evidence_archive', world, institution), 0);
});

test('duplicate IDs inside the institutional stream remain ambiguous', () => {
  const world = { events: [] };
  const institution = { schema: 'ngl.shared-institution-summary.v1', kernel: {
    schema: 'ngl.institution.v1',
    revision: 2,
    eventCount: 2,
    events: [{ id: 'duplicate', type: 'execute' }, { id: 'duplicate', type: 'claim' }],
  } };

  assert.equal(institutionActivityCount('forge', world, institution), 0);
  assert.equal(institutionActivityCount('evidence_archive', world, institution), 0);
});


test('institution map rejects unknown summary and kernel protocol versions', () => {
  const world = { events: [] };
  const summary = {
    schema: 'ngl.shared-institution-summary.v1',
    kernel: {
      schema: 'ngl.institution.v1',
      revision: 1,
      eventCount: 1,
      events: [{ id: 'execution-1', type: 'execute' }],
    },
  };

  assert.equal(institutionActivityCount('forge', world, summary), 1);
  assert.equal(institutionActivityCount('forge', world, {
    ...summary,
    schema: 'ngl.shared-institution-summary.v2',
  }), 0);
  assert.equal(institutionActivityCount('forge', world, {
    ...summary,
    kernel: { ...summary.kernel, schema: 'ngl.institution.v2' },
  }), 0);
  assert.equal(institutionActivityCount('forge', world, { kernel: summary.kernel }), 0);
});

test('shared-state normalization returns only a recognized institution summary', () => {
  const summary = {
    schema: 'ngl.shared-institution-summary.v1',
    kernel: {
      schema: 'ngl.institution.v1',
      revision: 0,
      eventCount: 0,
      events: [],
    },
  };

  assert.equal(institutionSummaryFromState({ institution: summary }), summary);
  assert.equal(institutionSummaryFromState({}), null);
  assert.equal(institutionSummaryFromState({ institution: null }), null);
  assert.equal(institutionSummaryFromState({
    institution: { ...summary, schema: 'ngl.shared-institution-summary.v2' },
  }), null);
  assert.equal(institutionSummaryFromState({
    institution: { ...summary, kernel: { ...summary.kernel, schema: 'ngl.institution.v2' } },
  }), null);

  let getterCalls = 0;
  const dto = {};
  Object.defineProperty(dto, 'institution', {
    get() { getterCalls += 1; return summary; },
  });
  assert.equal(institutionSummaryFromState(dto), null);
  assert.equal(getterCalls, 0);
});


test('shared client replaces rather than retains an old institutional summary on every state refresh', async () => {
  const source = await readFile(new URL('../game/client.mjs', import.meta.url), 'utf8');

  assert.match(source, /institutionSummaryFromState/);
  assert.match(source, /institution=institutionSummaryFromState\(dto\)/);
  assert.doesNotMatch(source, /institution=dto\.institution\|\|institution/);
});
