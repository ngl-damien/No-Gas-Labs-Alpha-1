import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORLD_TILE_SIZE,
  classifyWorldTile,
  worldTileAt,
  PIXEL_SPRITES
} from '../game/pixel-world-view.mjs';
import { isWalkable } from '../game/world-view.mjs';

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
