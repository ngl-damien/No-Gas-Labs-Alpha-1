import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as sharedSnapshot from '../game/shared-snapshot.mjs';
import { createWorld, publicWorld } from '../game/model.mjs';
import {
  createSharedSnapshotEnvelope,
  parseSharedSnapshotEnvelope,
  readSharedPositionCache,
  readSharedSnapshotCache,
  writeSharedPositionCache,
  writeSharedSnapshotCache,
  SHARED_POSITION_CACHE_KEY,
  MAX_SHARED_SNAPSHOT_CACHE_BYTES
} from '../game/shared-snapshot.mjs';

const now = '2026-11-21T21:00:00.000Z';
const founder = { id: 'damien', name: 'Damien', role: 'founder', position: { x: 180, y: 640 },
  presenceId: 'session-only-presence-id', positionEpoch: '123e4567-e89b-42d3-a456-426614174000',
  positionRevision: 9 };
function fixture(role = 'founder') {
  const world = createWorld({ id: 'offline-snapshot-world', now });
  world.revision = 4;
  world.events = [
    { id: 'draft-event', type: 'draft', actor: founder, at: now, semantics: 'private draft' },
    { id: 'repair-event', type: 'repair', actor: founder, at: now, semantics: 'private repair' },
    { id: 'report-event', type: 'message-reported', actor: founder, at: now, semantics: 'private report' },
    { id: 'contribution-event', type: 'contribute', actor: { id: 'witness-1', role: 'witness' }, at: now, semantics: 'public contribution' }
  ];
  world.drafts = [{ id: 'private-draft', title: 'Do not cache' }];
  const viewer = { ...founder, role, position: { x: 180, y: 640 } };
  const dtoWorld = role === 'witness' ? publicWorld(world, viewer) : world;
  return {
    world: dtoWorld,
    viewer,
    presence: [{ id: 'session-only-presence-id' }],
    institution: { authority: 'not-for-cache' },
    sourceSnapshotReceipt: { token: 'session-only-source-receipt' }
  };
}
function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    values
  };
}

test('shared cache is a redacted public projection, never a session, receipt, presence or authority cache', () => {
  const dto = fixture('founder');
  const envelope = createSharedSnapshotEnvelope(dto, { now: 1000 });
  assert.ok(envelope);
  assert.equal(envelope.schema, 'ngl.shared-public-snapshot.v1');
  assert.equal(envelope.scope, 'public-witness-projection');
  assert.equal(envelope.world.revision, 4);
  assert.equal(envelope.world.drafts.length, 0);
  assert.deepEqual(envelope.world.events.map(event => [event.id, event.historyPosition]), [
    ['contribution-event', 4]
  ]);
  assert.deepEqual(envelope.viewer.position, { x: 180, y: 640 });
  assert.deepEqual(Object.keys(envelope.viewer).sort(), ['id', 'name', 'position', 'role']);
  assert.deepEqual(Object.keys(envelope).sort(), ['cachedAt', 'schema', 'scope', 'viewer', 'world']);
  const serialized = JSON.stringify(envelope);
  assert.doesNotMatch(serialized, /session-only-presence-id|session-only-source-receipt|private-draft|private report/);
  assert.doesNotMatch(serialized, /presenceId|positionEpoch|positionRevision|sourceSnapshotReceipt|institution/);
});

test('Witness DTO history gaps remain original positions instead of being renumbered', () => {
  const dto = fixture('witness');
  const envelope = createSharedSnapshotEnvelope(dto, { now: 1000 });
  assert.ok(envelope);
  assert.deepEqual(envelope.world.events.map(event => [event.id, event.historyPosition]), [
    ['contribution-event', 4]
  ]);
  assert.equal(envelope.world.revision, 4);
  assert.equal(envelope.world.events.length, 1);
});

