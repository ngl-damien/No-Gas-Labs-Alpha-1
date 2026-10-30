import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);
const repository = resolve(import.meta.dirname, '..');
const target = 'fixtures/forge/workload/candidate.mjs';
const correct = 'export function sum(values) { let total = 0; for (const value of values) total += value; return total; }\n';
const wrong = 'export function sum() { return 0; }\n';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ngl-forge-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = join(root, 'source');
  await mkdir(sourceDir);
  await cp(join(repository, 'fixtures/forge'), join(sourceDir, 'fixtures/forge'), { recursive: true });
  await writeFile(join(sourceDir, 'README.md'), 'constitutional original\n');
  await writeFile(join(sourceDir, '.gitignore'), '.runtime/\nignored.txt\n');
  await exec('git', ['init', '-q'], { cwd: sourceDir });
  await exec('git', ['add', '.'], { cwd: sourceDir });
  await exec('git', ['-c', 'user.name=Forge Test', '-c', 'user.email=forge@example.invalid', 'commit', '-qm', 'fixture'], { cwd: sourceDir });
  return { sourceDir, outDir: join(root, 'out') };
}
const api = () => import('../src/forge/runner.mjs');

test('Forge runs actual correct and incorrect candidates in disjoint copies and retains verifiable evidence', async t => {
  const options = await fixture(t);
  const before = await readFile(join(options.sourceDir, target));
  const { compareCandidates } = await api();
  const report = await compareCandidates({ ...options, candidates: [{ id: 'correct', overlay: { [target]: correct } }, { id: 'wrong', overlay: { [target]: wrong } }] });
  assert.equal(report.schema, 'ngl.forge-report.v1');
  assert.equal(report.results[0].outcome, 'passing');
  assert.equal(report.results[0].correct, true);
  assert.equal(report.results[1].outcome, 'failed');
  assert.equal(report.results[1].correct, false);
  assert.ok(report.results[1].verification.exitCode !== 0);
  assert.notEqual(report.results[0].workspace, report.results[1].workspace);
  assert.deepEqual(await readFile(join(options.sourceDir, target)), before);
  assert.deepEqual(report.comparison.eligibleCandidateIds, ['correct']);
  assert.equal(report.comparison.speedup, null);
  for (const result of report.results) {
    assert.ok(result.timing.runtimeMs > 0);
    assert.ok(result.timing.verificationMs > 0);
    assert.ok(result.timing.wallMs >= result.timing.runtimeMs + result.timing.verificationMs);
    assert.ok(result.execution.pid > 0);
    const bytes = await readFile(join(options.outDir, result.execution.stdout.path));
    assert.equal(hash(bytes), result.execution.stdout.sha256);
    assert.ok((await readFile(join(options.outDir, result.workspace, target), 'utf8')).includes(result.id === 'correct' ? 'let total' : 'return 0'));
  }
  const manifest = JSON.parse(await readFile(join(options.outDir, 'source-manifest.json'), 'utf8'));
  assert.match(manifest.revision.head, /^[a-f0-9]{40,64}$/);
  const source = manifest.files.find(file => file.path === target);
  assert.equal(hash(await readFile(join(options.outDir, 'source', target))), source.sha256);
  assert.equal(JSON.parse(await readFile(join(options.outDir, 'report.json'), 'utf8')).taskId, report.taskId);
});

test('Forge enforces real child timeout and output limits with retained bounded logs', async t => {
  const options = await fixture(t);
  const { compareCandidates } = await api();
  const report = await compareCandidates({ ...options, limits: { timeoutMs: 500, maxOutputBytes: 1024, concurrency: 2 }, candidates: [
    { id: 'timeout', overlay: { [target]: 'export function sum() { while (true) {} }' } },
    { id: 'noisy', overlay: { [target]: 'process.stdout.write("x".repeat(8192)); export function sum() { return 0; }' } }
  ] });
  assert.equal(report.results[0].outcome, 'timed_out');
  assert.equal(report.results[0].correct, false);
  assert.equal(report.results[0].execution.signal, 'SIGKILL');
  assert.equal(report.results[0].verification.outcome, 'not_run');
  assert.equal(report.results[1].outcome, 'output_limited');
  assert.ok(report.results[1].execution.stdout.size + report.results[1].execution.stderr.size <= 1024);
  assert.equal(report.comparison.winner, null);
});

