import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, symlinkSync, writeFileSync
} from 'node:fs';
import { randomUUID, generateKeyPairSync, createHash, sign } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { authorizationEvent, decisionDigest, makeDecisionPayload, newNonce } from '../src/authority/decision.js';

const scriptPath = fileURLToPath(new URL('../scripts/init-founder-nonce-ledger.mjs', import.meta.url));
const LEDGER = '{"nonces":[],"schema":"ngl.founder-nonce-ledger.v1"}';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ngl-nonce-ledger-init-'));
  chmodSync(directory, 0o700);
  return { directory, ledgerPath: join(directory, 'founder-nonces.json') };
}


function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function withEnvironment(values, callback) {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
  try { return callback(); }
  finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function cleanup(value) {
  rmSync(value.directory, { recursive: true, force: true });
}

function run(ledgerPath, args = []) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NGL_FOUNDER_NONCE_LEDGER_PATH: ledgerPath }
  });
}


function runWithLedgerSyncFailure(value) {
  const markerPath = join(value.directory, 'ledger-fsync-failed.marker');
  const childSource = [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalFsyncSync = fs.fsyncSync;",
    "let fileSyncs = 0;",
    "fs.fsyncSync = descriptor => {",
    "  if (fs.fstatSync(descriptor).isFile()) {",
    "    fileSyncs += 1;",
    "    if (fileSyncs === 2) {",
    "      fs.writeFileSync(process.env.TEST_MARKER_PATH, 'ledger-file-fsync', { mode: 0o600 });",
    "      const error = new Error('injected EIO'); error.code = 'EIO'; throw error;",
    "    }",
    "  }",
    "  return originalFsyncSync(descriptor);",
    "};",
    "syncBuiltinESMExports();",
    "process.argv = [process.execPath, process.env.TEST_INIT_SCRIPT, '--confirm-no-prior-history'];",
    "await import(process.env.TEST_INIT_MODULE);",
    "console.log(JSON.stringify({ fileSyncs }));"
  ].join("\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      NGL_FOUNDER_NONCE_LEDGER_PATH: value.ledgerPath,
      TEST_MARKER_PATH: markerPath,
      TEST_INIT_SCRIPT: scriptPath,
      TEST_INIT_MODULE: new URL('../scripts/init-founder-nonce-ledger.mjs', import.meta.url).href
    }
  });
  return { child, markerPath };
}

function runAsync(ledgerPath) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [scriptPath, '--confirm-no-prior-history'], {
      env: { ...process.env, NGL_FOUNDER_NONCE_LEDGER_PATH: ledgerPath },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

test('help is non-mutating and explains the human acknowledgement boundary', () => {
  const value = fixture();
  try {
    const env = { ...process.env };
    delete env.NGL_FOUNDER_NONCE_LEDGER_PATH;
    const result = spawnSync(process.execPath, [scriptPath, '--help'], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--confirm-no-prior-history/);
    assert.match(result.stdout, /enrolls a Founder key/);
    assert.equal(existsSync(value.ledgerPath), false);
    assert.equal(existsSync(join(value.directory, '.founder-nonce.lock')), false);
  } finally { cleanup(value); }
});

test('missing no-prior-history acknowledgement fails before creating any state', () => {
  const value = fixture();
  try {
    const result = run(value.ledgerPath);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FOUNDER_NONCE_LEDGER_INIT_CONFIRMATION_REQUIRED/);
    assert.equal(existsSync(value.ledgerPath), false);
    assert.equal(existsSync(join(value.directory, '.founder-nonce.lock')), false);
  } finally { cleanup(value); }
});

test('unknown arguments fail without creating state', () => {
  const value = fixture();
  try {
    const result = run(value.ledgerPath, ['--confirm-no-prior-history', '--overwrite']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FOUNDER_NONCE_LEDGER_INIT_ARGUMENTS_INVALID/);
    assert.equal(existsSync(value.ledgerPath), false);
    assert.equal(existsSync(join(value.directory, '.founder-nonce.lock')), false);
  } finally { cleanup(value); }
});

