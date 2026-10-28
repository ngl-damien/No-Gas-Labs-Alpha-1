# Founder Data Directory Boundary — Checkpoint (2026-10-28)

## Fresh state and decision

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- Starting `main`: `c5b854d8742b0af9439766d487874ccb59021c8a` (confirmed identical to the current `main` ref before branch creation).
- PR #137/#138 recovery work remains open and stacked; it is not duplicated by this change.
- PR #16 remains closed/unmerged and superseded by merged PR #18. Issue #17 remains open.
- The current key-file reader already checks file type, no-follow opening, file permissions, current-process ownership where available, byte limits, and stable file identity. This change is limited to the containing data-directory boundary.

## Functional changes

1. Require the Founder data directory to grant the owner read/write/execute permissions.
2. Continue rejecting group/other permissions.
3. Require current-process ownership on platforms exposing `process.getuid()`.
4. Include directory UID and permission bits in the startup snapshot and reject a change between the pre-key and post-key checks.
5. Add regression coverage for owner mode 0500 and group/other-accessible mode 0755, asserting that rejection happens before any Founder key file is created; existing server tests continue covering successful use of a valid private directory.

## Verification boundary

- Branch: `fix/founder-data-directory-boundary-20261028`.
- Final implementation head after the no-side-effect regression: `6aeaa857df119dd86d4f31fb8281ca31fe50f092` (test commit; a checkpoint refresh follows). Exact-head GitHub Actions verification is required.
- No local test execution is claimed.
- The mode/owner snapshot detects differences visible at the two checks; it is not an atomic directory-handle capability boundary and does not eliminate every filesystem race.
- Local file permissions and a shared secret do not establish Damien's real-world identity or independent private-key custody.

## Unresolved blockers and next steps

1. Inspect full repository verification, Genesis Evidence Invariant, and browser acceptance on the final PR head; repair only observed failures.
2. Continue Issue #17's independently controlled signing and crash/concurrency acceptance.
3. Reconcile the recovery PR stack against fresh `main`; do not merge it automatically.
4. Keep production trust fail-closed until an independently controlled signing operation and actual mutation-path integration are demonstrated.

No merge, deployment, release, spending, production key operation, or Founder decision occurred.