test('Forge rejects protected paths, traversal, arbitrary commands and unbounded requests before creating outputs', async t => {
  const options = await fixture(t);
  const { compareCandidates } = await api();
  for (const path of ['README.md', 'core.mjs', 'evidence.mjs', 'authority/new.mjs', 'src/institution/kernel.mjs', 'test/new.mjs', '../escape.mjs', '/tmp/escape.mjs', 'fixtures/forge/workload/verify.mjs']) {
    await assert.rejects(compareCandidates({ ...options, candidates: [{ id: 'bad', overlay: { [path]: 'bad' } }] }), /overlay|allowlist|path/i);
  }
  await assert.rejects(compareCandidates({ ...options, workloadId: 'shell', candidates: [{ id: 'bad', overlay: {} }] }), /workload/i);
  await assert.rejects(compareCandidates({ ...options, candidates: [{ id: 'bad', command: ['sh', '-c', 'touch nope'], overlay: {} }] }), /field|command/i);
  await assert.rejects(compareCandidates({ ...options, candidates: [{ id: 'bad', overlay: {} }], limits: { concurrency: 99 } }), /concurrency|limit/i);
  await assert.rejects(access(options.outDir));
});

test('Forge rejects sparse and accessor-backed candidate inputs before creating outputs', async t => {
  const options = await fixture(t);
  const { compareCandidates } = await api();
  await assert.rejects(compareCandidates({ ...options, candidates: new Array(1) }), /dense|candidate/i);
  await assert.rejects(access(options.outDir));
  let getterInvoked = false;
  const overlay = {};
  Object.defineProperty(overlay, target, { enumerable: true, get() { getterInvoked = true; return correct; } });
  const accessorOut = options.outDir + '-accessor';
  await assert.rejects(compareCandidates({ ...options, outDir: accessorOut, candidates: [{ id: 'accessor', overlay }] }), /data|overlay/i);
  assert.equal(getterInvoked, false);
  await assert.rejects(access(accessorOut));
});
test('Forge snapshots tracked and nonignored source bytes, omits runtime and credentials, refuses symlinks', async t => {
  const options = await fixture(t);
  await writeFile(join(options.sourceDir, 'ignored.txt'), 'ignored runtime');
  await mkdir(join(options.sourceDir, '.runtime'));
  await writeFile(join(options.sourceDir, '.runtime/session.json'), 'secret runtime');
  await mkdir(join(options.sourceDir, '.tmp'));
  await writeFile(join(options.sourceDir, '.tmp/scratch.mjs'), 'temporary workspace file');
  await writeFile(join(options.sourceDir, '.env'), 'SECRET=not-copied');
  await writeFile(join(options.sourceDir, 'identity.key'), 'not-copied');
  await writeFile(join(options.sourceDir, 'new-source.mjs'), 'export const dirty = true;');
  const { compareCandidates } = await api();
  const report = await compareCandidates({ ...options, candidates: [{ id: 'correct', overlay: { [target]: correct } }] });
  assert.equal(report.results[0].outcome, 'passing');
  assert.equal(report.source.revision.dirty, true);
  const paths = report.source.files.map(file => file.path);
  assert.ok(paths.includes('new-source.mjs'));
  assert.ok(!paths.some(path => /ignored|runtime|\.env|identity\.key/.test(path)));
  assert.ok(!paths.some(path => path.startsWith('.tmp/')));
  await symlink('/etc/passwd', join(options.sourceDir, 'linked-source'));
  await assert.rejects(compareCandidates({ ...options, outDir: options.outDir + '-symlink', candidates: [{ id: 'correct', overlay: {} }] }), /symbolic|symlink/i);
});

test('Forge task identities are deterministic for source bytes and overlays and compares only correct candidates', async t => {
  const options = await fixture(t);
  const { compareCandidates } = await api();
  const candidates = [{ id: 'loop', overlay: { [target]: correct } }, { id: 'reduce', overlay: { [target]: 'export const sum = values => values.reduce((a, b) => a + b, 0);\n' } }];
  const first = await compareCandidates({ ...options, candidates });
  const second = await compareCandidates({ ...options, outDir: options.outDir + '-again', candidates });
  assert.equal(first.taskId, second.taskId);
  assert.deepEqual(first.results.map(r => r.taskId), second.results.map(r => r.taskId));
  assert.deepEqual(first.comparison.eligibleCandidateIds, ['loop', 'reduce']);
  assert.ok(first.comparison.speedup >= 1);
  assert.ok(['loop', 'reduce'].includes(first.comparison.winner));
  await assert.rejects(compareCandidates({ ...options, candidates }), /exist|fresh/i);
});

