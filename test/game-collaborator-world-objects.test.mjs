import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { projectCollaboratorResponseWorldObjects } from '../game/collaborator-world-objects.mjs';
import { findRoute, WorldView } from '../game/world-view.mjs';

const proposal = Object.freeze({
  id: 'proposal-1',
  type: 'moonshot-proposed',
  moonshotId: 'moonshot-1',
  actor: Object.freeze({ id: 'founder-1', role: 'founder' }),
  at: '2026-10-30T05:00:00.000Z',
  title: 'Can this claim be falsified?',
  hypothesis: 'The retained claim holds under its stated conditions.',
  falsifier: 'A reproducible counterexample appears under those conditions.',
  evidenceNeeded: 'Independent observation and exact source bytes.'
});

function receipt(value) {
  return {
    algorithm: 'sha256',
    digest: createHash('sha256').update(value, 'utf8').digest('hex'),
    size: Buffer.byteLength(value, 'utf8')
  };
}

function responseEvent({
  eventId = 'response-event-1',
  responseId = 'response-1',
  role = 'adversary',
  actor = { id: 'witness-1', role: 'witness' },
  at = '2026-10-30T05:01:00.000Z',
  snapshotRevision = 1,
  suppliedEventCount = 1,
  validationStatus = 'valid-for-human-review',
  validationReason = null,
  sourceEventIds = ['proposal-1'],
  packetChanges = null,
  responseText = '{"draft":"review only"}'
} = {}) {
  const payload = {
    protocol: 'ngl.bounded-collaborator-packet.v1',
    sourceSnapshot: {
      status: 'identified',
      worldId: 'world-1',
      revision: snapshotRevision,
      suppliedEventCount
    },
    role,
    targetMoonshotId: 'moonshot-1',
    authority: 'advisory-only',
    mayWriteCanonicalState: false,
    mayGrantAuthority: false,
    mayAwardProgress: false,
    mayCertifyTruthOrExecution: false,
    inputRefs: [...sourceEventIds],
    omittedEventIds: [],
    omittedCount: 0,
    omittedEventIdListTruncated: false,
    truncatedContentFieldCount: 0,
    inputRecords: sourceEventIds.map(id => ({
      eventId: id,
      type: 'moonshot-proposed',
      at: proposal.at,
      actor: { id: proposal.actor.id, role: proposal.actor.role },
      moonshotId: proposal.moonshotId
    }))
  };
  packetChanges?.(payload);
  const packetJson = JSON.stringify(payload);
  return {
    id: eventId,
    type: 'collaborator-response-recorded',
    actor: { ...actor },
    at,
    responseId,
    role,
    moonshotId: 'moonshot-1',
    sourceEventIds: [...sourceEventIds],
    packetJson,
    packetReceipt: receipt(packetJson),
    responseText,
    responseReceipt: receipt(responseText),
    validationStatus,
    validationReason,
    validator: 'ngl.collaborator-response.v1'
  };
}

function worldWith(response, { revision = 2, events = [proposal, response] } = {}) {
  return { id: 'world-1', revision, creations: [], events };
}

test('a source-bound collaborator response becomes a navigable Relay folio', () => {
  const world = worldWith(responseEvent());
  const before = structuredClone(world);
  const objects = projectCollaboratorResponseWorldObjects(world);
  assert.equal(objects.length, 1);
  assert.deepEqual({
    type: objects[0].type,
    responseId: objects[0].responseId,
    roleId: objects[0].roleId,
    name: objects[0].name,
    validationStatus: objects[0].validationStatus,
    sourceEventIds: objects[0].sourceEventIds,
    mapVisible: objects[0].mapVisible
  }, {
    type: 'collaborator-response-object',
    responseId: 'response-1',
    roleId: 'adversary',
    name: 'Adversary',
    validationStatus: 'valid-for-human-review',
    sourceEventIds: ['proposal-1'],
    mapVisible: true
  });
  assert.ok(Number.isFinite(objects[0].x) && Number.isFinite(objects[0].y));
  assert.deepEqual(world, before, 'projection must not mutate canonical history');
});

test('rejected collaborator output remains a visible, explicitly rejected world object', () => {
  const rejected = responseEvent({
    validationStatus: 'rejected',
    validationReason: 'RESPONSE_SCHEMA_OR_SCOPE_INVALID'
  });
  const [object] = projectCollaboratorResponseWorldObjects(worldWith(rejected));
  assert.equal(object.validationStatus, 'rejected');
  assert.equal(object.validationReason, 'RESPONSE_SCHEMA_OR_SCOPE_INVALID');
  assert.equal(object.mapVisible, true);
});

test('witness-visible history tolerates hidden draft and repair events without inventing a snapshot', () => {
  const response = responseEvent({ snapshotRevision: 3, suppliedEventCount: 1 });
  const world = worldWith(response, { revision: 4 });
  const [object] = projectCollaboratorResponseWorldObjects(world);
  assert.equal(object.responseId, 'response-1');
  assert.equal(object.mapVisible, true);
});

