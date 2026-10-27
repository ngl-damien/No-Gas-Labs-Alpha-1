import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  MAX_INSTITUTION_REPORT_BYTES,
  readInstitutionReport
} from '../src/institution/report-reader.mjs';

async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-institution-report-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('institution report reader accepts a bounded valid JSON object', async t => {
  const directory = await temp(t);
  const path = join(directory, 'report.json');
  const expected = { schema: 'ngl.compounding-experiment.v1', id: 'fixture', contradictions: [] };
  await writeFile(path, JSON.stringify(expected), { mode: 0o600 });
  assert.deepEqual(await readInstitutionReport(path), expected);
});

test('institution report reader rejects duplicate keys, including escaped spellings', async t => {
  const directory = await temp(t);
  const path = join(directory, 'duplicate.json');
  await writeFile(path, '{"schema":"first","\\u0073chema":"second"}', { mode: 0o600 });
  await assert.rejects(readInstitutionReport(path), /INSTITUTION_REPORT_DUPLICATE_JSON_KEY/);
});

test('institution report reader rejects malformed UTF-8 before parsing', async t => {
  const directory = await temp(t);
  const path = join(directory, 'malformed.json');
  await writeFile(path, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]), { mode: 0o600 });
  await assert.rejects(readInstitutionReport(path), /INSTITUTION_REPORT_INVALID_UTF8/);
});

test('institution report reader rejects a symlink instead of following it', async t => {
  const directory = await temp(t);
  const target = join(directory, 'target.json');
  const alias = join(directory, 'report.json');
  await writeFile(target, '{"schema":"ok"}', { mode: 0o600 });
  await symlink(target, alias);
  await assert.rejects(readInstitutionReport(alias), /INSTITUTION_REPORT_NOT_REGULAR_FILE/);
});

test('institution report reader rejects an oversized sparse file before parsing', async t => {
  const directory = await temp(t);
  const path = join(directory, 'oversized.json');
  await writeFile(path, '');
  await truncate(path, MAX_INSTITUTION_REPORT_BYTES + 1);
  await assert.rejects(readInstitutionReport(path), /INSTITUTION_REPORT_FILE_TOO_LARGE/);
});

test('institution report reader rejects excessive nesting before JSON.parse', async t => {
  const directory = await temp(t);
  const path = join(directory, 'deep.json');
  const depth = 129;
  await writeFile(path, '{"x":' + '['.repeat(depth) + '0' + ']'.repeat(depth) + '}', { mode: 0o600 });
  await assert.rejects(readInstitutionReport(path), /INSTITUTION_REPORT_JSON_TOO_DEEP/);
});

test('institution report reader requires an object root', async t => {
  const directory = await temp(t);
  const path = join(directory, 'array.json');
  await writeFile(path, '[]', { mode: 0o600 });
  await assert.rejects(readInstitutionReport(path), /INSTITUTION_REPORT_INVALID_ROOT/);
});

test('server CLI rejects ambiguous institution reports before creating runtime state', async t => {
  const directory = await temp(t);
  const reportPath = join(directory, 'report.json');
  const runtimeDirectory = join(directory, 'runtime');
  await writeFile(reportPath, '{"schema":"first","\\\\u0073chema":"second"}', { mode: 0o600 });

  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../game/server.mjs', import.meta.url))
  ], {
    encoding: 'utf8',
    timeout: 5000,
    env: {
      ...process.env,
      NGL_INSTITUTION_REPORT: reportPath,
      NGL_DATA_DIR: runtimeDirectory,
      PORT: '0',
      HOST: '127.0.0.1'
    }
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Local world startup failed/);
  await assert.rejects(
    import('node:fs/promises').then(fs => fs.stat(runtimeDirectory)),
    error => error.code === 'ENOENT'
  );
});
