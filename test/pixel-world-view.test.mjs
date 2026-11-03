import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORLD_TILE_SIZE,
  classifyWorldTile,
  worldTileAt,
  PIXEL_SPRITES
} from '../game/pixel-world-view.mjs';
import { isWalkable, findRoute, PLACES, WORLD_WIDTH, WORLD_HEIGHT } from '../game/world-view.mjs';
import { projectCollaboratorPackets } from '../game/collaborator-contracts.mjs';
import { createHash } from 'node:crypto';
import { createWorld, applyAction } from '../game/model.mjs';
import { sourceObservationRequestMaterial } from '../game/research-records.mjs';
import {
  projectSourceObservationMapCounts,
  projectQuestMapTarget,
  projectMapLabelMetrics,
  projectQuestCompassIndicator,
  projectGuildNpcReadiness,
  PixelWorldView,
  GUILD_NPCS
} from '../game/pixel-world-view.mjs';

test('the top-down map classifies the river, two crossings, paths, plaza and grass deterministically', () => {
  assert.equal(WORLD_TILE_SIZE, 32);
  assert.equal(classifyWorldTile(27, 15), 'water');
  assert.equal(classifyWorldTile(27, 11), 'bridge');
  assert.equal(isWalkable(880, 368), true, 'the visible bridge must be traversable');
  assert.equal(isWalkable(880, 496), false, 'the visible river must remain blocked outside a bridge');
  assert.equal(classifyWorldTile(12, 21), 'path');
  assert.equal(classifyWorldTile(32, 13), 'plaza');
  assert.equal(classifyWorldTile(2, 2), 'grass');
  assert.equal(classifyWorldTile(-1, 2), 'void');
  assert.equal(classifyWorldTile(1.5, 2), 'void');
});

test('tile descriptors are stable projections with bounded palette variants', () => {
  const first = worldTileAt(27, 15);
  const second = worldTileAt(27, 15);
  assert.deepEqual(first, second);
  assert.equal(first.kind, 'water');
  assert.ok(Number.isInteger(first.variant) && first.variant >= 0 && first.variant < 4);
  assert.ok(Object.isFrozen(first));
});

test('pixel sprites use rectangular, bounded, data-only character grids', () => {
  const allowed = new Set(Array.from('.GLTSHFBCVRW'));
  for (const [name, rows] of Object.entries(PIXEL_SPRITES)) {
    assert.ok(Array.isArray(rows) && rows.length > 0, name + ' sprite must have rows');
    const width = rows[0].length;
    assert.ok(width > 0 && width <= 16, name + ' sprite width must be bounded');
    for (const row of rows) {
      assert.equal(row.length, width, name + ' sprite rows must be rectangular');
      for (const symbol of row) assert.ok(allowed.has(symbol), name + ' contains an unknown pixel symbol');
    }
    assert.ok(rows.length <= 16, name + ' sprite height must be bounded');
    assert.ok(Object.isFrozen(rows), name + ' sprite rows must be immutable');
  }
  assert.ok(Object.isFrozen(PIXEL_SPRITES));
});


const founder = { id: 'pixel-map-founder', name: 'Founder', role: 'founder' };
const witness = { id: 'pixel-map-witness', name: 'Witness', role: 'witness' };
const observationTimes = {
  created: '2026-10-17T12:00:00.000Z',
  published: '2026-10-17T12:00:01.000Z',
  observed: '2026-10-17T12:00:02.000Z',
  challenged: '2026-10-17T12:00:03.000Z',
  responded: '2026-10-17T12:00:04.000Z'
};

