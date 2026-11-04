import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chmod, lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectFounderNonceRecovery,
  recoverFounderNonceLock
} from '../scripts/recover-founder-nonce-lock.mjs';

const NONCE = 'a'.repeat(32);
const LOCK_SCHEMA = 'ngl.ledger-lock.v1';
const LEDGER_SCHEMA = 'ngl.founder-nonce-ledger.v1';

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function fixture(t, { withLedger = true, withLock = true, pid = 2147483647 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-founder-nonce-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ledgerPath = join(directory, 'founder-nonces.json');
  const lockPath = join(directory, '.founder-nonce.lock');
  const recoveryLeasePath = join(directory, '.founder-nonce-recovery.lock');
  if (withLedger) {
    await writeFile(ledgerPath, canonical({ schema: LEDGER_SCHEMA, nonces: [NONCE] }), { mode: 0o600 });
  }
  if (withLock) {
    await writeFile(lockPath, canonical({
      schema: LOCK_SCHEMA,
      pid,
      openedAt: new Date().toISOString()
    }), { mode: 0o600 });
  }
  return { directory, ledgerPath, lockPath, recoveryLeasePath };
}

test('read-only inspection identifies a dead-owner nonce lock but never authorizes deletion', async t => {
  const value = await fixture(t);
  const result = await inspectFounderNonceRecovery(value.ledgerPath);
  assert.equal(result.status, 'ready');
  assert.equal(result.owner.processProbe, 'not-found');
  assert.equal(result.ledger.nonceCount, 1);
  assert.match(result.ledger.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.safeToRemove, false);
  assert.equal(result.requiresHumanConfirmation, true);
  assert.equal(result.ledgerModified, false);
  assert.equal(await exists(value.lockPath), true);
});

test('recovery requires both explicit offline-owner and same-host confirmations', async t => {
  const value = await fixture(t);
  await assert.rejects(
    recoverFounderNonceLock({
      ledgerPath: value.ledgerPath,
      confirmOwnerStopped: true,
      confirmSameHost: false
    }),
    /FOUNDER_NONCE_RECOVERY_CONFIRMATION_REQUIRED/
  );
  assert.equal(await exists(value.lockPath), true);
});

test('explicit offline recovery removes only the stale lock and preserves the exact nonce ledger bytes', async t => {
  const value = await fixture(t);
  const before = await readFile(value.ledgerPath);
  const result = await recoverFounderNonceLock({
    ledgerPath: value.ledgerPath,
    confirmOwnerStopped: true,
    confirmSameHost: true
  });
  assert.equal(result.status, 'recovered');
  assert.equal(result.lockRemoved, true);
  assert.equal(result.replacementLockPresent, false);
  assert.equal(result.ledgerModified, false);
  assert.equal(result.authorityGranted, false);
  assert.equal(await exists(value.recoveryLeasePath), false);
  assert.deepEqual(await readFile(value.ledgerPath), before);
  assert.equal(await exists(value.lockPath), false);
});

test('a possibly-live lock owner blocks recovery even with explicit confirmations', async t => {
  const value = await fixture(t, { pid: process.pid });
  const result = await inspectFounderNonceRecovery(value.ledgerPath);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'owner-process-not-proven-absent');
  await assert.rejects(
    recoverFounderNonceLock({
      ledgerPath: value.ledgerPath,
      confirmOwnerStopped: true,
      confirmSameHost: true
    }),
    /FOUNDER_NONCE_RECOVERY_NOT_READY/
  );
  assert.equal(await exists(value.lockPath), true);
});

test('a pre-rename temporary ledger blocks recovery for manual inspection', async t => {
  const value = await fixture(t);
  const temporary = join(value.directory, '.founder-nonce-' + randomUUID() + '.tmp');
  await writeFile(temporary, 'uncommitted fixture bytes', { mode: 0o600 });
  const result = await inspectFounderNonceRecovery(value.ledgerPath);
  assert.equal(result.status, 'manual-inspection-required');
  assert.equal(result.pendingTemporaryFiles.length, 1);
  assert.equal(result.pendingTemporaryFiles[0].regularFile, true);
  await assert.rejects(
    recoverFounderNonceLock({
      ledgerPath: value.ledgerPath,
      confirmOwnerStopped: true,
      confirmSameHost: true
    }),
    /FOUNDER_NONCE_RECOVERY_NOT_READY/
  );
  assert.equal(await exists(value.lockPath), true);
  assert.equal(await exists(temporary), true);
});

test('corrupt nonce ledger blocks recovery without removing its lock', async t => {
  const value = await fixture(t);
  await writeFile(value.ledgerPath, '{"schema":"wrong","nonces":[]}', { mode: 0o600 });
  await assert.rejects(
    inspectFounderNonceRecovery(value.ledgerPath),
    /FOUNDER_NONCE_RECOVERY_LEDGER_TAMPERED/
  );
  assert.equal(await exists(value.lockPath), true);
});

test('a writable non-sticky recovery directory is rejected before lock inspection', async t => {
  const value = await fixture(t);
  await chmod(value.directory, 0o777);
  try {
    await assert.rejects(
      inspectFounderNonceRecovery(value.ledgerPath),
      /FOUNDER_NONCE_RECOVERY_UNSAFE_DIRECTORY/
    );
    assert.equal(await exists(value.lockPath), true);
  } finally {
    await chmod(value.directory, 0o700);
  }
});

test('a missing lock is a no-op and cannot be reported as recovered', async t => {
  const value = await fixture(t, { withLock: false });
  const result = await inspectFounderNonceRecovery(value.ledgerPath);
  assert.equal(result.status, 'no-lock');
  await assert.rejects(
    recoverFounderNonceLock({
      ledgerPath: value.ledgerPath,
      confirmOwnerStopped: true,
      confirmSameHost: true
    }),
    /FOUNDER_NONCE_RECOVERY_NOT_READY/
  );
});

test('recovery accepts only an absolute host-configured ledger path', async () => {
  await assert.rejects(
    inspectFounderNonceRecovery('relative/founder-nonces.json'),
    /FOUNDER_NONCE_RECOVERY_ABSOLUTE_LEDGER_PATH_REQUIRED/
  );
});

test('portable preflight fingerprints the recovery command and its regression tests', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts['recover:founder-nonce'], 'node scripts/recover-founder-nonce-lock.mjs');
  const command = packageJson.scripts['agent:preflight:ci'];
  assert.ok(command.includes('--path src/institution/lock-inspector.mjs'));
  assert.ok(command.includes('--path src/strict-json.mjs'));
  assert.ok(command.includes('--path scripts/recover-founder-nonce-lock.mjs'));
  assert.ok(command.includes('--path test/founder-nonce-recovery.test.mjs'));
});


test('orphaned pre-rename temporary files remain visible when the owner lock is already absent', async t => {
  const value = await fixture(t, { withLock: false });
  const temporary = join(value.directory, '.founder-nonce-' + randomUUID() + '.tmp');
  await writeFile(temporary, 'orphaned fixture bytes', { mode: 0o600 });
  const result = await inspectFounderNonceRecovery(value.ledgerPath);
  assert.equal(result.status, 'manual-inspection-required');
  assert.equal(result.reason, 'orphaned-temporary-files-remain-without-an-owner-lock');
  assert.equal(result.pendingTemporaryFiles.length, 1);
  assert.equal(await exists(value.lockPath), false);
  assert.equal(await exists(temporary), true);
});

