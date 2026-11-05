import { isCollaboratorPacket, isBoundedIdentifier, MAX_PACKET_OMITTED_IDS, COLLABORATOR_ROLES, projectCollaboratorPackets } from './collaborator-contracts.mjs';
import { assertNoDuplicateJsonObjectKeys } from './strict-json.mjs';

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_ARRAY_ITEMS = 64;
const MAX_OBJECT_KEYS = 32;
const MAX_DEPTH = 6;
const MAX_STRING_CHARS = 4096;
const CHALLENGE_TYPES = new Set([
  'missing-evidence', 'methodology', 'contradiction', 'reproducibility', 'scope', 'other'
]);

const reject = reason => Object.freeze({ valid: false, status: 'rejected', reason });
const unavailable = reason => Object.freeze({ valid: false, status: 'unavailable', reason });
function ownDataValue(object, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}
function ownArrayValues(value, maximum) {
  try {
    if (!Array.isArray(value)) return null;
    const length = ownDataValue(value, 'length');
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
    const values = [];
    for (let index = 0; index < length; index += 1) {
      const item = ownDataValue(value, String(index));
      if (item === undefined) return null;
      values.push(item);
    }
    return values;
  } catch {
    return null;
  }
}
const ownPlainObject = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
};

function exactKeys(value, expected) {
  if (!ownPlainObject(value)) return false;
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expected.length || keys.some(key => typeof key !== 'string' || !expected.includes(key))) return false;
    return expected.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && descriptor.enumerable === true && Object.hasOwn(descriptor, 'value');
    });
  } catch {
    return false;
  }
}

function safeJsonValue(value, depth = 0) {
  if (depth > MAX_DEPTH) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return Array.from(value).length <= MAX_STRING_CHARS;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) return false;
    try {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Reflect.ownKeys(descriptors).length !== value.length + 1) return false;
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !safeJsonValue(descriptor.value, depth + 1)) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  if (!ownPlainObject(value)) return false;
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_OBJECT_KEYS || keys.some(key =>
      typeof key !== 'string' || key === '__proto__' || key === 'prototype' || key === 'constructor'
    )) return false;
    return keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && descriptor.enumerable === true && Object.hasOwn(descriptor, 'value') &&
        safeJsonValue(descriptor.value, depth + 1);
    });
  } catch {
    return false;
  }
}

function boundedString(value, maximum, { allowEmpty = false } = {}) {
  return typeof value === 'string' && Array.from(value).length <= maximum &&
    (allowEmpty || value.trim().length > 0);
}

function boundedStringList(value, maximum = 32, maxChars = 1000) {
  return Array.isArray(value) && value.length <= maximum &&
    value.every(item => boundedString(item, maxChars));
}

function validNextDiscriminatingExperiment(value) {
  return exactKeys(value, ['procedure', 'outcome']) &&
    boundedString(value.procedure, 1000) &&
    boundedString(value.outcome, 1000);
}

function stringIds(value, allowed, { maximum = 64, unique = true } = {}) {
  if (!Array.isArray(value) || value.length > maximum) return false;
  const seen = new Set();
  for (const id of value) {
    if (typeof id !== 'string' || !allowed.has(id) || (unique && seen.has(id))) return false;
    seen.add(id);
  }
  return true;
}

function sourceStatementList(value, allowed, { maximum = 32, minimumSources = 1 } = {}) {
  if (!Array.isArray(value) || value.length > maximum) return false;
  return value.every(item =>
    exactKeys(item, ['sourceEventIds', 'statement']) &&
    Array.isArray(item.sourceEventIds) &&
    item.sourceEventIds.length >= minimumSources &&
    stringIds(item.sourceEventIds, allowed, { maximum: 8 }) &&
    boundedString(item.statement, 1000)
  );
}

function exactStringIds(value, allowed, { maximum = 64 } = {}) {
  return stringIds(value, allowed, { maximum }) && value.length === allowed.size;
}