async function sourceObservationWorld({ respond = false } = {}) {
  const start = createWorld({ id: 'pixel-world-source-observation-counts', now: observationTimes.created });
  const draft = await applyAction(start, {
    type: 'draft', kind: 'observatory', title: 'Source Observatory',
    intent: 'Retain a falsifiable research note.'
  }, founder, { now: observationTimes.created });
  const published = await applyAction(draft.world, {
    type: 'publish', draftId: draft.result.draftId, expectedVersion: 0
  }, founder, { now: observationTimes.published });
  const creationId = published.result.creationId;
  const note = {
    claim: 'The bridge is open.',
    sourceKind: 'model-assertion',
    source: 'A model response; no source retrieved.',
    falsifier: 'Direct inspection finds the bridge closed.',
    uncertainty: 'No independent observation.',
    nextTest: 'Inspect the primary source.'
  };
  const digest = createHash('sha256').update(sourceObservationRequestMaterial({
    actorId: founder.id, actorRole: founder.role, creationId, version: 1, ...note
  })).digest('hex');
  const observationId = 'source-observation-' + digest;
  const recorded = await applyAction(published.world, {
    type: 'record-source-observation', creationId, version: 1, observationId, ...note
  }, founder, {
    now: observationTimes.observed, requestId: observationId, actionFingerprint: 'c'.repeat(64)
  });

  const challenged = await applyAction(recorded.world, {
    type: 'challenge-source-observation', observationId, challengeType: 'contradiction',
    challengeText: 'The note cites a model assertion but identifies no retrievable primary source.'
  }, witness, {
    now: observationTimes.challenged, requestId: 'pixel-map-challenge',
    actionFingerprint: 'd'.repeat(64)
  });
  if (!respond) return challenged.world;

  return (await applyAction(challenged.world, {
    type: 'respond-source-observation-challenge',
    challengeId: challenged.result.challengeId,
    responseText: 'The note is a lead only; source retrieval remains outstanding.'
  }, founder, {
    now: observationTimes.responded, requestId: 'pixel-map-response',
    actionFingerprint: 'e'.repeat(64)
  })).world;
}

test('the map projects only linked research, dissent and author responses without awarding progress', async () => {
  const world = await sourceObservationWorld({ respond: true });
  const before = { revision: world.revision, xp: world.xp, eventCount: world.events.length };
  assert.deepEqual(projectSourceObservationMapCounts(world), {
    available: true, notes: 1, dissent: 1, responses: 1, pending: 0, review: 0
  });
  assert.deepEqual(
    { revision: world.revision, xp: world.xp, eventCount: world.events.length },
    before
  );
});

test('an unanswered linked challenge appears as pending dissent, not a completed response', async () => {
  const world = await sourceObservationWorld();
  assert.deepEqual(projectSourceObservationMapCounts(world), {
    available: true, notes: 1, dissent: 1, responses: 0, pending: 1, review: 0
  });
});

test('ambiguous duplicate author responses remain review items, not resolved responses', async () => {
  const world = await sourceObservationWorld({ respond: true });
  const response = world.events.find(event => event.type === 'source-observation-challenge-responded');
  const duplicate = { ...response, id: 'pixel-map-duplicate-response-event' };
  const ambiguous = { ...world, events: [...world.events, duplicate] };
  assert.deepEqual(projectSourceObservationMapCounts(ambiguous), {
    available: true, notes: 1, dissent: 1, responses: 0, pending: 0, review: 2
  });
});

test('unlinked retained notes and their challenge history become review counts, not zero activity', async () => {
  const world = await sourceObservationWorld({ respond: true });
  const unlinked = { ...world, creations: [] };
  assert.deepEqual(projectSourceObservationMapCounts(unlinked), {
    available: true, notes: 0, dissent: 0, responses: 0, pending: 0, review: 3
  });
});

test('missing or malformed world collections report unavailable instead of zero', () => {
  assert.deepEqual(projectSourceObservationMapCounts({ events: {}, creations: [] }), {
    available: false, notes: null, dissent: null, responses: null, pending: null, review: null
  });
});

test('hostile event type accessors are not invoked while building map counts', () => {
  let reads = 0;
  const event = Object.defineProperty({}, 'type', {
    enumerable: true,
    get() { reads += 1; return 'source-observation-recorded'; }
  });
  const counts = projectSourceObservationMapCounts({ events: [event], creations: [] });
  assert.equal(reads, 0);
  assert.deepEqual(counts, {
    available: true, notes: 0, dissent: 0, responses: 0, pending: 0, review: 0
  });
});


