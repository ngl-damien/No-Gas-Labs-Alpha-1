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

The current Alpha One tree contains `recovery/public-repos/` snapshots. Initial tree/blob comparison found:
- `ngl001-def4us28`: 29 of 30 source paths correspond; 23 blobs match exactly.
- `no-gas-labs-command-center`: 119 paths correspond; 117 blobs match exactly out of 124 source paths.
- `TaskAgile`: 79 paths correspond; 74 blobs match exactly out of 202 source paths.

These are path/blob comparisons, not runtime tests. Every non-matching path must be classified as added, deleted, renamed, modified, or intentionally excluded. Do not overwrite active Alpha One files with snapshots without review.

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

## Current state

This document establishes the integration contract and work queue. It does **not** claim the repositories, all 94 historical sources, or all files have already been assimilated. Each completed import must add concrete file/commit/test evidence to the ledger.