test('a stale lock without a nonce ledger requires separate replay-history acknowledgement', async t => {
  const value = await fixture(t, { withLedger: false });
  const inspection = await inspectFounderNonceRecovery(value.ledgerPath);
  assert.equal(inspection.status, 'ready');
  assert.equal(inspection.ledger.exists, false);

  await assert.rejects(
    recoverFounderNonceLock({
      ledgerPath: value.ledgerPath,
      confirmOwnerStopped: true,
      confirmSameHost: true
    }),
    /FOUNDER_NONCE_RECOVERY_LEDGER_ABSENT_CONFIRMATION_REQUIRED/
  );
  assert.equal(await exists(value.ledgerPath), false);
  assert.equal(await exists(value.lockPath), true, 'the owner lock must remain without the separate acknowledgement');
  assert.equal(await exists(value.recoveryLeasePath), false, 'the temporary recovery lease must be released after the refusal');

  const result = await recoverFounderNonceLock({
    ledgerPath: value.ledgerPath,
    confirmOwnerStopped: true,
    confirmSameHost: true,
    confirmLedgerAbsent: true
  });
  assert.equal(result.status, 'recovered');
  assert.equal(result.ledger.exists, false);
  assert.equal(result.ledgerModified, false);
  assert.equal(result.ledgerAbsenceConfirmed, true);
  assert.equal(await exists(value.ledgerPath), false, 'recovery must not invent nonce history');
  assert.equal(await exists(value.lockPath), false);
  assert.equal(await exists(value.recoveryLeasePath), false);
});

test('an unrecognized lock schema blocks recovery instead of being treated as a Founder nonce lock', async t => {
  const value = await fixture(t);
  await writeFile(value.lockPath, canonical({
    schema: 'ngl.unknown-lock.v9',
    pid: 2147483647,
    openedAt: new Date().toISOString()
  }), { mode: 0o600 });
  const result = await inspectFounderNonceRecovery(value.ledgerPath);
  assert.equal(result.status, 'blocked');
  assert.equal(result.lockFormat, 'unrecognized-json');
  assert.equal(await exists(value.lockPath), true);
});


test('a concurrent recovery lease blocks a second recovery without changing the nonce ledger or writer lock', async t => {
  const value = await fixture(t);
  const before = await readFile(value.ledgerPath);
  await writeFile(value.recoveryLeasePath, canonical({
    schema: 'ngl.founder-nonce-recovery.v1',
    pid: process.pid,
    openedAt: new Date().toISOString()
  }), { mode: 0o600 });

  await assert.rejects(
    recoverFounderNonceLock({
      ledgerPath: value.ledgerPath,
      confirmOwnerStopped: true,
      confirmSameHost: true
    }),
    /FOUNDER_NONCE_RECOVERY_IN_PROGRESS/
  );
  assert.equal(await exists(value.lockPath), true);
  assert.equal(await exists(value.recoveryLeasePath), true);
  assert.deepEqual(await readFile(value.ledgerPath), before);
});

test('read-only inspection reports an active recovery lease as blocked', async t => {
  const value = await fixture(t);
  await writeFile(value.recoveryLeasePath, canonical({
    schema: 'ngl.founder-nonce-recovery.v1',
    pid: process.pid,
    openedAt: new Date().toISOString()
  }), { mode: 0o600 });

  const result = await inspectFounderNonceRecovery(value.ledgerPath);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'recovery-lease-present-manual-inspection-required');
  assert.equal(result.recoveryLease.status, 'present');
  assert.equal(result.recoveryLease.format, 'owner-metadata');
  assert.equal(result.recoveryLease.owner.schema, 'ngl.founder-nonce-recovery.v1');
  assert.equal(result.recoveryLease.owner.processProbe, 'possibly-alive');
  assert.equal(result.recoveryLeaseProcessProbeAdvisoryOnly, true);
  assert.equal(result.recoveryLeaseSafeToRemove, false);
  assert.equal(result.safeToRemove, false);
  assert.equal(result.authorityGranted, false);
  assert.equal(await exists(value.recoveryLeasePath), true);
});

test('public inspection cannot bypass a present recovery lease with caller options', async t => {
  const value = await fixture(t);
  await writeFile(value.recoveryLeasePath, canonical({
    schema: 'ngl.founder-nonce-recovery.v1',
    pid: process.pid,
    openedAt: new Date().toISOString()
  }), { mode: 0o600 });

  const result = await inspectFounderNonceRecovery(value.ledgerPath, { ignoreRecoveryLease: true });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'recovery-lease-present-manual-inspection-required');
  assert.equal(result.recoveryLease.owner.processProbe, 'possibly-alive');
  assert.equal(result.recoveryLeaseSafeToRemove, false);
  assert.equal(result.safeToRemove, false);
  assert.equal(result.authorityGranted, false);
  assert.equal(await exists(value.recoveryLeasePath), true);
});

test('read-only inspection reports an absent recovery-lease PID but never authorizes cleanup', async t => {
  const value = await fixture(t);
  await writeFile(value.recoveryLeasePath, canonical({
    schema: 'ngl.founder-nonce-recovery.v1',
    pid: 2147483647,
    openedAt: new Date().toISOString()
  }), { mode: 0o600 });

  const result = await inspectFounderNonceRecovery(value.ledgerPath);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'recovery-lease-present-manual-inspection-required');
  assert.equal(result.recoveryLease.owner.processProbe, 'not-found');
  assert.equal(result.recoveryLeaseSafeToRemove, false);
  assert.equal(result.safeToRemove, false);
  assert.equal(result.authorityGranted, false);
  assert.equal(await exists(value.recoveryLeasePath), true);
  assert.equal(await exists(value.lockPath), true);
});

test('unrecognized recovery-lease metadata remains blocked with a diagnostic reason', async t => {
  const value = await fixture(t);
  await writeFile(value.recoveryLeasePath, canonical({
    schema: 'ngl.unknown-recovery-lease.v9',
    pid: 2147483647,
    openedAt: new Date().toISOString()
  }), { mode: 0o600 });

  const result = await inspectFounderNonceRecovery(value.ledgerPath);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'recovery-lease-requires-manual-inspection');
  assert.equal(result.recoveryLease.status, 'present');
  assert.equal(result.recoveryLease.format, 'unrecognized-json');
  assert.equal(result.recoveryLease.reason, 'unsupported-lock-schema');
  assert.equal(result.recoveryLeaseSafeToRemove, false);
  assert.equal(result.safeToRemove, false);
  assert.equal(result.authorityGranted, false);
  assert.equal(await exists(value.recoveryLeasePath), true);
});

test('recovery CLI help loads without host configuration and documents the recovery lease', () => {
  const scriptPath = fileURLToPath(new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath, '--help'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /founder-nonce-recovery\.lock/);
  assert.match(result.stdout, /--confirm-ledger-absent/);
  assert.match(result.stdout, /absence cannot prove that prior replay history never existed/);
});



