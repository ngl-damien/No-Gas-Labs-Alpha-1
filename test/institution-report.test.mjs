import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// The override permits the documented, temporary type-only candidate comparison.
const {projectProjection} = await import(process.env.NGL_REPORT_PROJECTION_CANDIDATE ?? '../src/institution/project-projection.mjs');
const retained = JSON.parse(await readFile(new URL('../docs/institution/compounding/evidence/experiment.json', import.meta.url), 'utf8'));
const initial = JSON.parse(await readFile(new URL('../docs/institution/compounding/evidence/experiment-initial.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(retained);

test('both retained reports remain usable without making execution or authority claims', () => {
  for (const report of [retained, initial]) {
    const before = JSON.stringify(report);
    const projection = projectProjection(report);
    assert.equal(projection.projects[0].status, 'TRANSFER_OBSERVED_COMPONENT_DELIVERY');
    assert.deepEqual(projection.accomplishments.map(item => item.status), ['LOCALLY_TESTED', 'LOCALLY_TESTED']);
    assert.equal(projection.witnessParticipation, 'UNVERIFIED');
    assert.equal(projection.decisions[0].clockStarted, false);
    assert.match(projection.limitations.join(' '), /no XP, promotion or authority/);
    assert.match(projection.accomplishments[0].limitation, /report consistency.*not independent verification/i);
    assert.equal(JSON.stringify(report), before);
  }
});

test('a consistent INCONCLUSIVE report can retain failed executions and zero tests', () => {
  const report = clone();
  report.classification = 'INCONCLUSIVE';
  report.sourceIntegrity = false;
  for (const task of Object.values(report.tasks)) {
    Object.assign(task.m1, {accepted: false, integrity: false, matchedFiles: 0, errors: ['Retained failure']});
    Object.assign(task.m1.tests, {count: 0, exitCode: 1});
    task.m1.build.exitCode = 1;
    task.m1.entryPoint = {passed: false, exitCode: 1};
  }
  const projection = projectProjection(report);
  assert.equal(projection.projects[0].status, 'INCONCLUSIVE');
  assert.deepEqual(projection.accomplishments.map(item => item.status), ['NOT_ACCEPTED', 'NOT_ACCEPTED']);
});

test('an accepted baseline remains representable without claiming transfer', () => {
  const report = clone();
  report.classification = 'INCONCLUSIVE';
  report.tasks.A.m0 = structuredClone(report.tasks.A.m1);
  assert.equal(projectProjection(report).accomplishments[0].baselineAccepted, true);
});

test('INCONCLUSIVE reports retain a rejected subprocess killed by a signal', () => {
  const report = clone();
  report.classification = 'INCONCLUSIVE';
  report.tasks.A.m1.accepted = false;
  report.tasks.A.m1.errors = ['Subprocess terminated by SIGKILL'];
  report.tasks.A.m1.tests.exitCode = -9;
  assert.equal(projectProjection(report).accomplishments[0].status, 'NOT_ACCEPTED');
});

// Each mutation changes the retained evidence into an inconsistent acceptance
// claim. Removing validation from projectProjection must make these tests fail.
const malformed = [
  ['candidate accepted string false', r => {r.tasks.A.m1.accepted = 'false';}],
  ['candidate accepted numeric one', r => {r.tasks.B.m1.accepted = 1;}],
  ['baseline accepted string false', r => {r.tasks.A.m0.accepted = 'false';}],
  ['zero accepted tests', r => {r.tasks.A.m1.tests.count = 0;}],
  ['negative tests', r => {r.tasks.A.m1.tests.count = -1;}],
  ['unsafe test count', r => {r.tasks.A.m1.tests.count = Number.MAX_SAFE_INTEGER + 1;}],
  ['fractional tests', r => {r.tasks.A.m1.tests.count = 0.5;}],
  ['string test count', r => {r.tasks.A.m1.tests.count = '47';}],
  ['missing test count', r => {delete r.tasks.A.m1.tests.count;}],
  ['failed tests', r => {r.tasks.A.m1.tests.exitCode = 1;}],
  ['string test exit', r => {r.tasks.A.m1.tests.exitCode = '0';}],
  ['missing test exit', r => {delete r.tasks.A.m1.tests.exitCode;}],
  ['tests explicitly failed', r => {r.tasks.A.m1.tests.passed = false;}],
  ['candidate integrity failed', r => {r.tasks.A.m1.integrity = false;}],
  ['candidate integrity string', r => {r.tasks.A.m1.integrity = 'true';}],
  ['missing integrity', r => {delete r.tasks.A.m1.integrity;}],
  ['accepted with retained error', r => {r.tasks.A.m1.errors.push('Execution failed');}],
  ['errors string', r => {r.tasks.A.m1.errors = 'none';}],
  ['non-string error', r => {r.tasks.A.m1.errors = [1];}],
  ['missing errors', r => {delete r.tasks.A.m1.errors;}],
  ['zero task required files', r => {r.tasks.A.requiredFiles = 0;}],
  ['unsafe required files', r => {r.tasks.A.requiredFiles = Number.MAX_SAFE_INTEGER + 1;}],
  ['fractional required files', r => {r.tasks.A.requiredFiles = 4.5;}],
  ['string required files', r => {r.tasks.A.requiredFiles = '4';}],
  ['candidate file requirement differs', r => {r.tasks.A.m1.requiredFiles = 3;}],
  ['baseline file requirement differs', r => {r.tasks.A.m0.requiredFiles = 3;}],
  ['no matched files', r => {r.tasks.A.m1.matchedFiles = 0;}],
  ['negative matched files', r => {r.tasks.A.m1.matchedFiles = -1;}],
  ['excess matched files', r => {r.tasks.A.m1.matchedFiles = 5;}],
  ['string matched files', r => {r.tasks.A.m1.matchedFiles = '4';}],
  ['failed build', r => {r.tasks.A.m1.build.exitCode = 1;}],
  ['build explicitly failed', r => {r.tasks.A.m1.build.passed = false;}],
  ['missing build exit', r => {delete r.tasks.A.m1.build.exitCode;}],
  ['null build', r => {r.tasks.A.m1.build = null;}],
  ['failed command entry point', r => {r.tasks.A.m1.entryPoint.exitCode = 1;}],
  ['failed browser entry point', r => {r.tasks.B.m1.entryPoint.passed = false;}],
  ['string browser passed', r => {r.tasks.B.m1.entryPoint.passed = 'true';}],
  ['false browser passed despite zero exit', r => {Object.assign(r.tasks.B.m1.entryPoint, {passed: false, exitCode: 0});}],
  ['true browser passed despite failed exit', r => {r.tasks.B.m1.entryPoint.exitCode = 1;}],
  ['explicit failed entry point flag', r => {r.tasks.A.m1.entryPoint.failed = true;}],
  ['missing entry point', r => {delete r.tasks.A.m1.entryPoint;}],
  ['empty entry point', r => {r.tasks.A.m1.entryPoint = {};}],
  ['TRANSFER with accepted baseline', r => {r.tasks.A.m0 = structuredClone(r.tasks.A.m1);}],
  ['TRANSFER with failed baseline integrity', r => {r.tasks.A.m0.integrity = false;}],
  ['TRANSFER with failed source integrity', r => {r.sourceIntegrity = false;}],
  ['TRANSFER with rejected candidate', r => {r.tasks.A.m1.accepted = false;}],
  ['unknown classification', r => {r.classification = 'EXTERNALLY_PROVEN';}],
  ['wrong schema', r => {r.schema = 'ngl.other.v1';}],
  ['blank report id', r => {r.id = ''; }],
  ['non-object tasks', r => {r.tasks = []; }],
  ['missing second task', r => {delete r.tasks.B;}],
  ['non-string contradiction', r => {r.contradictions[0].statement = {}; }],
  ['negative archive bytes', r => {r.tasks.A.m1.archiveBytes = -1;}],
  ['non-finite duration', r => {r.tasks.A.m1.tests.wallMs = Infinity;}],
  ['invalid command metadata', r => {r.tasks.A.m1.tests.command = 'python3';}],
  ['invalid digest metadata', r => {r.tasks.A.m1.tests.stdoutSHA256 = 'not-a-digest';}]
];

for (const [name, mutate] of malformed) {
  test(`report guard rejects ${name}`, () => {
    const report = clone();
    mutate(report);
    assert.throws(() => projectProjection(report), /Invalid institutional experiment report/);
  });
}

test('null reports continue to project no accomplishments', () => {
  const result = projectProjection(null);
  assert.equal(result.projects.length, 0);
  assert.equal(result.accomplishments.length, 0);
});
