import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
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
    '[Shared protocol](docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md)'
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
      item.reason.includes('resolved path escapes repository root through a symlink')
    ));
    assert.ok(!result.files.some(file => file.path === 'docs/operations/LATEST_CHECKPOINT.md'));
    assert.equal(await readFile(checkpoint, 'utf8'), '# External checkpoint must not be trusted\\n');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