test('recovery CLI requires explicit acknowledgement when the nonce ledger is absent', async t => {
  const value = await fixture(t, { withLedger: false });
  const scriptPath = fileURLToPath(new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url));
  const env = { ...process.env, NGL_FOUNDER_NONCE_LEDGER_PATH: value.ledgerPath };
  const baseArgs = [scriptPath, '--recover', '--confirm-owner-stopped', '--confirm-same-host'];

  const unacknowledged = spawnSync(process.execPath, baseArgs, {
    encoding: 'utf8',
    timeout: 10000,
    env
  });
  assert.equal(unacknowledged.status, 1, unacknowledged.stdout);
  assert.match(unacknowledged.stderr, /FOUNDER_NONCE_RECOVERY_LEDGER_ABSENT_CONFIRMATION_REQUIRED/);
  assert.equal(await exists(value.lockPath), true);
  assert.equal(await exists(value.recoveryLeasePath), false);
  assert.equal(await exists(value.ledgerPath), false);

  const acknowledged = spawnSync(process.execPath, [...baseArgs, '--confirm-ledger-absent'], {
    encoding: 'utf8',
    timeout: 10000,
    env
  });
  assert.equal(acknowledged.status, 0, acknowledged.stderr);
  assert.match(acknowledged.stdout, /"status": "recovered"/);
  assert.match(acknowledged.stdout, /"ledgerAbsenceConfirmed": true/);
  assert.equal(await exists(value.lockPath), false);
  assert.equal(await exists(value.recoveryLeasePath), false);
  assert.equal(await exists(value.ledgerPath), false);
});

test('unreadable post-unlink owner-lock inspection retains the recovery fence', async t => {
  const value = await fixture(t);
  const ledgerBefore = await readFile(value.ledgerPath);
  const recoveryModule = new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url).href;
  const childSource = [
    "import fsPromises from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalLstat = fsPromises.lstat;",
    "const originalUnlink = fsPromises.unlink;",
    "let ownerLockUnlinked = false;",
    "fsPromises.unlink = async (target, ...args) => {",
    "  const result = await originalUnlink(target, ...args);",
    "  if (String(target).endsWith('/.founder-nonce.lock')) ownerLockUnlinked = true;",
    "  return result;",
    "};",
    "fsPromises.lstat = async (target, ...args) => {",
    "  if (ownerLockUnlinked && String(target).endsWith('/.founder-nonce.lock')) {",
    "    const error = new Error('injected post-unlink inspection failure');",
    "    error.code = 'EACCES';",
    "    throw error;",
    "  }",
    "  return originalLstat(target, ...args);",
    "};",
    "syncBuiltinESMExports();",
    "const { recoverFounderNonceLock } = await import(process.env.TEST_RECOVERY_MODULE);",
    "try {",
    "  await recoverFounderNonceLock({",
    "    ledgerPath: process.env.TEST_LEDGER,",
    "    confirmOwnerStopped: true,",
    "    confirmSameHost: true",
    "  });",
    "  console.log('UNEXPECTED_SUCCESS');",
    "  process.exitCode = 1;",
    "} catch (error) {",
    "  console.log('ERROR:' + (error?.code || error?.message || String(error)));",
    "}"
  ].join("\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      TEST_OWNER_LOCK: value.lockPath,
      TEST_LEDGER: value.ledgerPath,
      TEST_RECOVERY_MODULE: recoveryModule
    }
  });

  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /ERROR:FOUNDER_NONCE_RECOVERY_LOCK_STATE_UNCERTAIN/);
  assert.equal(await exists(value.lockPath), false, 'the original owner lock was already durably removed');
  assert.equal(await exists(value.recoveryLeasePath), true, 'the recovery fence must remain when final lock state is unreadable');
  assert.deepEqual(await readFile(value.ledgerPath), ledgerBefore, 'nonce ledger bytes must remain unchanged');
});


test('read-only recovery inspection opens the nonce ledger without write access', async t => {
  const value = await fixture(t);
  const recoveryModule = new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url).href;
  const childSource = [
    "import fsPromises from 'node:fs/promises';",
    "import { constants as fsConstants } from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalOpen = fsPromises.open;",
    "let ledgerAccessMode = null;",
    "fsPromises.open = async (target, flags, ...args) => {",
    "  if (String(target) === process.env.TEST_LEDGER) {",
    "    ledgerAccessMode = flags & fsConstants.O_ACCMODE;",
    "    if (ledgerAccessMode !== fsConstants.O_RDONLY) {",
    "      const error = new Error('read-only filesystem denies writable open');",
    "      error.code = 'EROFS';",
    "      throw error;",
    "    }",
    "  }",
    "  return originalOpen(target, flags, ...args);",
    "};",
    "syncBuiltinESMExports();",
    "const { inspectFounderNonceRecovery } = await import(process.env.TEST_RECOVERY_MODULE);",
    "const result = await inspectFounderNonceRecovery(process.env.TEST_LEDGER);",
    "console.log(JSON.stringify({ status: result.status, ledger: result.ledger, ledgerAccessMode }));"
  ].join("\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      TEST_LEDGER: value.ledgerPath,
      TEST_RECOVERY_MODULE: recoveryModule
    }
  });

  assert.equal(child.status, 0, child.stderr);
  const observed = JSON.parse(child.stdout);
  assert.equal(observed.status, 'ready');
  assert.equal(observed.ledger.exists, true);
  assert.equal(observed.ledger.nonceCount, 1);
  assert.equal(observed.ledgerAccessMode, 0, 'read-only inspection must request O_RDONLY');
});


test('read-only inspection rechecks a recovery lease that appears during its snapshot', async t => {
  const value = await fixture(t);
  const ledgerBefore = await readFile(value.ledgerPath);
  const recoveryModule = new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url).href;
  const leaseBytes = canonical({
    schema: 'ngl.founder-nonce-recovery.v1',
    pid: process.pid,
    openedAt: new Date().toISOString()
  });
  const childSource = [
    "import fsPromises from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalLstat = fsPromises.lstat;",
    "const originalWriteFile = fsPromises.writeFile;",
    "let leaseCreated = false;",
    "fsPromises.lstat = async (target, ...args) => {",
    "  if (!leaseCreated && String(target) === process.env.TEST_OWNER_LOCK) {",
    "    leaseCreated = true;",
    "    await originalWriteFile(process.env.TEST_RECOVERY_LEASE, process.env.TEST_LEASE_BYTES, { mode: 0o600 });",
    "  }",
    "  return originalLstat(target, ...args);",
    "};",
    "syncBuiltinESMExports();",
    "const { inspectFounderNonceRecovery } = await import(process.env.TEST_RECOVERY_MODULE);",
    "const result = await inspectFounderNonceRecovery(process.env.TEST_LEDGER);",
    "console.log(JSON.stringify({ status: result.status, reason: result.reason, recoveryLease: result.recoveryLease, recoveryLeaseSafeToRemove: result.recoveryLeaseSafeToRemove }));"
  ].join("\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      TEST_OWNER_LOCK: value.lockPath,
      TEST_RECOVERY_LEASE: value.recoveryLeasePath,
      TEST_LEASE_BYTES: leaseBytes,
      TEST_LEDGER: value.ledgerPath,
      TEST_RECOVERY_MODULE: recoveryModule
    }
  });

  assert.equal(child.status, 0, child.stderr);
  const observed = JSON.parse(child.stdout);
  assert.equal(observed.status, 'blocked');
  assert.equal(observed.reason, 'recovery-lease-present-manual-inspection-required');
  assert.equal(observed.recoveryLease.owner.processProbe, 'possibly-alive');
  assert.equal(observed.recoveryLeaseSafeToRemove, false);
  assert.equal(await exists(value.lockPath), true);
  assert.equal(await exists(value.recoveryLeasePath), true);
  assert.deepEqual(await readFile(value.ledgerPath), ledgerBefore);
});