test('snapshot round-trip and accepted position cache are actor- and revision-bound', () => {
  const storage = memoryStorage();
  const dto = fixture('founder');
  const written = writeSharedSnapshotCache(storage, dto, { now: 1000 });
  assert.deepEqual(written, { stored: true, revision: 4, viewerId: 'damien', viewerRole: 'founder' });
  assert.equal(writeSharedPositionCache(storage, dto.viewer, dto.world.id, 4, { x: 300, y: 650 }, { now: 1100 }), true);
  const snapshot = readSharedSnapshotCache(storage);
  assert.ok(snapshot);
  assert.equal(parseSharedSnapshotEnvelope(JSON.stringify(snapshot)).world.revision, 4);
  assert.deepEqual(readSharedPositionCache(storage, snapshot), { x: 300, y: 650 });
  const positionEnvelope = JSON.parse(storage.getItem(SHARED_POSITION_CACHE_KEY));
  assert.equal(positionEnvelope.schema, 'ngl.shared-accepted-position.v2');
  assert.equal(positionEnvelope.worldId, dto.world.id);
  assert.equal(readSharedPositionCache(storage, {
    ...snapshot,
    viewer: { ...snapshot.viewer, id: 'different-actor' }
  }), null);
  assert.equal(readSharedPositionCache(storage, {
    ...snapshot,
    world: { ...snapshot.world, revision: 5 }
  }), null);
});

test('older accepted snapshots cannot overwrite a newer public cache', () => {
  const storage = memoryStorage();
  const newer = fixture('founder');
  newer.world.revision = 5;
  newer.world.events.push({
    id: 'newer-event', type: 'contribute', actor: { id: 'witness-2', role: 'witness' },
    at: now, semantics: 'newer contribution'
  });
  assert.equal(writeSharedSnapshotCache(storage, newer, { now: 2000 }).stored, true);
  const older = fixture('founder');
  const result = writeSharedSnapshotCache(storage, older, { now: 3000 });
  assert.equal(result.reason, 'newer-cache-preserved');
  assert.equal(readSharedSnapshotCache(storage).world.revision, 5);
});

test('legacy accepted-position caches without world identity are rejected', () => {
  const storage = memoryStorage();
  const dto = fixture('founder');
  const snapshot = createSharedSnapshotEnvelope(dto, { now: 1000 });
  storage.setItem(SHARED_POSITION_CACHE_KEY, JSON.stringify({
    schema: 'ngl.shared-accepted-position.v1',
    cachedAt: 1100,
    actorId: dto.viewer.id,
    actorRole: dto.viewer.role,
    worldRevision: dto.world.revision,
    position: { x: 300, y: 650 }
  }));
  assert.equal(readSharedPositionCache(storage, snapshot), null);
});

test('malformed, oversized and unavailable storage fails closed without manufacturing a snapshot', () => {
  assert.equal(parseSharedSnapshotEnvelope('{bad json'), null);
  assert.equal(parseSharedSnapshotEnvelope('x'.repeat(MAX_SHARED_SNAPSHOT_CACHE_BYTES + 1)), null);
  const oversized = fixture('founder');
  oversized.world.creations = [{ id: 'large', html: 'x'.repeat(MAX_SHARED_SNAPSHOT_CACHE_BYTES + 1) }];
  assert.equal(createSharedSnapshotEnvelope(oversized, { now: 1000 }), null);
  assert.equal(readSharedSnapshotCache({ getItem() { throw new Error('denied'); } }), null);
  assert.equal(writeSharedSnapshotCache({ setItem() { throw new Error('quota'); } }, fixture(), { now: 1000 }).stored, false);
  assert.equal(writeSharedPositionCache({ setItem() { throw new Error('quota'); } }, founder, 'offline-snapshot-world', 4, { x: 180, y: 640 }), false);
  assert.equal(writeSharedPositionCache(memoryStorage(), founder, '', 4, { x: 180, y: 640 }), false);
});


test('older accepted snapshots cannot replace a newer same-world cache after actor changes', () => {
  const storage = memoryStorage();
  const newer = fixture('founder');
  newer.world.revision = 5;
  newer.world.events.push({
    id: 'newer-event', type: 'contribute', actor: { id: 'witness-2', role: 'witness' },
    at: now, semantics: 'newer contribution'
  });
  assert.equal(writeSharedSnapshotCache(storage, newer, { now: 2000 }).stored, true);

  const older = fixture('witness');
  older.viewer.id = 'witness-2';
  older.viewer.name = 'Witness Two';
  const result = writeSharedSnapshotCache(storage, older, { now: 3000 });

  assert.equal(result.reason, 'newer-cache-preserved');
  assert.equal(readSharedSnapshotCache(storage).world.id, 'offline-snapshot-world');
  assert.equal(readSharedSnapshotCache(storage).world.revision, 5);
  assert.equal(readSharedSnapshotCache(storage).viewer.id, 'damien');
});

