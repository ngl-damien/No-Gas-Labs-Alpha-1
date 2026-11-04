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
  projectMapLabelPosition,
  projectQuestCompassIndicator,
  projectQuestCompassCaptionPosition,
  projectGuildNpcReadiness,
  projectGuildNpcPointerTarget,
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

test('Guild Hall guides use distinct role-specific pixel silhouettes', () => {
  const signatures = GUILD_NPCS.map(npc => {
    const rectangles = [];
    const view = Object.create(PixelWorldView.prototype);
    view.ctx = { fillStyle: '', fillRect: (...args) => rectangles.push(args) };
    view.guildNpcReadiness = [];
    view.text = () => {};
    view.drawMapLabel = () => {};
    view.drawGuildNpc(npc);
    return rectangles.slice(1).map(([x, y, width, height]) =>
      [x - npc.x, y - npc.y, width, height].join(',')
    ).join('|');
  });
  assert.equal(new Set(signatures).size, GUILD_NPCS.length,
    'each institutional role must have a different rendered pixel silhouette');
});

test('institution buildings have distinct silhouettes tied to their institutional functions', () => {
  const places = PLACES.filter(place => place.type === 'institution' && place.id !== 'town-square');
  assert.deepEqual(places.map(place => place.id), [
    'guild_hall', 'forge', 'evidence_archive', 'decision_chamber',
    'academy', 'moonshot_field', 'publication_house'
  ]);
  const signatures = places.map(place => {
    const rectangles = [];
    const view = Object.create(PixelWorldView.prototype);
    view.ctx = { fillStyle: '', fillRect: (...args) => rectangles.push(args) };
    view.text = () => {};
    view.drawMapLabel = () => {};
    view.institutionCounts = {};
    view.drawInstitution(place);
    assert.ok(rectangles.length > 14, place.id + ' must draw its function-specific features');
    return rectangles.map(([x, y, width, height]) =>
      [x, y, width, height].join(',')
    ).join('|');
  });
  assert.equal(new Set(signatures).size, places.length,
    'institution landmarks must not be recolored copies of one generic building');
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
  for (const npc of GUILD_NPCS) {
    assert.deepEqual(
      projectQuestMapTarget({ type: 'location', id: npc.id }, { creations: [] }),
      { kind: 'npc', id: npc.id, x: npc.x, y: npc.y + 10, label: npc.name },
      'the retained Guild quest action must resolve to its exact institutional NPC'
    );
  }
  assert.equal(projectQuestMapTarget({ type: 'location', id: 'guild-npc-unknown' }, { creations: [] }), null);
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

test('map label placement clamps visible panels and hides fully off-screen labels', () => {
  const camera = { x: 0, y: 0 };
  const inside = projectMapLabelPosition(0, 0, 320, 240, camera, 1, 100, 21);
  assert.deepEqual(inside, { x: 0, y: 0 });

  const left = projectMapLabelPosition(-140, 0, 320, 240, camera, 1, 100, 21);
  assert.ok(left);
  assert.equal(160 + left.x - 50, 8, 'left panel edge stays inside the viewport margin');

  const right = projectMapLabelPosition(140, 0, 320, 240, camera, 1, 100, 21);
  assert.ok(right);
  assert.equal(160 + right.x + 50, 312, 'right panel edge stays inside the viewport margin');

  const top = projectMapLabelPosition(0, -110, 320, 240, camera, 1, 100, 21);
  assert.ok(top);
  assert.equal(120 + top.y - 21, 8, 'top panel edge stays inside the viewport margin');

  const bottom = projectMapLabelPosition(0, 130, 320, 240, camera, 1, 100, 21);
  assert.ok(bottom);
  assert.equal(120 + bottom.y, 232, 'bottom panel edge stays inside the viewport margin');

  assert.equal(projectMapLabelPosition(-300, 0, 320, 240, camera, 1, 100, 21), null,
    'a wholly off-screen object must not be pulled into view by its label');
  assert.equal(projectMapLabelPosition(0, -300, 320, 240, camera, 1, 100, 21), null);
  assert.equal(projectMapLabelPosition(0, 0, 40, 240, camera, 1, 100, 21), null);
  assert.equal(projectMapLabelPosition(0, 0, 320, 240, camera, 1, 305, 21), null);
  assert.ok(Object.isFrozen(left));

  let reads = 0;
  const hostileCamera = Object.defineProperty({}, 'x', {
    enumerable: true,
    get() { reads += 1; return 0; }
  });
  assert.equal(projectMapLabelPosition(0, 0, 320, 240, hostileCamera, 1, 100, 21), null);
  assert.equal(reads, 0);
});

test('map labels move around reserved HUD panels and fail closed on unsafe obstacle geometry', () => {
  const camera = { x: 0, y: 0 };
  const overlay = { left: 100, top: 90, right: 220, bottom: 115 };
  const moved = projectMapLabelPosition(0, 0, 320, 240, camera, 1, 80, 20, 8, [overlay]);
  assert.ok(moved);
  const rect = {
    left: 160 + moved.x - 40,
    top: 120 + moved.y - 20,
    right: 160 + moved.x + 40,
    bottom: 120 + moved.y
  };
  assert.equal(rect.top, 124, 'the preferred panel moves below the quest-card obstruction');
  assert.ok(rect.top >= overlay.bottom + 4 || rect.bottom <= overlay.top - 4 ||
    rect.left >= overlay.right + 4 || rect.right <= overlay.left - 4);

  assert.equal(projectMapLabelPosition(
    0, 0, 320, 240, camera, 1, 80, 20, 8,
    [{ left: 0, top: 0, right: 320, bottom: 240 }]
  ), null, 'a panel is suppressed when every safe placement is obscured');

  let reads = 0;
  const hostile = Object.defineProperty({}, 'left', {
    enumerable: true,
    get() { reads += 1; return 100; }
  });
  assert.equal(projectMapLabelPosition(0, 0, 320, 240, camera, 1, 80, 20, 8, [hostile]), null);
  assert.equal(reads, 0, 'untrusted overlay accessors are never invoked');
});

test('map renderer measures visible HUD overlays relative to its canvas', () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const selectors = [];
  const elements = [
    { getBoundingClientRect: () => ({ left: 30, top: 40, right: 200, bottom: 160 }) },
    { getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0 }) },
    { getBoundingClientRect: () => ({ left: 500, top: 30, right: 600, bottom: 90 }) }
  ];
  globalThis.document = {
    querySelectorAll(selector) {
      selectors.push(selector);
      return elements;
    }
  };
  const view = Object.create(PixelWorldView.prototype);
  view.canvas = { getBoundingClientRect: () => ({ left: 10, top: 20 }) };
  view.width = 390;
  view.height = 844;
  try {
    const overlays = view.measureMapOverlayRects();
    assert.deepEqual(overlays, [{ left: 20, top: 20, right: 190, bottom: 140 }]);
    assert.ok(Object.isFrozen(overlays));
    assert.ok(Object.isFrozen(overlays[0]));
    assert.match(selectors[0], /#quest-card/);
    assert.match(selectors[0], /\.world-tools/);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  }
});

