import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkpointPath = 'docs/operations/LATEST_CHECKPOINT.md';
const bootstrapCheckpointPath = 'docs/operations/NGL_AGENT_BOOTSTRAP_CHECKPOINT_2026-10-30.md';

test('root instructions and hosted preflight use the same current durable checkpoint', async () => {
  const instructions = await readFile(resolve(root, 'AGENTS.md'), 'utf8');
  const match = /--checkpoint\\s+([^\\s]+)/.exec(instructions);
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

  const args = ciPreflight.trim().split(/\\s+/);
  const checkpointIndex = args.indexOf('--checkpoint');
  assert.notEqual(checkpointIndex, -1, 'hosted preflight must name its durable checkpoint');
  assert.equal(args[checkpointIndex + 1], checkpointPath, 'hosted preflight must hash the canonical checkpoint');

  const targets = args.flatMap((arg, index) => arg === '--path' && args[index + 1] ? [args[index + 1]] : []);
  assert.ok(targets.includes(checkpointPath), 'canonical checkpoint must also be included in the scoped target list');
  assert.ok(targets.includes(bootstrapCheckpointPath), 'historical bootstrap checkpoint must remain a separately hashed input');
  assert.ok(targets.includes('test/latest-checkpoint-contract.test.mjs'), 'the checkpoint contract regression must be preflighted');
});
