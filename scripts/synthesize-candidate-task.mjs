#!/usr/bin/env node
import { resolve } from 'node:path';
import { readBoundedRegularFile } from '../src/bounded-file-reader.mjs';
import { assertNoDuplicateJsonObjectKeys } from '../src/strict-json.mjs';
import {
  candidateTaskSpecificationDigest,
  synthesizeCandidateTaskProgram,
  validateCandidateTaskSpecification
} from '../experiment-001/candidate-program.mjs';

const MAX_TASK_SPEC_BYTES = 64 * 1024;
const MAX_TASK_SPEC_JSON_DEPTH = 16;

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    process.stderr.write('Usage: node scripts/synthesize-candidate-task.mjs <task-spec.json>\n');
    process.exitCode = 2;
    return;
  }

  let source;
  try {
    source = await readBoundedRegularFile(resolve(args[0]), MAX_TASK_SPEC_BYTES, 'TASK_SPEC');
  } catch (error) {
    throw new Error(error.code || error.message || 'TASK_SPEC_READ_FAILED');
  }
  assertNoDuplicateJsonObjectKeys(source, {
    label: 'TASK_SPEC',
    maxDepth: MAX_TASK_SPEC_JSON_DEPTH
  });

  let parsed;
  try { parsed = JSON.parse(source); }
  catch { throw new Error('TASK_SPEC_JSON_INVALID'); }

  let specification;
  try { specification = validateCandidateTaskSpecification(parsed); }
  catch { throw new Error('TASK_SPEC_INVALID'); }

  const { program, proof } = synthesizeCandidateTaskProgram(specification);
  process.stdout.write(JSON.stringify({
    schema: 'ngl.candidate-program-synthesis.v1',
    taskSpecificationDigest: candidateTaskSpecificationDigest(specification),
    taskSpecification: specification,
    program,
    proof,
    trust: {
      taskSpecificationSignatureRequiredForInstall: true,
      founderInstallApprovalRequired: true,
      signaturesCreated: false
    },
    instruction: 'Review the generated AST and exact proof. This command does not verify or sign a task specification, read a Founder key, install a capability, or execute the program.'
  }, null, 2) + '\n');
}

main().catch(error => {
  process.stderr.write(`${error?.message || 'CANDIDATE_SYNTHESIS_FAILED'}\n`);
  process.exitCode = 1;
});
