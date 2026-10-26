# Alpha One Assimilation Plan

**Status:** active reconciliation work; not a declaration that all source code has already been imported.
**Canonical target:** `ngl-damien/No-Gas-Labs-Alpha-1`
**Policy:** every relevant source project must be accounted for and assimilated into Alpha One's usable institutional experience. Assimilation does not mean indiscriminately overwriting files, flattening distinct applications, or treating unverified claims as working capabilities.

## Definition of done

Every source repository and recovered artifact has a recorded disposition:
1. **Integrated** — capability or asset is wired into Alpha One, with source provenance and verification evidence.
2. **Retained as a module** — kept in Alpha One as a separable package, route, game exhibit, adapter, or subsystem with a documented interface.
3. **Preserved as source/archive** — relevant history, files, assets, license and provenance retained inside Alpha One, but not yet safe or useful to execute.
4. **Blocked for recovery/security/license** — gap named, evidence and next action recorded. A blocker is not silently counted as complete.

No repository is considered assimilated merely because its name, README, manifest entry, or empty placeholder exists.

## Repository-by-repository disposition

| Source | Observed scope/status | Assimilation target |
|---|---|---|
| `Damien-Featherstone` | React/Vite app, Express/WebSocket server, persistent RPG, creator/witness auth, forge, science workbench, counterexample forge, image studio, comic experience, receipt topology, world/mesh/receipt JSON state | Highest-priority capability source. Map components to Alpha One's existing world, forge, authority, evidence, and UI; avoid a competing second world-state authority. Review signing-key and data files before importing. |
| `ngl001-def4us28` | React/Vite NGL-001 interface, comic/contact state, workflows | Reconcile with `recovery/public-repos/ngl001-def4us28/`; import missing or superior files and expose the experience from Alpha One. |
| `no-gas-labs-command-center` | Command-center frontend, server/API routes, health/capability integration, workflows | Map operational views to Alpha One APIs and its single authority boundary; retain distinct UI if useful. |
| `TaskAgile` | Game clients, server, localization, Phaser/browser game variants, assets, workflows, Shrine and No-Gas-Slaps material | Reconcile against the partial snapshot; import missing relevant source/assets; keep variants as named modules/exhibits rather than allowing competing entry points to overwrite the canonical game. |
| `ngl-mesh` | Java mesh/relay bridge, evidence and control-surface schemas, tests | Add as an explicit adapter/module; define request/response, provenance and failure semantics; no implicit authority escalation. |
| `no-gas-labs` | Static/browser interfaces and project documentation | Retain useful public launch, publication, or exhibit interfaces within the Alpha One experience; do not confuse a browser UI with backend orchestration. |
| `ngl-recovery-2026-10-25` | 94-repository inventory, transport docs/scripts, partial Omnichain and cockpit files and archives | Assimilate all non-sensitive relevant source, assets, manifests and provenance. Preserve original archives. Reconcile all 94 source identities; keep unrecovered status explicit. |
| `AI-BI-Intelligence-node-gate` | Current destination has README and provenance only | Recover original source and history, then integrate Node-Gate capability behind Alpha One authority/evidence interfaces. |
| `ai-guild-hardened-v0.2` | Current destination has README and provenance only | Recover full source, then integrate Guild/council functions and tests. |
| `AI-orchestrator-test` | Current destination has README and provenance only | Recover source and tests; use it to inform orchestration and disagreement workflows. |
| `app` | Current destination has README and provenance only | Identify original project/source and recover before assigning a runtime role. |
| `No-Gas-Labs-Alpha-1` | Current canonical target: playable world, quests, institutional kernel/ledger/decisions, evidence/content addressing, forge, mesh, authority, location, experiments and recovery snapshots | Remains the canonical integration target and the source of truth for integrated behavior. |
| Original `No-Gas-Labs-Official` organization inventory | Recovery README reports 94 repositories; inventory includes archived snapshots and many private projects not represented by the 12 current-account repositories | Continue recovery against the manifest. Preserve every source identity, visibility, archive status, default branch, source URL and commit where available. Do not claim the 94 are all restored. |

## Existing snapshot reconciliation

The following counts were refreshed by comparing Git tree blob SHAs from the current source `main` branches with the corresponding files in Alpha One's `recovery/public-repos/` snapshots. These are source-to-snapshot identity checks, not build or runtime tests.

