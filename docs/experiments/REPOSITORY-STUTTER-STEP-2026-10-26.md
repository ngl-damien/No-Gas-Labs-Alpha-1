# Current handoff — 2026-10-26 UTC

> This handoff supersedes the historical snapshot below. Re-read the live PR and current branch head before acting; do not assume this branch is still based on the same `main` commit.

## Fresh state and implemented cycles

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
- PR: [#66 — independent observation attestation](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/66), open and unmerged; base `main` observed at `17096dd6789299ad1bcd6de544db602a529da3c3` before these follow-ups.
- Safe branch: `security/observation-attestation-mainline-20261026`.
- Pre-run PR head: `a27a635cbf9178a899d152c2de148e0dabab478e`. That head had successful exact-head verification, Genesis Evidence Invariant, and browser acceptance (runs 40315329167, 40315329162, 40315329220). These results do **not** verify follow-up commits.
- This run re-inspected live PR/source between changes and completed three source-backed improvement cycles.

### Cycle 1 — Prevent cross-institution attestation replay

- `acdec375911bc174fd12b36bcab387c0c1163697` — `createObservationVerifier` now requires a host-configured `expectedAudience` and rejects signed events whose `audience` does not match it.
- `0333ea1cf546d6c98180609790738bab9e8cf437` — regression tests require audience configuration and prove that a valid signature for a different audience cannot award progress in this institution.
- This closes a cross-context replay gap when an observer key is trusted by more than one institution/ledger. It does not provision a production key or prove the observer is independent.

### Cycle 2 — Prevent prototype-sensitive projection writes

- `89a5a4c8febbcc0729b32b9e7a4a94ac6f5a18e2` — quest, inventory, and world-effect writes now use explicit own data properties. Inventory accumulation ignores inherited values; malformed array/non-object effect maps are not treated as ordinary records.
- `42c55fb1a65fa2a2454383b3d60f55a0631363c5` — regression coverage exercises `__proto__` and `constructor` keys in quest subjects, inventory, and world effects and checks that projection prototypes remain unchanged.
- `29bc56b481513553e4cd6262e071a50bb4e5af26` — documentation records audience binding and prototype-safe writes.

### Cycle 3 — Preserve evidence snapshots against caller mutation

- `b016cfd9906ed851b92f2d429606f52aae4d9d0b` — `projectWorld` now stores a structured clone of each event in projected history instead of retaining a caller-owned object reference.
- `0063bb5f40b27ee75a0fb74056b14aa97a80add0` — regression test mutates the original event and nested receipt/world-effect fields after projection and confirms the retained history snapshot is unchanged.
- `1dfc8d350589f22b52f723e48bfad010659b8659` — trust-boundary documentation records the snapshot-isolation behavior.

## Verification status for the code/test head

The exact code/test head `1c110543bdae008f859af25e08ffc47f2a7dffa9` passed all required GitHub Actions checks:

- [Full verification — run 40317442221](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40317442221): **success**. Node tests, Python inspector, game package build, and bounded institutional exercise all exited 0.
- [Genesis Evidence Invariant — run 40317442225](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40317442225): **success**.
- [Browser acceptance — run 40317442383](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40317442383): initial attempt failed because the shared-world journey expected two Source Observatory articles but observed one. I inspected the job log; desktop, phone, and institutional-location journeys had passed before the assertion. The failed job was rerun without code changes; rerun job `121554655222` completed **successfully** on the same code/test head. Treat the first failure as a non-reproduced/flaky browser result, not as a source fix.
- The subsequent documentation-only checkpoint head `61814ce3a8e28cf5b9cd19eaf42198c41246e524` also passed [full verification run 40318180151](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40318180151), [Genesis Evidence Invariant run 40318180179](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40318180179), and [browser acceptance run 40318180158](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40318180158). The earlier browser attempt on code/test head `1c110543bdae008f859af25e08ffc47f2a7dffa9` failed once at the Source Observatory article-count assertion; rerun job `121554655222` passed without code changes. Classify that first failure as non-reproduced/flaky, not as a source fix. This new checkpoint edit will create another documentation-only head; the next run must re-inspect it and its CI.
- Local execution is unavailable in this runtime; no local test run is claimed.
- No merge, deployment, release, key provisioning/rotation, or external publication is authorized or claimed.

## Unresolved blockers / next priorities

1. Inspect the live PR head and all three required workflows. Repair failures rather than stopping at the first red check.
2. Keep production observation/adjudication/authorization fail-closed until a separately controlled trust root, expected audience, and custody contract are actually configured. Do not use an always-true callback, event-derived key, or repository-held observer private key.
3. Reconcile PR #26 against current `main`; it remains an older, diverged proposal and should not be merged directly.
4. Continue issue #17 acceptance work for Founder key custody, adversarial concurrency, and crash/stale-lock recovery. Preserve ambiguous commit states and never automatically delete a potentially live lock.
5. Reinspect the linked NGL Mesh PR and required APK/RAE reference artifacts before claiming integration.
6. PR #16 remains closed and unmerged; merged PR #18 supersedes its original self-signing INSTALL flow. Do not reopen PR #16 as a substitute for the remaining custody and recovery work.

---

# Historical checkpoint — initial 2026-10-26 snapshot

## Scope and branch

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
- Base `main` at original inspection: `17096dd6789299ad1bcd6de544db602a529da3c3`
- Safe branch: `security/observation-attestation-mainline-20261026`
- Initial source commit: `89297a95d1bd45fc38025196cf875b45026bd66c`

## Source-backed defect

Mainline `src/world/project.js` treated event-supplied labels as sufficient for success projection and let unverified failure/rejection/revocation events alter state. `src/quest/engine.js` had a parallel path that could satisfy acceptance from event claims alone. The existing PR #26 addresses this area but diverged from current main by 15 commits ahead / 25 behind at the original comparison, so merging that branch directly was not the safe route.

## Initial changes on this branch

- `projectWorld`: requires host-injected observation verification returning literal `true`; missing/throwing/non-boolean verifiers fail closed. Only separately verified adjudications can reject or revoke. Unverified events remain in history.
- `projectQuest`: only independently verified, byte-checked observations satisfy acceptance or set failure; rejections require adjudication verification.
- `replayInstitution` and `verifyReplay`: propagate trust callbacks consistently into both world and quest projections.
- Added an Ed25519 observation-attestation adapter with a host-pinned DER public-key fingerprint and observer ID.
- Added a separate host-controlled authorization verifier and closed the Guild Hall UI's raw authorization-label bypass.

## Original verification boundary

- The test suite uses ephemeral generated keys only. It verifies cryptographic binding and fail-closed behavior, not an actual outside observer or Damien's identity.
- The adapter is not wired into `game/server.mjs`; no production trust root/private key is configured.
- No merge, deployment, key provisioning/rotation, or external release is authorized or claimed.