test('nonce ledger path cannot alias reserved owner, recovery lease, or temporary file names', async t => {
  const value = await fixture(t);
  const ledgerBefore = await readFile(value.ledgerPath);
  const temporaryLedgerPath = join(value.directory, '.founder-nonce-' + randomUUID() + '.tmp');

  await assert.rejects(
    inspectFounderNonceRecovery(value.lockPath),
    /FOUNDER_NONCE_RECOVERY_LEDGER_PATH_INVALID/
  );
  await assert.rejects(
    inspectFounderNonceRecovery(value.recoveryLeasePath),
    /FOUNDER_NONCE_RECOVERY_LEDGER_PATH_INVALID/
  );
  await assert.rejects(
    inspectFounderNonceRecovery(temporaryLedgerPath),
    /FOUNDER_NONCE_RECOVERY_LEDGER_PATH_INVALID/
  );
  await assert.rejects(
    recoverFounderNonceLock({
      ledgerPath: value.lockPath,
      confirmOwnerStopped: true,
      confirmSameHost: true
    }),
    /FOUNDER_NONCE_RECOVERY_LEDGER_PATH_INVALID/
  );
  await assert.rejects(
    recoverFounderNonceLock({
      ledgerPath: value.recoveryLeasePath,
      confirmOwnerStopped: true,
      confirmSameHost: true
    }),
    /FOUNDER_NONCE_RECOVERY_LEDGER_PATH_INVALID/
  );
  await assert.rejects(
    recoverFounderNonceLock({
      ledgerPath: temporaryLedgerPath,
      confirmOwnerStopped: true,
      confirmSameHost: true
    }),
    /FOUNDER_NONCE_RECOVERY_LEDGER_PATH_INVALID/
  );

  assert.equal(await exists(temporaryLedgerPath), false);
  assert.equal(await exists(value.lockPath), true);
  assert.equal(await exists(value.recoveryLeasePath), false);
  assert.deepEqual(await readFile(value.ledgerPath), ledgerBefore);
});


test('read-only inspection blocks a temporary nonce file created during its snapshot', async t => {
  const value = await fixture(t);
  const ledgerBefore = await readFile(value.ledgerPath);
  const temporaryPath = join(value.directory, '.founder-nonce-' + randomUUID() + '.tmp');
  const recoveryModule = new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url).href;
  const childSource = [
    "import fsPromises from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalReaddir = fsPromises.readdir;",
    "const originalWriteFile = fsPromises.writeFile;",
    "let injected = false;",
    "fsPromises.readdir = async (target, ...args) => {",
    "  const entries = await originalReaddir(target, ...args);",
    "  if (!injected && String(target) === process.env.TEST_DIRECTORY) {",
    "    injected = true;",
    "    await originalWriteFile(process.env.TEST_TEMPORARY, 'late temporary nonce bytes', { mode: 0o600 });",
    "  }",
    "  return entries;",
    "};",
    "syncBuiltinESMExports();",
    "const { inspectFounderNonceRecovery } = await import(process.env.TEST_RECOVERY_MODULE);",
    "const result = await inspectFounderNonceRecovery(process.env.TEST_LEDGER);",
    "console.log(JSON.stringify({ status: result.status, reason: result.reason, pendingTemporaryFiles: result.pendingTemporaryFiles }));"
  ].join("\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      TEST_DIRECTORY: value.directory,
      TEST_TEMPORARY: temporaryPath,
      TEST_LEDGER: value.ledgerPath,
      TEST_RECOVERY_MODULE: recoveryModule
    }
  });

  assert.equal(child.status, 0, child.stderr);
  const observed = JSON.parse(child.stdout);
  assert.equal(observed.status, 'blocked');
  assert.equal(observed.reason, 'temporary-files-changed-during-recovery-inspection');
  assert.equal(observed.pendingTemporaryFiles.length, 1);
  assert.equal(observed.pendingTemporaryFiles[0].name, temporaryPath.slice(temporaryPath.lastIndexOf('/') + 1));
  assert.equal(await exists(value.lockPath), true);
  assert.equal(await exists(temporaryPath), true);
  assert.equal(await exists(value.recoveryLeasePath), false);
  assert.deepEqual(await readFile(value.ledgerPath), ledgerBefore);
});


test('offline recovery refuses owner-lock removal when a temporary nonce file appears before unlink', async t => {
  const value = await fixture(t);
  const ledgerBefore = await readFile(value.ledgerPath);
  const temporaryPath = join(value.directory, '.founder-nonce-' + randomUUID() + '.tmp');
  const recoveryModule = new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url).href;
  const childSource = [
    "import fsPromises from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalReaddir = fsPromises.readdir;",
    "const originalWriteFile = fsPromises.writeFile;",
    "let directoryReads = 0;",
    "let injected = false;",
    "fsPromises.readdir = async (target, ...args) => {",
    "  const entries = await originalReaddir(target, ...args);",
    "  if (String(target) === process.env.TEST_DIRECTORY || String(target).includes('/proc/self/fd/') || String(target).includes('/dev/fd/')) {",
    "    directoryReads += 1;",
    "    if (!injected && directoryReads === 4) {",
    "      injected = true;",
    "      await originalWriteFile(process.env.TEST_TEMPORARY, 'late pre-unlink nonce bytes', { mode: 0o600 });",
    "    }",
    "  }",
    "  return entries;",
    "};",
    "syncBuiltinESMExports();",
    "const { recoverFounderNonceLock } = await import(process.env.TEST_RECOVERY_MODULE);",
    "try {",
    "  await recoverFounderNonceLock({ ledgerPath: process.env.TEST_LEDGER, confirmOwnerStopped: true, confirmSameHost: true });",
    "  console.log(JSON.stringify({ status: 'unexpected-recovered', directoryReads }));",
    "  process.exitCode = 1;",
    "} catch (error) {",
    "  console.log(JSON.stringify({ status: 'blocked', code: error?.code || String(error), directoryReads }));",
    "}"
  ].join("\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      TEST_DIRECTORY: value.directory,
      TEST_TEMPORARY: temporaryPath,
      TEST_LEDGER: value.ledgerPath,
      TEST_RECOVERY_MODULE: recoveryModule
    }
  });

  assert.equal(child.status, 0, child.stderr);
  const observed = JSON.parse(child.stdout);
  assert.equal(observed.status, 'blocked');
  assert.equal(observed.code, 'FOUNDER_NONCE_RECOVERY_STATE_CHANGED');
  assert.equal(observed.directoryReads, 5, 'the final directory listing must be the pre-unlink guard');
  assert.equal(await exists(value.lockPath), true);
  assert.equal(await exists(temporaryPath), true);
  assert.equal(await exists(value.recoveryLeasePath), false);
  assert.deepEqual(await readFile(value.ledgerPath), ledgerBefore);
});



