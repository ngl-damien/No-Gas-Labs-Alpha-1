import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPreflight } from '../scripts/validate-agent-governance.mjs';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkpointPath = 'docs/operations/LATEST_CHECKPOINT.md';
const bootstrapCheckpointPath = 'docs/operations/NGL_AGENT_BOOTSTRAP_CHECKPOINT_2026-10-30.md';

test('root instructions and hosted preflight use the same current durable checkpoint', async () => {
  const instructions = await readFile(resolve(root, 'AGENTS.md'), 'utf8');
  const match = /--checkpoint\s+([^\s]+)/.exec(instructions);
  assert.ok(match, 'root AGENTS.md must provide a portable preflight checkpoint path');
  assert.equal(match[1], checkpointPath);

  const absoluteCheckpoint = resolve(root, match[1]);
  assert.ok(absoluteCheckpoint.startsWith(root + sep), 'checkpoint path must remain inside the repository');
  const metadata = await stat(absoluteCheckpoint);
  assert.ok(metadata.isFile(), 'checkpoint must be a regular file');

  const checkpoint = await readFile(absoluteCheckpoint, 'utf8');
  assert.match(checkpoint, /^# Latest Durable Checkpoint$/m);
  assert.ok(checkpoint.trim().length > 100, 'checkpoint must contain a substantive handoff');

  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const ciPreflight = manifest.scripts?.['agent:preflight:ci'];
  assert.equal(typeof ciPreflight, 'string', 'hosted verification must invoke the portable preflight');

  const args = ciPreflight.trim().split(/\s+/);
  const checkpointIndex = args.indexOf('--checkpoint');
  assert.notEqual(checkpointIndex, -1, 'hosted preflight must name its durable checkpoint');
  assert.equal(args[checkpointIndex + 1], checkpointPath, 'hosted preflight must hash the canonical checkpoint');

  const targets = args.flatMap((arg, index) => arg === '--path' && args[index + 1] ? [args[index + 1]] : []);
  assert.ok(targets.includes(checkpointPath), 'canonical checkpoint must also be included in the scoped target list');
  assert.ok(targets.includes(bootstrapCheckpointPath), 'historical bootstrap checkpoint must remain a separately hashed input');
  assert.ok(targets.includes('test/latest-checkpoint-contract.test.mjs'), 'the checkpoint contract regression must be preflighted');
});


const fixtureProtocolText = [
  'Required loop on every run',
  'Shared work coordination rules',
  'Evidence and state rules',
  'Founder authority remains with Damien',
  'MMORPG completion gates and delivery priority'
].join('\n');
const fixtureProtocolPath = 'docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md';
const fixtureCheckpointPath = 'docs/operations/LATEST_CHECKPOINT.md';

async function createPinnedInputFixture() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'ngl-preflight-pinned-inputs-'));
  await mkdir(join(fixtureRoot, 'docs/operations'), { recursive: true });
  await mkdir(join(fixtureRoot, '.github'), { recursive: true });
  const instructions = [
    'STOP: Read this file before repository work.',
    'First repository operation: read root AGENTS.md alone.',
    'Second repository operation: read the complete shared protocol alone.',
    'Discard any pre-read observations and restart the baseline.',
    '[Shared protocol](docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md)',
    'Preflight command: npm run agent:preflight -- --path src/example.mjs --checkpoint docs/operations/LATEST_CHECKPOINT.md'
  ].join('\n');
  await writeFile(join(fixtureRoot, 'AGENTS.md'), instructions);
  await writeFile(join(fixtureRoot, fixtureProtocolPath), fixtureProtocolText);
  await writeFile(join(fixtureRoot, fixtureCheckpointPath), '# Latest Durable Checkpoint\n\nFixture handoff.\n');
  for (const path of ['CLAUDE.md', 'GEMINI.md', 'CODEX.md', '.github/copilot-instructions.md']) {
    await writeFile(join(fixtureRoot, path), 'Read AGENTS.md and RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md first.');
  }
  return fixtureRoot;
}

test('preflight accepts the root-declared instruction, local protocol and checkpoint inputs', async () => {
  const fixtureRoot = await createPinnedInputFixture();
  try {
    const result = await runPreflight({
      root: fixtureRoot,
      paths: ['src/example.mjs'],
      checkpoint: fixtureCheckpointPath
    });
    assert.equal(result.status, 'ready');
    assert.equal(result.entry, 'AGENTS.md');
    assert.equal(result.protocol, fixtureProtocolPath);
    assert.equal(result.checkpoint, fixtureCheckpointPath);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('preflight refuses an alternate entry file even when it contains the required markers', async () => {
  const fixtureRoot = await createPinnedInputFixture();
  try {
    const rootInstructions = await readFile(join(fixtureRoot, 'AGENTS.md'), 'utf8');
    await writeFile(join(fixtureRoot, 'DECOY.md'), rootInstructions);
    const result = await runPreflight({
      root: fixtureRoot,
      entry: 'DECOY.md',
      paths: ['src/example.mjs'],
      checkpoint: fixtureCheckpointPath
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.entry, 'AGENTS.md');
    assert.ok(result.failures.some(item =>
      item.path === 'DECOY.md' && item.reason.includes('repository root AGENTS.md')
    ));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('preflight refuses to override a local protocol named by root AGENTS.md', async () => {
  const fixtureRoot = await createPinnedInputFixture();
  try {
    const decoyPath = 'docs/operations/DECOY_PROTOCOL.md';
    await writeFile(join(fixtureRoot, decoyPath), fixtureProtocolText);
    const result = await runPreflight({
      root: fixtureRoot,
      protocol: decoyPath,
      paths: ['src/example.mjs'],
      checkpoint: fixtureCheckpointPath
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.protocol, fixtureProtocolPath);
    assert.ok(result.failures.some(item =>
      item.path === decoyPath && item.reason.includes('cannot override the local canonical protocol')
    ));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('preflight refuses a checkpoint other than the path declared by root AGENTS.md', async () => {
  const fixtureRoot = await createPinnedInputFixture();
  try {
    const decoyPath = 'docs/operations/DECOY_CHECKPOINT.md';
    await writeFile(join(fixtureRoot, decoyPath), '# Decoy checkpoint\n\nNot the declared handoff.\n');
    const result = await runPreflight({
      root: fixtureRoot,
      paths: ['src/example.mjs'],
      checkpoint: decoyPath
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.checkpoint, null);
    assert.ok(!result.files.some(file => file.path === decoyPath));
    assert.ok(result.failures.some(item =>
      item.path === decoyPath && item.reason.includes('canonical --checkpoint declared by root AGENTS.md')
    ));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});


test('preflight warns when root AGENTS.md omits a canonical checkpoint path', async () => {
  const fixtureRoot = await createPinnedInputFixture();
  try {
    const rootInstructions = (await readFile(join(fixtureRoot, 'AGENTS.md'), 'utf8'))
      .replace(/\nPreflight command:.*$/, '');
    await writeFile(join(fixtureRoot, 'AGENTS.md'), rootInstructions);
    const result = await runPreflight({
      root: fixtureRoot,
      paths: ['src/example.mjs'],
      checkpoint: fixtureCheckpointPath
    });
    assert.equal(result.status, 'ready');
    assert.equal(result.checkpoint, fixtureCheckpointPath);
    assert.ok(result.warnings.some(item => item.includes('does not declare a canonical --checkpoint path')));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
