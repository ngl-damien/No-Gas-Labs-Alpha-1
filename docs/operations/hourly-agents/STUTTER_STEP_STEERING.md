# Stutter-Step Loop Steering — Worker A / Repository Stutter-Step

**Worker:** NGL Repository Stutter-Step Loop (registry ID `6ac6c77de7ac81918e446a49ea330eb6`)  
**Canonical repository:** `ngl-damien/No-Gas-Labs-Alpha-1`  
**Last refreshed:** 2026-11-27  
**Authority:** Damien Featherstone remains the Neophyte Founder and retains all protected decision rights.

This steering file is an operational prioritization aid, not a substitute for root `AGENTS.md`, the complete shared Ralph protocol, the Institutional Charter, current source, or exact-head evidence. Re-read governing files in their mandatory sequential order every run. Rehydrate from current main, the latest checkpoint, the other worker's latest durable result, and all relevant open PRs before claiming work. Run portable preflight when a local checkout/runtime is available; otherwise follow the manual sequence and record the limitation.

## Mission and product invariant

Advance No_Gas_Labs™ as both a reliable, evidence-governed institution and a genuinely playable, Android-first MMORPG. Preserve AOTA: commercial, scientific, technical, creative, educational, civic, public-interest, and institutional work remain in scope; sequence by evidence, dependency, risk, leverage, resources, and Founder authority.

The Founder journey target is visual, intuitive, game-native, and understandable without coding, terminal, raw API, JSON, or GitHub developer workflows. This is a requirement, not a claim of current capability.

## Current evidence-based priorities (2026-11-27)

### 1. Android integration acceptance and reproducibility

- PR #763 is a diagnostic child of #755, source head `c65591dce5e0cc718606343308ccaa7a516d5ffc`; its integration candidate `9d648eb507cd0e74adb9cadfa96bc32215ceb8b7` passed Full Verify, Genesis, Browser, and Android. Android completed 15/15 emulator tests. The decoded log did not contain the intended `NGL-RESTORE-DIAG` markers, so the earlier renderer crash was not reproduced and its cause remains unknown. This is not physical-device acceptance.
- PR #765 exact source head `6ab0d2ba7b6a11b8efadc16ae305b04d87c55572` has Full Verify, Genesis, Browser, Source Archive, and Synthesis PASS; Android run `46031852318` failed. The retained PR handoff says 12/15 tests completed, `founderGateIsReachableThroughTheMobileWorldAndRemainsReadOnly` failed, then instrumentation aborted because the system crashed. The available XML did not expose the assertion body. Do not attribute the failure to the Founder Gate or app code without a reproducible assertion/stack.
- Worker A owns Android native bridge/instrumentation/lifecycle/retry diagnosis. Reuse #763's instrumentation approach; do not duplicate Android paths on a competing branch. Obtain the exact failing artifact/log and distinguish assertion failure from emulator process failure.

### 2. Founder authorization — preserve fail-closed behavior

- Historical PR #16's self-signing allegation is superseded by replacement PR #18, merged as `213f3b5c7771da24b36f9ce6ebdde871d22e4602`. Do not reimplement the obsolete fix.
- Current main's `src/authority/decision.js` `authorizationEvent(input)` obtains trust from host configuration, requires enrolled PRODUCTION trust, verifies the signed decision using host time, consumes the durable Founder nonce, and only then emits an authorization event. Do not revive stale claims that it trusts caller-supplied `verification.valid`, caller-selected trust paths, or an optional in-memory nonce set without rechecking current source.
- Current `docs/authority/founder.pub.json` is `NOT_ENROLLED`. Current `game/server.mjs` imports `loadTrustAnchor`, not `authorizationEvent`; its live Decision Chamber status helper returns `SIGNED_DECISION_ROUTE_NOT_INTEGRATED` for enrolled PRODUCTION trust. Thus the live server mutation boundary remains fail-closed and signed decisions are not integrated.
- Issue #17 remains the security/custody follow-up but its older sections are historical. Reconcile each claim against current main before acting. The next technical work is a coordinated, adversarially tested live-route integration contract with Worker B; Founder-controlled platform key custody, proof of possession, and explicit enrollment remain Founder-only prerequisites.
- Never generate, export, rotate, provision, or enroll a Founder key; never enable a partial route, bypass nonce durability, or treat a green proposal PR as production authorization.

### 3. Multiplayer capability — avoid duplicating Worker B

- PR #764 exact head `9d1958a82f88fa09006740de48c7e2f70501a3b8`: Full Verify, Genesis, and Browser PASS. It covers two-session shared-world state across one server-process restart; it does not prove multi-instance consistency or distinct human participants.
- PR #765 exact head `6ab0d2ba7b6a11b8efadc16ae305b04d87c55572`: concurrent Commons writes, actor attribution, retained ordering, same-actor idempotency, and cross-actor request-ID collision rejection. Full Verify, Genesis, Browser, Source Archive, and Synthesis PASS; Android FAIL as described above.
- These are complementary proposed test branches, not mainline integration or complete G3. Worker B owns the multiplayer test/runtime paths. Worker A should review multi-instance durability/locking and cross-worker acceptance boundaries without editing those active paths.

### 4. Continuity and checkpoint integrity

- PR #762 (continuity relay) and PR #760 (Worker A run records) are open draft proposals, not canonical mainline policy.
- Current main's `LATEST_CHECKPOINT.md` and `MMORPG_COMPLETION_LEDGER.md` are historical relative to the 2026-11-27 PR activity. PR #758 carries Worker B's newer proposed checkpoint/ledger state but is itself a draft documentation child of an older runtime base.
- Do not overwrite large historical checkpoint files from partial reads. Preserve append-only run records and explicitly distinguish mainline capability from proposal-branch evidence. Reconcile checkpoint freshness through a reviewed documentation proposal; do not call a draft ledger canonical.

## Operating method

Use the shared protocol's rehydrate → observe → rank → claim → challenge → act → verify → review → preserve → handoff → repeat cycle. Before each edit, inspect the target and competing PRs again. Prefer an existing sound branch over duplication. Make bounded, functional, unowned improvements; use test-first regressions and exact-head CI. If local preflight/tests are unavailable, state exactly why and use hosted evidence without claiming local execution. Preserve failed attempts and unknowns.

## Protected boundaries

No merge, release, deployment, external publication, spending, destructive action, secret/credential/permission change, Founder key custody/enrollment, or consequential authority transition without the applicable explicit Founder authorization. This steering file does not grant authority or change the mission/governance. $0 additional cash cost.
