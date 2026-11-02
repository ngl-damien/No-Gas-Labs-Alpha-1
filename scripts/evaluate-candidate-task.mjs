#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { readBoundedRegularFile } from '../src/bounded-file-reader.mjs';
import { assertNoDuplicateJsonObjectKeys } from '../src/strict-json.mjs';
import {
  candidateProgramHash,
  candidateTaskSpecificationDigest,
  evaluateCandidateProgram,
  proveCandidateTaskProgram,
  validateCandidateProgram,
  validateCandidateTaskSpecification
} from '../experiment-001/candidate-program.mjs';

const MAX_RECEIPT_BYTES = 64 * 1024;
const MAX_RECEIPT_JSON_DEPTH = 16;
const MAX_RANGE_EVALUATIONS = 4096;
const MAX_EVALUATION_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_EVALUATION_REPORT_JSON_DEPTH = 16;
const AUTHORITY_KEYS = [
  'taskSpecificationSignatureVerified',
  'founderInstallApprovalVerified',
  'capabilityInstalled',
  'canonicalStateChanged'
];
const SINGLE_EVALUATION_REPORT_KEYS = [
  'schema', 'taskSpecificationId', 'taskSpecificationDigest', 'implementationHash',
  'input', 'output', 'expectedOutput', 'proofVerified', 'evaluationMatchesTarget', 'authority'
];
const RANGE_EVALUATION_REPORT_KEYS = [
  'schema', 'taskSpecificationId', 'taskSpecificationDigest', 'implementationHash',
  'range', 'evaluationCount', 'evaluations', 'proofVerified', 'evaluationMatchesTarget',
  'authority', 'resultDigest'
];
const EVALUATION_ROW_KEYS = ['input', 'output', 'expectedOutput'];
const RECEIPT_KEYS = [
  'schema',
  'taskSpecificationDigest',
  'taskSpecification',
  'program',
  'proof',
  'trust',
  'instruction'
];
const TRUST_KEYS = [
  'taskSpecificationSignatureRequiredForInstall',
  'founderInstallApprovalRequired',
  'signaturesCreated'
];

function fail(code) {
  throw new Error(code);
}

function requireExactKeys(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail(code);
  }
  if ((prototype !== Object.prototype && prototype !== null) ||
      keys.length !== expected.length ||
      keys.some(key => typeof key !== 'string' || !expected.includes(key))) {
    fail(code);
  }
}

async function readReceipt(path) {
  let source;
  try {
    source = await readBoundedRegularFile(resolve(path), MAX_RECEIPT_BYTES, 'SYNTHESIS_RECEIPT');
  } catch (error) {
    throw new Error(error.code || error.message || 'SYNTHESIS_RECEIPT_READ_FAILED');
  }
  assertNoDuplicateJsonObjectKeys(source, {
    label: 'SYNTHESIS_RECEIPT',
    maxDepth: MAX_RECEIPT_JSON_DEPTH
  });
  try {
    return JSON.parse(source);
  } catch {
    fail('SYNTHESIS_RECEIPT_JSON_INVALID');
  }
}

async function readEvaluationReport(path) {
  let source;
  try {
    source = await readBoundedRegularFile(resolve(path), MAX_EVALUATION_REPORT_BYTES, 'EVALUATION_REPORT');
  } catch (error) {
    throw new Error(error.code || error.message || 'EVALUATION_REPORT_READ_FAILED');
  }
  assertNoDuplicateJsonObjectKeys(source, {
    label: 'EVALUATION_REPORT',
    maxDepth: MAX_EVALUATION_REPORT_JSON_DEPTH
  });
  try {
    return JSON.parse(source);
  } catch {
    fail('EVALUATION_REPORT_JSON_INVALID');
  }
}