test('map overlay cache refreshes when the playable UI becomes visible', () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let hidden = true;
  const selectors = [];
  const view = Object.create(PixelWorldView.prototype);
  view.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  view.width = 320;
  view.height = 240;
  view.mapOverlayVisibility = false;
  view.mapOverlayRects = [];
  globalThis.document = {
    getElementById(id) {
      assert.equal(id, 'play-ui');
      return { hidden };
    },
    querySelectorAll(selector) {
      selectors.push(selector);
      return [{
        getBoundingClientRect: () => hidden
          ? ({ left: 0, top: 0, right: 0, bottom: 0 })
          : ({ left: 20, top: 30, right: 150, bottom: 100 })
      }];
    }
  };
  try {
    view.refreshMapOverlayRectsIfNeeded();
    assert.deepEqual(view.mapOverlayRects, [], 'hidden play UI contributes no obstruction');
    hidden = false;
    view.refreshMapOverlayRectsIfNeeded();
    assert.deepEqual(view.mapOverlayRects, [{ left: 20, top: 30, right: 150, bottom: 100 }]);
    assert.equal(view.mapOverlayVisibility, true);
    assert.match(selectors.at(-1), /#quest-card/);
    assert.ok(Object.isFrozen(view.mapOverlayRects));
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  }
});

