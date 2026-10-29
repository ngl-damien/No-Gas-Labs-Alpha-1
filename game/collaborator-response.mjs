import { isCollaboratorPacket, MAX_PACKET_OMITTED_IDS, MAX_PACKET_ID_CHARS } from './collaborator-contracts.mjs';
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
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_PACKET_ID_CHARS ||
        id.trim() !== id || includedIds.has(id) || seen.has(id)) return false;
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

function packetPayload(packet) {
  if (!isCollaboratorPacket(packet) || packet.available !== true || typeof packet.packetJson !== 'string' ||
      new TextEncoder().encode(packet.packetJson).byteLength > MAX_RESPONSE_BYTES) return null;
  let payload;
  try { payload = JSON.parse(packet.packetJson); } catch { return null; }
  if (!ownPlainObject(payload) || payload.protocol !== 'ngl.bounded-collaborator-packet.v1' ||
      payload.role !== packet.id || payload.targetMoonshotId !== packet.moonshotId ||
      !Array.isArray(payload.inputRefs) || !Array.isArray(payload.inputRecords) ||
      payload.inputRefs.length !== payload.inputRecords.length ||
      payload.inputRefs.some((id, index) => typeof id !== 'string' || id !== payload.inputRecords[index]?.eventId) ||
      new Set(payload.inputRefs).size !== payload.inputRefs.length ||
      !validOmissionDisclosure(payload) ||
      payload.mayWriteCanonicalState !== false || payload.mayGrantAuthority !== false ||
      payload.mayAwardProgress !== false || payload.mayCertifyTruthOrExecution !== false) return null;
  if (!Array.isArray(packet.inputRefs) || packet.inputRefs.length !== payload.inputRefs.length ||
      packet.inputRefs.some((id, index) => id !== payload.inputRefs[index])) return null;
  return payload;
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

/**
 * Validate an external collaborator response against the exact bounded packet.
 * This is structural/scope validation only: it does not verify claims, execute work,
 * record an event, award progress, or grant authority.
 */
export function validateCollaboratorResponse(packet, responseText) {
  const payload = packetPayload(packet);
  if (!payload) return reject('PACKET_INVALID_OR_UNAVAILABLE');
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
