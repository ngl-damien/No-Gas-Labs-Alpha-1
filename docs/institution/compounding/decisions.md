# Durable Founder dispositions

Implemented in [`src/institution/decisions.mjs`](../../../src/institution/decisions.mjs). This is a local governance mechanism, not the Alpha 1 institutional success test and not an externally reachable HTTPS deployment.

## Trust boundary

The HTTP host must authenticate a session and construct the actor argument itself. Passing an actor object from a request body directly to this module would violate its boundary. The fixed host identities are Founder `{id: 'damien', role: 'founder'}`, local evaluator `{id: 'local-evaluator', role: 'executor'}`, and redacted Witness `{id: 'witness:…', role: 'witness'}`. These local role IDs do not establish independent people, providers, or observations.

There is no default review policy, invented deadline, automatic pending proposal or source promotion. The service initializes empty and unconfigured. The operational 24-hour policy in [REVIEW-POLICY.md](REVIEW-POLICY.md) is activated by the host only after its real evidence/readiness prerequisites are established; a module-level interval alone cannot establish them.

## API

```js
import { openDecisions } from '../../../src/institution/decisions.mjs';
const gate = await openDecisions({ directory: privateDirectory, now: Date.now });
```

All methods return promises. `now`, if supplied, is a trusted host clock function returning nonnegative integer epoch milliseconds. Committed timestamps cannot decrease. The host also owns authentication, HTTP Origin/CSRF checks, request body bounds, HTTPS and its private data directory.

- `setPolicy(actor, {id, reviewWindowMs, basis})` requires the exact Founder identity. The positive integer interval is at most 30 days, with an explicit nonempty basis. The return value adds `revision` and server-derived `setAt`. Policy IDs are immutable. An identical retry returns the original policy without switching the active policy back; different contents under the same ID are rejected. Existing proposals retain their original policy/deadline when a subsequent policy is installed.
- `create(actor, {id, title, evaluation: {bytes, receipt}, risks, rollback, proposedEffect})` requires the Founder or enrolled evaluator. `bytes` is nonempty actual UTF-8 text of at most 1 MiB. `receipt` has exactly `{algorithm: 'sha256', digest, size}` and is recalculated from those bytes. A supplied label or digest is not accepted as proof. The exact proposal schema rejects actor, deadline, status, HTML-rendering and arbitrary extra fields. The returned decision adds `status: 'PENDING'`, per-decision `revision: 1`, server-derived `createdAt`/`expiresAt`, `createdBy`, `expiredAt: null`, `policy: {id, revision}` and `disposition: null`. An exact duplicate ID/content retry returns the existing decision; changed contents are rejected. The returned proposal contains the submitter's own contents; the general evaluator snapshot stays redacted.
- `decide(actor, {decisionId, expectedRevision, requestId, action})` requires the exact Founder. `expectedRevision` refers to the decision, not the store. Actions are only `APPROVE`, `REJECT` or `DEFER`, producing terminal `APPROVED`, `REJECTED` or `DEFERRED`. The decision revision increments, and `disposition` records `{action, actorId, requestId, decidedAt}`. DEFER does not extend the window or reopen a decision; reconsideration requires a new proposal. APPROVE records a disposition only. There is no effect callback, source modification, promotion or kernel authority grant.
- `snapshot(actor)` returns `{schema, revision, head, policy, decisions, counts}`. Founder additionally receives historical `policies` and `audit`, full evaluation bytes, risks, rollback and proposed effect. Evaluator/Witness snapshots omit those private fields and the policy basis, including from audit (no audit is returned). Public decision titles, times, IDs, source actor IDs and terminal dispositions are intentionally visible. The host should choose public-safe titles. Snapshot observes overdue pending decisions using the actual host clock and durably records `expiry-observed`, attributed to `decision-service`; it does not invent a Founder disposition.
- `close()` drains accepted queued work and releases the owned writer lease. Concurrent callers share one close promise, so each waits for actual lease release. Later operations fail closed. The directory must be an actual directory and its saved envelope a regular file, not a symbolic link.

## Ordering, expiry and replay

Authorization and exact input-shape checks occur before queueing. Inputs are copied synchronously, so callers cannot mutate queued authority or evidence. Requests serialize through one writer.

