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

test('offline evaluator supports single-input and bounded range usage forms', () => {
  const result = run(evaluateScript, []);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: node scripts\/evaluate-candidate-task\.mjs/);
  assert.match(result.stderr, /--range <start> <end>/);
  const incompleteRange = run(evaluateScript, ['unused.json', '--range', '0']);
  assert.equal(incompleteRange.status, 2);
  assert.match(incompleteRange.stderr, /--range <start> <end>/);
  const incompleteVerification = run(evaluateScript, ['--verify-report', 'unused.json']);
  assert.equal(incompleteVerification.status, 2);
  assert.match(incompleteVerification.stderr, /--verify-report <synthesis-receipt\.json> <evaluation-report\.json>/);
});

test('offline range evaluation checks every inclusive input and is byte-for-byte reproducible', async t => {
  const { receiptPath } = await fixture(t);
  const args = [receiptPath, '--range', '-3', '3'];
  const first = run(evaluateScript, args);
  const second = run(evaluateScript, args);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, first.stdout, 'the same verified inputs must produce identical evidence bytes');

  const report = JSON.parse(first.stdout);
  assert.equal(report.schema, 'ngl.candidate-program-evaluation-range.v1');
  assert.equal(report.taskSpecificationId, taskSpecification().id);
  assert.match(report.taskSpecificationDigest, /^[a-f0-9]{64}$/);
  assert.match(report.implementationHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(report.range, { start: -3, end: 3 });
  assert.equal(report.evaluationCount, 7);
  assert.deepEqual(report.evaluations, Array.from({ length: 7 }, (_, index) => {
    const input = index - 3;
    const output = 3 * input * input + 2 * input - 5;
    return { input, output, expectedOutput: String(output) };
  }));
  assert.match(report.resultDigest, /^[a-f0-9]{64}$/);
  assert.equal(report.proofVerified, true);
  assert.equal(report.evaluationMatchesTarget, true);
  assert.deepEqual(report.authority, {
    taskSpecificationSignatureVerified: false,
    founderInstallApprovalVerified: false,
    capabilityInstalled: false,
    canonicalStateChanged: false
  });
});

test('offline range evaluation accepts the exact 4096-input bound and rejects larger or invalid ranges', async t => {
  const { receiptPath } = await fixture(t);
  const maximum = run(evaluateScript, [receiptPath, '--range', '-2048', '2047']);
  assert.equal(maximum.status, 0, maximum.stderr);
  assert.equal(JSON.parse(maximum.stdout).evaluationCount, 4096);

  for (const [start, end, code] of [
    ['0', '-1', 'CANDIDATE_RANGE_INVALID'],
    ['0', '4096', 'CANDIDATE_RANGE_TOO_LARGE'],
    ['-1000001', '0', 'CANDIDATE_INPUT_OUT_OF_BOUNDS'],
    ['0', '1000001', 'CANDIDATE_INPUT_OUT_OF_BOUNDS'],
    ['01', '2', 'CANDIDATE_INPUT_INVALID']
  ]) {
    const result = run(evaluateScript, [receiptPath, '--range', start, end]);
    assert.equal(result.status, 1, start + '..' + end);
    assert.match(result.stderr, new RegExp(code), start + '..' + end);
    assert.equal(result.stdout, '');
  }
});


test('offline report verifier replays single and bounded-range reports with deterministic receipts', async t => {
  const { directory, receiptPath } = await fixture(t);
  const scenarios = [
    { name: 'single', args: [receiptPath, '17'], reportSchema: 'ngl.candidate-program-evaluation.v1', count: 1 },
    { name: 'range', args: [receiptPath, '--range', '-3', '3'], reportSchema: 'ngl.candidate-program-evaluation-range.v1', count: 7 }
  ];

  for (const scenario of scenarios) {
    const evaluated = run(evaluateScript, scenario.args);
    assert.equal(evaluated.status, 0, evaluated.stderr);
    const report = JSON.parse(evaluated.stdout);
    const reportPath = join(directory, scenario.name + '-evaluation-report.json');
    await writeFile(reportPath, evaluated.stdout, { mode: 0o600 });

    const args = ['--verify-report', receiptPath, reportPath];
    const first = run(evaluateScript, args);
    const second = run(evaluateScript, args);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, first.stdout, 'the same source receipt and report must yield identical verification bytes');

    const verification = JSON.parse(first.stdout);
    assert.equal(verification.schema, 'ngl.candidate-program-evaluation-verification.v1');
    assert.equal(verification.reportSchema, scenario.reportSchema);
    assert.equal(verification.taskSpecificationId, taskSpecification().id);
    assert.equal(verification.evaluationCount, scenario.count);
    assert.match(verification.reportDigest, /^[a-f0-9]{64}$/);
    assert.equal(verification.resultDigest, scenario.name === 'range' ? report.resultDigest : null);
    assert.equal(verification.verificationMethod, 'same-runtime-replay-plus-BigInt-target-check');
    assert.equal(verification.verified, true);
    assert.deepEqual(verification.authority, {
      taskSpecificationSignatureVerified: false,
      founderInstallApprovalVerified: false,
      capabilityInstalled: false,
      canonicalStateChanged: false
    });
  }
});

