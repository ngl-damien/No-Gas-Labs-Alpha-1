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


## Follow-up cycle — reject symlinked ancestors before creating runtime state

- Source fix commit: `f476656682a22a0e2373da92c21c2f9e7c3cf036`.
- Regression test commit: `3c518b58c67a3286c751fa44101deb9395fe2793`.
- Fresh source review found that the original directory guard used `lstat(dataDir)` only after `mkdir(dataDir, { recursive: true })`. A real final directory reached through a symlinked parent could therefore be created before the later service-store path walk rejected it.
- `createGameServer()` now walks existing path components before recursive creation and rejects symlink or non-directory ancestors. The test asserts that a runtime directory is not created through a symlinked parent.
- Limitation: this is a best-effort pathname walk, not an atomic `openat` capability boundary; same-user races are not eliminated.
- Required next verification: full repository verification, Genesis Evidence Invariant, and browser acceptance on the exact checkpoint head. No local test execution is claimed.


## Follow-up cycle — recheck path ancestry at credential boundaries

- Source commit: `cbc2eb6aca44e1786434b8d1dee954d7c3085f36`.
- The path walk now also runs inside `assertPrivateDataDirectory()`, so it is repeated after recursive directory creation and at the existing post-key check. This narrows the interval in which a visible symlinked-ancestor replacement could escape detection.
- This remains best-effort pathname validation; it does not make the sequence atomic or eliminate same-user races. No production identity or key-custody claim follows from this check.
- The exact final head must pass full repository verification, Genesis Evidence Invariant, and browser acceptance.


## Follow-up cycle — repair verification failures and stale-lock race

- Test assertion repair: `7eed4ce9f5cd7018a4a6a9ca60282692ea6b7d1d`. The new pre-mkdir ancestor check intentionally rejects a final symlink earlier than the old final-directory validator; the existing test now accepts either correct fail-closed message.
- Courier lock race fix: `219a36d35118284882bcc86615011e796d9ba8f7`. The failed full-verification log showed the existing concurrent-client test could report `STALE_LOCK` while a lock pathname was being released/reacquired. Lock metadata is now read from a stable file snapshot; after an `ESRCH` PID probe, the code rechecks that the exact observed device/inode still occupies the path and probes the PID again before reporting stale.
- The courier fix does not delete stale locks and does not infer safety from a PID probe alone. The existing concurrency regression is the verification target.
- The exact final head requires full repository verification, Genesis Evidence Invariant, and browser acceptance. Prior failure was observed in full verification: 548/550 tests passed; failures were the changed Founder-directory error expectation and the courier concurrency race. No local tests are claimed.
