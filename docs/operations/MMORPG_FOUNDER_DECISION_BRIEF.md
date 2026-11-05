# MMORPG Founder Decision Brief and Blocker Audit

**Audit date:** 2026-11-04  
**Repository:** `ngl-damien/No-Gas-Labs-Alpha-1`  
**Current-main baseline:** `42a31c0a0952f74b0dbcf29abaa5020c3fb5d1b0`  
**Purpose:** Separate decisions reserved to Damien from engineering, integration, verification, and external-evidence work. This is a source-backed audit snapshot, not a completion claim.

## Executive finding

The proposition that the ten MMORPG gates are mostly waiting on a Founder decision is **not supported** by the inspected repository evidence.

Founder decisions are genuinely required for G0 product/architecture choices, G4 encounter philosophy, and G9 final acceptance. Those choices influence several other gates. However, substantial non-Founder blockers remain: unintegrated feature stacks, a failing current-main verification run, incomplete RPG/social/economic capabilities, an unintegrated native Android package, missing physical-device evidence, and incomplete operational qualification.

The ledger's `NOT ASSESSED` state means unknown until audited; it must not be treated as proof of absence or as proof that a Founder decision is the blocker.

## Founder decisions actually required

The completion contract names the following G0 decisions:

1. **Intended first player experience:** the specific first release experience and what counts as the core MMORPG loop.
2. **Supported Android/device baseline:** the devices and OS baseline on which acceptance will be judged. The Android-native target itself is already decided by the contract; it should not be reopened by agents.
3. **Server model:** the intended initial shared-world hosting and authority model.
4. **Persistence model:** what character, world, identity, and progression state must survive, and under what recovery guarantees.
5. **Declared initial player scale:** the initial concurrent-player / world-population target against which performance and concurrency can be tested.

G4 explicitly reserves one design decision:

6. **Encounter philosophy — DECIDED: BOTH.** The MMORPG must support conventional combat encounters and a distinct non-combat encounter/challenge system built around research, adversarial challenges, strategy, and consequential decisions. These are complementary encounter modes within the RPG, not mutually exclusive alternatives. Agents must implement both as genuine gameplay with meaningful player actions, server-validated outcomes, progression/rewards, and repeatable content; do not reduce either to decorative dialogue or a renamed quest. The detailed balance, setting, and combat mechanics remain engineering/design work within this decision unless a genuine product-level conflict requires Founder escalation.

Conditional product decision:

7. **Player trading:** whether player-to-player exchange is in scope for the first release. The contract makes trade acceptance conditional on trading being enabled; if enabled, atomic transfer, replay protection, and conflict handling are engineering requirements.

Final authority:

8. **Release-candidate acceptance:** Damien's explicit acceptance is required only after the integrated candidate, mandatory gate evidence, and supported-device evidence exist.

No agent may generate, enroll, replace, or custody a production Founder key on Damien's behalf. The documented trust anchor remains `NOT_ENROLLED`; the Founder-controlled enrollment ceremony is a separate authority action after the implementation boundary is ready.

## Current-main and proposed-work findings

### G0 — Product and architecture definition

**Finding: Founder decisions required; not a purely engineering blocker.**

The contract requires the five G0 choices above. The current runtime is a local Node HTTP service with a file-backed single-writer store and a bounded in-memory session/presence layer. That describes the present implementation; it does not establish the production hosting model, persistence contract, or declared player scale.

**Next:** Damien records the G0 choices. Engineering can then convert them into measurable acceptance targets.

### G1 — Coherent playable loop

**Finding: a bounded browser vertical slice is hosted-verified; full MMORPG acceptance is not established.**

Current-main source includes the Common Ground browser world, authored guide locations, artifact drafting/publication, attributed notes/reports/discoveries, event-derived quest trails, and game-only progression. The main Browser Acceptance run `41829838376` passed 13/13 journeys, including desktop/mobile browser journeys and a two-session shared-world flow.

This proves the tested browser journeys, not a feature-complete MMORPG, native Android operation, or a complete product definition. The intended first-release experience remains a G0 decision.

**Next:** after G0, define one integrated release loop and extend tests against that declared experience.