test('Forge verification uses a fresh copy and cannot inherit files created only during candidate execution', async t => {
  const options = await fixture(t);
  const { compareCandidates } = await api();
  const overlay = [
    "import { writeFileSync } from 'node:fs';",
    "if (process.argv[1].endsWith('/benchmark.mjs')) {",
    "  writeFileSync(new URL('./helper.mjs', import.meta.url), 'export const sum = values => values.reduce((a, b) => a + b, 0);');",
    "}",
    "const { sum } = await import('./helper.mjs');",
    "export { sum };"
  ].join('\n');
  const report = await compareCandidates({ ...options, candidates: [{ id: 'execution-only-helper', overlay: { [target]: overlay } }] });
  const result = report.results[0];
  assert.equal(result.execution.outcome, 'passed');
  assert.equal(result.verification.outcome, 'failed');
  assert.equal(result.correct, false);
  assert.equal(result.outcome, 'failed');
  assert.equal(result.verificationWorkspace, 'candidates/execution-only-helper/verification-workspace');
  assert.notEqual(result.verificationWorkspace, result.workspace);
  assert.equal(result.integrity.passed, false);
  assert.ok(result.integrity.changedPaths.includes('fixtures/forge/workload/helper.mjs'));
  assert.deepEqual(result.integrity.verification.changedPaths, []);
});
test('Forge CLI demo executes fixture candidates and writes a report without a shell', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ngl-forge-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = join(root, 'report');
  const { stdout } = await exec(process.execPath, [join(repository, 'scripts/forge.mjs'), 'demo', '--out', out], { cwd: repository, timeout: 15000 });
  const report = JSON.parse(await readFile(join(out, 'report.json'), 'utf8'));
  assert.deepEqual(report.results.map(result => result.outcome), ['passing', 'failed', 'timed_out']);
  assert.equal(JSON.parse(stdout).taskId, report.taskId);
});

test('Forge rejects a candidate that changes copied constitutional bytes and strips inherited secret variables', async t => {
  const options = await fixture(t);
  const { compareCandidates } = await api();
  const previous = process.env.FORGE_PRIVATE_TEST_TOKEN;
  process.env.FORGE_PRIVATE_TEST_TOKEN = 'must-not-reach-child';
  t.after(() => { if (previous === undefined) delete process.env.FORGE_PRIVATE_TEST_TOKEN; else process.env.FORGE_PRIVATE_TEST_TOKEN = previous; });
  const source = `import { writeFileSync } from 'node:fs';
writeFileSync('.tmp/environment.json', JSON.stringify({ inheritedSecret: process.env.FORGE_PRIVATE_TEST_TOKEN ?? null }));
writeFileSync('README.md', 'modified in copied workspace');
${correct}`;
  const report = await compareCandidates({ ...options, candidates: [{ id: 'tamper', overlay: { [target]: source } }] });
  assert.equal(report.results[0].execution.outcome, 'passed');
  assert.equal(report.results[0].verification.outcome, 'passed');
  assert.equal(report.results[0].correct, false);
  assert.equal(report.results[0].outcome, 'failed');
  assert.deepEqual(report.results[0].integrity.changedPaths, ['README.md']);
  assert.equal(await readFile(join(options.sourceDir, 'README.md'), 'utf8'), 'constitutional original\n');
  const environment = JSON.parse(await readFile(join(options.outDir, report.results[0].workspace, '.tmp/environment.json'), 'utf8'));
  assert.equal(environment.inheritedSecret, null);
  assert.ok(report.results[0].timing.verificationOverheadMs >= report.results[0].timing.verificationMs + report.results[0].timing.integrityMs);
});

test('Forge excludes tracked ignored files and common credential configuration names from every copy', async t => {
  const options = await fixture(t);
  await writeFile(join(options.sourceDir, '.npmrc'), 'registry token credential');
  await writeFile(join(options.sourceDir, '.envrc'), 'export PRIVATE_TOKEN=credential');
  await writeFile(join(options.sourceDir, 'ignored.txt'), 'tracked ignored credential');
  await exec('git', ['add', '-f', 'ignored.txt'], { cwd: options.sourceDir });
  const { compareCandidates } = await api();
  const report = await compareCandidates({ ...options, candidates: [{ id: 'correct', overlay: {} }] });
  const paths = report.source.files.map(file => file.path);
  for (const path of ['.npmrc', '.envrc', 'ignored.txt']) assert.ok(!paths.includes(path), `${path} must not be copied`);
});

