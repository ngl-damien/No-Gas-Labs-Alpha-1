import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreflight } from '../scripts/validate-agent-governance.mjs';

const protocolPath = 'docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md';
const protocolText = ['Required loop on every run', 'Shared work coordination rules', 'Evidence and state rules', 'Founder authority remains with Damien', 'MMORPG completion gates and delivery priority'].join('\n');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ngl-agent-preflight-'));
  await mkdir(join(root, 'docs/operations'), { recursive: true });
  await mkdir(join(root, '.github'), { recursive: true });
  await writeFile(join(root, 'AGENTS.md'), 'STOP: Read this file before repository work.\nFirst repository operation: read root AGENTS.md alone.\nSecond repository operation: read the complete shared protocol alone.\nDiscard any pre-read observations and restart the baseline.\n[Shared protocol](docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md)\nLeave a durable, factual record.\n');
  await writeFile(join(root, protocolPath), protocolText);
  for (const path of ['CLAUDE.md', 'GEMINI.md', 'CODEX.md', '.github/copilot-instructions.md']) {
    await writeFile(join(root, path), 'Read AGENTS.md and RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md first.');
  }
  await writeFile(join(root, 'CHECKPOINT.md'), '# Latest checkpoint\n');
  return root;
}

test('preflight hashes root contract, protocol, scoped nested instructions and checkpoint', async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'scripts'));
    await writeFile(join(root, 'scripts/AGENTS.md'), 'Scripts-specific instructions.');
    const workerBytes = Buffer.from('export const worker = true;\\n', 'utf8');
    await writeFile(join(root, 'scripts/worker.mjs'), workerBytes);
    const result = await runPreflight({ root, paths: ['scripts/worker.mjs'], checkpoint: 'CHECKPOINT.md' });
    assert.equal(result.status, 'ready');
    assert.equal(result.protocol, protocolPath);
    assert.ok(result.files.some(file => file.path === 'scripts/AGENTS.md' && file.kind === 'nested-instructions'));
    assert.ok(result.files.some(file => file.path === 'CHECKPOINT.md' && file.kind === 'durable-checkpoint'));
    const target = result.files.find(file => file.path === 'scripts/worker.mjs');
    assert.equal(target.kind, 'target');
    assert.equal(target.bytes, workerBytes.byteLength);
    assert.equal(target.sha256, createHash('sha256').update(workerBytes).digest('hex'));
    assert.ok(result.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preflight blocks a missing scoped target instead of returning a ready receipt', async () => {
  const root = await fixture();
  try {
    const result = await runPreflight({
      root,
      paths: ['scripts/missing.mjs'],
      checkpoint: 'CHECKPOINT.md'
    });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item =>
      item.path === 'scripts/missing.mjs' && item.reason.includes('cannot read')
    ));
    assert.ok(!result.files.some(file => file.path === 'scripts/missing.mjs'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preflight rejects invalid UTF-8 in a scoped target', async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'scripts'));
    await writeFile(join(root, 'scripts/bad.mjs'), Buffer.from([0x52, 0x65, 0xff]));
    const result = await runPreflight({
      root,
      paths: ['scripts/bad.mjs'],
      checkpoint: 'CHECKPOINT.md'
    });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item =>
      item.path === 'scripts/bad.mjs' && item.reason.includes('valid UTF-8')
    ));
    assert.ok(!result.files.some(file => file.path === 'scripts/bad.mjs'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preflight rejects invalid UTF-8 instead of hashing replacement-decoded text', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'CLAUDE.md'), Buffer.from([0x52, 0x65, 0x61, 0x64, 0xff]));
    const result = await runPreflight({ root });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item => item.path === 'CLAUDE.md' && item.reason.includes('valid UTF-8')));
    assert.ok(!result.files.some(file => file.path === 'CLAUDE.md'));
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('preflight rejects Windows drive-qualified paths on every host platform', async () => {
  const root = await fixture();
  try {
    const driveAbsolute = 'C' + ':' + '/' + 'outside.mjs';
    const driveRelative = 'C' + ':' + 'relative.mjs';
    const result = await runPreflight({
      root,
      paths: [driveAbsolute, driveRelative],
      checkpoint: 'CHECKPOINT.md'
    });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item => item.path === driveAbsolute && item.reason.includes('safe repository-relative path')));
    assert.ok(result.failures.some(item => item.path === driveRelative && item.reason.includes('safe repository-relative path')));
    assert.deepEqual(result.targets, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preflight fails closed when sequential bootstrap order is removed', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'AGENTS.md'), 'STOP: Read this file before repository work.\n[Shared protocol](docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md)\nLeave a durable, factual record.\n');
    const result = await runPreflight({ root });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item => item.path === 'AGENTS.md' && item.reason.includes('First repository operation:')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('targeted work is blocked unless a durable checkpoint is supplied', async () => {
  const root = await fixture();
  try {
    const result = await runPreflight({ root, paths: ['scripts/worker.mjs'] });
    assert.equal(result.status, 'blocked');
    assert.match(result.failures.map(item => item.reason).join(' '), /requires --checkpoint/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preflight rejects traversal paths instead of reading outside the repository', async () => {
  const root = await fixture();
  try {
    const result = await runPreflight({ root, paths: ['../outside.mjs'], checkpoint: 'CHECKPOINT.md' });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item => item.reason.includes('safe repository-relative path')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preflight fails closed when the canonical protocol is missing', async () => {
  const root = await fixture();
  try {
    await rm(join(root, protocolPath));
    const result = await runPreflight({ root });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item => item.path === protocolPath));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preflight rejects vendor instructions that bypass the shared contract', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'CODEX.md'), 'Do work without reading repository instructions.');
    const result = await runPreflight({ root });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item => item.path === 'CODEX.md'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preflight writes a durable JSON receipt without overwriting an existing one', async () => {
  const root = await fixture();
  try {
    const options = { root, receiptPath: 'artifacts/preflight.json' };
    const first = await runPreflight(options);
    assert.equal(first.status, 'ready');
    const saved = JSON.parse(await readFile(join(root, options.receiptPath), 'utf8'));
    assert.equal(saved.schema, 'ngl.agent-preflight.v1');
    const second = await runPreflight(options);
    assert.equal(second.status, 'blocked');
    assert.ok(second.failures.some(item => item.path === options.receiptPath));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preflight rejects nested instruction files reached through an escaping symlink', async () => {
  const root = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'ngl-agent-outside-'));
  try {
    await mkdir(join(root, 'scripts'));
    await writeFile(join(outside, 'AGENTS.md'), 'External instructions must not be read.');
    await symlink(outside, join(root, 'scripts/vendor'), 'dir');
    const result = await runPreflight({ root, paths: ['scripts/vendor/worker.mjs'], checkpoint: 'CHECKPOINT.md' });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item => item.reason.includes('escapes repository root through a symlink')));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('preflight rejects a target path whose existing parent escapes through a symlink', async () => {
  const root = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'ngl-agent-target-outside-'));
  try {
    await mkdir(join(root, 'scripts'));
    await symlink(outside, join(root, 'scripts/external'), 'dir');
    const result = await runPreflight({ root, paths: ['scripts/external/new-file.mjs'], checkpoint: 'CHECKPOINT.md' });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item => item.reason.includes('target path escapes repository root through a symlink')));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('preflight supports NGL repositories with a remote protocol link when given a local pinned copy', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'AGENTS.md'), 'Before any work, read this file and the canonical [shared protocol](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/blob/main/docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md).\nFirst repository operation: read root AGENTS.md alone.\nSecond repository operation: read the complete shared protocol alone.\nDiscard any pre-read observations.\n');
    const result = await runPreflight({ root, protocol: protocolPath });
    assert.equal(result.status, 'ready');
    assert.equal(result.protocol, protocolPath);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preflight refuses to fetch an unpinned remote protocol implicitly', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'AGENTS.md'), 'Before any work, read [the shared protocol](https://example.invalid/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md).');
    const result = await runPreflight({ root });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item => item.reason.includes('locally pinned copy')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preflight requires the standard vendor entry points to remain present', async () => {
  const root = await fixture();
  try {
    await rm(join(root, 'GEMINI.md'));
    const result = await runPreflight({ root });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item => item.path === 'GEMINI.md' && item.reason.includes('cannot read')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preflight refuses receipt creation through an escaping directory symlink', async () => {
  const root = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'ngl-agent-receipt-outside-'));
  try {
    await symlink(outside, join(root, 'artifacts'), 'dir');
    const result = await runPreflight({ root, receiptPath: 'artifacts/preflight.json' });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item => item.reason.includes('receipt directory escapes repository root')));
    await assert.rejects(readFile(join(outside, 'preflight.json'), 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('CI preflight scopes the Founder signer, verifier and authorization regressions', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const script = packageJson.scripts['agent:preflight:ci'];
  for (const path of [
    'authority/index.html',
    'src/authority/decision.js',
    'test/decision-chamber.test.js',
    'test/decision-context-binding.test.js',
    'test/decision-world-integration.test.js'
  ]) {
    assert.ok(script.includes('--path ' + path), 'missing scoped preflight target: ' + path);
  }
});