test('snapshot revision ordering resets when the world identity changes', () => {
  const storage = memoryStorage();
  const previousWorld = fixture('founder');
  previousWorld.world.revision = 9;
  assert.equal(writeSharedSnapshotCache(storage, previousWorld, { now: 2000 }).stored, true);

  const replacementWorld = fixture('founder');
  replacementWorld.world.id = 'replacement-world';
  replacementWorld.world.revision = 1;
  replacementWorld.world.events = [];
  const result = writeSharedSnapshotCache(storage, replacementWorld, { now: 3000 });

  assert.equal(result.stored, true);
  const snapshot = readSharedSnapshotCache(storage);
  assert.equal(snapshot.world.id, 'replacement-world');
  assert.equal(snapshot.world.revision, 1);
});

test('accepted position cache is bound to world identity as well as actor and revision', () => {
  const storage = memoryStorage();
  const dto = fixture('founder');
  assert.equal(writeSharedSnapshotCache(storage, dto, { now: 1000 }).stored, true);
  assert.equal(writeSharedPositionCache(
    storage, dto.viewer, dto.world.id, dto.world.revision, { x: 300, y: 650 }, { now: 1100 }
  ), true);

  const snapshot = readSharedSnapshotCache(storage);
  assert.ok(snapshot);
  assert.deepEqual(readSharedPositionCache(storage, snapshot), { x: 300, y: 650 });
  assert.equal(readSharedPositionCache(storage, {
    ...snapshot,
    world: { ...snapshot.world, id: 'different-world' }
  }), null);
});


test('live shared snapshot acceptance is monotonic per world across viewer changes', () => {
  const accepts = sharedSnapshot.isNonRegressingSharedWorldSnapshot;
  assert.equal(typeof accepts, 'function', 'the live client needs a shared-world revision guard');

  const current = { id: 'world-a', revision: 8 };
  assert.equal(accepts(current, { id: 'world-a', revision: 7 }), false,
    'a delayed lower revision must not replace the current world');
  assert.equal(accepts(current, { id: 'world-a', revision: 8 }), true,
    'same-revision session refreshes remain admissible');
  assert.equal(accepts(current, { id: 'world-a', revision: 9 }), true,
    'a newer same-world snapshot remains admissible');
  assert.equal(accepts(current, { id: 'world-b', revision: 1 }), true,
    'a different world begins an independent revision sequence');
  assert.equal(accepts(null, { id: 'world-a', revision: 0 }), true,
    'the first valid snapshot is admissible');
  assert.equal(accepts(current, { id: 'world-a', revision: -1 }), false,
    'negative revisions fail closed');
  assert.equal(accepts(current, { id: '', revision: 9 }), false,
    'missing world identity fails closed');
});


test('first live shared snapshot is not compared against a higher-revision private import', () => {
  const createGuard = sharedSnapshot.createSharedSnapshotAcceptanceGuard;
  assert.equal(typeof createGuard, 'function', 'shared acceptance needs an explicit provenance guard');
  const guard = createGuard();
  const importedPrivateWorld = { id: 'same-world', revision: 500 };
  const firstServerWorld = { id: 'same-world', revision: 7 };

  assert.equal(guard.hasAcceptedSnapshot, false);
  assert.equal(guard.accept(importedPrivateWorld, firstServerWorld), true,
    'a private import with a matching ID and higher local revision is not a previously accepted shared snapshot');
  assert.equal(guard.hasAcceptedSnapshot, true);
  assert.equal(guard.accept(firstServerWorld, { id: 'same-world', revision: 6 }), false,
    'after the first server snapshot, a delayed lower revision must be rejected');
  assert.equal(guard.accept(firstServerWorld, { id: 'same-world', revision: 8 }), true);
  assert.equal(guard.accept(firstServerWorld, { id: 'replacement-world', revision: 1 }), true,
    'a different world begins an independent revision sequence');

  guard.reset();
  assert.equal(guard.hasAcceptedSnapshot, false);
  assert.equal(guard.accept(importedPrivateWorld, { id: 'same-world', revision: 1 }), true,
    'returning to private mode resets the shared acceptance boundary');
});

