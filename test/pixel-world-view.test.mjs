import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORLD_TILE_SIZE,
  classifyWorldTile,
  worldTileAt,
  PIXEL_SPRITES
} from '../game/pixel-world-view.mjs';
import { isWalkable } from '../game/world-view.mjs';
import { createHash } from 'node:crypto';
import { createWorld, applyAction } from '../game/model.mjs';
import { sourceObservationRequestMaterial } from '../game/research-records.mjs';
import { projectSourceObservationMapCounts } from '../game/pixel-world-view.mjs';

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
