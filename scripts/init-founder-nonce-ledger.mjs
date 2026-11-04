#!/usr/bin/env node
import { constants as fsConstants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const NONCE_LEDGER_SCHEMA = 'ngl.founder-nonce-ledger.v1';
const LOCK_SCHEMA = 'ngl.ledger-lock.v1';
const TEMPORARY_NONCE_FILE = /^\.founder-nonce-[0-9a-f-]{36}\.tmp$/;
const MAX_LOCK_BYTES = 4096;
const MAX_LEDGER_BYTES = 4 * 1024 * 1024;
const HELP = [
  'Initialize a brand-new empty Founder nonce ledger.',
  '',
  'Required environment:',
  '  NGL_FOUNDER_NONCE_LEDGER_PATH  absolute path to the ledger file',
  '',
  'Required acknowledgement:',
  '  --confirm-no-prior-history',
  '',
  'The parent directory must already exist, be owned by the current POSIX user,',
  'and have mode 0700. The command never creates the directory, overwrites an',
  'existing ledger, repairs a missing ledger in an existing deployment,',
  'enrolls a Founder key, or authorizes a decision.',
  '',
  'Use only after an authorized operator has independently established that',
  'this is a brand-new nonce directory with no prior replay history.',
].join('\n');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sameFileSnapshot(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.uid === right.uid && left.mode === right.mode &&
    left.size === right.size && left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function assertTrustedPrivateDirectory(directory) {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') {
    fail('FOUNDER_NONCE_LEDGER_INIT_POSIX_REQUIRED');
  }
  const absolute = resolve(directory);
  const root = parse(absolute).root;
  const uid = process.getuid();

  function inspect(candidate) {
    let stat;
    try { stat = lstatSync(candidate); }
    catch { fail('FOUNDER_NONCE_LEDGER_INIT_UNSAFE_DIRECTORY'); }
    if (stat.isSymbolicLink() || !stat.isDirectory() ||
        (stat.uid !== 0 && stat.uid !== uid) ||
        ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0)) {
      fail('FOUNDER_NONCE_LEDGER_INIT_UNSAFE_DIRECTORY');
    }
    return stat;
  }

  inspect(root);
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    inspect(current);
  }
  const leaf = inspect(absolute);
  if ((leaf.mode & 0o777) !== 0o700 || leaf.uid !== uid) {
    fail('FOUNDER_NONCE_LEDGER_INIT_UNSAFE_DIRECTORY');
  }
  return { dev: leaf.dev, ino: leaf.ino, uid: leaf.uid, mode: leaf.mode };
}

function assertDirectoryIdentity(directory, expected) {
  let current;
  try { current = assertTrustedPrivateDirectory(directory); }
  catch { fail('FOUNDER_NONCE_LEDGER_INIT_DIRECTORY_CHANGED'); }
  if (current.dev !== expected.dev || current.ino !== expected.ino ||
      current.uid !== expected.uid || current.mode !== expected.mode) {
    fail('FOUNDER_NONCE_LEDGER_INIT_DIRECTORY_CHANGED');
  }
}

function syncDirectory(directory, expectedIdentity) {
  let descriptor;
  try {
    descriptor = openSync(directory, fsConstants.O_RDONLY |
      (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isDirectory() || opened.dev !== expectedIdentity.dev ||
        opened.ino !== expectedIdentity.ino || opened.uid !== expectedIdentity.uid ||
        opened.mode !== expectedIdentity.mode) {
      fail('FOUNDER_NONCE_LEDGER_INIT_DIRECTORY_CHANGED');
    }
    fsyncSync(descriptor);
  } catch (error) {
    if (error?.code === 'FOUNDER_NONCE_LEDGER_INIT_DIRECTORY_CHANGED' ||
        error?.code === 'ELOOP' || error?.code === 'ENOTDIR') {
      fail('FOUNDER_NONCE_LEDGER_INIT_DIRECTORY_CHANGED');
    }
    fail('FOUNDER_NONCE_LEDGER_INIT_DURABILITY_UNCERTAIN');
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
    }
  }
}

