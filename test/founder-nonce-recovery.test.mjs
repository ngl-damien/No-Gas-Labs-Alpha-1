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

test('a stale lock with no ledger can be recovered without creating or inventing nonce state', async t => {
  const value = await fixture(t, { withLedger: false });
  const inspection = await inspectFounderNonceRecovery(value.ledgerPath);
  assert.equal(inspection.status, 'ready');
  assert.equal(inspection.ledger.exists, false);
  const result = await recoverFounderNonceLock({
    ledgerPath: value.ledgerPath,
    confirmOwnerStopped: true,
    confirmSameHost: true
  });
  assert.equal(result.status, 'recovered');
  assert.equal(result.ledger.exists, false);
  assert.equal(result.ledgerModified, false);
  assert.equal(await exists(value.ledgerPath), false);
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
  assert.equal(result.reason, 'recovery-in-progress');
  assert.equal(result.safeToRemove, false);
  assert.equal(result.authorityGranted, false);
});

test('recovery CLI help loads without host configuration and documents the recovery lease', () => {
  const scriptPath = fileURLToPath(new URL('../scripts/recover-founder-nonce-lock.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath, '--help'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /founder-nonce-recovery\.lock/);
});
