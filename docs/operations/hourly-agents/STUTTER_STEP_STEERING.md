# Stutter-Step Loop Steering — Worker A — refreshed 2026-11-09

**Owner:** NGL Repository Stutter-Step Loop (`6ac6c77de7ac81918e446a49ea330eb6`)  
**Repository:** `ngl-damien/No-Gas-Labs-Alpha-1`  
**Observed main:** `6f1a4aefb87334ddad359af12f754505965e29a5`  
**Founder authority:** Damien Featherstone retains all Founder decisions. This file authorizes no merge, release, deployment, key enrollment/custody, spending, external publication, permission change, or production-state mutation.

## Scheduler and continuity state

- The repository registry records this worker as `enabled-degraded-free-tier` and `do_not_delete: true`. This execution is directly observed; do not claim uninterrupted work between host runs.
- Preserve the registered task identity. Do not delete, recreate, or alter schedules to work around plan limits.
- Use repository branches, PR descriptions, checks, and durable checkpoint files for continuity. A prior report or a branch name is a lead, not proof.

## Authority findings and supersession

- PR #16 is closed/unmerged. Its Experiment 001 candidate was transplanted into PR #18, which is merged. Do not repeat the obsolete claim that PR #16's old `demonstrate()` self-signing flow is the current live defect.
- Current `main` still has a distinct source-backed authority gap in `src/authority/decision.js` (blob `9eb92b02f3948c9f5f1d703af35fdfcb062ab9a3`): `authorizationEvent()` accepts a caller-supplied `trustPath`, and `verifyFounderDecision()` treats the nonce as optional and does not bind it into the signed bytes. The old PR #16 issue and these current-main defects are different claims.
- Current `docs/authority/founder.pub.json` remains `NOT_ENROLLED` (blob `d8bbc990cbdb08304e6ce3b5be0a417ac4c16e9b`). No production trust-root path or nonce ledger was provisioned. Do not generate, enroll, export, rotate, copy, or provision Founder key material. Real key custody, proof of possession, and enrollment remain Founder-controlled.
- The live game server's local Founder-session boundary is not proof that the separate signed authority module is integrated into the server. Do not claim signed Founder decisions govern live game actions until an actual call path and tests establish it.

## Active security proposal — re-observe before acting

- Draft PR #441, `security/founder-authority-mainline-snapshot-20261109-run1`, is based directly on main `6f1a4aefb87334ddad359af12f754505965e29a5`; current observed head `db8d73b4fd7ab5f17ba7ed167f15e706290d3cc8`. It consolidates host-configured trust, exact authorization input, nonce-bound signed envelopes, durable nonce replay history, offline lock recovery, explicit ledger initialization, and a fail-closed Node enrollment CLI.
- PR #441 exact-head Verify run [42740276387](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42740276387) failed 891/892 tests. The single failure was a diagnostic expectation in `test/founder-enroll-ceremony.test.mjs`: the copied candidate uses schema `ngl.founder-enrollment-candidate.v1`, so the loader correctly returns `MALFORMED_TRUST_ANCHOR`; the test already allowed that inspection state but its authorization assertion allowed only `NOT_ENROLLED`. Genesis [42740276118](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42740276118) and Browser [42740276169](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42740276169) passed.
- Draft child PR #444, `fix/pr441-enrollment-sentinel-assertion-20261109-run2`, is one commit on top of #441: `ac9fd6cad19908a4b33c374514939d47d6e0d745`. It changes only that test assertion; no runtime authority behavior changes. On the first observation, Verify [42744756544] and Genesis [42744756461] passed; Browser [42744756245] was still in progress. Recheck all checks on the exact current child head before relying on them.
- Do not merge #444 independently or treat it as mainline capability. Review #441 and #444 together. #441 remains proposed work until Founder review and explicit authorization.
- Important unresolved #441 limits: no real Founder key is enrolled; no production trust or nonce-ledger path is configured; no platform-backed non-extractable keystore or independently verified custody exists; the signed authority path is not demonstrated as integrated into live game-server authorization. Green tests cannot resolve those human/operational dependencies.

## Latest Worker B result — avoid duplicate game work

- Latest observed Worker B proposal is draft PR #442, a documentation-only child of PR #435. It records the Synthesis Clerk handoff stack at parent head `450203b81bc4a5a4b0247e3978089d71e4ffa6f8`.
- PR #442 head: `678127e45ab578c9f75e81cb6ab12f779516070b`. Its exact-head Verify [42742749100], Genesis [42742749388], Browser [42742749544], and Synthesis Clerk mobile [42742749705] checks passed. Android Alpha-1 [42742749565] was still in progress at last observation; poll before updating status.
- The parent #435 evidence recorded 15/15 Browser journeys and 12/12 API-35 emulator instrumentation tests. This is hosted emulator evidence, not physical-device acceptance. The Synthesis Clerk snapshot is build-time, not live; byte receipts identify bytes, not truth.
- PR #442 updates `docs/operations/LATEST_CHECKPOINT.md` and `docs/operations/MMORPG_COMPLETION_LEDGER.md` on its proposed branch. Those updates are not mainline. Do not edit those same files on a competing branch; inspect the current Worker B stack first.
- Do not duplicate the Synthesis Clerk, Combat Yard, Founder Gate, Android, or other active Worker B implementation. Review cross-cutting security or give a concrete handoff instead.

## Ranked Worker A priorities

1. **Finish exact-head verification of #444, then reassess #441.** Poll Browser and all checks on the current #444 head. Diagnose any failure from the actual job log; do not transfer #441 or older-child results. Repair only source-backed, attributable failures on a dedicated safe child branch.
2. **Independently review #441's security boundaries.** Recheck trust-path anchoring, exact signed-envelope binding, nonce-ledger durability, concurrent writers, crash-before/after-rename, recovery leases, and initializer safeguards. Distinguish configured trust from Founder identity. Do not provision keys or production paths.
3. **Review the signed-authority/live-server boundary.** Map the real game-server authorization call path and tests. Coordinate with Worker B if the boundary overlaps Founder Gate work; do not implement a parallel game gate. If integration requires Founder key enrollment or a consequential policy decision, stop and state the exact human dependency.
4. **Rehydrate Worker B's newest result and ledger.** Check #442's current head and Android run, then preserve the distinction between proposed stack, hosted emulator evidence, physical-device acceptance, and mainline capability.
5. **Reconcile durable continuity without collisions.** Main's `LATEST_CHECKPOINT.md` is older than the current proposed Worker B checkpoint. Do not overwrite #442's checkpoint/ledger work; update steering/checkpoint only on a branch that is current, unowned, and non-conflicting.
6. **Resume broader repository-portfolio work only when it removes a demonstrated blocker.** Read each target repository's own instructions and checkpoint first. Do not copy repositories or spend money.

## Operating rules

- Every run: read root `AGENTS.md`, then the complete shared protocol, then the Institutional Charter, sequentially and alone. Only then inspect repository state, open PRs, source, CI, checkpoints, and the other worker's result.
- Inspect applicable nested `AGENTS.md` files for every target path. Run portable preflight before edits when a checkout/runtime is available; otherwise record the limitation and complete the manual instruction sequence.
- Reinspect immediately before edits and again after every change. Prefer a reproduced source-backed defect, a narrow safe branch, negative tests, exact-head hosted checks, and a durable handoff.
- Record exact branch/commit/PR, changed paths, test totals, hosted run IDs/statuses, observed results, unresolved blockers, and next action. A PR is proposed work, not integrated capability.
- Preserve $0 additional spend and phone-controllable workflows where practical. Never claim background execution between runs.
