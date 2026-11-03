#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, readdir, unlink } from 'node:fs/promises';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectWriterLock } from '../src/institution/lock-inspector.mjs';
import { assertNoDuplicateJsonObjectKeys } from '../src/strict-json.mjs';

const NONCE_LEDGER_SCHEMA = 'ngl.founder-nonce-ledger.v1';
const LOCK_SCHEMA = 'ngl.ledger-lock.v1';
const RECOVERY_LEASE_SCHEMA = 'ngl.founder-nonce-recovery.v1';
const MAX_NONCE_LEDGER_BYTES = 4 * 1024 * 1024;
const MAX_NONCE_COUNT = 100_000;
const TEMPORARY_NONCE_FILE = /^\.founder-nonce-[0-9a-f-]{36}\.tmp$/;
const RECOVERY_WARNING = 'PID probes are advisory only. PID reuse, namespaces, permissions, and races can mislead; stop all older writers and confirm the owner is stopped on this same host/PID namespace. The recovery lease fences only writers running this version. This tool never grants Founder authority.';

function failure(code, detail = '') {
  const error = new Error(detail ? code + ':' + detail : code);
  error.code = code;
  return error;
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

function sameDirectoryIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.uid === right.uid && left.mode === right.mode;
}

async function assertTrustedPrivateDirectory(directory) {
  if (process.platform === 'win32') {
    throw failure('FOUNDER_NONCE_RECOVERY_POSIX_REQUIRED');
  }
  const absolute = resolve(directory);
  const root = parse(absolute).root;
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;

  async function inspect(path) {
    let stat;
    try { stat = await lstat(path); }
    catch { throw failure('FOUNDER_NONCE_RECOVERY_UNSAFE_DIRECTORY'); }
    if (stat.isSymbolicLink() || !stat.isDirectory() ||
        (uid !== null && stat.uid !== 0 && stat.uid !== uid) ||
        ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0)) {
      throw failure('FOUNDER_NONCE_RECOVERY_UNSAFE_DIRECTORY');
    }
    return stat;
  }

  await inspect(root);
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    await inspect(current);
  }

  const leaf = await inspect(absolute);
  if ((leaf.mode & 0o777) !== 0o700 ||
      (uid !== null && leaf.uid !== uid)) {
    throw failure('FOUNDER_NONCE_RECOVERY_UNSAFE_DIRECTORY');
  }
  return { dev: leaf.dev, ino: leaf.ino, uid: leaf.uid, mode: leaf.mode };
}

async function assertDirectoryIdentity(directory, expected) {
  const current = await assertTrustedPrivateDirectory(directory);
  if (!sameDirectoryIdentity(expected, current)) {
    throw failure('FOUNDER_NONCE_RECOVERY_DIRECTORY_CHANGED');
  }
}

async function syncDirectory(directory) {
  const handle = await open(directory, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0));
  try { await handle.sync(); }
  finally { await handle.close(); }
}

