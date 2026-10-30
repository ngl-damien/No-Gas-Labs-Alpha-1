# No_Gas_Labs™ repository portfolio map

**Inventory date:** 2026-10-29  
**Scope:** 32 repositories visible through the connected `ngl-damien` GitHub account at the time of inspection.  
**Inspection level:** GitHub repository metadata and each repository's root `README.md`, plus targeted review of Alpha One's current pull-request and institutional-security context. This is a portfolio map, **not** a complete source-code, dependency, deployment, or security audit of all 32 repositories.

## Executive summary

The portfolio is not one codebase. It is a collection of (a) one primary institution/game candidate, (b) several substantial standalone applications, (c) narrow experimental services and agents, and (d) recovered repositories, reference snapshots, and placeholders. Repository names, README claims, file counts, and historical APK claims are not proof that a component builds, runs, is deployed, or is integrated.

**Recommended source of truth for the integrated NGL game/institution:** `No-Gas-Labs-Alpha-1`. Other repositories should be treated as candidate components or reference sources until an exact source path, license, interface, tests, and integration proof justify adoption. Do not merge repositories wholesale.

## Architecture in plain English

- **Alpha One** is the central candidate for the playable world, institutional records, evidence rules, Quest/Forge/Decision Chamber flows, and integration decisions.
- **Command Center** appears to be a separate web application with a substantial React/Vite/Express/TypeScript dependency stack. Its README is thin; runtime behavior and relationship to Alpha One need direct inspection.
- **ngl001-def4us28**, **TaskAgile**, **nextjs-ai-chatbot**, **app**, **dia-p2e-cockpit**, and **Omnichain_Bridge_wallet** are separate application/code lines, not modules automatically available to Alpha One.
- **ngl-mesh** is the Android/Relay/evidence-bridge line. Its README explicitly distinguishes the Java bridge currently in the checkout from an inferred historical Kotlin/Compose/Room architecture. Full APK/RAE integration and installed Android behavior are not established by this inventory.
- **no-gas-labs** is a static HTML client. Its README explicitly says it is not a backend, multi-repository orchestrator, or payment processor.
- **Recovery/recreation repositories** preserve or reconstruct source from another repository/account. A recovered copy is not automatically the canonical original and should retain source commit/blob provenance.
- **Evidence/agent mini-projects** such as EvidenceOS, AI-BI Intelligence Node-Gate, VeritasShieldNGL, PulseMonitorNGL, VoxScriptNGL, and SonicForgeNGL are candidate capabilities. Their descriptions do not establish that they are connected into one running agent system.
- **Omnichain/DeFi projects** are a separate risk domain. Do not treat wallet, bridge, flash-loan, faucet, or chain-integration code as safe or live without contract, key, transaction, and chain-specific testing.

## Inventory of the 32 currently visible repositories

Visibility and role below come from GitHub metadata and README inspection. “Candidate” means worth examining—not verified working software.