test('explicit provisioning creates the canonical private empty ledger and releases its writer lock', () => {
  const value = fixture();
  try {
    const result = run(value.ledgerPath, ['--confirm-no-prior-history']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /FOUNDER_NONCE_LEDGER_INITIALIZED/);
    assert.equal(readFileSync(value.ledgerPath, 'utf8'), LEDGER);
    const stat = lstatSync(value.ledgerPath);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.mode & 0o777, 0o600);
    if (typeof process.getuid === 'function') assert.equal(stat.uid, process.getuid());
    assert.equal(existsSync(join(value.directory, '.founder-nonce.lock')), false);
  } finally { cleanup(value); }
});


test('explicitly initialized ledger is accepted by the authority writer and rejects replay', () => {
  const value = fixture();
  try {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const publicKeyJwk = publicKey.export({ format: 'jwk' });
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({
        kty: publicKeyJwk.kty,
        crv: publicKeyJwk.crv,
        x: publicKeyJwk.x,
        y: publicKeyJwk.y
      }))
      .digest('hex');
    const trustPath = join(value.directory, 'founder.pub.json');
    writeFileSync(trustPath, JSON.stringify({
      schema: 'ngl.founder-trust-anchor.v1',
      status: 'ENROLLED',
      enrolled: true,
      mode: 'PRODUCTION',
      public_key_jwk: publicKeyJwk,
      fingerprint
    }), { mode: 0o600 });

    const initialized = run(value.ledgerPath, ['--confirm-no-prior-history']);
    assert.equal(initialized.status, 0, initialized.stderr);
    assert.match(initialized.stdout, /FOUNDER_NONCE_LEDGER_INITIALIZED/);

    const payload = makeDecisionPayload({
      proposal: { event_id: 'initializer-writer-compatibility', type: 'PROPOSAL', quest_id: 'nonce-compatibility' },
      quest: { quest_id: 'nonce-compatibility' },
      capabilities: ['read'],
      outputs: ['compatibility-test'],
      acceptance: ['nonce-committed'],
      expires_at: new Date(Date.now() + 60_000).toISOString()
    });
    const nonce = newNonce();
    const signed = {
      payload_sha256: decisionDigest(payload),
      key_fingerprint: fingerprint,
      signature: sign('sha256', Buffer.from(canonical(payload)), privateKey).toString('base64url'),
      nonce
    };

    withEnvironment({
      NGL_FOUNDER_TRUST_ANCHOR_PATH: trustPath,
      NGL_FOUNDER_NONCE_LEDGER_PATH: value.ledgerPath
    }, () => {
      const event = authorizationEvent({ signed, payload });
      assert.equal(event.type, 'QUEST_AUTHORIZED');
      assert.equal(event.proposal_id, 'initializer-writer-compatibility');

      const committedBytes = readFileSync(value.ledgerPath, 'utf8');
      assert.deepEqual(JSON.parse(committedBytes).nonces, [nonce]);
      assert.throws(
        () => authorizationEvent({ signed, payload }),
        /FOUNDER_DECISION_INVALID:NONCE_REPLAY/
      );
      assert.equal(readFileSync(value.ledgerPath, 'utf8'), committedBytes);
      assert.equal(existsSync(join(value.directory, '.founder-nonce.lock')), false);
    });
  } finally { cleanup(value); }
});


test('ledger fsync uncertainty retains the owner lock and never reports initialization success', () => {
  const value = fixture();
  const failed = runWithLedgerSyncFailure(value);
  try {
    assert.equal(failed.child.status, 1, failed.child.stdout + failed.child.stderr);
    assert.match(failed.child.stderr, /FOUNDER_NONCE_LEDGER_INIT_DURABILITY_UNCERTAIN/);
    assert.equal(existsSync(failed.markerPath), true);
    assert.equal(JSON.parse(failed.child.stdout.trim()).fileSyncs, 2);
    assert.equal(failed.child.stdout.includes('FOUNDER_NONCE_LEDGER_INITIALIZED'), false);

    assert.equal(existsSync(value.ledgerPath), true);
    assert.equal(readFileSync(value.ledgerPath, 'utf8'), LEDGER);
    const lockPath = join(value.directory, '.founder-nonce.lock');
    assert.equal(existsSync(lockPath), true);
    const lock = lstatSync(lockPath);
    assert.equal(lock.mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(lockPath, 'utf8')).schema, 'ngl.ledger-lock.v1');
  } finally { cleanup(value); }
});

