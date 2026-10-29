# Account-Wide GitHub Portfolio Audit — 2026-10-29

**Status:** Phase 1 completed; source-level audit and reconciliation remain in progress.  
**Canonical target:** `ngl-damien/No-Gas-Labs-Alpha-1`  
**Baseline observed:** Alpha 1 `main` at `5ff8b276078f0644e4ef748f43ba3685de5c0070`.  
**Evidence method:** GitHub repository metadata, non-truncated recursive default-branch trees, selected README/manifests/source files, open pull-request metadata, compare-commits results, and exact-head CI check runs. This is not a claim that every line in every repository has been manually reviewed or that all applications build.

## Executive findings

1. The connected account currently returns **32 repositories**, not the 12 recorded in the older reconciliation plan. Their observed default-branch trees contain **1,239 tracked files** in total. All 32 recursive trees returned without truncation; source content has been sampled selectively, not line-by-line audited.
2. Alpha 1 is the canonical integration target and has **622 tracked files** in its default-branch tree. Its current `main` has successful recent `verify`, `world-projection`, and `playable-world` checks. That is evidence for those workflows only, not a complete device/product validation.
3. Alpha 1 had **409 branches** at the initial inventory (four full pages of 100 plus nine on page five) and **20 open pull requests**. Creating this audit branch brings the current branch count to **410**. This is the largest coordination risk: overlapping and stacked changes need a controlled merge sequence, not indiscriminate branch cleanup.
4. The playable-world chain is `#160 → #163 → #165`. PR #165 is five commits beyond #163 and changes only `game/model.mjs`, `game/server.mjs`, and their tests. PR #163 is based on #160 and changes 18 files. GitHub compare reports 75 commits between #160 and #163, so inspect its full diff/history before merging; green checks alone do not resolve scope or branch-history risk.
5. PR #162 is a separate Moonshot Evidence Archive draft that is **diverged from #160** (20 commits ahead, 2 behind) and overlaps #163's client/quest/research/server/browser-test files. Do not merge #162 separately if #163 is the intended combined delivery; reconcile its unique commits against #163 first.
6. A tracked private signing-key field is confirmed in the private `Damien-Featherstone` repository at `.data/institutional_keypair.json`; `server.ts` loads that file and uses the private key to sign receipts. The key is not reproduced in this report. Existing PR #1 and issue #2 correctly identify coordinated rotation/runtime migration as required. **Do not merge the field deletion alone or treat key rotation/history cleanup as complete.**
7. The existing reconciliation documentation is stale about account scope: `docs/repository-reconciliation-plan.md` says 12 repositories. Update it after the current inventory and historical 94-repository recovery manifest have been reconciled; these are different scopes and must not be conflated.
8. Some repositories previously described as README/provenance-only now have substantive source files. In particular, `AI-BI-Intelligence-node-gate` has 16 tracked files including router modules; `app` has an 8-file frontend/backend skeleton; `SonicForgeNGL`, `VoxScriptNGL`, `VeritasShieldNGL`, and `PulseMonitorNGL` contain small Python agent sources. Repository disposition must be based on current trees, not older notes.

## Current accessible repository inventory

Counts are tracked file blobs from the observed default-branch recursive tree, not lines of reviewed code. “Disposition” is a triage recommendation, not a declaration of build success.