function validOmissionDisclosure(payload) {
  const omitted = payload.omittedEventIds;
  if (!Array.isArray(omitted) || omitted.length > MAX_PACKET_OMITTED_IDS ||
      !Number.isSafeInteger(payload.omittedCount) || payload.omittedCount < 0 ||
      payload.omittedCount < omitted.length ||
      payload.omittedEventIdListTruncated !== (payload.omittedCount > omitted.length)) return false;

  const includedIds = new Set(payload.inputRefs);
  const seen = new Set();
  for (const id of omitted) {
    if (!isBoundedIdentifier(id) || includedIds.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

function freezeJson(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) freezeJson(value[key]);
    Object.freeze(value);
  }
  return value;
}

function parsePacketPayload(packetJson, role, moonshotId, expectedInputRefs) {
  const roleSpec = COLLABORATOR_ROLES.find(candidate => candidate.id === role);
  if (typeof packetJson !== 'string' ||
      new TextEncoder().encode(packetJson).byteLength > MAX_RESPONSE_BYTES ||
      !roleSpec ||
      !isBoundedIdentifier(moonshotId) ||
      !Array.isArray(expectedInputRefs) || expectedInputRefs.length === 0 || expectedInputRefs.length > 8 ||
      expectedInputRefs.some(id => !isBoundedIdentifier(id)) ||
      new Set(expectedInputRefs).size !== expectedInputRefs.length) return null;
  let payload;
  try {
    assertNoDuplicateJsonObjectKeys(packetJson, { label: 'COLLABORATOR_PACKET', maxDepth: MAX_DEPTH });
    payload = JSON.parse(packetJson);
  } catch {
    return null;
  }
  const payloadKeys = [
    'protocol', 'sourceSnapshot', 'role', 'objective', 'targetMoonshotId', 'authority',
    'mayWriteCanonicalState', 'mayGrantAuthority', 'mayAwardProgress', 'mayCertifyTruthOrExecution',
    'inputRefs', 'omittedEventIds', 'omittedCount', 'omittedEventIdListTruncated',
    'truncatedContentFieldCount', 'inputRecords'
  ];
  const snapshot = payload?.sourceSnapshot;
  const truncatedFieldCount = Array.isArray(payload?.inputRecords)
    ? payload.inputRecords.reduce((count, record) => {
        const fields = record?.truncatedFields;
        return Array.isArray(fields) && fields.every(field => typeof field === 'string')
          ? count + fields.length : Number.NaN;
      }, 0)
    : Number.NaN;
  if (!exactKeys(payload, payloadKeys) ||
      payload.protocol !== 'ngl.bounded-collaborator-packet.v1' ||
      payload.role !== role || payload.objective !== roleSpec.objective ||
      payload.targetMoonshotId !== moonshotId || payload.authority !== 'advisory-only' ||
      !exactKeys(snapshot, ['status', 'worldId', 'revision', 'suppliedEventCount']) ||
      snapshot.status !== 'identified' || !isBoundedIdentifier(snapshot.worldId) ||
      !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 ||
      !Number.isSafeInteger(snapshot.suppliedEventCount) || snapshot.suppliedEventCount < 0 ||
      snapshot.suppliedEventCount > 100_000 ||
      !Array.isArray(payload.inputRefs) || !Array.isArray(payload.inputRecords) ||
      payload.inputRefs.length === 0 || payload.inputRefs.length > 8 ||
      payload.inputRefs.length !== payload.inputRecords.length ||
      payload.inputRefs.some((id, index) => typeof id !== 'string' || id !== payload.inputRecords[index]?.eventId) ||
      new Set(payload.inputRefs).size !== payload.inputRefs.length ||
      !Number.isSafeInteger(payload.truncatedContentFieldCount) ||
      payload.truncatedContentFieldCount !== truncatedFieldCount ||
      !validOmissionDisclosure(payload) ||
      payload.mayWriteCanonicalState !== false || payload.mayGrantAuthority !== false ||
      payload.mayAwardProgress !== false || payload.mayCertifyTruthOrExecution !== false ||
      expectedInputRefs.length !== payload.inputRefs.length ||
      expectedInputRefs.some((id, index) => id !== payload.inputRefs[index])) return null;
  return payload;
}

function packetPayload(packet) {
  if (!isCollaboratorPacket(packet) || packet.available !== true) return null;
  return parsePacketPayload(packet.packetJson, packet.id, packet.moonshotId, packet.inputRefs);
}

function validateRoleResponse(payload, response) {
  const inputIds = new Set(payload.inputRefs);
  const omittedIds = new Set(payload.omittedEventIds);
  const records = new Map(payload.inputRecords.map(record => [record.eventId, record]));

  if (payload.role === 'archivist') {
    const keys = ['eventChainFindings', 'claims', 'linkageIssues', 'unknowns', 'nextChecks'];
    return exactKeys(response, keys) && keys.every(key => boundedStringList(response[key], 32, 1000));
  }

  if (payload.role === 'adversary') {
    const keys = ['targetEventId', 'challengeType', 'challengeDraft', 'distinctnessAssessment',
      'duplicateOfEventIds', 'counterexample', 'evidenceNeeded', 'unknowns'];
    if (!exactKeys(response, keys) || !inputIds.has(response.targetEventId) ||
        records.get(response.targetEventId)?.type !== 'experiment-reported' ||
        !CHALLENGE_TYPES.has(response.challengeType) ||
        !boundedString(response.challengeDraft, 1000) ||
        !boundedString(response.distinctnessAssessment, 1000) ||
        !boundedString(response.counterexample, 1000, { allowEmpty: true }) ||
        !Array.isArray(response.duplicateOfEventIds) ||
        !response.duplicateOfEventIds.every(id => typeof id === 'string' && records.get(id)?.type === 'experiment-challenged') ||
        new Set(response.duplicateOfEventIds).size !== response.duplicateOfEventIds.length ||
        !boundedStringList(response.evidenceNeeded, 16, 1000) || !boundedStringList(response.unknowns, 16, 1000)) return false;
    return true;
  }

  if (payload.role === 'synthesizer') {
    const keys = ['scope', 'recordedSupport', 'contradictions', 'dissentPreserved', 'unknowns', 'nextDiscriminatingExperiment'];
    // Scope is a completeness claim: the response must account for every event
    // supplied and every omission ID disclosed in this exact packet. Dissent is
    // complete only when every included challenge event is named exactly once.
    const includedChallengeIds = new Set(payload.inputRecords
      .filter(record => record?.type === 'experiment-challenged' && typeof record.eventId === 'string')
      .map(record => record.eventId));
    if (!exactKeys(response, keys) ||
        !exactKeys(response.scope, ['moonshotId', 'includedEventIds', 'omittedEventIds']) ||
        response.scope.moonshotId !== payload.targetMoonshotId ||
        !exactStringIds(response.scope.includedEventIds, inputIds) ||
        !exactStringIds(response.scope.omittedEventIds, omittedIds, { maximum: omittedIds.size }) ||
        !sourceStatementList(response.recordedSupport, inputIds, { minimumSources: 1 }) ||
        !sourceStatementList(response.contradictions, inputIds, { minimumSources: 2 }) ||
        !exactStringIds(response.dissentPreserved, includedChallengeIds, { maximum: 32 }) ||
        !boundedStringList(response.unknowns, 32, 1000) ||
        !validNextDiscriminatingExperiment(response.nextDiscriminatingExperiment)) return false;
    return true;
  }

  if (payload.role === 'tutor') {
    const keys = ['concepts', 'prerequisites', 'explanation', 'questions', 'answerKey', 'whatRemainsUnproven'];
    return exactKeys(response, keys) &&
      ['concepts', 'prerequisites', 'questions', 'answerKey', 'whatRemainsUnproven'].every(key => boundedStringList(response[key], 32, 1000)) &&
      boundedString(response.explanation, 4096);
  }

  return false;
}

function validateResponseText(payload, responseText) {
  if (typeof responseText !== 'string' || responseText.trim().length === 0) return reject('RESPONSE_REQUIRED');
  if (new TextEncoder().encode(responseText).byteLength > MAX_RESPONSE_BYTES) return reject('RESPONSE_TOO_LARGE');

  let response;
  try {
    // External model output is untrusted: reject duplicate keys before JSON.parse's
    // last-key-wins behavior can make the reviewed representation ambiguous.
    assertNoDuplicateJsonObjectKeys(responseText, { label: 'COLLABORATOR_RESPONSE', maxDepth: MAX_DEPTH });
    response = JSON.parse(responseText);
  } catch (error) {
    return reject(error?.message === 'COLLABORATOR_RESPONSE_DUPLICATE_JSON_KEY'
      ? 'RESPONSE_DUPLICATE_JSON_KEY'
      : 'RESPONSE_JSON_INVALID');
  }
  if (!ownPlainObject(response) || !safeJsonValue(response)) return reject('RESPONSE_VALUE_INVALID');
  if (!validateRoleResponse(payload, response)) return reject('RESPONSE_SCHEMA_OR_SCOPE_INVALID');

  // Preserve the exact data that passed validation for the human-review view.
  freezeJson(response);
  return Object.freeze({
    valid: true,
    status: 'valid-for-human-review',
    reason: null,
    role: payload.role,
    moonshotId: payload.targetMoonshotId,
    sourceEventIds: Object.freeze([...payload.inputRefs]),
    response
  });
}

/**
 * Validate an external collaborator response against the exact bounded packet.
 * This is structural/scope validation only: it does not verify claims, execute work,
 * record an event, award progress, or grant authority.
 */
export function validateCollaboratorResponse(packet, responseText) {
  const payload = packetPayload(packet);
  if (!payload) return reject('PACKET_INVALID_OR_UNAVAILABLE');
  return validateResponseText(payload, responseText);
}

/**
 * Revalidate archived packet/response bytes without granting a module-issued
 * packet capability. World imports still need independent source-history checks.
 */
export function validateCollaboratorResponseSnapshot({ packetJson, role, moonshotId, sourceEventIds, responseText }) {
  const payload = parsePacketPayload(packetJson, role, moonshotId, sourceEventIds);
  if (!payload) return unavailable('PACKET_INVALID_OR_UNAVAILABLE');
  return validateResponseText(payload, responseText);
}

/**
 * Revalidate a retained collaborator event for read-only Council Chamber display.
 * This binds the summary to one unique actor-scoped event, response ID, packet scope,
 * stored validator result, and exact response bytes. It does not verify provider
 * identity, source truth, execution, independent observation, approval, or authority.
 */
export function validateRetainedCollaboratorResponse(world, eventId, viewer) {
  try {
    if (!isBoundedIdentifier(eventId)) return unavailable('RETAINED_RESPONSE_UNAVAILABLE');
    const events = ownArrayValues(ownDataValue(world, 'events'), 100000);
    if (!events) return unavailable('RETAINED_RESPONSE_UNAVAILABLE');
    const matches = [];
    for (let index = 0; index < events.length; index += 1) {
      if (ownDataValue(events[index], 'id') === eventId) matches.push({ event: events[index], index });
    }
    if (matches.length !== 1) return unavailable('RETAINED_RESPONSE_UNAVAILABLE');
    const { event, index: eventIndex } = matches[0];
    if (!ownPlainObject(event) || ownDataValue(event, 'type') !== 'collaborator-response-recorded') {
      return unavailable('RETAINED_RESPONSE_UNAVAILABLE');
    }

    const actor = ownDataValue(event, 'actor');
    if (!ownPlainObject(actor) || !ownPlainObject(viewer)) return unavailable('RETAINED_RESPONSE_UNAVAILABLE');
    const actorId = ownDataValue(actor, 'id');
    const actorRole = ownDataValue(actor, 'role');
    const viewerId = ownDataValue(viewer, 'id');
    const viewerRole = ownDataValue(viewer, 'role');
    if (!isBoundedIdentifier(actorId) || actorId !== viewerId ||
        !['founder', 'witness'].includes(actorRole) || actorRole !== viewerRole) {
      return unavailable('RETAINED_RESPONSE_ACTOR_MISMATCH');
    }

    const role = ownDataValue(event, 'role');
    const moonshotId = ownDataValue(event, 'moonshotId');
    const responseId = ownDataValue(event, 'responseId');
    if (!COLLABORATOR_ROLES.some(candidate => candidate.id === role) ||
        !isBoundedIdentifier(moonshotId) || !isBoundedIdentifier(responseId) ||
        events.filter(candidate => ownDataValue(candidate, 'responseId') === responseId).length !== 1) {
      return unavailable('RETAINED_RESPONSE_IDENTITY_AMBIGUOUS');
    }

    const sourceEventIds = ownArrayValues(ownDataValue(event, 'sourceEventIds'), 8);
    if (!sourceEventIds || sourceEventIds.length === 0 ||
        sourceEventIds.some(id => !isBoundedIdentifier(id)) ||
        new Set(sourceEventIds).size !== sourceEventIds.length) {
      return unavailable('RETAINED_RESPONSE_SCOPE_INVALID');
    }

    const validator = ownDataValue(event, 'validator');
    const storedStatus = ownDataValue(event, 'validationStatus');
    const storedReason = ownDataValue(event, 'validationReason');
    const packetJson = ownDataValue(event, 'packetJson');
    const responseText = ownDataValue(event, 'responseText');
    if (validator !== 'ngl.collaborator-response.v1' ||
        !['valid-for-human-review', 'rejected'].includes(storedStatus) ||
        typeof packetJson !== 'string' || typeof responseText !== 'string') {
      return unavailable('RETAINED_RESPONSE_UNAVAILABLE');
    }

    const payload = parsePacketPayload(packetJson, role, moonshotId, sourceEventIds);
    if (!payload) return unavailable('RETAINED_RESPONSE_PACKET_INVALID');

    const worldId = ownDataValue(world, 'id');
    const rawCreations = ownDataValue(world, 'creations');
    const creations = rawCreations === undefined ? [] : ownArrayValues(rawCreations, 12);
    if (!isBoundedIdentifier(worldId) || !creations) return unavailable('RETAINED_RESPONSE_SNAPSHOT_INVALID');
    const prefixEvents = events.slice(0, eventIndex);
    const visibleEvents = actorRole === 'founder'
      ? prefixEvents
      : prefixEvents.filter(source => {
          const sourceType = ownDataValue(source, 'type');
          const sourceActor = ownDataValue(source, 'actor');
          return !['draft', 'repair'].includes(sourceType) &&
            (sourceType !== 'message-reported' || ownDataValue(sourceActor, 'id') === actorId);
        });
    const expectedPacket = projectCollaboratorPackets({
      id: worldId,
      revision: eventIndex,
      creations,
      events: visibleEvents
    }).find(candidate => candidate.id === role && candidate.available === true && candidate.moonshotId === moonshotId);
    if (!expectedPacket || expectedPacket.packetJson !== packetJson) {
      return unavailable('RETAINED_RESPONSE_PACKET_MISMATCH');
    }

    const checked = validateResponseText(payload, responseText);
    if (storedStatus !== checked.status || storedReason !== checked.reason) {
      return unavailable('RETAINED_RESPONSE_MISMATCH');
    }

    return Object.freeze({
      ...checked,
      eventId,
      responseId,
      packetScope: Object.freeze({
        includedEventIds: Object.freeze([...payload.inputRefs]),
        omittedCount: payload.omittedCount,
        omittedEventIds: Object.freeze([...payload.omittedEventIds]),
        omittedEventIdListTruncated: payload.omittedEventIdListTruncated
      })
    });
  } catch {
    return unavailable('RETAINED_RESPONSE_UNAVAILABLE');
  }
}
