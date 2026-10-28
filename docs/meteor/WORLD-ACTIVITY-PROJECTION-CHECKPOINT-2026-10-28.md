# World Activity Projection Checkpoint — 2026-10-28

## Fresh state and supersession check

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- Base `main` observed at `77d61abc44beafad6a299aed2fae846ac353400f` (`fix(quests): require prior retained versions for activity progress`).
- PR #146 (`fix(world): make institution activity counters identity-safe`) is merged at `a4704b7a20d9d20b5055d639caab0783b9ca752f`; the activity counter is now production-main code.
- PR #16 is closed and unmerged; PR #18 is merged and supersedes the old self-signing path. Do not reopen PR #16.
- Issue #17 remains open for independently controlled Founder key custody/identity, adversarial concurrency, and safe crash/stale-lock recovery.
- Eleven open Alpha One PRs were observed at the initial inventory. Recheck counts and branch state before further work.

## Source-backed defects and changes

1. **Accessor boundary:** `institutionActivityCount()` verified own property descriptors but passed the original record to matchers. An inherited `type` getter could still execute and affect visible counts. Matchers now receive an inert snapshot built only from own data descriptors.
2. **Container boundary:** the old `world?.events` / `world?.history` reads could invoke accessor-backed container getters. Own data properties are now read by descriptor, and revoked Proxy records are skipped instead of throwing from `Array.isArray`.
3. **Render leverage:** `drawTownSquare()` and each `drawInstitution()` recomputed counts separately during the animation loop. Counts are now computed once when `WorldView.setWorld()` receives a new projection, then reused for drawing. `institutionActivityCount()` remains available for direct callers/tests.

These are display/navigation counts only. They do not award XP, establish truth, grant authority, or validate canonical progress.

## Regression coverage added

- Inherited getter does not execute or inflate a counter.
- Proxy `get` trap is not invoked during matching after the descriptor snapshot is built.
- Accessor-backed `world.events` is ignored without invoking the getter; valid `history` remains usable.
- Revoked Proxy event record is skipped without crashing the projection.
- Cached activity counts refresh when `setWorld()` receives a different projection.

## Commits

- `276c610f81cf839b5153f037629c0d084ae048f1` — project activity records through inert own data.
- `e3b8de612518afce912da0c0dfd873e88b6d5e65` — add inherited-accessor/Proxy/container regression tests.
- `b74a72142993f8ca39d178bc1a3521930bcba152` — compute all institution counters once per world update.
- `5e1327a1daec8b0ad433bb20f66b1c6f8cb146fd` — test cached-count refresh.
- This checkpoint commit follows those four commits.

## Verification boundary

- Branch: `fix/world-activity-projection-own-data-20261028`.
- Initial base: `77d61abc44beafad6a299aed2fae846ac353400f`.
- Before this checkpoint: 4 commits ahead / 0 behind; 3 code/test files changed.
- GitHub Actions exact-head verification is required. A local clone/test attempt was blocked because this runtime could not resolve `github.com`; no local test result is claimed.
- Do not claim CI success until the exact final head's Full Repository Verification, Genesis Evidence Invariant, and Browser Acceptance results are inspected.
- No production state is changed by this branch. No Founder identity, key custody, or autonomous-discovery claim is made.

## Next steps

1. Open a draft PR from this branch to `main`, then inspect all exact-head workflow results and logs.
2. Repair only observed failures, rerun, and reinspect the final head and main-base drift.
3. Continue Issue #17's concurrency and crash/stale-lock acceptance without automatically deleting potentially live or replacement locks.
4. Keep production Founder trust fail-closed until independently controlled key custody and actual live mutation-path integration are evidenced.

No merge, deployment, release, spending, production key operation, or Founder decision occurred.
