import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat, realpath, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';

const exec = promisify(execFile);
const TARGET = 'fixtures/forge/workload/candidate.mjs';
const BENCHMARK = 'fixtures/forge/workload/benchmark.mjs';
const VERIFY = 'fixtures/forge/workload/verify.mjs';
const DEFAULTS = Object.freeze({ timeoutMs: 1000, maxOutputBytes: 65536, concurrency: 1 });
const REPOSITORY_DEFAULTS = Object.freeze({ timeoutMs: 30000, maxOutputBytes: 1048576, concurrency: 2 });
const SOURCE_LIMITS = Object.freeze({ files: 4096, bytes: 32 * 1024 * 1024, fileBytes: 4 * 1024 * 1024 });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const slash = value => value.split(sep).join('/');
function exactKeys(value, keys, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unknown ${label} field: ${key}`);
}
function safePath(path) {
  return typeof path === 'string' && path.length > 0 && !path.includes('\\') && !path.includes('\0') && !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..');
}
function excluded(path) {
  return path.split('/').some(part => /^(?:\.git|\.runtime|runtime|node_modules|dist|\.aws|\.ssh|\.codex|\.agents|\.npmrc|\.netrc|\.pypirc|secrets?|credentials?|__pycache__)$/i.test(part) || /^\.env/i.test(part) || /\.(?:pem|key|p12|pfx|pyc)$/i.test(part) || /^(?:id_rsa|id_ed25519|credentials(?:\.json)?|secrets?\.json)$/i.test(part));
}
export function listWorkloads() {
  return [{ id: 'vector-sum-v1', description: 'Sum the same deterministic 10,000-number vector 200 times; verify seven independent cases and input preservation.', overlayPaths: [TARGET], execution: { executable: 'node', args: [BENCHMARK] }, verification: { executable: 'node', args: [VERIFY] } }, { id: 'repository-tests-v1', description: 'Run explicit copied repository tests and independently check TAP completion and source integrity.', overlayPaths: [], testPaths: ['test/*.test.js', 'test/*.test.mjs', 'genesis.test.mjs', 'reconstitution/*.test.js', 'reconstitution/*.test.mjs'], excludedTests: ['test/forge-runner.test.js', 'test/forge-runner.test.mjs'], execution: { executable: 'node', args: ['--test', '--test-reporter=tap', '--test-concurrency=<bounded>', '<explicit-allowlisted-paths>'] } }];
}
export function forgeCapabilities() {
  return { execution: 'trusted-local-child-processes', workloads: listWorkloads(), limits: { defaults: DEFAULTS, maxCandidates: 8, maxConcurrency: 4, maxTimeoutMs: 10000, maxOutputBytes: 1048576, source: SOURCE_LIMITS }, repositoryLimits: { defaults: REPOSITORY_DEFAULTS, maxConcurrency: 4, maxTimeoutMs: 120000, maxOutputBytes: 1048576 }, automaticIntegration: false, osSandbox: false };
}
function validate(options) {
  exactKeys(options, ['sourceDir', 'outDir', 'workloadId', 'candidates', 'limits'], 'request');
  if (typeof options.sourceDir !== 'string' || typeof options.outDir !== 'string') throw new Error('sourceDir and a fresh outDir are required');
  const workloadId = options.workloadId ?? 'vector-sum-v1';
  if (workloadId !== 'vector-sum-v1') throw new Error(`Workload is not allowlisted: ${workloadId}`);
  exactKeys(options.limits ?? {}, Object.keys(DEFAULTS), 'limits');
  const limits = { ...DEFAULTS, ...options.limits };
  for (const [key, min, max] of [['timeoutMs', 50, 10000], ['maxOutputBytes', 1024, 1048576], ['concurrency', 1, 4]]) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < min || limits[key] > max) throw new Error(`Invalid ${key} limit: ${min}..${max}`);
  }
  if (!Array.isArray(options.candidates) || !options.candidates.length || options.candidates.length > 8) throw new Error('Candidate limit is 1..8');
  const ids = new Set();
  const candidates = options.candidates.map(candidate => {
    exactKeys(candidate, ['id', 'overlay'], 'candidate');
    if (typeof candidate.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(candidate.id) || ids.has(candidate.id)) throw new Error('Candidate IDs must be unique, short path-safe identifiers');
    ids.add(candidate.id);
    exactKeys(candidate.overlay ?? {}, [TARGET], 'overlay allowlist');
    const overlay = {};
    for (const path of Object.keys(candidate.overlay ?? {}).sort()) {
      if (!safePath(path) || path !== TARGET) throw new Error(`Overlay path is not allowlisted: ${path}`);
      const source = candidate.overlay[path];
      if (typeof source !== 'string' || Buffer.byteLength(source) > 65536) throw new Error('Overlay must contain at most 65536 UTF8 source bytes');
      overlay[path] = source;
    }
    return { id: candidate.id, overlay };
  });
  return { workloadId, candidates, limits };
}
async function git(sourceDir, args) {
  const { stdout } = await exec('git', args, { cwd: sourceDir, maxBuffer: 4 * 1024 * 1024, timeout: 5000, encoding: 'utf8' });
  return stdout;
}
async function physicalOutputPath(path) {
  const missing = [];
  let ancestor = resolve(path);
  while (true) {
    try { return resolve(await realpath(ancestor), ...missing); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // A dangling link is not a missing directory that we may create through.
      try {
        if ((await lstat(ancestor)).isSymbolicLink()) throw new Error('outDir has a dangling symbolic link ancestor');
      } catch (inspectError) { if (inspectError.code !== 'ENOENT') throw inspectError; }
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(ancestor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
      ancestor = parent;
    }
  }
}
async function publicSourcePaths(sourceDir) {
  const paths = [];
  let entries = 0;
  async function walk(path, depth = 0) {
    if (excluded(path)) return;
    if (++entries > SOURCE_LIMITS.files * 2 || depth > 16) throw new Error('Public source traversal limit exceeded');
    let info;
    try { info = await lstat(join(sourceDir, path)); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) throw new Error(`Source symbolic link is not permitted: ${path}`);
    if (info.isDirectory()) {
      for (const name of (await readdir(join(sourceDir, path))).sort()) {
        if (name.startsWith('.')) continue;
        await walk(`${path}/${name}`, depth + 1);
      }
    } else if (info.isFile() && /\.(?:mjs|js|html|css|md|py|json|jpg|png)$/.test(path)) paths.push(path);
  }
  for (const path of ['README.md', 'package.json', 'core.mjs', 'evidence.mjs', 'genesis.test.mjs', 'manifest.json', 'src', 'test', 'fixtures', 'scripts', 'game', 'docs/meteor', 'reconstitution']) await walk(path);
  return paths.sort();
}
async function sourceSnapshot(sourceDir, { requiredFiles = [TARGET, BENCHMARK, VERIFY], allowPublicSource = false } = {}) {
  let hasGit = true;
  try { await lstat(join(sourceDir, '.git')); } catch (error) { if (error.code !== 'ENOENT') throw error; hasGit = false; }
  let paths, revision, snapshotMode;
  if (!hasGit && allowPublicSource) {
    paths = await publicSourcePaths(sourceDir);
    revision = { head: null, dirty: null };
    snapshotMode = 'public-source';
  } else {
    const top = await realpath((await git(sourceDir, ['rev-parse', '--show-toplevel'])).trim());
    if (top !== sourceDir) throw new Error('sourceDir must be the repository root');
    const [listed, ignoredTracked, head, status] = await Promise.all([
      git(sourceDir, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']),
      git(sourceDir, ['ls-files', '--cached', '--ignored', '--exclude-standard', '-z']),
      git(sourceDir, ['rev-parse', 'HEAD']),
      git(sourceDir, ['status', '--porcelain=v1', '-z'])
    ]);
    const ignored = new Set(ignoredTracked.split('\0').filter(Boolean));
    paths = [...new Set(listed.split('\0').filter(Boolean))].filter(path => !ignored.has(path) && !excluded(path)).sort();
    revision = { head: head.trim(), dirty: status.length > 0 };
    snapshotMode = 'git';
  }
  if (paths.length > SOURCE_LIMITS.files) throw new Error('Source file count exceeds limit');
  const bytes = new Map();
  let total = 0;
  for (const path of paths) {
    if (!safePath(path)) throw new Error(`Unsafe source path: ${path}`);
    // Refuse links at every component, including directories, before reading bytes.
    let current = sourceDir;
    for (const part of path.split('/')) {
      current = join(current, part);
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error(`Source symbolic link is not permitted: ${path}`);
    }
    const info = await lstat(current);
    if (!info.isFile()) throw new Error(`Source is not a regular file: ${path}`);
    if (info.size > SOURCE_LIMITS.fileBytes || total + info.size > SOURCE_LIMITS.bytes) throw new Error('Source byte limit exceeded');
    const content = await readFile(current);
    total += content.length;
    if (total > SOURCE_LIMITS.bytes || content.length > SOURCE_LIMITS.fileBytes) throw new Error('Source byte limit exceeded');
    bytes.set(path, content);
  }
  for (const required of requiredFiles) if (!bytes.has(required)) throw new Error(`Workload source is missing: ${required}`);
  const files = [...bytes].map(([path, content]) => ({ path, size: content.length, sha256: sha256(content) }));
  return { bytes, manifest: { schema: 'ngl.forge-source.v1', snapshotMode, revision, digest: sha256(stable(files)), files, totalBytes: total, excludedPolicy: snapshotMode === 'git' ? 'Git ignored files, metadata, runtime, dependency/build directories and credential filename patterns; no credential contents inspected.' : 'Fixed public-source roots and file extensions only; metadata, hidden paths, runtime, dependency/build directories and credential filename patterns excluded. No Git history or Git-ignore evaluation is claimed.' } };
}
async function writeBytes(root, path, bytes) {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
}
async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
function killGroup(child) {
  if (!child.pid) return;
  try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
async function executePhase({ workspace, outDir, prefix, entry, limits, input, phaseArgs }) {
  const started = performance.now();
  const args = ['--max-old-space-size=128', ...(phaseArgs ?? [entry])];
  const chunks = { stdout: [], stderr: [] };
  let captured = 0;
  let outcome = null;
  let spawnError = null;
  const child = spawn(process.execPath, args, { cwd: workspace, shell: false, detached: process.platform !== 'win32', stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], env: { PATH: dirname(process.execPath), HOME: workspace, TMPDIR: join(workspace, '.tmp'), LANG: 'C.UTF-8', TZ: 'UTC' } });
  if (child.stdin) {
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') spawnError = error.message; });
    child.stdin.end(input);
  }
  const collect = stream => bytes => {
    const remaining = limits.maxOutputBytes - captured;
    if (remaining > 0) {
      const kept = bytes.subarray(0, remaining);
      chunks[stream].push(kept);
      captured += kept.length;
    }
    if (bytes.length > remaining && !outcome) { outcome = 'output_limited'; killGroup(child); }
  };
  child.stdout.on('data', collect('stdout'));
  child.stderr.on('data', collect('stderr'));
  const timer = setTimeout(() => { if (!outcome) { outcome = 'timed_out'; killGroup(child); } }, limits.timeoutMs);
  const { exitCode, signal } = await new Promise(resolveClose => {
    child.once('error', error => { spawnError = error.message; });
    child.once('close', (exitCode, signal) => resolveClose({ exitCode, signal }));
  });
  clearTimeout(timer);
  killGroup(child); // Also reap ordinary descendants that outlived their parent.
  const wallMs = performance.now() - started;
  const receipts = {};
  const content = {};
  for (const stream of ['stdout', 'stderr']) {
    const bytes = Buffer.concat(chunks[stream]);
    const path = `${prefix}.${stream}.log`;
    await writeBytes(outDir, path, bytes);
    receipts[stream] = { path, size: bytes.length, sha256: sha256(bytes) };
    content[stream] = bytes.toString('utf8');
  }
  return { receipt: { outcome: outcome ?? (spawnError ? 'spawn_failed' : exitCode === 0 ? 'passed' : 'failed'), executable: process.execPath, args, pid: child.pid ?? null, exitCode, signal, error: spawnError, wallMs, ...receipts }, content };
}
async function verifyWorkspace(workspace, expected) {
  const changed = new Set();
  const expectedPaths = new Set(expected.keys());
  const expectedDirectories = new Set();
  for (const path of expectedPaths) {
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index += 1) expectedDirectories.add(parts.slice(0, index).join('/'));
  }
  const allowScratch = ![...expectedPaths].some(path => path === '.tmp' || path.startsWith('.tmp/'));
  try {
    const rootInfo = await lstat(workspace);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('workspace root is not a regular directory');
  } catch {
    return { passed: false, changedPaths: ['.'] };
  }
  async function inspect(directory, prefix = '') {
    for (const name of await readdir(directory)) {
      const path = prefix ? `${prefix}/${name}` : name;
      const absolute = join(directory, name);
      let info;
      try { info = await lstat(absolute); } catch { changed.add(path); continue; }
      if (path === '.tmp' && allowScratch) {
        if (info.isSymbolicLink() || !info.isDirectory()) changed.add(path);
        continue;
      }
      if (info.isSymbolicLink()) { changed.add(path); continue; }
      if (info.isDirectory()) {
        if (!expectedDirectories.has(path)) changed.add(path);
        await inspect(absolute, path);
      } else if (info.isFile()) {
        if (!expectedPaths.has(path)) changed.add(path);
      } else changed.add(path);
    }
  }
  await inspect(workspace);
  if (allowScratch) {
    try {
      const scratchInfo = await lstat(join(workspace, '.tmp'));
      if (scratchInfo.isSymbolicLink() || !scratchInfo.isDirectory()) changed.add('.tmp');
    } catch { changed.add('.tmp'); }
  }
  for (const [path, bytes] of expected) {
    try {
      let current = workspace;
      for (const part of path.split('/')) {
        current = join(current, part);
        if ((await lstat(current)).isSymbolicLink()) throw new Error('link');
      }
      const info = await lstat(current);
      if (!info.isFile() || sha256(await readFile(current)) !== sha256(bytes)) changed.add(path);
    } catch { changed.add(path); }
  }
  return { passed: changed.size === 0, changedPaths: [...changed].sort() };
}
function parseJson(text) { try { return JSON.parse(text.trim()); } catch { return null; } }
const expectedChecksum = Array.from({ length: 10000 }, (_, index) => index % 201 - 100).reduce((a, b) => a + b, 0) * 200;
const challengeCases = [[], [1], [-1, 0, 1], [2, 3, 4], [-10, -20], [0.5, 0.25, -0.125], Array.from({ length: 10000 }, (_, index) => index % 201 - 100)];
const verificationChallenge = { schema: 'ngl.forge-challenge.v1', cases: challengeCases.map(values => ({ values, expected: values.reduce((a, b) => a + b, 0) })) };
const challengeId = sha256(stable(verificationChallenge));
function checkVerification(response) {
  const protocolValid = response?.schema === 'ngl.forge-verification.v2' && response.challengeId === challengeId && Array.isArray(response.cases) && response.cases.length === challengeCases.length;
  const failedCases = [];
  for (let index = 0; index < challengeCases.length; index++) {
    const actual = response?.cases?.[index];
    const expected = verificationChallenge.cases[index];
    if (!actual || actual.result !== expected.expected || !Array.isArray(actual.values) || actual.values.length !== expected.values.length || actual.values.some((value, i) => value !== expected.values[i])) failedCases.push(index);
  }
  return { passed: protocolValid && failedCases.length === 0, protocolValid, challengeId, checkedCases: protocolValid ? challengeCases.length : 0, failedCases };
}
async function candidateRun({ candidate, snapshot, outDir, workloadId, limits }) {
  const started = performance.now();
  const overlayManifest = Object.entries(candidate.overlay).map(([path, bytes]) => ({ path, sha256: sha256(bytes), size: Buffer.byteLength(bytes) }));
  const taskId = sha256(stable({ source: snapshot.manifest.digest, workloadId, limits, candidate: { id: candidate.id, overlay: overlayManifest } }));
  const workspacePath = `candidates/${candidate.id}/workspace`;
  const workspace = join(outDir, workspacePath);
  const expected = new Map(snapshot.bytes);
  for (const [path, source] of Object.entries(candidate.overlay)) expected.set(path, Buffer.from(source));
  for (const [path, bytes] of expected) await writeBytes(workspace, path, bytes);
  await mkdir(join(workspace, '.tmp'));
  const copyMs = performance.now() - started;
  const execution = await executePhase({ workspace, outDir, prefix: `candidates/${candidate.id}/execution`, entry: BENCHMARK, limits });
  const verificationStarted = performance.now();
  let verificationWorkspacePath = null;
  let verificationWorkspace = null;
  let verificationCopyMs = 0;
  let verification = { receipt: { outcome: 'not_run', exitCode: null, signal: null, wallMs: 0 }, content: {} };
  if (execution.receipt.outcome === 'passed') {
    const verificationCopyStarted = performance.now();
    verificationWorkspacePath = `candidates/${candidate.id}/verification-workspace`;
    verificationWorkspace = join(outDir, verificationWorkspacePath);
    for (const [path, bytes] of expected) await writeBytes(verificationWorkspace, path, bytes);
    await mkdir(join(verificationWorkspace, '.tmp'));
    verificationCopyMs = performance.now() - verificationCopyStarted;
    verification = await executePhase({ workspace: verificationWorkspace, outDir, prefix: `candidates/${candidate.id}/verification`, entry: VERIFY, limits, input: stable({ ...verificationChallenge, challengeId }) });
  }
  const integrityStarted = performance.now();
  const candidateIntegrity = await verifyWorkspace(workspace, expected);
  const verificationIntegrity = verificationWorkspace ? await verifyWorkspace(verificationWorkspace, expected) : null;
  const integrity = {
    passed: candidateIntegrity.passed && (verificationIntegrity?.passed ?? true),
    changedPaths: [...new Set([...candidateIntegrity.changedPaths, ...(verificationIntegrity?.changedPaths ?? [])])],
    candidate: candidateIntegrity,
    verification: verificationIntegrity
  };
  const integrityMs = performance.now() - integrityStarted;
  const actual = parseJson(execution.content.stdout);
  const verified = parseJson(verification.content.stdout);
  const verificationChecks = checkVerification(verified);
  const outputCorrect = actual?.workload === workloadId && actual.iterations === 200 && actual.length === 10000 && actual.checksum === expectedChecksum;
  const correct = execution.receipt.outcome === 'passed' && verification.receipt.outcome === 'passed' && verificationChecks.passed && outputCorrect && integrity.passed;
  const failure = [execution.receipt, verification.receipt].find(phase => ['timed_out', 'output_limited', 'spawn_failed'].includes(phase.outcome));
  const outcome = correct ? 'passing' : failure?.outcome ?? 'failed';
  const verificationOverheadMs = performance.now() - verificationStarted;
  const result = { id: candidate.id, taskId, workloadId, workspace: workspacePath, verificationWorkspace: verificationWorkspacePath, overlay: overlayManifest, outcome, correct, outputCorrect, integrity, verificationChecks, execution: execution.receipt, verification: verification.receipt, timing: { copyMs, verificationCopyMs, runtimeMs: execution.receipt.wallMs, verificationMs: verification.receipt.wallMs, integrityMs, verificationOverheadMs, wallMs: performance.now() - started } };
  await writeJson(join(outDir, `candidates/${candidate.id}/result.json`), result);
  return result;
}

/** Run allowlisted workloads over a frozen source snapshot. Never modifies or merges source. */
export async function compareCandidates(options) {
  const validated = validate(options);
  const started = performance.now();
  const sourceDir = await realpath(options.sourceDir);
  const outDir = await physicalOutputPath(options.outDir);
  const within = slash(relative(sourceDir, outDir));
  if (within === '' || (!within.startsWith('../') && !within.startsWith('/') && !within.startsWith('.runtime/'))) throw new Error('outDir inside source must be under ignored .runtime/ and must be fresh');
  try { await lstat(outDir); throw new Error('outDir must be fresh; path already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const snapshot = await sourceSnapshot(sourceDir, { allowPublicSource: true });
  await mkdir(dirname(outDir), { recursive: true });
  await mkdir(outDir, { mode: 0o700 });
  for (const [path, bytes] of snapshot.bytes) await writeBytes(join(outDir, 'source'), path, bytes);
  await writeJson(join(outDir, 'source-manifest.json'), snapshot.manifest);
  const snapshotMs = performance.now() - started;
  const { candidates, limits, workloadId } = validated;
  const results = new Array(candidates.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limits.concurrency, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const index = cursor++;
      results[index] = await candidateRun({ candidate: candidates[index], snapshot, outDir, workloadId, limits });
    }
  }));
  const eligible = results.filter(result => result.correct);
  const byTime = [...eligible].sort((a, b) => a.timing.runtimeMs - b.timing.runtimeMs);
  const taskId = sha256(stable({ source: snapshot.manifest.digest, workloadId, limits, candidates: results.map(result => result.taskId) }));
  const report = { schema: 'ngl.forge-report.v1', taskId, createdAt: new Date().toISOString(), workloadId, limits, source: snapshot.manifest, results, comparison: { metric: 'actual child process wall time including Node startup', eligibleCandidateIds: eligible.map(result => result.id), winner: byTime[0]?.id ?? null, speedup: byTime.length >= 2 ? byTime.at(-1).timing.runtimeMs / byTime[0].timing.runtimeMs : null, basis: 'slowest passing candidate / fastest passing candidate for this one local run; no human baseline', verificationRequired: true }, timing: { snapshotMs, wallMs: performance.now() - started, aggregateRuntimeMs: results.reduce((n, r) => n + r.timing.runtimeMs, 0), aggregateVerificationMs: results.reduce((n, r) => n + r.timing.verificationMs, 0), aggregateIntegrityMs: results.reduce((n, r) => n + r.timing.integrityMs, 0), aggregateVerificationOverheadMs: results.reduce((n, r) => n + r.timing.verificationOverheadMs, 0) }, limitations: ['Trusted local Node processes, not an adversarial OS sandbox; same host user and network access.', 'Output capture, time, V8 heap and cooperative process-group cleanup are bounded; disk usage and hostile process escape are not sandboxed.', 'Credential filename filtering and a minimal child environment do not identify secrets embedded in ordinary source files.', 'Single-run wall-clock comparison is affected by startup, scheduling and concurrent host activity; no human productivity claim.', 'Source and candidates are retained for review; no automatic merge, publication or authority expansion.'] };
  await writeJson(join(outDir, 'report.json'), report);
  return report;
}

export async function runCandidate({ candidate, ...options }) {
  return compareCandidates({ ...options, candidates: [candidate] });
}

function repositoryLimits(input = {}) {
  exactKeys(input, Object.keys(REPOSITORY_DEFAULTS), 'limits');
  const limits = { ...REPOSITORY_DEFAULTS, ...input };
  for (const [key, min, max] of [['timeoutMs', 50, 120000], ['maxOutputBytes', 1024, 1048576], ['concurrency', 1, 4]]) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < min || limits[key] > max) throw new Error(`Invalid repository ${key} limit: ${min}..${max}`);
  }
  return limits;
}
function repositoryTestPaths(files) {
  return files.map(file => file.path).filter(path => path === 'genesis.test.mjs' || /^(?:test|reconstitution)\/[^/]+\.test\.(?:js|mjs)$/.test(path) && !/^test\/forge-runner\.test\.(?:js|mjs)$/.test(path)).sort();
}
function readTap(stdout) {
  const counts = { tests: 0, suites: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
  const labels = { tests: 'tests', suites: 'suites', passed: 'pass', failed: 'fail', cancelled: 'cancelled', skipped: 'skipped', todo: 'todo' };
  let summaryPresent = true;
  for (const [key, label] of Object.entries(labels)) {
    const matches = [...stdout.matchAll(new RegExp(`^# ${label} (\\d+)\\r?$`, 'gm'))];
    if (!matches.length) summaryPresent = false;
    else counts[key] = Number(matches.at(-1)[1]);
  }
  const failures = stdout.split(/\r?\n/).filter(line => /^\s*not ok(?:\s|$)/.test(line)).slice(0, 256);
  const complete = summaryPresent && counts.tests === counts.passed + counts.failed + counts.cancelled + counts.skipped + counts.todo;
  return { counts, failures, summaryPresent, complete };
}

