import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { buildEnrollmentCandidate, main } from '../scripts/founder-enroll-ceremony.mjs';

function keyPair() {
  return generateKeyPairSync('ec', { namedCurve: 'P-256' });
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
  assert.match(candidate.instruction, /separate, explicit enrollment step/);
});

test('default ceremony does not persist a private key or emit an enrolled anchor', () => {
  const pair = keyPair();
  const output = [];
  let writes = 0;
  const candidate = main([], {
    generateKeyPairSync: () => pair,
    writePrivateKey: () => { writes += 1; },
    log: value => output.push(String(value)),
    now: new Date('2026-11-03T00:00:00.000Z')
  });

  assert.equal(writes, 0);
  assert.equal(candidate.status, 'NOT_ENROLLED');
  assert.equal(candidate.enrolled, false);
  assert.equal(candidate.mode, null);
  assert.match(output.join('\n'), /No private key was persisted/);
  assert.doesNotMatch(output.join('\n'), /"d"\s*:/);
});

test('explicit private-file output still produces only a NOT_ENROLLED candidate', () => {
  const pair = keyPair();
  const output = [];
  let writtenPath = null;
  let writtenPrivateJwk = null;
  const candidate = main(['--write-private-path', 'C:\\private\\founder.jwk'], {
    generateKeyPairSync: () => pair,
    writePrivateKey: (file, jwk) => {
      writtenPath = file;
      writtenPrivateJwk = jwk;
    },
    log: value => output.push(String(value)),
    now: new Date('2026-11-03T00:00:00.000Z')
  });

  assert.equal(writtenPath, 'C:\\private\\founder.jwk');
  assert.equal(typeof writtenPrivateJwk.d, 'string');
  assert.equal(candidate.status, 'NOT_ENROLLED');
  assert.equal(candidate.enrolled, false);
  assert.equal(candidate.mode, null);
  assert.match(output.join('\n'), /raw local file; this is not a hardware-backed keystore/);
});

test('missing private-key destination fails before key generation or output', () => {
  let generated = 0;
  let logged = 0;
  assert.throws(
    () => main(['--write-private-path'], {
      generateKeyPairSync: () => { generated += 1; return keyPair(); },
      log: () => { logged += 1; }
    }),
    /FOUNDER_PRIVATE_KEY_PATH_REQUIRED/
  );
  assert.equal(generated, 0);
  assert.equal(logged, 0);
});