| Source | Source blobs | Snapshot files | Exact source blobs present | Source files absent from snapshot | Same-path blobs differing | Notable findings |
|---|---:|---:|---:|---:|---:|---|
| `no-gas-labs` | 13 | 14 | 13 | 0 | 0 | All 13 source blobs match exactly; snapshot has one extra `RECOVERY.md`. |
| `ngl001-def4us28` | 24 | 23 | 20 | 1 | 3 | `src/App.jsx` is 4,563,284 bytes at source and 0 bytes in snapshot; `src/assets/hero.png` is absent. `contact/ledger.jsonl` and `contact/state.json` also differ. |
| `no-gas-labs-command-center` | 108 | 104 | 104 | 4 | 0 | Missing `client/public/images/ai-avatar.jpg`, `capabilities-grid.jpg`, `hero-bg.jpg`, and `security-shield.jpg`. |
| `TaskAgile` | 169 | 66 | 66 | 103 | 0 | Snapshot is a strict partial copy; absent paths include UI components, geometry, sound, and texture assets. |

Earlier draft text contained inconsistent TaskAgile and Command Center path counts; the table above supersedes those counts. Tree-entry totals may include directories and must not be compared directly with blob/file totals.

Next reconciliation rule: classify every absent or differing path as required import, intentionally excluded, duplicate/obsolete, sensitive, license-blocked, or superseded. Do not overwrite active Alpha One files without review.

## Completed assimilation tranches (2026-10-25)

- **PR #31 merged** — established the evidence-bound assimilation contract and imported all 11 text files from `ngl-mesh` under `integrations/ngl-mesh-reference/`. This remains source-only; Relay dependencies and runtime integration are unresolved.
- **PR #32 merged** — preserved seven cockpit reference files under `integrations/recovery-vault/cockpit-reference/`. The application is incomplete, license is unconfirmed, and client-side XP is not canonical Alpha One state.
- **PR #34 merged** — corrected source-to-snapshot counts and recorded exact current Git blob comparisons.
- **PR #35 merged** — imported 15 selected TaskAgile source files under `integrations/taskagile-reference/`, including the No_Gas_Slaps entry point/modules and standalone RPG/Shrine HTML. Source hashes are recorded; no runtime integration or build/security test is claimed.
- **PR #33 merged** — added `docs/repository-reconciliation-plan.md` and `docs/repository-reconciliation-ledger.csv`; this is the working file-level reconciliation baseline, not proof of integration.
- **PR #37 merged** — preserved eight additional TaskAgile server/configuration files under `integrations/taskagile-reference/recovered-source/` and recorded their original source blob SHAs. Both Alpha One CI workflows passed on the PR head. The tranche is source-only: no build/test of the imported app, no runtime wiring, and no security approval. Its README records the observed WebSocket, host-binding, and Vite-host risks.
- **PR #40 merged** — consolidated Experiment 001 versioned strategy identities, legacy ledger replay compatibility, cross-process contention tests, and the offline review-bound Founder signer. Exact-head `verify` and `Genesis Evidence Invariant` workflows passed. This is still a prototype: no real Founder key, production observation trust root, or automatic stale-lock recovery is configured.
- **PR #43 merged** — integrated canonical work receipts into TownSquare: the UI renders retained claim/authorize/execute/observe/adjudicate history and exact artifact digests while explicitly disclaiming truth, human review, demand, revenue, and deployment proof. Exact-head CI passed; no live browser/device or deployed-service test is claimed.
- **PR #44 merged** — added a read-only, activity-derived character sheet to the TownSquare game. It projects game XP/level, attributed activity, inventory and recent events; it does not award XP or claim real-world competence. Exact-head CI passed; no physical-device test is claimed.
- **PR #45 merged** — preserved the NGL-424 RELEASETRACE reproducibility correction as a provenance document. The reported metrics remain prior local observations from the supplied package, not fresh Alpha One CI evidence or commercial validation.
- **PR #41 merged** — reconciled TaskAgile reference-copy destinations into the file-level ledger; copied files are explicitly distinguished from missing files and from runtime integration.
- **Still outstanding:** about 80 TaskAgile paths from the original snapshot gap remain to be recovered or dispositioned; four Command Center image assets are missing; three NGL-001 files differ and one asset is missing. The 4.56 MB NGL-001 `src/App.jsx` remains an empty target placeholder. The 94-repository historical inventory is not fully recovered. PRs #25, #28, #29, #27, #30 and #21 were closed as superseded by the consolidated/current-base work, not merged individually.

