# Follow-up Reconciliation Audit: TaskAgile, NGL-001, Command Center, and Key Exposure

**Audit date:** 2026-10-25  
**Target:** `ngl-damien/No-Gas-Labs-Alpha-1`  
**Working branch:** `audit/repository-reconciliation-plan-2026-10-25`  
**Evidence basis:** GitHub recursive tree metadata, source-file blob SHA comparisons, and selected text-file reads. This is a repository-level triage, not a successful build, runtime review, malware scan, or license clearance.

## Executive decision

Do not bulk-copy the 103 TaskAgile files into Alpha One. They are not one coherent missing feature: they span a second React/Vite/Express application, an older modular browser game, assets, duplicated UI primitives, production/staging artifacts, and dependency/configuration files. The right next step is selective extraction into Alpha One's existing game/evidence boundaries, with the original repository and its commit history remaining the source of provenance.

The three NGL-001 content differences and the four missing Command Center images also require separate treatment. In particular, the NGL-001 contact ledger/state are evidence-bearing data, not ordinary source files. The 4.56 MB `src/App.jsx` blob is unusually large and the connector returned no text for the requested initial lines; do not treat it as reviewed code or merge it blindly.

## 1. TaskAgile gap analysis

Latest source tree: `TaskAgile` tree SHA `66885999064997b332f61dac13333058c462e857`. File-only comparison: 169 source files, 66 identical blobs already represented in the Alpha One TaskAgile snapshot, 103 absent from that snapshot, 0 same-path content differences. A follow-up scan of Alpha One's broader tree found 14 of those 103 missing-from-snapshot source files already preserved byte-identically under `integrations/taskagile-reference/` (the legacy entry point, nine modules, package metadata, two HTML experiences and deathmatch research). Thus 103 is a snapshot gap, not a claim that all 103 files are absent from Alpha One; after those exact reference copies, at least 89 source paths remain to classify for equivalent implementations or true gaps. Alpha One also has native `game/`, `src/authority/`, `src/institution/`, `src/evidence/`, `src/forge/`, `src/quest/`, `src/world/`, and `test/` modules, so a same-name file is not the only possible equivalent.

### Missing-file groups (103 files)

| Group | Count | Bytes (approx.) | Treatment |
|---|---:|---:|---|
| `client/` | 53 | 1.58 MB | Mixed React client, 40 UI/component files, state/hooks/styles and nine 3D/audio/texture assets. Separate architectural decision required before porting the React stack. |
| `modules/` | 10 | 154 KB | High-value candidates for isolated review: animation, audio, error handling, leaderboard API, persistence, security, state, Telegram API, testing and UI. Do not assume browser-game state/persistence can become institutional state. |
| `main.js` + `localization/en.js` | 2 | 29.5 KB | Candidate legacy browser-game entry point and localization; compare with Alpha One's current game surface before adapting. |
| `rpg.html`, `shrine.html`, `production/deathmatch/*` | 11 | 7.66 MB | Potentially reusable game/narrative experiences and media. Keep as isolated experiences or content candidates; review licensing, political satire context, asset weight, and duplication before publishing/integration. |
| `staging/*` | 10 | 26 KB | Treat as historical experiments/rollback tooling. Never execute rollback scripts merely because they are present. Preserve as provenance; review scripts before any use. |
| package/build/config/docs/server/shared files | 15 | 415 KB | Do not transplant the second app's dependency lockfile, Express/Vite server, database schema, or build configuration into Alpha One wholesale. Extract only a clearly needed, dependency-compatible capability. |

The groups above are path-based triage; a file may be technically valid without being useful to Alpha One.

### Recommended TaskAgile port order

1. **Inventory existing Alpha One equivalents** for RPG/game loops, quest state, evidence receipts, audio/animation, mobile UI, localization, and tests. This inventory has begun: Alpha One already contains native `game/`, `src/authority/`, `src/institution/`, `src/evidence/`, `src/forge/`, `src/quest/`, `src/world/`, and `test/` modules, plus a 15-file `integrations/taskagile-reference/` area. Extend an existing canonical module where possible instead of adding a second owner.
2. **Review the ten legacy `modules/` files as a bounded package**, beginning with `state.js`, `persistence.js`, `security.js`, and `testing.js`. Record each module's imports, browser assumptions, state writes, network calls, and test hooks before adapting it.
3. **Review `main.js` and `localization/en.js` together**. They form a likely entry-point/localization pair, not independent copy-paste candidates.
4. **Evaluate `rpg.html`, `shrine.html`, and the deathmatch artifacts as separate experiences**. Preserve original provenance and avoid making their state authoritative for Alpha One.
5. **Only then consider the React client subtree**. It brings 40 UI components and a separate Vite/Express/Drizzle stack; importing it wholesale would add a second front end and potentially conflicting state/backend contracts.
6. **Defer bulky binary media and dependency files** until there is a specific screen/feature that requires them. The 3D model, audio, textures, celebrity fighter art, and large lockfile are not evidence that their related app builds or works.

