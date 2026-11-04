#!/usr/bin/env node
/**
 * Founder enrollment candidate ceremony — run on Founder's device only.
 *
 * This command creates a public-key candidate, not an enrolled trust anchor.
 * The candidate remains NOT_ENROLLED until Founder-controlled private-key
 * custody is independently verified and a separate enrollment decision is made.
 *
 * Raw private-key file export is deliberately disabled. This Node ceremony
 * cannot provide descriptor-relative, non-extractable key custody. A future
 * platform-specific Android Keystore / secure-enclave adapter must own that
 * operation before any production enrollment is possible.
 */
import { generateKeyPairSync, createHash, KeyObject } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

const SAFE_ENROLLMENT_ERROR_DETAILS = Object.freeze({
  FOUNDER_PRIVATE_KEY_EXPORT_UNSUPPORTED:
    'Raw private-key file export is disabled; use a platform-backed, non-extractable keystore flow before enrollment.',
  FOUNDER_ENROLLMENT_PUBLIC_KEY_INVALID:
    'Only a public P-256 elliptic-curve key with canonical 32-byte coordinates can produce an enrollment candidate.'
});

export function formatEnrollmentError(error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,96}$/.test(error.code)
    ? error.code
    : null;
  if (!code) return 'FOUNDER_ENROLLMENT_FAILED';
  const detail = SAFE_ENROLLMENT_ERROR_DETAILS[code];
  return detail ? `${code}: ${detail}` : code;
}

function validateArguments(argv) {
  if (!Array.isArray(argv) || argv.some(argument => typeof argument !== 'string')) {
    throw failure('FOUNDER_ENROLLMENT_ARGUMENT_INVALID', 'Enrollment arguments must be strings.');
  }
  if (argv.includes('--write-private-path')) {
    throw failure(
      'FOUNDER_PRIVATE_KEY_EXPORT_UNSUPPORTED',
      'Raw private-key file export is disabled until a platform-backed, non-extractable keystore adapter is available.'
    );
  }
  if (argv.length > 0) {
    throw failure('FOUNDER_ENROLLMENT_ARGUMENT_INVALID', 'This candidate ceremony accepts no command-line arguments.');
  }
}

function isCanonicalP256Coordinate(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === value;
}

function exportPublicP256Jwk(publicKey) {
  if (!(publicKey instanceof KeyObject) ||
      publicKey.type !== 'public' ||
      publicKey.asymmetricKeyType !== 'ec') {
    throw failure(
      'FOUNDER_ENROLLMENT_PUBLIC_KEY_INVALID',
      'Enrollment candidates require a public P-256 elliptic-curve key.'
    );
  }

  let jwk;
  try {
    jwk = publicKey.export({ format: 'jwk' });
  } catch {
    throw failure(
      'FOUNDER_ENROLLMENT_PUBLIC_KEY_INVALID',
      'Enrollment candidates require an exportable public P-256 elliptic-curve key.'
    );
  }

  if (jwk.kty !== 'EC' ||
      jwk.crv !== 'P-256' ||
      Object.hasOwn(jwk, 'd') ||
      !isCanonicalP256Coordinate(jwk.x) ||
      !isCanonicalP256Coordinate(jwk.y)) {
    throw failure(
      'FOUNDER_ENROLLMENT_PUBLIC_KEY_INVALID',
      'Enrollment candidates require canonical public P-256 coordinates only.'
    );
  }

  // Rebuild the JWK from the four fields covered by the fingerprint. Do not
  // carry extra provider-specific or private fields into the candidate.
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

export function buildEnrollmentCandidate(publicKey, { now = new Date() } = {}) {
  const jwk = exportPublicP256Jwk(publicKey);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }))
    .digest('hex');

  return Object.freeze({
    schema: 'ngl.founder-enrollment-candidate.v1',
    status: 'NOT_ENROLLED',
    enrolled: false,
    mode: null,
    public_key_jwk: Object.freeze({ ...jwk }),
    fingerprint,
    candidate_created_at: now.toISOString(),
    instruction: 'Candidate only. Do not copy as an enrolled trust anchor. Verify independent private-key custody and Founder control before a separate, explicit enrollment step.'
  });
}

export function main(argv = process.argv.slice(2), options = {}) {
  const log = options.log ?? console.log;
  const generate = options.generateKeyPairSync ?? generateKeyPairSync;

  // Reject raw-file export and every unrecognized argument before generating
  // even an ephemeral key or printing a candidate.
  validateArguments(argv);

  const { publicKey } = generate('ec', { namedCurve: 'P-256' });
  const candidate = buildEnrollmentCandidate(publicKey, { now: options.now ?? new Date() });

  log(JSON.stringify(candidate, null, 2));
  log('\n# No private key was persisted. This candidate remains NOT_ENROLLED and cannot authorize.');
  log('# Raw private-key export is disabled; a platform-backed non-extractable keystore and separate Founder-controlled enrollment are required.');
  return candidate;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(formatEnrollmentError(error));
    process.exitCode = 1;
  }
}
