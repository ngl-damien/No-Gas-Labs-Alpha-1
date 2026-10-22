# Institutional kernel

`src/institution/kernel.mjs` is a new strict API. Legacy reducers are unchanged. Trusted host configuration enrolls actor IDs and roles; incoming events cannot enroll actors or promote their roles. An ID authenticates nothing by itself: the host must authenticate the Founder and control which process may assert each configured identity. Separate local executor and verifier IDs establish distinct roles, not independent people or external truth.

```js
import { createKernel, applyEvent, artifactReceipt, replayKernel } from '../../src/institution/kernel.mjs';
const config = { founderId: 'damien', actors: [
  { id: 'damien', roles: ['founder'], kind: 'human' },
  { id: 'local-forge', roles: ['executor'], kind: 'local-process' },
  { id: 'local-byte-verifier', roles: ['observer'], kind: 'local-process' },
] };
let state = createKernel(config);
const bytes = Buffer.from('<button>Actual artifact</button>');
const receipt = artifactReceipt(bytes);
const artifacts = new Map([[receipt.digest, bytes]]);
// For each event: state = applyEvent(state, event, { artifacts });
// Full replay: replayKernel(events, config, { artifacts });
```

Every event has exactly `{id,type,actor,at,expectedRevision,workId}` plus these fields:

| Stage | Additional fields | Authority and result |
| --- | --- | --- |
| `claim` | `subject:{id,version}`, `action` | Any enrolled actor; target must be next accepted subject version. |
| `authorize` | `grantId`, `executorId`, `observerId`, `scope:{subjectId,subjectVersion,action}`, optional `expiresAt` | Founder only; exact claimed scope and configured separate executor/observer roles. |
| `execute` | `grantId`, `executionId`, `subject`, `outputs:[{algorithm:'sha256',digest,size}]` | Granted executor only; actual bytes must match all receipts. |
| `observe` | Same execution fields, `passed:boolean`, optional `checks:[JSON...]` | Granted observer only, separate from executor; verifies actual bytes again. |
| `adjudicate` | Same execution fields, `observationId`, `decision:'accept'|'reject'` | Founder only; exact observation binding. Acceptance requires positive observation and still-current subject version. |

`revoke` is an administrative event outside the five-stage progression. It adds `{grantId,reason}`, requires the Founder, and permanently prevents further stages for that work. Completed adjudications cannot be retroactively revoked. Rejection retains history and does not advance subject version. Expiry is checked at execution, observation and adjudication against canonical event time. Timestamps are canonical ISO UTC and cannot precede committed history. The trusted host owns the clock; this pure replay engine does not independently prove timestamps.

Receipts bind ordered output lists across execution, observation and adjudication. Checks are recorded observations, not an external truth oracle. In the playable-world integration the narrow action `preserve-artifact-bytes` attests byte preservation; it does not establish usefulness, public deployment, popularity or demand.

Events reject unknown fields, unknown actors, conflicting IDs, stale revisions, scope changes, swapped executions/outputs, self-observation and missing or altered bytes. Exact event retries are idempotent, including after later revisions. `KernelError.code` identifies rejection. `canonicalStringify` sorts object keys and rejects lossy JSON, accessors, prototype keys, exotic objects and cycles. Replaying identical events with identical trusted configuration and actual bytes yields identical state.

## Durable ledger

`await openLedger({directory,...config})` from `src/institution/ledger.mjs` exposes `state` and `events` snapshots, `head`, `append(event,{artifacts})`, `getArtifact(digest)` and `close()`. Use a private directory outside published assets/source archives. Enrolled configuration must match on every reopen. `append` snapshots caller input, serializes concurrent writes, validates the candidate, persists content-addressed blobs, fsyncs temporary files and atomically replaces `ledger.json` before adopting the new in-memory projection. A rejected append leaves the writer usable; an identical retry creates no duplicate record. Reads of `state` cannot mutate internal authority.

Each record hashes its index, previous hash and canonical event; the genesis hash binds the configured roster. Opening rechecks every link, replays every transition with actual persisted artifact bytes, rejects duplicate records and compares the saved projection against replay. Blob paths accept only SHA-256 hex digests. One exclusive `.writer.lock` prevents concurrent ledger handles/processes from silently overwriting each other. `close()` drains queued writes and releases that lock.

After an abrupt process death, inspect the recorded PID and confirm no writer remains before manually removing a stale lock. Do not remove another active writer's lock. Orphaned blobs from an interrupted append confer no authority because they have no committed event. After a storage/fsync error, stop writing and inspect/reopen the ledger before resuming; filesystem failure after rename can leave an ambiguous commit. This local ledger rewrites a single snapshot per append and is intended for modest histories. It is tamper-evident relative to a retained trusted head; it has no signature or external anchor that prevents a filesystem owner from rewriting the entire history and recomputing hashes. The directory owner and operating system remain trusted.

The HTTP host may instead store world, canonical kernel events and actual artifact blobs in one atomic envelope and use the pure replay API, avoiding partial commits across two independent state stores. That envelope's durability is the host's responsibility; it does not become this hash-chain ledger automatically.

## Verification

Run `node --test test/institution-kernel.test.mjs`. Initial RED before implementation: 0/17 passed. First GREEN: 17/17. Adversarial extension caught inherited dictionary/event-type names (RED 19/20), corrected with own-property checks. Final scoped run: 20/20, including real temporary directories, fsync/rename writes, restart replay, mutated ledger/projection/blob rejection, exclusive writer lock, queued stale writes, exact ID retries, failed-write projection isolation, competing subject versions, expiry and revocation. No external services or paid dependencies are used. Root integration owns the full-suite/browser checks.