test('map overlay cache refreshes after layout mutations without per-frame measurement', () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousMutationObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
  let rect = { left: 20, top: 30, right: 150, bottom: 100 };
  let queryCount = 0;
  const observed = [];
  const body = {};
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.target = null;
      this.options = null;
      this.disconnectCalls = 0;
    }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnectCalls += 1; }
    trigger() { this.callback([]); }
  }
  globalThis.MutationObserver = FakeMutationObserver;
  globalThis.document = {
    body,
    getElementById(id) {
      assert.equal(id, 'play-ui');
      return { hidden: false };
    },
    querySelectorAll(selector) {
      queryCount += 1;
      assert.match(selector, /#quest-card/);
      assert.match(selector, /\.masthead/);
      return [{ getBoundingClientRect: () => rect }];
    }
  };
  const view = Object.create(PixelWorldView.prototype);
  view.canvas = { getBoundingClientRect: () => ({ left: 10, top: 20 }) };
  view.width = 320;
  view.height = 240;
  view.mapOverlayVisibility = true;
  view.mapOverlayRects = [];
  view.mapOverlayRectsDirty = false;
  view.resizeObserver = { observe: element => observed.push(element) };

  try {
    view.observeMapOverlays();
    const observer = view.mapOverlayMutationObserver;
    assert.ok(observer instanceof FakeMutationObserver);
    assert.equal(observer.target, body);
    assert.deepEqual(observer.options, {
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-expanded'],
      childList: true,
      characterData: true,
      subtree: true
    });
    assert.deepEqual(view.mapOverlayRects, [{ left: 10, top: 10, right: 140, bottom: 80 }]);
    const initialQueries = queryCount;
    const initialObservations = observed.length;

    rect = { left: 40, top: 50, right: 160, bottom: 120 };
    observer.trigger();
    assert.equal(view.mapOverlayRectsDirty, true);
    assert.equal(queryCount, initialQueries,
      'the mutation callback invalidates geometry without synchronously reading layout');
    assert.deepEqual(view.mapOverlayRects, [{ left: 10, top: 10, right: 140, bottom: 80 }],
      'the cached geometry remains stable until the next render');

    view.refreshMapOverlayRectsIfNeeded();
    assert.deepEqual(view.mapOverlayRects, [{ left: 30, top: 30, right: 150, bottom: 100 }]);
    assert.equal(view.mapOverlayRectsDirty, false);
    assert.equal(observed.length, initialObservations + 1,
      'a dirty pass also observes newly-added overlay elements for later resizes');

    const refreshedQueries = queryCount;
    view.refreshMapOverlayRectsIfNeeded();
    view.refreshMapOverlayRectsIfNeeded();
    assert.equal(queryCount, refreshedQueries, 'stable frames reuse cached overlay geometry');
  } finally {
    view.mapOverlayMutationObserver?.disconnect?.();
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
    if (previousMutationObserver) Object.defineProperty(globalThis, 'MutationObserver', previousMutationObserver);
    else delete globalThis.MutationObserver;
  }
});

test('destroy disconnects the map-overlay mutation observer', () => {
  const previousCancelAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
  const previousRemoveEventListener = Object.getOwnPropertyDescriptor(globalThis, 'removeEventListener');
  let mutationDisconnects = 0;
  let resizeDisconnects = 0;
  let pointerRemovals = 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.removeEventListener = () => {};
  const view = Object.create(PixelWorldView.prototype);
  view.npcControlGroup = { remove() {} };
  view.npcControlButtons = new Map();
  view.mapOverlayMutationObserver = { disconnect() { mutationDisconnects += 1; } };
  view.canvas = { removeEventListener() { pointerRemovals += 1; } };
  view.onPointer = () => {};
  view.animation = 1;
  view.resizeObserver = { disconnect() { resizeDisconnects += 1; } };

  try {
    view.destroy();
    assert.equal(mutationDisconnects, 1);
    assert.equal(view.mapOverlayMutationObserver, null);
    assert.equal(resizeDisconnects, 1);
    assert.equal(pointerRemovals, 1);
    assert.equal(view.destroyed, true);
  } finally {
    if (previousCancelAnimationFrame) Object.defineProperty(globalThis, 'cancelAnimationFrame', previousCancelAnimationFrame);
    else delete globalThis.cancelAnimationFrame;
    if (previousRemoveEventListener) Object.defineProperty(globalThis, 'removeEventListener', previousRemoveEventListener);
    else delete globalThis.removeEventListener;
  }
});

test('drawMapLabel reserves earlier panels so stacked institutional labels do not collide', () => {
  const calls = [];
  const view = Object.create(PixelWorldView.prototype);
  view.width = 320;
  view.height = 240;
  view.zoom = 1;
  view.camera = { x: 0, y: 0 };
  view.mapAvoidRects = [];
  view.ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    textAlign: 'center',
    measureText: value => ({ width: Array.from(value).length * 6 }),
    fillRect: (...args) => calls.push({ type: 'fill', args }),
    strokeRect: (...args) => calls.push({ type: 'stroke', args })
  };
  view.text = (value, x, y) => calls.push({ type: 'text', value, x, y });

  view.drawMapLabel('FIRST LABEL', 0, 0, 11);
  view.drawMapLabel('SECOND LABEL', 0, 0, 11);
  assert.equal(view.mapAvoidRects.length, 2);
  const [first, second] = view.mapAvoidRects;
  assert.ok(first.bottom + 4 <= second.top || second.bottom + 4 <= first.top ||
    first.right + 4 <= second.left || second.right + 4 <= first.left);
  assert.equal(calls.filter(call => call.type === 'fill').length, 2);
});

