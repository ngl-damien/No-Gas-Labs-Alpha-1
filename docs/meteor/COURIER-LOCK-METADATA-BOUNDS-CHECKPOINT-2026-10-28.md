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


## Run continuation addendum — duplicate-key ambiguity

A second source inspection found that bounded, schema-checked lock metadata still passed through `JSON.parse` without duplicate-key preflight. Last-key-wins parsing could make a duplicated `pid` ambiguous before stale-lock classification.

- Imported the existing `assertNoDuplicateJsonObjectKeys` from `src/strict-json.mjs`.
- Duplicate object keys, including escaped spellings that decode to the same key, now fail as `CORRUPT_LOCK` rather than being interpreted as owner metadata.
- Added two regressions for duplicate `pid` and escaped duplicate `p\\u0069d`; both assert the lock and persisted state remain unchanged.
- Source commit: `58b1e963702f0cb58baeaeee34539458cfccd080`.
- Duplicate-key test commit: `2924363fbc6a4e6a2e7940b99d26374df4b9ecf7`.
- At the last workflow inspection on test head `2924363fbc6a4e6a2e7940b99d26374df4b9ecf7`, Genesis had a successful run, while verify and browser acceptance were still in progress. Earlier verify and Genesis runs passed on source head `58b1e963702f0cb58baeaeee34539458cfccd080`; browser acceptance remained in progress there too.
- `main` was re-read at `fc1d313152aa17ea90ff5cbd76a3e0cda8d76dbf`; the open PR list contained this new PR #154 plus 11 pre-existing PRs. No base movement or competing courier-lock PR was observed.
- This checkpoint refresh changes HEAD again; inspect all three workflows on the exact resulting head before claiming final verification.


## Run continuation addendum — lock permission and malformed JSON

Fresh reinspection on 2026-10-28 found that PR #154's bounded, schema-checked reader still had two gaps in `acquireLock()`:

1. Existing lock metadata was checked for file type and schema but not for group/other permissions or current-process UID ownership. This was inconsistent with the read-only lock inspector's fail-closed checks.
2. Stable malformed/deep JSON in the duplicate-key preflight and the subsequent `JSON.parse` catch used `continue`, retrying the same unchanged lock in a tight loop rather than reporting corruption. A malformed lock could therefore consume CPU indefinitely rather than fail closed.

Implemented on the same safe branch:

- Source commit `1a9efe352bb5cdafad99791fb1624f5561af414e`: add a lock-stat safety check for regular-file type, no group/other permissions, and current UID ownership where `process.getuid()` is supported; apply it to both the initial path stat and opened file stat.
- Test commit `c5b8a5aa443979dcc34798712e1180e461b35fa8`: add a regression that chmods an existing lock to `0644`, expects `UNSAFE_LOCK`, and verifies lock bytes and persisted state remain unchanged.
- Source commit `b0296f27c434e0d767e4f29087fd5037a408b536`: classify stable malformed or over-depth metadata as `CORRUPT_LOCK` rather than looping.
- Test commit `21f82cfa6a9020ac31d8c1fa0a7677714d090563`: add a child-process regression with a three-second timeout for malformed JSON; it requires prompt `CORRUPT_LOCK` and preserved lock/state.
- Documentation commit `53c6d9568e3fd7748b30e9d81a6f862dcbaaec12`: document lock ownership/permission checks and fail-fast parse behavior.

The earlier exact head `76756268ec8e68d859af8fff012abb6c359d8994` had successful hosted verify, Genesis, and browser-acceptance workflows. These new source/test/documentation commits change the head, so their final-head workflows must be inspected before claiming current verification.

Fresh repository comparison: `main` is `904067afe9182163b5232516064ffaf740059945`, containing the separately merged PR #153 moonshot-world-object feature. This branch is 12 commits ahead and 1 behind `main`; the only behind commit is the world-view feature, while this PR's four changed files are courier source, courier tests, courier docs, and this checkpoint. No competing open courier-lock-metadata PR was found. Do not force-push or merge automatically; inspect the PR's synthetic merge candidate and all three exact-head workflows.

Remaining limits are unchanged: `lstat` then `unlink` is not atomic compare-and-unlink; PID probes are advisory; stale locks require explicit offline recovery; Issue #17 still requires adversarial concurrency/crash-recovery acceptance and independently controlled Founder identity/key custody. PR #16 is closed/unmerged and superseded by merged PR #18. A configured fingerprint is not real-world identity proof.

No merge, deployment, release, spending, production key operation, automatic lock deletion, or Founder decision occurred.
