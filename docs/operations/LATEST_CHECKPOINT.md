# LATEST_CHECKPOINT — Canonical — Restored

**Prior checkpoint recorded HEAD:** ea025a587e0bb3113423ea67035ddfa83ea7dc9f — historical record, superseded by Run 38 below.

**Hourly agents:** 6ac6c77de7ac81918e446a49ea330eb6 Stutter-Step Loop enabled-degraded, 6ac307e1e9bc8191ae21d22f94743802 Forensic Audit enabled-degraded — do not delete — steer via docs/operations/hourly-agents/

**Historical focus (superseded by Run 14):**

- Fix authority valid hole — branch fix/authority-verifyFounderDecision-no-trust-caller-valid — negative tests
- PR #301 8c2c953c Verify Passed 41568800680 Genesis Passed — should supersede #300
- PR #298 Android Failed artifact 13200255149 crash bundledWorldStartsPrivatelyAndSharedModeFailsClosed — 5 passed 1 failed
- 93 vs 95 repo delta unreconciled
- MMORPG ledger all NOT ASSESSED

**Founder final authority — only fixed point — all nodes simultaneously Prometheus and Bob no tags**

**Next falsification targets:** repair AI-BI test command node --test tests/ defective, verify be43452 reference on Alpha-1 main from clean checkout, finish #301 exact-head, diagnose #298 Android crash artifact, reconcile 95 vs 93, advance founder trust-root to live signed-verifier with negative tests

**Hash chain:** prevHash 0... receiptHash of this file content — blockHash Founder sealed — deterministic reconstructable

**Restored by:** enforce/hourly-agents-steering-governance (Grok as ngl-damien) — branch only until reviewed merge

---

## Run 38 — 2026-11-03 — Worker B — Source Observatory v2

**Objective:** advance the playable institution's research loop while preserving the rule that model output, authored notes, and byte receipts do not establish truth or authority.

### Rehydration and baseline

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- Current main observed at `cc317d49c8fdf003c78aa40f38a177095019066e`.
- Read root `AGENTS.md` (SHA `a4beeee1c0ec46faab28502957c0e53850b2855d`) first, then the complete shared protocol (SHA `9a26ee4c17d2462dd66e99e90d258eaa9bcab79f`).
- Read this checkpoint, the MMORPG completion contract (SHA `024144ea9995c0d39ebf073e2f9cd4da0a4eda7e`), and ledger (prior SHA `ea06c37138e86498ac66cec9de4dcb2b4ff7eb52`).
- Checked nested instructions for `game/`, `test/`, `scripts/`, `docs/`, `docs/operations/`, `.github/`, and `.github/workflows/`; all returned 404, so root instructions remain applicable.
- Parent integration PR #312 was re-observed at head `d8bbea51eb74822a772f163a13eba11ef296fd6a`. It is 9 commits ahead / 1 behind current main, with the main-only commit confined to the RAE account-report file. #312 exact-head Verify, Genesis, and Browser checks passed; it remains draft/open/unmerged.
- Latest Worker A proposal #313 was re-observed at head `13c5dfde7bd0aac4467975bedc4c50de8ca9b1a9`. Its Browser Acceptance run `41598541245` passed 12/12 and the Node 20 action deprecation warning was absent. Verify run `41598541564` failed one test: `enrolled key authorizes exact decision` at `test/decision-chamber.test.js:10`, error `FOUNDER_NOT_ENROLLED:NOT_ENROLLED`; 774/775 tests passed. Handoff comment added to #313.
- Latest Worker B Android proposal #309 was re-observed at head `9de3c5617f9dc0ebfe9211ed62489003b4b4032e`. Exact-head Verify `41586444219`, Genesis `41586444189`, Browser `41586444232`, and Android Alpha-1 `41586444234` passed. Android emulator instrumentation completed 7/7; logs also show repeated ADB exit-1 diagnostics before completion, and the retained diagnostics include system_server contention and Chromium renderer-exit markers of unknown cause. This is emulator evidence, not physical-device acceptance. #309 remains a large divergent stack, not a mainline-ready isolated patch.
- PRs #302/#303 were re-observed as the original Source Observatory v2 source. #302 Verify and Genesis passed but its Browser run failed on the old v1 selectors; child #303 Browser passed 12/12, while its separate Android workflow failed. Their old Forge/Android ancestry was not transplanted wholesale.

