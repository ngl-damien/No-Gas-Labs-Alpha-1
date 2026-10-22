# Meteor independent mechanism review

Review date: October 17, 2026. Scope: the institutional kernel and durable ledger, signed file courier/CLI, Forge runner/CLI/workload, their focused tests, and their stated contracts. This review did not assess the HTTP/browser integration or run the complete repository suite. All exploit probes used disposable temporary repositories/stores and generated fixture keys; no real credentials were read.

Status: **ready for root integration within the documented mechanism scope; all four findings resolved and independently verified**. The original focused suites passed **41/41**, but those passing tests did not cover these probes. Source owners received exact reproductions and added regressions. Final independent verification command:

```sh
node --test test/institution-kernel.test.mjs test/institution-courier.test.mjs test/forge-runner.test.mjs
```

Observed final result: **46/46 passed**, zero failed/skipped/cancelled, approximately 3.57 seconds (20 kernel, 16 courier, 10 Forge). This is a focused mechanism result; root still owns complete repository/browser/integration acceptance.

## Findings

### P1 — historic signed receipts could be rebound to a different containing request

Location: `src/institution/courier.mjs`, `validateState` calls to `receiptCheck` for stored acknowledgments/replies.

Reproduction: dispatch requests A and B to the same enrolled seat; legitimately sign and import A's acknowledgment and response. In `courier.json`, copy A's complete seat into B, set B's aggregate status to `RESPONDED`, and recompute the public checksum with `payloadDigest`. Reopening originally accepted both requests as responded even though B's response explicitly signed A's request ID and input. No signature was forged and the enrolled public key was unchanged. Validation found the request addressed by a signature but did not bind that result to the containing request/seat being replayed. This could attach a genuine response and dissent to work that never received them.

Fix status: **resolved and independently verified**. Owner added exact enclosing request/seat binding and cross-request/cross-seat regressions. The independent original probe now fails with `CORRUPT_STATE: Persisted receipt does not bind its enclosing request and seat`; the courier suite passed 15/15 after this change.

### P1 — concurrent stale-lock recovery could lose successful dispatches

Location: `src/institution/courier.mjs`, `acquireLock` automatic dead-PID unlink and `serialize` lock cleanup.

Reproduction: initialize an empty store and create `.courier.lock` containing `{ "pid": 2147483647 }`, a nonexistent fixture PID. Synchronize six actual Node children to reopen that store and dispatch distinct request IDs. Multiple recoverers inspect the stale owner, then unlink by pathname after another process has acquired a fresh lock. Observed in a 20-round disposable probe: **four children returned successful dispatches, but reopening retained only three requests**. Other children also failed with `ENOENT` while unlinking locks. Therefore the race is not merely an error-reporting issue: a successful mutation can disappear.

Fix status: **resolved and independently verified**. Dead-PID ownership now rejects with `STALE_LOCK` without deleting the file. Documentation requires stopping/preventing all courier clients before explicit operator removal. An independent six-process synchronized probe observed all stale clients reject, the original lock remain byte-identical, and zero requests written. After every child stopped and the fixture owner explicitly deleted the lock, six ordinary concurrent clients all returned success and reopening retained six distinct requests. The new owner regression and all 16 courier tests passed. Ordinary live-lock contention remains serialized; stale-lock availability now requires deliberate recovery instead of unsafe automatic unlink.

### P2 — Forge output containment used lexical paths and could write into source

Location: `src/forge/runner.mjs`, `compareCandidates` output-directory checks before snapshot/copy.

Reproduction: create a temporary Git fixture at `/tmp/<fixture>/source`; create `/tmp/<fixture>/alias` as a symlink to `source`; call `compareCandidates` with `sourceDir` set to the real source and `outDir` set to `/tmp/<fixture>/alias/unguarded-output`. The lexical relative-path check allowed it. Forge returned a passing report and created the complete output under the source checkout's unignored `unguarded-output/`; `git status` reported `?? unguarded-output/`. The source-file symlink rejection does not protect the output path's existing ancestors.

Fix status: **resolved and independently verified**. Forge determines the physical output location through existing ancestor directories and applies containment before creating output. The original alias probe now throws the source guard; regression coverage confirms intentional `.runtime/` output still works. Forge suite passed 10/10.

### P2 — a candidate could disable the verifier's assertions without changing files

Location: `fixtures/forge/workload/verify.mjs` and `src/forge/runner.mjs` acceptance of verifier success JSON.

Reproduction overlay for the allowed candidate path:

```js
import assert from 'node:assert/strict';
assert.equal = () => {};
assert.deepEqual = () => {};
export function sum(values) {
  return values.length === 10000
    ? values.reduce((total, value) => total + value, 0)
    : 0;
}
```

This returns the wrong result for `[1]` and several other verification cases. Because the verifier statically imports the candidate before using the mutable shared assertion object, the candidate disables its checks. Observed report: `correct:true`, `outcome:"passing"`, integrity `{passed:true,changedPaths:[]}`, verifier stdout `{"verified":true,"cases":7}`. The benchmark checksum remains correct, so its separate parent check does not expose this error.

The documented trusted-local-code boundary limits the severity: this does not assert an adversarial OS sandbox exists, and arbitrary malicious same-user code remains outside that boundary. It does show that a success record is weaker evidence than independent verification of seven results.

Fix status: **resolved and independently verified**. The verifier captures primitive serialization/I/O before dynamically importing the candidate; the parent checks every returned numeric result and post-call input vector against its own challenge. The original overlay now reports `correct:false`, `outcome:"failed"` with unchanged copied-file integrity. Regression coverage additionally mutates shared serializers. Forge suite passed 10/10. This strengthens workload evidence without claiming hostile-code containment.

## Other reviewed boundaries

No additional kernel/ledger blocker was found. The scoped suite exercises exact configured actor roles, grant subject/version/action, distinct executor/observer IDs, ordered outputs and actual artifact bytes, observation/adjudication binding, expiry/revocation, stale revisions and competing versions, exact idempotent retries, tampered projections/blobs/chain records, queued writes, and exclusive ledger writers. The host-authenticated identity and host-owned event clock boundaries are explicit and appropriate to the pure replay API.

The ledger's retained-head trust, complete-store rewrite/rollback limitations and ambiguous post-rename filesystem failures are documented. Forge's same-user filesystem/network access, resource limits and lack of a hostile-code sandbox are documented; this review does not elevate them into an unstated containment promise. Neither local signed fixture execution nor distinct configured IDs establishes independent humans, external model execution, or Founder permission.
