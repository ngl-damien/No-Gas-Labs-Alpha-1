import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, truncate, link } from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { runPreflight, reconcileInspectedFileRecord, readBoundedHandle, MAX_PREFLIGHT_FILE_BYTES } from '../scripts/validate-agent-governance.mjs';

const protocolPath = 'docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md';
const protocolText = ['Required loop on every run', 'Shared work coordination rules', 'Evidence and state rules', 'Founder authority remains with Damien', 'MMORPG completion gates and delivery priority'].join('\n');

function executableOnPath(name) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try { accessSync(candidate, fsConstants.X_OK); return candidate; }
    catch { /* Continue through the inherited executable search path. */ }
  }
  return null;
}
const mkfifoExecutable = process.platform === 'win32' ? null : executableOnPath('mkfifo');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ngl-agent-preflight-'));
  await mkdir(join(root, 'docs/operations'), { recursive: true });
  await mkdir(join(root, '.github'), { recursive: true });
  await writeFile(join(root, 'AGENTS.md'), 'STOP: Read this file before repository work.\nFirst repository operation: read root AGENTS.md alone.\nSecond repository operation: read the complete shared protocol alone.\nDiscard any pre-read observations and restart the baseline.\n[Shared protocol](docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md)\nPreflight command: npm run agent:preflight -- --path scripts/worker.mjs --checkpoint CHECKPOINT.md\nLeave a durable, factual record.\n');
  await writeFile(join(root, protocolPath), protocolText);
  for (const path of ['CLAUDE.md', 'GEMINI.md', 'CODEX.md', '.github/copilot-instructions.md']) {
    await writeFile(join(root, path), 'Read AGENTS.md and RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md first.');
  }
  await writeFile(join(root, 'CHECKPOINT.md'), '# Latest checkpoint\n');
  return root;
}

test('preflight rejects a path whose fingerprint changes between semantic inspections', () => {
  const originalBytes = Buffer.from('trusted instructions v1');
  const original = reconcileInspectedFileRecord(null, 'AGENTS.md', 'root-instructions', originalBytes);
  assert.equal(original.changed, false);
  assert.equal(original.record.sha256, createHash('sha256').update(originalBytes).digest('hex'));

  const sameBytes = reconcileInspectedFileRecord(
    original.record, 'AGENTS.md', 'target', Buffer.from(originalBytes)
  );
  assert.equal(sameBytes.changed, false);
  assert.equal(sameBytes.record.kind, 'root-instructions',
    'target enumeration must not downgrade trusted instruction classification');

  const changedBytes = Buffer.from('trusted instructions v2');
  assert.equal(changedBytes.byteLength, originalBytes.byteLength,
    'the regression must exercise same-length replacement, not only a size change');
  const changed = reconcileInspectedFileRecord(
    original.record, 'AGENTS.md', 'durable-checkpoint', changedBytes
  );
  assert.equal(changed.changed, true);
  assert.equal(changed.record.sha256, createHash('sha256').update(originalBytes).digest('hex'),
    'the first receipt remains intact but the caller must block rather than report it as current');
});

test('preflight hashes root contract, protocol, scoped nested instructions and checkpoint', async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'scripts'));
    await writeFile(join(root, 'scripts/AGENTS.md'), 'Scripts-specific instructions.');
    const workerBytes = Buffer.from('export const worker = true;\n', 'utf8');
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