test('drawMapLabel clamps a partially visible panel and omits a wholly off-screen panel', () => {
  const calls = [];
  const view = Object.create(PixelWorldView.prototype);
  view.width = 320;
  view.height = 240;
  view.zoom = 1;
  view.camera = { x: 0, y: 0 };
  view.ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    textAlign: 'center',
    measureText: value => ({ width: Array.from(value).length * 6 }),
    fillRect: (...args) => calls.push({ type: 'fill', args }),
    strokeRect: (...args) => calls.push({ type: 'stroke', args })
  };
  view.text = (value, x, y) => calls.push({ type: 'text', value, x, y });

  view.drawMapLabel('LEFT EDGE', -140, 120, 11);
  const panel = calls.find(call => call.type === 'fill').args;
  assert.ok(160 + panel[0] >= 8 - 1);
  assert.ok(160 + panel[0] + panel[2] <= 312 + 1);
  assert.ok(120 + panel[1] >= 8 - 1);

  const before = calls.length;
  view.drawMapLabel('OFFSCREEN', -400, 120, 11);
  assert.equal(calls.length, before);
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

test('quest compass relocates off-screen arrows and captions around the mobile quest card', () => {
  const questCard = Object.freeze({ left: 15, top: 88, right: 200, bottom: 420 });
  const indicator = projectQuestCompassIndicator(
    { x: 0, y: 300, label: 'The Relay' },
    { x: 500, y: 500 },
    390, 844, 0.78, 26, [questCard]
  );
  assert.ok(indicator);
  assert.equal(indicator.x, 26);
  assert.equal(indicator.y, 442);
  assert.equal(indicator.occluded, undefined);
  assert.ok(Object.isFrozen(indicator));
  assert.ok(indicator.y - 16 >= questCard.bottom + 4);

  const caption = projectQuestCompassCaptionPosition(
    indicator.x, indicator.y, 390, 844, 120, 24, [questCard], 8
  );
  assert.deepEqual(caption, { left: 8, top: 462, width: 120, height: 24 });
  assert.ok(Object.isFrozen(caption));
  assert.ok(caption.top >= questCard.bottom + 4);
});

test('quest compass caption rejects unsafe rectangles and undersized viewports', () => {
  assert.equal(projectQuestCompassCaptionPosition(26, 442, 390, 844, 120, 24, null), null);
  assert.equal(projectQuestCompassCaptionPosition(26, 442, 64, 64, 120, 24), null);
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


test('institutional NPCs occupy their service locations and retain bounded advisory authority', () => {
  assert.deepEqual(
    GUILD_NPCS.map(({ roleId, name, objective }) => ({ id: roleId, name, objective })),
    projectCollaboratorPackets({ events: [], creations: [] })
      .map(({ id, name, objective }) => ({ id, name, objective }))
  );
  assert.equal(new Set(GUILD_NPCS.map(npc => npc.id)).size, GUILD_NPCS.length);
  assert.equal(new Set(GUILD_NPCS.map(npc => npc.roleId)).size, GUILD_NPCS.length);
  assert.ok(Object.isFrozen(GUILD_NPCS));
  const serviceLocations = {
    archivist: 'evidence_archive',
    adversary: 'evidence_archive',
    synthesizer: 'guild_hall',
    tutor: 'academy'
  };
  const buildingBounds = {
    evidence_archive: { left: 948, right: 1032, top: 86, bottom: 190 },
    guild_hall: { left: 182, right: 278, top: 92, bottom: 190 },
    academy: { left: 138, right: 222, top: 306, bottom: 450 }
  };
  for (const npc of GUILD_NPCS) {
    assert.ok(Object.isFrozen(npc));
    assert.equal(npc.routeLocation, serviceLocations[npc.roleId]);
    const place = PLACES.find(candidate => candidate.id === npc.routeLocation);
    assert.ok(place && place.type === 'institution', npc.name + ' must be assigned to a real institution');
    assert.equal(npc.locationLabel, place.name.toUpperCase());
    assert.ok(Math.hypot(place.x - npc.x, place.y - npc.y) >= 45 &&
      Math.hypot(place.x - npc.x, place.y - npc.y) <= 125,
    npc.name + ' must stand near the institution it serves');
    const bounds = buildingBounds[npc.routeLocation];
    const sprite = { left: npc.x - 24, right: npc.x + 24, top: npc.y - 20, bottom: npc.y + 20 };
    assert.ok(sprite.right <= bounds.left || sprite.left >= bounds.right ||
      sprite.bottom <= bounds.top || sprite.top >= bounds.bottom,
    npc.name + ' sprite must not be hidden inside its institution building');
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
      npc.name + ' must have a walkable route from the shared-world spawn');
  }
});

test('quest navigation routes to each institutional NPC but does not auto-interact on arrival', () => {
  for (const npc of GUILD_NPCS) {
    const view = Object.create(PixelWorldView.prototype);
    view.player = { x: 230, y: 220 };
    view.world = { creations: [] };
    view.route = [];
    view.target = 'old-target';
    view.targetType = 'place';

    const target = projectQuestMapTarget({ type: 'location', id: npc.id }, view.world);
    assert.ok(target, npc.name + ' should resolve from the retained quest action');
    view.goTo(target.id, target.kind);

    assert.ok(view.route.length > 0, npc.name + ' should have a route');
    const destination = view.route[view.route.length - 1];
    assert.ok(Math.hypot(destination.x - npc.x, destination.y - (npc.y + 12)) < 32,
      npc.name + ' route should end beside the exact NPC');
    assert.equal(view.target, null, 'arrival requires an explicit interact action');
    assert.equal(view.targetType, null);
  }
});

test('speaking to an institutional NPC opens its owning institution without mutating the world', () => {
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
      id: npc.routeLocation,
      npcRoleId: npc.roleId,
      npcName: npc.name
    });
    assert.deepEqual(world, before, 'conversation opens the owning institution without recording a world event');
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


test('touch pointer projection resolves each exact NPC sprite and rejects malformed coordinates', () => {
  const width = 390, height = 844, zoom = 0.78;
  for (const npc of GUILD_NPCS) {
    const target = projectGuildNpcPointerTarget(
      { x: width / 2, y: height / 2 },
      { x: npc.x, y: npc.y + 10 },
      zoom, width, height
    );
    assert.deepEqual(target, {
      id: npc.id, roleId: npc.roleId, name: npc.name, routeLocation: npc.routeLocation
    });
    assert.ok(Object.isFrozen(target));
  }
  assert.equal(projectGuildNpcPointerTarget({ x: -1, y: 422 }, { x: 0, y: 0 }, 1, width, height), null);
  assert.equal(projectGuildNpcPointerTarget({ x: 195, y: 422 }, { x: 0, y: 0 }, 0, width, height), null);
  assert.equal(projectGuildNpcPointerTarget(
    { x: width / 2 + 1, y: height / 2 }, { x: Number.MAX_VALUE, y: 0 },
    Number.MIN_VALUE, width, height
  ), null);

  let getterCalls = 0;
  const hostilePoint = Object.defineProperty({}, 'x', {
    get() { getterCalls += 1; return width / 2; }
  });
  assert.equal(projectGuildNpcPointerTarget(hostilePoint, { x: 0, y: 0 }, 1, width, height), null);
  assert.equal(getterCalls, 0, 'pointer projections must not invoke accessor-backed coordinates');
});

test('touching a distant NPC routes toward it, then a second tap opens its owning institution', () => {
  const savedGlobals = new Map();
  const globalNames = [
    'addEventListener', 'removeEventListener', 'requestAnimationFrame',
    'cancelAnimationFrame', 'ResizeObserver', 'devicePixelRatio'
  ];
  for (const name of globalNames) savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));

  const restoreGlobals = () => {
    for (const name of globalNames) {
      const descriptor = savedGlobals.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };

  try {
    globalThis.addEventListener = () => {};
    globalThis.removeEventListener = () => {};
    let animationId = 0;
    globalThis.requestAnimationFrame = () => ++animationId;
    globalThis.cancelAnimationFrame = () => {};
    globalThis.ResizeObserver = class {
      constructor(callback) { this.callback = callback; }
      observe() {}
      disconnect() {}
    };
    globalThis.devicePixelRatio = 1;

    const listeners = new Map();
    const attributes = {};
    let focusCalls = 0, prevented = 0, interaction = null;
    const canvas = {
      dataset: {},
      style: {},
      width: 0,
      height: 0,
      getContext: () => ({}),
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 390, height: 844 }),
      addEventListener(type, handler) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(handler);
      },
      removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
      focus() { focusCalls += 1; },
      setAttribute(name, value) { attributes[name] = value; },
      removeAttribute(name) { delete attributes[name]; }
    };
    const view = new PixelWorldView(canvas, { onInteract: value => { interaction = value; } });
    try {
      const pointerHandlers = listeners.get('pointerdown');
      assert.equal(pointerHandlers?.size, 1, 'the pixel renderer replaces, rather than stacks on, the ground-only pointer handler');
      assert.ok(pointerHandlers.has(view.onPointer));

      const npc = GUILD_NPCS.find(candidate => candidate.roleId === 'archivist');
      view.camera = { x: npc.x, y: npc.y + 10 };
      view.player = { x: 230, y: 220 };
      const event = {
        clientX: 205,
        clientY: 442,
        preventDefault() { prevented += 1; }
      };
      const pointerDown = [...pointerHandlers][0];
      const worldBefore = structuredClone(view.world);

      pointerDown(event);
      assert.ok(view.route.length > 0, 'a distant NPC tap should route the player toward the exact NPC');
      assert.equal(view.target, null, 'arrival still requires an explicit second interaction');
      assert.equal(interaction, null, 'approach is not a conversation or canonical event');
      assert.equal(focusCalls, 1);

      view.player = { x: npc.x, y: npc.y + 10 };
      view.route = [];
      pointerDown(event);
      assert.deepEqual(interaction, {
        type: 'institution',
        id: npc.routeLocation,
        npcRoleId: npc.roleId,
        npcName: npc.name
      });
      assert.equal(focusCalls, 1, 'opening the institution must not have canvas focus stolen from its sheet');
      assert.equal(prevented, 2);

      interaction = null;
      view.player = { x: npc.x + 160, y: npc.y + 10 };
      view.route = [];
      pointerDown(event);
      assert.equal(interaction, null, 'the existing NPC interaction contract is exclusive: exactly 160 units remains approach-only');
      assert.equal(prevented, 3);
      assert.deepEqual(view.world, worldBefore, 'approach and conversation leave revision, events, XP, and world state unchanged');
    } finally {
      view.destroy();
      assert.equal(listeners.get('pointerdown')?.size, 0, 'destroy removes the touch-aware pointer handler');
    }
  } finally {
    restoreGlobals();
  }
});

