# Courier Lock Ownership Checkpoint — 2026-10-28

## Fresh-state basis

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- `main` was rechecked at `66e6e211c55caff3c27101103f55f676ef7c0e73`, the merge commit for PR #150.
- Safe branch: `fix/courier-lock-owned-release-20261028`; code/test head before this checkpoint: `06ef95179cab13b482d288c0435533e83c469e29`.
- Direct GitHub REST inspection found 11 open Alpha One PRs and no existing open PR targeting courier lock release ownership.
- Issue #17 remains open for adversarial concurrency, crash/stale-lock recovery, and independently controlled Founder key custody.
- The previous courier implementation unconditionally unlinked `.courier.lock` in `serialize()`, even if the pathname had been replaced since this process acquired it.

## Functional changes

1. **Ownership-bound lock release**
   - `acquireLock()` now returns the acquired file's device/inode identity.
   - Lock owner metadata now records `ngl.courier-lock.v1`, PID, and opening time; the metadata is synced before the lock is considered acquired.
   - Release checks that the current path is still a regular file with the acquired device/inode before unlinking it.
   - If the path disappeared or changed, the operation raises `LOCK_OWNERSHIP_LOST`. The message explicitly warns that a transaction may already have committed and durable state must be inspected before retrying.
   - The affected courier instance is fenced after ownership loss; it cannot continue accepting operations as if its lease remained valid.
   - Acquisition cleanup also attempts to remove only the inode created by that acquisition.

2. **Diagnostics integration**
   - The read-only writer-lock inspector recognizes `ngl.courier-lock.v1`.
   - The inspector continues to return `safeToRemove: false`; no automatic stale-lock removal was introduced.

3. **Preserve post-rename durability uncertainty**
   - `writeState()` now distinguishes a successful rename followed by a failed directory sync as `COMMIT_DURABILITY_UNCERTAIN` and does not attempt rollback.
   - The affected courier instance is fenced from later operations until a fresh `createCourier()` reopens and validates the retained state.
   - A deterministic injected-sync regression verifies that the request may already be present on disk, the old instance remains fenced, and a fresh instance can validate the retained state.

4. **Reject symlinked storage ancestors before creating the courier directory**
   - Added a path-component walk before and after recursive directory creation, matching the fail-closed boundary already used by the decisions store.
   - A regression creates an alias to an existing directory and verifies courier initialization rejects the symlinked ancestor before creating descendants through it.

5. **Regression coverage**
   - Replaces the lock inode from the transaction clock callback while dispatch is in flight, keeps the displaced inode alive to prevent inode-number reuse, and verifies that the replacement survives.
   - Verifies that a replacement during a committed dispatch returns `LOCK_OWNERSHIP_LOST` while the request is in fact present in durable state.
   - Verifies that a replacement is also preserved when the transaction itself rejects.
   - Verifies that the same courier instance remains fenced after either replacement scenario.
   - Verifies that the replacement's courier schema is recognized by the diagnostic inspector.
   - Extends the inspector schema regression to include the courier lock.

## Commits

- `e9be8b4755ceb9e75ea20d6f00ce80434d59b74f` — capture lock identity, persist owner metadata, and refuse to unlink a replacement.
- `211186d248cd7e759600a8f6f93bc96a8db985ce` — add replacement-lock success/failure-path regressions and diagnostic assertion.
- `d561b6ce080f0910ed5547d5b4cb1b5d38a2f1cc` — recognize the courier lock schema in the inspector.
- `80ca5177af493009807ac5dd6b110c297e859460` — cover courier schema in inspector regression.
- `06ef95179cab13b482d288c0435533e83c469e29` — treat disappearance during unlink as ownership loss.
- `1d2185773eaafbe88225311c4f48e9341ab1e079` — reject symlinked courier storage ancestors before and after directory creation.
- `1d51e1dc62956998397080a47c9e9684161b3991` — add symlinked-parent regression coverage.
- `4192a80de2bd1ff98a2f5b644ba2bc79e9ce84a7` — distinguish post-rename directory-sync uncertainty and fence the current instance.
- `fd007fd4aabed1d3a186189c965af9d96731e071` — test uncertain commit visibility and fresh-instance validation.
- `bd06442248de7a623dfc194844b915e3a059aa89` — fence the current courier instance after lock ownership loss.
- `6e4ed84954ba266785b30a064c578d76d61aa24b` — test continued fencing after lock loss.

## Verification boundary

- On prior head `52d0a2983b33bc72e07820eb96e7b838a2e539da`, Full Repository Verification [40719472942](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40719472942), Genesis Evidence Invariant [40719473744](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40719473744), and Browser Acceptance [40719472951](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40719472951) all passed. That head included the lock-release and symlink-ancestor changes but predates the new post-rename durability fence.
- The later durability source/test changes, lock-loss instance fencing, and this checkpoint refresh require exact-head workflows of their own.
- GitHub Actions for the final PR head must be inspected before claiming tests passed.
- No local test execution is claimed.
- No lock was deleted by this change except a lock inode still matching the identity acquired by this operation.
- No merge, deployment, release, spending, or production key operation occurred.

## Remaining limitations and next priorities

1. Inspect Full Repository Verification, Genesis Evidence Invariant, and Browser Acceptance on the exact PR head; repair demonstrated failures and rerun.
2. The `lstat`-then-`unlink` release check is best-effort, not an atomic compare-and-unlink primitive. A narrow replacement race between those operations remains.
3. If ownership is lost after a transaction, the commit outcome can be ambiguous; callers must inspect durable state before retrying.
4. Stale locks still require explicit offline operator recovery. Do not auto-delete a lock based on PID absence alone.
5. PR #16 remains closed/unmerged and superseded by merged PR #18. Issue #17's independently controlled Founder identity/key custody is still unproven.
6. Reconcile this branch against fresh `main` before integration; do not merge automatically.
7. Linked NGL Mesh PR #1 remains draft. Full APK/RAE integration is still unverified because the required reference artifacts are absent.

No autonomous-discovery breakthrough, real-world Founder identity proof, or production-security claim is made.
