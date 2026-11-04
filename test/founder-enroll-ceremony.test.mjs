import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildEnrollmentCandidate,
  formatEnrollmentError,
  main
} from '../scripts/founder-enroll-ceremony.mjs';
import { authorizationEvent, loadTrustAnchor } from '../src/authority/decision.js';

function keyPair() {
  return generateKeyPairSync('ec', { namedCurve: 'P-256' });
}

async function temporaryDirectory(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('enrollment candidate remains NOT_ENROLLED until a separate custody decision', () => {
  const { publicKey } = keyPair();
  const candidate = buildEnrollmentCandidate(publicKey, {
    now: new Date('2026-11-03T00:00:00.000Z')
  });

  assert.equal(candidate.schema, 'ngl.founder-enrollment-candidate.v1');
  assert.equal(candidate.status, 'NOT_ENROLLED');
  assert.equal(candidate.enrolled, false);
  assert.equal(candidate.mode, null);
  assert.equal(typeof candidate.fingerprint, 'string');
  assert.equal(candidate.fingerprint.length, 64);
  assert.equal(Object.hasOwn(candidate.public_key_jwk, 'd'), false);
  assert.equal(Object.isFrozen(candidate.public_key_jwk), true);
  const originalX = candidate.public_key_jwk.x;
  assert.throws(() => { candidate.public_key_jwk.x = 'tampered'; }, TypeError);
  assert.equal(candidate.public_key_jwk.x, originalX);
  const expectedFingerprint = createHash('sha256')
    .update(JSON.stringify({
      kty: candidate.public_key_jwk.kty,
      crv: candidate.public_key_jwk.crv,
      x: candidate.public_key_jwk.x,
      y: candidate.public_key_jwk.y
    }))
    .digest('hex');
  assert.equal(candidate.fingerprint, expectedFingerprint);
  assert.match(candidate.instruction, /separate, explicit enrollment step/);
});

test('default ceremony emits only a public NOT_ENROLLED candidate', () => {
  const pair = keyPair();
  const output = [];
  let generated = 0;
  const candidate = main([], {
    generateKeyPairSync: () => { generated += 1; return pair; },
    log: value => output.push(String(value)),
    now: new Date('2026-11-03T00:00:00.000Z')
  });

  assert.equal(generated, 1);
  assert.equal(candidate.status, 'NOT_ENROLLED');
  assert.equal(candidate.enrolled, false);
  assert.equal(candidate.mode, null);
  assert.match(output.join('\n'), /No private key was persisted/);
  assert.match(output.join('\n'), /Raw private-key export is disabled/);
  assert.doesNotMatch(output.join('\n'), /"d"\s*:/);
});

test('raw private-key file export is rejected before key generation or output', () => {
  let generated = 0;
  let logged = 0;
  let caught;
  assert.throws(
    () => main(['--write-private-path', '/secure/founder.jwk'], {
      generateKeyPairSync: () => { generated += 1; return keyPair(); },
      log: () => { logged += 1; }
    }),
    error => {
      caught = error;
      return error.code === 'FOUNDER_PRIVATE_KEY_EXPORT_UNSUPPORTED';
    }
  );
  assert.equal(generated, 0);
  assert.equal(logged, 0);
  assert.equal(
    formatEnrollmentError(caught),
    'FOUNDER_PRIVATE_KEY_EXPORT_UNSUPPORTED: Raw private-key file export is disabled; use a platform-backed, non-extractable keystore flow before enrollment.'
  );
});

test('unknown command-line arguments fail before key generation or output', () => {
  let generated = 0;
  let logged = 0;
  assert.throws(
    () => main(['--write-private-pat', '/secure/founder.jwk'], {
      generateKeyPairSync: () => { generated += 1; return keyPair(); },
      log: () => { logged += 1; }
    }),
    error => error.code === 'FOUNDER_ENROLLMENT_ARGUMENT_INVALID'
  );
  assert.equal(generated, 0);
  assert.equal(logged, 0);
});

test('copied enrollment candidate is rejected and default authorization remains fail-closed', async t => {
  const directory = await temporaryDirectory(t, 'ngl-enroll-candidate-');
  const trustPath = join(directory, 'founder.pub.json');
  const { publicKey } = keyPair();
  const candidate = buildEnrollmentCandidate(publicKey);

  await writeFile(trustPath, JSON.stringify(candidate));
  const trust = loadTrustAnchor(trustPath);
  assert.equal(trust.enrolled, false);
  assert.ok(['NOT_ENROLLED', 'MALFORMED_TRUST_ANCHOR'].includes(trust.reason));
  assert.throws(
    () => authorizationEvent({ signed: {}, payload: {} }),
    /FOUNDER_NOT_ENROLLED:NOT_ENROLLED/
  );
});

test('enrollment error formatting never leaks raw filesystem paths or malformed codes', () => {
  const code = 'FOUNDER_PRIVATE_KEY_EXPORT_UNSUPPORTED';
  const error = Object.assign(new Error('/private/founder.jwk: EIO'), { code });
  const formatted = formatEnrollmentError(error);

  assert.equal(formatted.includes('/private/founder.jwk'), false);
  assert.equal(formatted.includes('EIO'), false);
  assert.match(formatted, /^FOUNDER_PRIVATE_KEY_EXPORT_UNSUPPORTED:/);

  const systemError = Object.assign(new Error('open /private/founder.jwk failed'), { code: 'EIO' });
  assert.equal(formatEnrollmentError(systemError), 'EIO');
  const malformedCode = Object.assign(new Error('unsafe diagnostic'), { code: 'EIO\n/private/founder.jwk' });
  assert.equal(formatEnrollmentError(malformedCode), 'FOUNDER_ENROLLMENT_FAILED');
  assert.equal(formatEnrollmentError(new Error('open /private/founder.jwk failed')), 'FOUNDER_ENROLLMENT_FAILED');
});