test('client resets and establishes shared-snapshot acceptance only at explicit trust boundaries', async () => {
  const client = await readFile(new URL('../game/client.mjs', import.meta.url), 'utf8');
  const resetAt = client.indexOf('function resetSharedSessionForPrivateMode()');
  const startPrivateAt = client.indexOf('async function startPrivate()');
  const connectStreamAt = client.indexOf('function connectSharedStream()', startPrivateAt);
  assert.ok(resetAt >= 0 && startPrivateAt > resetAt && connectStreamAt > startPrivateAt);
  const resetEnd = startPrivateAt;
  const resetSession = client.slice(resetAt, resetEnd);
  for (const expected of [
    'sharedSnapshotAcceptance.reset()',
    'sharedStreamOpen=false',
    'sharedMovementPaused=false',
    'sharedOfflinePreview=false',
    'sharedSnapshotCacheOnly=false',
    'stream?.close();stream=null',
    'sourceSnapshotReceiptsByRevision.clear()',
    'view.setMovementEnabled(false)'
  ]) assert.ok(resetSession.includes(expected), 'private-session reset must include ' + expected);
  const privateStart = client.slice(startPrivateAt, connectStreamAt);
  assert.ok(privateStart.includes('resetSharedSessionForPrivateMode()'),
    'entering a private world must use the complete shared-session reset');
  assert.ok(privateStart.includes('view.setMovementEnabled(true)'),
    'private movement is restored only after the private world has finished loading');

  const importAt = client.indexOf("const file=node('input',{id:'import-world'");
  const exportAt = client.indexOf("content.append(node('div',{class:'button-row'},[button('↓ Export world JSON'", importAt);
  assert.ok(importAt >= 0 && exportAt > importAt);
  const importTransition = client.slice(importAt, exportAt);
  assert.ok(importTransition.includes('resetSharedSessionForPrivateMode()'),
    'importing a save must clear all shared-session and offline-preview state');
  assert.ok(importTransition.includes('institution=null'));
  assert.ok(importTransition.includes('closeSheet();setConnection(true);render()'),
    'the imported private world must refresh visible connection and canvas provenance');

  const acceptAt = client.indexOf('function acceptState(dto,');
  const actAt = client.indexOf('async function act(action)', acceptAt);
  const acceptState = client.slice(acceptAt, actAt);
  assert.match(acceptState, /sharedSnapshotAcceptance\.accept\(world,dto\.world\)/);
  assert.ok(acceptState.indexOf('incomingEpoch') < acceptState.indexOf('sharedSnapshotAcceptance.accept'),
    'invalid session-position metadata must not establish shared acceptance');
  assert.ok(acceptState.indexOf('sharedSnapshotAcceptance.accept') < acceptState.indexOf('world=dto.world'),
    'the revision guard must run before replacing the current world');

  const startSharedAt = client.indexOf('async function startShared()');
  const showSheetAt = client.indexOf('function showSheet(', startSharedAt);
  const startShared = client.slice(startSharedAt, showSheetAt);
  assert.match(startShared, /sharedSnapshotAcceptance\.accept\(world,cached\.world\)/,
    'a cached public snapshot must pass through the same acceptance boundary');
  assert.ok(startShared.includes("if(previousMode==='private')"),
    'a failed shared join must restore private movement instead of stranding the local world');
});

