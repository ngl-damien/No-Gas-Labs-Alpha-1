# Courier Lock Ownership and Retry-Budget Checkpoint — 2026-10-28

## Fresh baseline and supersession check

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- `main` at branch creation and final recheck: `a29caf62f737f41544d38b84966f80f834e0fef2` (`fix(security): harden Founder data path and courier lock races`).
- PR #142 is merged; its Founder-path/courier false-stale fixes are already in main and were not duplicated.
- Issue #17 remains open for independently controlled Founder key custody/identity, adversarial concurrency, and crash/stale-lock recovery.
- PR #16 remains closed/unmerged; merged PR #18 supersedes its self-signing approach.
- New branch: `fix/courier-owned-lock-release-20261028`.

## Functional changes

1. `src/institution/courier.mjs`
   - Acquire and retain the created lock inode's device/inode identity.
   - Write schema-tagged owner metadata (`ngl.courier-lock.v1`, PID, opening timestamp) and sync it before the transaction proceeds.
   - On acquisition write/sync failure, best-effort cleanup only if the path still names the inode this process created.
   - On transaction release, remove the lock only if the pathname still identifies the acquired inode. A replacement lock with identical bytes is preserved.
   - Check the five-second acquisition deadline at the top of every retry loop, so path-change/malformed-file `continue` paths cannot bypass the timeout.
2. `test/institution-courier.test.mjs`
   - Add a deterministic same-byte/different-inode replacement test; verify the replacement survives and the read-only inspector recognizes the schema-tagged metadata while retaining `safeToRemove: false`.
   - Add a deterministic malformed-lock retry test using a controlled clock; assert bounded `BUSY` failure rather than unbounded retry.
3. No production key material, identity assertions, automatic stale-lock deletion, or Founder approvals were added.

## Commits

- `39475b9c4810c0d5a42674505f3b56c7002f2d0e` — owner-aware lock release, synced diagnostic metadata, and acquisition-failure cleanup.
- `2f91def9ec0013b54f2cef00166d032977ab840e` — enforce the deadline on every retry path.
- `794b3540abd74d2cae62dcb942f72ed37ed22f4d` — replacement-lock and inspector integration regression.
- `c85cd6c10c084e3cd9bb6b0ddb41e2e6aa564c4b` — bounded malformed-lock retry regression.
- Checkpoint commit follows.

## Verification status at checkpoint creation

- GitHub-hosted PR workflows: **pending** for this new branch/head; inspect the exact final PR head before claiming success.
- No local test run is claimed.
- The new tests are regression intent until observed passing in CI.

## Security boundary and unresolved risks

- The release guard is an inode check followed by unlink, not an atomic compare-and-unlink primitive. A narrow race remains between the final identity check and unlink; this patch does not claim to eliminate it.
- PID probes remain advisory. No automatic stale-lock recovery is introduced.
- A configured fingerprint or local key is not proof of Damien's real-world identity or independent private-key custody.
- Production world-attestation trust roots remain absent/unwired; linked NGL Mesh APK/RAE integration is not established by this work.

## Next run

1. Inspect all exact-head GitHub Actions workflows for this PR. If any fail, inspect job logs, fix the demonstrated defect, and rerun.
2. Reinspect current `main`, PR states, and Issue #17 before selecting further work.
3. Continue safe crash/concurrency acceptance; do not unlink a potentially live or replacement lock automatically.
4. Keep the PR draft/unmerged pending verification and Founder authorization. Do not merge, deploy, publish a release, spend money, or provision/rotate/revoke production keys.