### G2 — Persistent character and world

**Finding: substantial persistence mechanisms exist; the complete character-persistence contract is not established.**

Current-main `game/service-store.mjs` uses a private, bounded, atomic file-backed store. `game/server.mjs` and `test/game-server.test.mjs` cover world restart recovery, retained events, exact request replay, duplicate/retried actions, and writer exclusion. The main browser acceptance suite also records a shared-restart journey.

Limits visible in source: live sessions and presence are in-memory; Founder authority is not reconstructed from a cookie after restart; private player position is device-local storage; the contract for durable shared character position/profile is not demonstrated. The production persistence and identity requirements depend on G0.

**Next:** specify the G0 persistence contract, then close the shared-character and recovery gaps with tests.

### G3 — Authoritative multiplayer

**Finding: two-session server-authoritative browser behavior is demonstrated; scale and production multiplayer are not.**

Current-main server code derives actors from authenticated server sessions, validates actions server-side, serializes writes, broadcasts world/presence events, and applies session limits. The main browser acceptance script creates two independent browser clients and tests shared state, presence, unauthorized writes, and shared restart. Server tests cover concurrent idempotent requests and replay boundaries.

This is real two-session evidence, not evidence of production scale, independent human identities, geographically distributed infrastructure, or a public multiplayer service.

**Next:** declare scale and server model at G0; add load/concurrency and deployment tests to those targets.

### G4 — Core RPG systems

**Finding: partially implemented; a Founder design choice and engineering work both remain.**

Current-main character projections include Maker, Explorer, Observer, Scholar, Retriever, Challenger, Researcher, Experimenter, Adversary, Questkeeper, and Restorer activity. Quests are event-derived. The current character-sheet `inventory` is a projection of published creations, not an equipment/gear inventory. The current server action schema does not expose an equipment or equip/unequip loop.

The completion contract requires a tested encounter system. Damien has now decided **both** conventional combat and a distinct non-combat challenge/encounter system are in scope. The decision removes the either/or ambiguity; it does not implement either system.

**Next:** engineering designs and implements both encounter modes, with durable item ownership/equipment, server-authoritative resolution, meaningful progression/rewards, replay/concurrency protection, and tests. Escalate only specific design choices that cannot be resolved within the both-modes directive.

### G5 — Social and economic systems

**Finding: current main is incomplete; proposed work is not integrated.**

At the audited main commit, `game/social.mjs` is absent and the main server/model action schema has no player-guild lifecycle or Commons social action set. Proposed PR #349 adds the Commons; PR #350 adds player guild create/join/leave/disband and a read-only member field satchel. The proposed guild mechanism explicitly does not add trading, guild bank, leadership transfer, or transferable item ownership.

PRs #349 and #350 are draft proposals, not mainline capabilities. Their branch checks passed on their recorded exact heads; this does not establish integration.

**Next:** reconcile and integrate the social/guild stack; Damien decides whether trading is in first-release scope; engineering implements safe atomic exchange if enabled. Moderation policy must be explicit before public release.

### G6 — Persistent world and repeatable content

**Finding: current main has a functioning authored world and event-derived research/quest loops; the expanded persistent MMORPG world remains proposed and incomplete.**

Current main contains the Common Ground map, guide locations, artifact buildings, source-observatory and Moonshot activity, retained event history, and actor-scoped quest projections. Proposed work adds Commons/Guild Hall, Council Chamber, Academy Study Shelf, and Quest Board interactions across PRs #349–#361.