function verifySynthesisReceipt(receipt) {
  requireExactKeys(receipt, RECEIPT_KEYS, 'SYNTHESIS_RECEIPT_INVALID');
  if (receipt.schema !== 'ngl.candidate-program-synthesis.v1' ||
      typeof receipt.taskSpecificationDigest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(receipt.taskSpecificationDigest) ||
      typeof receipt.instruction !== 'string' ||
      receipt.instruction.length > 512) {
    fail('SYNTHESIS_RECEIPT_INVALID');
  }

  let specification;
  let program;
  try {
    specification = validateCandidateTaskSpecification(receipt.taskSpecification);
    program = validateCandidateProgram(receipt.program);
  } catch {
    fail('SYNTHESIS_RECEIPT_INVALID');
  }

  const digest = candidateTaskSpecificationDigest(specification);
  if (digest !== receipt.taskSpecificationDigest) {
    fail('SYNTHESIS_RECEIPT_DIGEST_MISMATCH');
  }

  const expectedProof = proveCandidateTaskProgram(program, specification);
  if (!expectedProof.matchesTask || !isDeepStrictEqual(receipt.proof, expectedProof)) {
    fail('SYNTHESIS_PROOF_MISMATCH');
  }

  requireExactKeys(receipt.trust, TRUST_KEYS, 'SYNTHESIS_RECEIPT_INVALID');
  if (receipt.trust.taskSpecificationSignatureRequiredForInstall !== true ||
      receipt.trust.founderInstallApprovalRequired !== true ||
      receipt.trust.signaturesCreated !== false) {
    fail('SYNTHESIS_RECEIPT_INVALID');
  }

  return { specification, program, digest, proof: expectedProof };
}

function parseInput(value, specification) {
  if (typeof value !== 'string' || !/^(0|-?[1-9][0-9]*)$/.test(value)) {
    fail('CANDIDATE_INPUT_INVALID');
  }
  if (value.length > 8) fail('CANDIDATE_INPUT_OUT_OF_BOUNDS');
  const input = BigInt(value);
  if (input < BigInt(specification.inputMin) || input > BigInt(specification.inputMax)) {
    fail('CANDIDATE_INPUT_OUT_OF_BOUNDS');
  }
  return Number(input);
}

function evaluateTarget(specification, input) {
  const x = BigInt(input);
  let result = 0n;
  for (let index = specification.targetCoefficients.length - 1; index >= 0; index -= 1) {
    result = result * x + BigInt(specification.targetCoefficients[index]);
  }
  return result;
}

function evaluateOne(verified, input) {
  const candidateOutput = evaluateCandidateProgram(verified.program, input);
  // JSON.stringify serializes -0 as 0. Normalize at the report boundary so
  // the serialized report replays under the same strict numeric comparison.
  const output = Object.is(candidateOutput, -0) ? 0 : candidateOutput;
  const expectedOutput = evaluateTarget(verified.specification, input);
  if (!Number.isSafeInteger(output) || BigInt(output) !== expectedOutput) {
    fail('CANDIDATE_EVALUATION_MISMATCH');
  }
  return { input, output, expectedOutput: expectedOutput.toString() };
}

function authorityBoundary() {
  return {
    taskSpecificationSignatureVerified: false,
    founderInstallApprovalVerified: false,
    capabilityInstalled: false,
    canonicalStateChanged: false
  };
}

function verifyReportAuthority(authority) {
  requireExactKeys(authority, AUTHORITY_KEYS, 'EVALUATION_REPORT_INVALID');
  if (AUTHORITY_KEYS.some(key => authority[key] !== false)) {
    fail('EVALUATION_REPORT_AUTHORITY_INVALID');
  }
}

function makeVerificationReceipt(verified, normalizedReport, evaluationCount, resultDigest = null) {
  const reportDigest = createHash('sha256')
    .update('ngl.candidate-program-evaluation-report:v1\n')
    .update(JSON.stringify(normalizedReport))
    .digest('hex');
  return {
    schema: 'ngl.candidate-program-evaluation-verification.v1',
    reportSchema: normalizedReport.schema,
    taskSpecificationId: verified.specification.id,
    taskSpecificationDigest: verified.digest,
    implementationHash: candidateProgramHash(verified.program, 'v5', verified.specification),
    evaluationCount,
    reportDigest,
    resultDigest,
    verificationMethod: 'same-runtime-replay-plus-BigInt-target-check',
    verified: true,
    authority: authorityBoundary()
  };
}

