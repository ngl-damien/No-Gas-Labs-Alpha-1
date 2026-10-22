import { createHash } from 'node:crypto';

export class KernelError extends Error {
  constructor(code, message) { super(message); this.name = 'KernelError'; this.code = code; }
}
function fail(code, message) { throw new KernelError(code, message); }
const own = (object, key) => Object.hasOwn(object, key);
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) && !forbidden.has(value);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digestPattern = /^[a-f0-9]{64}$/;

/** Sorted-key JSON, with no lossy values or executable/exotic objects. */
export function canonicalStringify(value) {
  const ancestors = new Set();
  function visit(current, depth = 0) {
    if (depth > 100) fail('INVALID_JSON', 'JSON nesting exceeds 100 levels');
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return JSON.stringify(current);
    if (typeof current === 'number' && Number.isFinite(current)) return JSON.stringify(current);
    if (typeof current !== 'object' || ancestors.has(current)) fail('INVALID_JSON', 'Only finite, acyclic JSON values are accepted');
    const prototype = Object.getPrototypeOf(current);
    if ((!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(current).length) fail('INVALID_JSON', 'Only plain JSON objects are accepted');
    ancestors.add(current);
    const keys = Object.keys(current);
    for (const key of keys) {
      if (forbidden.has(key) || !('value' in Object.getOwnPropertyDescriptor(current, key))) fail('INVALID_JSON', 'Unsafe JSON key or accessor');
    }
    let result;
    if (Array.isArray(current)) {
      if (keys.length !== current.length || keys.some((key, index) => key !== String(index))) fail('INVALID_JSON', 'Sparse or decorated arrays are not JSON');
      result = `[${current.map(item => visit(item, depth + 1)).join(',')}]`;
    } else result = `{${keys.sort().map(key => `${JSON.stringify(key)}:${visit(current[key], depth + 1)}`).join(',')}}`;
    ancestors.delete(current);
    return result;
  }
  return visit(value);
}
const copy = value => JSON.parse(canonicalStringify(value));
const equal = (a, b) => canonicalStringify(a) === canonicalStringify(b);

function bytesOf(bytes) {
  if (typeof bytes === 'string') return Buffer.from(bytes, 'utf8');
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  fail('INVALID_ARTIFACT', 'Artifact must contain actual UTF-8 text or byte data');
}
export function artifactReceipt(bytes) {
  const buffer = bytesOf(bytes);
  return { algorithm: 'sha256', digest: createHash('sha256').update(buffer).digest('hex'), size: buffer.byteLength };
}

function exactKeys(value, required, optional = [], code = 'INVALID_EVENT') {
  if (!isObject(value) || required.some(key => !own(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail(code, 'Unexpected or missing fields');
}
function timestamp(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function requireId(value, label) { if (!identifier(value)) fail('INVALID_EVENT', `Invalid ${label}`); }
function subjectShape(subject) {
  exactKeys(subject, ['id', 'version']);
  requireId(subject.id, 'subject ID');
  if (!Number.isSafeInteger(subject.version) || subject.version < 1) fail('INVALID_EVENT', 'Subject version must be a positive integer');
}
function outputShape(outputs) {
  if (!Array.isArray(outputs) || outputs.length < 1 || outputs.length > 32) fail('INVALID_EVENT', 'Execution requires between one and 32 outputs');
  const digests = new Set();
  for (const receipt of outputs) {
    exactKeys(receipt, ['algorithm', 'digest', 'size']);
    if (receipt.algorithm !== 'sha256' || !digestPattern.test(receipt.digest) || !Number.isSafeInteger(receipt.size) || receipt.size < 0 || digests.has(receipt.digest)) fail('INVALID_EVENT', 'Invalid or repeated output receipt');
    digests.add(receipt.digest);
  }
}
function verifyOutputs(outputs, artifacts) {
  for (const receipt of outputs) {
    const bytes = artifacts instanceof Map ? artifacts.get(receipt.digest) : artifacts && own(artifacts, receipt.digest) ? artifacts[receipt.digest] : undefined;
    if (bytes === undefined) fail('ARTIFACT_MISSING', `Actual bytes required for ${receipt.digest}`);
    if (!equal(artifactReceipt(bytes), receipt)) fail('ARTIFACT_MISMATCH', `Artifact bytes differ from receipt ${receipt.digest}`);
  }
}
function actor(state, id) {
  if (typeof id !== 'string') fail('INVALID_EVENT', 'Actor must be a configured identity ID');
  const actor = state.actors.find(candidate => candidate.id === id);
  if (!actor) fail('UNKNOWN_ACTOR', 'Actor is not enrolled in the trusted roster');
  return actor;
}
function founder(state, id) { if (id !== state.founderId) fail('FOUNDER_REQUIRED', 'Only the configured Founder may issue or adjudicate authority'); }
function role(state, id, required) { if (!actor(state, id).roles.includes(required)) fail('ROLE_REQUIRED', `Configured ${required} role required`); }
function nextSubject(state, subject) {
  const current = own(state.subjects, subject.id) ? state.subjects[subject.id].version : 0;
  if (subject.version !== current + 1) fail('STALE_SUBJECT', 'Subject version must immediately follow the accepted version');
}

/** Roster is supplied by the trusted host, never by incoming events. IDs do not prove independent humans. */
export function createKernel({ actors, founderId } = {}) {
  if (!identifier(founderId) || !Array.isArray(actors) || actors.length < 1 || actors.length > 128) fail('INVALID_CONFIG', 'A trusted actor roster and Founder ID are required');
  const roster = copy(actors);
  const ids = new Set();
  for (const enrolled of roster) {
    exactKeys(enrolled, ['id', 'roles'], ['kind', 'name'], 'INVALID_CONFIG');
    if (!identifier(enrolled.id) || ids.has(enrolled.id) || !Array.isArray(enrolled.roles) || enrolled.roles.length < 1 || new Set(enrolled.roles).size !== enrolled.roles.length || enrolled.roles.some(item => !['founder', 'executor', 'observer'].includes(item))) fail('INVALID_CONFIG', 'Invalid actor roster entry');
    if (enrolled.kind !== undefined && !['human', 'local-process', 'external-key'].includes(enrolled.kind)) fail('INVALID_CONFIG', 'Invalid identity kind');
    if (enrolled.name !== undefined && (typeof enrolled.name !== 'string' || enrolled.name.length > 160)) fail('INVALID_CONFIG', 'Invalid actor name');
    if (enrolled.roles.includes('founder') !== (enrolled.id === founderId)) fail('INVALID_CONFIG', 'Exactly the configured Founder must hold the Founder role');
    ids.add(enrolled.id);
  }
  if (!ids.has(founderId)) fail('INVALID_CONFIG', 'Founder is absent from the roster');
  return { schema: 'ngl.institution.v1', revision: 0, founderId, actors: roster, works: {}, subjects: {}, grants: {}, events: [] };
}

const fields = {
  claim: ['subject', 'action'],
  authorize: ['grantId', 'executorId', 'observerId', 'scope'],
  execute: ['grantId', 'executionId', 'subject', 'outputs'],
  observe: ['grantId', 'executionId', 'subject', 'outputs', 'passed'],
  adjudicate: ['grantId', 'executionId', 'subject', 'outputs', 'observationId', 'decision'],
  revoke: ['grantId', 'reason'],
};

/** Pure deterministic transition. Artifact stages verify supplied actual bytes synchronously. */
export function applyEvent(state, input, { artifacts } = {}) {
  const event = copy(input);
  const base = ['id', 'type', 'actor', 'at', 'expectedRevision', 'workId'];
  if (!own(fields, event?.type)) fail('INVALID_EVENT', 'Unknown institutional event type');
  exactKeys(event, [...base, ...fields[event.type]], event.type === 'authorize' ? ['expiresAt'] : event.type === 'observe' ? ['checks'] : []);
  requireId(event.id, 'event ID');
  const prior = state.events.find(candidate => candidate.id === event.id);
  if (prior) {
    if (!equal(prior, event)) fail('EVENT_ID_CONFLICT', 'An event ID cannot identify different content');
    return state;
  }
  actor(state, event.actor);
  requireId(event.workId, 'work ID');
  if (!timestamp(event.at)) fail('INVALID_EVENT', 'Event timestamp must be canonical ISO UTC');
  if (state.events.length && event.at < state.events.at(-1).at) fail('TIME_REGRESSION', 'Event time cannot precede committed history');
  if (!Number.isSafeInteger(event.expectedRevision) || event.expectedRevision !== state.revision) fail('STALE_REVISION', 'Expected revision does not match committed state');
  const next = copy(state);
  let work = own(next.works, event.workId) ? next.works[event.workId] : undefined;
  if (event.type === 'claim') {
    if (work) fail('WORK_EXISTS', 'Work ID is already claimed');
    subjectShape(event.subject);
    if (typeof event.action !== 'string' || !event.action.trim() || event.action.length > 160) fail('INVALID_EVENT', 'An exact nonempty action is required');
    nextSubject(state, event.subject);
    work = next.works[event.workId] = { id: event.workId, stage: 'claimed', claimantId: event.actor, claimId: event.id, subject: event.subject, action: event.action };
  } else {
    if (!work) fail('UNKNOWN_WORK', 'Work must be claimed first');
    if (event.type === 'authorize') {
      founder(state, event.actor);
      if (work.stage !== 'claimed') fail('INVALID_STAGE', 'Authority can follow only a claim');
      requireId(event.grantId, 'grant ID');
      if (own(next.grants, event.grantId)) fail('GRANT_EXISTS', 'Grant ID is already in use');
      if (event.executorId === event.observerId) fail('SELF_OBSERVATION', 'Executor and observer identities must differ');
      role(state, event.executorId, 'executor');
      role(state, event.observerId, 'observer');
      exactKeys(event.scope, ['subjectId', 'subjectVersion', 'action']);
      if (!equal(event.scope, { subjectId: work.subject.id, subjectVersion: work.subject.version, action: work.action })) fail('SCOPE_MISMATCH', 'Grant must match the exact claimed subject, version and action');
      if (event.expiresAt !== undefined && (!timestamp(event.expiresAt) || event.expiresAt <= event.at)) fail('INVALID_EVENT', 'Grant expiry must follow authorization');
      const grant = { id: event.grantId, workId: event.workId, executorId: event.executorId, observerId: event.observerId, scope: event.scope, authorizedBy: event.actor, authorizedAt: event.at, revoked: false };
      if (event.expiresAt !== undefined) grant.expiresAt = event.expiresAt;
      next.grants[event.grantId] = grant;
      work.grantId = event.grantId;
      work.stage = 'authorized';
    } else {
      const grant = next.grants[work.grantId];
      if (!grant) fail('INVALID_STAGE', 'An exact Founder grant must precede this stage');
      if (event.grantId !== grant.id) fail('BINDING_MISMATCH', 'Grant does not belong to this work');
      if (event.type === 'revoke') {
        founder(state, event.actor);
        if (['accepted', 'rejected', 'revoked'].includes(work.stage)) fail('INVALID_STAGE', 'Completed work cannot be revoked retroactively');
        if (typeof event.reason !== 'string' || !event.reason.trim() || event.reason.length > 2000) fail('INVALID_EVENT', 'Revocation requires a bounded reason');
        grant.revoked = true;
        grant.revocationId = event.id;
        work.stage = 'revoked';
      } else {
        if (grant.revoked) fail('GRANT_REVOKED', 'Grant has been revoked');
        if (grant.expiresAt && event.at >= grant.expiresAt) fail('GRANT_EXPIRED', 'Grant has expired at the event time');
        subjectShape(event.subject);
        outputShape(event.outputs);
        requireId(event.executionId, 'execution ID');
        if (!equal(event.subject, work.subject)) fail('BINDING_MISMATCH', 'Subject or version differs from the authorized claim');
        if (event.type === 'execute') {
          if (work.stage !== 'authorized') fail('INVALID_STAGE', 'Execution can follow only authorization');
          if (event.actor !== grant.executorId) fail('EXECUTOR_MISMATCH', 'Execution actor differs from the exact grant');
          if (Object.values(next.works).some(candidate => candidate.executionId === event.executionId)) fail('EXECUTION_EXISTS', 'Execution IDs are unique across work');
          nextSubject(state, work.subject);
          verifyOutputs(event.outputs, artifacts);
          work.executionId = event.executionId;
          work.executionEventId = event.id;
          work.outputs = event.outputs;
          work.stage = 'executed';
        } else {
          if (event.executionId !== work.executionId || !equal(event.outputs, work.outputs)) fail('BINDING_MISMATCH', 'Execution and exact ordered outputs must match');
          if (event.type === 'observe') {
            if (event.actor === grant.executorId) fail('SELF_OBSERVATION', 'An executor cannot observe its own execution');
            if (event.actor !== grant.observerId) fail('OBSERVER_MISMATCH', 'Observer actor differs from the exact grant');
            if (work.stage !== 'executed') fail('INVALID_STAGE', 'Observation can follow only execution');
            if (typeof event.passed !== 'boolean' || (event.checks !== undefined && !Array.isArray(event.checks))) fail('INVALID_EVENT', 'Observation requires a boolean result and optional JSON check list');
            verifyOutputs(event.outputs, artifacts);
            work.observationId = event.id;
            work.observedBy = event.actor;
            work.observationPassed = event.passed;
            work.stage = 'observed';
          } else {
            founder(state, event.actor);
            if (work.stage !== 'observed') fail('INVALID_STAGE', 'Adjudication can follow only observation');
            if (event.observationId !== work.observationId) fail('BINDING_MISMATCH', 'Adjudication must identify the exact observation');
            if (!['accept', 'reject'].includes(event.decision)) fail('INVALID_EVENT', 'Adjudication decision must be accept or reject');
            if (event.decision === 'accept') {
              if (!work.observationPassed) fail('OBSERVATION_FAILED', 'Failed observation cannot be accepted');
              nextSubject(state, work.subject);
              next.subjects[work.subject.id] = { id: work.subject.id, version: work.subject.version, workId: work.id, executionId: work.executionId, outputs: work.outputs, acceptedAt: event.at };
            }
            work.adjudicationId = event.id;
            work.stage = event.decision === 'accept' ? 'accepted' : 'rejected';
          }
        }
      }
    }
  }
  next.events.push(event);
  next.revision += 1;
  return next;
}

export function replayKernel(events, config, options = {}) {
  if (!Array.isArray(events)) fail('INVALID_EVENT', 'Replay requires an event array');
  return events.reduce((state, event) => applyEvent(state, event, options), createKernel(config));
}
