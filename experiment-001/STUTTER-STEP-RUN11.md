# Repository Stutter-Step Run 11 — 2026-10-20

Fresh baseline: main `7b5085b5`, draft PR #16 `5266589`, issue #17 open, Run 10 checkpoint `9f5752a`. Safe branch created from Run 10. Remote institutional-cycle source still blob `a282724870418271f12ae462d58cc90f01fe1e37` (Run 5), not Run 10/11.

Local recovered Run 10 baseline: 42/42 tests. Precommitted hypotheses: (A) unanchored receipt inspection can misreport a rolled-back ledger as NOT_FOUND; (B) a compromised delegate cannot be rotated without disabling the entire capability. Both were addressed in a LOCAL candidate: `inspectReceipt` now requires independently pinned current signed witness (legacy unanchored inspection explicitly named unsafe), and Founder-signed `ROTATE_DELEGATE` replaces a worker key without increasing quota or widening scope.

Observed local results: 46/46 Node tests passed (4 new); 100 five-writer races -> 100 commits, 400 rejected attempts, 0 observed overwrites. Independent Python Ed25519 audit verified 4 signatures, 4 record hashes, two persisted invocations, and signed checkpoint. Negative controls: unanchored rollback returned NOT_FOUND, pinned newer witness rejected rollback; missing/tampered witness rejected; old worker signature after rotation, worker-signed rotation, quota widening, and rotation after full revocation rejected. Synthetic keys only.

**Integration blocked:** Normal connected GitHub `update_file` attempt for signed-decision detachment was rejected; no source commit, no exact-head CI of Run 11. No alternate write path was used. The Run 11 executable ZIP is attached to the automation conversation, not committed. A green GitHub workflow for this documentation commit would not validate local source.

Next: (1) obtain authorized source-write path and exact-head CI; (2) enforce pinned Founder/witness policy across every consequential entry point, including authenticated genesis; (3) test joint rollback against an independently maintained monotonic anchor and compromised-worker rotation races; (4) independent-provider candidate generation/verification.

Limits: Unanchored `openInstitution` remains available; no real Founder identity, external provider autonomy, power-loss resilience, or novel cryptography established. No merges, deployments, spending, or Founder signing. Verified major breakthroughs cumulative: **0**.