### Current-main product observation and selection

- Main already has an in-world River of Receipts route, a Source Observatory Forge recipe, a Founder-gated draft/publish flow, retained creation versions, and byte receipts. Relevant source: `game/quests.mjs`, `game/client.mjs`, and `game/artifacts.mjs`.
- The main v1 Observatory seeded a prewritten claim/source pair and lacked a structured falsifier and next discriminating test. That was a higher-leverage research/evidence improvement than another dashboard or disconnected feature.
- The Alpha-1 donor audit, `src/evidence/content-addressed.js`, and `src/world/guild-hall.js` were inspected. The local receipt helper verifies bytes, not truth; Guild authorization uses `isVerifiedAuthorization`. No external donor code was copied.

### Change delivered

- Branch: `game/source-observatory-v2-on-preflight-20261103`.
- Parent: PR #312 exact head `d8bbea51eb74822a772f163a13eba11ef296fd6a`.
- Draft child PR: #314 — https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/314
- Code head at verification: `fac4ee47a9f1d06bc470bb47ef46506c15205214`.
- Changed paths:
  - `game/artifacts.mjs`: replace the seeded v1 Observatory with an empty v2 notebook. It captures claim, author-selected source class, source/attribution, possible falsifier, uncertainty, and next test. Model assertions are leads only; tool output is attributed output, not independent verification. Unknowns export as JSON null. User text is rendered through `textContent`; unknown/prototype source-class values fail closed.
  - `test/game-artifacts.test.mjs`: six Node VM tests cover empty state, model-assertion boundary, provenance/export schema, null unknowns, hostile text, required attribution, 100-observation cap, prototype source classes, and Unicode limits.
  - `scripts/verify-browser.py`: exercise the v2 notebook in the existing two-session world journey and check the exact JSON assurance/export contract.
  - `package.json` and `test/agent-governance.test.mjs`: declare and assert all three implementation/test/browser paths in the hosted preflight target list.
- HTML input maxlength is 1000 UTF-16 code units while script validation is 500 Unicode code points; this allows 500 supplementary-plane characters without permitting more than 500 code points.
- The artifact explicitly says notes remain only in the open notebook until downloaded. The exported notes are not automatically persisted as actor-attributed canonical world events. No game XP, canonical event, authority, or publication gate was changed.

### Exact-head verification

All three workflows completed on code head `fac4ee47a9f1d06bc470bb47ef46506c15205214`:

- Verify [41599394285](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41599394285): **success**. Full Node 24 verification command, Python inspector, game build, and bounded institutional exercise completed successfully. Hosted preflight: `status: ready`, `warnings: []`, `failures: []`. Receipt artifact [13213682427](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41599394285/artifacts/13213682427), SHA-256 `a89464c6698eab094682c77116a225f42170c7a506c40d552f8551dc1f519c38`. The runner declares target paths; its receipt hashes instruction/protocol/vendor/checkpoint inputs, not every target-file byte.
- Genesis Evidence Invariant [41599393387](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41599393387): **success**.
- Browser Acceptance [41599393505](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41599393505): **success, 12/12 journeys**. Observed desktop, phone, institutional-location actions, two-session shared world, 320/360/412 px phone toolbar, 320/412 px one-button layouts, standalone file, exact bytes, and shared restart. The institutional journey observed five locations, one moonshot proposal/world object, two experiment reports, two research activity objects, one creation, and 100 publication XP. Artifact [13214255888](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41599393505/artifacts/13214255888), 5,283,838 bytes, SHA-256 `dacccc0cb23bc5cc2ce7ea4f21cf56b8bbae53c825a9b35d176f249dc2c949b8`.