The latest Quest Board stack (PR #361, head `9c70f012101d63353ae18c256cd669398af2cf34`) passed its recorded exact-head Verify, Genesis, Playable World, enforcement, and touch-route checks. It is still draft/unmerged. The checkpoint states source retrieval and independent source verification remain `NOT_PERFORMED`.

**Next:** integrate the proposed locations in a reconciled stack, implement genuine source retrieval/independent verification where required, and prove repeatable content/recovery loops.

### G7 — Android-first mobile experience

**Finding: Android-native direction is already decided; integration and device evidence remain.**

Current main does not contain a verified native Android delivery. PR #247 proposes an offline-first Android package but its recorded emulator acceptance failed. A later lifecycle stack in PR #309 reports 7/7 API 35 emulator instrumentation tests passing, but that stack is draft and highly divergent from main. The MMORPG checkpoint explicitly records no physical Android-device acceptance.

The current browser touch journeys at 320px/390px are browser simulations, not Android device verification.

**Next:** reconcile the native package/lifecycle work against current main and current authority code; then install and exercise the resulting package on the declared physical Android baseline.

### G8 — Operational readiness

**Finding: confirmed non-Founder blockers remain, alongside Founder-controlled key enrollment.**

Current-main Verify run `41829838351` failed 1 of 775 tests at `test/decision-chamber.test.js:10`, where a legacy test expects authorization against the default `NOT_ENROLLED` trust anchor. Main Genesis run `41829838437` and Browser run `41829838376` passed.

Worker A's PR #316 changes the helper/test trust boundary but is draft, stacked on PR #312, and is not live server authorization. The MMORPG checkpoint states the live `/api/decisions/choose` route does not call the signed authorization verifier. The trust anchor correctly remains `NOT_ENROLLED`; no agent may enroll it.

The current evidence does not establish production backup/restore, observability, or performance at a declared scale.

**Next:** Worker A reconciles and integrates the signed-verifier API/test boundary and live route safely, failing closed until trust enrollment. Damien performs the production trust ceremony only when the implementation is ready. Engineering adds restore, observability, and scale evidence.

### G9 — Release and Founder acceptance

**Finding: not ready for a Founder acceptance decision.**

There is no integrated release candidate with all mandatory gates evidenced, supported-device acceptance, and unresolved-defect disclosure. Founder acceptance is the final decision, not the current engineering blocker.

**Next:** assemble the candidate only after G0–G8 evidence is complete; then request explicit acceptance.

## Integration facts that prevent treating the draft stack as done

- Main baseline is `42a31c0a0952f74b0dbcf29abaa5020c3fb5d1b0`.
- The active game chain #349 → #350 → #355–#361 is stacked. PR #361 is based on #360, which is based on #359, etc.; it is not a standalone change against main.
- Comparing PR #361 head `9c70f012101d63353ae18c256cd669398af2cf34` directly with current main reports 353 commits ahead, 4 behind, and 56 changed files. This is not a safe instruction to merge or squash the entire chain wholesale.
- The Worker B checkpoint identifies an authority-test incompatibility between the game stack and Worker A PR #316. It must be reconciled before integration.
- PR #247 and PR #309 are separate Android proposals; neither constitutes an integrated, physically device-verified Android release.

## Work classification

| Category | Items |
|---|---|
| Decisions reserved to Founder | G0 product/architecture choices; optional trade scope; G9 release acceptance; production key enrollment ceremony (G4 encounter philosophy is decided: both modes) |
| Engineering/integration | Reconcile PR stack; fix current-main Verify failure with the owning authority work; add equipment/encounter implementation after design choice; integrate Commons/guilds; implement trading if selected; reconcile Android package/lifecycle; close live signed-verifier boundary |
| External/device evidence | Physical Android installation and core-loop acceptance; production-like backup/restore; declared-scale performance/concurrency; independent specialist review where required by Founder Directive 001 |
| Already demonstrated within bounded scope | Browser vertical slice; two-session shared browser world; file-backed shared-world restart; exact request replay/idempotency; event-derived quest/skill projections; branch-level touch/browser journeys |

## What this audit does not authorize or claim

This audit does not merge PRs, change the production trust anchor, generate or enroll Founder keys, deploy, publish, spend, change permissions, alter live game state, or claim independent human review. Branch-level green checks remain branch-level evidence. No physical-device test was performed in this audit.

**Founder decision recorded 2026-11-05:** both conventional combat and the distinct research/strategy/adversarial challenge encounter system are in scope. G4's either/or decision is closed; implementation and balancing remain engineering work.

**Conclusion:** the Founder decision queue is identifiable and relatively compact. It is not yet the only thing holding the MMORPG back. The remaining engineering, integration, and external-evidence blockers are real and independently documented.