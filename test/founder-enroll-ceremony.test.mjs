import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { fstatSync, fsyncSync } from 'node:fs';
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildEnrollmentCandidate,
  main,
  validatePrivateKeyDestination,
  writePrivateKeyFile
} from '../scripts/founder-enroll-ceremony.mjs';
import { authorizationEvent, loadTrustAnchor } from '../src/authority/decision.js';

const IS_WINDOWS = process.platform === 'win32';

function keyPair() {
  return generateKeyPairSync('ec', { namedCurve: 'P-256' });
}

async function temporaryDirectory(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function makePrivateDirectory(directory) {
  await chmod(directory, 0o700);
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
  const candidate = main(['--write-private-path', '/secure/founder.jwk'], {
    generateKeyPairSync: () => pair,
    validatePrivateKeyDestination: value => value,
    writePrivateKey: (file, jwk) => {
      writtenPath = file;
      writtenPrivateJwk = jwk;
    },
    log: value => output.push(String(value)),
    now: new Date('2026-11-03T00:00:00.000Z')
  });

  assert.equal(writtenPath, '/secure/founder.jwk');
  assert.equal(typeof writtenPrivateJwk.d, 'string');
  assert.equal(candidate.status, 'NOT_ENROLLED');
  assert.equal(candidate.enrolled, false);
  assert.equal(candidate.mode, null);
  assert.match(output.join('\n'), /raw file; this is not a hardware-backed keystore/);
});

test('missing private-key destination fails before key generation or output', () => {
  let generated = 0;
  let logged = 0;
  assert.throws(
    () => main(['--write-private-path'], {
      generateKeyPairSync: () => { generated += 1; return keyPair(); },
      log: () => { logged += 1; }
    }),
    error => error.code === 'FOUNDER_PRIVATE_KEY_PATH_REQUIRED'
  );
  assert.equal(generated, 0);
  assert.equal(logged, 0);
});

test('Windows raw private-key file export fails before key generation or output', () => {
  let generated = 0;
  let logged = 0;
  assert.throws(
    () => main(['--write-private-path', 'C:\\private\\founder.jwk'], {
      platform: 'win32',
      generateKeyPairSync: () => { generated += 1; return keyPair(); },
      log: () => { logged += 1; }
    }),
    error => error.code === 'FOUNDER_PRIVATE_KEY_ACL_UNVERIFIED'
  );
  assert.equal(generated, 0);
  assert.equal(logged, 0);
});

test('private-key destination must be absolute and outside the repository', async t => {
  if (IS_WINDOWS) return t.skip('POSIX path and permission checks are not available on Windows.');
  const repositoryRoot = await makePrivateDirectory(await temporaryDirectory(t, 'ngl-enroll-repo-'));
  const inside = join(repositoryRoot, 'private');
  await mkdir(inside, { mode: 0o700 });
  await chmod(inside, 0o700);

  assert.throws(
    () => validatePrivateKeyDestination('relative/founder.jwk', { repositoryRoot }),
    error => error.code === 'FOUNDER_PRIVATE_KEY_PATH_INVALID'
  );
  assert.throws(
    () => validatePrivateKeyDestination(join(inside, 'founder.jwk'), { repositoryRoot }),
    error => error.code === 'FOUNDER_PRIVATE_KEY_PATH_INSIDE_REPOSITORY'
  );
});

test('private-key destination requires a private non-symlink parent directory', async t => {
  if (IS_WINDOWS) return t.skip('POSIX path and permission checks are not available on Windows.');
  const repositoryRoot = await makePrivateDirectory(await temporaryDirectory(t, 'ngl-enroll-repo-'));
  const publicDirectory = await temporaryDirectory(t, 'ngl-enroll-public-');
  await chmod(publicDirectory, 0o755);

  assert.throws(
    () => validatePrivateKeyDestination(join(publicDirectory, 'founder.jwk'), { repositoryRoot }),
    error => error.code === 'FOUNDER_PRIVATE_KEY_PARENT_PERMISSIONS_UNSAFE'
  );

  const privateDirectory = await makePrivateDirectory(await temporaryDirectory(t, 'ngl-enroll-private-'));
  const alias = join(repositoryRoot, 'private-alias');
  await symlink(privateDirectory, alias, 'dir');
  assert.throws(
    () => validatePrivateKeyDestination(join(alias, 'founder.jwk'), { repositoryRoot }),
    error => error.code === 'FOUNDER_PRIVATE_KEY_PARENT_INVALID'
  );
});

test('private JWK file is created exclusively with private permissions and is never overwritten', async t => {
  if (IS_WINDOWS) return t.skip('POSIX mode-bit verification is not available on Windows.');
  const repositoryRoot = await makePrivateDirectory(await temporaryDirectory(t, 'ngl-enroll-repo-'));
  const privateDirectory = await makePrivateDirectory(await temporaryDirectory(t, 'ngl-enroll-private-'));
  const destination = join(privateDirectory, 'founder.jwk');
  const { privateKey } = keyPair();
  const privateJwk = privateKey.export({ format: 'jwk' });

  assert.equal(writePrivateKeyFile(destination, privateJwk, { repositoryRoot }), destination);
  const metadata = await stat(destination);
  assert.equal(metadata.isFile(), true);
  assert.equal(metadata.mode & 0o077, 0);
  const original = await readFile(destination, 'utf8');
  assert.deepEqual(JSON.parse(original), privateJwk);

  assert.throws(
    () => writePrivateKeyFile(destination, { kty: 'EC' }, { repositoryRoot }),
    error => error.code === 'FOUNDER_PRIVATE_KEY_DESTINATION_EXISTS'
  );
  assert.equal(await readFile(destination, 'utf8'), original);
});

test('directory-sync uncertainty suppresses candidate output and preserves the private file for inspection', async t => {
  if (IS_WINDOWS) return t.skip('POSIX directory synchronization is not available on Windows.');
  const repositoryRoot = await makePrivateDirectory(await temporaryDirectory(t, 'ngl-enroll-repo-'));
  const privateDirectory = await makePrivateDirectory(await temporaryDirectory(t, 'ngl-enroll-private-'));
  const destination = join(privateDirectory, 'founder.jwk');
  const output = [];
  const failingDirectorySync = fd => {
    if (fstatSync(fd).isDirectory()) {
      const error = new Error('injected parent-directory sync failure');
      error.code = 'EIO';
      throw error;
    }
    return fsyncSync(fd);
  };

  assert.throws(
    () => main(['--write-private-path', destination], {
      platform: process.platform,
      repositoryRoot,
      generateKeyPairSync: () => keyPair(),
      validatePrivateKeyDestination,
      writePrivateKey: (file, jwk, options) => writePrivateKeyFile(file, jwk, {
        ...options,
        fsyncSync: failingDirectorySync
      }),
      log: value => output.push(String(value))
    }),
    error => error.code === 'FOUNDER_PRIVATE_KEY_DIRECTORY_SYNC_UNCERTAIN'
  );

  assert.deepEqual(output, [], 'an uncertain directory entry must not be reported as a completed export');
  const metadata = await stat(destination);
  assert.equal(metadata.isFile(), true);
  assert.equal(metadata.mode & 0o077, 0);
  assert.equal(typeof JSON.parse(await readFile(destination, 'utf8')).d, 'string');
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
