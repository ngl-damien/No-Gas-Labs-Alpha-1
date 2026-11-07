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
const diagnostics = [];

for (const [name, bin, args, cwd] of [
  ['tests', process.execPath, ['--test', '--test-reporter=tap'], ROOT],
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
  await writeFile(join(out, name + '.stdout.log'), stdout, { mode: 0o600 });
  await writeFile(join(out, name + '.stderr.log'), stderr, { mode: 0o600 });
  const record = { name, command: [bin, ...args], exitCode, wallMs: performance.now() - at };
  stages.push(record);
  console.log(JSON.stringify(record));
  if (exitCode) {
    const lines = (stdout + '\n' + stderr).split(/\r?\n/);
    const failures = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (/^not ok\s/.test(lines[index])) failures.push(...lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 18)));
    }
    const tail = lines.slice(-300);
    console.error('FAILED STAGE OUTPUT (' + name + '):\n' + [...new Set([...failures, ...tail])].join('\n'));
    if (name === 'tests') {
      const failedFiles = new Set();
      for (let index = 0; index < lines.length; index += 1) {
        const match = lines[index].match(/^# Subtest: (test\/[A-Za-z0-9._/-]+\.mjs)$/);
        if (!match) continue;
        const block = lines.slice(index + 1, Math.min(lines.length, index + 8));
        if (block.some(line => /^not ok \d+ - test\//.test(line))) failedFiles.add(match[1]);
      }
      for (const file of failedFiles) {
        const diagnosticAt = performance.now();
        let diagnosticStdout = '', diagnosticStderr = '', diagnosticExitCode = 0;
        try {
          ({ stdout: diagnosticStdout, stderr: diagnosticStderr } = await exec(
            process.execPath,
            ['--test', '--test-reporter=spec', file],
            { cwd: ROOT, timeout: 120000, maxBuffer: 8 * 1024 * 1024 }
          ));
        } catch (error) {
          diagnosticStdout = error.stdout || '';
          diagnosticStderr = error.stderr || error.message;
          diagnosticExitCode = typeof error.code === 'number' ? error.code : 1;
        }
        const safeName = file.replace(/[^A-Za-z0-9._-]+/g, '-');
        const stdoutLog = join(out, 'diagnostic-' + safeName + '.stdout.log');
        const stderrLog = join(out, 'diagnostic-' + safeName + '.stderr.log');
        await writeFile(stdoutLog, diagnosticStdout, { mode: 0o600 });
        await writeFile(stderrLog, diagnosticStderr, { mode: 0o600 });
        const diagnostic = {
          file,
          exitCode: diagnosticExitCode,
          wallMs: performance.now() - diagnosticAt,
          stdoutLog,
          stderrLog
        };
        diagnostics.push(diagnostic);
        console.error(
          'TARGETED TEST DIAGNOSTIC (' + file + ', exit ' + diagnosticExitCode + '):\\n' +
          (diagnosticStdout + '\\n' + diagnosticStderr).split(/\\r?\\n/).slice(-400).join('\\n')
        );
      }
    }
    process.exitCode = 1;
    break;
  }
}

const report = {
  schema: 'ngl.verification-run.v1',
  observedAt: new Date().toISOString(),
  passed: stages.length === 4 && stages.every(stage => stage.exitCode === 0),
  stages,
  diagnostics,
  wallMs: performance.now() - started,
  limitations: [
    'Browser acceptance is an additional check: python3 scripts/verify-browser.py.',
    'These local results do not establish external publication, provider execution or independent human review.'
  ]
};
await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ report: join(out, 'report.json'), passed: report.passed, wallMs: report.wallMs }));
