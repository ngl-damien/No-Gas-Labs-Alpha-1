# Stutter-step checkpoint — explicit quest-scope isolation

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
Base `main` inspected immediately before branch creation: `0fdfc087706ccb2ad877555fdaf47fe829c07e0d`
Branch: `fix/quest-projection-explicit-scope-20261027`

## Source-backed defect

`src/quest/engine.js` treated an event as relevant when either `quest_id` OR `subject` matched the quest. A signed/host-verified event explicitly scoped to another quest could set `quest_id: "another-quest"` but `subject: <target quest id>` and be pulled into the target projection. Because the authorization verifier is host-supplied and its contract does not itself guarantee cross-quest binding, the reducer must enforce scope consistency rather than relying on the callback alone.

## Functional change

- When `quest_id` is present, it is now authoritative for projection scope.
- `subject` is retained as a compatibility fallback only for older events that omit `quest_id`.
- Added regressions for both a mismatched explicit authorization and an execution event that otherwise carries valid observation, authorization, and artifact evidence.
- Second cycle: made quest definitions reject sparse/non-string acceptance and capability arrays, and froze defensive copies of both arrays so callers cannot mutate a supposedly frozen quest contract after projection setup.

## Evidence boundary

The defect is derived from the previous source predicate and the host-verifier test contract. GitHub Actions must be inspected on the final PR head before claiming tests pass. No local test run is claimed.

## Unresolved blockers / next steps

1. Inspect exact-head full verification, Genesis Evidence Invariant, and browser acceptance workflows.
2. Check whether other projections use an OR-based `quest_id` / `subject` fallback and review their event schemas before changing them.
3. Continue Issue #17 separately: this fix does not establish real Founder identity or private-key custody, nor implement crash recovery.
4. Keep signed-attestation integration disabled in production until independently controlled trust roots and the live mutation path are verified.

No merge, deployment, key operation, or Founder-identity claim.