test('shared-session generation invalidates delayed callbacks after a private-world transition', async () => {
  const createGuard = sharedSnapshot.createSharedSessionGenerationGuard;
  assert.equal(typeof createGuard, 'function',
    'the client needs an explicit generation boundary for asynchronous shared-session work');
  const guard = createGuard();
  const sharedGeneration = guard.capture();
  let release;
  const delayedCompletion = new Promise(resolve => { release = resolve; }).then(value =>
    guard.isCurrent(sharedGeneration) ? { accepted: value } : { discarded: true }
  );

  assert.equal(guard.isCurrent(sharedGeneration), true);
  guard.invalidate();
  const privateGeneration = guard.capture();
  assert.notEqual(privateGeneration, sharedGeneration);
  assert.equal(guard.isCurrent(sharedGeneration), false);
  assert.equal(guard.isCurrent(privateGeneration), true);

  release('late shared-world response');
  assert.deepEqual(await delayedCompletion, { discarded: true },
    'a response from the exited shared session must not be applied to the private world');

  guard.invalidate();
  assert.equal(guard.isCurrent(privateGeneration), false);
});

test('private-mode teardown invalidates queued writes, stale responses and old stream callbacks', async () => {
  const client = await readFile(new URL('../game/client.mjs', import.meta.url), 'utf8');
  const resetAt = client.indexOf('function resetSharedSessionForPrivateMode()');
  const startPrivateAt = client.indexOf('async function startPrivate()', resetAt);
  assert.ok(resetAt >= 0 && startPrivateAt > resetAt);
  const reset = client.slice(resetAt, startPrivateAt);

  for (const expected of [
    "mode='private'",
    'sharedSessionGeneration.invalidate()',
    'positionWriteSequence+=1',
    'orderedSharedPositionWriter.cancelPending()',
    'positionReconciliation=null',
    'sharedConnectionRecovery=null',
    'positionEpoch=null',
    'positionWriteRevision=0',
    'stream?.close();stream=null',
    'presence=[]',
    'view.setPresence([])',
    'view.clearManualInput()',
    'view.cancelRoute()',
    'view.setMovementEnabled(false)'
  ]) {
    assert.ok(reset.includes(expected), 'private-mode teardown must include ' + expected);
  }

  const acceptAt = client.indexOf('function acceptState(dto,');
  const actAt = client.indexOf('async function act(action)', acceptAt);
  const accept = client.slice(acceptAt, actAt);
  assert.match(accept, /if\(!isCurrentSharedSession\(generation\)\)return false;/,
    'late HTTP/SSE snapshots must be rejected outside their originating shared session');

  const submitAt = client.indexOf('async function submitSharedPosition(');
  const reconcileAt = client.indexOf('async function reconcileSharedPosition(', submitAt);
  const submit = client.slice(submitAt, reconcileAt);
  assert.match(submit, /const generation=sharedSessionGeneration\.capture\(\)/);
  assert.ok(submit.indexOf('await orderedSharedPositionWriter(position)') <
    submit.indexOf('isCurrentSharedSession(generation)'),
  'a delayed position response must be checked after the network write before touching local state');

  const recoverAt = client.indexOf('async function recoverSharedConnection(', reconcileAt);
  const reconcile = client.slice(reconcileAt, recoverAt);
  assert.match(reconcile, /const generation=sharedSessionGeneration\.capture\(\)/);
  assert.match(reconcile, /if\(!isCurrentSharedSession\(generation\)\)return null;/,
    'a stale reconciliation must stop after every asynchronous boundary');

  const connectAt = client.indexOf('function connectSharedStream()');
  const startSharedAt = client.indexOf('async function startShared()', connectAt);
  const connect = client.slice(connectAt, startSharedAt);
  assert.match(connect, /const generation=sharedSessionGeneration\.capture\(\)/);
  assert.match(connect, /if\(!isCurrentSharedSession\(generation\)\)return/);

  const privateStart = client.slice(startPrivateAt, connectAt);
  assert.match(privateStart, /const generation=resetSharedSessionForPrivateMode\(\)/);
  assert.match(privateStart, /if\(!sharedSessionGeneration\.isCurrent\(generation\)\|\|mode!=='private'\)return/);

  const sharedStartEnd = client.indexOf('function showSheet(', startSharedAt);
  const sharedStart = client.slice(startSharedAt, sharedStartEnd);
  assert.match(sharedStart, /const generation=sharedSessionGeneration\.capture\(\)/);
  assert.match(sharedStart, /if\(!sharedSessionGeneration\.isCurrent\(generation\)\)return/);
});
