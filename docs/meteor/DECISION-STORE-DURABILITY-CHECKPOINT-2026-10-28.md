# Decision Store Durability Checkpoint — 2026-10-28

## Fresh-state basis

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- Base `main` observed at `2c5856cffc3ce951c64ede242a72164d64e0d778`; rechecked unchanged during implementation.
- Safe branch: `fix/decision-store-durability-uncertain-20261028`.
- Existing Issue #17 explicitly requires safe crash recovery and preservation of the `COMMIT_DURABILITY_UNCERTAIN` distinction.
- Existing service-store and institutional-ledger code already distinguish a post-rename directory-sync failure. The decisions store did not: it converted every atomic-write failure into `DECISION_PERSISTENCE_FAILED`, losing the fact that a replacement might already be visible.
- Existing decision tests covered a generic persistence failure but not an injected directory-sync failure after a successful rename. No open PR matching decision-store durability was found in the fresh search.

## Functional changes

1. **Decision envelope write boundary**
   - Added an injectable directory-sync function for deterministic fault-injection tests.
   - After the atomic rename, a directory-sync failure now surfaces as `COMMIT_DURABILITY_UNCERTAIN` with HTTP status 503.
   - The code does not roll back or claim the previous envelope is durable after the replacement may already be visible.
   - The in-memory projection is not promoted on that failure; the writer is fenced until close/reopen and validation.

2. **Subsequent reads/writes**
   - A writer fenced by post-rename uncertainty preserves `COMMIT_DURABILITY_UNCERTAIN` for subsequent operations rather than collapsing it into the generic `DECISIONS_UNCERTAIN` code.
   - Other persistence failures retain the existing generic fenced behavior.

3. **HTTP status mapping**
   - Decision endpoints now map persistence/uncertainty errors to HTTP 503 rather than the generic 400.
   - Added an integration test that injects a post-rename directory-sync failure through the live decision HTTP route and verifies the original uncertainty code and 503 on the initial request and a retry.

## Regression coverage added

- Post-rename directory-sync failure preserves `COMMIT_DURABILITY_UNCERTAIN`, blocks further reads/writes, and permits only a fresh validated reopen to expose the retained decision.
- Initial decision-envelope creation distinguishes post-rename uncertainty and releases its writer lock after startup failure.
- Live HTTP decision route returns 503 with `COMMIT_DURABILITY_UNCERTAIN`; retry remains fenced with the same classification.

## Commits on this branch

- `d9e291a061337ac2472e407615c883ed15dc3861` — preserve post-rename uncertainty in decisions store.
- `2010a4bef0159cfb96168b69f16abf7f52040462` — add two decision-store durability regression tests.
- `a3531752178c58f624b30238eacfe56aaff89251` — map decision persistence/uncertainty to HTTP 503 and add the controlled sync seam.
- `bc91daee9f44756a26cae66148aca0ed369c92ec` — add HTTP regression coverage.
- This checkpoint commit records the handoff after those four implementation commits.

## Verification boundary

- Branch head before checkpoint: `bc91daee9f44756a26cae66148aca0ed369c92ec`.
- At that point, comparison against `main`: 4 commits ahead / 0 behind; four changed source/test files.
- GitHub Actions for the eventual PR head must be inspected before claiming tests passed. A successful result on an earlier head does not validate the final checkpoint commit.
- No local test run is claimed.
- No production decision was made, no live decision data was modified, and no lock was deleted.

## Unresolved limits and next priorities

1. Inspect all exact-head Full Repository Verification, Genesis Evidence Invariant, and Browser Acceptance results; repair only demonstrated failures and rerun.
2. Reconcile the open storage-hardening PRs against current `main` before integration; PR #60's service-store/ledger work does not replace this decisions-store-specific regression.
3. Continue Issue #17's crash-window acceptance without automatic stale-lock deletion.
4. PR #16 remains closed/unmerged and is superseded by merged PR #18. Independent Founder identity/private-key custody is still unproven; no production trust root or separately controlled signing operation is provisioned by this change.

No merge, deployment, release, spending, production key operation, or Founder decision is authorized or claimed.
