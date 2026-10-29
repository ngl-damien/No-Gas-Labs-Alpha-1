# Donor Repository Audit — 2026-10-28

## Purpose and scope

Identify code worth reusing in Alpha 1's persistent, mobile-first institutional MMORPG. This is a source inspection and reuse triage, not a claim that donor code has been imported, built, security-reviewed in full, or tested as part of Alpha 1.

**Inspection method:** queried the currently connected `ngl-damien` GitHub account; enumerated the recursive default-branch trees for all 12 repositories returned; inspected representative source, tests, package manifests, README/provenance/operational files for the larger candidates. Source refs are the default branches observed during this audit, not immutable commits unless a blob SHA is listed below. Repository trees can change.

**Boundary:** the 2026-10-25 recovery manifest lists 94 historical `No-Gas-Labs-Official` repositories. That manifest is historical inventory, not proof that all 94 repositories or their full git histories are accessible in the current `ngl-damien` account. This audit covers the 12 repositories actually enumerated there; the other historical names remain a separate recovery scope.

## Executive disposition

1. **Reuse selectively now:** Alpha 1's own event/quest/projection machinery; ngl-mesh's evidence/authority contract concepts and tested Java bridge patterns; selected persistent-world and adversarial-counterexample concepts from Damien-Featherstone; TaskAgile's offline queue and mobile interaction patterns only after hardening.
2. **Study and adapt, not copy wholesale:** no-gas-labs single-file RPG, Command Center's Node-Gate UX, ngl001's contact ledger and founder acceptance sequence, TaskAgile multiplayer/persistence.
3. **Do not treat as implementation:** repositories consisting only of README/provenance stubs; unverified historical APK/build claims; manifests, screenshots, and generated project narratives.
4. **No donor code has been copied into canonical `main` by this audit.** PR #163 contains the separate Guild Hall + Evidence Archive integration. This document is a donor-selection record, not a merge authorization.

## Repository-by-repository findings

### 1. `ngl-damien/No-Gas-Labs-Alpha-1` — canonical target, not a donor

- Observed: 622 tracked blobs on `main`; existing world client, quest projections, event-backed institutional mechanisms, static-asset allowlist, browser-acceptance workflow, verification workflow, genesis invariant workflow, assimilation plan and world-projection contract.
- Reusable: current event schema, retained artifact-version links, bounded institutional interactions, static standalone packaging, browser acceptance and invariant checks.
- Unique role: canonical integration target and source of release truth.
- Decision: extend this architecture; do not replace it with a donor dashboard or second state model.

### 2. `ngl-damien/Damien-Featherstone` — strongest persistent-world/gameplay donor

- Observed: 75 blobs; substantial React/TypeScript server/client; `src/components/PersistentRpgWorld.tsx`, `RetroOsrsEngine.tsx`, `CounterexampleForge.tsx`, `src/forgeEngine.ts`, `src/cryptoUtils.ts`, `src/worldTypes.ts`, `server.ts`, `tests/verifyWorld.ts`.
- Reusable candidates:
  - District/NPC/world-presence types and RuneScape-style spatial interaction vocabulary.
  - Counterexample Forge: adversarial test vectors, isolated trial outcomes, repair petitions, and explicit distinction between defeating a claim and repelling an attack.
  - Receipt-chain data model: parent hashes, receipt hashes, chain-link audits, optional signatures, provenance types, unverified claims and founder verdicts.
  - Existing test harness appears to exercise server boot/restart, auth boundaries and world validation; inspect relevant tests before porting.
- Risks/limits: large mixed UI/server implementation and provider-specific integrations; a hash chain does not establish truth, and an interface's `founderAuthorized` field is not itself a secure authority check.
- Decision: port small typed domain concepts and adversarial test cases after mapping them to Alpha 1's event contracts. Do not transplant the whole application.

### 3. `ngl-damien/ngl-recovery-2026-10-25` — recovery metadata and archived artifacts

- Observed: 37 blobs, including a 94-repository CSV/text manifest, clone script, file inventories, provenance notes, and zipped/tarred Omnichain Bridge Wallet and DÍA P2E cockpit artifacts.
- Reusable: manifest parsing and reconciliation workflow; archive inventories as discovery leads; provenance/transport status as explicit recovery states.
- Unique value: evidence of the historical repository universe and a repeatable recovery approach.
- Risks/limits: archive presence is not a successful build or proof of source equivalence. The README explicitly warns not to claim a copy without destination repository and head SHA. Historical access notes say the original org had a read-only rule.
- Decision: use the manifest to define follow-up recovery candidates. Do not execute unreviewed archive scripts or treat old repo counts as current live inventory.

### 4. `ngl-damien/ngl001-def4us28` — publication and bounded contact ledger