test('existing ledger bytes are never overwritten', () => {
  const value = fixture();
  const prior = '{"nonces":["0123456789abcdef0123456789abcdef"],"schema":"ngl.founder-nonce-ledger.v1"}';
  try {
    writeFileSync(value.ledgerPath, prior, { mode: 0o600 });
    const result = run(value.ledgerPath, ['--confirm-no-prior-history']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FOUNDER_NONCE_LEDGER_ALREADY_EXISTS/);
    assert.equal(readFileSync(value.ledgerPath, 'utf8'), prior);
    assert.equal(existsSync(join(value.directory, '.founder-nonce.lock')), false);
  } finally { cleanup(value); }
});

test('an existing writer lock blocks initialization without changing the lock', () => {
  const value = fixture();
  const lockPath = join(value.directory, '.founder-nonce.lock');
  const lockBytes = '{"openedAt":"2026-11-04T00:00:00.000Z","pid":123,"schema":"ngl.ledger-lock.v1"}';
  try {
    writeFileSync(lockPath, lockBytes, { mode: 0o600 });
    const result = run(value.ledgerPath, ['--confirm-no-prior-history']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FOUNDER_NONCE_LEDGER_LOCKED/);
    assert.equal(readFileSync(lockPath, 'utf8'), lockBytes);
    assert.equal(existsSync(value.ledgerPath), false);
  } finally { cleanup(value); }
});

test('a recovery lease blocks initialization before a writer lock is created', () => {
  const value = fixture();
  const leasePath = join(value.directory, '.founder-nonce-recovery.lock');
  try {
    writeFileSync(leasePath, 'operator-owned recovery lease', { mode: 0o600 });
    const result = run(value.ledgerPath, ['--confirm-no-prior-history']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FOUNDER_NONCE_RECOVERY_IN_PROGRESS/);
    assert.equal(existsSync(value.ledgerPath), false);
    assert.equal(existsSync(join(value.directory, '.founder-nonce.lock')), false);
    assert.equal(existsSync(leasePath), true);
  } finally { cleanup(value); }
});

test('an orphaned temporary nonce file requires manual inspection', () => {
  const value = fixture();
  const temporaryPath = join(value.directory, '.founder-nonce-' + randomUUID() + '.tmp');
  try {
    writeFileSync(temporaryPath, 'uncommitted nonce bytes', { mode: 0o600 });
    const result = run(value.ledgerPath, ['--confirm-no-prior-history']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FOUNDER_NONCE_LEDGER_INIT_TEMPORARY_FILES_PRESENT/);
    assert.equal(existsSync(value.ledgerPath), false);
    assert.equal(existsSync(temporaryPath), true);
    assert.equal(existsSync(join(value.directory, '.founder-nonce.lock')), false);
  } finally { cleanup(value); }
});

test('symlinked parent directories are rejected without writing through the link', () => {
  const value = fixture();
  const target = join(value.directory, 'target');
  const alias = join(value.directory, 'alias');
  mkdirSync(target, { mode: 0o700 });
  chmodSync(target, 0o700);
  symlinkSync(target, alias, 'dir');
  try {
    const result = run(join(alias, 'founder-nonces.json'), ['--confirm-no-prior-history']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FOUNDER_NONCE_LEDGER_INIT_UNSAFE_DIRECTORY/);
    assert.equal(existsSync(join(target, 'founder-nonces.json')), false);
  } finally { cleanup(value); }
});

test('symlinked ledger targets are never followed or overwritten', () => {
  const value = fixture();
  const outside = join(value.directory, 'outside.json');
  const alias = join(value.directory, 'founder-nonces.json');
  try {
    writeFileSync(outside, 'untouched', { mode: 0o600 });
    symlinkSync(outside, alias);
    const result = run(alias, ['--confirm-no-prior-history']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FOUNDER_NONCE_LEDGER_ALREADY_EXISTS/);
    assert.equal(readFileSync(outside, 'utf8'), 'untouched');
    assert.equal(lstatSync(alias).isSymbolicLink(), true);
  } finally { cleanup(value); }
});

