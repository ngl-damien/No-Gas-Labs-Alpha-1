# Stutter-step checkpoint — realm projection isolation

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
Branch: `fix/realm-projection-isolation-20261027`
Base `main` at branch creation and last reinspection: `d6cafd2e5dedfb487f7ba03bf92ff8df577d8168`

## Source-backed finding

`src/world/realm.js` built a UI/read-model with `quests: { ...(state.quests || {}) }`. The outer map was copied but each quest record remained aliased to the canonical `projectWorld()` state. Mutating `projectRealm(state).quests[id].status` therefore mutated the source projection object. The same boundary also read and mapped state fields without first rejecting accessor-backed or malformed state.

## Implemented cycles

1. **Read-model isolation:** deep-clone the quest map in the realm output. Added a regression proving that edits to the returned quest record do not mutate the canonical projection.
2. **Fail-closed input validation:** validate the entire state graph before normal property reads, then validate event history, XP, inventory quantities, quest records, and revocation-audit scope. This uses the shared `isSafeEventPayload` and `validatedEventList` helpers.
3. **Adversarial regression coverage:** added checks that an accessor-backed XP field is rejected without invoking its getter, negative inventory is rejected, and a global revocation audit cannot claim a quest scope.

## Commits

- `58ee8962e11d7a5f691583931bf001505db72d83` — detach quest projection from canonical state.
- `6b551c25702e5d707834431eb37a657a65ded0ba` — regression for mutation isolation.
- `f50183b72e00d9856dbb06fb7549c74ba4be9517` — validate projection state before reading.
- `4da6e227b5d2470fc8ebcf12995e098cb81d0aca` — hostile-state and malformed-audit regressions.
- Checkpoint commit follows.

## Verification status

No local test run is claimed. CI must be inspected on the final PR head after the checkpoint commit. Until those runs complete, the code and regression tests are **implemented but not yet verified by CI**.

## Authority/security blockers

- Issue #17 remains open: independent Founder key custody/identity, adversarial concurrent writers, and crash/stale-lock recovery remain unproven.
- PR #16 is closed and superseded by merged PR #18; do not reopen the obsolete self-signing flow.
- PR #76 remains draft and its signed-attestation adapter is not wired into `game/server.mjs`. No production trust roots are provisioned. Do not claim the live server verifies signed attestations.

## Next priorities

1. Inspect all exact-final-head CI results; repair only demonstrated failures and rerun.
2. Review the realm read-model's remaining mutable outputs and input contract for compatibility regressions.
3. Continue Issue #17's safe concurrency/recovery acceptance without automatically deleting potentially live locks.
4. Reconcile PR #76 only after the current-main diff is reviewed; live trust integration requires separately controlled trust roots and actual mutation-path evidence.

No merge, deployment, release, spending, production key operation, or Founder-identity claim is authorized or performed by this branch.
