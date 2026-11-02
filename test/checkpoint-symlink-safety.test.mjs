import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreflight } from '../scripts/validate-agent-governance.mjs';

const protocolPath = 'docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md';
const protocolText = [
  'Required loop on every run',
  'Shared work coordination rules',
  'Evidence and state rules',
  'Founder authority remains with Damien',
  'MMORPG completion gates and delivery priority'
].join('\n');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ngl-checkpoint-boundary-'));
  await mkdir(join(root, 'docs/operations'), { recursive: true });
  await mkdir(join(root, '.github'), { recursive: true });
  await writeFile(join(root, 'AGENTS.md'), [
    'STOP: Read this file before repository work.',
    'First repository operation: read root AGENTS.md alone.',
    'Second repository operation: read the complete shared protocol alone.',
    'Discard any pre-read observations and restart the baseline.',
    '[Shared protocol](docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md)',
    'Preflight command: npm run agent:preflight -- --path AGENTS.md --checkpoint docs/operations/LATEST_CHECKPOINT.md'
  ].join('\n'));
  await writeFile(join(root, protocolPath), protocolText);
  for (const path of ['CLAUDE.md', 'GEMINI.md', 'CODEX.md', '.github/copilot-instructions.md']) {
    await writeFile(join(root, path), 'Read AGENTS.md and RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md first.');
  }
  return root;
}

test('preflight refuses a durable checkpoint symlink that resolves outside the repository', async () => {
  const root = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'ngl-checkpoint-outside-'));
  const checkpoint = join(root, 'docs/operations/LATEST_CHECKPOINT.md');
  try {
    await writeFile(join(outside, 'LATEST_CHECKPOINT.md'), '# External checkpoint must not be trusted\n');
    await symlink(join(outside, 'LATEST_CHECKPOINT.md'), checkpoint, 'file');

    const result = await runPreflight({
      root,
      paths: ['AGENTS.md'],
      checkpoint: 'docs/operations/LATEST_CHECKPOINT.md'
    });

    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item =>
      item.path === 'docs/operations/LATEST_CHECKPOINT.md' &&
      item.reason.includes('durable checkpoint path must not traverse a symlink')
    ));
    assert.ok(!result.files.some(file => file.path === 'docs/operations/LATEST_CHECKPOINT.md'));
    assert.equal(await readFile(checkpoint, 'utf8'), '# External checkpoint must not be trusted\n');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});


