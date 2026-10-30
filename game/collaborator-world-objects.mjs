import { isStrictTimestamp } from './timestamps.mjs';
import { COLLABORATOR_ROLES, isBoundedIdentifier, compactCollaboratorSourceRecord } from './collaborator-contracts.mjs';
import { projectResearchRecords } from './research-records.mjs';
import { assertNoDuplicateJsonObjectKeys } from './strict-json.mjs';

const MAX_WORLD_EVENT_SCAN = 100_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_MAP_RESPONSE_OBJECTS = 24;
const WORLD_OBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const encoder = new TextEncoder();
const roles = new Map(COLLABORATOR_ROLES.map(role => [role.id, role]));
const roleStyles = Object.freeze({
  archivist: { accent: '#6b805d', sigil: 'A' },
  adversary: { accent: '#af5138', sigil: '!' },
  synthesizer: { accent: '#536b68', sigil: 'S' },
  tutor: { accent: '#9a8b5b', sigil: 'T' }
});

function ownDataValue(value, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function ownDataRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== 'string')) return null;
    const result = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function ownDataArray(value, maximum) {
  try {
    if (!Array.isArray(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = descriptors.length;
    const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value')
      ? lengthDescriptor.value : null;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum ||
        Reflect.ownKeys(descriptors).length !== length + 1) return null;
    const result = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

function boundedText(value, maximum) {
  return typeof value === 'string' && value.trim().length > 0 &&
    Array.from(value).length <= maximum;
}

function exactStrings(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
}

function sameJsonData(left, right) {
  try { return stableJson(left) === stableJson(right); }
  catch { return false; }
}

function receiptEnvelopeMatches(value, receiptValue) {
  const receipt = ownDataRecord(receiptValue);
  if (!receipt || Object.keys(receipt).sort().join(',') !== 'algorithm,digest,size' ||
      receipt.algorithm !== 'sha256' || typeof receipt.digest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(receipt.digest) || !Number.isSafeInteger(receipt.size) ||
      receipt.size !== encoder.encode(value).byteLength) return false;
  // The server/import validator recomputes the digest over the exact bytes.
  // This synchronous map projection checks only the receipt envelope and size;
  // it never upgrades the response into independently verified evidence.
  return true;
}

function validActor(value) {
  const actor = ownDataRecord(value);
  return actor && isBoundedIdentifier(actor.id) &&
    ['founder', 'witness'].includes(actor.role) ? actor : null;
}

function parsePacket(packetJson) {
  try {
    assertNoDuplicateJsonObjectKeys(packetJson, {
      label: 'COLLABORATOR_PACKET',
      maxDepth: 8
    });
    return ownDataRecord(JSON.parse(packetJson));
  } catch {
    return null;
  }
}

function validProposal(record, eventId, moonshotId) {
  const actor = validActor(record.actor);
  return record.type === 'moonshot-proposed' && record.id === eventId &&
    WORLD_OBJECT_ID.test(eventId) && record.moonshotId === moonshotId &&
    boundedText(record.title, 80) && boundedText(record.hypothesis, 1000) &&
    boundedText(record.falsifier, 1000) && boundedText(record.evidenceNeeded, 1000) &&
    actor && isStrictTimestamp(record.at);
}

/**
 * Project exact archived collaborator responses into small, navigable Relay
 * folios. These are retained response objects, not autonomous NPCs, approvals,
 * evidence of truth, or rewards. The full packet and response stay in the
 * Evidence Archive; older folios remain available there when the map is full.
 */
export function projectCollaboratorResponseWorldObjects(world) {
  const worldId = ownDataValue(world, 'id');
  const worldRevision = ownDataValue(world, 'revision');
  const events = ownDataArray(ownDataValue(world, 'events'), MAX_WORLD_EVENT_SCAN);
  const creations = ownDataArray(ownDataValue(world, 'creations'), 20_000) || [];
  // Recreate the exact compact records from the retained source history. Matching
  // only IDs and timestamps would let a byte-valid packet substitute different
  // hypothesis/observation text while still earning a Relay folio and quest credit.
  const compactSourceById = new Map();
  for (const record of projectResearchRecords(events || [], creations)) {
    const projection = record?._projection;
    if (projection?.recordSafe && projection.eventIdUnique && typeof record.id === 'string') {
      compactSourceById.set(record.id, compactCollaboratorSourceRecord(record));
    }
  }
  if (!isBoundedIdentifier(worldId) || !Number.isSafeInteger(worldRevision) ||
      worldRevision < 0 || !events) return Object.freeze([]);

  const entries = [];
  const eventIdCounts = new Map();
  const responseIdCounts = new Map();
  const proposalCounts = new Map();
  const entryById = new Map();
  let visibleEventCount = 0;

  for (let index = 0; index < events.length; index += 1) {
    const raw = events[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = ownDataRecord(raw);
    const entry = { index, visibleIndex: visibleEventCount, record };
    entries.push(entry);
    visibleEventCount += 1;
    if (!record) continue;
    if (typeof record.id === 'string') {
      eventIdCounts.set(record.id, (eventIdCounts.get(record.id) || 0) + 1);
      if (!entryById.has(record.id)) entryById.set(record.id, entry);
    }
    if (record.type === 'collaborator-response-recorded' && typeof record.responseId === 'string') {
      responseIdCounts.set(record.responseId, (responseIdCounts.get(record.responseId) || 0) + 1);
    }
    if (record.type === 'moonshot-proposed' && typeof record.moonshotId === 'string') {
      proposalCounts.set(record.moonshotId, (proposalCounts.get(record.moonshotId) || 0) + 1);
    }
  }

  if (worldRevision < visibleEventCount) return Object.freeze([]);

  const valid = [];
  for (const entry of entries) {
    const event = entry.record;
    if (!event || event.type !== 'collaborator-response-recorded') continue;
    const eventId = event.id;
    const responseId = event.responseId;
    const roleId = event.role;
    const role = roles.get(roleId);
    const style = roleStyles[roleId];
    const actor = validActor(event.actor);
    const atMs = isStrictTimestamp(event.at) ? Date.parse(event.at) : NaN;
    const moonshotId = event.moonshotId;
    const sourceIds = ownDataArray(event.sourceEventIds, 8);
    const packetJson = event.packetJson;
    const responseText = event.responseText;
    if (!role || !style || !actor || !WORLD_OBJECT_ID.test(eventId || '') ||
        eventIdCounts.get(eventId) !== 1 || !WORLD_OBJECT_ID.test(responseId || '') ||
        responseIdCounts.get(responseId) !== 1 || !WORLD_OBJECT_ID.test(moonshotId || '') ||
        !Number.isFinite(atMs) || !sourceIds || sourceIds.length < 1 ||
        sourceIds.some(id => !isBoundedIdentifier(id)) || new Set(sourceIds).size !== sourceIds.length ||
        typeof packetJson !== 'string' || encoder.encode(packetJson).byteLength > MAX_RESPONSE_BYTES ||
        typeof responseText !== 'string' || !responseText.trim() ||
        encoder.encode(responseText).byteLength > MAX_RESPONSE_BYTES ||
        !receiptEnvelopeMatches(packetJson, event.packetReceipt) ||
        !receiptEnvelopeMatches(responseText, event.responseReceipt) ||
        !['valid-for-human-review', 'rejected'].includes(event.validationStatus) ||
        (event.validationStatus === 'valid-for-human-review' && event.validationReason !== null) ||
        (event.validationStatus === 'rejected' &&
          !boundedText(event.validationReason, 128)) ||
        event.validator !== 'ngl.collaborator-response.v1') continue;

    const payload = parsePacket(packetJson);
    const snapshot = payload && ownDataRecord(payload.sourceSnapshot);
    const inputRefs = payload && ownDataArray(payload.inputRefs, 8);
    const inputRecords = payload && ownDataArray(payload.inputRecords, 8);
    const omittedIds = payload && ownDataArray(payload.omittedEventIds, 64);
    const omittedCount = payload && payload.omittedCount;
    if (!payload || !snapshot || !inputRefs || !inputRecords || !omittedIds ||
        payload.protocol !== 'ngl.bounded-collaborator-packet.v1' ||
        payload.role !== roleId || payload.targetMoonshotId !== moonshotId ||
        payload.authority !== 'advisory-only' ||
        payload.mayWriteCanonicalState !== false || payload.mayGrantAuthority !== false ||
        payload.mayAwardProgress !== false || payload.mayCertifyTruthOrExecution !== false ||
        !exactStrings(inputRefs, sourceIds) || inputRecords.length !== sourceIds.length ||
        snapshot.status !== 'identified' || snapshot.worldId !== worldId ||
        !Number.isSafeInteger(snapshot.revision) || snapshot.revision < entry.visibleIndex ||
        snapshot.revision >= worldRevision ||
        snapshot.suppliedEventCount !== entry.visibleIndex ||
        !Number.isSafeInteger(omittedCount) || omittedCount < omittedIds.length ||
        payload.omittedEventIdListTruncated !== (omittedCount > omittedIds.length) ||
        omittedIds.some(id => !isBoundedIdentifier(id) || sourceIds.includes(id)) ||
        new Set(omittedIds).size !== omittedIds.length) continue;

    const inputTypes = inputRecords.map(record => ownDataValue(record, 'type'));
    if (inputTypes[0] !== 'moonshot-proposed' ||
        (roleId === 'tutor' && inputRecords.length !== 1) ||
        (roleId === 'adversary' && (
          inputTypes[1] !== 'experiment-reported' ||
          inputRecords.slice(2).some(record =>
            ownDataValue(record, 'type') !== 'experiment-challenged' ||
            ownDataValue(record, 'reportId') !== ownDataValue(inputRecords[1], 'reportId')
          )
        ))) continue;

    let proposalFound = false;
    let sourceChainValid = true;
    for (let sourceIndex = 0; sourceIndex < sourceIds.length; sourceIndex += 1) {
      const sourceId = sourceIds[sourceIndex];
      const sourceEntry = entryById.get(sourceId);
      const source = sourceEntry?.record;
      const input = ownDataRecord(inputRecords[sourceIndex]);
      const sourceActor = source && validActor(source.actor);
      const inputActor = input && ownDataRecord(input.actor);
      const expectedInput = compactSourceById.get(sourceId);
      if (!sourceEntry || eventIdCounts.get(sourceId) !== 1 ||
          sourceEntry.index >= entry.index || !source || !input || !sourceActor || !inputActor ||
          !expectedInput || !sameJsonData(input, expectedInput) ||
          source.moonshotId !== moonshotId || !isStrictTimestamp(source.at) ||
          Date.parse(source.at) > atMs ||
          input.eventId !== source.id || input.type !== source.type || input.at !== source.at ||
          input.moonshotId !== source.moonshotId ||
          inputActor.id !== sourceActor.id || inputActor.role !== sourceActor.role) {
        sourceChainValid = false;
        break;
      }
      if (source.type === 'moonshot-proposed' &&
          proposalCounts.get(moonshotId) === 1 &&
          validProposal(source, sourceId, moonshotId)) proposalFound = true;
    }
    if (!sourceChainValid || !proposalFound) continue;

    valid.push({
      id: 'collaborator-response-object:' + responseId,
      type: 'collaborator-response-object',
      eventId,
      responseId,
      roleId,
      name: role.name,
      objective: role.objective,
      sigil: style.sigil,
      accent: style.accent,
      moonshotId,
      actorId: actor.id,
      actorRole: actor.role,
      at: event.at,
      validationStatus: event.validationStatus,
      validationReason: event.validationReason,
      sourceEventIds: Object.freeze([...sourceIds])
    });
  }

  const firstVisible = Math.max(0, valid.length - MAX_MAP_RESPONSE_OBJECTS);
  return Object.freeze(valid.map((object, index) => {
    const mapIndex = index - firstVisible;
    const mapVisible = mapIndex >= 0;
    return Object.freeze({
      ...object,
      mapVisible,
      x: mapVisible ? 610 + (mapIndex % 6) * 30 : null,
      y: mapVisible ? 205 + Math.floor(mapIndex / 6) * 30 : null
    });
  }));
}
