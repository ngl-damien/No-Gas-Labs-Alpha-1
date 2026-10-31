import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('root agent preflight checkpoint path resolves to a current durable artifact', async () => {
  const instructions = await readFile(resolve(root, 'AGENTS.md'), 'utf8');
  const match = /--checkpoint\\s+([^\\s]+)/.exec(instructions);
  assert.ok(match, 'root AGENTS.md must provide a portable preflight checkpoint path');
  assert.equal(match[1], 'docs/operations/LATEST_CHECKPOINT.md');

  const checkpointPath = resolve(root, match[1]);
  assert.ok(checkpointPath.startsWith(root + sep), 'checkpoint path must remain inside the repository');
  const metadata = await stat(checkpointPath);
  assert.ok(metadata.isFile(), 'checkpoint must be a regular file');
  const checkpoint = await readFile(checkpointPath, 'utf8');
  assert.match(checkpoint, /^# Latest Durable Checkpoint$/m);
  assert.ok(checkpoint.trim().length > 100, 'checkpoint must contain a substantive handoff');
});
