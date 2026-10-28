import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
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

test('hash-pinned reference rejects content that differs from its receipt', async t => {
  const directory = await temp(t);
  const docs = join(directory, 'docs');
  await mkdir(docs, { mode: 0o700 });
  await writeFile(join(docs, 'source.md'), 'actual bytes', { mode: 0o600 });
  await assert.rejects(
    readVerifiedReference(directory, { path: 'docs/source.md', sha256: '0'.repeat(64) }),
    /Recovery reference changed/
  );
});

test('recovery command rejects a non-UTF-8 continuity record', async t => {
  const directory = await temp(t);
  const path = join(directory, 'state.json');
  await writeFile(path, Buffer.from([0xff, 0xfe, 0xfd]), { mode: 0o600 });
  await assert.rejects(
    execFileAsync(process.execPath, [join(repositoryRoot, 'scripts/recover-institution.mjs'), path], {
      cwd: repositoryRoot,
      maxBuffer: 1024 * 1024
    }),
    error => error.code === 1 && /not valid UTF-8/.test(error.stderr)
  );
});

test('default recovery command verifies retained references and emits byte receipts in a fresh Node process', async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [join(repositoryRoot, 'scripts/recover-institution.mjs')],
    { cwd: repositoryRoot, maxBuffer: 1024 * 1024 }
  );
  const report = JSON.parse(stdout);
  assert.equal(report.schema, 'ngl.fresh-process-recovery.v1');
  assert.equal(report.passed, true);
  assert.equal(report.recovered.length, 10);
  assert.equal(report.receipts.length, report.recovered.length);
  for (const receipt of report.receipts) {
    assert.ok(report.recovered.includes(receipt.path));
    assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(receipt.size) && receipt.size >= 0);
  }
  assert.match(report.scope, /not a fresh cloud\/environment restoration/);
});