/** Execute only explicit allowlisted repository tests in a frozen copy, without overlays. */
export async function verifyRepository(options) {
  exactKeys(options, ['sourceDir', 'outDir', 'limits'], 'repository request');
  if (typeof options.sourceDir !== 'string' || typeof options.outDir !== 'string') throw new Error('sourceDir and a fresh outDir are required');
  const limits = repositoryLimits(options.limits);
  const started = performance.now();
  const sourceDir = await realpath(options.sourceDir);
  const outDir = await physicalOutputPath(options.outDir);
  const within = slash(relative(sourceDir, outDir));
  if (within === '' || (!within.startsWith('../') && !within.startsWith('/') && !within.startsWith('.runtime/'))) throw new Error('outDir inside source must be under ignored .runtime/ and must be fresh');
  try { await lstat(outDir); throw new Error('outDir must be fresh; path already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let snapshot = null;
  let sourceError = null;
  try { snapshot = await sourceSnapshot(sourceDir, { requiredFiles: [], allowPublicSource: true }); }
  catch (error) { sourceError = error.message; }
  await mkdir(dirname(outDir), { recursive: true });
  await mkdir(outDir, { mode: 0o700 });
  if (snapshot) {
    for (const [path, bytes] of snapshot.bytes) await writeBytes(join(outDir, 'source'), path, bytes);
    await writeJson(join(outDir, 'source-manifest.json'), snapshot.manifest);
  }
  const snapshotMs = performance.now() - started;
  const paths = snapshot ? repositoryTestPaths(snapshot.manifest.files) : [];
  const workloadId = 'repository-tests-v1';
  const taskId = sha256(stable({ workloadId, source: snapshot?.manifest.digest ?? null, sourceError, paths, limits }));
  let execution = { receipt: { outcome: 'not_run', exitCode: null, signal: null, wallMs: 0 }, content: { stdout: '', stderr: '' } };
  let integrity = { passed: false, changedPaths: [] };
  let copyMs = 0;
  let integrityMs = 0;
  let verificationOverheadMs = 0;
  let tests = { paths, ...readTap('') };
  if (snapshot) {
    const copyStarted = performance.now();
    for (const [path, bytes] of snapshot.bytes) await writeBytes(join(outDir, 'workspace'), path, bytes);
    await mkdir(join(outDir, 'workspace/.tmp'));
    copyMs = performance.now() - copyStarted;
    const verificationStarted = performance.now();
    if (paths.length) execution = await executePhase({ workspace: join(outDir, 'workspace'), outDir, prefix: 'verification', limits, phaseArgs: ['--test', '--test-reporter=tap', `--test-concurrency=${limits.concurrency}`, ...paths] });
    const integrityStarted = performance.now();
    integrity = await verifyWorkspace(join(outDir, 'workspace'), snapshot.bytes);
    integrityMs = performance.now() - integrityStarted;
    tests = { paths, ...readTap(execution.content.stdout) };
    verificationOverheadMs = performance.now() - verificationStarted - execution.receipt.wallMs;
  }
  const correct = snapshot !== null && integrity.passed && execution.receipt.outcome === 'passed' && tests.complete && tests.counts.tests > 0 && tests.counts.passed > 0 && tests.counts.failed === 0 && tests.counts.cancelled === 0;
  const boundedFailure = ['timed_out', 'output_limited', 'spawn_failed'].includes(execution.receipt.outcome) ? execution.receipt.outcome : null;
  const outcome = sourceError || snapshot && !integrity.passed ? 'source_failed' : correct ? 'passing' : boundedFailure ?? 'failed';
  const reason = sourceError ?? (!integrity.passed ? 'Copied source bytes changed during verification' : !paths.length ? 'No allowlisted repository test files' : !tests.complete ? 'TAP summary missing or incomplete' : tests.counts.passed === 0 ? 'No passing tests executed' : correct ? 'Explicit repository tests passed and copied source bytes are intact' : 'Repository verification did not pass');
  const report = { schema: 'ngl.forge-repository-report.v1', taskId, workloadId, createdAt: new Date().toISOString(), limits, source: snapshot?.manifest ?? null, sourceError, workspace: snapshot ? 'workspace' : null, outcome, correct, reason, tests, execution: execution.receipt, integrity, timing: { snapshotMs, copyMs, runtimeMs: execution.receipt.wallMs, integrityMs, verificationOverheadMs, wallMs: performance.now() - started }, limitations: ['Trusted repository tests execute as the host user; copied workspaces are not an adversarial OS sandbox.', 'Only direct test/*.test.js, test/*.test.mjs, genesis.test.mjs and reconstitution/*.test.js|mjs files are selected; Forge runner tests are excluded to avoid recursive copying.', 'TAP exit status, nonzero executed/passing counts and copied source integrity are required; logs retain bounded actual output.', 'Public-source snapshots have no Git history and use fixed public roots/extensions rather than claiming Git-ignore evaluation.', 'Runtime, source-copy cost and verification overhead are local wall-clock measurements, not a human productivity baseline.', 'No merge, deployment, provider call, authority expansion or publication is performed.'] };
  await writeJson(join(outDir, 'report.json'), report);
  return report;
}
