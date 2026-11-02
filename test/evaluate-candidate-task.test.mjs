import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const synthesizeScript = fileURLToPath(new URL('../scripts/synthesize-candidate-task.mjs', import.meta.url));
const evaluateScript = fileURLToPath(new URL('../scripts/evaluate-candidate-task.mjs', import.meta.url));

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

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    timeout: 10_000
  });
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-candidate-evaluation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const specificationPath = join(directory, 'task-spec.json');
  await writeFile(specificationPath, JSON.stringify(taskSpecification(), null, 2) + '\n', { mode: 0o600 });
  const synthesized = run(synthesizeScript, [specificationPath]);
  assert.equal(synthesized.status, 0, synthesized.stderr);
  const receiptPath = join(directory, 'synthesis-receipt.json');
  await writeFile(receiptPath, synthesized.stdout, { mode: 0o600 });
  return {
    directory,
    receiptPath,
    receipt: JSON.parse(synthesized.stdout)
  };
}

test('offline evaluator verifies the synthesis receipt and independently checks bounded outputs', async t => {
  const { receiptPath } = await fixture(t);
  for (const input of [-1_000_000, -17, 0, 17, 1_000_000]) {
    const result = run(evaluateScript, [receiptPath, String(input)]);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.schema, 'ngl.candidate-program-evaluation.v1');
    assert.equal(receipt.taskSpecificationId, taskSpecification().id);
    assert.match(receipt.taskSpecificationDigest, /^[a-f0-9]{64}$/);
    assert.match(receipt.implementationHash, /^[a-f0-9]{64}$/);
    assert.equal(receipt.input, input);
    assert.equal(receipt.output, 3 * input * input + 2 * input - 5);
    assert.equal(receipt.expectedOutput, String(receipt.output));
    assert.equal(receipt.proofVerified, true);
    assert.equal(receipt.evaluationMatchesTarget, true);
    assert.deepEqual(receipt.authority, {
      taskSpecificationSignatureVerified: false,
      founderInstallApprovalVerified: false,
      capabilityInstalled: false,
      canonicalStateChanged: false
    });
  }
});

test('offline evaluator rejects task, program, proof, and trust tampering', async t => {
  const { directory, receipt } = await fixture(t);
  const cases = [
    {
      name: 'task specification digest',
      code: 'SYNTHESIS_RECEIPT_DIGEST_MISMATCH',
      mutate(value) { value.taskSpecification.targetCoefficients[0] = '-6'; }
    },
    {
      name: 'candidate program',
      code: 'SYNTHESIS_PROOF_MISMATCH',
      mutate(value) { value.program = { op: 'const', value: 0 }; }
    },
    {
      name: 'proof certificate',
      code: 'SYNTHESIS_PROOF_MISMATCH',
      mutate(value) { value.proof.coefficients[0] = '-6'; }
    },
    {
      name: 'unsigned-only trust boundary',
      code: 'SYNTHESIS_RECEIPT_INVALID',
      mutate(value) { value.trust.signaturesCreated = true; }
    }
  ];

  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    const altered = structuredClone(receipt);
    item.mutate(altered);
    const path = join(directory, 'tampered-' + index + '.json');
    await writeFile(path, JSON.stringify(altered), { mode: 0o600 });
    const result = run(evaluateScript, [path, '0']);
    assert.equal(result.status, 1, item.name);
    assert.match(result.stderr, new RegExp(item.code), item.name);
    assert.equal(result.stdout, '', item.name);
  }
});

test('offline evaluator rejects duplicate JSON keys before parsing a synthesis receipt', async t => {
  const { directory, receipt } = await fixture(t);
  const source = JSON.stringify(receipt).replace(
    '"schema":"ngl.candidate-program-synthesis.v1"',
    '"schema":"untrusted","schema":"ngl.candidate-program-synthesis.v1"'
  );
  const path = join(directory, 'duplicate.json');
  await writeFile(path, source, { mode: 0o600 });
  const result = run(evaluateScript, [path, '0']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SYNTHESIS_RECEIPT_DUPLICATE_JSON_KEY/);
  assert.equal(result.stdout, '');
});

test('offline evaluator accepts only canonical in-range integer arguments', async t => {
  const { receiptPath } = await fixture(t);
  for (const [input, code] of [
    ['01', 'CANDIDATE_INPUT_INVALID'],
    ['+1', 'CANDIDATE_INPUT_INVALID'],
    ['-0', 'CANDIDATE_INPUT_INVALID'],
    ['1e3', 'CANDIDATE_INPUT_INVALID'],
    ['1000001', 'CANDIDATE_INPUT_OUT_OF_BOUNDS'],
    ['-1000001', 'CANDIDATE_INPUT_OUT_OF_BOUNDS'],
    ['999999999', 'CANDIDATE_INPUT_OUT_OF_BOUNDS']
  ]) {
    const result = run(evaluateScript, [receiptPath, input]);
    assert.equal(result.status, 1, input);
    assert.match(result.stderr, new RegExp(code), input);
    assert.equal(result.stdout, '', input);
  }
});

test('offline evaluator requires exactly a receipt path and one input', () => {
  const result = run(evaluateScript, []);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: node scripts\/evaluate-candidate-task\.mjs/);
});