test('Forge excludes common local credential stores and private-key files from every copy', async t => {
  const options = await fixture(t);
  const credentialFiles = {
    '.git-credentials': 'https://user:token@github.com\\n',
    '.docker/config.json': '{"auths":{"registry":{"auth":"secret"}}}',
    '.kube/config': 'users: [private-token]',
    '.azure/azureProfile.json': '{"accessTokens":["secret"]}',
    '.gnupg/private-keys-v1.d/key': 'private-key-bytes',
    '.terraform/terraform.tfstate': '{"secret":"state-token"}',
    '.terraform.d/credentials.tfrc.json': '{"credentials":{"registry":{"token":"secret"}}}',
    '.config/gh/hosts.yml': 'github.com: oauth_token: secret',
    '.config/hub': 'github.com: token secret',
    '.config/gcloud/application_default_credentials.json': '{"refresh_token":"secret"}',
    '.config/containers/auth.json': '{"auths":{"registry":{"auth":"secret"}}}',
    '.config/git/credentials': 'https://user:secret@example.invalid',
    'id_ecdsa': 'private-key',
    'id_dsa': 'private-key',
    'id_ed25519_sk': 'private-key',
    '.vault-token': 'secret-token',
    'application_default_credentials.json': '{"refresh_token":"secret"}',
    'google_application_credentials.json': '{"private_key":"secret"}',
    'service-account-production.json': '{"private_key":"secret"}',
    'terraform.tfstate': '{"secret":"state-token"}'
  };
  await repositoryTestFiles(options.sourceDir, credentialFiles);
  const { compareCandidates } = await api();
  const report = await compareCandidates({ ...options, candidates: [{ id: 'correct', overlay: {} }] });
  const included = new Set(report.source.files.map(file => file.path));
  const copiedWorkspace = join(options.outDir, report.results[0].workspace);
  for (const path of Object.keys(credentialFiles)) {
    assert.ok(!included.has(path), `${path} must be excluded from the source manifest`);
    await assert.rejects(access(join(copiedWorkspace, path)), { code: 'ENOENT' }, `${path} must not reach candidate execution`);
  }
  assert.ok(included.has('README.md'), 'ordinary public source remains available');
});

test('Forge rejects recognizable embedded credentials before candidate copying or repository test execution', async t => {
  const options = await fixture(t);
  const file = 'src/embedded-credential.mjs';
  const { compareCandidates, verifyRepository } = await api();
  const githubToken = 'ghp_' + 'A'.repeat(36);
  await repositoryTestFiles(options.sourceDir, { [file]: 'export const token = ' + JSON.stringify(githubToken) + ';\\n' });
  let failure;
  try {
    await compareCandidates({ ...options, candidates: [{ id: 'correct', overlay: {} }] });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /Credential-like content detected in source file: src\\/embedded-credential\\.mjs \\(github-token\\)/);
  assert.equal(failure.message.includes(githubToken), false, 'errors must not echo matched credential bytes');
  await assert.rejects(access(options.outDir), { code: 'ENOENT' }, 'candidate workspace must not be created');

  await rm(join(options.sourceDir, file));
  const privateKeyBlock = ['-----BEGIN ', 'PRIVATE KEY-----'].join('') + '\\nredacted-test-fixture\\n';
  await repositoryTestFiles(options.sourceDir, { [file]: 'export const key = ' + JSON.stringify(privateKeyBlock) + ';\\n' });
  const report = await verifyRepository({ ...options, outDir: options.outDir + '-verify' });
  assert.equal(report.outcome, 'source_failed');
  assert.equal(report.correct, false);
  assert.match(report.reason, /Credential-like content detected.*private-key-block/);
  await assert.rejects(access(join(options.outDir + '-verify', 'workspace')), { code: 'ENOENT' }, 'repository tests must not receive a copied workspace');
});
test('Forge parent rejects wrong per-case results even when candidate disables shared assertions and mutates serializers', async t => {
  const options = await fixture(t);
  const { compareCandidates } = await api();
  const patched = `import assert from 'node:assert/strict';
assert.equal = () => {};
assert.deepEqual = () => {};
if (process.argv[1].endsWith('verify.mjs')) {
  JSON.stringify = () => '{"verified":true,"cases":7}';
  Array.prototype.toJSON = () => [1];
}
export function sum(values) { return values.length === 10000 ? values.reduce((total, value) => total + value, 0) : 0; }`;
  const report = await compareCandidates({ ...options, candidates: [{ id: 'patched-checks', overlay: { [target]: patched } }] });
  assert.equal(report.results[0].correct, false);
  assert.equal(report.results[0].outcome, 'failed');
  assert.deepEqual(report.comparison.eligibleCandidateIds, []);
  assert.equal(report.results[0].verificationChecks.passed, false);
  assert.ok(report.results[0].verificationChecks.failedCases.includes(1));
});