function verifyEvaluationReport(verified, report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    fail('EVALUATION_REPORT_INVALID');
  }
  const implementationHash = candidateProgramHash(verified.program, 'v5', verified.specification);
  if (report.taskSpecificationId !== verified.specification.id ||
      report.taskSpecificationDigest !== verified.digest ||
      report.implementationHash !== implementationHash) {
    fail('EVALUATION_REPORT_CONTEXT_MISMATCH');
  }
  if (report.proofVerified !== true || report.evaluationMatchesTarget !== true) {
    fail('EVALUATION_REPORT_INVALID');
  }
  verifyReportAuthority(report.authority);

  if (report.schema === 'ngl.candidate-program-evaluation.v1') {
    requireExactKeys(report, SINGLE_EVALUATION_REPORT_KEYS, 'EVALUATION_REPORT_INVALID');
    if (!Number.isSafeInteger(report.input)) fail('EVALUATION_REPORT_INPUT_INVALID');
    let input;
    try { input = parseInput(String(report.input), verified.specification); }
    catch { fail('EVALUATION_REPORT_INPUT_INVALID'); }
    const expected = evaluateOne(verified, input);
    const actual = { input: report.input, output: report.output, expectedOutput: report.expectedOutput };
    if (!isDeepStrictEqual(actual, expected)) fail('EVALUATION_REPORT_MISMATCH');
    const normalizedReport = {
      schema: 'ngl.candidate-program-evaluation.v1',
      taskSpecificationId: verified.specification.id,
      taskSpecificationDigest: verified.digest,
      implementationHash,
      ...expected,
      proofVerified: true,
      evaluationMatchesTarget: true,
      authority: authorityBoundary()
    };
    return makeVerificationReceipt(verified, normalizedReport, 1);
  }

  if (report.schema === 'ngl.candidate-program-evaluation-range.v1') {
    requireExactKeys(report, RANGE_EVALUATION_REPORT_KEYS, 'EVALUATION_REPORT_INVALID');
    requireExactKeys(report.range, ['start', 'end'], 'EVALUATION_REPORT_RANGE_INVALID');
    if (!Number.isSafeInteger(report.range.start) || !Number.isSafeInteger(report.range.end) ||
        Object.is(report.range.start, -0) || Object.is(report.range.end, -0)) {
      fail('EVALUATION_REPORT_RANGE_INVALID');
    }
    let start;
    let end;
    try {
      start = parseInput(String(report.range.start), verified.specification);
      end = parseInput(String(report.range.end), verified.specification);
    } catch {
      fail('EVALUATION_REPORT_RANGE_INVALID');
    }
    if (start > end) fail('EVALUATION_REPORT_RANGE_INVALID');
    const count = end - start + 1;
    if (count > MAX_RANGE_EVALUATIONS) fail('EVALUATION_REPORT_RANGE_TOO_LARGE');
    if (report.evaluationCount !== count || !Array.isArray(report.evaluations) ||
        report.evaluations.length !== count) {
      fail('EVALUATION_REPORT_RANGE_INVALID');
    }

    const evaluations = [];
    for (let index = 0; index < count; index += 1) {
      const row = report.evaluations[index];
      requireExactKeys(row, EVALUATION_ROW_KEYS, 'EVALUATION_REPORT_INVALID');
      const input = start + index;
      if (row.input !== input) fail('EVALUATION_REPORT_RANGE_INVALID');
      const expected = evaluateOne(verified, input);
      if (!isDeepStrictEqual(row, expected)) fail('EVALUATION_REPORT_MISMATCH');
      evaluations.push(expected);
    }

    const unsignedReport = {
      schema: 'ngl.candidate-program-evaluation-range.v1',
      taskSpecificationId: verified.specification.id,
      taskSpecificationDigest: verified.digest,
      implementationHash,
      range: { start, end },
      evaluationCount: count,
      evaluations,
      proofVerified: true,
      evaluationMatchesTarget: true,
      authority: authorityBoundary()
    };
    const resultDigest = createHash('sha256')
      .update('ngl.candidate-program-evaluation-range:v1\n')
      .update(JSON.stringify(unsignedReport))
      .digest('hex');
    if (report.resultDigest !== resultDigest) fail('EVALUATION_REPORT_DIGEST_MISMATCH');
    return makeVerificationReceipt(
      verified,
      { ...unsignedReport, resultDigest },
      count,
      resultDigest
    );
  }

  fail('EVALUATION_REPORT_SCHEMA_UNSUPPORTED');
}

