import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { projectCollaboratorResponseWorldObjects, isCollaboratorResponseProjection, selectAcademyTutorFolios } from '../game/collaborator-world-objects.mjs';
import { projectCollaboratorPackets } from '../game/collaborator-contracts.mjs';
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

// Packet fixtures retain the complete compact source record, not just its event ID.
function responseEvent({
  eventId = 'response-event-1',
  responseId = 'response-1',
  role = 'tutor',
  actor = { id: 'witness-1', role: 'witness' },
  at = '2026-10-30T05:01:00.000Z',
  snapshotRevision = 1,
  priorEvents = [proposal],
  validationStatus = 'valid-for-human-review',
  validationReason = null,
  packetChanges = null,
  responseText = '{"concepts":["falsifiable hypotheses"],"prerequisites":["retained observations"],"explanation":"A falsifier is an observation that would contradict the hypothesis under the stated conditions.","questions":["What observation would count against the claim?"],"answerKey":["A reproducible counterexample under the stated conditions."],"whatRemainsUnproven":["This response is not evidence that the experiment ran."]}'
} = {}) {
  // The archived packet must be one the runtime itself could have issued for
  // this exact earlier event slice. Tests may mutate its payload deliberately,
  // but ordinary fixtures retain the builder's original bytes.
  const packet = projectCollaboratorPackets({
    id: 'world-1',
    revision: snapshotRevision,
    creations: [],
    events: priorEvents
  }).find(candidate => candidate.id === role && candidate.available);
  assert.ok(packet, 'the prior event slice must provide the requested role packet');
  const payload = JSON.parse(packet.packetJson);
  packetChanges?.(payload);
  const packetJson = packetChanges ? JSON.stringify(payload) : packet.packetJson;
  return {
    id: eventId,
    type: 'collaborator-response-recorded',
    actor: { ...actor },
    at,
    responseId,
    role,
    moonshotId: 'moonshot-1',
    sourceEventIds: [...payload.inputRefs],
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

test('the Polymath Academy shelf selects only retained tutor folios and preserves rejected attempts', () => {
  const tutor = responseEvent({ eventId: 'tutor-event', responseId: 'tutor-response' });
  const synthesizer = responseEvent({
    eventId: 'synth-event', responseId: 'synth-response', role: 'synthesizer',
    at: '2026-10-30T05:02:00.000Z', snapshotRevision: 2,
    priorEvents: [proposal, tutor]
  });
  const world = worldWith(null, { revision: 3, events: [proposal, tutor, synthesizer] });
  const before = structuredClone(world);
  const projection = projectCollaboratorResponseWorldObjects(world);
  const shelf = selectAcademyTutorFolios(world, projection);
  assert.equal(shelf.items.length, 1);
  assert.equal(shelf.items[0].responseId, 'tutor-response');
  assert.equal(shelf.items[0].roleId, 'tutor');
  assert.equal(shelf.items[0].validationStatus, 'valid-for-human-review');
  assert.equal(shelf.omittedCount, 0);
  assert.deepEqual(world, before, 'the Academy shelf is a read-only projection');

  const rejected = responseEvent({
    eventId: 'tutor-rejected-event', responseId: 'tutor-rejected',
    at: '2026-10-30T05:03:00.000Z', snapshotRevision: 3,
    priorEvents: [proposal, tutor, synthesizer],
    validationStatus: 'rejected',
    validationReason: 'RESPONSE_SCHEMA_OR_SCOPE_INVALID',
    responseText: '{}'
  });
  const withRejected = worldWith(null, {
    revision: 4, events: [proposal, tutor, synthesizer, rejected]
  });
  const rejectedShelf = selectAcademyTutorFolios(withRejected);
  assert.deepEqual(rejectedShelf.items.map(item => [item.responseId, item.validationStatus]), [
    ['tutor-rejected', 'rejected'], ['tutor-response', 'valid-for-human-review']
  ]);
  assert.equal(rejectedShelf.omittedCount, 0);
  assert.throws(() => selectAcademyTutorFolios(withRejected, null, 25), RangeError);
});

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
    roleId: 'tutor',
    name: 'Polymath Tutor',
    validationStatus: 'valid-for-human-review',
    sourceEventIds: ['proposal-1'],
    mapVisible: true
  });
  assert.ok(Number.isFinite(objects[0].x) && Number.isFinite(objects[0].y));
  assert.deepEqual(world, before, 'projection must not mutate canonical history');
});