function assertNoRecoveryLease(directory) {
  try { lstatSync(join(directory, '.founder-nonce-recovery.lock')); }
  catch (error) {
    if (error?.code === 'ENOENT') return;
    fail('FOUNDER_NONCE_LEDGER_INIT_RECOVERY_LEASE_UNAVAILABLE');
  }
  fail('FOUNDER_NONCE_RECOVERY_IN_PROGRESS');
}

function assertNoPendingTemporaryFiles(directory) {
  let names;
  try { names = readdirSync(directory); }
  catch { fail('FOUNDER_NONCE_LEDGER_INIT_DIRECTORY_UNAVAILABLE'); }
  if (names.some(name => TEMPORARY_NONCE_FILE.test(name))) {
    fail('FOUNDER_NONCE_LEDGER_INIT_TEMPORARY_FILES_PRESENT');
  }
}

function assertLedgerAbsent(ledgerPath) {
  try { lstatSync(ledgerPath); }
  catch (error) {
    if (error?.code === 'ENOENT') return;
    fail('FOUNDER_NONCE_LEDGER_INIT_PATH_UNAVAILABLE');
  }
  fail('FOUNDER_NONCE_LEDGER_ALREADY_EXISTS');
}

function readBoundedDescriptor(descriptor, maxBytes) {
  const buffer = Buffer.alloc(maxBytes + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const count = readSync(descriptor, buffer, offset, buffer.length - offset, null);
    if (count === 0) break;
    offset += count;
  }
  if (offset > maxBytes) fail('FOUNDER_NONCE_LEDGER_INIT_LOCK_CHANGED');
  return buffer.subarray(0, offset);
}

function assertOwnerLockOwned(lockPath, identity, snapshot, receipt, directory, directoryIdentity) {
  assertDirectoryIdentity(directory, directoryIdentity);
  let current;
  try { current = lstatSync(lockPath); }
  catch { fail('FOUNDER_NONCE_LEDGER_INIT_LOCK_CHANGED'); }
  if (current.isSymbolicLink() || !current.isFile() ||
      current.dev !== identity.dev || current.ino !== identity.ino ||
      !sameFileSnapshot(snapshot, current)) {
    fail('FOUNDER_NONCE_LEDGER_INIT_LOCK_CHANGED');
  }

  let descriptor;
  try {
    descriptor = openSync(lockPath, fsConstants.O_RDONLY |
      (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameFileSnapshot(snapshot, opened)) {
      fail('FOUNDER_NONCE_LEDGER_INIT_LOCK_CHANGED');
    }
    const bytes = readBoundedDescriptor(descriptor, MAX_LOCK_BYTES);
    const after = lstatSync(lockPath);
    const afterDescriptor = fstatSync(descriptor);
    if (after.isSymbolicLink() || !after.isFile() ||
        !sameFileSnapshot(snapshot, after) ||
        !sameFileSnapshot(snapshot, afterDescriptor) ||
        bytes.toString('utf8') !== receipt) {
      fail('FOUNDER_NONCE_LEDGER_INIT_LOCK_CHANGED');
    }
  } catch (error) {
    if (error?.code === 'FOUNDER_NONCE_LEDGER_INIT_LOCK_CHANGED') throw error;
    fail('FOUNDER_NONCE_LEDGER_INIT_LOCK_CHANGED');
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
    }
  }
}

function releaseOwnerLock(lockPath, identity, snapshot, receipt, directory, directoryIdentity) {
  assertOwnerLockOwned(lockPath, identity, snapshot, receipt, directory, directoryIdentity);
  // Node does not expose an atomic compare-and-unlink primitive. These checks
  // narrow the same-UID race; a hostile writer racing after the final check remains out of scope.
  try { unlinkSync(lockPath); }
  catch { fail('FOUNDER_NONCE_LEDGER_INIT_LOCK_RELEASE_UNCERTAIN'); }
  syncDirectory(directory, directoryIdentity);
}