test('offline recovery never unlinks a replacement-directory owner lock after path swap', async t => {
  const value = await fixture(t);
  const ledgerBefore = await readFile(value.ledgerPath);
  const movedDirectory = value.directory + '-original';
  const replacementDirectory = await mkdtemp(join(tmpdir(), 'ngl-founder-nonce-replacement-'));
  await chmod(replacementDirectory, 0o700);
  await writeFile(join(replacementDirectory, '.founder-nonce.lock'), 'replacement-owner-lock', { mode: 0o600 });
  const recoveryModule = new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url).href;
  const childSource = [
    "import fsPromises from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalUnlink = fsPromises.unlink;",
    "let swapped = false;",
    "fsPromises.unlink = async (target, ...args) => {",
    "  if (!swapped && String(target).endsWith('/.founder-nonce.lock')) {",
    "    await fsPromises.rename(process.env.TEST_DIRECTORY, process.env.TEST_MOVED_DIRECTORY);",
    "    await fsPromises.rename(process.env.TEST_REPLACEMENT_DIRECTORY, process.env.TEST_DIRECTORY);",
    "    swapped = true;",
    "  }",
    "  return originalUnlink(target, ...args);",
    "};",
    "syncBuiltinESMExports();",
    "const { recoverFounderNonceLock } = await import(process.env.TEST_RECOVERY_MODULE);",
    "try {",
    "  const result = await recoverFounderNonceLock({ ledgerPath: process.env.TEST_LEDGER, confirmOwnerStopped: true, confirmSameHost: true });",
    "  console.log(JSON.stringify({ status: result.status, swapped }));",
    "} catch (error) {",
    "  console.log(JSON.stringify({ status: 'blocked', code: error?.code || String(error), swapped }));",
    "}"
  ].join("\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      TEST_DIRECTORY: value.directory,
      TEST_MOVED_DIRECTORY: movedDirectory,
      TEST_REPLACEMENT_DIRECTORY: replacementDirectory,
      TEST_LEDGER: value.ledgerPath,
      TEST_RECOVERY_MODULE: recoveryModule
    }
  });

  try {
    assert.equal(child.status, 0, child.stderr);
    const observed = JSON.parse(child.stdout);
    assert.equal(observed.status, 'blocked');
    assert.equal(observed.swapped, true);
    assert.equal(await exists(join(movedDirectory, '.founder-nonce.lock')), false,
      'the inspected original owner lock may be removed, but no replacement lock may be touched');
    assert.equal(await readFile(join(value.directory, '.founder-nonce.lock'), 'utf8'), 'replacement-owner-lock',
      'the replacement directory owner lock must remain byte-for-byte untouched');
    assert.equal(await exists(join(movedDirectory, '.founder-nonce-recovery.lock')), true,
      'the recovery fence must remain in the inspected original directory after path replacement');
    assert.deepEqual(await readFile(join(movedDirectory, 'founder-nonces.json')), ledgerBefore);
  } finally {
    await rm(movedDirectory, { recursive: true, force: true });
  }
});



test('recovery lease creation stays in the inspected directory when its configured path is replaced at open', async t => {
  const value = await fixture(t);
  const ledgerBefore = await readFile(value.ledgerPath);
  const movedDirectory = value.directory + '-original';
  const replacementDirectory = await mkdtemp(join(tmpdir(), 'ngl-founder-nonce-replacement-'));
  await chmod(replacementDirectory, 0o700);
  const recoveryModule = new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url).href;
  const childSource = [
    "import fsPromises from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalOpen = fsPromises.open;",
    "let swapped = false;",
    "let descriptorTarget = false;",
    "let replacementHadLease = false;",
    "fsPromises.open = async (target, ...args) => {",
    "  const isLease = String(target).endsWith('/.founder-nonce-recovery.lock');",
    "  if (isLease && !swapped) {",
    "    await fsPromises.rename(process.env.TEST_DIRECTORY, process.env.TEST_MOVED_DIRECTORY);",
    "    await fsPromises.rename(process.env.TEST_REPLACEMENT_DIRECTORY, process.env.TEST_DIRECTORY);",
    "    swapped = true;",
    "  }",
    "  const handle = await originalOpen(target, ...args);",
    "  if (isLease) {",
    "    descriptorTarget = String(target).includes('/proc/self/fd/') || String(target).includes('/dev/fd/');",
    "    try { const probe = await originalOpen(process.env.TEST_REPLACEMENT_LEASE, 'r'); replacementHadLease = true; await probe.close(); }",
    "    catch (error) { if (error?.code !== 'ENOENT') throw error; }",
    "  }",
    "  return handle;",
    "};",
    "syncBuiltinESMExports();",
    "const { recoverFounderNonceLock } = await import(process.env.TEST_RECOVERY_MODULE);",
    "try {",
    "  const result = await recoverFounderNonceLock({ ledgerPath: process.env.TEST_LEDGER, confirmOwnerStopped: true, confirmSameHost: true });",
    "  console.log(JSON.stringify({ status: result.status, swapped, descriptorTarget, replacementHadLease }));",
    "} catch (error) {",
    "  console.log(JSON.stringify({ status: 'blocked', code: error?.code || String(error), swapped, descriptorTarget, replacementHadLease }));",
    "}"
  ].join("\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      TEST_DIRECTORY: value.directory,
      TEST_MOVED_DIRECTORY: movedDirectory,
      TEST_REPLACEMENT_DIRECTORY: replacementDirectory,
      TEST_REPLACEMENT_LEASE: join(value.directory, '.founder-nonce-recovery.lock'),
      TEST_LEDGER: value.ledgerPath,
      TEST_RECOVERY_MODULE: recoveryModule
    }
  });

  try {
    assert.equal(child.status, 0, child.stderr);
    const observed = JSON.parse(child.stdout);
    assert.equal(observed.status, 'blocked');
    assert.equal(observed.swapped, true);
    assert.equal(observed.descriptorTarget, true,
      'the recovery lease must be opened through the held directory descriptor');
    assert.equal(observed.replacementHadLease, false,
      'the replacement directory must never receive the recovery lease');
    assert.equal(await exists(join(movedDirectory, '.founder-nonce-recovery.lock')), true,
      'the original directory retains the recovery fence for manual inspection');
    assert.equal(await exists(join(value.directory, '.founder-nonce-recovery.lock')), false);
    assert.equal(await exists(join(movedDirectory, '.founder-nonce.lock')), true);
    assert.deepEqual(await readFile(join(movedDirectory, 'founder-nonces.json')), ledgerBefore);
  } finally {
    await rm(movedDirectory, { recursive: true, force: true });
  }
});


