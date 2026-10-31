import { chmod, lstat, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const exec = promisify(execFile);
const started = performance.now();
const runtimeRoot = join(ROOT, '.runtime');
await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
let runtimeInfo = await lstat(runtimeRoot);
if (runtimeInfo.isSymbolicLink() || !runtimeInfo.isDirectory()) {
  throw new Error('Verification runtime must be a regular, non-symlink directory');
}
if ((runtimeInfo.mode & 0o077) !== 0) await chmod(runtimeRoot, 0o700);
runtimeInfo = await lstat(runtimeRoot);
if (runtimeInfo.isSymbolicLink() || !runtimeInfo.isDirectory() || (runtimeInfo.mode & 0o077) !== 0) {
  throw new Error('Verification runtime must exclude group and other access');
}
const out = await mkdtemp(join(runtimeRoot, 'verification-'));
const stages = [];

for (const [name, bin, args, cwd, timeoutMs = 120000] of [
  ['tests', process.execPath, ['--test', '--test-reporter=tap'], ROOT, 240000],
  ['python-inspector', 'python3', ['-m', 'unittest', '-v', 'test_engine.py'], join(ROOT, 'experiments/AOTA-FEATHERSTONIAN-ENGINE')],
  ['package', process.execPath, ['scripts/build-game.mjs'], ROOT],
  ['institutional-exercise', process.execPath, ['scripts/meteor-demo.mjs', '--out', join(out, 'exercise')], ROOT]
]) {
  const at = performance.now();
  let stdout = '', stderr = '', exitCode = 0;
  try {
    ({ stdout, stderr } = await exec(bin, args, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }));
  } catch (error) {
    stdout = error.stdout || '';
    stderr = error.stderr || error.message;
    exitCode = typeof error.code === 'number' ? error.code : 1;
  }
  await writeFile(join(out, name + '.stdout.log'), stdout, { mode: 0o600 });
  await writeFile(join(out, name + '.stderr.log'), stderr, { mode: 0o600 });
  const record = { name, command: [bin, ...args], timeoutMs, exitCode, wallMs: performance.now() - at };
  stages.push(record);
  console.log(JSON.stringify(record));
  if (exitCode) {
    const tail = (stdout + '\n' + stderr).split(/\r?\n/).slice(-100).join('\n');
    console.error('FAILED STAGE OUTPUT (' + name + '):\n' + tail);
    process.exitCode = 1;
    break;
  }
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
