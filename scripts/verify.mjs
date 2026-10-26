import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const exec = promisify(execFile);
const started = performance.now();

async function preparePrivateRuntimeDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new Error('Verification runtime must be a regular, non-symlink directory');
  }
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY |
      (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isDirectory() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error('Verification runtime changed while opening');
    }
    // The application stores its generated Founder key below .runtime. The
    // verification runner must not leave that directory group/world-accessible.
    await handle.chmod(0o700);
    const secured = await handle.stat();
    const current = await lstat(path);
    if ((secured.mode & 0o077) !== 0 || current.isSymbolicLink() ||
        current.dev !== secured.dev || current.ino !== secured.ino) {
      throw new Error('Verification runtime could not be secured as mode 0700');
    }
  } finally {
    await handle?.close();
  }
}

const runtimeDir = join(ROOT, '.runtime');
await preparePrivateRuntimeDirectory(runtimeDir);
console.log(JSON.stringify({ name: 'private-runtime-directory', mode: '0700', result: 'verified' }));
const out = await mkdtemp(join(runtimeDir, 'verification-'));
const stages = [];
for (const [name, bin, args, cwd] of [
  ['tests', process.execPath, ['--test'], ROOT],
  ['python-inspector', 'python3', ['-m', 'unittest', '-v', 'test_engine.py'], join(ROOT, 'experiments/AOTA-FEATHERSTONIAN-ENGINE')],
  ['package', process.execPath, ['scripts/build-game.mjs'], ROOT],
  ['institutional-exercise', process.execPath, ['scripts/meteor-demo.mjs', '--out', join(out, 'exercise')], ROOT]
]) {
  const at = performance.now();
  let stdout = '', stderr = '', exitCode = 0;
  try {
    ({ stdout, stderr } = await exec(bin, args, { cwd, timeout: 120000, maxBuffer: 8 * 1024 * 1024 }));
  } catch (error) {
    stdout = error.stdout || '';
    stderr = error.stderr || error.message;
    exitCode = typeof error.code === 'number' ? error.code : 1;
  }
  await writeFile(join(out, `${name}.stdout.log`), stdout, { mode: 0o600 });
  await writeFile(join(out, `${name}.stderr.log`), stderr, { mode: 0o600 });
  const record = { name, command: [bin, ...args], exitCode, wallMs: performance.now() - at };
  stages.push(record);
  console.log(JSON.stringify(record));
  if (exitCode) { process.exitCode = 1; break; }
}
const report = {
  schema: 'ngl.verification-run.v1',
  observedAt: new Date().toISOString(),
  passed: stages.length === 4 && stages.every(stage => stage.exitCode === 0),
  stages,
  wallMs: performance.now() - started,
  limitations: [
    'Browser acceptance is an additional check: python3 scripts/verify-browser.py.',
    'These local results do not establish external publication, provider execution or independent human review.'
  ]
};
await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ report: join(out, 'report.json'), passed: report.passed, wallMs: report.wallMs }));