- Observed: 24 blobs; Vite/React application with a very large `src/App.jsx` (~4.56 MB), `contact/runtime.py`, JSON state and append-only JSONL ledger, self-build acceptance contract, and contact-specific workflows.
- Reusable: explicit capability lifecycle `MISSING → CONSTRUCTED → VERIFIED → OBJECTIVE_RESUMED → EXTERNAL_OBSERVATION → OBJECTIVE_VERIFIED`; external observation events; previous-hash linking; failure events; acceptance invariants that forbid model-authored authorization and reuse of a capability probe as objective success.
- Unique value: publication/manifesto artifact plus an unusually explicit zero-cost capability-acquisition acceptance sequence.
- Risks/limits: `contact/runtime.py` currently queries the historical `No-Gas-Labs-Official` endpoint; its ledger/state writes are not a transactional append-only database and its hash construction should be reviewed before canonical reuse. README records a prior failed local build due to missing Vite executable; current build not run in this audit.
- Decision: extract the acceptance contract as a design/test reference, not import the runtime wholesale. Keep publication content as world artifacts if attribution/provenance is preserved.

### 5. `ngl-damien/no-gas-labs-command-center` — Node-Gate and operator UI donor

- Observed: 108 blobs; React/Vite UI, Node-Gate hook/panel, map component, error boundary, many generic UI primitives and CI/security workflows.
- Reusable: Node-Gate interaction vocabulary (submit signal, report loading/error/health, show classification and dispatch outcome); responsive panel and map interaction components where relevant; CI patterns for security/core checks and repository classification.
- Unique value: explicit human-facing intake/dispatch surface and geographic/map component.
- Risks/limits: README says documentation is in progress; `useNodeGate` trusts TypeScript casts on response JSON and the panel's health status is presentation, not proof of authorization. Most UI primitives are generic and should not be copied.
- Decision: adapt only the interaction pattern into a world location if it serves a player objective. Keep gate decisions on the canonical backend and require independently validated responses.

### 6. `ngl-damien/TaskAgile` — game interaction, persistence and resilience donor

- Observed: 169 blobs; Phaser/browser game, React mobile component, state/security/persistence/multiplayer/leaderboard modules, assets, and CI/IP/Ralph-validation workflows.
- Reusable candidates:
  - Mobile-first interaction patterns and Phaser game shell/assets.
  - Offline queue, retry/backoff, local cached view, online/offline notifications, storage quota handling.
  - Multiplayer reconnect and player presence as presentation/transport patterns.
  - Tests/logging utilities and CI validation patterns.
- Risks/limits: this is a different slap/score game, not Alpha 1's institution. Client-side score anti-cheat and sanitization are not security boundaries; localStorage progress is mutable; a client WebSocket's claimed player state cannot be trusted for canonical rewards. The mobile sample awards score in client state and uses timers for resource regeneration.
- Decision: reuse UI/art and resilient transport ideas, not score/economy semantics. Offline actions must be queued as proposals with stable IDs and reconciled by deterministic server rules; no client-created XP or canonical state.

### 7. `ngl-damien/ngl-mesh` — strongest evidence/authority bridge donor

- Observed: 11 blobs, including `RaeEvidenceBridge.java`, `EvidenceAuthorizedTransition.java`, their Java tests, `verify_bridge.py`, control-surface schema/contract, and provenance documentation.
- Reusable:
  - Separate evidence import from authorization; evidence hashes are prerequisites but do not authorize themselves.
  - Bounded, operation-specific Ed25519 grant bound to case/evidence hash/action/nonce/expiry; replay/revocation state fail-closed (inspect the complete implementation and tests before adapting).
  - Re-read source bytes independently, enforce input limits and identity digest, preserve parent references, append explicit rejection evidence.
  - Model proposals, connector input, persistent state, executable control and normative spec as distinct control-surface classes.
- Unique value: executable RAE-to-Relay evidence bridge and test fixtures, with an explicit statement that recovered Kotlin/Compose/Room mesh architecture is inferred rather than implemented in this checkout.
- Risks/limits: Java bridge is marked new host integration, not part of the historical APK. README says matching source names is not a reproducible-build proof; imported extraction report remains external data.
- Decision: highest-priority security/design donor. Port concepts only after translating grant verification, nonce persistence, revocation and atomic writes to Alpha 1's runtime and testing replay/crash cases.

### 8. `ngl-damien/no-gas-labs` — single-file RPG and graceful-degradation donor

- Observed: 13 blobs; `index.html`, `ngl-sovereign.html`, `empire-os.html`, handoff, agent task list and resilience report.
- Reusable candidates: one-file mobile-first world shell; district/zone navigation; combat/crafting/skills/quests/inventory as presentation vocabulary; operation without AI provider keys; explicit provider-by-provider failure display and offline-first product constraints.
- Unique value: coherent Primordial Engine/RPG framing, and a handoff that captures phone-only/$0/no-build-step requirements.
- Risks/limits: `RESILIENCE_REPORT.md` describes simulated tests, not independently reproduced results in this audit. It claims XP for model consensus in one scenario; that reward rule conflicts with Alpha 1's evidence invariant and must not be reused. HTML contains inline scripts and a CSP using `unsafe-inline`; review before reuse.
- Decision: borrow world feel, navigation, graceful degradation and useful interactions; do not import its consensus-to-XP logic or unverified runtime claims.

