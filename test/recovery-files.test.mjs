import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  MAX_RECOVERY_STATE_BYTES,
  readRecoveryState,
  readStableRegularFile,
  readVerifiedReference
} from '../src/institution/recovery-files.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-recovery-files-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function runRecovery(statePath) {
  return execFileAsync(
    process.execPath,
    statePath
      ? [join(repositoryRoot, 'scripts/recover-institution.mjs'), statePath]
      : [join(repositoryRoot, 'scripts/recover-institution.mjs')],
    { cwd: repositoryRoot, maxBuffer: 1024 * 1024 }
  );
}

test('stable reader returns exact bytes from a regular file', async t => {
  const directory = await temp(t);
  const path = join(directory, 'state.json');
  const bytes = Buffer.from('{"schema":"test"}');
  await writeFile(path, bytes, { mode: 0o600 });
  assert.deepEqual(await readRecoveryState(path), bytes);
});

test('continuity record rejects symlinks', async t => {
  const directory = await temp(t);
  const target = join(directory, 'target.json');
  const link = join(directory, 'state.json');
  await writeFile(target, '{}', { mode: 0o600 });
  await symlink(target, link);
  await assert.rejects(readRecoveryState(link), /regular, non-symlink/);
});

test('stable reader enforces the byte limit before reading', async t => {
  const directory = await temp(t);
  const path = join(directory, 'oversized.json');
  await writeFile(path, '12345', { mode: 0o600 });
  await assert.rejects(
    readStableRegularFile(path, { maxBytes: 4, label: 'Fixture' }),
    /exceeds its 4-byte limit/
  );
  assert.equal(MAX_RECOVERY_STATE_BYTES, 1024 * 1024);
});

test('hash-pinned reference returns only a contained regular file', async t => {
  const directory = await temp(t);
  const docs = join(directory, 'docs');
  await mkdir(docs, { mode: 0o700 });
  const path = join(docs, 'source.md');
  const bytes = Buffer.from('# Verified source\n');
  await writeFile(path, bytes, { mode: 0o600 });

  const result = await readVerifiedReference(directory, {
    path: 'docs/source.md',
    sha256: sha256(bytes)
  });
  assert.equal(result.target, path);
  assert.equal(result.size, bytes.length);
  assert.equal(result.verified, true);
  assert.equal(result.actualSha256, result.expectedSha256);
});

test('hash-pinned reference rejects a symlinked file or parent directory', async t => {
  const directory = await temp(t);
  const docs = join(directory, 'docs');
  await mkdir(docs, { mode: 0o700 });
  const target = join(docs, 'source.md');
  const bytes = Buffer.from('trusted bytes');
  await writeFile(target, bytes, { mode: 0o600 });
  await symlink(target, join(docs, 'linked.md'));

  await assert.rejects(
    readVerifiedReference(directory, { path: 'docs/linked.md', sha256: sha256(bytes) }),
    /contains a symlink/
  );

  const realDirectory = join(directory, 'real', 'docs');
  await mkdir(realDirectory, { recursive: true, mode: 0o700 });
  await writeFile(join(realDirectory, 'source.md'), bytes, { mode: 0o600 });
  await symlink(realDirectory, join(directory, 'redirected-docs'));

  await assert.rejects(
    readVerifiedReference(directory, { path: 'redirected-docs/source.md', sha256: sha256(bytes) }),
    /contains a symlink/
  );
});

test('hash-pinned reference rejects traversal and sensitive path classes', async t => {
  const directory = await temp(t);
  const validHash = 'a'.repeat(64);
  for (const path of ['../outside.md', '.runtime/founder.key', '.git/config', 'docs/secret.pem', '/etc/passwd']) {
    await assert.rejects(
      readVerifiedReference(directory, { path, sha256: validHash }),
      /Unsafe recovery reference/
    );
  }
});

test('hash-pinned reference reports a digest mismatch without treating it as verified', async t => {
  const directory = await temp(t);
  const docs = join(directory, 'docs');
  const bytes = Buffer.from('actual bytes');
  await mkdir(docs, { mode: 0o700 });
  await writeFile(join(docs, 'source.md'), bytes, { mode: 0o600 });
  const result = await readVerifiedReference(directory, {
    path: 'docs/source.md',
    sha256: '0'.repeat(64)
  });
  assert.equal(result.verified, false);
  assert.equal(result.expectedSha256, '0'.repeat(64));
  assert.equal(result.actualSha256, sha256(bytes));
});

test('recovery command rejects a non-UTF-8 continuity record', async t => {
  const directory = await temp(t);
  const path = join(directory, 'state.json');
  await writeFile(path, Buffer.from([0xff, 0xfe, 0xfd]), { mode: 0o600 });
  await assert.rejects(
    runRecovery(path),
    error => error.code === 1 && /not valid UTF-8/.test(error.stderr)
  );
});

test('recovery command succeeds on a controlled record and emits exact byte receipts', async t => {
  const directory = await temp(t);
  const packageBytes = await readFile(join(repositoryRoot, 'package.json'));
  const state = {
    schema: 'ngl.institution-continuity.v1',
    principal: 'Damien Featherstone',
    references: [{ path: 'package.json', sha256: sha256(packageBytes) }],
    assignments: [{ role: 'test' }],
    authority: 'Test-only authority statement',
    nextAction: 'No action',
    rollback: 'No mutation',
    machinery: { M0: {}, M1: {} },
    openFailures: [],
    taskB: {},
    founderDecision: {}
  };
  const statePath = join(directory, 'state.json');
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });

  const { stdout } = await runRecovery(statePath);
  const report = JSON.parse(stdout);
  assert.equal(report.passed, true);
  assert.deepEqual(report.recovered, ['package.json']);
  assert.equal(report.receipts.length, 1);
  assert.equal(report.receipts[0].status, 'verified');
  assert.equal(report.receipts[0].expectedSha256, state.references[0].sha256);
  assert.equal(report.receipts[0].actualSha256, state.references[0].sha256);
  assert.equal(report.receipts[0].size, packageBytes.length);
});

test('default recovery command reports all references and fails closed on any drift', async () => {
  let stdout;
  let exitCode = 0;
  try {
    ({ stdout } = await runRecovery());
  } catch (error) {
    stdout = error.stdout;
    exitCode = Number(error.code);
  }
  const report = JSON.parse(stdout);
  assert.equal(report.schema, 'ngl.fresh-process-recovery.v1');
  assert.equal(report.receipts.length, 10);
  assert.equal(report.passed, exitCode === 0);
  assert.equal(report.failures.length, report.receipts.filter(receipt => receipt.status !== 'verified').length);
  if (!report.passed) assert.ok(report.failures.length > 0);
  assert.match(report.scope, /not a fresh cloud\/environment restoration/);
});
