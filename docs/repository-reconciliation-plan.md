# Alpha One Repository Reconciliation Plan
Date: 2026-10-25
Status: audit plan; no source application has been merged by this document.

## Objective

Make No-Gas-Labs-Alpha-1 the canonical integrated, runnable institution while preserving source repositories, provenance, and recoverability. Reconcile by capability and verified file-level differences, not by blindly copying whole repositories.

## Current inventory observed

The connected GitHub account listed 12 repositories under ngl-damien. The following classifications are based on repository trees and recovery documentation inspected during this audit; they are not claims that every application builds or runs.

| Repository | Observed tree / role | Proposed disposition |
|---|---|---|
| No-Gas-Labs-Alpha-1 | 501 tree entries; game, institution, authority/evidence, forge/mesh, quests/world, tests, research and recovery snapshots | Canonical integration target |
| Damien-Featherstone | 83 tree entries; React/Vite app, Express server, RPG/world and ledger-related state | Highest-priority capability source; security review before import |
| ngl001-def4us28 | 30 tree entries; React/Vite comic/observation experience | Compare source with recovery snapshot; port reviewed deltas |
| no-gas-labs-command-center | 124 tree entries; frontend, server/API routes and capability health | Adapt useful operational views to Alpha One interfaces |
| TaskAgile | 202 tree entries; client/server, RPG/game assets and workflows | Reconcile missing assets/mechanics; port selectively |
| ngl-mesh | 16 tree entries; Java evidence bridge and tests, control-surface schema | Integrate through a bounded adapter after contract review |
| no-gas-labs | Small static-browser application and documentation | Reuse selected interface concepts or keep as a lightweight front door |
| ngl-recovery-2026-10-25 | Manifests, transport notes, staged source and archives | Preserve as recovery vault; extract reviewed material |
| AI-BI-Intelligence-node-gate | README and provenance only in observed tree | Placeholder; recover authoritative source |
| ai-guild-hardened-v0.2 | README and provenance only in observed tree | Placeholder; recover authoritative source |
| AI-orchestrator-test | README and provenance only in observed tree | Placeholder; recover authoritative source |
| app | README and provenance only in observed tree | Placeholder; recover authoritative source |

## Existing snapshot comparison

Path/blob comparisons were made between current source trees and Alpha One's corresponding `recovery/public-repos/` snapshots:

- `ngl001-def4us28`: 29 of 30 source paths had corresponding paths; 23 exact blob matches.
- `no-gas-labs-command-center`: 119 of 124 source paths had corresponding paths; 117 exact blob matches.
- `TaskAgile`: 79 of 202 source paths had corresponding paths; 74 exact blob matches.

These are path/blob comparisons only. They do not establish runtime correctness, semantic equivalence, licensing, or whether the source version is preferable. Each difference needs a classified disposition before promotion.

## Integration principles

1. Keep Alpha One's existing mainline and runtime as the target; work on a dedicated branch and reviewable PRs.
2. Treat `recovery/public-repos/` as preserved snapshots, not live runtime modules. Never overwrite snapshots with selectively ported code.
3. Use a source-to-target ledger recording source repository, source commit SHA, source path/blob SHA, target path/blob SHA, difference class, license/attribution, tests/build evidence, decision, and reviewer.
4. Prefer capability-level adapters over wholesale framework merges. Define one owner for world state, institutional ledger, identity/authority, artifact execution, and quest progression.
5. Imported code must not independently grant authority, XP, rewards, or institutional state changes. Such consequences must pass through Alpha One's canonical validated event/authority path.
6. Preserve original repositories and Git history. Do not delete, archive, or rewrite source repositories as part of integration.
7. Do not claim a source is recovered, tested, deployed, or integrated without direct evidence.

## Security gate — Damien-Featherstone and recovery archives

An inspected `.data/institutional_keypair.json` file contains a `privateKeyPem` field. Treat this as potentially exposed. Before importing related code or data:

- Rotate/revoke the corresponding key and audit where it is trusted.
- Review repository history and copies for the key; removing the latest file alone does not remove historical exposure.
- Review world/receipt/mesh state files for sensitive or mutable operational data.
- Keep credentials, private keys, wallet material, and sensitive user data out of Alpha One source history.
- The recovery notes flag `wallet_keys.json` as sensitive in the original Omnichain source; do not copy it into Alpha One. Recover only code/assets after a secrets and license review.

This plan records the issue; it does not itself rotate or revoke any key.

## Phased reconciliation

### Phase 0 — Protect and freeze provenance
- Preserve source SHAs and recovery manifest as read-only evidence.
- Address key exposure and classify sensitive state before integration.
- Confirm the current Alpha One base commit and working tree before every batch.

### Phase 1 — Generate a complete reconciliation ledger
- Enumerate every source tree and Alpha One snapshot recursively.
- Compare paths and Git blob SHAs; classify identical, missing, modified, renamed, generated/vendor, sensitive, or intentionally excluded files.
- Identify license/attribution and runtime/dependency constraints.
- Include all 12 repositories and the recorded original-organization inventory where source access is available. Do not equate the 94-entry historical manifest with 94 successfully recovered projects.

### Phase 2 — Define integration contracts
- World and quest state: Alpha One is canonical.
- Evidence/receipt ingestion: adapters submit observations with provenance; assertions alone do not become observations.
- Authority: only validated, explicit grants/decisions can authorize consequential operations.
- Mesh/model orchestration: providers and adapters cannot bypass the same event and authorization boundaries.
- UI/Command Center: consume canonical APIs/state rather than maintaining competing authority or world state.

### Phase 3 — Integrate by value and dependency order
1. Damien-Featherstone: inspect and port isolated world/RPG, receipt, and UI capabilities only after security review.
2. Command Center: map operational health/API functions to Alpha One contracts.
3. TaskAgile: reconcile game mechanics, localization, assets, and workflows; port only non-duplicative, compatible components.
4. NGL-001: resolve remaining comic/observation differences and integrate publication experience.
5. NGL Mesh: review Java contract and tests, then add an adapter only where it adds capability beyond Alpha One's existing evidence path.
6. Static no-gas-labs client: selectively reuse interface assets/components or retain as an independent public entry point.
7. Recovery vessel and placeholders: recover missing original sources, validate provenance, and classify each before any port.

### Phase 4 — Verify integrated behavior
- Run existing tests and builds from a clean checkout; record exact commands, commit SHA, and results.
- Add integration checks for quest/event provenance, receipt validation, authority rejection paths, adapter failures, and state consistency.
- Confirm the primary user journey end-to-end: initiate work, produce an artifact, inspect evidence, adjudicate, and apply only warranted world consequences.
- Record deployment separately from local test results.

## Definition of done

- Every inventoried source has a documented status: preserved, exact snapshot, delta queued, integrated, intentionally excluded, inaccessible, or unrecovered.
- Every imported file has provenance, attribution/license review, and a stated reason for inclusion.
- No known secrets or private keys are introduced into Alpha One.
- One documented canonical owner exists for world state, ledger, authority, artifact execution, and quest progression.
- CI/build/test evidence is tied to an exact commit.
- The game demonstrates a real, inspectable work-to-evidence-to-consequence loop.
- Historical repositories and recovery snapshots remain intact.

## Not done by this document

No application source was merged; no tests were run; no key was rotated; no deployment was performed; and no missing source was assumed recovered. This is the proposed control document for subsequent, reviewable implementation work.