test('preflight preserves durable-checkpoint classification when checkpoint is also a target', async () => {
  const root = await fixture();
  try {
    const result = await runPreflight({
      root,
      paths: ['CHECKPOINT.md'],
      checkpoint: 'CHECKPOINT.md'
    });
    assert.equal(result.status, 'ready');
    const checkpoint = result.files.find(file => file.path === 'CHECKPOINT.md');
    assert.equal(checkpoint.kind, 'durable-checkpoint');
    assert.equal(result.checkpoint, 'CHECKPOINT.md');
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

test('preflight rejects directories as scoped targets instead of reading them', async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'scripts', 'directory-target'), { recursive: true });
    const result = await runPreflight({
      root,
      paths: ['scripts/directory-target'],
      checkpoint: 'CHECKPOINT.md'
    });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item =>
      item.path === 'scripts/directory-target' && item.reason.includes('regular file')
    ));
    assert.ok(!result.files.some(file => file.path === 'scripts/directory-target'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preflight rejects oversized sparse targets before allocating their contents', async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'scripts'));
    const oversizedPath = join(root, 'scripts/oversized.bin');
    await writeFile(oversizedPath, '');
    await truncate(oversizedPath, MAX_PREFLIGHT_FILE_BYTES + 1);
    const result = await runPreflight({
      root,
      paths: ['scripts/oversized.bin'],
      checkpoint: 'CHECKPOINT.md'
    });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item =>
      item.path === 'scripts/oversized.bin' && item.reason.includes('preflight size limit')
    ));
    assert.ok(!result.files.some(file => file.path === 'scripts/oversized.bin'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preflight accepts a regular file exactly at the configured size limit', async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'scripts'));
    const exactPath = join(root, 'scripts/exact-limit.bin');
    await writeFile(exactPath, '');
    await truncate(exactPath, MAX_PREFLIGHT_FILE_BYTES);
    const result = await runPreflight({
      root,
      paths: ['scripts/exact-limit.bin'],
      checkpoint: 'CHECKPOINT.md'
    });
    assert.equal(result.status, 'ready', JSON.stringify(result.failures));
    const record = result.files.find(file => file.path === 'scripts/exact-limit.bin');
    assert.equal(record.bytes, MAX_PREFLIGHT_FILE_BYTES);
    assert.match(record.sha256, /^[a-f0-9]{64}$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bounded descriptor reader stops at max plus one byte when a file grows during reading', async () => {
  const source = Buffer.from('twelve-bytes');
  const requests = [];
  const handle = {
    async read(buffer, offset, length, position) {
      requests.push({ length, position });
      const chunk = source.subarray(position, position + length);
      chunk.copy(buffer, offset);
      return { bytesRead: chunk.length };
    }
  };
  const result = await readBoundedHandle(handle, 10);
  assert.deepEqual(result, { tooLarge: true, total: 11 });
  assert.equal(requests.reduce((sum, request) => sum + request.length, 0), 11);
  assert.deepEqual(requests.map(request => request.position), [0]);
});

test('bounded descriptor reader rejects a caller limit above its configured maximum before reading', async () => {
  let readCalls = 0;
  const handle = { async read() { readCalls += 1; return { bytesRead: 0 }; } };
  await assert.rejects(
    readBoundedHandle(handle, MAX_PREFLIGHT_FILE_BYTES + 1),
    /within the configured maximum/
  );
  assert.equal(readCalls, 0);
});


test('preflight rejects FIFO targets without blocking on a writer', {
  skip: mkfifoExecutable ? false : 'POSIX mkfifo utility is unavailable on the current PATH'
}, async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'scripts'));
    const fifoPath = join(root, 'scripts/worker.pipe');
    execFileSync(mkfifoExecutable, [fifoPath]);
    const scriptPath = new URL('../scripts/validate-agent-governance.mjs', import.meta.url).pathname;
    const child = spawnSync(process.execPath, [
      scriptPath,
      '--root', root,
      '--path', 'scripts/worker.pipe',
      '--checkpoint', 'CHECKPOINT.md'
    ], { encoding: 'utf8', timeout: 5000 });
    assert.equal(child.error, undefined, child.error?.message || 'preflight subprocess failed');
    assert.equal(child.status, 1, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item =>
      item.path === 'scripts/worker.pipe' && item.reason.includes('regular file')
    ));
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