| Repository | Files | Observed scope / next action |
|---|---:|---|
| `No-Gas-Labs-Alpha-1` | 622 | Canonical world, institutional state, evidence, quests, Forge, recovery snapshots and tests. Keep as sole integration target. |
| `Damien-Featherstone` | 77 | Large React/Vite + Express/WebSocket application and tracked data/key material. High reuse potential; security/key handling first. |
| `ngl-recovery-2026-10-25` | 85 | Recovery manifests, transport notes, staged source and archives. Reconcile against its historical 94-repository manifest. |
| `ngl001-def4us28` | 24 | React/Vite UI and contact ledger/runtime. Snapshot history says large App.jsx and evidence-bearing state need careful byte/provenance handling. |
| `no-gas-labs-command-center` | 108 | React/Express Node-Gate and EvidenceOS views. Check route access, configuration, build, and overlap with Alpha 1. |
| `TaskAgile` | 169 | React/TypeScript web app, legacy browser game, Phaser, assets and offline queue. Selectively extract mechanics; do not wholesale merge a second app. |
| `ngl-mesh` | 11 | Java bridge/control-surface schema and tests, but no build manifest in the current tree. Integration/build remains unverified. |
| `no-gas-labs` | 13 | Static/browser front door and documentation. Reuse selectively as an exhibit/interface. |
| `AI-BI-Intelligence-node-gate` | 16 | Node/Express intelligence and guild routing. Recover/inspect actual current code; older “placeholder-only” notes are stale. |
| `ai-guild-hardened-v0.2` | 4 | Manifest, package and provenance; no meaningful runtime source observed. Recover original source or retain as a documented stub. |
| `AI-orchestrator-test` | 4 | Documentation/provenance only in current tree. Recover source before assigning a runtime role. |
| `app` | 8 | React game UI and FastAPI/MongoDB backend skeleton. Needs dependency/configuration review and a fresh build/run check. |
| `Omnichain_Bridge_wallet` | 11 | Wallet/shrine UI plus Express endpoint. The `/wallet-init` route invokes a local process and logging endpoints accept writes without visible route-level authentication; threat-model and access-control review before any exposure. |
| `dia-p2e-cockpit` | 20 | React P2E cockpit candidate. Inspect real gameplay and state authority before reusing. |
| `evidenceos` | 14 | Node two-pass repository-analysis pipeline and HTTP API. Strong candidate for an audit adapter, but no tests were present in the observed tree and runtime behavior is not verified. |
| `omnichain-faucet-townsquare` | 6 | Small static TownSquare/faucet prototype. Preserve as an exhibit until its chain and security assumptions are tested. |
| `No_Gas_Labs-Omnichain_TownSquare` | 2 | README/provenance shell. Recover original source or keep explicitly blocked. |
| `no-gas-labs-monorepo` | 4 | README/provenance, backend package manifest and todo only. No integrated monorepo established. |
| `multi-chain-flash-loan-dapp` | 5 | Project-status/manifest/todo-level DeFi prototype. Isolate; no production or security claims. |
| `audit-vault` | 3 | README/provenance/security notes; no application source. |
| `believe-in-me` | 3 | README/provenance/security notes; no application source. |
| `SonicForgeNGL` | 5 | Small Python agent source and config. Inspect dependencies, inputs, and actual execution before integration. |
| `ngl-probe-cooldown-20261029` | 1 | README-only experiment. Preserve as a record, not an application. |
| `PulseMonitorNGL` | 4 | Small Python agent source/config. Validate scope and behavior before reuse. |
| `no-gas-slaps` | 2 | README/provenance shell; compare with TaskAgile and recovered snapshots. |
| `VoxScriptNGL` | 4 | Small Python agent source/config. Validate dependencies and output boundaries. |
| `VeritasShieldNGL` | 4 | Small Python agent source/config. Validate whether it implements verification or only describes it. |
| `no_gas_labs_sui_flashloan` | 2 | README/provenance shell. Keep isolated until source and security assumptions are recovered. |
| `no-gas-labs-system-integration` | 2 | README/provenance shell. Recover or document as an empty destination. |
| `Vibe-_Coding_Protocol` | 2 | README/provenance shell. Keep as concept documentation until implementation exists. |
| `nogas-matrix-2026` | 2 | README/provenance shell. No runtime implementation observed. |
| `nextjs-ai-chatbot` | 2 | README/provenance shell. Recover original source before treating it as an application. |

## Alpha 1 pull-request disposition

### Gameplay dependency chain

- **#160** — Guild Hall adversary + evidence-linked quest. Two commits ahead of main; four files changed. Its inspected head passed the available `verify`, `world-projection`, and `playable-world` workflows.
- **#163** — stacked integration of Guild Hall and Evidence Archive. Eighteen files changed. Its inspected head passed the same workflow types, but GitHub compare reports 75 commits between #160 and #163; inspect history and unique changes before any merge.
- **#165** — five commits beyond #163; four files changed (model/server plus tests). Its inspected head passed the available workflow types. Keep stacked on #163; do not merge independently.

