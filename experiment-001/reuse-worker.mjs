// Test-only child-process worker for a signed REUSE after process restart.
import { openInstitution } from './institutional-cycle.mjs';

const store = await openInstitution(process.argv[2], process.argv[3]);
const decision = JSON.parse(process.argv[4]);
await store.commit(decision, process.argv[5]);
process.stdout.write(JSON.stringify(store.snapshot()));
