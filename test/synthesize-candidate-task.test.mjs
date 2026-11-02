import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  candidateTaskSpecificationDigest,
  evaluateCandidateProgram
} from '../experiment-001/candidate-program.mjs';

const script = fileURLToPath(new URL('../scripts/synthesize-candidate-task.mjs', import.meta.url));

function taskSpecification() {
  return {
    schema: 'ngl.candidate-task-spec.v1',
    id: 'ngl.experiment-001.task:quadratic-3x2-plus-2x-minus-5:v1',
    inputMin: -1_000_000,
    inputMax: 1_000_000,
    proofMethod: 'exact-integer-polynomial-normal-form',
    limits: {
      maxAstDepth: 12,
      maxAstNodes: 63,
      maxPolynomialDegree: 32,
      maxCoefficientBits: 4096,
      maxSafeInteger: Number.MAX_SAFE_INTEGER
    },
    targetCoefficients: ['-5', '2', '3']
  };
}

async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-task-synthesis-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function run(args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
}

test('offline synthesis CLI emits an exact bounded candidate without reading a Founder key', async t => {
  const directory = await temp(t);
  const specification = taskSpecification();
  const path = join(directory, 'task-spec.json');
  await writeFile(path, JSON.stringify(specification, null, 2) + '\n', { mode: 0o600 });

  const result = run([path], { NGL_FOUNDER_KEY_FINGERPRINT: '' });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.schema, 'ngl.candidate-program-synthesis.v1');
  assert.equal(receipt.taskSpecificationDigest, candidateTaskSpecificationDigest(specification));
  assert.deepEqual(receipt.taskSpecification, specification);
  assert.deepEqual(receipt.proof.coefficients, ['-5', '2', '3']);
  assert.deepEqual(receipt.proof.targetCoefficients, ['-5', '2', '3']);
  assert.equal(receipt.proof.matchesTask, true);
  assert.deepEqual(receipt.trust, {
    taskSpecificationSignatureRequiredForInstall: true,
    founderInstallApprovalRequired: true,
    signaturesCreated: false
  });
  assert.match(receipt.instruction, /does not verify or sign/);

  for (const input of [-1_000_000, -17, 0, 17, 1_000_000]) {
    assert.equal(evaluateCandidateProgram(receipt.program, input), 3 * input * input + 2 * input - 5);
  }
});

test('offline synthesis CLI rejects duplicate JSON keys and noncanonical task coefficients', async t => {
  const directory = await temp(t);
  const specification = taskSpecification();
  const duplicatePath = join(directory, 'duplicate-task-spec.json');
  const duplicate = JSON.stringify(specification).replace(
    '"schema":"ngl.candidate-task-spec.v1"',
    '"schema":"bad","schema":"ngl.candidate-task-spec.v1"'
  );
  await writeFile(duplicatePath, duplicate, { mode: 0o600 });
  const duplicateResult = run([duplicatePath]);
  assert.equal(duplicateResult.status, 1);
  assert.match(duplicateResult.stderr, /TASK_SPEC_DUPLICATE_JSON_KEY/);

  const invalidPath = join(directory, 'invalid-task-spec.json');
  await writeFile(invalidPath, JSON.stringify({
    ...specification,
    targetCoefficients: ['-05', '2', '3']
  }), { mode: 0o600 });
  const invalidResult = run([invalidPath]);
  assert.equal(invalidResult.status, 1);
  assert.match(invalidResult.stderr, /TASK_SPEC_INVALID/);
  assert.equal(invalidResult.stdout, '');
});

test('offline synthesis CLI requires one task-spec path', () => {
  const result = run([]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: node scripts\\/synthesize-candidate-task\\.mjs/);
});
