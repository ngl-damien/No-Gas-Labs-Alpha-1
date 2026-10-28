import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecoveryState, readVerifiedReference } from '../src/institution/recovery-files.mjs';

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
  const state = JSON.parse(stateText);

  if (!state || state.schema !== 'ngl.institution-continuity.v1' ||
      state.principal !== 'Damien Featherstone' ||
      !Array.isArray(state.references) || !state.references.length ||
      !Array.isArray(state.assignments) || !state.assignments.length ||
      !state.authority || !state.nextAction || !state.rollback ||
      !state.machinery?.M0 || !state.machinery?.M1 ||
      !Array.isArray(state.openFailures) || !state.taskB || !state.founderDecision) {
    throw new Error('Incomplete continuity record');
  }

  const recovered = [];
  for (const reference of state.references) {
    await readVerifiedReference(root, reference);
    recovered.push(reference.path);
  }

  console.log(JSON.stringify({
    schema: 'ngl.fresh-process-recovery.v1',
    passed: true,
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
    scope: 'New Node process using durable files only; not a fresh cloud/environment restoration.'
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