test('preflight rejects an in-repository symlink used as the canonical checkpoint file', async () => {
  const root = await fixture();
  const checkpoint = join(root, 'docs/operations/LATEST_CHECKPOINT.md');
  try {
    await writeFile(join(root, 'docs/operations/previous-checkpoint.md'), '# Previous checkpoint must not be substituted\\n');
    await symlink('previous-checkpoint.md', checkpoint, 'file');

    const result = await runPreflight({
      root,
      paths: ['AGENTS.md'],
      checkpoint: 'docs/operations/LATEST_CHECKPOINT.md'
    });

    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item =>
      item.path === 'docs/operations/LATEST_CHECKPOINT.md' &&
      item.reason.includes('durable checkpoint path must not traverse a symlink')
    ));
    assert.ok(!result.files.some(file => file.path === 'docs/operations/LATEST_CHECKPOINT.md'));
    assert.equal(await readFile(join(root, 'docs/operations/previous-checkpoint.md'), 'utf8'), '# Previous checkpoint must not be substituted\\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preflight rejects an in-repository symlinked parent of the canonical checkpoint', async () => {
  const root = await fixture();
  try {
    await rename(join(root, 'docs/operations'), join(root, 'docs/operations-real'));
    await writeFile(join(root, 'docs/operations-real/LATEST_CHECKPOINT.md'), '# Canonical checkpoint bytes\\n');
    await symlink('operations-real', join(root, 'docs/operations'), 'dir');

    const result = await runPreflight({
      root,
      paths: ['AGENTS.md'],
      checkpoint: 'docs/operations/LATEST_CHECKPOINT.md'
    });

    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item =>
      item.path === 'docs/operations' &&
      item.reason.includes('durable checkpoint path must not traverse a symlink')
    ));
    assert.ok(!result.files.some(file => file.path === 'docs/operations/LATEST_CHECKPOINT.md'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('preflight never fingerprints a trusted checkpoint from a transient real-directory replacement', {
  skip: process.platform !== 'linux' ? 'descriptor-relative trusted reads require Linux procfs' : false
}, async () => {
  const root = await fixture();
  const checkpointPath = 'docs/operations/LATEST_CHECKPOINT.md';
  const originalBytes = Buffer.from('# Latest Durable Checkpoint\nOriginal checkpoint.\n');
  const decoyBytes = Buffer.from('# Latest Durable Checkpoint\nDecoy checkpoint.\n');
  try {
    await writeFile(join(root, checkpointPath), originalBytes);
    const decoyDirectory = join(root, 'docs/operations-decoy');
    await mkdir(decoyDirectory);
    await writeFile(join(decoyDirectory, 'LATEST_CHECKPOINT.md'), decoyBytes);

    const hookPath = join(root, 'preflight-real-directory-swap.cjs');
    await writeFile(hookPath, [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const { syncBuiltinESMExports } = require('node:module');",
      "const originalStat = fs.promises.stat;",
      "const originalLstat = fs.promises.lstat;",
      "const originalOpen = fs.promises.open;",
      "const root = process.env.NGL_PREFLIGHT_SWAP_ROOT;",
      "const checkpoint = path.join(root, 'docs', 'operations', 'LATEST_CHECKPOINT.md');",
      "const operations = path.join(root, 'docs', 'operations');",
      "const backup = path.join(root, 'docs', 'operations-original');",
      "const decoy = path.join(root, 'docs', 'operations-decoy');",
      "let swapped = false;",
      "let opened = false;",
      "let restored = false;",
      "function restore() {",
      "  if (!swapped || restored) return;",
      "  if (fs.existsSync(operations)) fs.renameSync(operations, decoy);",
      "  if (fs.existsSync(backup)) fs.renameSync(backup, operations);",
      "  restored = true;",
      "  fs.writeFileSync(path.join(root, 'real-directory-swap-restored'), 'yes');",
      "}",
      "process.on('exit', restore);",
      "fs.promises.stat = async function(candidate, ...args) {",
      "  if (!swapped && path.resolve(String(candidate)) === checkpoint) {",
      "    fs.renameSync(operations, backup);",
      "    fs.renameSync(decoy, operations);",
      "    swapped = true;",
      "    fs.writeFileSync(path.join(root, 'real-directory-swap-started'), 'yes');",
      "  }",
      "  return originalStat.call(this, candidate, ...args);",
      "};",
      "fs.promises.open = async function(candidate, ...args) {",
      "  const handle = await originalOpen.call(this, candidate, ...args);",
      "  if (swapped && path.basename(String(candidate)) === 'LATEST_CHECKPOINT.md') {",
      "    opened = true;",
      "    fs.writeFileSync(path.join(root, 'real-directory-swap-opened'), 'yes');",
      "  }",
      "  return handle;",
      "};",
      "fs.promises.lstat = async function(candidate, ...args) {",
      "  if (swapped && opened && !restored && path.resolve(String(candidate)) === operations) restore();",
      "  return originalLstat.call(this, candidate, ...args);",
      "};",
      "syncBuiltinESMExports();"
    ].join('\n'));

    const child = spawnSync(process.execPath, [
      '--require', hookPath,
      new URL('../scripts/validate-agent-governance.mjs', import.meta.url).pathname,
      '--root', root,
      '--path', 'AGENTS.md',
      '--checkpoint', checkpointPath
    ], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, NGL_PREFLIGHT_SWAP_ROOT: root }
    });

    assert.equal(child.error, undefined, child.error?.message || 'preflight subprocess failed');
    assert.ok(child.status === 0 || child.status === 1, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(await readFile(join(root, 'real-directory-swap-started'), 'utf8'), 'yes',
      'the transient real-directory replacement must be exercised');
    assert.equal(await readFile(join(root, 'real-directory-swap-opened'), 'utf8'), 'yes',
      'the checkpoint open must occur while the replacement directory is installed');

    const checkpointRecord = result.files.find(file => file.path === checkpointPath);
    const originalHash = createHash('sha256').update(originalBytes).digest('hex');
    const decoyHash = createHash('sha256').update(decoyBytes).digest('hex');
    assert.notEqual(checkpointRecord?.sha256, decoyHash,
      'decoy bytes must never be fingerprinted as the canonical checkpoint');
    if (result.status === 'ready') {
      assert.equal(checkpointRecord?.sha256, originalHash);
    } else {
      assert.ok(result.failures.some(item =>
        item.path === checkpointPath || item.path === 'docs' || item.path === 'docs/operations'
      ), JSON.stringify(result.failures));
    }
    assert.equal(await readFile(join(root, checkpointPath), 'utf8'), originalBytes.toString('utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('preflight blocks a transient final-file replacement after the trusted parent is pinned', {
  skip: process.platform !== 'linux' ? 'descriptor-relative trusted reads require Linux procfs' : false
}, async () => {
  const root = await fixture();
  const checkpointPath = 'docs/operations/LATEST_CHECKPOINT.md';
  const checkpoint = join(root, checkpointPath);
  const backup = join(root, 'docs/operations/LATEST_CHECKPOINT.original');
  const decoy = join(root, 'docs/operations/LATEST_CHECKPOINT.decoy');
  const originalBytes = Buffer.from('# Latest Durable Checkpoint\nOriginal checkpoint.\n');
  const decoyBytes = Buffer.from('# Latest Durable Checkpoint\nDecoy checkpoint.\n');
  try {
    await writeFile(checkpoint, originalBytes);
    await writeFile(decoy, decoyBytes);

    const hookPath = join(root, 'preflight-final-file-swap.cjs');
    await writeFile(hookPath, [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const { syncBuiltinESMExports } = require('node:module');",
      "const originalStat = fs.promises.stat;",
      "const originalOpen = fs.promises.open;",
      "const root = process.env.NGL_PREFLIGHT_SWAP_ROOT;",
      "const checkpoint = path.join(root, 'docs', 'operations', 'LATEST_CHECKPOINT.md');",
      "const backup = path.join(root, 'docs', 'operations', 'LATEST_CHECKPOINT.original');",
      "const decoy = path.join(root, 'docs', 'operations', 'LATEST_CHECKPOINT.decoy');",
      "let checkpointStats = 0;",
      "let swapped = false;",
      "let restored = false;",
      "function restore() {",
      "  if (!swapped || restored) return;",
      "  if (fs.existsSync(checkpoint)) fs.renameSync(checkpoint, decoy);",
      "  if (fs.existsSync(backup)) fs.renameSync(backup, checkpoint);",
      "  restored = true;",
      "  fs.writeFileSync(path.join(root, 'final-file-swap-restored'), 'yes');",
      "}",
      "process.on('exit', restore);",
      "fs.promises.stat = async function(candidate, ...args) {",
      "  if (path.resolve(String(candidate)) === checkpoint) {",
      "    checkpointStats += 1;",
      "    if (checkpointStats === 1 && !swapped) {",
      "      fs.renameSync(checkpoint, backup);",
      "      fs.renameSync(decoy, checkpoint);",
      "      swapped = true;",
      "      fs.writeFileSync(path.join(root, 'final-file-swap-started'), 'yes');",
      "    }",
      "    const metadata = await originalStat.call(this, candidate, ...args);",
      "    if (checkpointStats === 3 && swapped && !restored) restore();",
      "    return metadata;",
      "  }",
      "  return originalStat.call(this, candidate, ...args);",
      "};",
      "fs.promises.open = async function(candidate, ...args) {",
      "  const handle = await originalOpen.call(this, candidate, ...args);",
      "  if (swapped && path.basename(String(candidate)) === 'LATEST_CHECKPOINT.md') {",
      "    fs.writeFileSync(path.join(root, 'final-file-swap-opened'), 'yes');",
      "  }",
      "  return handle;",
      "};",
      "syncBuiltinESMExports();"
    ].join('\n'));

    const child = spawnSync(process.execPath, [
      '--require', hookPath,
      new URL('../scripts/validate-agent-governance.mjs', import.meta.url).pathname,
      '--root', root,
      '--path', 'AGENTS.md',
      '--checkpoint', checkpointPath
    ], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, NGL_PREFLIGHT_SWAP_ROOT: root }
    });

    assert.equal(child.error, undefined, child.error?.message || 'preflight subprocess failed');
    assert.ok(child.status === 0 || child.status === 1, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.status, 'blocked', JSON.stringify(result));
    assert.equal(child.status, 1, child.stderr);
    assert.equal(await readFile(join(root, 'final-file-swap-started'), 'utf8'), 'yes',
      'the final checkpoint replacement must occur after parent pinning');
    assert.equal(await readFile(join(root, 'final-file-swap-opened'), 'utf8'), 'yes',
      'the descriptor-relative final-file open must occur while the decoy is installed');
    assert.equal(await readFile(join(root, 'final-file-swap-restored'), 'utf8'), 'yes',
      'the original checkpoint must be restored before the child exits');
    const decoyHash = createHash('sha256').update(decoyBytes).digest('hex');
    assert.ok(!result.files.some(file =>
      file.path === checkpointPath && file.sha256 === decoyHash
    ), 'decoy bytes must never be fingerprinted as the canonical checkpoint');
    assert.ok(result.failures.some(item =>
      item.path === checkpointPath && item.reason.includes('changed')
    ), JSON.stringify(result.failures));
    assert.equal(await readFile(checkpoint, 'utf8'), originalBytes.toString('utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
