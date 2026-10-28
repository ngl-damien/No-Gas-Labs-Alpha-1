# Recovery Reference Budget — Checkpoint (2026-10-28)

## Fresh state and supersession

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- Fresh `main` ref observed at `2352d1831a466969e669c4cac2196725601a5e2f` (PR #136 read-only writer-lock diagnostics).
- PR #137, `fix/recovery-reference-stable-read-20261028`, head `aedc77d09a4b808d40b1554b4f93ea009aa7b1b9`, is open/draft/unmerged. Its exact-head `verify` run 40654421499, Genesis Evidence Invariant run 40654421503, and browser acceptance run 40654421498 all reported success before this stacked change.
- This branch is stacked on PR #137 so the stable-read implementation is not duplicated into another main-based PR. Do not merge this stack before its base is reconciled.
- PR #16 is closed/unmerged and superseded by merged PR #18. Issue #17 remains open for independently controlled Founder identity/key custody, adversarial concurrency, and safe crash/stale-lock recovery.
- PR #76 remains draft and unwired into the live mutation path; production trust roots are absent. Linked `ngl-damien/ngl-mesh` PR #1 remains draft; its isolated operator trust tests do not prove full APK/RAE integration, and required reference artifacts remain absent.

## Functional changes on this branch

Branch: `fix/recovery-reference-budget-20261028`.

1. Added explicit limits: continuity record 1 MiB (existing), at most 128 reference entries, at most 64 MiB per reference, and at most 128 MiB aggregate reference bytes per run.
2. Added preflight continuity-record validation for required control-field types, plain object boundaries, reference descriptors, and duplicate reference paths. Invalid records fail before reference I/O.
3. Added `verifyRecoveryReferences()` so the CLI and tests use the same bounded verifier. It emits a receipt per reference, reports mismatches/errors without marking them verified, and includes aggregate `bytesRead` in the report.
4. Changed the stable reader to read no more than its configured byte limit. If a file changes during reading, consumed bytes are attached to the error and charged to the aggregate budget.
5. Added regression tests for malformed control fields, duplicate paths, more than 128 references, Windows-style path traversal, aggregate-budget exhaustion with continued bounded processing, and byte accounting for a digest mismatch.

The CLI remains read-only. It does not remove locks or rewrite the continuity record.

## Current implementation commits

- `e4397091cc0ea297aa0daa90ab2854ca7f9038b7` — introduce bounded recovery-reference verifier and schema preflight.
- `8bee6e79623f7b9d219266ab03aa225ddb92fa82` — refine stable-read byte accounting.
- `020d7abceeb59e2c8a5a879e16c79e77b9813094` — adjust reference path guards.
- `81d0b703d9cb9d20f0d0924a0a5730f68d7ae5db` — correct restricted-path regex.
- `5a3bf08b66a7ce16f5daad9c62dc0f9fa2567855` — integrate validation and budgets into the recovery CLI.
- `04ea4db8d5a16a5bef0236d101edadd609530f95` — preserve diagnostic output contract.
- `36102b2b2f55a973d06859afa3481315b3fea533` — restore newline-separated diagnostics.
- `f3bf089f57eec4ac43c6b8b1d3ec509f20579d19` — add schema/count/aggregate-budget tests.
- `e14f0c7d70f96304b76a2f7e838464368a5c7c66` — cover Windows-style traversal and clarify byte-budget assertion.

The checkpoint commit and final PR head must be inspected after CI starts.

## Verification boundary

- PR #137's exact head passed all three workflows listed above.
- This stacked branch has not yet received exact-head CI results at checkpoint creation. Do not infer its verification from PR #137.
- No local test execution is claimed.
- The existing default continuity record contains ten references and a previously observed stale digest for `src/institution/decisions.mjs`. Do not silently re-pin that digest; preserve the mismatch as evidence until a deliberate provenance decision is made.

## Remaining blockers / next steps

1. Open a draft stacked PR against PR #137's branch, then inspect `verify`, Genesis Evidence Invariant, and browser acceptance on the final checkpoint head; repair only observed failures.
2. Confirm the aggregate byte-budget tests pass and the default command reports all ten receipts without exceeding its limits.
3. Review the stale `decisions.mjs` digest separately; never rewrite a historical evidence pin merely to make CI green.
4. Continue Issue #17's concurrency and crash/stale-lock acceptance without automatically deleting potentially live locks.
5. Keep production Founder trust fail-closed until independently controlled identity/key custody and actual mutation-path integration are demonstrated.

No merge, deployment, release, spending, or production key operation occurred. A digest match proves byte equality to the recorded value, not the truth of the record or its author's identity.


## Follow-up cycles after initial CI inspection

### Compatibility repair

- Exact-head full verification run `40655653662` initially failed two pre-existing `test/institution-continuity.test.mjs` cases. The new schema preflight had incorrectly required `mission` and object-shaped `machinery.M0/M1`, while the existing accepted fixture omits `mission` and uses string values for `M0/M1`.
- Inspected the actual job log, then repaired the validator in commit `9fc81feccd3c29b54b7d2335dc92f929773f75d5`: `mission` remains optional for legacy records (but must be a non-empty string if present), and `M0/M1` accept either strings or plain records. This preserves existing v1 recovery compatibility without removing the new reference/count checks.
- Follow-up run `40655827469` reported the full test/build/institutional exercise step successful, and Genesis Evidence Invariant run `40655827546` passed. Browser acceptance run `40655827448` was still installing dependencies at last inspection. These results are for the pre-receipt head `9fc81feccd3c29b54b7d2335dc92f929773f75d5`, not the final head.

### Exact continuity-record receipt

- Added `continuityRecord.path`, `continuityRecord.size`, and SHA-256 over the exact bounded bytes parsed by the recovery command. This makes the input record used for a run auditable without asserting its author or truth.
- Commit `4ed9239ef2de3a3af0fac80756dc8ab537f92724` adds the receipt; `f7985dd2e546ce48e6160e2718e700cca304eb1b` tests it against the exact serialized test fixture and the repository's default continuity record.
- The final checkpoint commit and final PR head must each be inspected, and all three workflows must be checked again after the last commit. No earlier green result is transferable to a later head.


## Verification observed on code head before this checkpoint refresh

Code head: `01d5290e1b8c857ed2a8caafccb3f3a10284b89b`.

- Full repository verification run [40655995630](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40655995630): **success**. The Node test runner exited 0; Python inspector exited 0; package build exited 0; bounded institutional exercise exited 0 and reported `passed: true`.
- Genesis Evidence Invariant run [40655995607](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40655995607): **success**, including the attack-evidence-boundary step.
- Browser acceptance run [40655995573](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40655995573): **success**. Dependency installation, standalone build, browser journeys, and receipt/screenshot preservation completed.
- These are GitHub-hosted results. No local test execution is claimed.

Follow-up commits after the first checkpoint are `9fc81feccd3c29b54b7d2335dc92f929773f75d5` (legacy schema compatibility), `4ed9239ef2de3a3af0fac80756dc8ab537f92724` (exact continuity-record receipt), `f7985dd2e546ce48e6160e2718e700cca304eb1b` (receipt regressions), and `01d5290e1b8c857ed2a8caafccb3f3a10284b89b` (checkpoint refresh).

The next checkpoint-only commit will change the branch head. All three workflows must be checked again on that final head before declaring it verified.

## Follow-up cycle — enforce the global byte ceiling for caller overrides (2026-10-28)

### Fresh-state reconciliation

- Current `main` is `412022432a45b98ecf931ba5f89a49e701563284`, the source-bound Polymath Academy study-ledger commit. The Academy change is unrelated to recovery; this recovery branch does not edit Academy files.
- PR #137 remains open/draft/unmerged at `aedc77d09a4b808d40b1554b4f93ea009aa7b1b9`, based on the older `main` commit `2352d1831a466969e669c4cac2196725601a5e2f`.
- PR #138 remains open/draft/unmerged and stacked on PR #137. Its prior verified head was `ab32929355aa3cb2ab6f3b0ad17f4baa9af51784`; the two functional follow-up commits below supersede that verification. The final checkpoint commit also requires exact-head CI.
- PR #16 remains closed/unmerged and superseded by merged PR #18. Issue #17 remains open for separately controlled Founder identity/key custody, adversarial concurrency, and safe crash/stale-lock recovery.

### Source-backed defect and implementation

The default budgets were bounded, but the exported helpers accepted caller overrides above the documented global limit:

1. `readStableRegularFile()` accepted any positive safe integer for `maxBytes`, permitting a direct caller to bypass the 128 MiB ceiling.
2. `verifyRecoveryReferences()` validated that `maxTotalBytes` was positive but did not reject values above `MAX_RECOVERY_TOTAL_BYTES`.

Implemented and regression-tested:

- `d924b7901ee45ffc2ace12a1de6dcfc50489f933` — enforce the global ceiling on stable-reader overrides; test rejection before filesystem access.
- `5808768365affee476bc8596d259b7d819c4c864` — enforce the aggregate reference-byte ceiling on verifier overrides; test rejection before reference I/O.

The default remains 128 MiB aggregate, 64 MiB per reference, 1 MiB for the continuity record, and 128 references. This closes an API-level budget-override bypass; it does not remove the documented best-effort pathname/TOCTOU limitation.

### Verification boundary

- The previous head `ab32929355aa3cb2ab6f3b0ad17f4baa9af51784` had successful GitHub-hosted `verify`, Genesis Evidence Invariant, and browser acceptance workflows (runs 40656284321, 40656284316, and 40656284222). Those results do **not** establish the new commits or final checkpoint head.
- Exact-head CI must be inspected after this checkpoint commit. No local test execution is claimed.
- The default continuity record's stale digest for `src/institution/decisions.mjs` remains unmodified. A digest mismatch is preserved as evidence pending a deliberate provenance decision.

### Next prioritized steps

1. Inspect all three workflows on the final PR #138 head; repair only observed failures and rerun after any code change.
2. Reconcile PR #137 and the stacked PR #138 against current `main` before integration; do not merge the stack blindly.
3. Investigate the stale continuity digest as a separate provenance decision; do not silently re-pin it.
4. Continue Issue #17's concurrency and crash/stale-lock acceptance without deleting potentially live or replacement locks.
5. Keep Founder trust fail-closed until a separately controlled signing operation and actual mutation-path integration are demonstrated.

No merge, deployment, release, spending, or production key operation occurred. A configured fingerprint or hash match is not proof of Founder identity, private-key custody, or the truth of a claim.