function verifyCreatedLedger(ledgerPath, expectedBytes) {
  let before;
  try { before = lstatSync(ledgerPath); }
  catch { fail('FOUNDER_NONCE_LEDGER_INIT_STATE_UNCERTAIN'); }
  if (before.isSymbolicLink() || !before.isFile() ||
      (before.mode & 0o777) !== 0o600 ||
      before.uid !== process.getuid() || before.size !== expectedBytes.length) {
    fail('FOUNDER_NONCE_LEDGER_INIT_STATE_UNCERTAIN');
  }
  let descriptor;
  try {
    descriptor = openSync(ledgerPath, fsConstants.O_RDONLY |
      (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameFileSnapshot(before, opened)) {
      fail('FOUNDER_NONCE_LEDGER_INIT_STATE_UNCERTAIN');
    }
    const bytes = readBoundedDescriptor(descriptor, MAX_LEDGER_BYTES);
    const after = lstatSync(ledgerPath);
    const afterDescriptor = fstatSync(descriptor);
    if (!sameFileSnapshot(opened, after) ||
        !sameFileSnapshot(opened, afterDescriptor) ||
        !bytes.equals(expectedBytes)) {
      fail('FOUNDER_NONCE_LEDGER_INIT_STATE_UNCERTAIN');
    }
  } catch (error) {
    if (error?.code === 'FOUNDER_NONCE_LEDGER_INIT_STATE_UNCERTAIN') throw error;
    fail('FOUNDER_NONCE_LEDGER_INIT_STATE_UNCERTAIN');
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
    }
  }
}

