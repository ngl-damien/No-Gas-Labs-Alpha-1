import test from 'node:test';
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