test('quest map targets resolve the exact workbench and institution objectives', () => {
  assert.deepEqual(
    projectQuestMapTarget({ type: 'workbench', recipe: 'comic' }, { creations: [] }),
    { kind: 'location', id: 'workbench', x: 325, y: 645, label: 'The Making Bench' }
  );
  const academy = PLACES.find(place => place.id === 'academy');
  assert.deepEqual(
    projectQuestMapTarget({ type: 'location', id: 'academy' }, { creations: [] }),
    { kind: 'location', id: 'academy', x: academy.x, y: academy.y, label: academy.name }
  );
  assert.equal(projectQuestMapTarget({ type: 'location', id: 'not-a-place' }, { creations: [] }), null);
  assert.equal(projectQuestMapTarget({ type: 'workbench', recipe: 'unknown' }, { creations: [] }), null);
});

test('creation quest targets require one unique retained ID and the exact referenced version', () => {
  const world = {
    creations: [{
      id: 'creation-one', version: 2, versions: [{ version: 1 }],
      title: 'A retained place', position: { x: 240, y: 360 }
    }]
  };
  assert.deepEqual(
    projectQuestMapTarget({ type: 'creation', id: 'creation-one', version: 1 }, world),
    { kind: 'creation', id: 'creation-one', x: 240, y: 360, label: 'A retained place' }
  );
  assert.equal(projectQuestMapTarget({ type: 'creation', id: 'creation-one', version: 3 }, world), null);
  assert.equal(projectQuestMapTarget({ type: 'creation', id: 'creation-one', version: 2 }, {
    creations: [...world.creations, ...world.creations]
  }), null);
});

test('research quest targets require one exact projected and map-visible object', () => {
  const researchObjects = [{
    id: 'moonshot-object:question-one', moonshotId: 'question-one',
    title: 'A falsifiable question', x: 1320, y: 520
  }];
  const researchActivityObjects = [{
    id: 'research-activity:event-one', moonshotId: 'question-one',
    activityId: 'report-one', title: 'Attempt · failed', x: 1144, y: 629, mapVisible: true
  }];
  assert.deepEqual(
    projectQuestMapTarget({
      type: 'research-object', id: 'moonshot-object:question-one', moonshotId: 'question-one'
    }, { creations: [] }, researchObjects, researchActivityObjects),
    { kind: 'research-object', id: 'moonshot-object:question-one', x: 1320, y: 520, label: 'A falsifiable question' }
  );
  assert.deepEqual(
    projectQuestMapTarget({
      type: 'research-activity', id: 'research-activity:event-one',
      moonshotId: 'question-one', activityId: 'report-one'
    }, { creations: [] }, researchObjects, researchActivityObjects),
    { kind: 'research-activity', id: 'research-activity:event-one', x: 1144, y: 629, label: 'Attempt · failed' }
  );
  assert.equal(projectQuestMapTarget({
    type: 'research-activity', id: 'research-activity:event-one',
    moonshotId: 'question-one', activityId: 'report-one'
  }, { creations: [] }, researchObjects, [{ ...researchActivityObjects[0], mapVisible: false }]), null);
  assert.equal(projectQuestMapTarget({
    type: 'research-object', id: 'moonshot-object:question-one', moonshotId: 'question-one'
  }, { creations: [] }, [...researchObjects, ...researchObjects]), null);
});

test('quest map projection rejects hostile action accessors without invoking them', () => {
  let reads = 0;
  const action = Object.defineProperty({}, 'type', {
    enumerable: true,
    get() { reads += 1; return 'location'; }
  });
  assert.equal(projectQuestMapTarget(action, { creations: [] }), null);
  assert.equal(reads, 0);
});


