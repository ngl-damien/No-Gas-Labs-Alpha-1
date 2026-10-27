# Stutter-step checkpoint — safe Chronicle metadata snapshots

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
Branch: `fix/chronicle-safe-retained-text-and-targets-20261027`
Base `main` at branch creation: `dab8039eecebd5c3c422391c8c661c1ee213ef74`
Code commit: `8e1ed24107472eb30e802a134709a98dc3b94fdc`
Regression-test commit: `443910d33e9e1bea07113b88e2f3a196fc72b93c`

## Fresh-state reconciliation

The live `main` was re-read twice before writing. It is at `dab8039eecebd5c3c422391c8c661c1ee213ef74`, after the current-main port of the strict persisted-ledger JSON fix (PR #124 merged). PR #122 is also merged; its Chronicle revocation-binding changes are already on main. PR #123 is closed and unmerged because PR #124 superseded it. The prior Chronicle checkpoint incorrectly described #122 as draft/unmerged and is historical, not the current state.

The relevant source is `game/chronicle.mjs` with tests in `test/chronicle.test.mjs`. Existing event collections were guarded against sparse arrays and accessor-backed payloads, but report/contribution collections were copied with spread and creation metadata was read directly. That left inconsistent trust boundaries: text attribution and target-title lookup could execute getters or silently treat malformed metadata as absent.

## Implemented cycles

1. **Fail-closed retained text:** reports and contributions now use descriptor-based, dense-array validation and plain-data snapshots. If any record or collection property is malformed, no text from that collection is attached; a visible synthetic Chronicle entry and warning explain the malformed collection.
2. **Safe target metadata:** creations and nested version metadata are snapshotted with the same plain-data guard. Target lookup uses only the safe snapshot. Malformed creation metadata is visible and referenced artifacts are shown as unavailable rather than executing accessors or inventing a target.
3. **Adversarial regressions:** added tests for a getter on report text, a getter on the reports collection itself, sparse contribution arrays, and a getter on the creations collection. Each asserts zero getter calls and no attributed text/target.

## Verification status

GitHub Actions verification for this branch's exact final head is pending. Do not treat the code as verified until the Node suite, Python inspector/build/institutional exercise, Genesis Evidence Invariant, and browser acceptance have completed on the final PR head. No local test run is claimed.

## Unresolved blockers / next priorities

1. Inspect every workflow on the exact PR head; fix any real failure and rerun. If a failure is environmental or dependency-install related, inspect job steps/logs before classifying it.
2. Keep PR #16 closed and unmerged; merged PR #18 supersedes its self-signing flow. Issue #17 remains open for independently controlled Founder signing/key custody and safe concurrency/crash/stale-lock acceptance. No private key can be manufactured or custody proven by this automation.
3. PR #76 remains an unwired signed-attestation adapter with no production trust roots. Keep production trust disabled until independently controlled trust roots and the actual live mutation path are verified.
4. NGL Mesh PR #1 remains draft; isolated operator-trust checks do not prove APK/RAE integration because required recovered-source/reference artifacts are missing.
5. Continue reviewing Chronicle projection boundaries for malformed or ambiguous retained data, without making the display projection an authority source.

No merge, deployment, release, spending, production key provisioning/rotation/revocation, or Founder-identity claim occurred.


## Second implementation cycle — ambiguous target identities

A second source review found that safe snapshots alone did not prevent `findVersion()` from choosing the first match when retained data contained duplicate creation IDs or duplicate historical version numbers. Target resolution now succeeds only when the creation ID is unique and the requested historical version has exactly one match. Ambiguous targets remain visible but unavailable; no arbitrary title is selected.

Regression tests cover duplicate creation identities and duplicate historical version entries. These changes are included in the final branch head; exact-head GitHub Actions must be rechecked after this update.