test('offline recovery refuses owner-lock removal when its recovery lease is replaced during recovery', async t => {
  const value = await fixture(t);
  const ledgerBefore = await readFile(value.ledgerPath);
  const replacementOpenedAt = '2000-01-01T00:00:00.000Z';
  const recoveryModule = new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url).href;
  const childSource = [
    "import fsPromises from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalReaddir = fsPromises.readdir;",
    "const originalUnlink = fsPromises.unlink;",
    "const originalWriteFile = fsPromises.writeFile;",
    "let directoryReads = 0;",
    "let replaced = false;",
    "fsPromises.readdir = async (target, ...args) => {",
    "  const entries = await originalReaddir(target, ...args);",
    "  if (String(target) === process.env.TEST_DIRECTORY || String(target).includes('/proc/self/fd/') || String(target).includes('/dev/fd/')) {",
    "    directoryReads += 1;",
    "    if (!replaced && directoryReads === 4) {",
    "      replaced = true;",
    "      await originalUnlink(process.env.TEST_RECOVERY_LEASE);",
    "      const receipt = JSON.stringify({",
    "        openedAt: process.env.TEST_REPLACEMENT_OPENED_AT,",
    "        pid: process.pid,",
    "        schema: 'ngl.founder-nonce-recovery.v1'",
    "      });",
    "      await originalWriteFile(process.env.TEST_RECOVERY_LEASE, receipt, { mode: 0o600 });",
    "    }",
    "  }",
    "  return entries;",
    "};",
    "syncBuiltinESMExports();",
    "const { recoverFounderNonceLock } = await import(process.env.TEST_RECOVERY_MODULE);",
    "try {",
    "  await recoverFounderNonceLock({ ledgerPath: process.env.TEST_LEDGER, confirmOwnerStopped: true, confirmSameHost: true });",
    "  console.log(JSON.stringify({ status: 'unexpected-recovered', directoryReads, replaced }));",
    "  process.exitCode = 1;",
    "} catch (error) {",
    "  console.log(JSON.stringify({ status: 'blocked', code: error?.code || String(error), directoryReads, replaced }));",
    "}"
  ].join("\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      TEST_DIRECTORY: value.directory,
      TEST_RECOVERY_LEASE: value.recoveryLeasePath,
      TEST_LEDGER: value.ledgerPath,
      TEST_RECOVERY_MODULE: recoveryModule,
      TEST_REPLACEMENT_OPENED_AT: replacementOpenedAt
    }
  });

  assert.equal(child.status, 0, child.stderr);
  const observed = JSON.parse(child.stdout);
  assert.equal(observed.status, 'blocked');
  assert.equal(observed.code, 'FOUNDER_NONCE_RECOVERY_LEASE_CHANGED');
  assert.equal(observed.directoryReads, 5, 'the lease identity check must follow the final pre-unlink scan');
  assert.equal(observed.replaced, true);
  assert.equal(await exists(value.lockPath), true);
  assert.equal(await exists(value.recoveryLeasePath), true);
  assert.equal(JSON.parse(await readFile(value.recoveryLeasePath, 'utf8')).openedAt, replacementOpenedAt);
  assert.deepEqual(await readFile(value.ledgerPath), ledgerBefore);
});


test('recovery release preserves a replacement lease after an unsafe owner-lock precondition blocks recovery', async t => {
  const value = await fixture(t);
  const ledgerBefore = await readFile(value.ledgerPath);
  await chmod(value.lockPath, 0o644);
  const lockBefore = await readFile(value.lockPath);
  const replacementOpenedAt = '2001-01-01T00:00:00.000Z';
  const recoveryModule = new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url).href;
  const childSource = [
    "import fsPromises from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalReaddir = fsPromises.readdir;",
    "const originalUnlink = fsPromises.unlink;",
    "const originalWriteFile = fsPromises.writeFile;",
    "let directoryReads = 0;",
    "let replaced = false;",
    "fsPromises.readdir = async (target, ...args) => {",
    "  const entries = await originalReaddir(target, ...args);",
    "  if (String(target) === process.env.TEST_DIRECTORY || String(target).includes('/proc/self/fd/') || String(target).includes('/dev/fd/')) {",
    "    directoryReads += 1;",
    "    if (!replaced && directoryReads === 2) {",
    "      replaced = true;",
    "      await originalUnlink(process.env.TEST_RECOVERY_LEASE);",
    "      const receipt = JSON.stringify({",
    "        openedAt: process.env.TEST_REPLACEMENT_OPENED_AT,",
    "        pid: process.pid,",
    "        schema: 'ngl.founder-nonce-recovery.v1'",
    "      });",
    "      await originalWriteFile(process.env.TEST_RECOVERY_LEASE, receipt, { mode: 0o600 });",
    "    }",
    "  }",
    "  return entries;",
    "};",
    "syncBuiltinESMExports();",
    "const { recoverFounderNonceLock } = await import(process.env.TEST_RECOVERY_MODULE);",
    "try {",
    "  await recoverFounderNonceLock({ ledgerPath: process.env.TEST_LEDGER, confirmOwnerStopped: true, confirmSameHost: true });",
    "  console.log(JSON.stringify({ status: 'unexpected-recovered', directoryReads, replaced }));",
    "  process.exitCode = 1;",
    "} catch (error) {",
    "  console.log(JSON.stringify({ status: 'blocked', code: error?.code || String(error), directoryReads, replaced }));",
    "}"
  ].join("\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      TEST_DIRECTORY: value.directory,
      TEST_RECOVERY_LEASE: value.recoveryLeasePath,
      TEST_LEDGER: value.ledgerPath,
      TEST_RECOVERY_MODULE: recoveryModule,
      TEST_REPLACEMENT_OPENED_AT: replacementOpenedAt
    }
  });

  assert.equal(child.status, 0, child.stderr);
  const observed = JSON.parse(child.stdout);
  assert.equal(observed.status, 'blocked');
  assert.equal(observed.code, 'FOUNDER_NONCE_RECOVERY_LEASE_CHANGED');
  assert.equal(observed.directoryReads, 2, 'the replacement occurs during the first read-only state inspection');
  assert.equal(observed.replaced, true);
  assert.equal(await exists(value.lockPath), true, 'the unsafe owner lock must remain');
  assert.deepEqual(await readFile(value.lockPath), lockBefore);
  assert.equal((await lstat(value.lockPath)).mode & 0o777, 0o644);
  assert.equal(await exists(value.recoveryLeasePath), true, 'release must not unlink the replacement lease');
  assert.equal(JSON.parse(await readFile(value.recoveryLeasePath, 'utf8')).openedAt, replacementOpenedAt);
  assert.deepEqual(await readFile(value.ledgerPath), ledgerBefore);
});

