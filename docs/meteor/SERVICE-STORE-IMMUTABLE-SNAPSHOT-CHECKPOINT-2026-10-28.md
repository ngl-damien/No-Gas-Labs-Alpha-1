# Service Store Immutable Snapshot Checkpoint — 2026-10-28

## State inspected

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
- Current `main` at implementation start and latest recheck: `aac4bdb8d5cf203a09b734d18fa19b1a17dfdc30` (witness retry identity across restart).
- Safe branch: `fix/service-store-immutable-snapshots-20261028`
- Pre-checkpoint code/test head: `c19ec6978df1c9a0db3770a94b237e4a7c27b55a`
- PR #132 was rechecked and is now merged as `c10c1f583541c2edba76c4c361e4630b89a7963c`; its service-store serialization and stale-revision guard are present on current main.
- Open Alpha One PRs at recheck: 11 (PR #132 is no longer open).
- Issue #17 remains open.

## Functional changes

1. **Immutable detached service-store snapshots.** `immutableSnapshot()` normalizes a validated payload through the strict canonical JSON representation, detaching it from caller-owned references, then recursively freezes the JSON graph. The initial state, reopened envelope, committed in-memory state, `store.value`, and `commit()` result now share this immutable boundary. The service server uses `store.value` read-only and commits new candidates, so no known call site requires in-place mutation.
2. **Fail-closed revision-shape continuity.** The previous guard selected `world.revision` only when it was a safe integer, otherwise falling back to top-level `revision`; it also skipped comparison if either revision was absent. The new guard distinguishes unversioned, top-level-revision, and canonical-world-revision payloads. A revisioned payload cannot omit/change its revision shape, and a malformed canonical `world.revision` cannot fall back to a top-level revision. Versioned commits must advance exactly one revision.
3. **Regression coverage.** Added tests for mutation attempts through `store.value` and returned commit results, plus revision-shape removal and malformed nested revision fallback. Existing service-store and ledger concurrency regressions from merged PR #132 remain on the base.

## Commits in this run

- `075decd153f01cad3f4c36291925c144863970e3` — expose immutable service-store snapshots.
- `f004a9252b3f20702ff61efa1ed7e08d584100e0` — test mutation through value/commit results.
- `7281ff1f2b4f47035e7d00c3511934f3964f8a72` — fail closed on revision-shape changes.
- `c19ec6978df1c9a0db3770a94b237e4a7c27b55a` — test revision-shape bypasses.

## Verification status

**Pending exact-head GitHub Actions.** This runtime has not executed the Node suite locally. Do not claim the change passes until the full repository verification, Genesis Evidence Invariant, and browser acceptance results are inspected for the final PR head. If any check fails, inspect logs, fix the demonstrated defect, and rerun on the resulting exact head.

## Unresolved blockers and boundaries

- Issue [#17](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/issues/17) remains open for independently controlled Founder key custody/identity, adversarial concurrency, and safe crash/stale-lock recovery.
- PR #16 remains closed and superseded by merged PR #18. The configured public-key fingerprint is not proof of Damien's real-world identity or private-key custody; no separately controlled signing operation is available here.
- PR #63 (Founder key-file hardening), #66 (independent observation), #73/#74/#76 (signed attestation variants), and #60 (storage durability) were rechecked as open branches. Do not merge stale branches wholesale; PR #76 is not wired into the live mutation path and production trust roots are absent.
- Service and ledger lock cleanup still relies on an inode check followed by unlink, which is not an atomic compare-and-unlink primitive. Stale-lock recovery remains fail-closed/manual; this change does not solve that race.
- Linked `ngl-damien/ngl-mesh` remains a separate draft integration; full APK/RAE integration cannot be claimed without the missing recovered-source archive, reference APK, and RAE report.

## Next steps

1. Inspect final-head full verification, Genesis Evidence Invariant, and browser acceptance; repair any observed failure.
2. Reinspect current `main`, open PRs, and Issue #17 before choosing the next improvement.
3. Continue crash/concurrency acceptance without automatically deleting potentially live locks.
4. Keep production trust disabled until independently controlled trust roots and the live mutation path are verified.
