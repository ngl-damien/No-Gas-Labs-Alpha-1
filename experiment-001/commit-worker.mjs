// Test-only child-process worker. The parent releases two ready workers together
// so their INSTALL commits contend on the same durable ledger lock.
import { openInstitution } from './institutional-cycle.mjs';

const [directory, founderPublicKeyPem, decisionJSON, signature] = process.argv.slice(2);
const store = await openInstitution(directory, founderPublicKeyPem);
process.stdout.write('READY\n');

let startSignal = '';
for await (const chunk of process.stdin) startSignal += chunk;
if (startSignal.trim() !== 'GO') throw new Error('WORKER_START_SIGNAL_INVALID');

try {
  const record = await store.commit(JSON.parse(decisionJSON), signature);
  process.stdout.write(JSON.stringify({
    outcome: 'committed',
    sequence: record.sequence,
    decisionId: record.decision?.id ?? null
  }) + '\n');
} catch (error) {
  const message = error?.message ?? 'UNKNOWN_ERROR';
  process.stdout.write(JSON.stringify({ outcome: 'rejected', error: message }) + '\n');
  if (message !== 'LEDGER_LOCKED') process.exitCode = 1;
}