test('quest map targets fail closed on identity collisions, duplicate versions and out-of-world positions', () => {
  const creationAction = { type: 'creation', id: 'creation-one', version: 1 };
  const duplicateVersions = {
    creations: [{
      id: 'creation-one', version: 2, versions: [{ version: 1 }, { version: 1 }],
      title: 'Ambiguous version', position: { x: 240, y: 360 }
    }]
  };
  assert.equal(projectQuestMapTarget(creationAction, duplicateVersions), null);

  const outOfWorld = {
    creations: [{
      id: 'creation-one', version: 1, versions: [],
      title: 'Off-map creation', position: { x: WORLD_WIDTH + 1, y: 360 }
    }]
  };
  assert.equal(projectQuestMapTarget(creationAction, outOfWorld), null);
  assert.equal(projectQuestMapTarget({
    type: 'creation', id: 'creation-one', version: 1
  }, {
    creations: [{
      id: 'creation-one', version: 1, versions: [],
      title: 'Off-map creation', position: { x: 240, y: WORLD_HEIGHT + 1 }
    }]
  }), null);

  const object = {
    id: 'moonshot-object:question-one', moonshotId: 'question-one',
    title: 'One object', x: 1320, y: 520
  };
  assert.equal(projectQuestMapTarget({
    type: 'research-object', id: object.id, moonshotId: object.moonshotId
  }, { creations: [] }, [object, { ...object, moonshotId: 'other-question' }]), null);

  const activity = {
    id: 'research-activity:event-one', moonshotId: 'question-one',
    activityId: 'report-one', title: 'One activity', x: 1144, y: 629, mapVisible: true
  };
  assert.equal(projectQuestMapTarget({
    type: 'research-activity', id: activity.id,
    moonshotId: activity.moonshotId, activityId: activity.activityId
  }, { creations: [] }, [], [activity, { ...activity, activityId: 'other-report' }]), null);
});


test('prefixed research target IDs preserve the full valid source identifier', () => {
  const moonshotId = 'm'.repeat(128);
  const objectId = 'moonshot-object:' + moonshotId;
  const researchObjects = [{
    id: objectId, moonshotId, title: 'Long-ID moonshot', x: 1320, y: 520
  }];
  assert.deepEqual(
    projectQuestMapTarget({ type: 'research-object', id: objectId, moonshotId }, { creations: [] }, researchObjects),
    { kind: 'research-object', id: objectId, x: 1320, y: 520, label: 'Long-ID moonshot' }
  );

  const eventId = 'e'.repeat(128);
  const activityId = 'a'.repeat(128);
  const activityObjectId = 'research-activity:' + eventId;
  const researchActivityObjects = [{
    id: activityObjectId, moonshotId, activityId,
    title: 'Long-ID activity', x: 1144, y: 629, mapVisible: true
  }];
  assert.deepEqual(
    projectQuestMapTarget({
      type: 'research-activity', id: activityObjectId, moonshotId, activityId
    }, { creations: [] }, [], researchActivityObjects),
    { kind: 'research-activity', id: activityObjectId, x: 1144, y: 629, label: 'Long-ID activity' }
  );
});

test('map label metrics preserve readable screen size across mobile and desktop zoom', () => {
  for (const zoom of [0.78, 0.92]) {
    const metrics = projectMapLabelMetrics(11, zoom, 320);
    assert.ok(metrics);
    assert.ok(Math.abs(metrics.fontSize * zoom - 11) < 1e-9);
    assert.ok(Math.abs(metrics.maxWidth * zoom - 220) < 1e-9);
    assert.ok(Math.abs(metrics.lineWidth * zoom - 1.5) < 1e-9);
    assert.ok(Object.isFrozen(metrics));
  }
  assert.equal(projectMapLabelMetrics(11, 0, 320), null);
  assert.equal(projectMapLabelMetrics(7, 0.78, 320), null);
  assert.equal(projectMapLabelMetrics(11, 0.78, 40), null);
});

