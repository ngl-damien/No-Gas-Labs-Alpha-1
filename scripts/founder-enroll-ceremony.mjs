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
import {
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  statSync,
  closeSync,
  writeFileSync
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function isWithin(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}

export function validatePrivateKeyDestination(destination, {
  platform = process.platform,
  repositoryRoot = REPOSITORY_ROOT
} = {}) {
  if (platform === 'win32') {
    throw failure(
      'FOUNDER_PRIVATE_KEY_ACL_UNVERIFIED',
      'Raw private-key file export is disabled on Windows because mode 0600 does not establish a private Windows ACL.'
    );
  }
  if (typeof destination !== 'string' || !destination.trim() || !isAbsolute(destination)) {
    throw failure('FOUNDER_PRIVATE_KEY_PATH_INVALID', 'Private-key destination must be an absolute path.');
  }

  const root = realpathSync(repositoryRoot);
  const absolute = resolve(destination);
  const parent = dirname(absolute);
  let parentEntry;
  try {
    parentEntry = lstatSync(parent);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw failure('FOUNDER_PRIVATE_KEY_PARENT_MISSING', 'Private-key parent directory must already exist.');
    }
    throw error;
  }
  if (parentEntry.isSymbolicLink() || !parentEntry.isDirectory()) {
    throw failure('FOUNDER_PRIVATE_KEY_PARENT_INVALID', 'Private-key parent must be a real directory, not a symlink.');
  }

  const realParent = realpathSync(parent);
  const parentStat = statSync(realParent);
  if ((parentStat.mode & 0o077) !== 0) {
    throw failure('FOUNDER_PRIVATE_KEY_PARENT_PERMISSIONS_UNSAFE', 'Private-key parent directory must exclude all group and other permissions.');
  }

  const target = join(realParent, basename(absolute));
  if (isWithin(root, target)) {
    throw failure('FOUNDER_PRIVATE_KEY_PATH_INSIDE_REPOSITORY', 'Private-key files must be outside the repository.');
  }
  try {
    lstatSync(target);
    throw failure('FOUNDER_PRIVATE_KEY_DESTINATION_EXISTS', 'Private-key destination already exists; refusing to overwrite it.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return target;
}

export function writePrivateKeyFile(destination, privateJwk, options = {}) {
  const target = validatePrivateKeyDestination(destination, options);
  const parent = dirname(target);
  const payload = JSON.stringify(privateJwk, null, 2) + '\n';
  const sync = options.fsyncSync ?? fsyncSync;
  let directoryFd;
  let fd;
  let identity;
  let directoryIdentity;

  try {
    // Keep the validated parent directory open while creating and syncing the
    // new entry. Rechecking its pathname catches a directory/symlink swap
    // around the path-based file open; the open descriptor is used for fsync.
    const parentBefore = lstatSync(parent);
    if (parentBefore.isSymbolicLink() || !parentBefore.isDirectory()) {
      throw failure('FOUNDER_PRIVATE_KEY_PARENT_INVALID', 'Private-key parent must remain a real directory.');
    }
    directoryFd = openSync(parent, 'r');
    const parentOpened = fstatSync(directoryFd);
    if (!parentOpened.isDirectory() ||
        parentOpened.dev !== parentBefore.dev ||
        parentOpened.ino !== parentBefore.ino ||
        (parentOpened.mode & 0o077) !== 0) {
      throw failure('FOUNDER_PRIVATE_KEY_PARENT_CHANGED', 'Private-key parent identity or permissions changed before file creation.');
    }
    directoryIdentity = { dev: parentOpened.dev, ino: parentOpened.ino };

    try {
      try {
        fd = openSync(target, 'wx', 0o600);
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw failure('FOUNDER_PRIVATE_KEY_DESTINATION_EXISTS', 'Private-key destination already exists; refusing to overwrite it.');
        }
        throw error;
      }

      const before = fstatSync(fd);
      if (!before.isFile() || (before.mode & 0o077) !== 0) {
        throw failure('FOUNDER_PRIVATE_KEY_FILE_PERMISSIONS_UNSAFE', 'New private-key file is not a private regular file.');
      }
      writeFileSync(fd, payload);
      sync(fd);
      const after = fstatSync(fd);
      if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || (after.mode & 0o077) !== 0) {
        throw failure('FOUNDER_PRIVATE_KEY_FILE_CHANGED', 'Private-key file identity or permissions changed during write.');
      }
      identity = { dev: after.dev, ino: after.ino };
    } finally {
      if (fd !== undefined) {
        closeSync(fd);
        fd = undefined;
      }
    }

    const parentAfterWrite = lstatSync(parent);
    const openedAfterWrite = fstatSync(directoryFd);
    if (parentAfterWrite.isSymbolicLink() || !parentAfterWrite.isDirectory() ||
        parentAfterWrite.dev !== directoryIdentity.dev ||
        parentAfterWrite.ino !== directoryIdentity.ino ||
        openedAfterWrite.dev !== directoryIdentity.dev ||
        openedAfterWrite.ino !== directoryIdentity.ino ||
        (openedAfterWrite.mode & 0o077) !== 0) {
      throw failure('FOUNDER_PRIVATE_KEY_PARENT_CHANGED', 'Private-key parent identity or permissions changed during file creation.');
    }

    const finalFile = lstatSync(target);
    if (finalFile.isSymbolicLink() || !finalFile.isFile() ||
        finalFile.dev !== identity.dev || finalFile.ino !== identity.ino ||
        (finalFile.mode & 0o077) !== 0) {
      throw failure('FOUNDER_PRIVATE_KEY_FILE_CHANGED', 'Private-key destination changed after creation.');
    }

    // fsync(file) protects file contents; fsync(parent) protects the newly
    // created directory entry across a crash. If the filesystem cannot sync
    // the directory, leave the 0600 file for manual inspection and do not
    // print a candidate that could be mistaken for a completed export.
    try {
      sync(directoryFd);
    } catch (error) {
      const uncertain = failure(
        'FOUNDER_PRIVATE_KEY_DIRECTORY_SYNC_UNCERTAIN',
        'Private-key file contents were synced, but the parent directory entry could not be synced; inspect the destination before retrying.'
      );
      uncertain.cause = error;
      throw uncertain;
    }

    const finalParent = lstatSync(parent);
    const finalOpenedParent = fstatSync(directoryFd);
    const finalEntry = lstatSync(target);
    if (finalParent.isSymbolicLink() || !finalParent.isDirectory() ||
        finalParent.dev !== directoryIdentity.dev ||
        finalParent.ino !== directoryIdentity.ino ||
        finalOpenedParent.dev !== directoryIdentity.dev ||
        finalOpenedParent.ino !== directoryIdentity.ino ||
        (finalOpenedParent.mode & 0o077) !== 0) {
      throw failure('FOUNDER_PRIVATE_KEY_PARENT_CHANGED', 'Private-key parent changed after directory synchronization.');
    }
    if (finalEntry.isSymbolicLink() || !finalEntry.isFile() ||
        finalEntry.dev !== identity.dev || finalEntry.ino !== identity.ino ||
        (finalEntry.mode & 0o077) !== 0) {
      throw failure('FOUNDER_PRIVATE_KEY_FILE_CHANGED', 'Private-key destination changed after directory synchronization.');
    }
    return target;
  } finally {
    try {
      if (fd !== undefined) closeSync(fd);
    } finally {
      if (directoryFd !== undefined) closeSync(directoryFd);
    }
  }
}
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
    public_key_jwk: Object.freeze({ ...jwk }),
    fingerprint,
    candidate_created_at: now.toISOString(),
    instruction: 'Candidate only. Do not copy as an enrolled trust anchor. Verify independent private-key custody and Founder control before a separate, explicit enrollment step.'
  });
}

