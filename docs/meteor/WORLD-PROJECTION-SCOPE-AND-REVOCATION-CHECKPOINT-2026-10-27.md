# Repository stutter-step checkpoint — world projection scope and revocation

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
Base `main`: `162ae451b52871f0c1f039fe689ac0d276a777f0`
Code commit (scope/revocation): `73b6401191f4c78057be9a6e492805295d2f6a2c`
Inventory hardening commit: `45b140ee40cb9f0f14d81fb25f90ebf4b4640f83`
Branch: `fix/world-projection-scope-and-revocation-20261027`

## Fresh-state findings

PR #118 was merged; its explicit `quest_id` rule now exists in `src/quest/engine.js`. The newest main commit `162ae451b52871f0c1f039fe689ac0d276a777f0` scopes revocations in that reducer, but `src/world/project.js` still used a single grant-wide revoked set and routed execution status by `subject`. This left the world projection inconsistent with the quest projection.

## Implemented

- For world execution/adjudication events, explicit `quest_id` is now authoritative for the projected quest status; `subject` is a compatibility fallback only when `quest_id` is absent.
- Verified revocations without `quest_id` remain grant-wide for compatibility.
- Verified revocations with an explicit `quest_id` apply only to that quest when deciding whether later world effects or failed-execution status may be projected.
- The public `state.revoked` audit list still records all verified revoked grant IDs; the retained history preserves the scope of each revocation.
- Added four regressions: conflicting execution scope, cross-quest revocation isolation, same-quest revocation enforcement, and prevention of a revoked grant changing status through a later failed execution.
- Second implementation cycle: inventory world effects now reject any delta that would reduce a stack below zero while allowing valid consumption of existing items. Added a regression for successful consumption and underflow rejection. Previously, any negative integer was accepted even when it produced impossible negative inventory.

## Verification status

Both implementation cycles and tests are committed; exact-head GitHub Actions are being rerun after the latest code update. Do not claim success until full verification, Genesis Evidence Invariant, and browser acceptance are inspected on the final PR head. No local test run is claimed.

## Remaining blockers

- Issue #17 remains open: independently controlled Founder signing/key custody and crash/stale-lock recovery are not established by these reducer tests.
- PR #16 remains closed; merged PR #18 supersedes its self-signing flow.
- PR #76 remains an unwired signed-attestation adapter; no production trust roots are provisioned.
- Linked `ngl-mesh` PR #1 remains draft; full APK/RAE integration is unverified because required reference artifacts are absent.

## Next steps

1. Inspect all three workflows on the exact final PR head; repair any source-backed failures and rerun.
2. Review any consumers of `state.revoked` and keep its meaning explicit: it is an audit list of grant IDs, while per-event scope remains in canonical history.
3. Continue Issue #17 without automatic deletion of potentially live locks or invented Founder credentials.
4. Reconcile the remaining security PRs against fresh `main`; no merge or production trust enablement without Founder authorization and independently controlled trust roots.

No merge, deployment, release, spending, production key operation, or Founder-identity claim.
