# Stutter-step checkpoint — realm projection isolation

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
Branch: `fix/realm-projection-isolation-20261027`
Base `main` at branch creation and last reinspection: `d6cafd2e5dedfb487f7ba03bf92ff8df577d8168`

## Source-backed findings

1. `src/world/realm.js` returned a shallow copy of `state.quests`; nested quest records still aliased the canonical `projectWorld()` projection. Editing `projectRealm(state).quests[id].status` could mutate the source projection.
2. `projectRealm()` read and mapped state fields without rejecting accessor-backed or malformed data first.
3. `canTravel()` looked up user-supplied keys on ordinary prototype-bearing objects. Keys such as `toString` and `constructor` could reach inherited values and cause an exception instead of returning `false`.

## Implemented cycles

1. **Read-model isolation:** deep-clone the quest map in realm output; add a regression proving UI edits do not mutate canonical quest state.
2. **Fail-closed state validation:** validate the full data graph before normal property reads, then validate event history, XP, inventory quantities, quest records, and revocation-audit scope. Reuse `isSafeEventPayload` and `validatedEventList`.
3. **Safe route lookup:** `canTravel()` now requires string inputs and own keys in both `locations` and `routes`. Regression coverage checks `__proto__`, `constructor`, `toString`, `hasOwnProperty`, and non-string input.

## Implementation commits

- `58ee8962e11d7a5f691583931bf001505db72d83` — detach quest projection from canonical state.
- `6b551c25702e5d707834431eb37a657a65ded0ba` — regression for mutation isolation.
- `f50183b72e00d9856dbb06fb7549c74ba4be9517` — validate projection state before reading.
- `4da6e227b5d2470fc8ebcf12995e098cb81d0aca` — hostile-state and malformed-audit regressions.
- `45bf80eb07ecf9d1c7386ac6176b9ce8d3f788ac` — checkpoint / initial handoff.
- `cba2775f0188d44e33cb71b293129d37202874d2` — reject prototype keys in travel lookup.
- `2075e78bb2b3bd3ca8f1f81e8f90402bdc5c969a` — travel regression tests.
- Current checkpoint refresh follows.

## Verification status

Earlier CI started on head `45bf80eb07ecf9d1c7386ac6176b9ce8d3f788ac`, but that head is superseded by the travel-lookup commits. Its in-progress results do **not** verify the final head. Inspect fresh exact-head verify, Genesis Evidence Invariant, and browser acceptance runs after the checkpoint refresh. No local test run is claimed.

## Authority/security blockers

- Issue #17 remains open: independently controlled Founder key custody/identity, adversarial concurrent writers, and crash/stale-lock recovery remain unproven.
- PR #16 is closed and superseded by merged PR #18; do not reopen the obsolete self-signing flow.
- PR #76 remains draft and its signed-attestation adapter is not wired into `game/server.mjs`. No production trust roots are provisioned. Do not claim the live server verifies signed attestations.

## Next priorities

1. Inspect all exact-final-head CI results; repair only demonstrated failures and rerun.
2. Confirm the realm read-model's mutable outputs remain detached and the stricter input checks preserve canonical projection compatibility.
3. Continue Issue #17's concurrency/recovery acceptance without automatically deleting potentially live locks.
4. Reconcile PR #76 only after reviewing the current-main diff; live trust integration requires separately controlled trust roots and actual mutation-path evidence.

No merge, deployment, release, spending, production key operation, or Founder-identity claim is authorized or performed by this branch.
