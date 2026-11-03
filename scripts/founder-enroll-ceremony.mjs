#!/usr/bin/env node
/**
 * Founder enrollment candidate ceremony — run on Founder's device only.
 *
 * This command creates a public-key candidate, not an enrolled trust anchor.
 * The candidate remains NOT_ENROLLED until Founder-controlled private-key
 * custody is independently verified and a separate enrollment decision is made.
 *
 * A private JWK file is optional and is a raw local file, not a hardware-backed
 * keystore. The script never writes docs/authority/founder.pub.json.
 */
import { generateKeyPairSync, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function buildEnrollmentCandidate(publicKey, { now = new Date() } = {}) {
  const jwk = publicKey.export({ format: 'jwk' });
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }))
    .digest('hex');

  return Object.freeze({
    schema: 'ngl.founder-enrollment-candidate.v1',
    status: 'NOT_ENROLLED',
    enrolled: false,
    mode: null,
    public_key_jwk: jwk,
    fingerprint,
    candidate_created_at: now.toISOString(),
    instruction: 'Candidate only. Do not copy as an enrolled trust anchor. Verify independent private-key custody and Founder control before a separate, explicit enrollment step.'
  });
}

export function main(argv = process.argv.slice(2), options = {}) {
  const log = options.log ?? console.log;
  const generate = options.generateKeyPairSync ?? generateKeyPairSync;
  const writePrivateKey = options.writePrivateKey ?? ((file, jwk) => {
    writeFileSync(file, JSON.stringify(jwk, null, 2), { mode: 0o600 });
  });

  const privatePathFlag = argv.indexOf('--write-private-path');
  if (privatePathFlag !== -1 && (!argv[privatePathFlag + 1] || argv[privatePathFlag + 1].startsWith('--'))) {
    throw new Error('FOUNDER_PRIVATE_KEY_PATH_REQUIRED');
  }

  const { publicKey, privateKey } = generate('ec', { namedCurve: 'P-256' });
  const candidate = buildEnrollmentCandidate(publicKey, { now: options.now ?? new Date() });

  // Persist first. If an explicitly requested write fails, do not print a
  // candidate that could be mistaken for a completed enrollment ceremony.
  if (privatePathFlag !== -1) {
    writePrivateKey(argv[privatePathFlag + 1], privateKey.export({ format: 'jwk' }));
  }

  log(JSON.stringify(candidate, null, 2));
  if (privatePathFlag !== -1) {
    log('\n# Private JWK written to a raw local file; this is not a hardware-backed keystore.');
  } else {
    log('\n# No private key was persisted. This candidate remains NOT_ENROLLED and cannot authorize.');
  }
  log('# Do not change status/enrolled or copy this candidate as an enrolled trust anchor until Founder-controlled custody is independently verified.');
  return candidate;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error?.code || error?.message || 'FOUNDER_ENROLLMENT_FAILED');
    process.exitCode = 1;
  }
}
