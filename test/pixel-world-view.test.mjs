import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORLD_TILE_SIZE,
  classifyWorldTile,
  worldTileAt,
  PIXEL_SPRITES
} from '../game/pixel-world-view.mjs';
import { isWalkable, PLACES, WORLD_WIDTH, WORLD_HEIGHT } from '../game/world-view.mjs';
import { createHash } from 'node:crypto';
import { createWorld, applyAction } from '../game/model.mjs';
import { sourceObservationRequestMaterial } from '../game/research-records.mjs';
import {
  projectSourceObservationMapCounts,
  projectQuestMapTarget,
  projectMapLabelMetrics,
  projectQuestCompassIndicator
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
