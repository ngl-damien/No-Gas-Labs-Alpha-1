import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineQuest } from '../src/quest/engine.js';
import { proposeGuildAction } from '../src/world/guild-hall.js';
import {
  makeDecisionPayload,
  decisionDigest,
  verifyFounderDecision,
  authorizationEvent,
  loadTrustAnchor,
  newNonce
} from '../src/authority/decision.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' });
const fingerprint = createHash('sha256')
  .update(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }))
  .digest('hex');

const trustDirectory = mkdtempSync(join(tmpdir(), 'ngl-decision-chamber-'));
const trustPath = join(trustDirectory, 'founder.pub.json');
writeFileSync(trustPath, JSON.stringify({
  schema: 'ngl.founder-trust-anchor.v1',
  status: 'ENROLLED',
  enrolled: true,
  mode: 'TEST_ONLY',
  public_key_jwk: jwk,
  fingerprint
}));

test.after(() => rmSync(trustDirectory, { recursive: true, force: true }));

const quest = defineQuest({
  quest_id: 'q1',
  title: 'Alpha',
  objective: 'Build',
  acceptance: ['mesh'],
  capabilities: ['repository.write']
});
const proposal = proposeGuildAction({
  quest_id: 'q1',
  proposal_id: 'p1',
  actor: 'guild',
  summary: 'Build Mesh',
  capability: 'repository.write'
});
const payload = makeDecisionPayload({
  proposal,
  quest,
  capabilities: ['repository.write'],
  outputs: ['mesh'],
  acceptance: ['mesh'],
  expires_at: '2099-01-01T00:00:00.000Z'
});
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const signed = {
  payload_sha256: decisionDigest(payload),
  key_fingerprint: fingerprint,
  signature: sign('sha256', Buffer.from(canonical(payload)), privateKey).toString('base64url'),
  nonce: newNonce()
};

test('TEST_ONLY trust is inspectable and cryptographically valid but cannot authorize through a caller-selected path', () => {
  const verification = verifyFounderDecision({
    signed,
    payload,
    public_key_jwk: jwk,
    expected_fingerprint: fingerprint,
    now: 0
  });
  assert.equal(verification.valid, true);
  assert.equal(loadTrustAnchor(trustPath).mode, 'TEST_ONLY');
  assert.throws(
    () => authorizationEvent({ signed, payload, trustPath, now: 0 }),
    /FOUNDER_AUTHORIZATION_INPUT_INVALID/
  );
  assert.throws(
    () => authorizationEvent({ signed, payload }),
    /FOUNDER_NOT_ENROLLED/
  );
});

test('changing capability after signature invalidates the ruling', () => {
  const changed = { ...payload, capabilities: ['repository.admin'] };
  assert.equal(verifyFounderDecision({
    signed, payload: changed, public_key_jwk: jwk, expected_fingerprint: fingerprint, now: 0
  }).valid, false);
});

test('changing expected output after signature invalidates the ruling', () => {
  const changed = { ...payload, outputs: ['different-artifact'] };
  assert.equal(verifyFounderDecision({
    signed, payload: changed, public_key_jwk: jwk, expected_fingerprint: fingerprint, now: 0
  }).valid, false);
});

test('an unenrolled fingerprint cannot exercise Founder authority', () => {
  assert.deepEqual(verifyFounderDecision({
    signed, payload, public_key_jwk: jwk, expected_fingerprint: 'other', now: 0
  }), { valid: false, reason: 'KEY_NOT_ENROLLED' });
});

test('an expired exact signature is not current authority', () => {
  assert.deepEqual(verifyFounderDecision({
    signed,
    payload,
    public_key_jwk: jwk,
    expected_fingerprint: fingerprint,
    now: Date.parse('2100-01-01T00:00:00.000Z')
  }), { valid: false, reason: 'DECISION_EXPIRED' });
});

test('authorizationEvent rejects caller-supplied trust, clock, replay and verification inputs', () => {
  const forged = { ...signed, signature: Buffer.alloc(64).toString('base64url') };
  assert.throws(() => authorizationEvent({
    signed: forged,
    payload,
    trustPath,
    now: 0,
    consumed_nonces: new Set(),
    verification: { valid: true }
  }), /FOUNDER_AUTHORIZATION_INPUT_INVALID/);
  assert.throws(
    () => authorizationEvent({ signed: forged, payload, verification: { valid: true } }),
    /FOUNDER_AUTHORIZATION_INPUT_INVALID/
  );
});