No local Node 24 execution is claimed because no authorized local checkout/runtime was available. No physical Android-device acceptance is claimed. Browser workflow still emits a Node 20 action deprecation warning because its current-main workflow uses older action versions; Worker A's separate #313 action-upgrade proposal removes that warning in its Browser run but has the unrelated Verify fixture failure above.

### Gate state and handoff

- G6 remains **IN PROGRESS**, not complete: the research notebook is playable and browser-verified, but its notes are local exports rather than durable actor-attributed shared-world events.
- Main is unchanged. PR #314 is draft/open and depends on #312. No merge, release, deployment, external publication, credential/permission change, Founder decision, or canonical game-state mutation occurred.
- Next highest-value game action: design an append-only, actor-attributed Source Observation event with strict schema/source bounds, idempotent retry, offline recovery, and deterministic world projection. Keep model assertions and tool receipts as leads/attributed output only; require independent evidence and the proper human gate for consequential transitions.
- Visual direction remains a separate unfinished product priority: classic top-down tile-and-sprite world rendering. This run did not deliver that transformation.



## Run 12 — 2026-11-08 (local) / 2026-11-09 UTC — Worker B — Combat Yard deterministic rules-engine prototype

### Rehydration and coordination
- Read root AGENTS.md alone, then the complete shared Ralph protocol alone, then the Institutional Charter alone, in the required sequence. Read the MMORPG Completion Contract, current checkpoint, ledger, and relevant steering. Nested game/AGENTS.md and test/AGENTS.md were checked and are absent.
- Current main re-observed at 6f1a4aefb87334ddad359af12f754505965e29a5.
- Latest Worker B feature branch re-observed: PR #418, branch game/animated-github-founder-gate-20261108, exact head 3970ec8e207a1aa395cd5f92c958f30af516aacb. Its Verify, Genesis, Academy, Council, Quest Board, Synthesis Clerk, and Browser Acceptance checks passed at the recorded head; Android Alpha-1 was still in progress. Damien's review on #418 identifies a bounded fetch-timeout defect. This combat branch does not edit #418 or its owned UI module.
- Latest Worker A steering proposal #419 was read. Its old #301 gate is superseded; PR #301 is closed/merged. It directs Worker B not to duplicate #418's current game/client/UI work and calls for evidence-backed, non-cosmetic work.
- The earlier Run 108 branch game/combat-yard-turn-loop-20261106-run11 was inspected. It contains only the recorded Run 108 plan/checkpoint commit, no combat implementation files, and is based on the older PR #393 stack (105 commits ahead of main). It was not continued as a stale base.
- No authorized local checkout or network access was available for a local Node 24 run or pre-edit portable preflight. This limitation is explicit; no local test pass or pre-edit receipt is claimed. Hosted preflight and exact-head CI are required after opening the PR.

### Selected gap
- The source-backed Founder Decision Brief records BOTH conventional combat and a distinct non-combat research/adversarial encounter system as in scope. They remain complementary.
- Current main's inspected game/model.mjs and game/server.mjs contain research/adversarial encounter actions but no conventional combat encounter action/event loop. G4 remains in progress.

### Change
- New branch game/combat-yard-engine-20261108 created directly from main commit 6f1a4aefb87334ddad359af12f754505965e29a5.
- Current code/test head before PR creation: a3ef779d306234703409b4247baae0bfddd5acce.
- Changed paths:
  - docs/gameplay/COMBAT_YARD_RULES_V1.md — documents the ruleset, scope, reward boundary, and the still-missing runtime integration.
  - game/combat.mjs — pure deterministic engine with a fixed three-opponent roster, windup/strike/recovery phases, wait/feint/guard/strike/retreat choices, bounded health and turn count, outcome states, actor-bound transitions, first-win-only XP projection, sequential unlocks, and strict retained-history reconstruction.
  - test/game-combat.test.mjs — 19 focused tests for roster, phase transitions, fixed damage, guard/feint timing, actor separation, unlocks, first-win rewards, replay determinism, invalid moves, retreat, turn exhaustion, and event chronology.
  - package.json and test/agent-governance.test.mjs — add the specification, engine, and tests to hosted portable-preflight target declarations and governance assertions.
