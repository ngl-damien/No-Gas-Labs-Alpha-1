import { randomUUID } from 'node:crypto';
import { isStrictTimestamp } from './timestamps.mjs';

const clone = value => structuredClone(value);
const uid = prefix => `${prefix}-${randomUUID()}`;
const date = now => new Date(now ?? Date.now()).toISOString();
const fail = (code, message, status = 400) => {
  throw Object.assign(new Error(message), { code, status });
};
const RETRYABILITY = Object.freeze({
  GITHUB_SOURCE_UNAVAILABLE: true,
  SOURCE_CAPTURE_MISMATCH: false,
  SOURCE_ARCHIVE_BUILD_FAILED: true
});

function founderActor(actor) {
  if (!actor || actor.id !== 'damien' || actor.role !== 'founder' ||
      typeof actor.name !== 'string' || !actor.name.trim() ||
      Array.from(actor.name).length > 80) {
    fail('FORBIDDEN', 'A live authenticated Founder request is required to retain a Source Archive service failure.', 403);
  }
  return { id: 'damien', name: actor.name.trim(), role: 'founder' };
}

/**
 * Server-only event writer. This module is intentionally absent from the
 * browser STATIC map and is not an /api/action operation.
 */
export function recordSourceArchiveAttemptFailure(original, actor, details, { now } = {}) {
  const who = founderActor(actor);
  const fields = ['requestIdDigest', 'actionDigest', 'repository', 'commitSha', 'path', 'failureCode'];
  if (!details || typeof details !== 'object' || Array.isArray(details) ||
      Object.keys(details).length !== fields.length || Object.keys(details).some(key => !fields.includes(key))) {
    fail('INVALID_SOURCE_ARCHIVE_FAILURE', 'Source Archive failure metadata has an unexpected shape.');
  }
  const retryable = Object.hasOwn(RETRYABILITY, details.failureCode) ? RETRYABILITY[details.failureCode] : undefined;
  if (retryable === undefined ||
      typeof details.requestIdDigest !== 'string' || !/^[a-f0-9]{64}$/.test(details.requestIdDigest) ||
      typeof details.actionDigest !== 'string' || !/^[a-f0-9]{64}$/.test(details.actionDigest) ||
      typeof details.repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,37}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(details.repository) ||
      typeof details.commitSha !== 'string' || !/^[a-f0-9]{40}$/.test(details.commitSha) ||
      typeof details.path !== 'string' || !details.path.length || details.path.length > 240 ||
      details.path.split('/').some(segment => !segment || segment === '.' || segment === '..') ||
      /[\\\u0000-\u001f\u007f]/.test(details.path)) {
    fail('INVALID_SOURCE_ARCHIVE_FAILURE', 'Source Archive failure metadata is not a bounded canonical public-source reference.');
  }
  if (!original || original.schema !== 'ngl.world.v2' || !Number.isSafeInteger(original.revision) ||
      original.revision < 0 || !Array.isArray(original.events) || !isStrictTimestamp(original.updatedAt)) {
    fail('INVALID_WORLD', 'Source Archive failure requires a valid current world snapshot.');
  }
  if (original.revision >= Number.MAX_SAFE_INTEGER) {
    fail('REVISION_EXHAUSTED', 'The world revision cannot advance safely.', 503);
  }
  const at = date(now);
  const previousAt = Date.parse(original.updatedAt);
  if (!Number.isFinite(previousAt) || !isStrictTimestamp(at) || Date.parse(at) < previousAt) {
    fail('INVALID_CHRONOLOGY', 'Source Archive failure time cannot precede the retained world history.', 409);
  }
  const world = clone(original);
  const attemptId = uid('source-archive-attempt');
  world.events.push({
    id: uid('event'),
    type: 'source-archive-attempt-failed',
    actor: clone(who),
    at,
    attemptId,
    requestIdDigest: details.requestIdDigest,
    actionDigest: details.actionDigest,
    repository: details.repository,
    commitSha: details.commitSha,
    path: details.path,
    failureCode: details.failureCode,
    retryable,
    observedBy: 'shared-source-archive-service',
    semantics: 'Game projection only; XP and buildings do not assert external truth, demand, AI execution or institutional authority.'
  });
  world.revision += 1;
  world.updatedAt = Date.parse(at) > previousAt ? at : original.updatedAt;
  return { world, attemptId };
}
