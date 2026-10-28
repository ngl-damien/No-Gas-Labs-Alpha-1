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