- No model, server, world, map, client, character-sheet, quest, Chronicle, PWA, or Android integration was made. The module is a tested-in-design prototype only until hosted checks run; it is not yet playable or canonical world capability.

### Verification and boundaries
- Source inspection confirms the branch is 10 commits ahead / 0 behind main, with five changed files. The hosted preflight target list and governance assertions both include the spec, engine, and test paths.
- The test file contains 19 Node tests, but they have not yet been executed in this session. No local Node run, hosted Verify result, Browser Acceptance, Android result, or physical-device acceptance is claimed.
- Main remains unchanged. No merge, release, deployment, external publication, spending, credential/permission change, canonical game-state mutation, XP award, or Founder authority transition occurred.
- G4 remains IN PROGRESS. Next: open the focused PR, inspect exact-head Verify/Genesis, then build the server-authoritative retained-event integration and player-facing Combat Yard as a separate follow-on, preserving #418 and the non-combat encounter mode.


### PR #420 exact-head verification — code/test head ba3dda95d772051966c8cec70b7210d9552bc0e8
- Opened draft PR #420: https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/420, base main at 6f1a4aefb87334ddad359af12f754505965e29a5. PR #420 remains open, draft, unmerged.
- Verify [42545174580](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42545174580): **PASS**. Hosted preflight was `ready`, warnings `[]`, failures `[]`; Node 24.22.2 full test suite exited 0; standalone build and bounded institutional exercise passed. Preflight receipt artifact [13642094754](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42545174580/artifacts/13642094754).
- Genesis Evidence Invariant [42545174661](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42545174661): **PASS**.
- Browser Acceptance [42545174491](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42545174491): **PASS, 12/12 journeys**. Desktop, phone, five institutional locations, two-session shared world, three phone toolbar widths, two one-button widths, standalone file/bytes, and shared restart passed. Artifact [13643281742](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42545174491/artifacts/13643281742).
- These results apply to exact code/test head ba3dda95d772051966c8cec70b7210d9552bc0e8. This subsequent checkpoint/ledger update is documentation-only; the resulting new head must receive fresh exact-head CI before the branch is treated as finally verified.
- PR #420 is a pure rules-engine prototype. The Browser Acceptance run exercises the existing game; it does not demonstrate Combat Yard UI or gameplay. No Android combat acceptance was applicable or performed.


## Run 13 — 2026-11-08 (local) / 2026-11-09 UTC — Worker B — Combat Yard retained world events and character progression

### Rehydration and coordination
- Continued from Run 12 after PR #420's final exact head `f0a8876947947e43b8677f2cd3f831dec3023d7a` passed Verify, Genesis, and Browser Acceptance (12/12 existing-game journeys). PR #420 remains draft/open/unmerged.
- Re-observed latest Worker B PR #418: current head `15757249d2cc388a1e0ea362f37dd962380362e5`. Verify, Genesis, Browser Acceptance, Academy Study Shelf, Council Chamber, Quest Board, and Synthesis Clerk checks passed at that exact head. Android Alpha-1 remained in progress; no Android pass is inferred. Worker B's latest comment records a 10-second per-request deadline/abort and a never-settling-fetch regression, plus a fix to the Android empty-seed test baseline. This run does not edit #418.
- PR #420 remains the verified rules-engine parent. A separate child branch was created from its exact head; no edits were made to the parent branch.
- No local Node 24 runtime/authorized checkout or pre-edit portable preflight was available. The new branch relies on exact-head hosted preflight after PR creation; no local test pass is claimed.