test('Forge resolves output ancestor symlinks before guarding source writes and accepts physical ignored runtime outputs', async t => {
  const options = await fixture(t);
  const { compareCandidates } = await api();
  const alias = join(options.sourceDir, '..', 'alias');
  await symlink(options.sourceDir, alias);
  await assert.rejects(compareCandidates({ ...options, outDir: join(alias, 'unguarded-output'), candidates: [{ id: 'correct', overlay: {} }] }), /outDir.*source|physical|runtime/i);
  await assert.rejects(access(join(options.sourceDir, 'unguarded-output')));
  const runtime = await compareCandidates({ ...options, outDir: join(alias, '.runtime', 'forge', 'accepted'), candidates: [{ id: 'correct', overlay: {} }] });
  assert.equal(runtime.results[0].correct, true);
  assert.equal(JSON.parse(await readFile(join(options.sourceDir, '.runtime/forge/accepted/report.json'), 'utf8')).taskId, runtime.taskId);
});

async function repositoryTestFiles(sourceDir, files) {
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(sourceDir, path, '..'), { recursive: true });
    await writeFile(join(sourceDir, path), contents);
  }
}

test('Repository Forge executes explicit copied tests and retains actual TAP counts without recursive Forge discovery', async t => {
  const options = await fixture(t);
  await repositoryTestFiles(options.sourceDir, {
    'core.mjs': 'export const add = (a, b) => a + b;\n',
    'test/math.test.mjs': `import test from 'node:test'; import assert from 'node:assert/strict'; import { add } from '../core.mjs'; test('actual addition', () => assert.equal(add(2, 3), 5)); test('signed addition', () => assert.equal(add(-2, 3), 1));`,
    'test/forge-runner.test.mjs': 'throw new Error("recursive Forge must not be executed");',
    'fixtures/forge/workload/ignored.test.mjs': 'throw new Error("fixture discovery must not occur");',
    'genesis.test.mjs': `import assert from 'node:assert/strict'; assert.equal(1 + 1, 2);`,
    'reconstitution/check.test.mjs': `import test from 'node:test'; test('retained reconstitution', () => {});`
  });
  const { verifyRepository } = await api();
  assert.equal(typeof verifyRepository, 'function');
  const report = await verifyRepository(options);
  assert.equal(report.schema, 'ngl.forge-repository-report.v1');
  assert.equal(report.outcome, 'passing');
  assert.equal(report.correct, true);
  assert.deepEqual(report.tests.paths, ['genesis.test.mjs', 'reconstitution/check.test.mjs', 'test/math.test.mjs']);
  assert.equal(report.tests.counts.tests, 4);
  assert.equal(report.tests.counts.passed, 4);
  assert.equal(report.tests.counts.failed, 0);
  assert.equal(report.execution.exitCode, 0);
  assert.ok(report.execution.args.includes('--test-reporter=tap'));
  assert.ok(report.timing.runtimeMs > 0);
  assert.ok(report.timing.verificationOverheadMs >= report.timing.integrityMs);
  assert.equal(report.integrity.passed, true);
  assert.equal(await readFile(join(options.sourceDir, 'README.md'), 'utf8'), 'constitutional original\n');
  assert.equal(hash(await readFile(join(options.outDir, report.execution.stdout.path))), report.execution.stdout.sha256);
  assert.equal(JSON.parse(await readFile(join(options.outDir, 'report.json'), 'utf8')).taskId, report.taskId);
});