test('quest compass stays hidden for visible objectives and points to off-screen destinations', () => {
  assert.equal(projectQuestCompassIndicator(
    { x: 325, y: 645, label: 'The Making Bench' },
    { x: 280, y: 590 }, 390, 844, 0.78
  ), null);

  const right = projectQuestCompassIndicator(
    { x: 1400, y: 500, label: 'Moonshot Field' },
    { x: 700, y: 500 }, 390, 844, 0.78
  );
  assert.ok(right);
  assert.ok(Math.abs(right.x - 364) < 1e-9);
  assert.equal(right.y, 422);
  assert.equal(right.angle, 0);
  assert.equal(right.label, 'Moonshot Field');
  assert.ok(Object.isFrozen(right));

  const upperLeft = projectQuestCompassIndicator(
    { x: 0, y: 0, label: 'Evidence Archive' },
    { x: 800, y: 500 }, 390, 844, 0.78
  );
  assert.ok(upperLeft);
  assert.equal(upperLeft.x, 26);
  assert.ok(upperLeft.y >= 26 && upperLeft.y <= 818);
  assert.ok(upperLeft.angle < -Math.PI / 2);
});

test('quest compass rejects malformed viewport and hostile target accessors without reading them', () => {
  assert.equal(projectQuestCompassIndicator(
    { x: 1400, y: 500, label: 'Moonshot Field' }, { x: 700, y: 500 }, 390, 844, 0
  ), null);
  assert.equal(projectQuestCompassIndicator(
    { x: 1400, y: 500, label: 'Moonshot Field' }, { x: 700, y: 500 }, 40, 844, 0.78
  ), null);
  let reads = 0;
  const hostile = Object.defineProperty({}, 'x', {
    enumerable: true,
    get() { reads += 1; return 1400; }
  });
  assert.equal(projectQuestCompassIndicator(hostile, { x: 700, y: 500 }, 390, 844, 0.78), null);
  assert.equal(reads, 0);
});


test('Guild Hall NPCs are fixed, bounded guides with no model or canonical authority', () => {
  assert.deepEqual(
    GUILD_NPCS.map(({ roleId, name, objective }) => ({ id: roleId, name, objective })),
    projectCollaboratorPackets({ events: [], creations: [] })
      .map(({ id, name, objective }) => ({ id, name, objective }))
  );
  assert.equal(new Set(GUILD_NPCS.map(npc => npc.id)).size, GUILD_NPCS.length);
  assert.equal(new Set(GUILD_NPCS.map(npc => npc.roleId)).size, GUILD_NPCS.length);
  assert.ok(Object.isFrozen(GUILD_NPCS));
  for (const npc of GUILD_NPCS) {
    assert.ok(Object.isFrozen(npc));
    assert.equal(npc.routeLocation, 'guild_hall');
    assert.equal(npc.authority, 'advisory-only');
    assert.equal(npc.invokesModel, false);
    assert.equal(npc.mayWriteCanonicalState, false);
    assert.equal(npc.mayGrantAuthority, false);
    assert.equal(npc.mayAwardProgress, false);
    assert.equal(npc.mayCertifyTruthOrExecution, false);
    assert.ok(npc.x >= 0 && npc.x <= WORLD_WIDTH);
    assert.ok(npc.y >= 0 && npc.y <= WORLD_HEIGHT);
    assert.equal(isWalkable(npc.x, npc.y, []), true, npc.name + ' must stand on walkable terrain');
    assert.ok(findRoute({ x: 230, y: 220 }, { x: npc.x, y: npc.y + 12 }, []).length > 0,
      npc.name + ' must have a walkable route from Guild Hall');
  }
});

test('quest navigation routes to each Guild Hall NPC but does not auto-interact on arrival', () => {
  for (const npc of GUILD_NPCS) {
    const view = Object.create(PixelWorldView.prototype);
    view.player = { x: 230, y: 220 };
    view.world = { creations: [] };
    view.route = [];
    view.target = 'old-target';
    view.targetType = 'place';

    view.goTo(npc.id);

    assert.ok(view.route.length > 0, npc.name + ' should have a route');
    const destination = view.route[view.route.length - 1];
    assert.ok(Math.hypot(destination.x - npc.x, destination.y - (npc.y + 12)) < 32,
      npc.name + ' route should end beside the exact NPC');
    assert.equal(view.target, null, 'arrival requires an explicit interact action');
    assert.equal(view.targetType, null);
  }
});

