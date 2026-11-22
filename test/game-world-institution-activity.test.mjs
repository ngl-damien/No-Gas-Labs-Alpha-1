import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PLACES, institutionActivityCount, institutionSummaryFromState, projectSourceArchiveFailureObjects } from '../game/world-view.mjs';
import { createWorld } from '../game/model.mjs';
import { projectCharterCodex, renderCharterCodex } from '../game/institution-view.mjs';

function sourceArchiveFailureEvent(overrides={}) {
  return {
    id:'failure-event-1',
    type:'source-archive-attempt-failed',
    actor:{id:'damien',name:'Damien',role:'founder'},
    at:'2026-11-19T20:00:00.000Z',
    attemptId:'source-archive-attempt-1',
    requestIdDigest:'a'.repeat(64),
    actionDigest:'b'.repeat(64),
    repository:'ngl-damien/No-Gas-Labs-Alpha-1',
    commitSha:'f'.repeat(40),
    path:'test/fixtures/failure-ledger.mjs',
    failureCode:'GITHUB_SOURCE_UNAVAILABLE',
    retryable:true,
    observedBy:'shared-source-archive-service',
    semantics:'Game projection only; XP and buildings do not assert external truth, demand, AI execution or institutional authority.',
    ...overrides
  };
}

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
    { id: 'source-archive-failure-1', type: 'source-archive-attempt-failed', failureCode: 'GITHUB_SOURCE_UNAVAILABLE', retryable: true },
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
  assert.equal(institutionActivityCount('evidence_archive', world), 8, 'failed Source Archive retrievals belong to Evidence Archive history');
  assert.equal(institutionActivityCount('decision_chamber', world), 5);
  assert.equal(institutionActivityCount('town-square', world), 6);
  assert.equal(institutionActivityCount('academy', world), 2);
  assert.equal(institutionActivityCount('moonshot_field', world), 3);
  assert.equal(institutionActivityCount('publication_house', world), 1);

  assert.deepEqual(world, before);
  assert.equal(world.xp, 0);
});


test('Evidence Archive projects service-observed Source Archive failures as bounded read-only objects', () => {
  const events=[
    {id:'publication-before-failures',type:'publish'},
    sourceArchiveFailureEvent(),
    sourceArchiveFailureEvent({
      id:'failure-event-2',
      attemptId:'source-archive-attempt-2',
      requestIdDigest:'c'.repeat(64),
      actionDigest:'d'.repeat(64),
      path:'docs/README.md',
      failureCode:'SOURCE_CAPTURE_MISMATCH',
      retryable:false
    }),
    sourceArchiveFailureEvent({
      id:'invalid-failure-event',
      attemptId:'source-archive-attempt-invalid',
      requestIdDigest:'e'.repeat(64),
      actionDigest:'1'.repeat(64),
      retryable:false
    })
  ];
  const world={schema:'ngl.world.v2',revision:events.length,events};
  const before=structuredClone(world);
  const projection=projectSourceArchiveFailureObjects(world,{limit:1});

  assert.ok(projection);
  assert.equal(projection.available,true);
  assert.equal(projection.total,2);
  assert.equal(projection.invalidCount,1);
  assert.equal(projection.omittedCount,1);
  assert.equal(projection.records.length,1);
  const record=projection.records[0];
  assert.equal(record.eventId,'failure-event-2');
  assert.equal(record.locationId,'evidence_archive');
  assert.equal(record.historyPosition,3);
  assert.equal(record.visiblePosition,3);
  assert.equal(record.actorName,'Damien');
  assert.equal(record.repository,'ngl-damien/No-Gas-Labs-Alpha-1');
  assert.equal(record.path,'docs/README.md');
  assert.equal(record.failureCode,'SOURCE_CAPTURE_MISMATCH');
  assert.equal(record.retryable,false);
  assert.equal(record.status,'non-retryable');
  assert.equal(record.statusLabel,'NON-RETRYABLE · RECEIPT MISMATCH');
  assert.equal(Object.hasOwn(record,'requestIdDigest'),false);
  assert.equal(Object.hasOwn(record,'actionDigest'),false);
  assert.deepEqual(world,before,'projection must not mutate retained world history');
});

