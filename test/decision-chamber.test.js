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

test('enrolled TEST_ONLY key authorizes the exact signed decision through the current API', () => {
  const verification = verifyFounderDecision({
    signed,
    payload,
    public_key_jwk: jwk,
    expected_fingerprint: fingerprint,
    now: 0
  });
  assert.equal(verification.valid, true);
  const event = authorizationEvent({ signed, payload, trustPath, now: 0 });
  assert.equal(event.proposal_id, 'p1');
  assert.equal(event.verified_in_process, true);
  assert.equal(event.trust_mode, 'TEST_ONLY');
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

test('authorizationEvent ignores caller-supplied verification.valid and re-verifies the signed receipt', () => {
  const forged = { ...signed, signature: Buffer.alloc(64).toString('base64url') };
  assert.throws(() => authorizationEvent({
    signed: forged,
    payload,
    trustPath,
    now: 0,
    verification: { valid: true }
  }), /FOUNDER_DECISION_INVALID:SIGNATURE_INVALID/);
});