test('accessible world-collaborator controls expose bounded approach/talk actions without changing canonical state', () => {
  const savedGlobals = new Map();
  const globalNames = [
    'document', 'addEventListener', 'removeEventListener', 'requestAnimationFrame',
    'cancelAnimationFrame', 'ResizeObserver', 'devicePixelRatio'
  ];
  for (const name of globalNames) savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));

  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.listeners = new Map();
      this.attributes = {};
      this.dataset = {};
      this.style = {};
      this.hidden = false;
      this.disabled = false;
      this.parentNode = null;
      this._textContent = '';
      this.textContentWrites = 0;
      this.attributeWrites = 0;
      this.classList = { contains: () => false };
    }
    get textContent() { return this._textContent; }
    set textContent(value) {
      const next = String(value);
      if (this._textContent !== next) { this._textContent = next; this.textContentWrites += 1; }
    }
    setAttribute(name, value) {
      const next = String(value);
      if (this.attributes[name] !== next) { this.attributes[name] = next; this.attributeWrites += 1; }
    }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(handler);
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      this.parentNode = null;
    }
    contains(target) { return target === this || this.children.some(child => child.contains(target)); }
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0 }; }
    dispatch(type, event = {}) {
      for (const handler of this.listeners.get(type) || []) handler({
        preventDefault() {}, stopPropagation() {}, ...event, target: this
      });
    }
  }

  const body = new FakeElement('body');
  const playUi = { hidden: true };
  const document = {
    body,
    createElement: tagName => new FakeElement(tagName),
    getElementById: id => id === 'play-ui' ? playUi : null,
    querySelectorAll: () => body.children
  };

  try {
    globalThis.document = document;
    globalThis.addEventListener = () => {};
    globalThis.removeEventListener = () => {};
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.devicePixelRatio = 1;

    const listeners = new Map();
    const attributes = {};
    let interaction = null;
    const canvas = {
      dataset: {},
      style: {},
      width: 0,
      height: 0,
      getContext: () => ({}),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }),
      addEventListener(type, handler) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(handler);
      },
      removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
      focus() {},
      setAttribute(name, value) { attributes[name] = value; },
      removeAttribute(name) { delete attributes[name]; }
    };
    const view = new PixelWorldView(canvas, { onInteract: value => { interaction = value; } });
    try {
      const group = view.npcControlGroup;
      assert.ok(group, 'the renderer should install an accessible collaborator group');
      assert.equal(group.attributes.role, 'group');
      assert.equal(group.attributes['aria-label'], 'World collaborators');
      assert.equal(group.children.length, GUILD_NPCS.length);
      assert.equal(group.className, 'ngl-world-collaborator-controls');
      assert.equal(group.hidden, true, 'NPC controls are unavailable before the playable world is entered');

      for (const roleNpc of GUILD_NPCS) {
        const roleButton = view.npcControlButtons.get(roleNpc.roleId);
        assert.ok(roleButton, 'each bounded role needs a control');
        assert.equal(roleButton.dataset.guildNpcControl, roleNpc.roleId);
        assert.ok(Number.parseFloat(roleButton.style.minWidth) >= 44);
        assert.ok(Number.parseFloat(roleButton.style.minHeight) >= 44);
        assert.ok(roleButton.attributes['aria-label'].includes(roleNpc.name));
        assert.ok(roleButton.attributes['aria-label'].includes(roleNpc.objective));
        assert.equal(roleButton.disabled, true, 'controls stay disabled while the entry screen is active');
      }

      playUi.hidden = false;
      view.refreshMapOverlayRectsIfNeeded();
      view.player = { x: 230, y: 220 };
      view.updateNpcControls(false);
      assert.equal(group.hidden, false, 'entering the playable world enables collaborator navigation');

      const worldBefore = structuredClone(view.world);
      for (const npc of GUILD_NPCS) {
        const button = view.npcControlButtons.get(npc.roleId);
        const distance = Math.hypot(npc.x - view.player.x, npc.y + 10 - view.player.y);
        if (distance >= 160) {
          assert.equal(button.dataset.guildNpcAction, 'approach');
          assert.match(button.attributes['aria-label'], /^Approach /);
          button.dispatch('click');
          assert.ok(view.route.length > 0, 'the accessible action should route toward the exact distant NPC');
          assert.equal(interaction, null, 'approach is not an interaction or canonical event');
          view.player = { x: npc.x, y: npc.y + 10 };
          view.route = [];
          view.target = null;
          view.updateNpcControls(false);
        }
        assert.equal(button.dataset.guildNpcAction, 'talk');
        assert.match(button.attributes['aria-label'], /^Talk to /);
        button.dispatch('click');
        assert.deepEqual(interaction, {
          type: 'institution', id: npc.routeLocation,
          npcRoleId: npc.roleId, npcName: npc.name
        });
        interaction = null;
        view.player = { x: 230, y: 220 };
        view.route = [];
        view.target = null;
        view.updateNpcControls(false);
      }
      assert.deepEqual(view.world, worldBefore, 'approach and talk leave the retained world unchanged');
      const stableWrites = new Map(GUILD_NPCS.map(roleNpc => {
        const roleButton = view.npcControlButtons.get(roleNpc.roleId);
        return [roleNpc.roleId, { text: roleButton.textContentWrites, attributes: roleButton.attributeWrites }];
      }));
      view.updateNpcControls(false);
      for (const roleNpc of GUILD_NPCS) {
        const roleButton = view.npcControlButtons.get(roleNpc.roleId);
        const before = stableWrites.get(roleNpc.roleId);
        assert.equal(roleButton.textContentWrites, before.text, 'stable frames do not rewrite NPC button text');
        assert.equal(roleButton.attributeWrites, before.attributes, 'stable frames do not rewrite NPC accessibility labels');
      }

      const archivistButton = view.npcControlButtons.get('archivist');
      group.dispatch('focusin');
      assert.equal(view.npcControlsVisible, true);
      assert.equal(group.style.clipPath, 'none', 'keyboard focus reveals the accessible control group');
      const outside = new FakeElement('main');
      group.dispatch('focusout', { relatedTarget: outside });
      assert.equal(view.npcControlsVisible, false);
      assert.equal(group.style.clipPath, 'inset(50%)', 'leaving the group returns it to the visually-hidden state');

      view.updateNpcControls(true);
      assert.equal(group.hidden, true, 'modal sheets suppress the out-of-modal collaborator controls');
      assert.equal(archivistButton.disabled, true);
      view.updateNpcControls(false);
      assert.equal(group.hidden, false);
      assert.equal(archivistButton.disabled, false);

      playUi.hidden = true;
      view.refreshMapOverlayRectsIfNeeded();
      view.updateNpcControls(false);
      assert.equal(group.hidden, true, 'leaving the playable world hides the collaborator controls again');
      assert.equal(archivistButton.disabled, true);
    } finally {
      view.destroy();
      assert.equal(body.children.length, 0, 'destroy removes the auxiliary accessibility controls');
      assert.equal(listeners.get('pointerdown')?.size, 0);
    }
  } finally {
    for (const name of globalNames) {
      const descriptor = savedGlobals.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test('ordinary ground taps continue through the inherited movement handler', () => {
  const npc = GUILD_NPCS[0];
  const view = Object.create(PixelWorldView.prototype);
  view.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  view.camera = { x: npc.x, y: npc.y + 10 };
  view.zoom = 1;
  view.width = 390;
  view.height = 844;
  let fallbackCalls = 0;
  view.handlePointer({ clientX: 0, clientY: 0 }, () => { fallbackCalls += 1; });
  assert.equal(fallbackCalls, 1);
});

test('nearby NPC prompts are touch-first, accessible, and packet state is proximity-scoped', () => {
  const npc = GUILD_NPCS.find(candidate => candidate.roleId === 'archivist');
  const renderProbe = (width, distance, modalOpen = false) => {
    const labels = [];
    const attributes = {};
    const canvas = {
      dataset: {},
      setAttribute(name, value) { attributes[name] = value; },
      removeAttribute(name) { delete attributes[name]; }
    };
    const context = new Proxy({
      measureText: value => ({ width: String(value).length * 6 })
    }, {
      get(target, key) { return key in target ? target[key] : () => {}; },
      set(target, key, value) { target[key] = value; return true; }
    });
    const view = Object.create(PixelWorldView.prototype);
    Object.assign(view, {
      ctx: context, canvas, width, height: 844, dpr: 1,
      camera: { x: 0, y: 0 }, zoom: 1, route: [],
      world: { creations: [] }, researchObjects: [], researchActivityObjects: [],
      presence: [], player: { id: 'render-probe', x: 100, y: 100 },
      time: 0, moving: false, reduced: true,
      guildNpcReadiness: [{ roleId: npc.roleId, status: 'ready' }]
    });
    for (const method of [
      'drawLandscape', 'drawPlace', 'drawInstitution', 'drawWorkbench', 'drawBuilding',
      'drawMoonshotObject', 'drawResearchActivityObject', 'drawGuildNpc', 'drawPlayer',
      'drawQuestTarget', 'drawQuestCompass'
    ]) view[method] = () => {};
    view.nearest = () => ({ ...npc, type: 'npc', distance });
    view.text = value => labels.push(value);

    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    globalThis.document = { body: { classList: { contains: () => modalOpen } } };
    try { view.render(); }
    finally {
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
      else delete globalThis.document;
    }
    return { labels, dataset: canvas.dataset, attributes };
  };

  const phone = renderProbe(390, 120);
  assert.ok(phone.labels.includes('TAP · TALK · ' + npc.shortName));
  assert.equal(phone.dataset.nearbyNpcRole, npc.roleId);
  assert.equal(phone.dataset.nearbyNpcPacketState, 'ready');
  assert.match(phone.attributes['aria-description'], /tap the character to talk/i);
  assert.match(phone.attributes['aria-description'], /advisory only/i);

  const desktop = renderProbe(1440, 120);
  assert.ok(desktop.labels.includes('E · TALK · ' + npc.shortName));

  const boundary = renderProbe(390, 160);
  assert.equal(boundary.dataset.nearbyNpcRole, 'none');
  assert.equal(boundary.dataset.nearbyNpcPacketState, 'none');
  assert.equal(boundary.attributes['aria-description'], undefined);
  assert.equal(boundary.labels.length, 0);

  const distant = renderProbe(390, 161);
  assert.equal(distant.dataset.nearbyNpcRole, 'none');
  assert.equal(distant.dataset.nearbyNpcPacketState, 'none');
  assert.equal(distant.attributes['aria-description'], undefined);
  assert.equal(distant.labels.length, 0);

  const modal = renderProbe(390, 120, true);
  assert.equal(modal.dataset.nearbyNpcRole, 'none');
  assert.equal(modal.dataset.nearbyNpcPacketState, 'none');
  assert.equal(modal.attributes['aria-description'], undefined);
  assert.equal(modal.labels.length, 0);
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

test('pixel map exposes bounded collaborator status and owning institutions accessibly', () => {
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
  assert.equal(view.canvas.dataset.guildNpcLocations,
    'archivist=evidence_archive;adversary=evidence_archive;synthesizer=guild_hall;tutor=academy');
  assert.match(attributes['aria-label'], /Hostile Archivist at EVIDENCE ARCHIVE:.*source-bound packet is available with 3 retained event references/);
  assert.match(attributes['aria-label'], /Polymath Tutor at POLYMATH ACADEMY:.*source-bound packet is available with 1 retained event reference/);
  assert.match(attributes['aria-label'], /not autonomous AI agents/);

  const labels = [];
  view.ctx = { fillStyle: '', font: '', textAlign: '', fillRect() {}, fillText() {} };
  view.drawMapLabel = label => labels.push(label);
  view.drawGuildNpc(GUILD_NPCS.find(npc => npc.roleId === 'archivist'));
  assert.deepEqual(labels, ['ARCHIVIST', 'PACKET READY']);
  assert.deepEqual(world, before);
});