**Recommended sequence:** review #160's exact diff and tests; reconcile #162's unique work into #163 (do not merge the diverged #162 independently); review #163's full commit history and scope; then review #165 against #163. Keep all three as drafts until the intended sequence and exact-head checks are revalidated.

### Other open PR families

- **#156 courier lock publication, #159 service/ledger/decision locks, #161 experiment lock publication:** related atomic-publication changes across distinct stores. Review together for consistency and platform assumptions. They intentionally fail closed when hard-link publication is unavailable. The lock-release check-then-unlink race and stale-lock recovery remain explicit limitations; tests passing do not eliminate those races.
- **#164 Founder decision verification:** focused changes to `src/authority/decision.js` and its tests; the inspected head passed the available workflow types. The PR description correctly leaves real key custody and canonical integration as separate blockers.
- **#157 and #158:** separate quest and adversarial NPC drafts overlap the same client/quest area now represented in the combined #163 chain. Reconcile unique work; do not merge both blindly.
- **#57 and #49:** TaskAgile source-recovery tranches. PR #57 is 74 commits ahead and 141 behind current main, with 80 files and about 20,285 changed lines in the compare result; this is far too large/stale to merge without a fresh, narrow reconciliation. PR #49 is 3 ahead / 147 behind. Preserve useful source-only recovery, but split and rebase only reviewed unique files after checking provenance and licensing.
- **#48:** earlier assimilation checkpoint; compare with this account-wide inventory and update rather than maintain conflicting inventories.
- **#26, #58, #60, #63, #66, #73, #74, #76:** all are diverged from current main in fresh comparisons: #26 (15 ahead / 163 behind), #58 (6 / 140), #60 (18 / 140), #63 (8 / 138), #66 (60 / 138), #73 (31 / 133), #74 (27 / 135), and #76 (6 / 120). PRs #73 and #66 are not drafts. Do not merge any of these directly from historic checkpoint descriptions; transplant/rebase the unique behavior onto current main and rerun exact-head verification.
- Current main's latest observed `verify`, `world-projection`, and `playable-world` checks were successful. Exact-head checks are required again after any rebasing or new commits.

## Critical security finding: tracked institutional signing key

