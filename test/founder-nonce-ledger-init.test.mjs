import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, symlinkSync, writeFileSync
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('../scripts/init-founder-nonce-ledger.mjs', import.meta.url));
const LEDGER = '{"nonces":[],"schema":"ngl.founder-nonce-ledger.v1"}';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ngl-nonce-ledger-init-'));
  chmodSync(directory, 0o700);
  return { directory, ledgerPath: join(directory, 'founder-nonces.json') };
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
    "const originalOpen = fs.openSync;",
    "let swapped = false;",
    "fs.openSync = (target, ...args) => {",
    "  if (!swapped && String(target) === process.env.TEST_DIRECTORY) {",
    "    fs.renameSync(process.env.TEST_DIRECTORY, process.env.TEST_MOVED_DIRECTORY);",
    "    if (process.env.TEST_SWAP_KIND === 'symlink') {",
    "      fs.symlinkSync(process.env.TEST_REPLACEMENT_DIRECTORY, process.env.TEST_DIRECTORY, 'dir');",
    "    } else {",
    "      fs.renameSync(process.env.TEST_REPLACEMENT_DIRECTORY, process.env.TEST_DIRECTORY);",
    "    }",
    "    swapped = true;",
    "  }",
    "  return originalOpen(target, ...args);",
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