test('failure projection rejects duplicate event IDs, attempt IDs, outcomes, and request rebinding', () => {
  const events=[
    sourceArchiveFailureEvent({id:'duplicate-event',attemptId:'duplicate-event-attempt-1',requestIdDigest:'1'.repeat(64),actionDigest:'2'.repeat(64)}),
    sourceArchiveFailureEvent({id:'duplicate-event',attemptId:'duplicate-event-attempt-2',requestIdDigest:'3'.repeat(64),actionDigest:'4'.repeat(64)}),
    sourceArchiveFailureEvent({id:'duplicate-attempt-1',attemptId:'same-attempt',requestIdDigest:'5'.repeat(64),actionDigest:'6'.repeat(64)}),
    sourceArchiveFailureEvent({id:'duplicate-attempt-2',attemptId:'same-attempt',requestIdDigest:'7'.repeat(64),actionDigest:'8'.repeat(64)}),
    sourceArchiveFailureEvent({id:'repeated-outcome-1',attemptId:'repeated-outcome-attempt-1',requestIdDigest:'9'.repeat(64),actionDigest:'a'.repeat(64)}),
    sourceArchiveFailureEvent({id:'repeated-outcome-2',attemptId:'repeated-outcome-attempt-2',requestIdDigest:'9'.repeat(64),actionDigest:'a'.repeat(64)}),
    sourceArchiveFailureEvent({id:'rebound-request-1',attemptId:'rebound-request-attempt-1',requestIdDigest:'b'.repeat(64),actionDigest:'c'.repeat(64)}),
    sourceArchiveFailureEvent({id:'rebound-request-2',attemptId:'rebound-request-attempt-2',requestIdDigest:'b'.repeat(64),actionDigest:'d'.repeat(64)}),
    sourceArchiveFailureEvent({id:'valid-failure',attemptId:'valid-attempt',requestIdDigest:'e'.repeat(64),actionDigest:'f'.repeat(64)})
  ];
  const projection=projectSourceArchiveFailureObjects({schema:'ngl.world.v2',revision:events.length,events});
  assert.ok(projection);
  assert.equal(projection.total,1);
  assert.equal(projection.invalidCount,8);
  assert.equal(projection.records[0].eventId,'valid-failure');
  assert.equal(projection.records[0].failureClassHistoryComplete,false,
    'invalid retained failures prevent a complete failure-class lineage claim');
});


test('failure projection groups distinct retained failure classes by request/action and marks partial lineage', () => {
  const events = [
    sourceArchiveFailureEvent({
      id: 'retry-network-failure',
      attemptId: 'retry-network-attempt',
      requestIdDigest: '1'.repeat(64),
      actionDigest: '2'.repeat(64)
    }),
    sourceArchiveFailureEvent({
      id: 'retry-capture-mismatch',
      attemptId: 'retry-capture-mismatch-attempt',
      requestIdDigest: '1'.repeat(64),
      actionDigest: '2'.repeat(64),
      failureCode: 'SOURCE_CAPTURE_MISMATCH',
      retryable: false
    }),
    sourceArchiveFailureEvent({
      id: 'other-request-failure',
      attemptId: 'other-request-attempt',
      requestIdDigest: '3'.repeat(64),
      actionDigest: '2'.repeat(64)
    })
  ];
  const world = { schema: 'ngl.world.v2', revision: events.length, events };
  const before = structuredClone(world);
  const projection = projectSourceArchiveFailureObjects(world);
  assert.ok(projection);
  assert.equal(projection.total, 3);
  assert.equal(projection.invalidCount, 0);
  assert.deepEqual(projection.records.map(record => [
    record.eventId,
    record.failureClassPosition,
    record.failureClassCount,
    record.failureClassHistoryComplete
  ]), [
    ['retry-network-failure', 1, 2, true],
    ['retry-capture-mismatch', 2, 2, true],
    ['other-request-failure', 1, 1, true]
  ]);
  assert.deepEqual(world, before, 'failure-class grouping is a read-only projection');

  const partial = projectSourceArchiveFailureObjects({ ...world, revision: events.length + 1 });
  assert.ok(partial);
  assert.equal(partial.complete, false);
  assert.equal(partial.unseenEventCount, 1);
  assert.equal(partial.records[0].failureClassHistoryComplete, false,
    'a partial world snapshot must not imply a complete retry sequence');
});