| Repository | Visibility | Portfolio role | Current interpretation / caution |
|---|---|---|---|
| [No-Gas-Labs-Alpha-1](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1) | Public | **Primary integration candidate** | Playable institution/world, evidence substrate, shared service, Quest/Forge/Decision Chamber and governance experiments. Current `main` observed at `933648a23608d4da4c4e007906cdda62eaf1afd5`. It is still experimental; Founder key custody and complete production enforcement remain open issues. |
| [Damien-Featherstone](https://github.com/ngl-damien/Damien-Featherstone) | Private | Personal/identity artifact shell | README says it was created during recovery for personal/governor identity artifacts and is not a matching Official repo. Treat as sensitive; do not copy or expose private key material. |
| [ngl-recovery-2026-10-25](https://github.com/ngl-damien/ngl-recovery-2026-10-25) | Private | Recovery package | Provenance-focused recovery package. Establish its manifest and source references before using it as a canonical source. |
| [ngl001-def4us28](https://github.com/ngl-damien/ngl001-def4us28) | Public | Large Vite/React SPA | README reports a very large `src/App.jsx` (~4.5 MB) and prior build verification was incomplete. Treat as a separate app requiring a fresh build and maintainability audit. |
| [no-gas-labs-command-center](https://github.com/ngl-damien/no-gas-labs-command-center) | Public | Command Center web app | Package metadata shows a substantial React/Vite/Express/TypeScript stack; README usage docs are incomplete. Not yet proven to orchestrate Alpha One or all repositories. |
| [TaskAgile](https://github.com/ngl-damien/TaskAgile) | Public | Task/productivity app source line | README calls it a recreated/audited source tree. Alpha One has TaskAgile recovery PRs; recovered files are reference material until license, tests, and runtime integration are established. |
| [ngl-mesh](https://github.com/ngl-damien/ngl-mesh) | Public | Android/Relay and evidence bridge | Experimental bridge and trust-marker work. README distinguishes checked-in Java bridge from inferred historical native architecture; broader APK/RAE runtime integration remains unverified. |
| [no-gas-labs](https://github.com/ngl-damien/no-gas-labs) | Public | Static browser client | Single-file HTML clients, not a backend or orchestration service. Live provider calls require user-supplied API keys; payment claims in prose are not a payment processor. |
| [AI-BI-Intelligence-node-gate](https://github.com/ngl-damien/AI-BI-Intelligence-node-gate) | Private | Claim taxonomy / intervention router | README names Verified, Plausible, Speculative, Metaphorical, Aspirational categories and a small HTTP API. Needs direct API/test audit before reuse. |
| [ai-guild-hardened-v0.2](https://github.com/ngl-damien/ai-guild-hardened-v0.2) | Private | Mobile operations/intelligence shell | README lists many modules and a Node/Express/Postgres/Redis + React/Capacitor stack. Those are declared capabilities, not proof each module works or is integrated. |
| [AI-orchestrator-test](https://github.com/ngl-damien/AI-orchestrator-test) | Private | Orchestrator analysis/documentation vessel | README emphasizes reports and architecture documents. Treat primarily as research/reference until executable interfaces are identified. |
| [app](https://github.com/ngl-damien/app) | Private | No Gas Slaps game app line | README describes React frontend + FastAPI/Mongo backend. Separate from Alpha One; verify backend, auth, data handling, and runnable setup before integration. |
| [Omnichain_Bridge_wallet](https://github.com/ngl-damien/Omnichain_Bridge_wallet) | Private | Wallet/bridge app line | README reports Vite/React + tonweb and TownSquare-related files. High-trust surface: no wallet signing or chain safety claims without code and test review. |
| [dia-p2e-cockpit](https://github.com/ngl-damien/dia-p2e-cockpit) | Private | Phaser 3 play-to-earn cockpit | Recovered React/Phaser code line. Candidate game interface; not established as the current Alpha One runtime. |
| [evidenceos](https://github.com/ngl-damien/evidenceos) | Private | Repository analysis pipeline | README describes two-pass per-repository/cross-repository analysis, while noting core files are being filled. Potential leverage for portfolio inventory, but verify completeness and token handling. |
| [omnichain-faucet-townsquare](https://github.com/ngl-damien/omnichain-faucet-townsquare) | Private | Gasless onboarding / chain RPG | README claims EOS/TON/SUI faucet flows. Chain calls, faucet behavior, and security are not verified by this inventory. |
| [No_Gas_Labs-Omnichain_TownSquare](https://github.com/ngl-damien/No_Gas_Labs-Omnichain_TownSquare) | Private | TownSquare lineage/reference | README says this repository is essentially README/security/config; the actual faucet game code is primarily in `omnichain-faucet-townsquare`. Avoid duplicate integration. |
| [no-gas-labs-monorepo](https://github.com/ngl-damien/no-gas-labs-monorepo) | Private | Historical monorepo/recovery pointer | README refers to 127 files in the Official source, but the current repository is very small. Do not assume the complete monorepo exists here; compare against exact source commit/manifest. |
| [multi-chain-flash-loan-dapp](https://github.com/ngl-damien/multi-chain-flash-loan-dapp) | Private | Cross-chain DeFi experiment | README describes TON → EOS → SUI flash-loan/arbitrage. High-risk and isolated from the game until contracts, chain assumptions, signing, and invariants are independently tested. |
| [audit-vault](https://github.com/ngl-damien/audit-vault) | Private | Reserved audit-artifact home | README explicitly says no application source/package yet. A repository placeholder, not a functioning audit product. |
| [believe-in-me](https://github.com/ngl-damien/believe-in-me) | Private | Reserved project shell | README explicitly says no runtime, dependency manifest, or automated tests. Not an executable capability yet. |
| [SonicForgeNGL](https://github.com/ngl-damien/SonicForgeNGL) | Private | Podcast audio editing/mastering agent | Described as an audio/FX agent for America's Got Problems. Verify processing pipeline and dependencies before treating as callable service. |
| [ngl-probe-cooldown-20261029](https://github.com/ngl-damien/ngl-probe-cooldown-20261029) | Private | Probe/cooldown experiment | README only says “cooldown probe.” Treat as a temporary experiment, not a product, unless source/tests establish a durable role. |
| [PulseMonitorNGL](https://github.com/ngl-damien/PulseMonitorNGL) | Private | Monitoring prototype | README calls it a nine-file Python/YAML recreation. No production monitoring coverage is established here. |
| [no-gas-slaps](https://github.com/ngl-damien/no-gas-slaps) | Private | No Gas Slaps game/source line | README describes a small recreation related to TaskAgile and the No Gas Slaps game. Likely overlaps with `app`; compare source before deciding which is canonical. |
| [VoxScriptNGL](https://github.com/ngl-damien/VoxScriptNGL) | Private | Podcast scriptwriting agent | README describes Python/uAgents/OpenAI and links to VeritasShieldNGL/EthosGuardNGL. Declared integrations require code-level confirmation. |
| [VeritasShieldNGL](https://github.com/ngl-damien/VeritasShieldNGL) | Private | Claim/security analysis prototype | README describes a nine-file Python/YAML recreation. Potential evidence-analysis component, not a verified trust authority. |
| [no_gas_labs_sui_flashloan](https://github.com/ngl-damien/no_gas_labs_sui_flashloan) | Private | Sui flash-loan code line | README describes Move + JS/React source. Separate from the cross-chain DApp; contract and economic security are unverified. |
| [no-gas-labs-system-integration](https://github.com/ngl-damien/no-gas-labs-system-integration) | Private | Cross-repository evidence scaffold | README explicitly says its workflow emits **UNVERIFIED** records and does not validate flash-loan invariants, wallet signing, or monitoring. It should not be read as a system-health pass. |
| [Vibe-_Coding_Protocol](https://github.com/ngl-damien/Vibe-_Coding_Protocol) | Private | Ritual/experience engine | README lists EchoNest, GriefShrine, ProphecyDeck, TownSquare and BridgeShrine, with HTML/JS and Node CLI. Candidate experience/content layer; no Alpha One integration established. |
| [nogas-matrix-2026](https://github.com/ngl-damien/nogas-matrix-2026) | Private | Mini-app catalog/landing surface | README advertises 65+ gasless mini-apps. Treat that as a catalog claim, not proof of 65 working, audited apps. |
| [nextjs-ai-chatbot](https://github.com/ngl-damien/nextjs-ai-chatbot) | Private | Next.js chatbot application | README describes a 174-file TypeScript/React/Next.js app. Separate app line; test and credential audit before reuse. |

## Relationship map: what belongs together

```text
No_Gas_Labs™
├── Alpha One (primary playable world + evidence/institution candidate)
│   ├── TownSquare / Journal / Projects
│   ├── Guild Hall: bounded collaborator handoff (PR stack #174 → #177 → #178 → #179)
│   ├── Decision Chamber / durable decision store
│   ├── Forge / evidence and verification boundaries
│   └── recovered-source/reference folders (TaskAgile and other sources)
├── Web surfaces (separate until integrated)
│   ├── no-gas-labs (static HTML)
│   ├── no-gas-labs-command-center (React/Vite/Express stack)
│   ├── ngl001-def4us28 (large Vite/React SPA)
│   ├── nextjs-ai-chatbot
│   ├── app / no-gas-slaps / dia-p2e-cockpit
│   └── Vibe-_Coding_Protocol
├── Android / Relay
│   └── ngl-mesh (bridge experiments; native runtime claims need fresh artifacts)
├── Evidence / agent prototypes
│   ├── evidenceos / AI-BI Intelligence Node-Gate / AI-orchestrator-test
│   ├── VeritasShieldNGL / PulseMonitorNGL
│   └── VoxScriptNGL / SonicForgeNGL
├── Omnichain / DeFi (separate security boundary)
│   ├── omnichain-faucet-townsquare / TownSquare reference repo
│   ├── Omnichain_Bridge_wallet
│   ├── multi-chain-flash-loan-dapp
│   └── no_gas_labs_sui_flashloan
└── Recovery / placeholders / archive pointers
    ├── ngl-recovery-2026-10-25 / Damien-Featherstone
    ├── no-gas-labs-monorepo / TaskAgile recovery
    └── audit-vault / believe-in-me / probe experiment
```

This is a **working conceptual map**, not a dependency graph. No arrows above imply runtime imports or verified interoperability.

## Alpha One open pull-request situation (snapshot)

The live list returned **23 open PRs**. That is not 23 independent completed features; there are overlapping and stacked lines of work:

- **Decision Chamber map:** PR #188 (activity summary) → PR #189 (unavailable/stale summary handling). #189 depends on #188's branch and should be reviewed in order.
- **Decision-store concurrency:** PR #187 is the newer mutation-guard work; PR #182 is overlapping older cross-process test work. Reconcile the diff and acceptance coverage instead of merging both wholesale.
- **Founder signed-decision helper:** PRs #180/#181 are current-base hardening work; #164 is an older related line. Helper hardening is not end-to-end server enforcement.
- **World observation/attestation:** PRs #26, #66, #73, #74, and #76 overlap on host verification, signed observation, audience binding, and integration. Some are explicitly non-mergeable. Select one canonical line after source/diff comparison.
- **Guild Hall handoff:** PR #174 → #177 → #178 → #179 is a stacked progression; review dependency order.
- **TaskAgile recovery:** PRs #49 and #57 recover source snapshots. These are provenance/recovery work, not runtime integration.
- **Storage/key hardening:** PRs #58, #60, and #63 are older non-mergeable lines; compare their unique fixes against current main before transplanting anything.
- **PR #48** is a prior 12-repository assimilation checkpoint and is now incomplete relative to the 32-repository connected-account inventory.

Do not merge based only on a “mergeable” flag or green CI. A green test suite validates the tests it ran, not every claimed runtime capability.

## Highest-leverage next actions

1. **Keep Alpha One the integration spine** while it is the most developed, tested playable institution. Do not turn every other repository into a dependency.
2. **Reduce duplicate PR work first.** Build a supersession table from changed-file diffs and exact-base commits, then close or consolidate redundant branches only with the appropriate authority. Do not merge stale histories wholesale.
3. **Resolve evidence and Founder-authority boundaries.** Issue #17 remains open for independent key custody, canonical mutation enforcement, concurrency, and crash recovery. PR #16's self-signing approach is superseded by merged PR #18; that does not establish real-world Founder identity or key custody.
4. **Choose source-recovery targets by reuse value.** TaskAgile recovery can be useful, but preserved source needs license review, exact provenance, tests, and a concrete Alpha One import boundary before it becomes runtime code.
5. **Audit high-risk code separately.** Wallet/bridge/flash-loan repositories need contract-level, chain-specific and key-handling checks. Do not connect them to the game merely because they share the NGL name.
6. **Turn placeholders into explicit decisions.** `audit-vault` and `believe-in-me` currently describe themselves as empty project shells; decide whether to implement, archive, or leave them parked.
7. **Add a reproducible capability matrix.** For each repo record: purpose, canonical status, owner, entry point, build/test command, latest exact-head test evidence, secrets required, dependencies, license, provenance, and Alpha One integration status.

## Evidence rules for future updates

For every row, keep four things distinct:

- **Observed:** GitHub metadata, actual files, exact commit, executed test result.
- **Declared:** README or PR claims not independently verified in the relevant environment.
- **Inferred:** likely relationship based on names, paths, or shared concepts.
- **Unknown:** missing source, build result, credentials, device, external artifact, or integration proof.

Never promote “recovered,” “audited recreation,” “APK reported,” “green CI,” or “65+ apps” into a broader claim than the evidence supports.

## Sources inspected

- Connected-account repository metadata for all 32 repositories (names, visibility, default branch, approximate GitHub repository size).
- Root `README.md` for each of the 32 repositories.
- Alpha One `README.md`, `docs/institution/compounding/PLAN.md`, current open PR inventory, PR #48's earlier assimilation checkpoint, and Issue #17.
- NGL Mesh PR #1 and Command Center `package.json`.

This document intentionally does not copy secrets, change runtime behavior, merge PRs, or assert that every repository has been fully audited.
