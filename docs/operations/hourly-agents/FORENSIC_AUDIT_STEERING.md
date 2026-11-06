# Forensic Audit + Build MMORPG Steering — Worker B

Last refreshed: 2026-11-05  
Role: MMORPG / playable-world runtime and G0–G9 evidence ledger  
Canonical repository: ngl-damien/No-Gas-Labs-Alpha-1

## Current observed baseline — 2026-11-05

- Current main: 6f1a4aefb87334ddad359af12f754505965e29a5. Main contains the local player-position module and private position persistence, but has no Android package and no portable ngl.private-save.v1 envelope.
- Active proposed stack: PR #366 integration → #367 actor-owned Forge inventory/equipment → #370 renderer lifecycle guard → #371 offline Android/private-save shell. PR #371 is draft, head b1c6eff71da6d4bc5485690efb826687ec162f1d, child of #370 head 2e00a81b0bf433b10a2ff56b099fa00b2683e1ef. Against current main the stack is 65 commits ahead / 2 behind, merge base 950a976560354ffa86ddd3b01f9c6d42d4247d22. Do not merge or rebase as-is.
- PR #301 is merged; the prior steering instruction to wait for its exact-head verification is satisfied and no longer current.
- Exact head b1c6eff: Verify 42113044294 PASS with hosted preflight ready, zero warnings/failures; Genesis 42113044253 PASS; Browser 42113044231 PASS 15/15, including private position round-trip and rejection of a tampered position containing an injected ID without changing world/position storage. Academy, Quest Board, Council Chamber and Synthesis Clerk mobile checks 42113044247, 42113044230, 42113044177 and 42113044273 each PASS 2/2. Android Alpha-1 42113044448 passed preflight and APK assembly but its emulator journey was still in progress at last observation.
- PR #371's Android shell is intentionally offline: no INTERNET permission, no shared-service configuration, and shared mode fails closed. No physical Android device was available or tested. Emulator acceptance is not physical-device acceptance.
- Worker A's latest open proposals at this baseline: PR #373 changes only the shared scheduler protocol; PR #372 changes only TRU research documents. No game/Android path collision was observed.
- Recovered donors: PR #298 provides actor-owned, source-linked Forge items/equipment; PR #289 provides the earlier Android package donor but its own Android run failed; PR #309 provides WebView lifecycle hardening and its own Android run passed 7/7. Donor results do not verify the combined #371 head.

## Current priority

1. Finish exact-head Android emulator run 42113044448. If it fails, distinguish application failure from emulator/system failure using logs and diagnostics; do not relabel an environment crash as an app defect.
2. Keep PR #371 as the current Worker B proposal; do not create another PR or fan out work. After exact-head checks, reconcile #366/#367/#370/#371 against current main 6f1a4aef. Preserve the two documentation-only main commits and inspect exact ancestry/conflicts before any integration.
3. Obtain physical-device acceptance on a supported Android device. No physical-device model, OS build, installation or journey is currently observed.
4. Keep Android offline-only until explicit authorization for network permission and a configured shared service. Do not add INTERNET permission, service endpoints, credentials or remote sync by assumption.
5. Maintain MMORPG_COMPLETION_LEDGER.md and LATEST_CHECKPOINT.md on every substantive game run. G2 and G7 remain IN PROGRESS; G9 remains NOT STARTED. A draft PR is not integrated capability.
6. Continue prioritizing executable, event-backed world behavior: actor-owned inventory/equipment, source-linked quests, bounded NPC/collaborator actions, deterministic projections, and preserved failures/dissent. No XP or authority from mere inspection, model assertions or private position saves.
7. Do not merge, release, deploy, publish externally, spend, change credentials/keys/permissions, or make Founder decisions without the applicable explicit authorization.

## Evidence discipline

- Treat branch/PR descriptions as leads; re-fetch source, exact heads, diffs and exact-head workflow results every run.
- A green check proves only its named tests. Browser viewport simulation is not physical Android verification; emulator is not a physical device; a draft PR is not integrated capability.
- Keep the single append-only event history and deterministic projections. Offline client actions remain proposals until server reconciliation; duplicate/replayed actions cannot duplicate rewards.
- Use recovered RAE/Mesh/Relay evidence/authority patterns selectively. Do not copy whole donor applications or treat a donor's hash, report, APK label, or model narrative as truth.
- If local checkout/preflight is unavailable, follow the manual instruction sequence and record the limitation; rely on hosted preflight only as post-change evidence.

## Historical note — 2026-11-04

The previous Worker B baseline was the #349 → #350 → #355 → #356 → #357 → #358 → #359 Academy/Council stack. That branch family has been superseded by #366 → #367 → #370 → #371. Its source-provenance and authority cautions remain valid, but its PR focus and current-main SHA are historical.