test('non-private parent directories are rejected', () => {
  const value = fixture();
  try {
    chmodSync(value.directory, 0o750);
    const result = run(value.ledgerPath, ['--confirm-no-prior-history']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FOUNDER_NONCE_LEDGER_INIT_UNSAFE_DIRECTORY/);
    assert.equal(existsSync(value.ledgerPath), false);
  } finally { cleanup(value); }
});

test('concurrent initializers produce one ledger and never overwrite it', async () => {
  const value = fixture();
  try {
    const results = await Promise.all([runAsync(value.ledgerPath), runAsync(value.ledgerPath)]);
    assert.equal(results.filter(result => result.status === 0).length, 1);
    assert.equal(results.filter(result => result.status === 1).length, 1);
    assert.ok(results.some(result =>
      /FOUNDER_NONCE_LEDGER_LOCKED|FOUNDER_NONCE_LEDGER_ALREADY_EXISTS/.test(result.stderr)));
    assert.equal(readFileSync(value.ledgerPath, 'utf8'), LEDGER);
    assert.equal(existsSync(join(value.directory, '.founder-nonce.lock')), false);
  } finally { cleanup(value); }
});


function runWithDirectorySwap(value, swapKind) {
  const movedDirectory = value.directory + '-original';
  const replacementDirectory = value.directory + '-replacement';
  mkdirSync(replacementDirectory, { mode: 0o700 });
  chmodSync(replacementDirectory, 0o700);
  const childSource = [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalFsyncSync = fs.fsyncSync;",
    "let swapped = false;",
    "fs.fsyncSync = descriptor => {",
    "  if (!swapped && fs.fstatSync(descriptor).isDirectory()) {",
    "    fs.renameSync(process.env.TEST_DIRECTORY, process.env.TEST_MOVED_DIRECTORY);",
    "    if (process.env.TEST_SWAP_KIND === 'symlink') {",
    "      fs.symlinkSync(process.env.TEST_REPLACEMENT_DIRECTORY, process.env.TEST_DIRECTORY, 'dir');",
    "    } else {",
    "      fs.renameSync(process.env.TEST_REPLACEMENT_DIRECTORY, process.env.TEST_DIRECTORY);",
    "    }",
    "    swapped = true;",
    "  }",
    "  return originalFsyncSync(descriptor);",
    "};",
    "syncBuiltinESMExports();",
    "process.argv = [process.execPath, process.env.TEST_INIT_SCRIPT, '--confirm-no-prior-history'];",
    "await import(process.env.TEST_INIT_MODULE);",
    "console.log(JSON.stringify({ swapped }));"
  ].join("\n");
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      NGL_FOUNDER_NONCE_LEDGER_PATH: value.ledgerPath,
      TEST_DIRECTORY: value.directory,
      TEST_MOVED_DIRECTORY: movedDirectory,
      TEST_REPLACEMENT_DIRECTORY: replacementDirectory,
      TEST_SWAP_KIND: swapKind,
      TEST_INIT_SCRIPT: scriptPath,
      TEST_INIT_MODULE: new URL('../scripts/init-founder-nonce-ledger.mjs', import.meta.url).href
    }
  });
  return { child, movedDirectory, replacementDirectory };
}

test('directory replacement during durability sync is rejected before writing the ledger', () => {
  const value = fixture();
  const swapped = runWithDirectorySwap(value, 'replacement');
  try {
    assert.equal(swapped.child.status, 1, swapped.child.stdout);
    assert.match(swapped.child.stderr, /FOUNDER_NONCE_LEDGER_INIT_DIRECTORY_CHANGED/);
    assert.match(swapped.child.stdout, /"swapped":true/);
    assert.equal(existsSync(value.ledgerPath), false, 'the replacement directory must not receive a ledger');
    assert.equal(existsSync(join(swapped.movedDirectory, '.founder-nonce.lock')), true,
      'the original owner lock must remain with the original directory');
    assert.equal(existsSync(join(value.directory, '.founder-nonce.lock')), false);
  } finally {
    rmSync(swapped.movedDirectory, { recursive: true, force: true });
    rmSync(swapped.replacementDirectory, { recursive: true, force: true });
    cleanup(value);
  }
});

