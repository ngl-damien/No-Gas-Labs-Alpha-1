#!/usr/bin/env node
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

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    process.stderr.write(
      'Usage: node scripts/evaluate-candidate-task.mjs <synthesis-receipt.json> <integer-input>\n'
    );
    process.exitCode = 2;
    return;
  }

  const receipt = await readReceipt(args[0]);
  const verified = verifySynthesisReceipt(receipt);
  const input = parseInput(args[1], verified.specification);
  const output = evaluateCandidateProgram(verified.program, input);
  const expectedOutput = evaluateTarget(verified.specification, input);
  if (!Number.isSafeInteger(output) || BigInt(output) !== expectedOutput) {
    fail('CANDIDATE_EVALUATION_MISMATCH');
  }

  process.stdout.write(JSON.stringify({
    schema: 'ngl.candidate-program-evaluation.v1',
    taskSpecificationId: verified.specification.id,
    taskSpecificationDigest: verified.digest,
    implementationHash: candidateProgramHash(verified.program, 'v5', verified.specification),
    input,
    output,
    expectedOutput: expectedOutput.toString(),
    proofVerified: true,
    evaluationMatchesTarget: true,
    authority: {
      taskSpecificationSignatureVerified: false,
      founderInstallApprovalVerified: false,
      capabilityInstalled: false,
      canonicalStateChanged: false
    }
  }, null, 2) + '\n');
}

main().catch(error => {
  process.stderr.write((error?.message || 'CANDIDATE_EVALUATION_FAILED') + '\n');
  process.exitCode = 1;
});
