import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_RECOVERY_REFERENCE_BYTES,
  MAX_RECOVERY_REFERENCES,
  MAX_RECOVERY_TOTAL_BYTES,
  readRecoveryState,
  validateContinuityRecord,
  verifyRecoveryReferences
} from '../src/institution/recovery-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const path = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(root, 'docs/institution/compounding/STATE.json');
  const stateBytes = await readRecoveryState(path);
  const stateText = stateBytes.toString('utf8');
  if (!Buffer.from(stateText, 'utf8').equals(stateBytes)) {
    throw new Error('Continuity record is not valid UTF-8');
  }
  const state = validateContinuityRecord(JSON.parse(stateText));
  const {
    recovered,
    receipts,
    failures,
    bytesRead
  } = await verifyRecoveryReferences(root, state.references);
  const passed = failures.length === 0 && recovered.length === state.references.length;

  console.log(JSON.stringify({
    schema: 'ngl.fresh-process-recovery.v1',
    passed,
    principal: state.principal,
    authority: state.authority,
    assignments: state.assignments,
    machinery: state.machinery,
    openFailures: state.openFailures,
    taskB: state.taskB,
    founderDecision: state.founderDecision,
    nextAction: state.nextAction,
    rollback: state.rollback,
    recovered,
    receipts,
    failures: failures.map(({ path, reason, expectedSha256, actualSha256 }) => ({
      path, reason, expectedSha256, actualSha256
    })),
    bytesRead,
    limits: {
      maxReferences: MAX_RECOVERY_REFERENCES,
      maxTotalBytes: MAX_RECOVERY_TOTAL_BYTES,
      maxReferenceBytes: MAX_RECOVERY_REFERENCE_BYTES
    },
    scope: 'New Node process using durable files only; not a fresh cloud/environment restoration.'
  }, null, 2));

  if (!passed) {
    console.error(failures.map(failure => failure.message).join('\\n'));
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}