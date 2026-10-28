import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

test('courier rejects a FIFO state path promptly instead of blocking startup', {
  skip: process.platform === 'win32'
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ngl-courier-fifo-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, 'store');
  await mkdir(dataDir, { mode: 0o700 });
  const statePath = join(dataDir, 'courier.json');
  await exec('mkfifo', [statePath]);

  const moduleUrl = new URL('../src/institution/courier.mjs', import.meta.url).href;
  const script = `import { createCourier } from ${JSON.stringify(moduleUrl)};
try {
  await createCourier({ dataDir: ${JSON.stringify(dataDir)}, providers: [] });
  console.error('unexpected success');
  process.exitCode = 2;
} catch (cause) {
  if (cause.code === 'CORRUPT_STATE' && /regular file/.test(cause.message)) {
    console.log('CORRUPT_STATE: regular-file boundary enforced');
  } else {
    console.error(cause);
    process.exitCode = 1;
  }
}`;

  const result = await exec(process.execPath, ['--input-type=module', '-e', script], { timeout: 2000 });
  assert.match(result.stdout, /CORRUPT_STATE: regular-file boundary enforced/);
});
