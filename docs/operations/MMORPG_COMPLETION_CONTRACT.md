# MMORPG Completion Contract

**Purpose:** define what counts as building and finishing the No_Gas_Labs™ MMORPG.  
**Status:** delivery contract; product details remain subject to Damien's decisions.  
**Canonical evidence ledger:** `docs/operations/MMORPG_COMPLETION_LEDGER.md`.

This contract prevents engineering activity, governance improvements, map screens, disconnected features, or draft pull requests from being mistaken for a finished MMORPG. It defines minimum acceptance gates without pretending that unverified capabilities already exist.

## Product stages

Use these stage labels accurately:

1. **Prototype:** an experiment or partial mechanic. It may be local, mocked, or disposable.
2. **Playable vertical slice:** one coherent player journey works end-to-end, including a meaningful action, a durable consequence, and progression.
3. **Multiplayer alpha:** independent players can enter the same server-authoritative world, see one another, and produce correctly reconciled shared consequences.
4. **Feature-complete beta:** all mandatory RPG, social, world, mobile, and operational gates are implemented and under integrated testing; known defects are tracked.
5. **Release candidate:** mandatory gates pass on the declared production-like configuration and supported Android devices; recovery, security, performance, and acceptance evidence is complete.
6. **Released:** an authorized release has actually been deployed or distributed and independently observed. A repository PR or build artifact is not a release.

## Mandatory release gates

### G0 — Product and architecture definition
- State the intended player experience, supported Android/device baseline, server model, persistence model, and declared initial player scale.
- Identify which systems are native, web/PWA, server-side, or local-only.
- Record unresolved product decisions as decisions needed; agents must not silently invent Founder preferences.

### G1 — Coherent playable loop
- A player can enter or resume a character, explore the world, discover and interact with locations/NPCs/objects, complete a meaningful activity or quest, receive an earned consequence, and find a clear next activity.
- The loop must be usable through the intended mobile controls, not merely through developer tools or hidden routes.
- The end-to-end journey must be tested in a real runtime, with state changes and rewards derived from validated events.

### G2 — Persistent character and world
- Character identity/session, position, progression, inventory, and relevant world changes survive reloads and server restarts according to the declared persistence contract.
- Failed, duplicate, retried, or out-of-order requests cannot silently duplicate rewards or corrupt canonical state.
- Recovery behavior is explicit; stale or unavailable state is never presented as fresh.

### G3 — Authoritative multiplayer
- At least two independent clients, not merely two views sharing one in-memory test object, connect to the same authoritative server/world.
- Players can observe each other's presence and relevant movement/actions with defined consistency and conflict behavior.
- Shared mutations are validated and committed server-side; clients and NPC/model text cannot grant themselves canonical rewards, inventory, authority, or progress.
- Tests cover reconnects, duplicate requests, concurrent writes, unauthorized actions, and server restart/recovery.

### G4 — Core RPG systems
- Character attributes and progression have defined rules and durable state.
- Skills or equivalent advancement systems have meaningful, evidence-backed progression.
- Inventory, item ownership, equipment, and rewards have validated state transitions.
- Quests, NPC interactions, and encounters form repeatable gameplay rather than isolated buttons.
- Combat or another deliberate challenge/encounter system has documented rules and tested outcomes. If the intended game design excludes conventional combat, Damien's decision must be recorded rather than inferred.

### G5 — Social and economic systems
- Players can communicate through the supported social channels and form groups/parties or guilds.
- Player-to-player exchange, if enabled, uses atomic ownership transfers and protects against duplication, partial trades, replay, and conflicting updates.
- Moderation, blocking/reporting, and abuse handling have an explicit minimum policy before public release.
- A UI mock or NPC dialogue is not evidence that a social or economic operation works.

### G6 — Persistent world and repeatable content
- The world contains connected places, activities, NPCs, quests, and progression loops with clear player purposes.
- Players have meaningful reasons to return; content is not only a one-time onboarding sequence.
- Content creation and updates have a maintainable, reviewable path.
- Institutional work may become world content or progression only through the game's validated event/projection rules.

### G7 — Android-first mobile experience
- The declared supported Android devices can install, launch, resume, navigate, and complete the core loop with touch controls.
- Layout, accessibility, performance, lifecycle interruptions, storage, connectivity loss, and update behavior are tested on actual supported devices.
- A responsive website or installable PWA may be a useful interim client, but it must be labeled as such. Do not call it a native Android application or claim Android device acceptance without a built package and device evidence.
- If the final target remains Android-native, a native package and its integration boundary are mandatory release evidence.

### G8 — Operational readiness
- Authentication/session boundaries, authorization, input validation, rate/abuse controls, and data isolation are tested.
- Backups and restore are exercised; server restart and partial failure do not silently lose or invent progress.
- Logs/diagnostics allow failures to be investigated without exposing secrets or unnecessary personal data.
- Performance and concurrency are tested against the declared initial player scale. Do not claim scale from a small unit test.

### G9 — Release and Founder acceptance
- All mandatory gates have exact source refs, integrated test evidence, supported-device evidence, and unresolved-defect disclosure.
- The candidate is reviewed as one integrated product, not inferred from separately passing feature PRs.
- Damien explicitly accepts the release candidate. Deployment, distribution, external publication, or spending still requires the relevant explicit authorization.
- "Released" is recorded only after the authorized release is independently observed.

## Evidence and lifecycle rules

Every ledger row must distinguish:
- **Not assessed:** no current source/evidence audit has been completed.
- **Not started:** audited and no implementation exists.
- **In progress:** implementation is underway.
- **Implemented:** source exists, but verification/integration is incomplete.
- **Locally tested:** specified local tests passed; hosted/integration status remains separate.
- **Hosted verified:** named hosted checks passed on the exact recorded commit.
- **Integrated:** the capability is present on the target branch and rechecked there.
- **Device verified:** tested on named physical Android device(s), OS version(s), build, and journey.
- **Founder accepted:** Damien explicitly accepted the evidenced candidate.
- **Released:** authorized release and external observation are recorded.

A gate may have multiple evidence dimensions; do not compress them into one optimistic status. Record failures and superseded runs. A cancelled or stale CI run is neither a pass nor a failure for the current head. A passing test proves only the behavior it exercises.

## Agent execution priorities

- Worker B owns the game ledger and selects the highest-leverage incomplete gate on each run. The first task after adopting this contract is a source-backed audit of current main and active game PRs; do not mark existing gates "not started" merely because the audit has not happened.
- Prefer one coherent end-to-end player capability over disconnected UI, scaffolding, or cosmetic work.
- Before each edit, inspect active ownership and exact-head checks. Integrate complementary features only on a reviewable branch with explicit ancestry and tests.
- Worker A prioritizes institutional reliability and cross-cutting blockers that materially enable a gate. It must not create competing game implementations.
- If the highest gate is blocked by a product decision, external artifact, device, key custody, service, or authorization unavailable to the agent, record the exact blocker and move to the next safe independent gate.
- Repeated infrastructure-only runs must explain which gate they unblock. They must not become a substitute for game delivery.

## Completion claim

The game is **not complete** because a map renders, a quest exists, a browser journey passes, multiple feature PRs are open, or the codebase has many tests. It is complete only when G0–G9 are evidenced to the appropriate release stage, the integrated candidate passes, actual supported Android device acceptance is recorded, and Damien has explicitly accepted it. "Released" additionally requires authorized deployment/distribution and independent observation.