### Change delivered
- Draft child PR #421: https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/421
- Base branch: `game/combat-yard-engine-20261108` (PR #420 exact head `f0a8876947947e43b8677f2cd3f831dec3023d7a`).
- Head branch: `game/combat-yard-world-events-20261108`.
- Head at PR creation: `2bc2cc4c33911ad444267bf74e0bd42c98f7e7ca`.
- Seven changed paths relative to PR #420:
  - `game/model.mjs`: adds start-combat-encounter and combat-move model actions; appends actor-bound start/move events; reconstructs the encounter before accepting a move; validates full combat history before returning the changed world.
  - `test/game-model.test.mjs`: covers retained start/move history, actor ownership, locked opponents, illegal phase actions, tampered event fields, idempotency receipts, and first-win projection.
  - `game/character-sheet.mjs`: derives combat XP, total character XP, world XP, and Combatant first-win count from the retained event projection. Publication-only `world.xp` remains unchanged.
  - `test/game-character-sheet.test.mjs`: covers actor-specific first-win XP, rematch non-reward, global world XP, Combatant skill count, and fail-closed malformed history.
  - `docs/gameplay/COMBAT_YARD_RULES_V1.md`: updates the implementation boundary and explicitly states that shared-server exposure and player UI remain missing.
  - `package.json` and `test/agent-governance.test.mjs`: add all four model/character source and test paths to hosted preflight declarations/assertions.
- The PR contains 12 model tests and 24 character-sheet tests (including the new Combat Yard cases). No test execution is claimed before hosted Verify.

### Deliberate boundary
- These are canonical world-model actions/events and read-only character projections, but the shared HTTP server still does not allowlist or persist these action types. No map location/NPC, proximity enforcement, browser/mobile interaction, Chronicle/quest integration, PWA shell, or combat-specific browser/Android journey was added.
- Therefore the Combat Yard is still not playable in the shared world. G4 remains IN PROGRESS. PR #421 is a stacked child of #420 and remains draft/open/unmerged.
- Main is unchanged. No merge, release, deployment, external publication, spending, authority transition, or canonical live game-state mutation occurred.
- Exact-head Verify/Genesis/Browser checks for #421 are pending at checkpoint creation. Follow the PR's current head and run results; do not transfer #420's green checks to #421.
- Next safe work: once #421 exact-head checks pass, reconcile its model actions with the latest #418 server/client branch, then implement server action allowlisting/idempotent persistence, location/proximity, Combat Yard NPC/UI, and combat-specific browser/mobile acceptance without overwriting #418.


### Browser Acceptance diagnostic and static-module correction
- PR #421 exact head `c1065c4538e875b9083f386fce2554349c0dbcb5` passed Verify and Genesis but Browser Acceptance failed before entering the private world. The screenshot showed the launch screen; this was not dismissed as a test flake.
- Added temporary-useful diagnostics to `scripts/verify-browser.py` to preserve page errors, console errors, HTTP error response URLs, and failed requests in the assertion output.
- The diagnostic rerun on head `e1be03aabc30ea3ccfe556d58b69efb2e55f6185` identified the exact cause: `GET http://127.0.0.1:<port>/combat.mjs` returned 404. The explicit static-module allowlist in `game/server.mjs` did not yet include the new first-party dependency, so the client module could not finish loading.
- Corrected on this branch only: added `combat` to the server's first-party static module allowlist; extended `test/game-server.test.mjs` to assert that model and character-sheet imports reference `./combat.mjs` and that `GET /combat.mjs` returns JavaScript. No change was made to PR #418's branch. This is static module delivery only; the server's `/api/action` route still does not allowlist/persist combat actions.
- Updated the rules document to distinguish static module delivery from shared action API integration.
- Current branch head after this correction/spec update: `fa136d0cafb3cc4a9d5368b2ca5a984f22fd2125`. Exact-head Verify/Genesis/Browser checks are pending; do not transfer the earlier Verify/Genesis pass or Browser failure to this new head.
- This additive `game/server.mjs` allowlist change touches a path also modified by the active #418 stack, but only on this separate PR branch. It must be reconciled with the latest #418 server changes before any integration/merge; #418 itself remains untouched.


## Run 14 — 2026-11-08 (local) / 2026-11-09 UTC — Worker B — Combat Yard shared HTTP persistence

### Rehydration, coordination, and baseline
- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- Current main observed at `6f1a4aefb87334ddad359af12f754505965e29a5`; main was not changed.
- Re-read root `AGENTS.md`, complete shared Ralph protocol, Institutional Charter, MMORPG Completion Contract, current checkpoint, and MMORPG evidence ledger. Nested `game/AGENTS.md`, `test/AGENTS.md`, `docs/AGENTS.md`, and `docs/operations/AGENTS.md` were checked and are absent.
- No authorized local checkout/runtime was available; Remote Desktop Commander reported no connected device. No local preflight, local Node 24 test, or local build is claimed. The previous exact-head hosted preflight on PR #421 head `e48cf432ac94dafc94a4def3e13ff930551d3414` (Verify run 42548027319) was `ready`, with empty warnings and failures. This run's exact-head hosted preflight is recorded below.
- Re-observed PR #418 at head `d177cc46958c81a2bca01786b360381538021172`. Its `game/server.mjs` change adds the GitHub Decision Gate static module and GitHub API connect permission. PR #418 was not edited. Its server changes must be reconciled with the distinct combat server changes on this branch before integration.
- Re-read latest Worker A steering PR #419. It directs Worker B to avoid duplicating the active Founder Gate client/UI work and to prioritize a distinct evidence-backed capability.
- PR #420 remains the deterministic Combat Yard rules-engine parent, exact head `f0a8876947947e43b8677f2cd3f831dec3023d7a`. PR #421 remains its draft child; no merge or mainline integration occurred.
- Donor inspection: `src/institution/kernel.mjs` supplies strict canonical JSON and byte receipts; `game/service-store.mjs` supplies private, serialized, fsync/rename-backed durable commits and immutable snapshots; `src/world/guild-hall.js` distinguishes proposals from authorization via `isVerifiedAuthorization`; `src/evidence/content-addressed.js` verifies actual bytes against detached receipts. Reused the existing game service-store and kernel boundaries; no donor system was copied wholesale. Combat XP remains a game projection, not evidence, truth, or authority.

### Test-first reproduction
- Added the HTTP integration regression and declared `test/game-server.test.mjs` in the hosted-preflight governance assertions.
- Test-first head: `f1b426ef41fd31d99a4dfec641504a3ab65b6c65`; Verify run [42553335806](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42553335806) reached the new test and failed at the expected missing boundary: `/api/action` returned `INVALID_ACTION: Unknown world action` for `start-combat-encounter`. Hosted preflight itself reported no warnings or failures. This established that the existing model action was not reachable through the shared server.

### Change delivered
- Draft child PR #421, branch `game/combat-yard-world-events-20261108`.
- Code/test head: `de9548280eb09022f732a8786e76efe65a6ecac3`.
- `game/server.mjs` now allowlists only the existing `start-combat-encounter` and `combat-move` action shapes, performs bounded preflight before session allocation, and maps combat actor/conflict errors to 403/409/400 responses. Its independent stored-history validator now accepts the two exact event schemas, checks their idempotency result-key shapes, and binds each retained result to its event's encounter ID/move.
- `test/game-server.test.mjs` adds an end-to-end HTTP/service-store regression: start a Scout encounter; exact retry returns the original encounter; a separate Witness cannot move the Founder's encounter and appends no event; six deterministic moves produce a first victory and 30 actor-scoped combat XP while publication-only `world.xp` remains 0; a duplicate final move after server restart returns the original result; all seven combat events survive restart; forged foreign-actor history and an unsupported authority field both make startup fail with `INVALID_WORLD`.
- `test/agent-governance.test.mjs` now requires the HTTP regression path in the preflight target assertions. `package.json` already declared `test/game-server.test.mjs` in the hosted-preflight command.
- `docs/gameplay/COMBAT_YARD_RULES_V1.md` now records the server action contract and explicitly distinguishes server exposure from a player-facing playable loop.

### Exact-head verification at code/test head
- Verify [42553444687](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42553444687): **PASS**. Hosted preflight `ready`, warnings `[]`, failures `[]`; Node 24 test suite exit 0; Python inspector exit 0; standalone game build exit 0; bounded institutional exercise exit 0.
- Genesis Evidence Invariant [42553444652](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42553444652): **PASS**.
- Browser Acceptance [42553444637](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42553444637): **IN PROGRESS at checkpoint creation**; no Browser pass is claimed here.
- No Android workflow or physical Android-device acceptance was performed for this server-only slice. The new combat HTTP journey is not yet a touch-playable world journey.

### Deliberate boundary and handoff
- G4 remains **IN PROGRESS**. The Combat Yard is now reachable through the authenticated shared action API and durable service store, but there is still no walkable map location, proximity rule, Combat Yard NPC/telegraph UI, touch controls, quest/Chronicle objective, or PWA offline-cache entry for the combat module.
- PR #421 remains draft/open/unmerged and stacked on PR #420. Main remains unchanged. No release, deployment, external publication, credential/permission change, Founder decision, or live canonical game mutation occurred.
- The server file is also changed by PR #418 for its distinct GitHub Gate static/CSP requirements. Preserve both feature sets in a deliberate reconciliation; do not overwrite either static allowlist or CSP change.
- Next: build the walkable Combat Yard location and bounded NPC interaction, wire the two server actions to touch controls and quest/Chronicle progression, add combat-module offline precache and reconnect recovery, then run a combat-specific browser/mobile journey. Reconcile #418 and #421 on a reviewable integration slice before any merge.


### Cross-branch Android integration candidate observed during Run 14
- Re-inspected the main-based snapshot PR #404: head `e57ba17c8388994d6a3d12d954f8b6a011945c56`, base main `6f1a4aefb87334ddad359af12f754505965e29a5`, 5 commits / 76 changed files, draft and unmerged. This is the current reviewable main-based candidate for the walkable world/native Android stack; it does not yet include Combat Yard PRs #420/#421.
- Exact-head checks on #404: Verify [42384740675](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42384740675), Genesis [42384740667](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42384740667), Browser [42384740878](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42384740878), Academy [42384740734](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42384740734), Council [42384740850](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42384740850), Quest Board [42384740759](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42384740759), and Synthesis Clerk [42384740814](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42384740814): **PASS**. Android Alpha-1 [42384740789](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/42384740789): **FAIL**, 1/7 instrumentation tests.
- The failing test is `nativeWorldExportAndImportRoundTripsEarnedProgress`. `MainActivityTest.evaluate` line 561 timed out waiting for the WebView `evaluateJavascript` callback for `document.getElementById('preview-button').click(); 'preview'`. At capture, the page was at 100%, expected title present, WebView attached/visible, and activity not destroyed/finishing. Preflight, fake-ADB Package Manager probe, Android SDK/Gradle setup, debug APK assembly, and six tests passed. Repeated ADB exit-1 diagnostics appeared during emulator startup, but instrumentation did run; causality is not established.
- A diagnostic comment was left on PR #404. Cause remains **UNKNOWN**. Do not weaken the test or call this an emulator-only infrastructure failure without inspecting the call sequence, preview handler, retained instrumentation XML, WebView renderer, and logcat. The source PR #403 Android 7/7 pass is not transferable to snapshot #404.
- This observation does not change the Combat Yard result: PR #421 remains a separate child of #420, and neither combat PR is integrated into #404 or main.