export function main(argv = process.argv.slice(2), options = {}) {
  const log = options.log ?? console.log;
  const generate = options.generateKeyPairSync ?? generateKeyPairSync;
  const validate = options.validatePrivateKeyDestination ?? validatePrivateKeyDestination;
  const writePrivateKey = options.writePrivateKey ?? writePrivateKeyFile;
  const platform = options.platform ?? process.platform;

  const privatePathFlag = argv.indexOf('--write-private-path');
  if (privatePathFlag !== -1 && (!argv[privatePathFlag + 1] || argv[privatePathFlag + 1].startsWith('--'))) {
    throw failure('FOUNDER_PRIVATE_KEY_PATH_REQUIRED', 'A path is required after --write-private-path.');
  }

  // Validate an explicitly requested destination before generating any key.
  const destination = privatePathFlag === -1
    ? null
    : validate(argv[privatePathFlag + 1], { platform, repositoryRoot: options.repositoryRoot });

  const { publicKey, privateKey } = generate('ec', { namedCurve: 'P-256' });
  const candidate = buildEnrollmentCandidate(publicKey, { now: options.now ?? new Date() });

  // Persist first. If an explicitly requested write fails, do not print a
  // candidate that could be mistaken for a completed enrollment ceremony.
  if (destination) {
    writePrivateKey(destination, privateKey.export({ format: 'jwk' }), {
      platform,
      repositoryRoot: options.repositoryRoot
    });
  }

  log(JSON.stringify(candidate, null, 2));
  if (destination) {
    log('\n# Private JWK written to a new exclusive raw file; this is not a hardware-backed keystore.');
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