## 2. NGL-001 differences and missing asset

File-only comparison against `recovery/public-repos/ngl001-def4us28/`:

- `contact/ledger.jsonl`: source blob differs from snapshot; source file is about 69 KB. This is append-only evidence-like data. Do not overwrite or concatenate automatically. Compare event schemas, hash-chain continuity, duplicates, timestamps and branch/tree provenance; preserve both versions until reconciled.
- `contact/state.json`: source blob differs from snapshot. This is derived state tied to the ledger. Recompute from a validated ledger if its documented reducer exists; do not pick whichever state looks newer.
- `src/App.jsx`: source file is 4,563,284 bytes. The file-read connector returned an empty result for the requested opening lines, so its contents have **not** been reviewed. Determine whether it is minified/generated, embedded media, or an unexpectedly large source artifact before any port. Do not copy it into the runtime on the strength of its filename.
- `src/assets/hero.png`: missing from snapshot; 13,057 bytes. Candidate presentation asset only after confirming its use, provenance, and license.

The other 20 of the 24 compared NGL-001 files have identical blob SHAs. That proves byte identity for those paths, not that the application is operational.

## 3. Command Center missing assets

Four files are absent from the Alpha One snapshot:

- `client/public/images/ai-avatar.jpg` — 5,828,060 bytes
- `client/public/images/capabilities-grid.jpg` — 6,286,569 bytes
- `client/public/images/hero-bg.jpg` — 6,283,952 bytes
- `client/public/images/security-shield.jpg` — 6,834,464 bytes

Together these are about 25.2 MB decimal (about 24.0 MiB). The 104 other compared source files have identical blob SHAs; no same-path content differences were found. The images are presentation assets, not proof of missing capability logic. Before copying them, check where they are referenced, whether they are generated or replaceable, and whether their size/format is appropriate for a mobile-first app. Prefer optimized derivatives when legally and technically appropriate; preserve original source assets in the source repository.

## 4. Damien-Featherstone security gate

The public source tree contains `.data/institutional_keypair.json` (532 bytes) with fields named `publicKeyPem`, `privateKeyPem`, `publicKeyHex`, `keyFingerprintSha256`, and `createdAt`. A private-key field is present in a tracked file. The key material was not reproduced in this report.

**Required response if this key is or could be trusted by any system:**
1. Treat it as potentially exposed until its status is established.
2. Identify every verifier, grant, signature, or runtime that trusts this public key/fingerprint.
3. Generate a fresh keypair in the intended secure environment; update trust/configuration through an explicit rotation procedure; test old-key rejection and new-key verification.
4. Remove private key material from the repository's current tracked files and rotate any dependent credentials. A new commit alone does not erase historical copies from Git history, clones, caches, or archives; history cleanup is a separate coordinated operation.
5. Do not import `.data/institutional_keypair.json`, `.data/world_state.json`, `.data/receipt_ledger.jsonl`, or `.data/mesh_state.json` into Alpha One as authoritative state. Inspect schemas and provenance first; treat world/mesh/receipt files as candidate migration data and preserve source hashes.
6. Do not publish key material in an issue, PR body, log, or this audit.

This audit confirms the tracked private-key field; it does **not** establish whether the key is valid, currently trusted, already revoked, or actively used. No key rotation has been performed.

## 5. Alpha One integration boundaries

- Alpha One remains the canonical runtime and institution; snapshots under `recovery/public-repos/` remain provenance archives, not live modules.
- One canonical owner per world state, ledger, identity/authority, artifact execution, and quest progression.
- Imported modules may propose events or render views; they must not independently grant Founder authority, XP, rewards, or alter canonical state.
- Preserve source repository, source commit/tree SHA, blob SHA, original path, license/provenance, adaptation commit, and test evidence for every adopted artifact.
- Do not silently resolve conflicting state. Prefer explicit adapters and deterministic migration receipts over copying files into runtime directories.
- Never infer tests, builds, deployments, or operational correctness from repository metadata or matching hashes.

## 6. First-pass capability-to-owner map

This is a **path-level integration map** derived from the Alpha One tree and test names. It is not a claim that the implementations are behaviorally equivalent; that requires reading contracts/call sites and running tests.