Repository: `ngl-damien/Damien-Featherstone` (private)  
Tracked path: `.data/institutional_keypair.json`  
Runtime consumer: `server.ts` (key loading and receipt signing)  
Existing remediation: [PR #1](https://github.com/ngl-damien/Damien-Featherstone/pull/1) and [issue #2](https://github.com/ngl-damien/Damien-Featherstone/issues/2).

The current tracked JSON includes a private-key field. Because it is tracked in Git, removing the field from the current version would not erase it from history. The existing PR explicitly warns that removing the field alone can break runtime signing and does not rotate/revoke the key.

Required coordinated remediation:
1. Identify runtime/deployment stores using the tracked key and establish its trust scope.
2. Securely provision a replacement key outside Git and update runtime loading/signing.
3. Rotate the public-key trust configuration for new receipts while retaining old public-key verification metadata for historical receipts.
4. Preserve original ledger bytes; label old signatures' trust status rather than silently rewriting or re-signing history.
5. Test new signing, historical verification, restart behavior and failure handling.
6. Remove the private-key field from current tracked content and assess Git-history cleanup with a preserved backup.

No key was rotated, no history was rewritten, and no private-key material is included in this report. Treat the key as potentially exposed; do not publish or reuse it.

## Reconciliation corrections required

- Replace the old “12 repositories” scope in `docs/repository-reconciliation-plan.md` with a dated inventory of the current 32 repositories, while retaining the historical 94-repository recovery manifest as a separate source scope.
- Refresh source/snapshot comparisons from current tree/blob SHAs. Existing snapshots and prior counts are evidence of past recovery states, not proof of current equality.
- For each file-level gap, record one disposition: required import, intentionally excluded, duplicate/obsolete, sensitive, license-blocked, superseded, or unrecovered.
- Preserve provenance and source archives. A copied source file is not a runnable integration.
- Record build/test evidence against exact commits. No application is declared runnable from a README, package manifest, screenshot, or green Alpha 1 test alone.

## Work remaining (explicitly not complete)

- [ ] Inspect every file in the 32 current repositories or document a reasoned exclusion; this report is portfolio triage plus selective source review, not a full line-by-line audit.
- [ ] Reconcile all 409 Alpha 1 branches into active, dependency, superseded, merged-equivalent, and recovery/evidence categories before any bulk deletion.
- [ ] Compare every open PR's exact diff and current base/head; record unique commits and overlaps.
- [ ] Resolve key rotation/runtime migration and history exposure.
- [ ] Freshly build and run candidate applications where dependencies/environment permit; capture failures as evidence.
- [ ] Complete license/IP and secrets review before copying donor code/assets.
- [ ] Integrate only selected capabilities into the canonical game, then test the actual player journey and Android constraints.
- [ ] Update the reconciliation ledger and close the audit only when every repository/file family has a recorded disposition.

## Audit safety rule

No branch was deleted, no PR was merged, no repository was archived, no key was rotated, and no public deployment was performed during this audit. These are deliberately withheld until the evidence, dependencies, and recovery path are established.


## Additional source and package-entrypoint audit

A static comparison of declared package commands against the current tracked file trees found these concrete blockers. These are tree/source observations; no fresh dependency install or build was performed.

- **AI-BI Node-Gate is incomplete as currently committed.** Its `package.json` declares `node index.js`, `node --watch index.js`, and `node --test tests/`, but the current 16-file tree contains neither root `index.js` nor a `tests/` directory. `CORE_INVENTORY.md` lists a much larger “Official” inventory (including a 19 KB index and multiple core/test files) that is not present in this destination tree. Treat it as partial recovery, not a runnable service; recover the exact missing blobs from the stated source commit and compare hashes before any integration.
- **The monorepo is not runnable from its current tree.** `src/backend/package.json` declares `node server.js`, but the four-file repository contains no `src/backend/server.js`. The README/todo/package shell is not an integrated monorepo.
- **Omnichain_Bridge_wallet is a partial recovery vessel.** Its README describes a 41-file source project; the current tree has 11 files. The inspected Express server exposes `POST /wallet-init` (invoking a fixed local Node command via `child_process.exec`) and append-only XP/ping log routes without visible route-level authentication or rate limiting. This is a review blocker before hosting, not evidence that the server is deployed or that arbitrary command injection is possible. Recover missing files and add an explicit threat model, auth, input bounds, rate limits, and safer process invocation before exposure.
- **Several “agent” repositories contain deterministic placeholders rather than real analysis.** `SonicForgeNGL/main.py` explicitly prints that it is a recovery vessel and says the full source is elsewhere. The inspected `VoxScriptNGL/main.py` returns a topic/episode template with fixed satire/compliance scores; `VeritasShieldNGL/main.py` returns a hard-coded “fact_check: passed” and 0.95 accuracy; `PulseMonitorNGL/main.py` returns hard-coded positive sentiment/confidence. These must be labeled as stubs/fixtures, not marketed or integrated as scriptwriting, fact-checking, or sentiment-analysis capability.
- **EvidenceOS is a plausible utility but not verified.** It has a real two-pass pipeline and HTTP server source, but its current 14-file tree has no test files even though the package declares a test command. Fresh runtime and API-boundary checks are still required.
- **Alpha 1's embedded TaskAgile package manifest is not a runnable full copy.** The manifest under `integrations/taskagile-reference/package.json` points to `server/index.ts`, which is absent from that reference snapshot. This is consistent with the intended source-only preservation; do not run or describe that snapshot as a working app.
- **Current NGL-001 and TaskAgile packages have declared entry files in their source trees, but no fresh build was run during this audit.** Entry-file presence is a prerequisite, not proof of a successful build or correct behavior.

These findings increase the recovery priority for AI-BI, Omnichain_Bridge_wallet, and the small agent repositories. Recover missing source from the stated official blob/commit, verify exact hashes and license, and test in isolation before importing anything into Alpha 1.


## Branch-sprawl classification snapshot

A fresh enumeration after creating this audit branch returned **410 unique branches**. Prefix counts show the scale and shape of the backlog:

| Branch family | Count |
|---|---:|
| `experiment/` | 134 |
| `fix/` | 50 |
| `stutter-step/` | 44 |
| `security/` | 25 |
| `integration/` | 15 |
| `game/` | 12 |
| `feat/` | 10 |
| `recovery/` | 6 |
| `audit/` | 5 |
| `codex/` | 5 |
| `gameplay/` | 5 |
| `test/` | 5 |

These labels are only a first-pass grouping by branch-name prefix. They do **not** establish whether a branch is merged, obsolete, safe to delete, or unique. The many `ngl-###-*-evidence` branches also need individual disposition. Before deleting branches, compare their heads against main and open PRs, record any unique commits/artifacts, and preserve recovery/evidence branches where needed.


## Fresh stale-PR comparison matrix

The following current-main comparisons were run after the initial PR inventory. “Ahead/behind” counts are Git commit-graph results, not changed-line counts.

| PR | Ahead | Behind | Changed files | Changed lines reported | Disposition |
|---|---:|---:|---:|---:|---|
| #57 TaskAgile recovery | 74 | 141 | 80 | 20,285 | Do not merge as-is; extract reviewed unique files into a fresh narrow tranche. |
| #66 observation attestation | 60 | 138 | 19 | 1,763 | Rebase/transplant and reverify; security behavior is not discarded. |
| #73 signed world trust roots | 31 | 133 | 15 | 1,739 | Reconcile against current security implementation before reuse. |
| #74 audience binding | 27 | 135 | 14 | 1,648 | Reconcile against current security implementation before reuse. |
| #76 signed world attestation | 6 | 120 | 6 | 567 | Reconcile unique change; no direct merge. |
| #63 Founder key-file hardening | 8 | 138 | 3 | 258 | Compare with current key-loading path; no direct merge. |
| #60 store durability | 18 | 140 | 8 | 505 | Compare with newer lock/durability changes; no direct merge. |
| #58 ledger boundaries | 6 | 140 | 3 | 73 | Compare with newer ledger changes; no direct merge. |
| #49 TaskAgile UI primitives | 3 | 147 | 16 | 1,660 | Preserve only reviewed source deltas. |
| #48 assimilation checkpoint | 1 | 147 | 1 | 52 | Superseded by this account-wide inventory; retain as historical evidence. |
| #26 observation verifier boundary | 15 | 163 | 12 | 424 | Reconcile against current world-projection code. |

Large “ahead” counts do not mean all those commits are unique or desirable; large “behind” counts mean the branch was created from an old base and its diff needs fresh scrutiny. Preserve the branches until unique changes and recovery artifacts are recorded.


### Safety action taken after the comparison

After documenting the stale/diverged bases and commenting with the exact comparison results, PRs **#57, #66, and #73 were converted to draft**. They remain open; no source changes were merged or discarded. This is a reversible review-safety measure while their unique changes are reconciled against current main.


### Additional wallet-source finding

The private recovery vault's `omnichain/` folder contains 18 files. A SHA comparison against the current `Omnichain_Bridge_wallet` repository found nine exact common source-file matches, no source file missing from the recovery folder, and seven recovery-only files; the two README/provenance files differ. This establishes a partial recovery relationship, not a complete historical repository mirror.

**Do not run or publicly deploy the wallet initializer.** The inspected `init-ton-wallet.js` generates a TON keypair and writes the secret key as plaintext into `wallet_keys.json` using a normal filesystem write without an explicit restrictive file mode. The inspected `townsquare/server.js` exposes a `POST /wallet-init` endpoint that invokes this script. The current tracked tree does not contain `wallet_keys.json`, and no wallet was generated during this audit. Before any execution, the wallet-key storage must be redesigned (private ignored data directory, restrictive permissions, no secret logging, backup/recovery plan, and explicit operator consent); the endpoint also needs authentication, rate limiting, and safe process management. Because this is wallet-related code and the source repository has no license file in its observed tree, preserve it in the private recovery vault until security and license/IP review is complete—do not copy it into the public Alpha 1 repository yet.


## Historical Official-repository recovery scope

The private recovery vault's manifest is a separate and larger scope than the 32 currently accessible `ngl-damien` repositories:

- `ngl_repo_manifest.csv` records the historical Official inventory (94 repositories in the recovery notes).
- `archives/OFFICIAL_PRIVATE_INVENTORY.md` reports a search sample of 84 private Official repositories.
- `archives/OFFICIAL_PRIVATE_COVERAGE.md` describes 49 private non-archived Official repositories as either represented by a `ngl-damien` shell or packed under the recovery vault's `archives/` folder.
- That same coverage note explicitly says these are **not full bit-for-bit mirrors**; many retain provenance and key files only.
- Direct repository lookup for `No-Gas-Labs-Official/AI-BI-Intelligence-node-gate` returned 404 through the current connected GitHub identity, consistent with `PORT_STATUS.md` saying the `ngl-damien` token cannot read Official private repositories.

Therefore, the 32-repository audit is not the complete historical recovery. Continue from the local recovery manifest, archives, and recorded Official commit/blob SHAs. If a missing source file is not in those archives, the next blocker is authorized read access to the Official repository or a supplied source archive—not guessing or recreating code from a manifest. Never describe a provenance stub as a full mirror.


## Product-readiness boundary

The repository's own current report states that the world is a bounded 1600×1000 landscape with twelve creation slots, not an endless MMO. The local fixture courier does not establish live external-model-provider integration; external providers require actual enrollment and transport. Browser acceptance workflows have passed on inspected commits, but physical Android-device testing, public phone-accessible hosting, external Witness adoption, and production-scale security/load testing are not established by this audit.

This means Alpha 1 is a substantive playable-world prototype with real event/evidence machinery—not yet a verified production MMORPG. The next product milestone should be one complete, repeatable player journey on a phone-sized viewport: enter the world, interact with the Guild Hall adversary, pursue an evidence-linked quest, create or inspect a retained artifact, see the exact evidence/progression consequence, and safely recover after restart/offline interruption. Each step needs observable evidence, not narrative claims.


### Manifest-to-account reconciliation count

A direct parse of the 94-row historical CSV gives 83 rows marked private and 35 marked archived. It has 28 exact repository-name matches in the current account; another 16 historical `featherstone-*` archived mirrors normalize to names that also exist in the current account. Four current repositories are recovery/working additions not listed as exact Official names: Alpha 1, Damien-Featherstone, the recovery vault, and the cooldown probe. Fifty manifest names do not map to a current account repository by exact name or the documented `featherstone-` prefix rule. Some have partial folders/provenance under the recovery vault, so this is a repository-name gap count—not a claim that all 50 have no bytes anywhere. The next pass must map each of those 50 names to archive contents, source SHA, current destination (if any), and recovery status.


## Branch count across all 32 repositories

A branch-list query was run for every current repository. The account has **529 branches total**; Alpha 1 alone accounts for 410 of them. All other repositories have the following counts:

| Repository | Branches |
|---|---:|
| `TaskAgile` | 38 |
| `no-gas-labs-command-center` | 30 |
| `ngl001-def4us28` | 10 |
| `ngl-mesh` | 11 |
| `no-gas-labs` | 3 |
| `Damien-Featherstone` | 2 |
| `ngl-recovery-2026-10-25` | 1 |
| Each of the other 24 repositories | 1 each |

This reinforces that branch cleanup should focus first on Alpha 1, then Command Center and TaskAgile. The single-branch shells are not necessarily complete projects; a one-branch count is not a health signal.