test('offline recovery revalidates owner-lock contents after the final temporary-file scan', async t => {
  const value = await fixture(t);
  const ledgerBefore = await readFile(value.ledgerPath);
  const lockBefore = await lstat(value.lockPath);
  const replacementOpenedAt = '2002-01-01T00:00:00.000Z';
  const recoveryModule = new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url).href;
  const childSource = [
    "import fsPromises from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalReaddir = fsPromises.readdir;",
    "const originalWriteFile = fsPromises.writeFile;",
    "let directoryReads = 0;",
    "let replaced = false;",
    "fsPromises.readdir = async (target, ...args) => {",
    "  const entries = await originalReaddir(target, ...args);",
    "  if (String(target) === process.env.TEST_DIRECTORY || String(target).includes('/proc/self/fd/') || String(target).includes('/dev/fd/')) {",
    "    directoryReads += 1;",
    "    if (!replaced && directoryReads === 5) {",
    "      replaced = true;",
    "      const receipt = JSON.stringify({",
    "        openedAt: process.env.TEST_REPLACEMENT_OPENED_AT,",
    "        pid: process.pid,",
    "        schema: 'ngl.ledger-lock.v1'",
    "      });",
    "      await originalWriteFile(process.env.TEST_OWNER_LOCK, receipt, { mode: 0o600 });",
    "    }",
    "  }",
    "  return entries;",
    "};",
    "syncBuiltinESMExports();",
    "const { recoverFounderNonceLock } = await import(process.env.TEST_RECOVERY_MODULE);",
    "try {",
    "  const result = await recoverFounderNonceLock({",
    "    ledgerPath: process.env.TEST_LEDGER,",
    "    confirmOwnerStopped: true,",
    "    confirmSameHost: true",
    "  });",
    "  console.log(JSON.stringify({ status: result.status, directoryReads, replaced, pid: process.pid }));",
    "} catch (error) {",
    "  console.log(JSON.stringify({ status: 'blocked', code: error?.code || String(error), directoryReads, replaced, pid: process.pid }));",
    "}"
  ].join("\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      TEST_DIRECTORY: value.directory,
      TEST_OWNER_LOCK: value.lockPath,
      TEST_LEDGER: value.ledgerPath,
      TEST_RECOVERY_MODULE: recoveryModule,
      TEST_REPLACEMENT_OPENED_AT: replacementOpenedAt
    }
  });

  assert.equal(child.status, 0, child.stderr);
  const observed = JSON.parse(child.stdout);
  assert.equal(observed.status, 'blocked');
  assert.equal(observed.code, 'FOUNDER_NONCE_RECOVERY_LOCK_CHANGED');
  assert.equal(observed.directoryReads, 5, 'the replacement occurs after the final temporary-file scan');
  assert.equal(observed.replaced, true);
  const lockAfter = await lstat(value.lockPath);
  assert.equal(lockAfter.dev, lockBefore.dev, 'the owner lock was rewritten in place, not replaced by a new inode');
  assert.equal(lockAfter.ino, lockBefore.ino);
  const retained = JSON.parse(await readFile(value.lockPath, 'utf8'));
  assert.equal(retained.pid, observed.pid, 'the active replacement owner must remain recorded');
  assert.equal(retained.openedAt, replacementOpenedAt);
  assert.equal(await exists(value.recoveryLeasePath), true, 'an owner-lock identity change retains the recovery fence for manual inspection');
  const retainedLease = JSON.parse(await readFile(value.recoveryLeasePath, 'utf8'));
  assert.equal(retainedLease.schema, 'ngl.founder-nonce-recovery.v1');
  assert.equal(retainedLease.pid, observed.pid);
  assert.deepEqual(await readFile(value.ledgerPath), ledgerBefore);
});

test('recovery CLI labels post-unlink owner-lock uncertainty distinctly', async t => {
  const value = await fixture(t);
  const ledgerBefore = await readFile(value.ledgerPath);
  const recoveryScript = fileURLToPath(new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url));
  const recoveryModule = new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url).href;
  const childSource = [
    "import fsPromises from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalLstat = fsPromises.lstat;",
    "const originalUnlink = fsPromises.unlink;",
    "let ownerLockUnlinked = false;",
    "fsPromises.unlink = async (target, ...args) => {",
    "  const result = await originalUnlink(target, ...args);",
    "  if (String(target).endsWith('/.founder-nonce.lock')) ownerLockUnlinked = true;",
    "  return result;",
    "};",
    "fsPromises.lstat = async (target, ...args) => {",
    "  if (ownerLockUnlinked && String(target).endsWith('/.founder-nonce.lock')) {",
    "    const error = new Error('injected post-unlink inspection failure');",
    "    error.code = 'EACCES';",
    "    throw error;",
    "  }",
    "  return originalLstat(target, ...args);",
    "};",
    "syncBuiltinESMExports();",
    "process.argv = [process.execPath, process.env.TEST_RECOVERY_SCRIPT, '--recover', '--confirm-owner-stopped', '--confirm-same-host'];",
    "await import(process.env.TEST_RECOVERY_MODULE);"
  ].join("\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      NGL_FOUNDER_NONCE_LEDGER_PATH: value.ledgerPath,
      TEST_OWNER_LOCK: value.lockPath,
      TEST_RECOVERY_SCRIPT: recoveryScript,
      TEST_RECOVERY_MODULE: recoveryModule
    }
  });

  assert.equal(child.status, 1, child.stderr);
  const observed = JSON.parse(child.stderr);
  assert.equal(observed.status, 'state-uncertain');
  assert.equal(observed.code, 'FOUNDER_NONCE_RECOVERY_LOCK_STATE_UNCERTAIN');
  assert.equal(observed.safeToRemove, false);
  assert.equal(observed.authorityGranted, false);
  assert.equal(await exists(value.lockPath), false, 'the original lock was already unlinked before inspection failed');
  assert.equal(await exists(value.recoveryLeasePath), true, 'the recovery fence must remain for manual inspection');
  assert.deepEqual(await readFile(value.ledgerPath), ledgerBefore);
});


test('offline recovery falls back to /dev/fd when /proc/self/fd is unavailable', async t => {
  const value = await fixture(t);
  const ledgerBefore = await readFile(value.ledgerPath);
  const recoveryModule = new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url).href;
  const childSource = [
    "import fsPromises from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalStat = fsPromises.stat;",
    "let procAttempts = 0;",
    "let devAttempts = 0;",
    "fsPromises.stat = async (target, ...args) => {",
    "  const path = String(target);",
    "  if (path.includes('/proc/self/fd/')) {",
    "    procAttempts += 1;",
    "    const error = new Error('injected unavailable proc descriptor namespace');",
    "    error.code = 'ENOENT';",
    "    throw error;",
    "  }",
    "  if (path.includes('/dev/fd/')) devAttempts += 1;",
    "  return originalStat(target, ...args);",
    "};",
    "syncBuiltinESMExports();",
    "const { recoverFounderNonceLock } = await import(process.env.TEST_RECOVERY_MODULE);",
    "try {",
    "  const result = await recoverFounderNonceLock({ ledgerPath: process.env.TEST_LEDGER, confirmOwnerStopped: true, confirmSameHost: true });",
    "  console.log(JSON.stringify({ status: result.status, procAttempts, devAttempts }));",
    "} catch (error) {",
    "  console.log(JSON.stringify({ status: 'blocked', code: error?.code || String(error), procAttempts, devAttempts }));",
    "  process.exitCode = 1;",
    "}"
  ].join("\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      TEST_LEDGER: value.ledgerPath,
      TEST_RECOVERY_MODULE: recoveryModule
    }
  });

  assert.equal(child.status, 0, child.stderr);
  const observed = JSON.parse(child.stdout);
  assert.equal(observed.status, 'recovered');
  assert.ok(observed.procAttempts >= 1, 'the primary /proc descriptor path must be attempted');
  assert.ok(observed.devAttempts >= 1, 'the /dev descriptor fallback must be attempted');
  assert.equal(await exists(value.lockPath), false);
  assert.equal(await exists(value.recoveryLeasePath), false);
  assert.deepEqual(await readFile(value.ledgerPath), ledgerBefore,
    'fallback recovery must preserve the exact nonce-ledger bytes');
});