test('directory symlink replacement during durability sync is rejected before writing the ledger', () => {
  const value = fixture();
  const swapped = runWithDirectorySwap(value, 'symlink');
  try {
    assert.equal(swapped.child.status, 1, swapped.child.stdout);
    assert.match(swapped.child.stderr, /FOUNDER_NONCE_LEDGER_INIT_DIRECTORY_CHANGED/);
    assert.match(swapped.child.stdout, /"swapped":true/);
    assert.equal(lstatSync(value.directory).isSymbolicLink(), true);
    assert.equal(existsSync(join(swapped.replacementDirectory, 'founder-nonces.json')), false,
      'the symlink target must not receive a ledger');
    assert.equal(existsSync(join(swapped.movedDirectory, '.founder-nonce.lock')), true,
      'the original owner lock must remain with the original directory');
  } finally {
    rmSync(swapped.movedDirectory, { recursive: true, force: true });
    rmSync(swapped.replacementDirectory, { recursive: true, force: true });
    cleanup(value);
  }
});


function runWithDirectorySyncFailure(value, failAt) {
  const markerPath = join(value.directory, 'directory-fsync-' + failAt + '.marker');
  const childSource = [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalFsyncSync = fs.fsyncSync;",
    "let directorySyncs = 0;",
    "fs.fsyncSync = descriptor => {",
    "  if (fs.fstatSync(descriptor).isDirectory()) {",
    "    directorySyncs += 1;",
    "    if (directorySyncs === Number(process.env.TEST_FAIL_DIRECTORY_SYNC)) {",
    "      fs.writeFileSync(process.env.TEST_MARKER_PATH, String(directorySyncs), { mode: 0o600 });",
    "      const error = new Error('injected EIO'); error.code = 'EIO'; throw error;",
    "    }",
    "  }",
    "  return originalFsyncSync(descriptor);",
    "};",
    "syncBuiltinESMExports();",
    "process.argv = [process.execPath, process.env.TEST_INIT_SCRIPT, '--confirm-no-prior-history'];",
    "await import(process.env.TEST_INIT_MODULE);",
    "console.log(JSON.stringify({ directorySyncs }));"
  ].join('\n');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      NGL_FOUNDER_NONCE_LEDGER_PATH: value.ledgerPath,
      TEST_MARKER_PATH: markerPath,
      TEST_FAIL_DIRECTORY_SYNC: String(failAt),
      TEST_INIT_SCRIPT: scriptPath,
      TEST_INIT_MODULE: new URL('../scripts/init-founder-nonce-ledger.mjs', import.meta.url).href
    }
  });
  return { child, markerPath };
}

test('owner-lock directory fsync uncertainty retains the lock before ledger creation', () => {
  const value = fixture();
  const failed = runWithDirectorySyncFailure(value, 1);
  try {
    assert.equal(failed.child.status, 1, failed.child.stdout + failed.child.stderr);
    assert.match(failed.child.stderr, /FOUNDER_NONCE_LEDGER_INIT_DURABILITY_UNCERTAIN_LOCK_DIRECTORY/);
    assert.equal(existsSync(failed.markerPath), true);
    assert.equal(JSON.parse(failed.child.stdout.trim()).directorySyncs, 1);
    assert.equal(failed.child.stdout.includes('FOUNDER_NONCE_LEDGER_INITIALIZED'), false);
    assert.equal(existsSync(value.ledgerPath), false);
    const lockPath = join(value.directory, '.founder-nonce.lock');
    assert.equal(existsSync(lockPath), true);
    assert.equal(lstatSync(lockPath).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(lockPath, 'utf8')).schema, 'ngl.ledger-lock.v1');
  } finally { cleanup(value); }
});