test('preflight rejects an in-repository symlink used as a scoped target file', async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'scripts'));
    await writeFile(join(root, 'scripts/real.mjs'), 'export const trusted = true;\n');
    await symlink('real.mjs', join(root, 'scripts/alias.mjs'), 'file');

    const result = await runPreflight({
      root,
      paths: ['scripts/alias.mjs'],
      checkpoint: 'CHECKPOINT.md'
    });

    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item =>
      item.path === 'scripts/alias.mjs' &&
      item.reason.includes('scoped target path must not traverse a symlink')
    ));
    assert.ok(!result.files.some(file => file.path === 'scripts/alias.mjs'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preflight rejects a final-component symlink introduced after the initial lstat', async t => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'scripts'));
    const target = join(root, 'scripts/worker.mjs');
    await writeFile(target, 'export const trusted = true;\\n');
    await writeFile(join(root, 'scripts/replacement.mjs'), 'export const untrusted = true;\\n');

    let swapped = false;
    const originalLstat = fsPromises.lstat;
    t.mock.method(fsPromises, 'lstat', async (...args) => {
      const metadata = await originalLstat(...args);
      if (args[0] === target && !swapped) {
        await rm(target);
        await symlink('replacement.mjs', target, 'file');
        swapped = true;
      }
      return metadata;
    });

    const result = await runPreflight({
      root,
      paths: ['scripts/worker.mjs'],
      checkpoint: 'CHECKPOINT.md'
    });

    assert.equal(swapped, true, 'the fixture must replace the final component after its first lstat');
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item =>
      item.path === 'scripts/worker.mjs' && /symlink|ELOOP/i.test(item.reason)
    ));
    assert.ok(!result.files.some(file => file.path === 'scripts/worker.mjs'),
      'the replacement bytes must never be admitted to the preflight receipt');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preflight rejects an in-repository symlink used as a vendor instruction pointer', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'CLAUDE-copy.md'), 'Read AGENTS.md and RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md first.');
    await rm(join(root, 'CLAUDE.md'));
    await symlink('CLAUDE-copy.md', join(root, 'CLAUDE.md'), 'file');

    const result = await runPreflight({ root });

    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item =>
      item.path === 'CLAUDE.md' &&
      item.reason.includes('trusted instruction path must not traverse a symlink')
    ));
    assert.ok(!result.files.some(file => file.path === 'CLAUDE.md'));
  } finally {
    await rm(root, { recursive: true, force: true });
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

test('preflight rejects an in-repository symlink used as root AGENTS.md', async () => {
  const root = await fixture();
  try {
    const instructions = await readFile(join(root, 'AGENTS.md'), 'utf8');
    await writeFile(join(root, 'AGENTS-copy.md'), instructions);
    await rm(join(root, 'AGENTS.md'));
    await symlink('AGENTS-copy.md', join(root, 'AGENTS.md'), 'file');

    const result = await runPreflight({
      root,
      paths: ['scripts/worker.mjs'],
      checkpoint: 'CHECKPOINT.md'
    });

    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item =>
      item.path === 'AGENTS.md' && item.reason.includes('trusted instruction path must not traverse a symlink')
    ));
    assert.ok(!result.files.some(file => file.path === 'AGENTS.md'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preflight rejects an in-repository symlink used as the canonical shared protocol', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'docs/operations/PROTOCOL-copy.md'), protocolText);
    await rm(join(root, protocolPath));
    await symlink('PROTOCOL-copy.md', join(root, protocolPath), 'file');

    const result = await runPreflight({
      root,
      paths: ['scripts/worker.mjs'],
      checkpoint: 'CHECKPOINT.md'
    });

    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item =>
      item.path === protocolPath && item.reason.includes('trusted instruction path must not traverse a symlink')
    ));
    assert.ok(!result.files.some(file => file.path === protocolPath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preflight rejects an in-repository symlink used as a nested AGENTS.md', async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'scripts'));
    await writeFile(join(root, 'scripts/AGENTS-copy.md'), 'Scripts-specific instructions.');
    await symlink('AGENTS-copy.md', join(root, 'scripts/AGENTS.md'), 'file');

    const result = await runPreflight({
      root,
      paths: ['scripts/worker.mjs'],
      checkpoint: 'CHECKPOINT.md'
    });

    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item =>
      item.path === 'scripts/AGENTS.md' && item.reason.includes('trusted instruction path must not traverse a symlink')
    ));
    assert.ok(!result.files.some(file => file.path === 'scripts/AGENTS.md'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

test('hosted preflight includes the world-view source and canonical checkpoint', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const command = packageJson.scripts['agent:preflight:ci'];
  assert.equal(typeof command, 'string');
  assert.match(command, /--path game\/world-view\.mjs(?:\s|--)/);
  assert.match(command, /--checkpoint docs\/operations\/LATEST_CHECKPOINT\.md/);
});

test('preflight rejects root instructions that share a hard-linked inode outside the checkout', async () => {
  const root = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'ngl-agent-hardlink-outside-'));
  try {
    await link(join(root, 'AGENTS.md'), join(outside, 'linked-AGENTS.md'));
    const result = await runPreflight({ root });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item =>
      item.path === 'AGENTS.md' && item.reason.includes('multiple hard links')
    ));
    assert.ok(!result.files.some(file => file.path === 'AGENTS.md'));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('preflight rejects a scoped target hard-linked to a file outside the checkout', async () => {
  const root = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'ngl-agent-target-hardlink-outside-'));
  try {
    await mkdir(join(root, 'scripts'));
    const outsideFile = join(outside, 'external.mjs');
    const targetFile = join(root, 'scripts/linked.mjs');
    await writeFile(outsideFile, 'bytes that do not belong to this repository');
    await link(outsideFile, targetFile);

    const result = await runPreflight({
      root,
      paths: ['scripts/linked.mjs'],
      checkpoint: 'CHECKPOINT.md'
    });
    assert.equal(result.status, 'blocked');
    assert.ok(result.failures.some(item =>
      item.path === 'scripts/linked.mjs' && item.reason.includes('multiple hard links')
    ));
    assert.ok(!result.files.some(file => file.path === 'scripts/linked.mjs'));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