test('speaking to a Guild Hall NPC routes to the existing collaborator workbench without mutating the world', () => {
  const world = {
    id: 'guild-npc-interaction-world',
    revision: 7,
    xp: 100,
    events: [],
    creations: [],
    drafts: []
  };
  const before = structuredClone(world);
  for (const npc of GUILD_NPCS) {
    let interaction = null;
    const view = Object.create(PixelWorldView.prototype);
    view.player = { x: npc.x, y: npc.y + 10 };
    view.world = world;
    view.researchObjects = [];
    view.researchActivityObjects = [];
    view.callbacks = {
      onInteract: value => { interaction = value; },
      onDiscover: () => { throw new Error('Guild NPC conversation is not a discovery event'); }
    };
    view.route = [];
    view.target = null;
    view.targetType = null;

    const nearest = view.nearest();
    assert.equal(nearest.type, 'npc');
    assert.equal(nearest.roleId, npc.roleId);
    assert.equal(nearest.distance, 0);

    view.interact();
    assert.deepEqual(interaction, {
      type: 'institution',
      id: 'guild_hall',
      npcRoleId: npc.roleId,
      npcName: npc.name
    });
    assert.deepEqual(world, before, 'conversation only opens the existing Guild Hall workbench');
  }
});

test('unregistered Guild Hall NPC targets fail closed without opening an institution', () => {
  let interactions = 0;
  const view = Object.create(PixelWorldView.prototype);
  view.player = { x: 200, y: 320 };
  view.world = { creations: [] };
  view.researchObjects = [];
  view.researchActivityObjects = [];
  view.callbacks = { onInteract: () => { interactions += 1; }, onDiscover: () => {} };
  view.route = [];
  view.target = null;
  view.targetType = null;

  assert.equal(view.nearest('guild-npc-not-registered', 'npc'), null);
  view.interact('guild-npc-not-registered', 'npc');
  assert.equal(interactions, 0);
});


function guildNpcResearchWorld() {
  const founder = { id: 'founder-1', role: 'founder' };
  const witness = { id: 'witness-1', role: 'witness' };
  return {
    id: 'guild-npc-readiness-world',
    revision: 3,
    creations: [],
    events: [
      {
        id: 'proposal-event-1', type: 'moonshot-proposed', moonshotId: 'moonshot-1',
        actor: founder, at: '2026-10-29T04:00:00.000Z',
        title: 'Bounded test', hypothesis: 'A claim holds under a stated condition.',
        falsifier: 'A repeatable counterexample',
        evidenceNeeded: 'An independently observed measurement',
        sourceCreationId: null, sourceVersion: null
      },
      {
        id: 'report-event-1', type: 'experiment-reported', reportId: 'report-1',
        moonshotId: 'moonshot-1', actor: witness, at: '2026-10-29T04:01:00.000Z',
        procedure: 'Run the stated procedure once.',
        observation: 'The expected result did not occur.',
        reportedOutcome: 'failed', evidenceCreationId: null, evidenceVersion: null
      },
      {
        id: 'challenge-event-1', type: 'experiment-challenged', challengeId: 'challenge-1',
        reportId: 'report-1', moonshotId: 'moonshot-1', actor: founder,
        at: '2026-10-29T04:02:00.000Z', challengeType: 'methodology',
        challengeText: 'The procedure omits a control.',
        evidenceCreationId: null, evidenceVersion: null
      }
    ]
  };
}