test('offline report verifier rejects altered rows, task context, authority claims, incomplete ranges, and digests', async t => {
  const { directory, receiptPath } = await fixture(t);
  const evaluated = run(evaluateScript, [receiptPath, '--range', '-3', '3']);
  assert.equal(evaluated.status, 0, evaluated.stderr);
  const original = JSON.parse(evaluated.stdout);
  const cases = [
    {
      name: 'altered output',
      code: 'EVALUATION_REPORT_MISMATCH',
      mutate(value) { value.evaluations[0].output += 1; }
    },
    {
      name: 'wrong task context',
      code: 'EVALUATION_REPORT_CONTEXT_MISMATCH',
      mutate(value) { value.taskSpecificationDigest = '0'.repeat(64); }
    },
    {
      name: 'forged authority claim',
      code: 'EVALUATION_REPORT_AUTHORITY_INVALID',
      mutate(value) { value.authority.capabilityInstalled = true; }
    },
    {
      name: 'incomplete range',
      code: 'EVALUATION_REPORT_RANGE_INVALID',
      mutate(value) { value.evaluations.pop(); }
    },
    {
      name: 'altered result digest',
      code: 'EVALUATION_REPORT_DIGEST_MISMATCH',
      mutate(value) { value.resultDigest = '0'.repeat(64); }
    },
    {
      name: 'noncontiguous row',
      code: 'EVALUATION_REPORT_RANGE_INVALID',
      mutate(value) { value.evaluations[1].input += 1; }
    },
    {
      name: 'unexpected report field',
      code: 'EVALUATION_REPORT_INVALID',
      mutate(value) { value.untrustedFounderApproval = true; }
    }
  ];

  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    const altered = structuredClone(original);
    item.mutate(altered);
    const reportPath = join(directory, 'tampered-evaluation-' + index + '.json');
    await writeFile(reportPath, JSON.stringify(altered), { mode: 0o600 });
    const result = run(evaluateScript, ['--verify-report', receiptPath, reportPath]);
    assert.equal(result.status, 1, item.name);
    assert.match(result.stderr, new RegExp(item.code), item.name);
    assert.equal(result.stdout, '', item.name);
  }
});

test('offline report verifier rejects duplicate JSON keys before replay', async t => {
  const { directory, receiptPath } = await fixture(t);
  const evaluated = run(evaluateScript, [receiptPath, '--range', '-3', '3']);
  assert.equal(evaluated.status, 0, evaluated.stderr);
  const duplicate = evaluated.stdout.replace(
    '"schema": "ngl.candidate-program-evaluation-range.v1"',
    '"schema": "untrusted",\n  "schema": "ngl.candidate-program-evaluation-range.v1"'
  );
  assert.notEqual(duplicate, evaluated.stdout, 'the fixture must actually contain the duplicate key');
  const reportPath = join(directory, 'duplicate-evaluation-report.json');
  await writeFile(reportPath, duplicate, { mode: 0o600 });
  const result = run(evaluateScript, ['--verify-report', receiptPath, reportPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EVALUATION_REPORT_DUPLICATE_JSON_KEY/);
  assert.equal(result.stdout, '');
});


test('offline report verifier rejects oversized reports before JSON parsing', async t => {
  const { directory, receiptPath } = await fixture(t);
  const reportPath = join(directory, 'oversized-evaluation-report.json');
  await writeFile(reportPath, ' '.repeat(2 * 1024 * 1024 + 1), { mode: 0o600 });
  const result = run(evaluateScript, ['--verify-report', receiptPath, reportPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EVALUATION_REPORT_FILE_TOO_LARGE/);
  assert.equal(result.stdout, '');
});