test('Source Archive failure projection pages older retained failures without mutating history', () => {
  const events=Array.from({length:13},(_,index)=>sourceArchiveFailureEvent({
    id:'failure-page-'+(index+1),
    attemptId:'failure-page-attempt-'+(index+1),
    requestIdDigest:String(index+1).padStart(64,'0'),
    actionDigest:'f'.repeat(64)
  }));
  const world={schema:'ngl.world.v2',revision:events.length,events};
  const before=structuredClone(world);

  const newest=projectSourceArchiveFailureObjects(world);
  assert.ok(newest);
  assert.equal(newest.page,0);
  assert.equal(newest.pageSize,12);
  assert.equal(newest.total,13);
  assert.equal(newest.totalPages,2);
  assert.equal(newest.firstFailureRecordPosition,2);
  assert.equal(newest.lastFailureRecordPosition,13);
  assert.equal(newest.hasOlder,true);
  assert.equal(newest.hasNewer,false);
  assert.deepEqual(newest.records.map(record=>record.eventId),events.slice(1).map(event=>event.id),
    'the newest page retains append order for deterministic rendering');

  const older=projectSourceArchiveFailureObjects(world,{page:1});
  assert.ok(older);
  assert.equal(older.page,1);
  assert.equal(older.firstFailureRecordPosition,1);
  assert.equal(older.lastFailureRecordPosition,1);
  assert.equal(older.hasOlder,false);
  assert.equal(older.hasNewer,true);
  assert.deepEqual(older.records.map(record=>record.eventId),[events[0].id]);
  assert.equal(older.records[0].failureClassHistoryComplete,true);
  assert.equal(projectSourceArchiveFailureObjects(world,{page:-1}),null);
  assert.deepEqual(world,before,'paging is a read-only projection over retained events');
});


test('Source Archive failure projection clamps a stale page in a partial snapshot without claiming completeness',()=>{
  const events=Array.from({length:13},(_,index)=>sourceArchiveFailureEvent({
    id:'partial-failure-page-'+(index+1),
    attemptId:'partial-failure-attempt-'+(index+1),
    requestIdDigest:String(index+1).padStart(64,'0'),
    actionDigest:'e'.repeat(64)
  }));
  const partial={schema:'ngl.world.v2',revision:13,events:events.slice(0,1)};
  const before=structuredClone(partial);
  const projection=projectSourceArchiveFailureObjects(partial,{page:1});
  assert.ok(projection);
  assert.equal(projection.complete,false);
  assert.equal(projection.unseenEventCount,12);
  assert.equal(projection.total,1);
  assert.equal(projection.page,0,'a stale page index clamps to the only page in the partial projection');
  assert.equal(projection.totalPages,1);
  assert.equal(projection.firstFailureRecordPosition,1);
  assert.equal(projection.lastFailureRecordPosition,1);
  assert.equal(projection.hasOlder,false);
  assert.equal(projection.hasNewer,false);
  assert.equal(projection.records.length,1);
  assert.equal(projection.records[0].failureClassHistoryComplete,false);
  assert.deepEqual(partial,before,'partial-page projection remains read-only');
});


test('failure projection never invokes accessors or Proxy get traps and rejects partial history', () => {
  let getterCalls=0,proxyGetCalls=0;
  const accessor=sourceArchiveFailureEvent({id:'accessor-failure',attemptId:'accessor-attempt',requestIdDigest:'1'.repeat(64),actionDigest:'2'.repeat(64)});
  Object.defineProperty(accessor,'failureCode',{
    enumerable:true,
    configurable:true,
    get(){getterCalls++;return 'GITHUB_SOURCE_UNAVAILABLE';}
  });
  const proxied=new Proxy(
    sourceArchiveFailureEvent({id:'proxy-failure',attemptId:'proxy-attempt',requestIdDigest:'3'.repeat(64),actionDigest:'4'.repeat(64)}),
    {get(target,property,receiver){proxyGetCalls++;return Reflect.get(target,property,receiver);}}
  );
  const projection=projectSourceArchiveFailureObjects({schema:'ngl.world.v2',revision:2,events:[accessor,proxied]});
  assert.ok(projection);
  assert.equal(projection.total,1);
  assert.equal(projection.records[0].eventId,'proxy-failure');
  assert.equal(projection.invalidCount,1);
  assert.equal(getterCalls,0);
  assert.equal(proxyGetCalls,0);
  const partial=projectSourceArchiveFailureObjects({
    schema:'ngl.world.v2',
    revision:3,
    events:[sourceArchiveFailureEvent({id:'partial-failure',attemptId:'partial-attempt'})]
  });
  assert.ok(partial);
  assert.equal(partial.complete,false);
  assert.equal(partial.unseenEventCount,2);
  assert.equal(partial.records[0].eventId,'partial-failure');
  assert.equal(partial.records[0].historyPosition,null);
  assert.equal(partial.records[0].visiblePosition,1);
  assert.equal(projectSourceArchiveFailureObjects({
    schema:'ngl.world.v2',revision:0,events:[sourceArchiveFailureEvent()]
  }),null,'a revision smaller than the delivered event array is inconsistent history');
});