test('ledger-entry directory fsync uncertainty retains the ledger and owner lock', () => {
  const value = fixture();
  const failed = runWithDirectorySyncFailure(value, 2);
  try {
    assert.equal(failed.child.status, 1, failed.child.stdout + failed.child.stderr);
    assert.match(failed.child.stderr, /FOUNDER_NONCE_LEDGER_INIT_DURABILITY_UNCERTAIN_LEDGER_DIRECTORY/);
    assert.equal(existsSync(failed.markerPath), true);
    assert.equal(JSON.parse(failed.child.stdout.trim()).directorySyncs, 2);
    assert.equal(failed.child.stdout.includes('FOUNDER_NONCE_LEDGER_INITIALIZED'), false);
    assert.equal(readFileSync(value.ledgerPath, 'utf8'), LEDGER);
    const lockPath = join(value.directory, '.founder-nonce.lock');
    assert.equal(existsSync(lockPath), true);
    assert.equal(lstatSync(lockPath).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(lockPath, 'utf8')).schema, 'ngl.ledger-lock.v1');
  } finally { cleanup(value); }
});


test('owner-lock release directory fsync uncertainty is explicit and cannot trigger a second initialization', () => {
  const value = fixture();
  const failed = runWithDirectorySyncFailure(value, 3);
  try {
    assert.equal(failed.child.status, 1, failed.child.stdout + failed.child.stderr);
    const diagnostic = JSON.parse(failed.child.stderr);
    assert.equal(diagnostic.code, 'FOUNDER_NONCE_LEDGER_INIT_LOCK_RELEASE_UNCERTAIN');
    assert.deepEqual(diagnostic.initializationState, {
      ledgerCreated: true,
      ledgerContentsVerified: true,
      ledgerModifiedAfterCreation: false,
      ownerLockRemovalDurabilityUncertain: true
    });
    assert.equal(existsSync(failed.markerPath), true);
    assert.equal(JSON.parse(failed.child.stdout.trim()).directorySyncs, 3);
    assert.equal(failed.child.stdout.includes('FOUNDER_NONCE_LEDGER_INITIALIZED'), false);
    assert.equal(readFileSync(value.ledgerPath, 'utf8'), LEDGER);
    assert.equal(existsSync(join(value.directory, '.founder-nonce.lock')), false);

    const retry = run(value.ledgerPath, ['--confirm-no-prior-history']);
    assert.equal(retry.status, 1);
    assert.match(retry.stderr, /FOUNDER_NONCE_LEDGER_ALREADY_EXISTS/);
    assert.equal(readFileSync(value.ledgerPath, 'utf8'), LEDGER);
  } finally { cleanup(value); }
});


function runWithLedgerOpenSwap(value) {
  const movedDirectory = value.directory + '-original';
  const replacementDirectory = value.directory + '-replacement';
  mkdirSync(replacementDirectory, { mode: 0o700 });
  chmodSync(replacementDirectory, 0o700);
  const childSource = [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalOpen = fs.openSync;",
    "let swapped = false;",
    "fs.openSync = (target, ...args) => {",
    "  if (!swapped && String(target).endsWith('/founder-nonces.json')) {",
    "    fs.renameSync(process.env.TEST_DIRECTORY, process.env.TEST_MOVED_DIRECTORY);",
    "    fs.renameSync(process.env.TEST_REPLACEMENT_DIRECTORY, process.env.TEST_DIRECTORY);",
    "    swapped = true;",
    "  }",
    "  return originalOpen(target, ...args);",
    "};",
    "syncBuiltinESMExports();",
    "process.argv = [process.execPath, process.env.TEST_INIT_SCRIPT, '--confirm-no-prior-history'];",
    "await import(process.env.TEST_INIT_MODULE);",
    "console.log(JSON.stringify({ swapped }));"
  ].join('\n');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      NGL_FOUNDER_NONCE_LEDGER_PATH: value.ledgerPath,
      TEST_DIRECTORY: value.directory,
      TEST_MOVED_DIRECTORY: movedDirectory,
      TEST_REPLACEMENT_DIRECTORY: replacementDirectory,
      TEST_INIT_SCRIPT: scriptPath,
      TEST_INIT_MODULE: new URL('../scripts/init-founder-nonce-ledger.mjs', import.meta.url).href
    }
  });
  return { child, movedDirectory, replacementDirectory };
}