| TaskAgile capability/artifact | Alpha One candidate owner | Decision |
|---|---|---|
| `client/modules/state.js` game score/combo/power-up state | `game/model.mjs`, `game/service-store.mjs`, `src/quest/engine.js` | Adapt only game mechanics. Never let legacy game state mutate institutional authority or quest rewards directly. |
| `client/modules/persistence.js` local storage/offline sync | `game/service-store.mjs`, `src/institution/ledger.mjs`, `src/evidence/content-addressed.js` | Compare persistence semantics. Institutional events/receipts remain append-only and distinct from browser cache. |
| `client/modules/security.js` sanitization/rate limiting | `src/authority/decision.js`, `src/forge/runner.mjs`, existing security/authority tests | Reuse concepts only after threat-model review; client-side sanitization is not an authorization boundary. |
| `client/modules/leaderboard-api.js` | No obvious one-to-one canonical owner in the current tree | Treat as an optional adapter/product decision. Do not introduce an independent authority or reward ledger. |
| `client/modules/telegram-api.js` | No direct Telegram adapter identified in the current tree | Keep provider-specific and opt-in; do not add Telegram dependency just to recover a file. |
| `client/modules/animations.js`, `audio.js` | `game/client.mjs`, `game/styles.css`, `game/index.html` | Optional presentation features; preserve mobile performance and accessibility. |
| `client/modules/ui.js`, `client/index.html` | `game/client.mjs`, `game/world-view.mjs`, `game/institution-view.mjs` | Extend the current native game view; avoid a second UI runtime. |
| `client/modules/testing.js` | `npm test`, `test/*`, existing component/game/authority suites | Port test cases/invariants, not necessarily the old harness. Tests must actually run to count as evidence. |
| `main.js`, `localization/en.js` | `game/client.mjs` for entry point; no explicit localization subsystem identified | Keep the old pair as reference; localization support is a genuine gap to decide, not to assume. |
| `rpg.html`, `shrine.html`, deathmatch experiences | `game/quests.mjs`, `game/world-view.mjs`, `game/artifacts.mjs` | Treat as separate content/gameplay candidates and preserve source provenance. |
| React `client/src/*`, UI primitives, hooks, CSS | No direct equivalent needed if Alpha One's current game runtime remains the target | Do not import a second React UI stack unless a specific capability justifies the added runtime/dependencies. |
| TaskAgile `server/*`, `shared/schema.ts`, Drizzle/Vite configs and lockfile | `game/server.mjs` and existing Alpha One build scripts | Do not replace Alpha One's server/build/database choices with the source app's stack. Review individual required endpoints instead. |
| `staging/*` rollback scripts and state | No runtime owner | Historical evidence only; never execute automatically. |

### Immediate next engineering slice

The highest-value safe slice is to compare the TaskAgile legacy state/persistence/security/testing modules against Alpha One's game model, service store, authority/evidence boundaries and test contracts, then write a narrow adapter or port only where a real gap exists. The leaderboard and Telegram integrations are explicit product decisions, not mandatory recovery. The React/Vite/Express/Drizzle subtree should remain deferred until there is a demonstrated need.

## 7. Acceptance checklist for this reconciliation work

- [x] Capture a file-only SHA ledger for NGL-001, Command Center, and TaskAgile.
- [x] Record TaskAgile missing-file classes and recommended extraction order.
- [x] Identify NGL-001 evidence-bearing differences and the unreviewed oversized application blob.
- [x] Identify the four Command Center assets and their aggregate size.
- [x] Flag the tracked private-key field without reproducing key material.
- [x] Identify Alpha One's native game, authority, institution, evidence, forge, quest, world, and test areas plus existing TaskAgile reference copies; record a first-pass capability-to-owner map (behavioral equivalence still unverified).
- [ ] Validate NGL-001 ledger/state differences and source provenance.
- [ ] Confirm key trust status and complete rotation/remediation if the key is or could be trusted.
- [ ] Review licenses and security implications for any selected code/media.
- [ ] Port selected capabilities in isolated changes and run relevant tests/builds.
- [ ] Verify each integrated behavior in runtime and attach evidence before declaring completion.

**Security follow-up opened:** [Damien-Featherstone PR #1](https://github.com/ngl-damien/Damien-Featherstone/pull/1) removes the tracked `privateKeyPem` field from the current file while retaining public-key metadata. It is open and unmerged; no key rotation/revocation or Git-history cleanup has occurred.

**Current result:** this document is a triage artifact. No TaskAgile application code or media has been imported, no evidence ledger has been merged, no build/tests have been run, and no key rotation has occurred.