For a decision request, a previously persisted request ID is checked before reading the clock or checking the current revision. Only an exact match of actor, decision, action and expected revision returns its original result. A changed binding is `REQUEST_ID_REUSED`. Both successful and valid but rejected attempts (expired, stale revision, terminal) retain their original outcomes, so retries remain stable across restarts. Unknown decision IDs and malformed/unauthorized requests are rejected without creating a request record.

For a new valid attempt, an overdue pending decision becomes EXPIRED first; the equality boundary `now >= expiresAt` is expired. Expiry wins over a stale revision, and the rejected attempt is committed with its `DECISION_EXPIRED` outcome before rejection is returned. Otherwise, revision mismatch wins over an existing terminal disposition. Simultaneous approve/reject requests with the same expected revision cannot both succeed. An accepted disposition remains historical after its review window passes; it is not retroactively expired.

Important errors include `POLICY_UNCONFIGURED`, `FOUNDER_REQUIRED`, `CREATOR_REQUIRED`, `ACTOR_REQUIRED`, `INVALID_POLICY`, `INVALID_PROPOSAL`, `INVALID_DECISION`, `DECISION_ID_REUSED`, `POLICY_ID_REUSED`, `DECISION_NOT_FOUND`, `REQUEST_ID_REUSED`, `REVISION_MISMATCH`, `DECISION_TERMINAL`, `DECISION_EXPIRED`, `INVALID_CLOCK`, `CLOCK_REGRESSION`, `DECISIONS_LOCKED`, `DECISIONS_TAMPERED`, `DECISIONS_CLOSED`, `DECISIONS_UNCERTAIN`, `DECISION_PERSISTENCE_FAILED` and `DECISIONS_CAPACITY`.

## Persistence and recovery

The private directory contains `.decisions.lock` and `decisions.json`. The canonical envelope includes an SHA-256 payload checksum, hash-chained events and a projection validated by complete deterministic replay on open. Replay checks actor roles, schemas, byte receipts, policy capture, clock ordering and transition rules rather than trusting the saved projection. A changed projection is rejected even if its outer checksum was recomputed. A rehashed unauthorized event is rejected during replay.

Writes use a new mode-0600 file, file fsync, atomic rename and directory fsync before adopting any in-memory projection or returning a disposition. A persistence error returns no successful disposition and fences the writer: subsequent operations return `DECISIONS_UNCERTAIN`. Close and inspect the durable state before reopening, since a failure after rename could have committed on disk even though success was not returned. Replay and the exact request ID resolve that uncertainty. No automatic stale-lock deletion occurs. Manual offline recovery must first establish that the previous writer is stopped and retain the original envelope/lock and failure evidence.

The current envelope is bounded to 64 MiB and rewritten atomically; this is modest-scale local storage, not a distributed database. Hashes detect inconsistent edits, not a complete coherent rewrite or rollback by an owner of the trusted filesystem. Preserve a trusted external head or versioned backup to detect those cases. Parent-directory/OS permissions and the host clock remain trusted. Unexpected process death leaves a lock requiring manual recovery; this intentionally favors fail-closed behavior over unattended availability.

## Executed verification

`node --test test/institution-decisions.test.mjs` initially failed 22/22 cases because the decision service was absent. After implementation it passed 22/22. Four additional adversarial checks passed. An independent read-only worker found no blocker in the trusted-host boundary and separately executed 26/26 passing tests (225.42 ms). Subsequent real probes exposed a concurrent-close race: the second close caller could return while the first was still releasing the lease (20/20 probes). A new regression failed before replacing separate close paths with one shared promise. The final focused run passed **27/27, 0 skipped, 0 failed** (254.88 ms reported by Node).

Coverage executes actual disk persistence/restart, exclusive and synthetic stale locks, exact byte verification, concurrent requests and close callers, deadline equality, durable rejected-request replay, terminal deferral, redaction, mutation isolation, clock rollback, hash-chain/projection tampering, authority replay despite recomputed hashes, symbolic-link rejection and a real atomic-rename persistence failure induced by a directory at the target path. The failure test confirms the writer is fenced and recovery sees the previously durable pending decision.

These focused tests do not establish public hosting, production authentication deployment, a fresh cloud restoration, independent witnesses or a successful institutional improvement cycle. The parent integration performs the repository suite and authenticated HTTP/browser checks separately.