async function main() {
  const args = process.argv.slice(2);
  const verifyReport = args.length === 3 && args[0] === '--verify-report';
  const singleInput = args.length === 2 &&
    !args.includes('--range') &&
    !args.includes('--verify-report');
  const rangeInput = args.length === 4 &&
    args[1] === '--range' &&
    args[0] !== '--verify-report';
  if (!verifyReport && !singleInput && !rangeInput) {
    process.stderr.write(
      'Usage: node scripts/evaluate-candidate-task.mjs <synthesis-receipt.json> <integer-input>\n' +
      '   or: node scripts/evaluate-candidate-task.mjs <synthesis-receipt.json> --range <start> <end>\n' +
      '   or: node scripts/evaluate-candidate-task.mjs --verify-report <synthesis-receipt.json> <evaluation-report.json>\n'
    );
    process.exitCode = 2;
    return;
  }

  const receipt = await readReceipt(verifyReport ? args[1] : args[0]);
  const verified = verifySynthesisReceipt(receipt);
  if (verifyReport) {
    const report = await readEvaluationReport(args[2]);
    const verification = verifyEvaluationReport(verified, report);
    process.stdout.write(JSON.stringify(verification, null, 2) + '\n');
    return;
  }
  const implementationHash = candidateProgramHash(verified.program, 'v5', verified.specification);

  if (singleInput) {
    const input = parseInput(args[1], verified.specification);
    const evaluation = evaluateOne(verified, input);
    process.stdout.write(JSON.stringify({
      schema: 'ngl.candidate-program-evaluation.v1',
      taskSpecificationId: verified.specification.id,
      taskSpecificationDigest: verified.digest,
      implementationHash,
      ...evaluation,
      proofVerified: true,
      evaluationMatchesTarget: true,
      authority: authorityBoundary()
    }, null, 2) + '\n');
    return;
  }

  const start = parseInput(args[2], verified.specification);
  const end = parseInput(args[3], verified.specification);
  if (start > end) fail('CANDIDATE_RANGE_INVALID');
  const evaluationCount = end - start + 1;
  if (evaluationCount > MAX_RANGE_EVALUATIONS) fail('CANDIDATE_RANGE_TOO_LARGE');

  const evaluations = [];
  for (let input = start; input <= end; input += 1) {
    evaluations.push(evaluateOne(verified, input));
  }

  const report = {
    schema: 'ngl.candidate-program-evaluation-range.v1',
    taskSpecificationId: verified.specification.id,
    taskSpecificationDigest: verified.digest,
    implementationHash,
    range: { start, end },
    evaluationCount: evaluations.length,
    evaluations,
    proofVerified: true,
    evaluationMatchesTarget: true,
    authority: authorityBoundary()
  };
  const resultDigest = createHash('sha256')
    .update('ngl.candidate-program-evaluation-range:v1\n')
    .update(JSON.stringify(report))
    .digest('hex');
  process.stdout.write(JSON.stringify({ ...report, resultDigest }, null, 2) + '\n');
}
main().catch(error => {
  process.stderr.write((error?.message || 'CANDIDATE_EVALUATION_FAILED') + '\n');
  process.exitCode = 1;
});