test('directory replacement at ledger open cannot publish a ledger into the replacement directory', () => {
  const value = fixture();
  const swapped = runWithLedgerOpenSwap(value);
  try {
    assert.equal(swapped.child.status, 1, swapped.child.stdout + swapped.child.stderr);
    assert.match(swapped.child.stderr, /FOUNDER_NONCE_LEDGER_INIT_DIRECTORY_CHANGED/);
    assert.match(swapped.child.stdout, /"swapped":true/);
    assert.equal(existsSync(join(value.directory, 'founder-nonces.json')), false,
      'the replacement directory at the configured path must never receive a ledger');
    const movedLedger = join(swapped.movedDirectory, 'founder-nonces.json');
    assert.equal(existsSync(movedLedger), true,
      'the opened directory may retain an incomplete artifact for manual inspection');
    assert.equal(lstatSync(movedLedger).size, 0,
      'the initializer must detect the path swap before writing ledger bytes');
    assert.equal(lstatSync(movedLedger).mode & 0o777, 0o600);
    const movedLock = join(swapped.movedDirectory, '.founder-nonce.lock');
    assert.equal(existsSync(movedLock), true, 'the original owner lock must remain for inspection');
    assert.equal(lstatSync(movedLock).mode & 0o777, 0o600);
    assert.equal(swapped.child.stdout.includes('FOUNDER_NONCE_LEDGER_INITIALIZED'), false);
  } finally {
    rmSync(swapped.movedDirectory, { recursive: true, force: true });
    rmSync(swapped.replacementDirectory, { recursive: true, force: true });
    cleanup(value);
  }
});


function runWithDescriptorNamespace(value, blockedRoots) {
  const childSource = [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalStat = fs.statSync;",
    "const blockedRoots = JSON.parse(process.env.TEST_BLOCKED_DESCRIPTOR_ROOTS);",
    "fs.statSync = (target, ...args) => {",
    "  if (blockedRoots.some(root => String(target).startsWith(root + '/'))) {",
    "    const error = new Error('injected descriptor namespace unavailable'); error.code = 'ENOENT'; throw error;",
    "  }",
    "  return originalStat(target, ...args);",
    "};",
    "syncBuiltinESMExports();",
    "process.argv = [process.execPath, process.env.TEST_INIT_SCRIPT, '--confirm-no-prior-history'];",
    "await import(process.env.TEST_INIT_MODULE);",
    "console.log('descriptor namespace child completed');"
  ].join('\n');
  return spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      NGL_FOUNDER_NONCE_LEDGER_PATH: value.ledgerPath,
      TEST_BLOCKED_DESCRIPTOR_ROOTS: JSON.stringify(blockedRoots),
      TEST_INIT_SCRIPT: scriptPath,
      TEST_INIT_MODULE: new URL('../scripts/init-founder-nonce-ledger.mjs', import.meta.url).href
    }
  });
}

test('descriptor-relative initialization falls back to /dev/fd when /proc/self/fd is unavailable', () => {
  const value = fixture();
  try {
    const result = runWithDescriptorNamespace(value, ['/proc/self/fd']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /FOUNDER_NONCE_LEDGER_INITIALIZED/);
    assert.equal(readFileSync(value.ledgerPath, 'utf8'), LEDGER);
    assert.equal(existsSync(join(value.directory, '.founder-nonce.lock')), false);
  } finally { cleanup(value); }
});

test('missing descriptor namespaces fail before creating a lock or ledger', () => {
  const value = fixture();
  try {
    const result = runWithDescriptorNamespace(value, ['/proc/self/fd', '/dev/fd']);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /FOUNDER_NONCE_LEDGER_INIT_DIRECTORY_HANDLE_UNAVAILABLE/);
    assert.equal(existsSync(value.ledgerPath), false);
    assert.equal(existsSync(join(value.directory, '.founder-nonce.lock')), false);
  } finally { cleanup(value); }
});
