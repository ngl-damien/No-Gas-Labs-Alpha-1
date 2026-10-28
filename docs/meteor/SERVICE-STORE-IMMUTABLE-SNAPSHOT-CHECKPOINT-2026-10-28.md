# Service Store Immutable Snapshot Checkpoint — 2026-10-28

## State inspected

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- Current `main` at latest reinspection: `aac4bdb8d5cf203a09b734d18fa19b1a17dfdc30` (Witness retry identity across restart).
- Safe branch: `fix/service-store-immutable-snapshots-20261028`.
- Draft PR: [#134 — keep service-store snapshots immutable](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/134), open and unmerged.
- Code/test head before this checkpoint refresh: `b3d8fdbcefc246b587c701f67dac8019303e374f`.
- PR #132 was rechecked and is now merged as `c10c1f583541c2edba76c4c361e4630b89a7963c`; its serialization and stale-revision guard are on current `main`.
- Open Alpha One PRs before opening #134: 11; PR #134 is the new twelfth open PR.
- Issue #17 remains open.

## Functional changes

1. **Immutable detached service-store snapshots.** `immutableSnapshot()` normalizes validated payloads through strict canonical JSON, detaching caller-owned references, then recursively freezes the JSON graph. The initial state, reopened envelope, committed in-memory state, `store.value`, and `commit()` result share this immutable boundary. The inspected server uses `store.value` read-only and submits new candidates through `commit()`; no in-place mutation use was found.
2. **Fail-closed revision-shape continuity.** The former guard selected `world.revision` only if it was already a safe integer, otherwise falling back to top-level `revision`; it also skipped comparison when either revision was absent. The new guard distinguishes unversioned, top-level-revision, and canonical-world-revision payloads. A versioned payload cannot omit/change its revision mode, and a malformed explicitly present nested revision cannot fall back to a top-level value.
3. **Compatibility preserved deliberately.** If a payload has an unrelated `world` object with no own `revision` field but has an explicit top-level revision, top-level mode remains valid. This avoids treating older/custom payloads as canonical world-revision records when they do not declare that field.
4. **Regression coverage.** Added tests for mutation through `store.value` and commit results, detachment from caller-owned initial objects, missing/malformed canonical world revisions, and explicit top-level revision compatibility. The concurrent service-store and institutional-ledger regressions from merged PR #132 remain on the base.

## Commits in this run

- `075decd153f01cad3f4c36291925c144863970e3` — expose immutable service-store snapshots.
- `f004a9252b3f20702ff61efa1ed7e08d584100e0` — test mutation through value/commit results.
- `7281ff1f2b4f47035e7d00c3511934f3964f8a72` — fail closed on revision-shape changes.
- `c19ec6978df1c9a0db3770a94b237e4a7c27b55a` — test revision-shape bypasses.
- `8870ea97212a5539ba065c6f34d78621c6dd6e0e` — initial durable checkpoint.
- `74edebfe285cd8fbe638830e806349280decb0a5` — test detachment from caller-owned initial state.
- `2dddd4fd4054c70f10cd03f1097ba12238fcc40a` — preserve explicit top-level revision mode when nested revision is absent.
- `b3d8fdbcefc246b587c701f67dac8019303e374f` — test top-level revision compatibility.

## Verification status

GitHub Actions must be inspected on the final PR head, including after this checkpoint refresh. Earlier workflow runs were triggered for superseded heads and are not evidence for the current head. This runtime has not executed the Node suite locally. Do not claim success until the full repository verification, Genesis Evidence Invariant, and browser acceptance all complete successfully for the exact final SHA. If a check fails, inspect its logs, repair the demonstrated defect, and rerun.

## Unresolved blockers and boundaries

- Issue [#17](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/issues/17) remains open for independently controlled Founder key custody/identity, adversarial concurrency, and safe crash/stale-lock recovery.
- PR #16 remains closed and superseded by merged PR #18. A configured public-key fingerprint is not proof of Damien's real-world identity or private-key custody; no separately controlled signing operation is available here.
- PRs #60, #63, #66, #73, #74, and #76 remain open branches as last observed. Do not merge stale branches wholesale. PR #76 is not wired into the live mutation path, and production trust roots are absent.
- Service/ledger lock cleanup still uses an inode check followed by unlink, not an atomic compare-and-unlink primitive. Stale-lock recovery remains fail-closed/manual; this change does not solve that race.
- Linked `ngl-damien/ngl-mesh` remains separate. Full APK/RAE integration cannot be claimed without the missing recovered-source archive, reference APK, and RAE report.

## Next steps

1. Inspect full verification, Genesis Evidence Invariant, and browser acceptance on the final PR head; repair any observed failure.
2. Reinspect current `main`, open PRs, and Issue #17 before choosing the next improvement.
3. Continue crash/concurrency acceptance without automatically deleting potentially live locks.
4. Keep production trust disabled until independently controlled trust roots and the live mutation path are verified.