test('the map exposes only the 24 newest folios while every retained folio remains addressable', () => {
  const events = [proposal];
  for (let index = 1; index <= 30; index += 1) {
    events.push(responseEvent({
      eventId: 'response-event-' + index,
      responseId: 'response-' + index,
      at: new Date(Date.parse(proposal.at) + index * 1000).toISOString(),
      snapshotRevision: index,
      suppliedEventCount: index
    }));
  }
  const objects = projectCollaboratorResponseWorldObjects(
    worldWith(null, { revision: events.length, events })
  );
  assert.equal(objects.length, 30);
  assert.equal(objects.filter(object => object.mapVisible).length, 24);
  assert.equal(objects.filter(object => !object.mapVisible).length, 6);
  assert.deepEqual(objects.slice(-24).map(object => [object.x, object.y]),
    Array.from({ length: 24 }, (_, index) => [610 + (index % 6) * 30, 205 + Math.floor(index / 6) * 30]));
});

test('Relay folio map positions are reachable without crossing the river or a creation', () => {
  const events = [proposal];
  for (let index = 1; index <= 24; index += 1) {
    events.push(responseEvent({
      eventId: 'response-event-' + index,
      responseId: 'response-' + index,
      at: new Date(Date.parse(proposal.at) + index * 1000).toISOString(),
      snapshotRevision: index,
      suppliedEventCount: index
    }));
  }
  const objects = projectCollaboratorResponseWorldObjects(
    worldWith(null, { revision: events.length, events })
  );
  const buildings = [
    { position: { x: 540, y: 610 } },
    { position: { x: 480, y: 395 } },
    { position: { x: 1120, y: 560 } },
    { position: { x: 1190, y: 390 } },
    { position: { x: 1050, y: 830 } },
    { position: { x: 380, y: 800 } },
    { position: { x: 650, y: 825 } },
    { position: { x: 1450, y: 590 } },
    { position: { x: 270, y: 310 } },
    { position: { x: 1400, y: 180 } },
    { position: { x: 1100, y: 190 } },
    { position: { x: 530, y: 180 } }
  ];
  for (const object of objects.filter(item => item.mapVisible)) {
    assert.ok(findRoute({ x: 180, y: 640 }, { x: object.x, y: object.y + 18 }, buildings).length,
      'route should reach ' + object.responseId);
  }
});

test('the world map dispatches a folio interaction to the exact retained response ID', t => {
  const globals = {
    document: { body: { classList: { contains: () => false } } },
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    ResizeObserver: class { observe() {} disconnect() {} }
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, globals);
  const interactions = [];
  const canvas = {
    getContext: () => ({}),
    getBoundingClientRect: () => ({ width: 1000, height: 700 }),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  const view = new WorldView(canvas, { onInteract: value => interactions.push(value) });
  t.after(() => {
    view.destroy();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  view.setWorld(worldWith(responseEvent()));
  const object = view.collaboratorResponseObjects[0];
  view.setPlayer({ x: object.x, y: object.y + 10 });
  view.interact(object.id, 'collaborator-response');
  assert.deepEqual(interactions, [{
    type: 'collaborator-response',
    responseId: 'response-1',
    roleId: 'adversary',
    moonshotId: 'moonshot-1',
    validationStatus: 'valid-for-human-review'
  }]);
});

test('malformed packet scope, receipt size, chronology, and duplicate identities fail closed', () => {
  const badAuthority = responseEvent({
    packetChanges: payload => { payload.mayWriteCanonicalState = true; }
  });
  const badReceipt = responseEvent();
  badReceipt.packetReceipt.size += 1;
  const backdated = responseEvent({ at: '2026-10-30T04:59:00.000Z' });
  const duplicateResponseA = responseEvent({ responseId: 'duplicate-response' });
  const duplicateResponseB = responseEvent({
    eventId: 'response-event-2',
    responseId: 'duplicate-response',
    snapshotRevision: 2,
    suppliedEventCount: 2,
    at: '2026-10-30T05:02:00.000Z'
  });
  assert.deepEqual(projectCollaboratorResponseWorldObjects(worldWith(badAuthority)), []);
  assert.deepEqual(projectCollaboratorResponseWorldObjects(worldWith(badReceipt)), []);
  assert.deepEqual(projectCollaboratorResponseWorldObjects(worldWith(backdated)), []);
  assert.deepEqual(projectCollaboratorResponseWorldObjects(worldWith(null, {
    revision: 3,
    events: [proposal, duplicateResponseA, duplicateResponseB]
  })), []);
});

test('duplicate packet keys are not projected as a trustworthy source-bound folio', () => {
  const event = responseEvent();
  event.packetJson = event.packetJson.replace('"role":"adversary"', '"role":"adversary","role":"tutor"');
  event.packetReceipt = receipt(event.packetJson);
  assert.deepEqual(projectCollaboratorResponseWorldObjects(worldWith(event)), []);
});

test('accessor-backed response bytes are rejected without executing the getter', () => {
  const event = responseEvent();
  let getterCalls = 0;
  Object.defineProperty(event, 'responseText', {
    enumerable: true,
    get() { getterCalls += 1; return '{"claim":"forged"}'; }
  });
  assert.deepEqual(projectCollaboratorResponseWorldObjects(worldWith(event)), []);
  assert.equal(getterCalls, 0);
});