function provisionFounderNonceLedger() {
  const configuredPath = process.env.NGL_FOUNDER_NONCE_LEDGER_PATH;
  if (!configuredPath || !parse(configuredPath).root) {
    fail('FOUNDER_NONCE_LEDGER_UNCONFIGURED');
  }
  const ledgerPath = resolve(configuredPath);
  const directory = dirname(ledgerPath);
  const name = basename(ledgerPath);
  if (ledgerPath === join(directory, '.founder-nonce.lock') ||
      ledgerPath === join(directory, '.founder-nonce-recovery.lock') ||
      TEMPORARY_NONCE_FILE.test(name)) {
    fail('FOUNDER_NONCE_LEDGER_PATH_INVALID');
  }

  const directoryIdentity = assertTrustedPrivateDirectory(directory);
  assertNoRecoveryLease(directory);
  assertLedgerAbsent(ledgerPath);

  const lockPath = join(directory, '.founder-nonce.lock');
  let lockDescriptor;
  let lockIdentity;
  let lockSnapshot;
  let lockReceipt = '';
  let keepLock = false;

  try {
    try {
      lockDescriptor = openSync(lockPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    } catch (error) {
      if (error?.code === 'EEXIST') fail('FOUNDER_NONCE_LEDGER_LOCKED');
      fail('FOUNDER_NONCE_LEDGER_INIT_LOCK_UNAVAILABLE');
    }

    const openedLock = fstatSync(lockDescriptor);
    if (!openedLock.isFile() || (openedLock.mode & 0o777) !== 0o600 ||
        openedLock.uid !== process.getuid()) {
      keepLock = true;
      fail('FOUNDER_NONCE_LEDGER_INIT_LOCK_UNSAFE');
    }
    lockIdentity = { dev: openedLock.dev, ino: openedLock.ino };
    lockSnapshot = openedLock;
    lockReceipt = canonical({
      schema: LOCK_SCHEMA,
      pid: process.pid,
      openedAt: new Date().toISOString(),
    });
    try {
      writeFileSync(lockDescriptor, lockReceipt, 'utf8');
      fsyncSync(lockDescriptor);
    } catch {
      keepLock = true;
      fail('FOUNDER_NONCE_LEDGER_INIT_DURABILITY_UNCERTAIN');
    }
    lockSnapshot = fstatSync(lockDescriptor);
    assertDirectoryIdentity(directory, directoryIdentity);
    try {
      syncDirectory(directory, directoryIdentity);
      assertDirectoryIdentity(directory, directoryIdentity);
    } catch (error) {
      keepLock = true;
      if (error?.code === 'FOUNDER_NONCE_LEDGER_INIT_DIRECTORY_CHANGED') throw error;
      fail('FOUNDER_NONCE_LEDGER_INIT_DURABILITY_UNCERTAIN');
    }
    assertNoRecoveryLease(directory);
    assertLedgerAbsent(ledgerPath);
    assertNoPendingTemporaryFiles(directory);

    const ledgerBytes = Buffer.from(canonical({
      schema: NONCE_LEDGER_SCHEMA,
      nonces: [],
    }), 'utf8');
    let ledgerDescriptor;
    try {
      ledgerDescriptor = openSync(ledgerPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0), 0o600);
    } catch (error) {
      if (error?.code === 'EEXIST') fail('FOUNDER_NONCE_LEDGER_ALREADY_EXISTS');
      fail('FOUNDER_NONCE_LEDGER_INIT_WRITE_UNCERTAIN');
    }
    keepLock = true;
    try {
      writeFileSync(ledgerDescriptor, ledgerBytes);
      fsyncSync(ledgerDescriptor);
      const created = fstatSync(ledgerDescriptor);
      if (!created.isFile() || (created.mode & 0o777) !== 0o600 ||
          created.uid !== process.getuid() || created.size !== ledgerBytes.length) {
        fail('FOUNDER_NONCE_LEDGER_INIT_STATE_UNCERTAIN');
      }
    } catch (error) {
      if (error?.code?.startsWith('FOUNDER_NONCE_')) throw error;
      fail('FOUNDER_NONCE_LEDGER_INIT_DURABILITY_UNCERTAIN');
    } finally {
      try { closeSync(ledgerDescriptor); } catch {}
    }

    assertDirectoryIdentity(directory, directoryIdentity);
    verifyCreatedLedger(ledgerPath, ledgerBytes);
    syncDirectory(directory, directoryIdentity);
    assertDirectoryIdentity(directory, directoryIdentity);

    try {
      releaseOwnerLock(lockPath, lockIdentity, lockSnapshot, lockReceipt, directory, directoryIdentity);
      lockIdentity = null;
      keepLock = false;
    } catch {
      keepLock = true;
      fail('FOUNDER_NONCE_LEDGER_INIT_LOCK_RELEASE_UNCERTAIN');
    }
  } catch (error) {
    if (lockIdentity && !keepLock) {
      try {
        releaseOwnerLock(lockPath, lockIdentity, lockSnapshot, lockReceipt, directory, directoryIdentity);
        lockIdentity = null;
      } catch {
        fail('FOUNDER_NONCE_LEDGER_INIT_CLEANUP_UNCERTAIN');
      }
    }
    throw error;
  } finally {
    if (lockDescriptor !== undefined) {
      try { closeSync(lockDescriptor); } catch {}
    }
  }
}

function parseArguments(args) {
  let confirm = false;
  let help = false;
  for (const argument of args) {
    if (argument === '--help') help = true;
    else if (argument === '--confirm-no-prior-history' && !confirm) confirm = true;
    else fail('FOUNDER_NONCE_LEDGER_INIT_ARGUMENTS_INVALID');
  }
  return { confirm, help };
}

function main(args = process.argv.slice(2)) {
  let parsed;
  try { parsed = parseArguments(args); }
  catch (error) {
    console.error(error.message);
    return 1;
  }
  if (parsed.help) {
    console.log(HELP);
    return 0;
  }
  if (!parsed.confirm) {
    console.error('FOUNDER_NONCE_LEDGER_INIT_CONFIRMATION_REQUIRED');
    return 1;
  }
  try {
    provisionFounderNonceLedger();
    console.log('FOUNDER_NONCE_LEDGER_INITIALIZED');
    return 0;
  } catch (error) {
    const candidate = String(error?.code || error?.message || '');
    const safe = /^FOUNDER_NONCE_(?:LEDGER|RECOVERY)_[A-Z_]+$/.test(candidate)
      ? candidate
      : 'FOUNDER_NONCE_LEDGER_INIT_FAILED';
    console.error(safe);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