These merges establish preserved source and selected verified Alpha One features, not completion of the overall assimilation. The current connected-account inventory is 12 repositories; four private repositories currently contain only README/provenance placeholder files in their observed main trees, so their original application source remains unrecovered. Sensitive wallet archives and committed private-key material remain excluded pending security handling.

## Architecture and integration boundaries

- **World/gameplay:** one canonical player/session/world model and progression path; imported RPG experiences become modules or exhibits.
- **Forge/artifacts:** one canonical artifact lifecycle from request → proposal → revision → validation → approval → execution → observed result.
- **Evidence/archive:** preserve source repository, source commit, path, blob digest, license, import commit, transformations, test evidence and current disposition.
- **Authority/decisions:** no imported module may silently grant Founder authority, sign on behalf of the Founder, award XP, spend funds, publish externally, or alter protected state.
- **Hybrid cognition/mesh:** providers and model-specific systems are adapters; distinguish real provider responses from templates, deterministic fallbacks and human-relayed material.
- **Command center/observability:** status comes from observed API, runtime and workflow state, not hard-coded success labels.
- **Publication/exhibits:** useful interfaces and narrative assets remain reachable from the Alpha One world without creating competing canonical apps.
- **Mobile path:** preserve responsive web access now; Android-native packaging remains a separately verified deliverable, not an assumption.

## Mandatory security and provenance controls

1. `Damien-Featherstone/.data/institutional_keypair.json` contains a private-key field in the committed file. Treat the key as potentially compromised. Do not copy it into Alpha One; rotate/revoke it wherever trusted, and review history and replicas.
2. The recovery materials flag `wallet_keys.json` in Omnichain Bridge Wallet as sensitive. Keep it out of public trees and inspect archive contents before extraction.
3. Review `.data/world_state.json`, `.data/receipt_ledger.jsonl`, `.data/mesh_state.json`, environment files, tokens, private data, wallet material, and user-generated data before import.
4. Preserve licensing and attribution for each source. If license/ownership is unknown, preserve the source and mark the integration blocked until resolved.
5. A SHA digest proves byte identity, not truth, safety, runtime success, authorship or authorization.
6. No source project is declared working without actual build/test/runtime evidence. Report failures and missing evidence explicitly.

## Execution sequence

1. Secure and classify secret-bearing source material.
2. Produce a machine-readable source-to-target file reconciliation ledger with path, source commit/blob SHA, target path/blob SHA, classification, license, risk, decision, import commit and verification evidence.
3. Reconcile existing snapshots path by path.
4. Recover missing private repositories and remaining source artifacts from the original organization when access allows.
5. Integrate high-value capabilities behind the existing Alpha One interfaces; preserve each project's useful distinct identity and history.
6. Run project-specific checks, then Alpha One regression/build/runtime checks; fix integration failures rather than merely reporting them.
7. Publish a final status ledger with no silent omissions and no unsupported completion claims.

## Current state (2026-10-26)

Alpha One now has a source-reconciliation ledger, explicit TaskAgile source provenance, a documented key-exposure blocker, an offline review-bound signing helper, canonical work receipts in TownSquare, a read-only activity-derived character sheet, and an NGL-424 reproducibility record. These are distinct states: source-only imports remain non-runnable references; TownSquare displays recorded receipts but does not independently establish their truth; the Founder signer proves key possession, not human identity or consent.

PR #26 (independent observation verification) remains draft and must not be merged into the production mutation path until a host-controlled observation verifier and adjudication trust source are provisioned. Test allowlists are not production trust roots. The private-key exposure in `Damien-Featherstone` remains unresolved; no key rotation/revocation has been performed by these Alpha One changes. The four private placeholder repositories remain unrecovered at source level. No deployment, public release, revenue, or Android-native build is established by this work.

This document does **not** claim all repositories, all 94 historical sources, or all files have been assimilated. Each completed import must add concrete file/commit/test evidence to the ledger.