test('Guild Hall NPC packet readiness follows sealed source-bound collaborator packets without creating activity', () => {
  const emptyWorld = { id: 'empty-guild-world', revision: 0, events: [], creations: [] };
  const emptyBefore = structuredClone(emptyWorld);
  const empty = projectGuildNpcReadiness(emptyWorld);
  assert.deepEqual(empty.map(entry => ({
    roleId: entry.roleId, status: entry.status, label: entry.label,
    sourceSnapshotStatus: entry.sourceSnapshotStatus, inputCount: entry.inputCount
  })), GUILD_NPCS.map(npc => ({
    roleId: npc.roleId, status: 'unavailable', label: 'NO PACKET',
    sourceSnapshotStatus: 'identified', inputCount: 0
  })));
  assert.deepEqual(emptyWorld, emptyBefore);

  const world = guildNpcResearchWorld();
  const before = structuredClone(world);
  const ready = projectGuildNpcReadiness(world);
  assert.deepEqual(ready.map(entry => entry.roleId), ['archivist', 'adversary', 'synthesizer', 'tutor']);
  assert.ok(ready.every(entry => entry.status === 'ready' && entry.label === 'PACKET READY' &&
    entry.sourceSnapshotStatus === 'identified' && entry.inputCount > 0));
  assert.equal(ready.find(entry => entry.roleId === 'tutor').inputCount, 1);
  assert.ok(Object.isFrozen(ready));
  assert.ok(ready.every(entry => Object.isFrozen(entry)));
  assert.ok(ready.every(entry => !Object.hasOwn(entry, 'prompt') && !Object.hasOwn(entry, 'packetJson')),
    'the map exposes readiness only, never the collaborator prompt or packet contents');
  assert.deepEqual(world, before, 'readiness projection must not mutate retained events or progression');

  const partialWorld = guildNpcResearchWorld();
  delete partialWorld.id;
  delete partialWorld.revision;
  const partial = projectGuildNpcReadiness(partialWorld);
  assert.ok(partial.every(entry => entry.status === 'partial' &&
    entry.label === 'READY · PARTIAL' && entry.sourceSnapshotStatus === 'incomplete'),
    'available packets with incomplete snapshot identity remain visibly qualified');
});

test('Guild Hall NPC readiness fails closed on accessor-backed world snapshots', () => {
  let getterCalls = 0;
  const hostile = {};
  for (const key of ['id', 'revision', 'events', 'creations']) {
    Object.defineProperty(hostile, key, {
      enumerable: true,
      get() { getterCalls += 1; return key === 'events' || key === 'creations' ? [] : key === 'id' ? 'forged-world' : 1; }
    });
  }
  const readiness = projectGuildNpcReadiness(hostile);
  assert.equal(getterCalls, 0);
  assert.ok(readiness.every(entry => entry.status === 'unavailable' &&
    entry.sourceSnapshotStatus === 'incomplete'));
});

test('pixel map exposes bounded Guild Hall packet status in its accessible description and NPC labels', () => {
  const world = guildNpcResearchWorld();
  const before = structuredClone(world);
  const view = Object.create(PixelWorldView.prototype);
  view.world = world;
  view.guildNpcReadiness = projectGuildNpcReadiness(world);
  view.sourceObservationMapCounts = projectSourceObservationMapCounts(world);
  view.researchObjects = [];
  view.researchActivityObjects = [];
  view.questAction = null;
  view.questTarget = null;
  const attributes = {};
  view.canvas = {
    dataset: {},
    setAttribute(name, value) { attributes[name] = value; }
  };
  view.updateResearchAccessibility();

  assert.match(view.canvas.dataset.guildNpcPackets, /archivist=ready:3:0:identified/);
  assert.match(attributes['aria-label'], /Hostile Archivist:.*source-bound packet is available with 3 retained event references/);
  assert.match(attributes['aria-label'], /Polymath Tutor:.*source-bound packet is available with 1 retained event reference/);
  assert.match(attributes['aria-label'], /not autonomous AI agents/);

  const labels = [];
  view.ctx = { fillStyle: '', font: '', textAlign: '', fillRect() {}, fillText() {} };
  view.drawMapLabel = label => labels.push(label);
  view.drawGuildNpc(GUILD_NPCS.find(npc => npc.roleId === 'archivist'));
  assert.deepEqual(labels, ['ARCHIVIST', 'PACKET READY']);
  assert.deepEqual(world, before);
});