test('Repository Forge records real test failures and rejects copied source mutation even after passing assertions', async t => {
  const options = await fixture(t);
  await repositoryTestFiles(options.sourceDir, { 'test/failing.test.mjs': `import test from 'node:test'; import assert from 'node:assert/strict'; test('math deliberately fails', () => assert.equal(2 + 2, 5));` });
  const { verifyRepository } = await api();
  assert.equal(typeof verifyRepository, 'function');
  const failed = await verifyRepository(options);
  assert.equal(failed.outcome, 'failed');
  assert.equal(failed.correct, false);
  assert.equal(failed.tests.counts.failed, 1);
  assert.ok(failed.execution.exitCode !== 0);
  assert.ok(failed.tests.failures.some(failure => failure.includes('math deliberately fails')));
  await writeFile(join(options.sourceDir, 'test/failing.test.mjs'), `import test from 'node:test'; import { writeFileSync } from 'node:fs'; test('passing assertion changes copied source', () => writeFileSync('README.md', 'mutated workspace'));`);
  const mutated = await verifyRepository({ ...options, outDir: options.outDir + '-mutation' });
  assert.equal(mutated.execution.exitCode, 0);
  assert.equal(mutated.outcome, 'source_failed');
  assert.deepEqual(mutated.integrity.changedPaths, ['README.md']);
  assert.equal(await readFile(join(options.sourceDir, 'README.md'), 'utf8'), 'constitutional original\n');
});

test('Repository Forge enforces timeout, rejects arbitrary commands and does not claim a zero-test run', async t => {
  const options = await fixture(t);
  const { verifyRepository } = await api();
  assert.equal(typeof verifyRepository, 'function');
  await assert.rejects(verifyRepository({ ...options, command: ['sh', '-c', 'true'] }), /field|command/i);
  const empty = await verifyRepository(options);
  assert.equal(empty.outcome, 'failed');
  assert.equal(empty.correct, false);
  assert.equal(empty.tests.counts.tests, 0);
  assert.equal(empty.execution.outcome, 'not_run');
  await repositoryTestFiles(options.sourceDir, { 'test/slow.test.mjs': `import test from 'node:test'; test('nonterminating fixture', () => { while (true) {} });` });
  const timeout = await verifyRepository({ ...options, outDir: options.outDir + '-timeout', limits: { timeoutMs: 300, maxOutputBytes: 65536, concurrency: 1 } });
  assert.equal(timeout.outcome, 'timed_out');
  assert.equal(timeout.correct, false);
  assert.equal(timeout.execution.signal, 'SIGKILL');
  assert.ok(timeout.timing.runtimeMs >= 300);
});

test('Repository Forge supports bounded public-source packages without fabricating Git history', async t => {
  const options = await fixture(t);
  await rm(join(options.sourceDir, '.git'), { recursive: true, force: true });
  await repositoryTestFiles(options.sourceDir, {
    'test/package.test.mjs': `import test from 'node:test'; import assert from 'node:assert/strict'; test('public package test', () => assert.equal(3 * 3, 9));`,
    'private/credential.json': '{"must":"not be copied"}',
    '.runtime/session.json': '{"must":"not be copied"}',
    'game/operator.key': 'must not be copied',
    'service-account-production.json': '{"private_key":"must not be copied"}',
    'application_default_credentials.json': '{"refresh_token":"must not be copied"}',
    'google_application_credentials.json': '{"private_key":"must not be copied"}',
    'docs/meteor/notes.md': 'Public build notes'
  });
  const { verifyRepository } = await api();
  assert.equal(typeof verifyRepository, 'function');
  const report = await verifyRepository(options);
  assert.equal(report.outcome, 'passing');
  assert.equal(report.source.snapshotMode, 'public-source');
  assert.equal(report.source.revision.head, null);
  assert.equal(report.source.revision.dirty, null);
  const paths = report.source.files.map(file => file.path);
  assert.ok(paths.includes('docs/meteor/notes.md'));
  assert.ok(!paths.some(path => /private|runtime|operator\.key|service-account|application_default_credentials|google_application_credentials/.test(path)));
});