test('Evidence Archive owns the fixed Contradiction Clerk challenge and its retained reports', () => {
  const archive = PLACES.find(place => place.id === 'evidence_archive');
  assert.ok(archive);
  assert.match(archive.purpose, /Contradiction Clerk/);
  assert.match(archive.purpose, /fixed local challenge checklist/);
  assert.match(archive.purpose, /failed Source Archive retrievals/);
  const world = { xp: 0, events: [{ id: 'clerk-report-1', type: 'report' }] };
  const before = structuredClone(world);
  assert.equal(institutionActivityCount('evidence_archive', world), 1);
  assert.equal(institutionActivityCount('guild_hall', world), 0);
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

test('Combat Yard map count reflects retained encounter and move events, not invented victory labels', () => {
  const world = { xp: 0, events: [
    { id: 'combat-start', type: 'combat-encounter-started' },
    { id: 'combat-move-1', type: 'combat-move-resolved' },
    { id: 'untrusted-victory-label', type: 'combat-victory' },
    { type: 'combat-move-resolved' },
  ] };
  assert.equal(institutionActivityCount('combat_yard', world), 2);
  assert.equal(world.xp, 0, 'map activity counts do not award XP or mutate world state');
});


function charterElement(tag) {
  return {
    tagName: tag,
    children: [],
    dataset: {},
    attributes: {},
    textContent: '',
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
}

function walkCharterTree(root) {
  return [root, ...(Array.isArray(root?.children) ? root.children.flatMap(walkCharterTree) : [])];
}

function withCharterDocument(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: { createElement: charterElement }
  });
  try { return run(); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  }
}

test('AOTA Codex routes engineering handoff to Guild Hall and external deployment decisions to Founder Gate', () => {
  const founder = { id: 'damien', name: 'Neophyte Founder', role: 'founder' };
  const world = createWorld({
    id: 'codex-institution-routing',
    founderName: 'Neophyte Founder',
    now: '2026-11-22T08:00:00.000Z'
  });
  const before = structuredClone(world);
  const projection = projectCharterCodex(world, founder);
  const engineer = projection.stages.find(stage => stage.id === 'engineer-for-use');
  const deploy = projection.stages.find(stage => stage.id === 'deploy-share-commercialize');

  assert.equal(projection.available, true);
  assert.equal(engineer.locationId, 'guild_hall');
  assert.equal(engineer.locationName, 'Guild Hall · Synthesis Clerk');
  assert.equal(engineer.status, 'NOT REPRESENTED IN PLAYER-WORLD STATE');
  assert.equal(engineer.relatedOnly, true);
  assert.deepEqual(engineer.evidenceIds, []);
  assert.equal(deploy.locationId, 'decision_chamber');
  assert.equal(deploy.locationName, 'Founder Gate · Decision Chamber');
  assert.equal(deploy.status, 'NOT REPRESENTED IN PLAYER-WORLD STATE');
  assert.equal(deploy.relatedOnly, true);
  assert.deepEqual(deploy.evidenceIds, []);
  assert.equal(projection.xpDelta, 0);
  assert.equal(projection.worldMutation, false);

  const place = id => PLACES.find(candidate => candidate.id === id);
  assert.match(place('forge')?.purpose || '', /not.*engineering acceptance/i);
  assert.match(place('guild_hall')?.purpose || '', /Synthesis Clerk.*dated.*snapshot.*evidence lead/i);
  assert.match(place('decision_chamber')?.purpose || '', /human-gated.*external deployment/i);
  assert.match(place('publication_house')?.purpose || '', /in-world circulation only/i);
  assert.match(place('publication_house')?.purpose || '', /not external deployment/i);

  const actions = [];
  withCharterDocument(() => {
    const root = charterElement('div');
    renderCharterCodex(root, {
      world,
      viewer: founder,
      onOpenAction: action => actions.push(action)
    });
    const routeButtons = walkCharterTree(root).filter(node =>
      ['engineer-for-use', 'deploy-share-commercialize'].includes(node.dataset?.charterStageAction)
    );
    assert.equal(routeButtons.length, 2);
    for (const button of routeButtons) button.onclick();
  });

  assert.deepEqual(actions, [
    { type: 'location', id: 'guild_hall' },
    { type: 'location', id: 'decision_chamber' }
  ]);
  assert.deepEqual(world, before, 'Codex routing remains read-only and awards no progress');
});