test('a recomputed packet receipt cannot detach compact source content from the retained proposal', () => {
  const tampered = responseEvent({
    packetChanges: payload => { payload.inputRecords[0].hypothesis = 'A substituted hypothesis'; }
  });
  assert.deepEqual(projectCollaboratorResponseWorldObjects(worldWith(tampered)), [],
    'a byte-valid packet must still reproduce the exact retained source record');
});

test('rejected collaborator output remains a visible, explicitly rejected world object', () => {
  const rejected = responseEvent({
    validationStatus: 'rejected',
    validationReason: 'RESPONSE_SCHEMA_OR_SCOPE_INVALID',
    responseText: '{}'
  });
  const [object] = projectCollaboratorResponseWorldObjects(worldWith(rejected));
  assert.equal(object.validationStatus, 'rejected');
  assert.equal(object.validationReason, 'RESPONSE_SCHEMA_OR_SCOPE_INVALID');
  assert.equal(object.mapVisible, true);
});

test('archived validation labels are recomputed from the exact retained packet and response bytes', () => {
  const forgedValid = responseEvent({
    responseText: '{"draft":"review only"}'
  });
  const [rejected] = projectCollaboratorResponseWorldObjects(worldWith(forgedValid));
  assert.equal(rejected.validationStatus, 'rejected');
  assert.equal(rejected.validationReason, 'RESPONSE_SCHEMA_OR_SCOPE_INVALID');
  assert.equal(rejected.recordedValidationStatus, 'valid-for-human-review');
  assert.equal(rejected.recomputedValidationStatus, 'rejected');
  assert.equal(rejected.validationMismatch, true);

  const forgedRejected = responseEvent({
    validationStatus: 'rejected',
    validationReason: 'RESPONSE_SCHEMA_OR_SCOPE_INVALID'
  });
  const [notPromoted] = projectCollaboratorResponseWorldObjects(worldWith(forgedRejected));
  assert.equal(notPromoted.validationStatus, 'rejected',
    'a mismatched stored rejection must not be promoted by the UI projection');
  assert.equal(notPromoted.validationReason, 'ARCHIVED_VALIDATION_STATUS_MISMATCH');
  assert.equal(notPromoted.recomputedValidationStatus, 'valid-for-human-review');
  assert.equal(notPromoted.validationMismatch, true);
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
      priorEvents: events
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
      priorEvents: events
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
    roleId: 'tutor',
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
    priorEvents: [proposal, duplicateResponseA],
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
  event.packetJson = event.packetJson.replace('"role": "tutor"', '"role": "tutor", "role": "adversary"');
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


test('prototype-sensitive JSON keys cannot manufacture inherited Relay folios', () => {
  const forgedEvent = JSON.parse('{"__proto__":' + JSON.stringify(responseEvent()) + '}');
  assert.deepEqual(projectCollaboratorResponseWorldObjects(worldWith(forgedEvent)), [],
    'an own JSON __proto__ field is data, not a source of inherited event identity');

  const forgedActorEvent = responseEvent();
  forgedActorEvent.actor = JSON.parse('{"__proto__":' + JSON.stringify({ id: 'witness-1', role: 'witness' }) + '}');
  assert.deepEqual(projectCollaboratorResponseWorldObjects(worldWith(forgedActorEvent)), [],
    'actor identity and role must be own data fields, not inherited from JSON');
});

test('revoked proxy event entries are skipped without crashing Relay folio projection', () => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const world = worldWith(null, { revision: 2, events: [proposal, revoked.proxy] });
  assert.doesNotThrow(() => projectCollaboratorResponseWorldObjects(world));
  assert.deepEqual(projectCollaboratorResponseWorldObjects(world), []);
});


test('Relay projection arrays are sealed to the exact world snapshot that produced them', () => {
  const world = worldWith(null, { revision: 1, events: [proposal] });
  const projection = projectCollaboratorResponseWorldObjects(world);
  assert.equal(isCollaboratorResponseProjection(projection, world), true);
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(isCollaboratorResponseProjection(Object.freeze([...projection]), world), false);
  assert.equal(isCollaboratorResponseProjection(projection, worldWith(null, { revision: 1, events: [proposal] })), false);
  world.revision += 1;
  assert.equal(isCollaboratorResponseProjection(projection, world), false, 'a stale revision cannot reuse the old projection');
});