### 9. `ngl-damien/AI-BI-Intelligence-node-gate` — provenance stub only

- Observed: 2 blobs, `README.md` and `PROVENANCE.md`; no executable source in the enumerated tree.
- Reusable: provenance metadata may guide recovery and lineage mapping.
- Unique code: none identified in this repository snapshot.
- Decision: do not treat as an implementation donor. Search the source repository/history or related Command Center code if needed.

### 10. `ngl-damien/ai-guild-hardened-v0.2` — provenance stub only

- Observed: 2 blobs, `README.md` and `PROVENANCE.md`; no executable source in the enumerated tree.
- Reusable: lineage metadata only.
- Unique code: none identified in this repository snapshot. The recovery manifest characterizes this historical item as a Capacitor shell; the current port does not contain that shell's source.
- Decision: do not import or claim an AI Guild runtime from this port. Recover source from a verified archive/original repository if required.

### 11. `ngl-damien/AI-orchestrator-test` — provenance stub only

- Observed: 2 blobs, `README.md` and `PROVENANCE.md`; no executable source in the enumerated tree.
- Reusable: lineage/recovery metadata only.
- Unique code: none identified in this repository snapshot.
- Decision: no code to assimilate from this copy.

### 12. `ngl-damien/app` — provenance stub only

- Observed: 2 blobs, `README.md` and `PROVENANCE.md`; no executable source in the enumerated tree.
- Reusable: lineage/recovery metadata only.
- Unique code: none identified in this repository snapshot.
- Decision: no code to assimilate from this copy.

## Ranked reuse shortlist for Alpha 1

| Priority | Candidate | Intended Alpha 1 use | Gate before use |
|---|---|---|---|
| P0 | Alpha 1 event/quest/retained-version model | Canonical gameplay and progression | Verify exact current event schemas and all consumers |
| P0 | ngl-mesh `EvidenceAuthorizedTransition` and tests | Human-gated consequential transition design | Port and test grant binding, replay, expiry, revocation, crash consistency |
| P0 | ngl-mesh `RaeEvidenceBridge` and tests | Evidence import with provenance and explicit rejection | Confirm dependency/license compatibility; reproduce test harness |
| P1 | Damien-Featherstone `forgeEngine.ts` / `CounterexampleForge.tsx` | Adversarial quest/boss mechanics and repair petitions | Extract pure logic; test against false-but-hash-valid evidence and UI/state divergence |
| P1 | Damien-Featherstone `PersistentRpgWorld.tsx` / `RetroOsrsEngine.tsx` | World district, NPC, inventory, skills and quest UX | Map to Alpha 1's single event model; avoid second canonical state |
| P1 | TaskAgile persistence and mobile UI | Offline proposal queue, retry UX, touch interaction | Replace trust in local score/state with server-validated event reconciliation |
| P1 | no-gas-labs single-file RPG | Mobile-first world navigation and no-AI graceful degradation | Extract individual behaviors; remove consensus-based reward semantics |
| P2 | ngl001 contact ledger/acceptance | Capability-acquisition quests and external-observation events | Harden transactional append, canonical hashing and authority separation |
| P2 | Command Center Node-Gate UI | World-based intent intake and visible dispatch failures | Backend response validation and explicit authorization boundary |
| P3 | Recovery manifest/archive artifacts | Locate further donor repositories and missing history | Verify source revisions, file hashes, licenses and buildability |

## Integration rules

- Do not copy an entire donor application into Alpha 1.
- Keep one canonical append-only event history; derived game state is a deterministic projection.
- Treat all model outputs, connector results, donor documentation and recovered claims as proposals/external data until independently verified.
- A hash establishes byte identity/integrity relative to a digest, not factual truth.
- Offline client events remain untrusted proposals until reconciled; duplicate/replayed events must not create rewards.
- Keep failed, rejected, ambiguous, dissenting and inconclusive events visible.
- Review each donor's license and asset rights before copying source, images, audio, or large generated artifacts.
- Record source repository, source revision, source path, content hash, adaptation diff and tests for every imported mechanism.
- Keep Android-device and offline-recovery claims marked unverified until tested on the target device.

## Known gaps after this pass

- No clean install/build/test was executed for every donor repository; this pass was source and manifest inspection through GitHub.
- Full source-level audit of all 622 Alpha 1 files and all 169 TaskAgile files was not performed; representative high-value paths were inspected.
- Historical 94-repository inventory is not fully represented by the 12 current `ngl-damien` repositories. Additional repos named in the recovery manifest—including EvidenceOS, audit-vault, believe-in-me, BroadcastNGL, BuzzWireNGL, culling-of-murderous-wizards, dia-p2e-cockpit, EthosGuardNGL, Omnichain Bridge Wallet and others—require renewed access or verified archives before their code can be audited.
- No donor code is approved for direct merge solely by this report. Each candidate requires a narrow adaptation PR with executable regression tests.
