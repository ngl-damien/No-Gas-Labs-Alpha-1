# Repository stutter-step handoff — 2026-10-26 UTC

Start the next run with fresh repository, PR, branch, source, and Actions inspection. This note is a handoff, not proof that state remains current.

## Alpha One: `ngl-damien/No-Gas-Labs-Alpha-1`

- PR [#66 — independent observation attestation](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/66) remains open and unmerged.
- Safe branch: `security/observation-attestation-mainline-20261026`.
- Code/test head before this checkpoint-only commit: `ccbea5f2c09204889dbd791a241662165edfa609`.
- Current compare: branch is ahead of `main` and diverged; the latest mainline commits are documentation-only checkpoint incident/revert commits. Do not merge automatically or assume the branch is current with main.
- This checkpoint update will create a new branch head. Reinspect the PR and exact-head Actions after the commit.

## Implemented in this run

1. `04a7c6f82fe6dde3ad6c3ebd03527507cdf90db0` — `projectWorld` now rejects conflicting duplicate event IDs instead of silently skipping altered payloads. Exact duplicate replay remains idempotent; a seen ID without retained payload fails closed.
2. `25e2922f55d0fa18894182ce58a5eca3759b835e` — added five regression cases for identical replay, conflicting IDs within a batch and across replay batches, missing retained payload, and duplicate retained history.
3. `d313955e8b7f644a5d662dee2067ae46aed1c04b` — `hashState` now rejects ambiguous non-JSON values, non-finite numbers, cycles, unsupported object types, accessors, and symbol keys instead of hashing lossy representations.
4. `55aa825fc6a6e3d856adcb13e3a17db56b20e225` — hardened array hashing against sparse/decorated arrays, hidden array properties, accessors, and custom array prototypes while preserving own prototype-sensitive data keys.
5. `ccbea5f2c09204889dbd791a241662165edfa609` — expanded hash regression coverage for insertion-order stability, undefined/NaN/infinity, cycles, sparse/decorated/hidden/accessor arrays, prototype-sensitive keys, and non-plain objects.

## Exact-head verification observed for code/test head `ccbea5f2c09204889dbd791a241662165edfa609`

- [Full verification — run 40321504721](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40321504721): **success**. The world-projection job's test, package-build, and bounded institutional-exercise step passed.
- [Genesis Evidence Invariant — run 40321504777](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40321504777): **success**.
- [Browser acceptance — run 40321504722](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40321504722): **success**.
- These are GitHub Actions results; no local test run is claimed.

## Freshly reconciled boundaries

- PR #16 is closed and unmerged. Merged PR #18 supersedes its original self-signing INSTALL flow; do not reopen #16 as a substitute for remaining custody work.
- Issue [#17 — Founder key custody, concurrency, and stale-lock recovery](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/issues/17) remains open. Real Founder identity/key custody is unproven; adversarial concurrent-writer and crash-recovery acceptance work remains.
- PR #65 replay-safe shared actions is open and unmerged; its documented exact-head full verification, Genesis, and browser journeys passed on its own head. Do not treat it as merged into main.
- PR #26 remains an older, diverged draft. Reconcile its changes against current main; do not trust an old mergeable flag or merge the branch wholesale.
- PR #66's observation adapter remains **not wired into `game/server.mjs`**. No separately controlled production observer/adjudicator/authorization trust root is provisioned. Keep canonical progress fail-closed; never add an always-true verifier or store an observer private key in this repository.
- Linked [NGL Mesh PR #1](https://github.com/ngl-damien/ngl-mesh/pull/1) remains draft/open/unmerged at head `e108be26f7b6a6de5fce875ac6eaaf32f41f992e`. [Isolated trust workflow run 40318420477](https://github.com/ngl-damien/ngl-mesh/actions/runs/40318420477) passed 9 OperatorKeyTrust checks and 11 DurableMarker checks. Full APK/RAE integration remains unverified because the recovered-source archive, reference APK, and RAE report are absent.

## Next priorities

1. Reinspect exact current PR #66 head and all three Actions workflows after this checkpoint commit; repair any failure before claiming final-head verification.
2. Reconcile PR #66's three-commit mainline divergence without merging or overwriting unrelated changes.
3. Define host-controlled observation/adjudication/authorization configuration and startup failure behavior, but do not provision production trust roots or claim independent observation without separately controlled key custody.
4. Advance issue #17 with adversarial concurrency and crash/fault-injection coverage across lock acquisition, atomic rename, and directory sync. Preserve `COMMIT_DURABILITY_UNCERTAIN`; never automatically delete a potentially live lock.
5. Reassess NGL Mesh integration only when its required APK/RAE reference artifacts are actually available.

No merge, deployment, release, spending, production key provisioning, rotation, or revocation occurred. No autonomous discovery breakthrough is claimed. Work between scheduled runs is not assumed to continue uninterrupted.


## Follow-up — strict event payload shape validation (2026-10-26 UTC)

This follow-up adds a separate source-backed hardening cycle to the existing observation-attestation branch. It does not provision production trust roots or wire the verifier into the server.

- `b2ed2e3c9e95dbeb8a7fc45a50163aa12ed107b2` — world event duplicate-payload comparison now rejects sparse/decorated arrays, inherited array indices, non-enumerable own properties, symbol keys, accessor fields, and exotic object prototypes rather than comparing a lossy view.
- `824061b9353ed0eafcb0d299a4c07e3ebf4e96b1` — validate each new event payload before `structuredClone` can discard hidden properties or normalize a sparse/exotic shape.
- `4434cd09ac5392aab098a7d1b33a553cbe84e867` — regression coverage for hidden nested properties, sparse arrays with inherited indices, and accessor rejection without invoking the getter.

### Exact-head verification observed before this checkpoint-only update

Code/test head: `4434cd09ac5392aab098a7d1b33a553cbe84e867`.

- [Full repository verification — run 40325236225](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40325236225): **success**.
- [Genesis Evidence Invariant — run 40325236188](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40325236188): **success**.
- [Browser acceptance — run 40325236213](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40325236213): **in progress at last inspection**; the browser build/journeys had not yet started. Do not claim browser acceptance for this code/test head until completion is observed.
- No local test execution is claimed.

The checkpoint commit below changes the branch head, so recheck all three workflows on the new exact head. PR #66 remains open and unmerged; its compare is already substantially diverged from main. Reconcile rather than merge wholesale.

### Current blockers and next steps

1. Reinspect PR #66 after the checkpoint commit and wait for exact-head browser acceptance; fix any observed failure.
2. Keep production world/quest progress fail-closed until observer, adjudicator, and authorization trust roots are separately controlled and provisioned.
3. PR #16 remains closed/unmerged; merged PR #18 supersedes its self-signing flow. Issue #17 still needs real Founder key custody, adversarial concurrency, and crash/stale-lock recovery.
4. PR #67's canonical JSON own-property fix is independently tracked against current `main`; keep it separate from this diverged security branch unless a reviewed reconciliation proves otherwise.

No merge, deployment, release, spending, production key provisioning, rotation, or revocation occurred.


## Follow-up — pre-read accessor safety (2026-10-26 UTC)

A second review of the new payload validator found a sequencing gap: `eventParents` and `validateHistory` read `event_id` before full payload validation, and `projectWorld` cloned the seed before validating it. The follow-up moves validation ahead of those reads/clones.

- `80308b3e14988e7e49571e6246ced8b03bd56818` — validate seed and incoming event shape before `structuredClone` or event-ID reads; read the parent-validation label from an own data descriptor rather than invoking an `event_id` accessor.
- `251acd4af6e58a581e0c8b008d809a33e87fa794` — `validateHistory` reads `event_id` through an enumerable own data descriptor and rejects accessors/non-enumerable IDs without executing them.
- `f59dda5292474b1f61d9e14b6e79abccc404dc65` — regression tests assert event-ID and seed getters are not invoked.

### Verification state at checkpoint

Code/test head: `f59dda5292474b1f61d9e14b6e79abccc404dc65`.

- Full verify run [40325723205](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40325723205): **in progress** at last inspection.
- Genesis Evidence Invariant run [40325723352](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40325723352): **queued** at last inspection.
- Browser acceptance run [40325723386](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40325723386): **queued** at last inspection.
- The checkpoint commit changes the branch head; recheck exact-head Actions after the update. No local test execution is claimed.

No production trust roots were provisioned, no PR was merged, and no deployment, release, spending, key rotation, or revocation occurred.


## Verification repair — preserve ancestry-specific errors (2026-10-26 UTC)

The first verification run for code/test head `f59dda5292474b1f61d9e14b6e79abccc404dc65` exposed one regression: **327 passed, 1 failed**. Existing test `test/world-projection.test.js` expected malformed parent accessors to fail with `parent metadata must be an enumerable data property`, but whole-event validation ran first and returned a generic payload error.

Fixed rather than ignored:

- `7c8dde917d1f998888b1a51446a16446acd2980c` — inspect the event ID via an own data descriptor, validate ancestry metadata first to preserve its specific failure, then validate remaining payload shape before duplicate comparison or cloning.
- `1a8ba4609f1a154538ef3086b1b0ea363a338d61` — adjust the event-ID accessor regression to assert the new explicit ID-metadata error.

### Verification after repair — code/test head `1a8ba4609f1a154538ef3086b1b0ea363a338d61`

- Full repository verification — run [40325980915](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40325980915): **success**.
- Genesis Evidence Invariant — run [40325980994](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40325980994): **success**.
- Browser acceptance — run [40325980985](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40325980985): **in progress** at last inspection; do not claim it passed until the result is observed.
- This checkpoint-only commit does not change source/tests. No local test run is claimed.

The failure and repair remain recorded to preserve the evidence trail; the prior failed run is not erased or described as a pass.
