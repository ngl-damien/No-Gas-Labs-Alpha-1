# Stutter-step checkpoint: ledger uncertain-commit read guard

Date: 2026-10-27 UTC

## Fresh-state inspection

- Alpha One `main` was re-read at `e3f7c0c8effd383b76c2d68df54d051b333d511c`.
- PR #99 is merged at that main head; bounded persisted Founder-key reads are already present.
- PR #100 is open and unmerged at `e78058b593bb0319cef3e1801268fd08fb2749d2`; its full verification, Genesis Evidence Invariant, and browser acceptance have all completed successfully on that exact head. This work does not overlap its login-throttling changes.
- Issue #17 remains open for independent Founder-key custody/identity, adversarial concurrency, and crash/stale-lock recovery. The signed-attestation adapter in PR #76 is not wired into the live mutation path and has no production trust roots.
- The current ledger latches writes after a post-rename directory-sync failure, but its `state`, `events`, and `head` getters still exposed the prior in-memory projection after that uncertainty. That was the selected source-backed defect.

## Functional implementation

1. Commit `4ccb530f79b1ad52d03f586e76ac457628a8b590`: add one fail-closed read guard shared by the ledger `state`, `events`, and `head` getters. After `COMMIT_DURABILITY_UNCERTAIN`, these getters now raise the same explicit code until the writer is closed and a fresh open validates the visible ledger.
2. Commit `1335868987581fa529653fde82812234db27f235`: add a regression that injects directory-sync failure after ledger rename, verifies append rejection and all three getter rejections, then closes/reopens and verifies the visible ledger by deterministic replay.

The test uses a temporary directory and injected sync failure only; it does not simulate actual power loss or prove filesystem-specific crash durability.

## Verification status

- Exact-head GitHub Actions have not yet been triggered for this branch; open a draft PR and inspect Full verification, Genesis Evidence Invariant, and browser acceptance before reporting success.
- No local test run is claimed.

## Next priorities

1. Inspect the three exact-head workflows. If any fail, inspect completed job logs, repair the source/test defect, and rerun.
2. Re-read PR/base/head and current `main` after CI; preserve this PR as draft and unmerged.
3. Continue Issue #17's independently controlled key-custody, concurrent-writer, and crash/stale-lock acceptance work without fabricating Founder identity evidence.
4. Reconcile PR #63 and signed-attestation PRs against current `main`; do not merge stale/divergent branches wholesale.
5. Keep production observation trust disabled until independently controlled trust roots and live mutation-path integration are verified.

No merge, deployment, release, spending, production key provisioning/rotation/revocation, or Founder-identity claim occurred.