test('offline recovery fails closed before acquiring a lease when both descriptor namespaces are unavailable', async t => {
  const value = await fixture(t);
  const ledgerBefore = await readFile(value.ledgerPath);
  const recoveryModule = new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url).href;
  const childSource = [
    "import fsPromises from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalStat = fsPromises.stat;",
    "let procAttempts = 0;",
    "let devAttempts = 0;",
    "fsPromises.stat = async (target, ...args) => {",
    "  const path = String(target);",
    "  if (path.includes('/proc/self/fd/')) procAttempts += 1;",
    "  else if (path.includes('/dev/fd/')) devAttempts += 1;",
    "  else return originalStat(target, ...args);",
    "  const error = new Error('injected unavailable descriptor namespace');",
    "  error.code = 'ENOENT';",
    "  throw error;",
    "};",
    "syncBuiltinESMExports();",
    "const { recoverFounderNonceLock } = await import(process.env.TEST_RECOVERY_MODULE);",
    "try {",
    "  await recoverFounderNonceLock({ ledgerPath: process.env.TEST_LEDGER, confirmOwnerStopped: true, confirmSameHost: true });",
    "  console.log(JSON.stringify({ status: 'unexpected-recovered', procAttempts, devAttempts }));",
    "  process.exitCode = 1;",
    "} catch (error) {",
    "  console.log(JSON.stringify({ status: 'blocked', code: error?.code || String(error), procAttempts, devAttempts }));",
    "}"
  ].join("\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      TEST_LEDGER: value.ledgerPath,
      TEST_RECOVERY_MODULE: recoveryModule
    }
  });

  assert.equal(child.status, 0, child.stderr);
  const observed = JSON.parse(child.stdout);
  assert.equal(observed.status, 'blocked');
  assert.equal(observed.code, 'FOUNDER_NONCE_RECOVERY_DIRECTORY_HANDLE_UNAVAILABLE');
  assert.ok(observed.procAttempts >= 1, 'the primary /proc descriptor path must be attempted');
  assert.ok(observed.devAttempts >= 1, 'the /dev descriptor fallback must be attempted');
  assert.equal(await exists(value.lockPath), true,
    'failure to pin the directory must not remove the existing owner lock');
  assert.equal(await exists(value.recoveryLeasePath), false,
    'failure to pin the directory must occur before a recovery lease is created');
  assert.deepEqual(await readFile(value.ledgerPath), ledgerBefore,
    'failure to pin the directory must preserve exact nonce-ledger bytes');
});


test('recovery CLI reports descriptor-handle refusal without touching recovery state', async t => {
  const value = await fixture(t);
  const ledgerBefore = await readFile(value.ledgerPath);
  const recoveryScript = fileURLToPath(new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url));
  const recoveryModule = new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url).href;
  const childSource = [
    "import fsPromises from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalStat = fsPromises.stat;",
    "fsPromises.stat = async (target, ...args) => {",
    "  const path = String(target);",
    "  if (path.includes('/proc/self/fd/') || path.includes('/dev/fd/')) {",
    "    const error = new Error('injected unavailable descriptor namespace');",
    "    error.code = 'ENOENT';",
    "    throw error;",
    "  }",
    "  return originalStat(target, ...args);",
    "};",
    "syncBuiltinESMExports();",
    "process.argv = [process.execPath, process.env.TEST_RECOVERY_SCRIPT, '--recover', '--confirm-owner-stopped', '--confirm-same-host'];",
    "await import(process.env.TEST_RECOVERY_MODULE);"
  ].join("\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      NGL_FOUNDER_NONCE_LEDGER_PATH: value.ledgerPath,
      TEST_RECOVERY_SCRIPT: recoveryScript,
      TEST_RECOVERY_MODULE: recoveryModule
    }
  });

  assert.equal(child.status, 1, child.stderr);
  const observed = JSON.parse(child.stderr);
  assert.equal(observed.status, 'error');
  assert.equal(observed.code, 'FOUNDER_NONCE_RECOVERY_DIRECTORY_HANDLE_UNAVAILABLE');
  assert.equal(observed.safeToRemove, false);
  assert.equal(observed.authorityGranted, false);
  assert.equal(await exists(value.lockPath), true,
    'the CLI must preserve the existing owner lock when directory pinning is unavailable');
  assert.equal(await exists(value.recoveryLeasePath), false,
    'the CLI must fail before creating a recovery lease');
  assert.deepEqual(await readFile(value.ledgerPath), ledgerBefore,
    'the CLI must preserve exact nonce-ledger bytes');
});

test('recovery CLI reports the completed owner-lock removal when recovery-lease directory sync is uncertain', async t => {
  const value = await fixture(t);
  const ledgerBefore = await readFile(value.ledgerPath);
  const recoveryScript = fileURLToPath(new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url));
  const recoveryModule = new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url).href;
  const childSource = [
    "import fsPromises from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalOpen = fsPromises.open;",
    "let directorySyncs = 0;",
    "fsPromises.open = async (target, ...args) => {",
    "  const handle = await originalOpen(target, ...args);",
    "  if (String(target) === process.env.TEST_DIRECTORY) {",
    "    const originalSync = handle.sync.bind(handle);",
    "    handle.sync = async (...syncArgs) => {",
    "      directorySyncs += 1;",
    "      if (directorySyncs === 4) {",
    "        const error = new Error('injected recovery-lease directory sync failure');",
    "        error.code = 'EIO';",
    "        throw error;",
    "      }",
    "      return originalSync(...syncArgs);",
    "    };",
    "  }",
    "  return handle;",
    "};",
    "syncBuiltinESMExports();",
    "process.argv = [process.execPath, process.env.TEST_RECOVERY_SCRIPT, '--recover', '--confirm-owner-stopped', '--confirm-same-host'];",
    "await import(process.env.TEST_RECOVERY_MODULE);"
  ].join("\\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      NGL_FOUNDER_NONCE_LEDGER_PATH: value.ledgerPath,
      TEST_DIRECTORY: value.directory,
      TEST_RECOVERY_SCRIPT: recoveryScript,
      TEST_RECOVERY_MODULE: recoveryModule
    }
  });

  assert.equal(child.status, 1, child.stderr);
  const observed = JSON.parse(child.stderr);
  assert.equal(observed.status, 'durability-uncertain');
  assert.equal(observed.code, 'FOUNDER_NONCE_RECOVERY_LEASE_RELEASE_DURABILITY_UNCERTAIN');
  assert.deepEqual(observed.recoveryState, {
    ownerLockRemoved: true,
    ledgerModified: false,
    recoveryLeaseRemovalDurabilityUncertain: true
  });
  assert.equal(await exists(value.lockPath), false, 'the owner lock was already removed before lease-release sync failed');
  assert.equal(await exists(value.recoveryLeasePath), false, 'the lease unlink occurred, but its directory entry durability is uncertain');
  assert.deepEqual(await readFile(value.ledgerPath), ledgerBefore, 'the exact nonce ledger bytes must remain unchanged');
});