async function readNonceLedger(ledgerPath, { sync = false } = {}) {
  let before;
  try { before = await lstat(ledgerPath); }
  catch (error) {
    if (error.code === 'ENOENT') {
      return { exists: false, nonceCount: 0, sha256: null };
    }
    throw failure('FOUNDER_NONCE_RECOVERY_LEDGER_UNAVAILABLE');
  }

  if (before.isSymbolicLink() || !before.isFile() ||
      (before.mode & 0o777) !== 0o600 ||
      (typeof process.getuid === 'function' && before.uid !== process.getuid()) ||
      before.size > MAX_NONCE_LEDGER_BYTES) {
    throw failure('FOUNDER_NONCE_RECOVERY_LEDGER_UNSAFE');
  }

  let handle;
  try {
    const accessMode = sync ? fsConstants.O_RDWR : fsConstants.O_RDONLY;
    handle = await open(ledgerPath, accessMode |
      (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileSnapshot(before, opened)) {
      throw failure('FOUNDER_NONCE_RECOVERY_LEDGER_CHANGED');
    }

    const buffer = Buffer.alloc(MAX_NONCE_LEDGER_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_NONCE_LEDGER_BYTES) {
      throw failure('FOUNDER_NONCE_RECOVERY_LEDGER_TOO_LARGE');
    }

    const after = await lstat(ledgerPath);
    const afterHandle = await handle.stat();
    if (after.isSymbolicLink() || !after.isFile() ||
        !sameFileSnapshot(opened, after) ||
        !sameFileSnapshot(opened, afterHandle) ||
        total !== opened.size) {
      throw failure('FOUNDER_NONCE_RECOVERY_LEDGER_CHANGED');
    }

    const bytes = buffer.subarray(0, total);
    const serialized = bytes.toString('utf8');
    if (!Buffer.from(serialized, 'utf8').equals(bytes)) {
      throw failure('FOUNDER_NONCE_RECOVERY_LEDGER_ENCODING_INVALID');
    }

    let saved;
    try {
      assertNoDuplicateJsonObjectKeys(serialized, { label: 'FOUNDER_NONCE_LEDGER' });
      saved = JSON.parse(serialized);
    } catch {
      throw failure('FOUNDER_NONCE_RECOVERY_LEDGER_TAMPERED');
    }

    if (!saved || typeof saved !== 'object' || Array.isArray(saved) ||
        Object.keys(saved).sort().join(',') !== 'nonces,schema' ||
        saved.schema !== NONCE_LEDGER_SCHEMA ||
        !Array.isArray(saved.nonces) || saved.nonces.length > MAX_NONCE_COUNT ||
        saved.nonces.some(value => typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) ||
        new Set(saved.nonces).size !== saved.nonces.length ||
        canonical(saved) !== serialized) {
      throw failure('FOUNDER_NONCE_RECOVERY_LEDGER_TAMPERED');
    }

    if (sync) await handle.sync();
    const finalPath = await lstat(ledgerPath);
    const finalHandle = await handle.stat();
    if (!sameFileSnapshot(opened, finalPath) || !sameFileSnapshot(opened, finalHandle)) {
      throw failure('FOUNDER_NONCE_RECOVERY_LEDGER_CHANGED');
    }

    return {
      exists: true,
      nonceCount: saved.nonces.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    };
  } catch (error) {
    if (error?.code?.startsWith('FOUNDER_NONCE_RECOVERY_')) throw error;
    throw failure('FOUNDER_NONCE_RECOVERY_LEDGER_UNAVAILABLE');
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function inspectPendingTemporaryFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries.map(entry => entry.name).filter(name => TEMPORARY_NONCE_FILE.test(name)).sort();
  const files = [];
  for (const name of names) {
    const path = join(directory, name);
    let stat;
    try { stat = await lstat(path); }
    catch { throw failure('FOUNDER_NONCE_RECOVERY_TEMPORARY_FILE_CHANGED'); }
    files.push({
      name,
      size: stat.size,
      mode: (stat.mode & 0o777).toString(8).padStart(3, '0'),
      owner: stat.uid,
      regularFile: stat.isFile() && !stat.isSymbolicLink(),
      unsafe: stat.isSymbolicLink() || !stat.isFile() ||
        (stat.mode & 0o777) !== 0o600 ||
        (typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
        stat.size > MAX_NONCE_LEDGER_BYTES
    });
  }
  return files;
}

function sameLockObservation(left, right) {
  return left?.status === 'present' && right?.status === 'present' &&
    left.format === 'owner-metadata' && right.format === 'owner-metadata' &&
    left.owner?.schema === LOCK_SCHEMA && right.owner?.schema === LOCK_SCHEMA &&
    left.owner.pid === right.owner.pid &&
    left.owner.openedAt === right.owner.openedAt &&
    left.file?.device === right.file?.device &&
    left.file?.inode === right.file?.inode &&
    left.file?.uid === right.file?.uid &&
    left.file?.mode === right.file?.mode &&
    left.file?.size === right.file?.size &&
    left.owner?.processProbe === 'not-found' &&
    right.owner.processProbe === 'not-found';
}

/**
 * Read-only assessment. A missing PID is advisory, never proof by itself.
 * Pending pre-rename temporary files deliberately block automatic cleanup.
 */
export async function inspectFounderNonceRecovery(ledgerPath, { ignoreRecoveryLease = false } = {}) {
  if (typeof ledgerPath !== 'string' || !ledgerPath.trim() || !parse(ledgerPath).root) {
    throw failure('FOUNDER_NONCE_RECOVERY_ABSOLUTE_LEDGER_PATH_REQUIRED');
  }
  const absoluteLedgerPath = resolve(ledgerPath);
  const directory = dirname(absoluteLedgerPath);
  if (absoluteLedgerPath === join(directory, '.founder-nonce.lock')) {
    throw failure('FOUNDER_NONCE_RECOVERY_LEDGER_PATH_INVALID');
  }
  const directoryIdentity = await assertTrustedPrivateDirectory(directory);
  const recoveryLeasePath = join(directory, '.founder-nonce-recovery.lock');
  if (!ignoreRecoveryLease) {
    try {
      await lstat(recoveryLeasePath);
      return {
        status: 'blocked',
        reason: 'recovery-in-progress',
        recoveryLeasePath,
        safeToRemove: false,
        authorityGranted: false,
        warning: RECOVERY_WARNING
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw failure('FOUNDER_NONCE_RECOVERY_LEASE_UNAVAILABLE');
    }
  }
  const lockPath = join(directory, '.founder-nonce.lock');
  const lock = await inspectWriterLock(lockPath);
  const pendingTemporaryFiles = await inspectPendingTemporaryFiles(directory);
  const ledger = await readNonceLedger(absoluteLedgerPath);
  await assertDirectoryIdentity(directory, directoryIdentity);

  if (lock.status === 'missing') {
    const finalLock = await inspectWriterLock(lockPath);
    if (finalLock.status !== 'missing') {
      return {
        status: 'blocked',
        reason: 'lock-appeared-during-recovery-inspection',
        lockPath,
        safeToRemove: false,
        authorityGranted: false
      };
    }
    const common = {
      lockPath,
      ledgerPath: absoluteLedgerPath,
      ledger,
      pendingTemporaryFiles,
      safeToRemove: false,
      requiresHumanConfirmation: false,
      pidProbeAdvisoryOnly: true,
      ledgerModified: false,
      authorityGranted: false,
      warning: RECOVERY_WARNING
    };
    if (pendingTemporaryFiles.length) {
      return { ...common, status: 'manual-inspection-required', reason: 'orphaned-temporary-files-remain-without-an-owner-lock' };
    }
    return { ...common, status: 'no-lock' };
  }

  if (lock.status !== 'present' || lock.format !== 'owner-metadata' ||
      lock.owner?.schema !== LOCK_SCHEMA) {
    return {
      status: 'blocked',
      reason: 'lock-is-not-a-validated-Founder-nonce-owner-receipt',
      lockStatus: lock.status,
      lockFormat: lock.format ?? null,
      lockReason: lock.reason ?? null,
      lockPath,
      safeToRemove: false,
      authorityGranted: false
    };
  }
  if (lock.owner.processProbe !== 'not-found') {
    return {
      status: 'blocked',
      reason: 'owner-process-not-proven-absent',
      owner: lock.owner,
      lockPath,
      safeToRemove: false,
      authorityGranted: false
    };
  }

  const finalLock = await inspectWriterLock(lockPath);
  if (!sameLockObservation(lock, finalLock)) {
    return {
      status: 'blocked',
      reason: 'lock-changed-during-recovery-inspection',
      lockPath,
      safeToRemove: false,
      authorityGranted: false
    };
  }

  const common = {
    lockPath,
    ledgerPath: absoluteLedgerPath,
    owner: lock.owner,
    lock: lock.file,
    ledger,
    pendingTemporaryFiles,
    safeToRemove: false,
    requiresHumanConfirmation: true,
    pidProbeAdvisoryOnly: true,
    ledgerModified: false,
    authorityGranted: false,
    warning: RECOVERY_WARNING
  };
  if (pendingTemporaryFiles.length) {
    return { ...common, status: 'manual-inspection-required', reason: 'pre-rename-or-orphaned-temporary-files-must-be-reviewed' };
  }
  return { ...common, status: 'ready' };
}

/**
 * Explicit offline recovery. It never removes pending temporary files or edits
 * nonce contents. The operator must confirm both that the owner is stopped and
 * that the lock belongs to this host/PID namespace.
 */
async function acquireRecoveryLease(directory) {
  const leasePath = join(directory, '.founder-nonce-recovery.lock');
  let handle;
  try {
    handle = await open(leasePath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') throw failure('FOUNDER_NONCE_RECOVERY_IN_PROGRESS');
    throw failure('FOUNDER_NONCE_RECOVERY_LEASE_UNAVAILABLE', error?.message || '');
  }

  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 ||
        (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
      throw failure('FOUNDER_NONCE_RECOVERY_LEASE_UNSAFE');
    }
    const identity = { dev: stat.dev, ino: stat.ino };
    await handle.writeFile(canonical({
      schema: RECOVERY_LEASE_SCHEMA,
      pid: process.pid,
      openedAt: new Date().toISOString()
    }), 'utf8');
    await handle.sync();
    await syncDirectory(directory);
    return { path: leasePath, handle, identity };
  } catch (error) {
    await handle.close().catch(() => {});
    if (String(error?.code || '').startsWith('FOUNDER_NONCE_RECOVERY_')) throw error;
    throw failure('FOUNDER_NONCE_RECOVERY_LEASE_DURABILITY_UNCERTAIN', error?.message || String(error));
  }
}

async function releaseRecoveryLease(lease, directory) {
  try {
    const current = await lstat(lease.path);
    if (current.isSymbolicLink() || !current.isFile() ||
        current.dev !== lease.identity.dev || current.ino !== lease.identity.ino) {
      throw failure('FOUNDER_NONCE_RECOVERY_LEASE_CHANGED');
    }
    await unlink(lease.path);
    await syncDirectory(directory);
  } catch (error) {
    if (String(error?.code || '').startsWith('FOUNDER_NONCE_RECOVERY_')) throw error;
    throw failure('FOUNDER_NONCE_RECOVERY_DURABILITY_UNCERTAIN', error?.message || String(error));
  } finally {
    await lease.handle.close().catch(() => {});
  }
}

/**
 * Explicit offline recovery. It never removes pending temporary files or edits
 * nonce contents. A durable recovery lease fences new nonce writers for the
 * complete recovery interval. The operator must still confirm the old owner is
 * stopped and that the lock belongs to this host/PID namespace.
 */
export async function recoverFounderNonceLock({
  ledgerPath,
  confirmOwnerStopped = false,
  confirmSameHost = false
} = {}) {
  if (confirmOwnerStopped !== true || confirmSameHost !== true) {
    throw failure('FOUNDER_NONCE_RECOVERY_CONFIRMATION_REQUIRED');
  }
  if (typeof ledgerPath !== 'string' || !parse(ledgerPath).root) {
    throw failure('FOUNDER_NONCE_RECOVERY_ABSOLUTE_LEDGER_PATH_REQUIRED');
  }

  const absoluteLedgerPath = resolve(ledgerPath);
  const directory = dirname(absoluteLedgerPath);
  const directoryIdentity = await assertTrustedPrivateDirectory(directory);
  const recoveryLease = await acquireRecoveryLease(directory);
  let result;
  let operationError;
  let keepRecoveryLease = false;

  try {
    await assertDirectoryIdentity(directory, directoryIdentity);
    const before = await inspectFounderNonceRecovery(absoluteLedgerPath, { ignoreRecoveryLease: true });
    if (before.status !== 'ready') {
      throw failure('FOUNDER_NONCE_RECOVERY_NOT_READY', before.reason || before.status);
    }

    const syncedLedger = await readNonceLedger(absoluteLedgerPath, { sync: true });
    if (syncedLedger.sha256 !== before.ledger.sha256 ||
        syncedLedger.nonceCount !== before.ledger.nonceCount) {
      throw failure('FOUNDER_NONCE_RECOVERY_LEDGER_CHANGED');
    }
    await assertDirectoryIdentity(directory, directoryIdentity);
    await syncDirectory(directory);
    await assertDirectoryIdentity(directory, directoryIdentity);

    const final = await inspectFounderNonceRecovery(absoluteLedgerPath, { ignoreRecoveryLease: true });
    if (final.status !== 'ready' ||
        !sameLockObservation(
          { status: 'present', format: 'owner-metadata', owner: before.owner, file: before.lock },
          { status: 'present', format: 'owner-metadata', owner: final.owner, file: final.lock }
        ) ||
        final.ledger.sha256 !== before.ledger.sha256 ||
        final.pendingTemporaryFiles.length !== 0) {
      throw failure('FOUNDER_NONCE_RECOVERY_STATE_CHANGED');
    }
    await assertDirectoryIdentity(directory, directoryIdentity);

    const currentLock = await lstat(final.lockPath);
    if (currentLock.isSymbolicLink() || !currentLock.isFile() ||
        currentLock.dev !== before.lock.device || currentLock.ino !== before.lock.inode) {
      throw failure('FOUNDER_NONCE_RECOVERY_LOCK_CHANGED');
    }

    await unlink(final.lockPath);
    try {
      await assertDirectoryIdentity(directory, directoryIdentity);
      await syncDirectory(directory);
      await assertDirectoryIdentity(directory, directoryIdentity);
    } catch {
      keepRecoveryLease = true;
      throw failure('FOUNDER_NONCE_RECOVERY_DURABILITY_UNCERTAIN', 'lock may already be absent');
    }

    let after;
    try {
      after = await lstat(final.lockPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        // The original lock was durably unlinked, but an unreadable final
        // pathname cannot prove that no replacement lock exists. Keep the
        // recovery fence in place until an operator can inspect the directory.
        keepRecoveryLease = true;
        throw failure('FOUNDER_NONCE_RECOVERY_LOCK_STATE_UNCERTAIN', error?.message || String(error));
      }
    }
    if (after) {
      const replacementLockPresent = after.dev !== currentLock.dev || after.ino !== currentLock.ino;
      keepRecoveryLease = true;
      throw failure(replacementLockPresent
        ? 'FOUNDER_NONCE_RECOVERY_NEW_LOCK_PRESENT'
        : 'FOUNDER_NONCE_RECOVERY_LOCK_STILL_PRESENT');
    }

    result = {
      status: 'recovered',
      lockRemoved: true,
      replacementLockPresent: false,
      lockPath: final.lockPath,
      ledgerPath: final.ledgerPath,
      ledger: final.ledger,
      ledgerModified: false,
      safeToRemove: false,
      authorityGranted: false,
      warning: RECOVERY_WARNING
    };
  } catch (error) {
    operationError = error;
    if (error?.code === 'FOUNDER_NONCE_RECOVERY_DURABILITY_UNCERTAIN' ||
        error?.code === 'FOUNDER_NONCE_RECOVERY_NEW_LOCK_PRESENT' ||
        error?.code === 'FOUNDER_NONCE_RECOVERY_LOCK_STILL_PRESENT' ||
        error?.code === 'FOUNDER_NONCE_RECOVERY_LEASE_CHANGED') {
      keepRecoveryLease = true;
    }
  }

  if (keepRecoveryLease) {
    await recoveryLease.handle.close().catch(() => {});
    throw operationError || failure('FOUNDER_NONCE_RECOVERY_DURABILITY_UNCERTAIN');
  }

  await releaseRecoveryLease(recoveryLease, directory);
  if (operationError) throw operationError;
  return result;
}
function usage() {
  return [
    'Usage:',
    '  npm run recover:founder-nonce',
    '  npm run recover:founder-nonce -- --recover --confirm-owner-stopped --confirm-same-host',
    '',
    'NGL_FOUNDER_NONCE_LEDGER_PATH must name the absolute host-configured nonce ledger.',
    'The first form is read-only. The second removes only a validated stale lock; it never deletes pending temporary files or changes nonce contents.',
    'Recovery holds .founder-nonce-recovery.lock to fence new writers; if it remains after interruption, inspect it manually before cleanup.',
    'The lease coordinates only writers running this version; stop older writers before recovery.',
    'A PID probe is advisory. Confirm the owner is stopped and the lock belongs to this host/PID namespace.'
  ].join('\n');
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage());
    return 0;
  }
  const ledgerPath = process.env.NGL_FOUNDER_NONCE_LEDGER_PATH;
  if (!ledgerPath || !parse(ledgerPath).root) {
    throw failure('FOUNDER_NONCE_LEDGER_UNCONFIGURED');
  }
  if (args.length === 0) {
    const result = await inspectFounderNonceRecovery(ledgerPath);
    console.log(JSON.stringify(result, null, 2));
    return ['blocked', 'manual-inspection-required'].includes(result.status) ? 2 : 0;
  }
  if (args.length === 3 &&
      args.includes('--recover') &&
      args.includes('--confirm-owner-stopped') &&
      args.includes('--confirm-same-host')) {
    const result = await recoverFounderNonceLock({
      ledgerPath,
      confirmOwnerStopped: true,
      confirmSameHost: true
    });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  console.error(usage());
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    const status = String(error?.code || '').includes('DURABILITY_UNCERTAIN')
      ? 'durability-uncertain'
      : 'error';
    console.error(JSON.stringify({
      status,
      code: error?.code || 'FOUNDER_NONCE_RECOVERY_FAILED',
      message: error instanceof Error ? error.message : String(error),
      safeToRemove: false,
      authorityGranted: false
    }, null, 2));
    process.exitCode = 1;
  }
}