test('Repository Forge CLI verifies only a disposable repository fixture and preserves failure exit status', async t => {
  const options = await fixture(t);
  await repositoryTestFiles(options.sourceDir, { 'test/cli.test.mjs': `import test from 'node:test'; import assert from 'node:assert/strict'; test('CLI fixture succeeds', () => assert.equal(4, 4));` });
  await mkdir(join(options.sourceDir, 'src/forge'), { recursive: true });
  await mkdir(join(options.sourceDir, 'scripts'), { recursive: true });
  await cp(join(repository, 'src/forge/runner.mjs'), join(options.sourceDir, 'src/forge/runner.mjs'));
  await cp(join(repository, 'scripts/forge.mjs'), join(options.sourceDir, 'scripts/forge.mjs'));
  const command = [join(options.sourceDir, 'scripts/forge.mjs'), 'verify', '--out', options.outDir];
  const { stdout } = await exec(process.execPath, command, { cwd: options.sourceDir, timeout: 10000 });
  assert.equal(JSON.parse(stdout).outcome, 'passing');
  assert.equal(JSON.parse(await readFile(join(options.outDir, 'report.json'), 'utf8')).tests.counts.passed, 1);
  await writeFile(join(options.sourceDir, 'test/cli.test.mjs'), `import test from 'node:test'; import assert from 'node:assert/strict'; test('CLI fixture fails', () => assert.equal(4, 5));`);
  await assert.rejects(exec(process.execPath, [command[0], 'verify', '--out', options.outDir + '-failed'], { cwd: options.sourceDir, timeout: 10000 }), error => error.code === 1 && JSON.parse(error.stdout).outcome === 'failed');
});

test('Repository Forge reports snapshot errors explicitly and rejects skipped-only execution', async t => {
  const options = await fixture(t);
  await repositoryTestFiles(options.sourceDir, { 'test/skip.test.mjs': `import test from 'node:test'; test.skip('not an executed check', () => {});` });
  const { verifyRepository } = await api();
  const skipped = await verifyRepository(options);
  assert.equal(skipped.execution.exitCode, 0);
  assert.equal(skipped.tests.counts.skipped, 1);
  assert.equal(skipped.tests.counts.passed, 0);
  assert.equal(skipped.correct, false);
  assert.equal(skipped.outcome, 'failed');
  await symlink('/etc/passwd', join(options.sourceDir, 'linked-source'));
  const sourceFailed = await verifyRepository({ ...options, outDir: options.outDir + '-source-error' });
  assert.equal(sourceFailed.outcome, 'source_failed');
  assert.equal(sourceFailed.execution.outcome, 'not_run');
  assert.equal(sourceFailed.source, null);
  assert.match(sourceFailed.sourceError, /symbolic|symlink/i);
});

test('Forge comparison and copied CLI demo execute Gitless public-source packages with null revision', async t => {
  const options = await fixture(t);
  await mkdir(join(options.sourceDir, 'src/forge'), { recursive: true });
  await mkdir(join(options.sourceDir, 'scripts'), { recursive: true });
  await cp(join(repository, 'src/forge/runner.mjs'), join(options.sourceDir, 'src/forge/runner.mjs'));
  await cp(join(repository, 'scripts/forge.mjs'), join(options.sourceDir, 'scripts/forge.mjs'));
  await rm(join(options.sourceDir, '.git'), { recursive: true, force: true });
  const { compareCandidates } = await api();
  const report = await compareCandidates({ ...options, candidates: [{ id: 'correct', overlay: {} }] });
  assert.equal(report.results[0].outcome, 'passing');
  assert.equal(report.source.snapshotMode, 'public-source');
  assert.equal(report.source.revision.head, null);
  assert.equal(report.source.revision.dirty, null);
  const cliOut = options.outDir + '-cli';
  const { stdout } = await exec(process.execPath, [join(options.sourceDir, 'scripts/forge.mjs'), 'demo', '--out', cliOut], { cwd: options.sourceDir, timeout: 10000 });
  const cliReport = JSON.parse(await readFile(join(cliOut, 'report.json'), 'utf8'));
  assert.deepEqual(cliReport.results.map(result => result.outcome), ['passing', 'failed', 'timed_out']);
  assert.equal(cliReport.source.revision.head, null);
  assert.equal(JSON.parse(stdout).taskId, cliReport.taskId);
});

test('Forge does not disguise corrupt Git metadata as a public-source package', async t => {
  const options = await fixture(t);
  await rm(join(options.sourceDir, '.git'), { recursive: true, force: true });
  await writeFile(join(options.sourceDir, '.git'), 'this is invalid Git metadata\n');
  const { compareCandidates } = await api();
  await assert.rejects(compareCandidates({ ...options, candidates: [{ id: 'correct', overlay: {} }] }), /git|invalid/i);
  await assert.rejects(access(options.outDir));
});
