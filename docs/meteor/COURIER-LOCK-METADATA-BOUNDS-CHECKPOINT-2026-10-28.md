# Courier Lock Metadata Bounds Checkpoint — 2026-10-28

## Fresh-state basis

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- Base `main` inspected twice during this run: `fc1d313152aa17ea90ff5cbd76a3e0cda8d76dbf` (merge of PR #153, moonshots as navigable world objects).
- Open PRs at the second inspection: 11. PR #152 is merged; PR #153 is merged. No existing open PR specifically owns courier lock metadata bounds.
- Issue #17 remains open. It still distinguishes prototype authorization from independently controlled Founder key custody, and requires adversarial concurrency/crash-recovery evidence.
- Safe branch: `fix/courier-lock-metadata-bounds-20261028`, created from the exact `main` SHA above.
- Source implementation commit: `cf59c3a340e5cfda6e1020dc2b769e02a3d2df4e`.
- Regression-test commit: `399837dbceb6d6a536be5e3bbc0e81f19f985876`.

## Functional changes

1. **Bound lock metadata reads.** A lock path that already exists is capped at 4096 bytes before parsing. Reads consume at most 4097 bytes in 1024-byte chunks, so a lock that grows after its initial stat cannot trigger an unbounded `readFile()`.
2. **Avoid blocking on a raced FIFO.** Lock reads add `O_NONBLOCK` where supported and re-check the opened object type. Symlinks/non-regular objects fail closed as `UNSAFE_LOCK`; they are not opened for an unbounded blocking read.
3. **Validate owner metadata before using a PID.** Explicit schemas must be exactly `ngl.courier-lock.v1` with the expected fields and valid PID/time values. Unknown schemas and malformed recognized-schema fields fail as `CORRUPT_LOCK`. Historical schema-less PID-only lock records remain accepted for compatibility with existing offline recovery tests.
4. **Preserve uncertain evidence.** Oversized and unsupported-schema locks are left untouched, and persisted `courier.json` is checked to remain unchanged in regression tests. No automatic lock deletion or stale-lock recovery was added.

## Regression coverage

Added three tests to `test/institution-courier.test.mjs`:

- Oversized lock metadata is rejected as `CORRUPT_LOCK`; both the lock bytes and persisted state remain unchanged.
- An explicitly unsupported schema is rejected as `CORRUPT_LOCK`; both the lock bytes and persisted state remain unchanged.
- On non-Windows systems, a FIFO at `.courier.lock` is rejected as `UNSAFE_LOCK` within a child-process five-second timeout; the FIFO and persisted state remain intact.

Existing stale-lock coverage uses a schema-less `{pid}` record, so compatibility is exercised by the pre-existing suite.

## Verification boundary

- On source commit `cf59c3a340e5cfda6e1020dc2b769e02a3d2df4e`, GitHub Actions verify [40738053213](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40738053213) passed and Genesis Evidence Invariant [40738053344](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40738053344) passed; browser acceptance [40738053083](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40738053083) was still in progress at inspection.
- On test commit `399837dbceb6d6a536be5e3bbc0e81f19f985876`, Genesis Evidence Invariant [40738172335](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40738172335) passed; verify [40738172577](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40738172577) and browser acceptance [40738172237](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40738172237) were in progress at the last inspection.
- These are hosted workflow observations. No local test run is claimed. After this checkpoint commit, inspect all three workflows on the exact new head before treating verification as current.

## Remaining limits / next priorities

1. Inspect exact-head verify, Genesis, and browser workflows; fix demonstrated failures and rerun.
2. The courier's `lstat`-then-`unlink` release check is still not an atomic compare-and-unlink primitive. Do not call it race-free and do not automatically delete potentially live locks.
3. Continue Issue #17's adversarial writer and crash/stale-lock acceptance while preserving the difference between `STALE_LOCK`, `LOCK_OWNERSHIP_LOST`, and `COMMIT_DURABILITY_UNCERTAIN`.
4. Independently controlled Founder key custody remains unproven. PR #16 is closed/unmerged and superseded by merged PR #18; a configured fingerprint is not real-world identity proof.
5. Signed world-attestation PRs #66/#76 remain unmerged and not proven wired into the live mutation path. NGL Mesh PR #1 remains draft; full APK/RAE integration artifacts are absent.
6. Reinspect `main` and open PRs before any integration. Keep this branch draft and unmerged pending human review.

No merge, deployment, release, spending, production key operation, or Founder decision occurred. No real-world Founder identity proof or autonomous-discovery breakthrough is claimed.


## Run continuation addendum — documentation and CI reinspection

- Added the user-facing `Lock metadata safety boundary` section to `docs/meteor/courier.md` in commit `cc18032cfbbaccbf8d2b6b56237a8b9f20649374`. It documents the 4096-byte cap, non-blocking read boundary, error codes, legacy PID-only compatibility, and the unresolved check-to-unlink race.
- The PR now changes four files: `src/institution/courier.mjs`, `test/institution-courier.test.mjs`, this checkpoint, and `docs/meteor/courier.md`.
- At 2026-10-28 17:43 UTC, exact checkpoint-head CI on `e1313e4d4e46aa987d2937ea9c99a97d96b7a201` showed Genesis Evidence Invariant passed; verify and browser acceptance were still running. Earlier implementation/test heads also had passing verify and Genesis runs, but the latest head must be checked again after each commit.
- This checkpoint refresh itself changes the branch head. Inspect all three workflows on the resulting exact head and update the PR handoff with their final outcomes before treating verification as complete.
- The latest `main` observed before this addendum remained `fc1d313152aa17ea90ff5cbd76a3e0cda8d76dbf`. Re-read `main`, open PRs, and Issue #17 before any future integration; do not merge this draft automatically.
