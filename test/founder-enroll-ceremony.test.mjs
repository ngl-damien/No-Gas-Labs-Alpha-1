import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  assert.deepEqual(Object.keys(candidate.public_key_jwk).sort(), ['crv', 'kty', 'x', 'y']);
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

test('candidate builder rejects non-P-256 keys and private KeyObjects before fingerprinting', () => {
  const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const p256 = keyPair();

  for (const unsupported of [p384.publicKey, rsa.publicKey, p256.privateKey]) {
    let caught;
    assert.throws(
      () => buildEnrollmentCandidate(unsupported),
      error => {
        caught = error;
        return error.code === 'FOUNDER_ENROLLMENT_PUBLIC_KEY_INVALID';
      }
    );
    assert.match(formatEnrollmentError(caught), /^FOUNDER_ENROLLMENT_PUBLIC_KEY_INVALID:/);
  }
});

test('default ceremony refuses to generate an unusable candidate without a platform keystore', () => {
  const output = [];
  assert.throws(
    () => main([], { log: value => output.push(String(value)) }),
    error => error.code === 'FOUNDER_KEYSTORE_UNAVAILABLE'
  );
  assert.deepEqual(output, []);
});

test('help explains the unavailable keystore without generating or emitting a candidate', () => {
  const output = [];
  const result = main(['--help'], { log: value => output.push(String(value)) });
  const rendered = output.join('\n');

  assert.equal(result, null);
  assert.match(rendered, /No key is generated/);
  assert.match(rendered, /platform-backed, non-extractable keystore/);
  assert.match(rendered, /Raw private-key file export is disabled/);
  assert.doesNotMatch(rendered, /public_key_jwk/);
});

test('actual CLI exits before emitting a candidate when no platform keystore is available', () => {
  const scriptPath = fileURLToPath(new URL('../scripts/founder-enroll-ceremony.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /FOUNDER_KEYSTORE_UNAVAILABLE/);
  assert.match(result.stderr, /No platform-backed,? non-extractable keystore is configured/);
  assert.doesNotMatch(result.stdout + result.stderr, /"private_key_jwk"|-----BEGIN PRIVATE KEY-----/);
});

test('actual CLI help exits successfully without generating or emitting a candidate', () => {
  const scriptPath = fileURLToPath(new URL('../scripts/founder-enroll-ceremony.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath, '--help'], { encoding: 'utf8' });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /No key is generated/);
  assert.doesNotMatch(result.stdout, /public_key_jwk/);
});

test('raw private-key file export is rejected before output in split and equals forms', () => {
  let logged = 0;
  for (const args of [
    ['--write-private-path', '/secure/founder.jwk'],
    ['--write-private-path=/secure/founder.jwk']
  ]) {
    let caught;
    assert.throws(
      () => main(args, { log: () => { logged += 1; } }),
      error => {
        caught = error;
        return error.code === 'FOUNDER_PRIVATE_KEY_EXPORT_UNSUPPORTED';
      }
    );
    assert.equal(
      formatEnrollmentError(caught),
      'FOUNDER_PRIVATE_KEY_EXPORT_UNSUPPORTED: Raw private-key file export is disabled; use a platform-backed, non-extractable keystore flow before enrollment.'
    );
  }
  assert.equal(logged, 0);
});

test('unknown command-line arguments fail before output', () => {
  let logged = 0;
  assert.throws(
    () => main(['--write-private-pat', '/secure/founder.jwk'], {
      log: () => { logged += 1; }
    }),
    error => error.code === 'FOUNDER_ENROLLMENT_ARGUMENT_INVALID'
  );
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
