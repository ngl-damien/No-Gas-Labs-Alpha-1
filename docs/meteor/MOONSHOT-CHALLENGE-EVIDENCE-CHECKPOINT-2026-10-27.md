# Moonshot Challenge Evidence Checkpoint — 2026-10-27

## Current scope

Repository: `ngl-damien/No-Gas-Labs-Alpha-1`  
Pull request: [#131 — preserve adversarial challenges to experiment reports](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/131)  
Branch: `feat/moonshot-retained-dissent-20261027`  
Base observed before this checkpoint: `main` at `6ccc62fc36704b340c963c87ecea92354ad64afe`  
Code/test head before this checkpoint commit: `8a3447bdb2fe239c64ae35baf19cdffc712774e6`

## Functional change

Challenges can now optionally cite a retained published artifact version. The citation is an evidence pointer, not proof that the artifact supports the challenge or that the challenge author independently observed anything.

- Model admission validates that artifact ID and version are supplied together, the artifact/version exists, and its publication instant is no later than the challenge instant.
- World import validates the same evidence binding.
- Server preflight and persisted-history replay enforce the pair and chronology; old challenge events without the optional evidence fields remain readable.
- Moonshot Field offers artifact/version selectors and renders an inspect link for retained challenge evidence.
- Challenge semantics remain `DISSENT · NOT ADJUDICATED`; no XP or adjudication outcome is created.

## Commits in this stutter-step

- `f8faf9ebeb1e9ce4d39a14cabed20c53f442d441` — model admission and import validation.
- `ffdde105b885d4b83b9f722f065d85ea1983f997` — HTTP preflight and persisted-history validation.
- `d98f78bccd1316fd34caf6e0d8404029b6137a8b` — evidence selector and retained-artifact link.
- `4023f3b9b5da202cc7865bb30ace2c3f1fc2d2ed` — HTTP evidence assertions.
- `aae89f6451724b894578fedd727d193773962efd` — future-version and incomplete-pair regression.
- `bcc74c0d4c5b4acaec2eadf203f3a9f9ea763a72` — browser evidence-selection coverage.
- `f1b7209e9b66d734f2fa0557ad00434444e884b0` — retry after server restart.
- `8a3447bdb2fe239c64ae35baf19cdffc712774e6` — legacy no-evidence and forged-version import regressions.

## Verification evidence and limits

The pre-change PR head `d9ca98ca02ce32d268f4a23bb7bc27aadd468d7e` had successful GitHub Actions runs:
- [Full verification, run 40626578097](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40626578097) — success.
- [Genesis Evidence Invariant, run 40626578053](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40626578053) — success.
- [Browser acceptance, run 40626578157](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40626578157) — success.

Those runs predate the evidence-link changes and do **not** verify the new commits. Exact-head CI for the updated code/test commits must be inspected before claiming the new behavior passes. No local test run is claimed.

## Unresolved blockers

1. PR #131 remains draft, open and unmerged.
2. Issue [#17](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/issues/17) remains open for independently controlled Founder signing/key custody, adversarial concurrency, and crash/stale-lock recovery.
3. PR #16 is closed and superseded by merged PR #18; no independent proof of Damien's private-key custody exists.
4. Signed world-attestation work in PR #76 remains unwired into the live mutation path, with no production trust roots.
5. Linked NGL Mesh APK/RAE integration remains unverified while required reference artifacts are unavailable.

## Next priorities

1. Inspect all three workflows on the exact latest PR #131 head; repair any observed failure and rerun.
2. Confirm the browser journey selects a retained artifact, sees its evidence link, and persists the exact version after a restart retry.
3. Keep challenges visibly unadjudicated; do not turn a citation or actor ID into an independent-observation claim.
4. Continue Issue #17's safe concurrency/crash-recovery acceptance without automatically deleting potentially live locks.
5. Reinspect current `main` and linked repositories before any further integration work.

No merge, deployment, release, spending, or production key operation occurred.
