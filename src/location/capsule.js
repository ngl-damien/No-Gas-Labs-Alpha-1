// NGL Field Capsule v1. Hashes prove byte-equivalent content, NOT physical presence.
import { createHash } from 'node:crypto';
import { isLocationObservation } from './schema.js';
export { isLocationObservation } from './schema.js';

export function canonicalJSON(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
  }
  throw new TypeError('not a finite JSON value');
}

export function createLocationCapsule(event) {
  if (!isLocationObservation(event)) throw new Error('invalid or privilege-bearing location observation');
  const bytes = Buffer.from(canonicalJSON(event), 'utf8');
  return Object.freeze({
    schema: 'ngl.location.capsule.v1',
    event,
    integrity: { algorithm: 'sha256', canonicalization: 'ngl.canonical-json.v1', digest: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }
  });
}

export function verifyLocationCapsule(capsule) {
  const base = { integrity: 'REJECTED', physical_presence: 'UNVERIFIED', founder_authority: 'NONE', quest_completion: 'NOT_GRANTED' };
  if (!capsule || capsule.schema !== 'ngl.location.capsule.v1' || !isLocationObservation(capsule.event)) return { ...base, reason: 'invalid observation or schema' };
  const i = capsule.integrity;
  if (!i || i.algorithm !== 'sha256' || i.canonicalization !== 'ngl.canonical-json.v1' || !/^[a-f0-9]{64}$/.test(i.digest || '') || !Number.isSafeInteger(i.size)) return { ...base, reason: 'invalid digest metadata' };
  let bytes;
  try { bytes = Buffer.from(canonicalJSON(capsule.event), 'utf8'); } catch { return { ...base, reason: 'non-JSON event' }; }
  if (bytes.length !== i.size || createHash('sha256').update(bytes).digest('hex') !== i.digest) return { ...base, reason: 'event changed since digest' };
  return { ...base, integrity: 'MATCH', reason: 'content integrity only; location and consent are not independently authenticated' };
}
