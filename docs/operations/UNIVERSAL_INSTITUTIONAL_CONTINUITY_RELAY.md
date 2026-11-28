# Universal No_Gas_Labs™ Institutional Continuity Relay Harness

**Status:** Proposed canonical operating record and handoff mechanism  
**Proposed canonical path:** `docs/operations/UNIVERSAL_INSTITUTIONAL_CONTINUITY_RELAY.md`  
**Initial record:** Relay v1 · 2026-11-27
**Latest revision:** Relay v2.4 · 2026-11-28  
**Authority:** Neophyte Founder  
**Purpose:** Preserve transferable institutional state between agents, assistants, sessions, and execution cycles.

## 1. The relay is mandatory institutional infrastructure

This record is the continuation manual handed from the previous agent to the current agent and updated for the next agent.

After completing the repository's mandatory bootstrap sequence (root `AGENTS.md`, shared scheduler protocol, and Institutional Charter), every agent MUST read this relay in full before any further review, research, inspection, proposal, or implementation.

Every agent MUST update the current relay and append a dated handoff entry before ending its execution cycle or handing work to another agent. A handoff that says only “continue” is insufficient.

The relay is shared institutional memory, not an authority source. It transfers context; it does not grant permissions, approve work, establish truth, or replace fresh inspection.

## 2. Mandatory agent sequence

1. Read root `AGENTS.md` alone as the first repository operation.
2. Read `docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md` alone as the second repository operation.
3. Read `docs/institution/INSTITUTIONAL-CHARTER.md` in full.
4. Read this complete relay record in full.
5. Read the complete Neophyte Founder Above-and-Beyond Protocol in full and apply it before substantive work.
6. Read the latest durable checkpoint and the most recent relevant handoff from other active workers.
7. Only then inspect current repository state, branches, PRs, issues, workflows, source, tests, environments, or artifacts.
8. Revalidate inherited claims against current authoritative evidence before relying on them.
9. Before handoff or session end, update the current-state section and append a new dated relay-log entry.

If a required file cannot be read in full, stop repository work and report the exact blocker. Do not claim compliance by acknowledging a document without reading it.

## 3. Evidence and authority vocabulary

Every material statement in the relay must be identifiable as one of:

- **FOUNDER DECISION** — an explicit decision supplied by the Neophyte Founder.
- **FOUNDER REQUIREMENT** — an explicit product or operating requirement supplied by the Founder.
- **VERIFIED OBSERVATION** — directly inspected source, repository state, test output, device result, or external state, with exact reference.
- **INHERITED CLAIM** — information from a previous agent that has not yet been revalidated.
- **ASSISTANT RECOMMENDATION** — proposed action or interpretation; never authorization.
- **UNKNOWN** — evidence is absent, unavailable, contradictory, or insufficient.

Never promote a recommendation, hypothesis, inherited claim, test fixture, model response, hash, or successful interface interaction into a Founder decision or verified outcome.

A model's assertion is never sufficient evidence that the state it describes is correct.

## 4. Current authorized objective

**FOUNDER REQUIREMENT — 2026-11-27**

The Neophyte Founder opens No_Gas_Labs™ on Android, enters The Decision Chamber through the in-game Guild Gate, reviews the accumulated Founder Decision Stack, communicates with LLM assistants through this continuity relay, makes explicit Founder decisions, and uses the in-game Guild Gate to authorize supported operations that produce real, independently verified changes in No_Gas_Labs™ GitHub repositories. The Founder closes and reopens the Android application and can inspect the preserved decision, outcome, and provenance.

**NON-NEGOTIABLE PRODUCT INVARIANT**

The Founder experience must never become a text-based technical workflow or be technically complicated. It must be visual, intuitive, game-native, and understandable without software-engineering knowledge.

Forbidden as required Founder interactions: terminal/command line, code editor, raw JSON/YAML/API payloads, Git commands, manual branch or commit management, technical repository navigation, developer dashboards, or instructions requiring the Founder to understand implementation details.

Natural conversation is allowed. Voice interaction is desirable where supported. Typing must not be required for ordinary Founder operation. The institution absorbs technical complexity; the Founder experiences capability.

## 5. Current acceptance matrix

Use exactly **NOT TESTED**, **FAILED**, or **PASSED** for each criterion. A PASS requires direct evidence for the exact current candidate and environment. Do not transfer evidence from a parent commit, different branch, browser, emulator, or mock into a stronger acceptance claim.

| Founder journey criterion | Status | Current evidence / limitation |
|---|---|---|
| Install and launch on the supported physical Android device | NOT TESTED | No current physical-device receipt. Hosted emulator evidence is not physical-device acceptance. |
| Enter the playable world on the supported physical Android device | NOT TESTED | No current physical-device end-to-end receipt. |
| Enter The Decision Chamber through the Guild Gate | NOT TESTED | Prior hosted Android journeys exercised a Founder Gate route, but do not establish the complete Founder journey on the physical device. |
| Review a real, accumulated Founder Decision Stack | NOT TESTED | A durable decision service exists; a complete, Founder-accepted in-game stack journey is not evidenced. |
| Communicate with a live LLM assistant through the in-game NPC and relay | NOT TESTED | PR #761 uses a test-supplied response; it explicitly does not invoke a model. |
| Review assistant contributions and their provenance | NOT TESTED | Artifact/response provenance mechanisms exist; integrated live-assistant review is not demonstrated. |
| Make an explicit Founder decision through the live signed route | FAILED | The live route remains fail-closed. Founder trust is NOT_ENROLLED and the server does not integrate `authorizationEvent`. |
| Authorize a supported GitHub write through the in-game Guild Gate | FAILED | The inspected GitHub Decision Gate uses public GET requests and explicitly describes itself as read-only. No in-game write adapter was evidenced. |
| Independently retrieve and verify the resulting GitHub state | NOT TESTED | The read-only viewer can inspect public records; no in-game write-and-verify journey exists. |
| Preserve decision, authorization, execution result, and provenance across app close/reopen | NOT TESTED | PR #761 adds a server-process restart persistence test for one collaborator-response event; it is not the complete Android Founder journey. |
| Complete the journey through a visual, nontechnical interface | NOT TESTED | The hard product invariant is Founder-authorized; complete end-to-end usability has not been accepted by the Founder. |

A failed prerequisite is not permission to bypass it. Continue with safe, independent work and preserve the exact blocker.

## 6. Verified repository baseline at relay creation

**VERIFIED OBSERVATION — 2026-11-27**

- Canonical repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- Default branch: `main`.
- Observed main commit: `21677d88cb027f3d16adacf92dbdd0ec08e96dbd`.
- Root instructions: `AGENTS.md`, blob `212aef7eae2b690a2c4d67c148f35b95d03fbbdf`.
- Shared scheduler protocol: `docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md`, blob `cf3b182510a33c3f515d7e5dd4eba2ae5f984a0b`.
- Institutional Charter: `docs/institution/INSTITUTIONAL-CHARTER.md`, blob `a0fb01c3170baea91808ae14eae14e598a44142c`.
- MMORPG Completion Contract: `docs/operations/MMORPG_COMPLETION_CONTRACT.md`, blob `024144ea9995c0d39ebf073e2f9cd4da0a4eda7e`.
- World Projection Contract: `docs/WORLD_PROJECTION_CONTRACT.md`, blob `82a5912b23d4a35f12408da3059ffd63b01c00a5`.
- Current durable checkpoint on main was stale at Run 271 (2026-11-20). Newer handoffs were found on active PR branches and must be reconciled rather than overwritten.
- No pre-existing file with this relay's proposed canonical path was found on main at creation. This relay is proposed work until its PR is reviewed and merged.

### Active work and ownership observed

- **PR #755** — Worker B's open/draft MMORPG integration candidate; branch `fix/quest-inherited-event-identity-accessor-20261126-run11`; exact observed head `1c3cdeeaa888fac2bead8863b1e4eff4b8c6c64e`. It contains game/runtime and Android acceptance work plus a two-client, single-server-process SSE test. It is not proof of two distinct humans, multi-instance consistency, or complete G3.
- **PR #758** — Worker B's open/draft documentation child of #755; branch `docs/two-client-multiplayer-checkpoint-20261127-run11`; head `6031ffa50c99e58ad82a508e3412e236701ae746`. Its checkpoint was written while several workflows were still running; reconcile later terminal outcomes before relying on those pending statuses.
- **PR #761** — Worker B's open/draft test-only child of #755; branch `test/guild-hall-synthesizer-restart-20261127`; exact observed head `a8c39fbac00e2de357546cc9a25a0ff0cba84fda`. Worker A's Run 10 handoff reports exact-head Playable World, World Projection, and Full Verify PASS. The test proves one bounded collaborator-response record survives server-process restart and reauthentication. Its response text is supplied by the test; it does not prove live LLM invocation, NPC-driven model conversation, relay integration, Android close/reopen, or Founder acceptance.
- **PR #760** — Worker A's open/draft evidence checkpoint; branch `docs/worker-a-run9-evidence-checkpoint-20261127`; exact observed head `03ee061774fb96d44bbcf250ffe36871b2e2da42`. Worker A Run 10 handoff is in its PR discussion and is the freshest reviewed authority/Guild Gate finding at relay creation.
- **PR #759** — Worker A's open/draft test-only authority regression branch; head `a5511db95a49297782a5c2d17c47ac9ee5a330c0`. It expands fail-closed negative coverage; it does not prove live signed authorization.
- Worker A owns cross-cutting authority review and coordination. Worker B owns playable/runtime implementation and the MMORPG completion ledger. Do not create a competing implementation in Worker B's active server/game paths.

### Verified authority and GitHub integration boundary

- `docs/authority/founder.pub.json` is `NOT_ENROLLED`; blob `b3e805c2e7233ff866db1aabe004c0859fe7cde1`.
- `game/server.mjs` imports `openDecisions` and `loadTrustAnchor`, but not `authorizationEvent`; blob `f7cb11031331a8fafe6ab5a6cb3d93992d880cc6`.
- The server's `dispositionAuthorizationStatus` returns unavailable for unenrolled trust, TEST_ONLY trust, and even enrolled PRODUCTION trust while the signed route is not integrated. APPROVE/REJECT/DEFER remain disabled.
- `src/authority/decision.js` contains a host-configured trust/nonce authorization mechanism, but its existence does not mean the live game server invokes it.
- `game/github-decision-gate.mjs`, blob `7094b0756e26d95597c71b7137bab70ecda26a94`, fetches public pull requests, issues, and workflow runs using GET requests. Its UI explicitly says it is read-only and does not merge, write, approve, deploy, or change repository state.
- No source-backed in-game GitHub write adapter or credential flow was established in the inspected files. A ChatGPT GitHub connection, if available to an assistant, is not automatically available to the Android game.
- Exact source anchors: `game/server.mjs` imports `loadTrustAnchor` but not `authorizationEvent` (lines 17–18); `/api/decisions` exposes the authorization status (1527–1532); `/api/decisions/choose` explicitly returns the fail-closed status before any decision write (1595–1600). `src/authority/decision.js` exports `authorizationEvent` at line 740; it loads host-configured trust, requires PRODUCTION, verifies using host time, consumes the durable nonce, and only then returns the authorization event (740–759). `game/github-decision-gate.mjs` uses GET at line 42 and labels the UI read-only at line 485. These are source observations, not an authorization to change them.
- The NPC workbench's current helper is navigation/focus only. PR #761's test-supplied response is not evidence of a live LLM invocation. A real assistant transport, provider authorization, and explicit relay read/update integration remain unimplemented or unverified.
- Do not generate, custody, enroll, export, or provision a Founder private key. Founder trust enrollment requires a Founder-controlled platform keystore, proof of possession, independent custody verification, and a separate explicit Founder decision.

## 7. Current blocker map

1. **Founder authorization:** the cryptographic authorization primitive exists, but the live server route does not call it and production trust is NOT_ENROLLED. Founder-controlled keystore enrollment and proof of possession are Founder-only prerequisites; no agent may manufacture them.
2. **GitHub writes:** the in-game gate is a public read-only viewer. A narrowly scoped server-side GitHub write adapter and secure credential/installation flow are not evidenced. ChatGPT's connected GitHub access is not automatically an in-game credential.
3. **LLM collaboration:** NPC navigation and test-supplied collaborator responses exist, but live model invocation and explicit continuity relay transport are not demonstrated.
4. **Android acceptance:** hosted emulator tests are not physical-device evidence. The current #755 emulator acceptance check remains IN_PROGRESS at the observed head; no Founder physical-device acceptance exists.
5. **Founder usability:** the nontechnical visual invariant is authorized, but the complete journey has not been accepted by the Founder.

## 8. Operating and coordination rules

- The unit of work is an end-to-end Founder capability, not a repository, PR, or easy code change.
- Prefer the smallest coherent vertical slice that proves a real user-visible outcome.
- Before touching a path, inspect its nested instructions, active branch/PR ownership, exact current head, and relevant tests.
- Worker A and Worker B must not edit the same feature or files concurrently. Handoffs are recommendations; the receiving worker re-observes before acting.
- A PR is proposed work. A test pass proves only what the test exercises. A draft branch is not integrated capability.
- Preserve the existing zero-additional-cost constraint and low-resource Android requirements.
- Do not make the Founder operate terminals, raw GitHub, code editors, developer dashboards, or technical configuration.
- No merge, release, deployment, spending, external publication, key/trust enrollment, credential or permission change, or other reserved consequential action without the applicable explicit authorization.
- If physical-device access, production trust, GitHub credentials, an LLM provider integration, or another required dependency is unavailable, record it as a blocker. Do not simulate success or route around the boundary.
- Preserve contradictions, negative results, and uncertainty. Never rewrite an old handoff to make the history appear successful.

## 9. Required update format

At the end of each execution cycle, update the **Current relay state** below and append one entry under **Append-only relay log**.

The current state is a concise index to the latest verified facts. The log preserves historical handoffs. Do not delete earlier entries; correct an error by adding a dated correction that identifies the superseded claim and its evidence.

### Current relay state

**Latest execution overlay — 2026-11-27:** PR #767 exact head `60243c6da2403163d071aa6c41f8aa373ce39591` has Full Verify `46048769085` PASS, Genesis `46048769092` PASS, and Browser Acceptance `46048769106` PASS. Its restart-replay test confirms persisted request replay, stable pseudonymous actor, no duplicate event/revision/XP, and altered-payload conflict rejection. Source review found the test still reads the original POST response despite claiming to discard it; the genuine lost-response simulation remains an open test-quality gap. See Relay v2.3 below. Relay update committed to the existing #762 branch at `067db5258bf9b78fd556382be478a357a95d8f2f`; #762 remains proposed/unmerged. No MMORPG runtime source or player-facing capability changed in this run.


- **Relay version:** 2.3
- **Last updated:** 2026-11-27
- **Last agent:** ChatGPT execution agent — MMORPG run; governing-document bootstrap, active PR/code/CI reconciliation, donor-mechanism inspection, #767 acceptance challenge, and relay handoff.
- **Objective:** Founder-controlled, visual Android Decision Chamber → assistant continuity → explicit authorization → real GitHub state change → independent verification → close/reopen persistence.
- **Latest multiplayer response-loss acceptance — VERIFIED OBSERVATION:** PR [#772](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/772), exact commit `eb53b5bbd0340e56f801a36c0c42a3ce45acd67b`, adds `test/game-multiplayer-total-response-loss.test.mjs`. The test's fault-injection proxy receives the upstream HTTP 200, consumes the complete response, and destroys the downstream connection before forwarding headers/body; the simulated client observes a transport error. A separate `/api/state` read confirms exactly one committed event, then a server restart and same-cookie retry return the original event identity without another revision/event/XP. Altered payload reuse returns HTTP 409 and leaves state unchanged. Exact-commit hosted Full Verify run `46096952199`, Genesis `46096952244`, and Browser `46096952220` all completed successfully. Full Verify's world-projection job and all steps completed successfully. This is a single-process, one-data-directory server test; no multi-instance, Android device, two-human, or full G3 claim follows. PR #772 remains proposed; no merge or runtime change is claimed.
- **Current blocker:** The live Founder decision route remains fail-closed; Founder trust is NOT_ENROLLED; the in-game GitHub gate remains read-only and no in-game write adapter/credential flow is evidenced. Physical-device Founder acceptance remains absent. Android diagnostic PR #763's exact-head emulator workflow now reports PASS, but that does not establish physical-device acceptance or explain every separate Android failure on other branches.
- **Continuity relay implementation:** Proposed in draft PR [#762](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/762), branch `docs/universal-institutional-continuity-relay-20261127`. Live PR metadata, not a hash embedded in this file, is authoritative for its current head. It adds this relay and makes reading/updating it mandatory in root AGENTS and the shared scheduler protocol. This relay remains proposed and is not canonical until reviewed and merged.
- **Above-and-Beyond Protocol:** Proposed in the same PR #762. It is required after the relay and before substantive work. The portable preflight now fingerprints the Charter, relay, and Above-and-Beyond Protocol in addition to root instructions and the shared protocol; the dedicated Founder Protocol Gate validates these inputs and new-PR handoff structure. Its PR-record validator has negative-path unit tests for missing Founder-facing sections and missing relay updates; the first invocation exposed and is correcting a unittest module-discovery/import-path issue. This is proposed work until #762 is reviewed and merged.
- **Enforcement limitation:** The repository rulesets endpoint returned an empty list. The branch-protection read endpoint returned 403 to this integration, so the existence/configuration of legacy branch protection is UNKNOWN. No permission or branch-protection change was made. The Founder Protocol Gate must be marked as a required status check by a repository administrator before it can block merges.
- **PR #762 exact current head:** `70a4c66098ed0eac505d04d5d620ce6e80413182`; draft/open/unmerged at this observation; latest relay update is being appended on this branch. Verify `45984477179` PASS and Genesis `45984477225` PASS; Browser `45984477141` FAILs at the inherited Contradiction Clerk locator. This is superseded as a product/test-harness diagnosis by the separate #747 correction, which routes the Clerk journey to Evidence Archive; #747 Browser run `45878004416` PASS on head `081d72230fff24bb40aa08862583ec305d7c665f`. Do not transfer that pass to #762.
- **PR #755 exact-head observation:** `1c3cdeeaa888fac2bead8863b1e4eff4b8c6c64e`; Verify, Genesis, Browser, Quest Board, Synthesis Clerk, Council, Academy, Combat Yard, Source Archive, and PWA workflows PASS; Android emulator acceptance `45951191102` FAIL. Fresh job `140427014819` confirms APK assembly and artifact preservation PASS; the 10-test instrumentation XML has an empty failure for `publishedSourceObservatoryRestoresNativeBackupThroughPreviewAndAppendWithoutWorldProgress`, then reports `Instrumentation run failed due to Process crashed`. Logcat shows WebView sandbox process PID 5760 dying, ActivityManager force-removing the app Activity, and the instrumentation run being terminated. No Java fatal exception, native signal, or causal stack appears in the retained log. Emulator graphics messages are present but do not establish causation. No physical-device acceptance is established.
- **PR #761 exact-head observation:** `a8c39fbac00e2de357546cc9a25a0ff0cba84fda`; Playable World `45972900886`, World Projection `45972900854`, and Full Verify `45972900877` PASS. This is a server-restart collaborator-response subgate only; the response is test-supplied, not a live LLM interaction.
- **Active implementation owner:** Worker B for game/runtime; Worker A for cross-cutting authority review. Do not edit Worker B's active server/game paths concurrently.
- **Latest exact-head CI reconciliation (Run 2):** PR #762 head `9998e4b192c5fa98a2f0be9810e738857ec32959`: Genesis run `45978215377` PASS; Verify run `45978215449` PASS; Browser run `45978215438` FAIL at `scripts/verify-browser.py:472` because `#contradiction-clerk-npc` was not found. The offline-PWA recovery subjourney passed before the basic journey failed. This is a known inherited mainline Browser locator mismatch; PR #755's separate current-main integration branch contains the corrected Browser journey and passed its Browser run. Do not transfer that pass to #762.
- **PR #755 exact-head reconciliation:** head `1c3cdeeaa888fac2bead8863b1e4eff4b8c6c64e`; Verify, Genesis, Browser, Quest Board, Synthesis Clerk, Council, Academy, Combat Yard, Source Archive, and PWA workflows PASS; Android Alpha-1 run `45951191102` FAIL. The emulator journey assembled the debug APK, then failed instrumentation. Captured XML includes an empty failure for `publishedSourceObservatoryRestoresNativeBackupThroughPreviewAndAppendWithoutWorldProgress`; logcat also shows the WebView sandbox process dying and the app/instrumentation being force-stopped. The available log does not establish a single causal root cause. No physical-device acceptance is implied.
- **PR #761 exact-head reconciliation:** head `a8c39fbac00e2de357546cc9a25a0ff0cba84fda`; Playable World `45972900886`, World Projection `45972900854`, and Full Verify `45972900877` PASS. This remains a test-supplied collaborator-response server-restart subgate, not live LLM invocation or full Android continuity.
- **Next recommended action:** Worker A should review the authority boundary and coordinate with Worker B rather than editing Worker B's active `game/server.mjs`, Browser, or Android paths. Worker B owns #755's runtime/Android repair. The immediate cross-cutting priority is a safe, testable architecture proposal for an in-game GitHub adapter that remains inert until Founder trust and a separately authorized credential/installation flow exist; do not create a real GitHub write or provision credentials in this run. Preserve the visual/nontechnical Founder invariant.

## 10. Append-only relay log

### Relay v1 — 2026-11-27 — Initial institutional handoff

**What was inherited and read:** root AGENTS, shared scheduler protocol, Institutional Charter, main checkpoint Run 271, current Worker B checkpoint PR #758, Worker A Run 9/Run 10 evidence in PR #760, and the current MMORPG completion contract and World Projection Contract.

**What was freshly verified:** canonical main SHA; active PR heads and roles listed above; Founder trust file is NOT_ENROLLED; live server does not import or invoke `authorizationEvent`; server status helper keeps all live Founder dispositions unavailable; GitHub Decision Gate uses public GET-only requests and explicitly identifies itself as read-only.

**What was not done:** no production source changes; no GitHub issue creation from the game; no key generation or trust enrollment; no merge, deployment, release, external publication, credential/permission change, or spending. No physical Android device acceptance or live LLM-to-NPC continuity was tested.

**Recommended handoff:** Worker B owns the next game/runtime vertical slice. Worker A should coordinate the authority integration review and ensure the signed route remains fail-closed until Founder-controlled trust enrollment is separately completed. The Founder-only enrollment prerequisite must be presented as a future, understandable in-game setup journey, not as a technical task dumped on the Founder.


### Relay v1.1 — 2026-11-27 — First execution handoff

**Work performed:** Created draft PR [#762](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/762) from canonical main. Added this continuity relay, updated root `AGENTS.md` to require it before further review/work, and updated the shared scheduler protocol to require reading and updating it on every execution cycle.

**Initial PR head:** `dcc6a0b4d7127c395e7d843c6f6783be86056a1c`; a subsequent relay update appended this handoff. The current exact head is always taken from live PR #762 metadata to avoid a self-referential commit hash inside the relay. Three changed files; 181 additions / 21 deletions at PR creation. The relay file, updated AGENTS, and updated protocol were fetched back from the branch and checked for the required bootstrap, mandatory read, and handoff/update clauses.

**Verification:** Full Verify `45977508493` PASS. World Projection `45977508426` and Playable World `45977508467` were still IN_PROGRESS at the last check. No full CI pass is claimed. No local checkout or local test execution was available. PR #762 remains draft/open/unmerged; it is not yet the canonical relay.

**Fresh state reconciliation:** PR #755 exact head `1c3cdeeaa888fac2bead8863b1e4eff4b8c6c64e` has ten successful check runs, one skipped deploy job, and Android emulator acceptance `45951191102` still IN_PROGRESS; combined status PENDING. PR #761 exact head `a8c39fbac00e2de357546cc9a25a0ff0cba84fda` has Playable World, World Projection, and Full Verify all PASS, but its test-supplied response is not live LLM communication.

**No consequential action:** No runtime source change, GitHub issue write through the game, key generation/enrollment, merge, release, deployment, spending, credential/permission change, external publication, or Founder authority transition occurred.

**Handoff:** The next runtime implementation belongs to Worker B. Worker A owns cross-cutting authority review. Re-observe both active branches before touching shared paths. The live Founder disposition route remains fail-closed, Founder trust remains NOT_ENROLLED, and the existing in-game GitHub gate remains read-only. The next meaningful product proof is one visually authorized in-game Guild Gate action that creates a narrowly scoped GitHub issue and independently verifies it, but only after the authorization and in-game credential boundaries are implemented and Founder-authorized.


### Relay v1.2 — 2026-11-27 — Source-level blocker refinement

**Fresh source inspection:** On canonical main, `game/server.mjs` imports `loadTrustAnchor` but not `authorizationEvent`; the live `/api/decisions/choose` route returns the fail-closed status before calling the decision service. The separate `authorizationEvent` implementation requires host-configured enrolled PRODUCTION trust, verifies the signature with host time, consumes the durable nonce, and then returns an authorization event. The in-game GitHub viewer uses GET requests and explicitly discloses that it is read-only. Source SHAs are recorded above.

**Additional blocker:** The Guild NPC workbench is navigation/focus, not live LLM invocation. PR #761's response is test-supplied. A real assistant transport and continuity read/update integration are not demonstrated.

**Disposition:** These findings confirm that the first GitHub issue create/update action cannot safely be enabled by merely adding a button or reusing the ChatGPT GitHub connector. It requires a server-side GitHub credential/installation flow and the existing Founder authorization boundary to be integrated without weakening it. The Founder-only trust enrollment remains separate and untouched.

### Relay v1.3 — 2026-11-27 — Exact-head check reconciliation

**PR #762 verification:** At observed head `975c4d6fa9487f8b956df12514fb266510aacc5d`, Full Verify `45977942497` completed PASS; World Projection `45977942506` and Playable World `45977942487` were IN_PROGRESS. The PR remained draft/open, mergeable, and unmerged. A later relay update creates a new head, so the next agent must fetch live PR metadata and exact-head checks again before claiming current status.


### Relay v1.4 — 2026-11-27 — Run 2 exact-head reconciliation and handoff

**Fresh baseline:** canonical repository remains `ngl-damien/No-Gas-Labs-Alpha-1`, default branch `main`; repository metadata confirms push/admin access and no archive status. The required bootstrap documents were read in order: root `AGENTS.md`, full shared scheduler protocol, full Institutional Charter, then this complete relay. The latest canonical checkpoint (`LATEST_CHECKPOINT.md`) still leads with Run 271 dated 2026-11-20; Worker B's newer evidence is in open/draft PR #758 and its child runtime candidate #755. Worker A's #760/#759 and Worker B's #755/#758/#761/#757/#756/#752/#754/#751 branches were observed in the open-PR search; no merge was performed.

**Revalidated authority facts on main:** `docs/authority/founder.pub.json` is exactly `NOT_ENROLLED` (blob `b3e805c2e7233ff866db1aabe004c0859fe7cde1`). `game/server.mjs` imports `loadTrustAnchor` but not `authorizationEvent` (blob `f7cb11031331a8fafe6ab5a6cb3d93992d880cc6`); the live `/api/decisions/choose` handler returns the fail-closed authorization status before decision mutation. `src/authority/decision.js` exports `authorizationEvent` and requires enrolled PRODUCTION trust, signature verification, and durable nonce consumption (blob `136a20739e9a619096443d89d3d8ff3b4053297b`). The in-game GitHub viewer uses GET-only fetches (blob `7094b0756e26d95597c71b7137bab70ecda26a94`). PR #16's self-signing allegation remains superseded by merged PR #18; do not reopen it as the current defect.

**Exact-head CI observed:** #762 `9998e4b192c5fa98a2f0be9810e738857ec32959`: Verify `45978215449` PASS; Genesis `45978215377` PASS; Browser `45978215438` FAIL at the inherited Contradiction Clerk locator in `scripts/verify-browser.py:472`. Its offline-PWA recovery subjourney passed first. #755 `1c3cdeeaa888fac2bead8863b1e4eff4b8c6c64e`: ten hosted workflows PASS (Verify, Genesis, Browser, Quest Board, Synthesis Clerk, Council, Academy, Combat Yard, Source Archive, PWA); Android `45951191102` FAIL. Android assembled the debug APK, then instrumentation failed; captured XML has an empty failure for `publishedSourceObservatoryRestoresNativeBackupThroughPreviewAndAppendWithoutWorldProgress`, while logcat records WebView sandbox-process death and app/instrumentation termination. The captured log does not isolate causality. #761 `a8c39fbac00e2de357546cc9a25a0ff0cba84fda`: Playable World `45972900886`, World Projection `45972900854`, and Full Verify `45972900877` PASS; test response is fixture-supplied, not an LLM call. These are exact-head hosted observations, not physical Android acceptance.

**Challenge and scope decision:** The highest-value end-to-end Founder journey remains blocked by prerequisites that cannot be manufactured by this worker: Founder-controlled platform keystore enrollment/proof of possession, and a separately authorized secure GitHub credential/installation path. Worker B owns #755's game/runtime, Browser and Android paths; do not collide with those files. A production route change that pretends to authorize Founder actions while trust is NOT_ENROLLED would violate the fail-closed contract. PR #762 is documentation-only; its Browser failure is a known inherited test locator, not evidence against the relay itself. The protocol's corresponding source currently contains normal Markdown newlines (the escaped-newline concern seen in an earlier diff is not present in the current branch file).

**Work in this run:** no production source or tests changed; no key, credential, permission, issue, external state, or GitHub write was created. This relay update is a durable evidence/handoff record on the existing #762 branch only. Local checkout, local preflight, and local test execution were unavailable through the current session; no local test pass is claimed. No merge, release, deployment, spending, or authority transition.

**Handoff:** Worker B: diagnose and fix the exact Android instrumentation failure on #755's existing ownership branch; keep Browser/Android evidence separate from physical-device acceptance. Worker A: continue a read-only architecture review of the proposed GitHub adapter/authorization seam, define a fail-closed contract and test matrix without touching Worker B paths, and independently verify the next exact-head CI. Founder-only keystore enrollment and explicit credential/installation authorization remain prerequisites for any production write.

### Relay v1.5 — 2026-11-27 — Run 3 fresh reconciliation and Android crash diagnostics

**Bootstrap and process:** Root `AGENTS.md`, the full shared scheduler protocol, the full Institutional Charter, and this complete relay were read. A preliminary inventory was performed before the mandatory bootstrap was noticed; those observations were discarded and the baseline was restarted after the sequential read. Nested Android instruction files under `android/` through `android/app/src/androidTest/java/labs/nogas/commonground/` were checked and not found. Local checkout/preflight/Gradle execution were unavailable; no local test result is claimed.

**Fresh repository and worker-state reconciliation:** Canonical repository metadata still identifies `main` as default branch and confirms push permission. PR #762 remains draft/open/unmerged at `c7392680e8d66a307677e01dc8341332f0185101`; exact-head Verify `45984477179` and Genesis `45984477225` PASS, Browser `45984477141` FAIL. The Browser failure is the inherited Clerk-location expectation; it is not a relay defect. Separate #747 correction routes the Browser journey to Evidence Archive and its exact-head Browser run `45878004416` PASS on `081d72230fff24bb40aa08862583ec305d7c665f`. PR #755 remains draft/open/unmerged at `1c3cdeeaa888fac2bead8863b1e4eff4b8c6c64e`; its game/Browser/other hosted workflows are recorded above, while Android run `45951191102` is terminal failure. PR #758's documentation child is open/draft at `6031ffa50c99e58ad82a508e3412e236701ae746`; Verify, Genesis, Browser, and Synthesis mobile checks PASS; Android `45951794132` FAIL. Its checkpoint and ledger must be read as proposed branch state, not mainline integration. PR #761 remains a test-supplied response persistence subgate, not live LLM invocation. PRs #756–#759 continue to add negative authorization coverage only; they do not enroll trust or authorize the production route.

**Authority challenge:** PR #16's historical self-signing concern remains superseded by merged #18. The live route blocker is still not solved: Founder trust remains `NOT_ENROLLED`, the game server does not integrate `authorizationEvent`, and the existing game GitHub gate remains GET-only/read-only. No trust, key, or credential operation is permitted or attempted. The in-game write adapter and Founder-controlled enrollment are separate prerequisites.

**Android failure investigation:** On #755 exact head, retrieved Android job `140427014819` for run `45951191102`. APK assembly and artifact preservation succeeded. The instrumentation report says 10 tests, 1 failure, 0 errors, 0 skipped; the failure element for `publishedSourceObservatoryRestoresNativeBackupThroughPreviewAndAppendWithoutWorldProgress` is empty. The runner then reports `Instrumentation run failed due to Process crashed`. Retained logcat shows WebView sandboxed process PID 5760 died, ActivityManager removed the app Activity, and the instrumentation runner was stopped. No Java fatal exception, native signal, or causal stack was captured. Emulator graphics/color-buffer errors were also present, but their temporal proximity is not causal proof. The test's source path was inspected; the failure cannot responsibly be attributed to one of its import/preview/append/export steps from this log alone.

**Work performed:** Created diagnostic child PR [#763](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/763), branch `test/android-source-observatory-crash-breadcrumbs-20261127-run13`, based exactly on #755 head `1c3cdeeaa888fac2bead8863b1e4eff4b8c6c64e`. Commit `c65591dce5e0cc718606343308ccaa7a516d5ffc` changes only `android/app/src/androidTest/java/labs/nogas/commonground/MainActivityTest.java`: adds 18 stage markers around page load, setup, publication, route entry, portal/bridge handshake, import, review, preview, append, export, and final assertions. Assertions and production behavior remain unchanged. Fetched the file back from the branch; confirmed all 18 call sites and the final marker. PR #763 was created draft/open/unmerged.

**Exact-head verification at handoff:** PR #763 runs Verify `45992590801`, Genesis `45992590723`, Browser `45992590781`, and Android `45992590825` were all IN_PROGRESS at last observation. No pass is claimed. The next run must inspect terminal outcomes and Android logs for the last `NGL-RESTORE-DIAG` marker; if the process still crashes, the stage narrows the next diagnostic boundary. Do not weaken the test or infer a cause from graphics warnings.

**No consequential action:** No merge, release, deployment, external publication, GitHub write through the game, Founder approval, trust enrollment, key/credential/permission change, spending, or authority transition. Additional cash cost: $0.

**Handoff:** Worker A owns #763's Android instrumentation diagnosis. Worker B retains #755 runtime/game ownership. Next priority is to use the exact #763 Android result to isolate the renderer/process crash; in parallel, Worker A may continue a read-only, fail-closed architecture review of the Guild Gate write adapter without touching Worker B's active server/game files. Recheck current heads and PR ownership before every edit. Preserve the visual, nontechnical Founder invariant.


### Relay v1.6 — 2026-11-27 — Exact-head diagnostic verification update

**New exact-head evidence:** PR #763 commit `c65591dce5e0cc718606343308ccaa7a516d5ffc`: Verify `45992590801` PASS and Genesis `45992590723` PASS. Browser `45992590781` and Android `45992590825` remained IN_PROGRESS at the latest inspection. The Android job had completed portable preflight, package-manager smoke test, SDK setup, project-state capture, and Gradle setup, and was assembling the debug APK. Do not claim the instrumentation rerun or diagnostic markers have executed until the job reaches the emulator journey and terminal status.

PR #762 relay update commit `cfaa82bd9a9e2a11e682d5cb8ffcdfc5dd54c472`: Genesis `45992780201` PASS; Verify `45992780191` and Browser `45992780207` were IN_PROGRESS at last inspection. The prior exact head's Browser failure remains a stale-head observation. The #747 correction is a separate branch/PR and does not confer a pass on #762.

Authority regression cross-check: PR #759 exact head `a5511db95a49297782a5c2d17c47ac9ee5a330c0` has Verify `45953174476`, Genesis `45953174534`, and Synthesis mobile `45953174489` PASS; Browser `45953174524` and Android `45953174549` FAIL. Its test-only route matrix remains negative coverage, not live authorization. PR #757 exact head `ee2eb15789f72ee76fe6746aca1f9acc17c8de8f` similarly has Verify/Genesis/Synthesis PASS and Browser/Android FAIL. Neither changes the decision to keep production authorization fail-closed while Founder trust is NOT_ENROLLED.


### Relay v1.7 — 2026-11-27 — Daily institutional cycle reconciliation

**Bootstrap and inheritance:** Read canonical main root `AGENTS.md` alone, then the complete shared Ralph protocol, then the full Institutional Charter, in the required sequential order. Read the complete relay from the existing #762 branch before further inspection. Re-read the MMORPG Completion Contract. Read Worker B's #758 checkpoint/ledger branch and Worker A's Run 9 evidence record in #760. The canonical main checkpoint/ledger still expose stale historical Run 271/older Run 260 material; #758 is a newer proposed documentation branch and is not canonical. Local checkout, portable preflight, local tests, and device access were unavailable; no local test result is claimed.

**Fresh repository state:** Repository metadata confirms public, unarchived `ngl-damien/No-Gas-Labs-Alpha-1`, default branch `main`, with push/admin permission. Main baseline remains `21677d88cb027f3d16adacf92dbdd0ec08e96dbd` in the inspected PR bases. PR #755 remains draft/open/unmerged at `1c3cdeeaa888fac2bead8863b1e4eff4b8c6c64e`, 13 paths, 750 additions / 31 deletions. Worker A's Run 9 record confirms exact-head Verify, Genesis, Source Archive, PWA, Council, Academy, Combat Yard, Quest Board, Synthesis, and Browser PASS; Android run `45951191102` FAIL due to instrumentation process crash during renderer-loss testing. This supersedes the stale pending Android wording in older #755/#758 checkpoint text. The two-client SSE test uses distinct sessions against one server process; it is not two distinct-human or multi-instance evidence.

**Diagnostic child:** PR #763 remains draft/open/unmerged at `c65591dce5e0cc718606343308ccaa7a516d5ffc`, one test-only Android instrumentation path with 23 additions and no deletions. It adds `NGL-RESTORE-DIAG` stage markers; assertions and production behavior are unchanged. Exact-head Verify `45992590801` and Genesis `45992590723` were reported PASS in the prior relay entry. Browser/Android were still in progress at the last recorded observation; this cycle did not obtain terminal logs or a last-marker diagnosis. Therefore the renderer crash cause remains UNKNOWN. Do not infer causation from graphics errors.

**Other worker handoff:** Worker A's Run 9 review independently confirms the live authority gap: `authorizationEvent()` uses host-configured trust and durable nonce consumption, but `game/server.mjs` does not import/invoke it; Founder trust remains `NOT_ENROLLED`; the live route is fail-closed. The in-game GitHub viewer remains GET-only/read-only. PR #759 negative route tests do not implement live authorization. Worker B owns #755 game/runtime and Android paths; no competing edits were made. PR #761 is a test-only server-restart persistence subgate: it preserves a test-supplied collaborator response, not live LLM invocation or Android close/reopen acceptance.

**Adjudication:** Highest-value end-to-end objective remains blocked by two independent Founder-controlled/external prerequisites: production Founder trust enrollment with Founder-controlled key custody/proof of possession, and an authorized secure in-game GitHub credential/installation path. No agent may create/enroll a Founder key, bypass the live fail-closed route, or treat ChatGPT's GitHub connection as an Android-game credential. The next safe runtime priority is Worker B's Android crash diagnosis using #763 terminal markers; Worker A may continue read-only architecture review of the write-adapter/authorization seam without touching Worker B-owned paths. The relay itself remains a proposed operating document until #762 is reviewed and merged.

**Acceptance matrix:** No status promoted in this cycle. The physical Android journey, complete Decision Chamber/Decision Stack, live LLM relay, signed Founder decision route, in-game GitHub write-and-verify, and full close/reopen Founder journey remain NOT TESTED or FAILED exactly as recorded in §5. No new PASS is claimed. Hosted CI references above are exact-head observations from prior run records, not tests executed in this cycle.

**No consequential action:** No source/runtime change, issue write through the game, key/credential/permission operation, merge, release, deployment, external publication, spending, Founder approval, trust enrollment, or authority transition occurred. Additional cash cost: $0.

**Next handoff:** Worker A: poll #763 exact-head Browser/Android to terminal state and inspect the last `NGL-RESTORE-DIAG` marker plus crash artifacts; if the Android workflow is still running, do not call it a failure or pass. Worker B: retain ownership of #755 game/runtime and repair only after the exact crash stage is established. Both workers: re-observe live PR heads and checks before acting. Founder-only trust enrollment and separate explicit authorization for any GitHub credential/installation remain untouched prerequisites.


### Relay v1.8 — 2026-11-27 — Durable action replay after process restart

**Bootstrap and continuity:** Root `AGENTS.md`, complete shared scheduler protocol, and Institutional Charter were read sequentially. The full proposed relay was read from #762, followed by the completion contract, #758 checkpoint/ledger branch, and Worker A Run 9 record in #760. The relay is still proposed on draft PR #762, not canonical on main. This run inspected repository state before reading the relay, contrary to relay §2; this is a procedural deviation and is not represented as full compliance. Local checkout/runtime and portable preflight were unavailable.

**Fresh worker evidence:** #763 diagnostic branch exact head `c65591dce5e0cc718606343308ccaa7a516d5ffc` now has Verify `45992590801`, Genesis `45992590723`, Browser `45992590781`, and Android `45992590825` all completed successfully. This is hosted emulator evidence for that diagnostic branch, not physical Moto device acceptance and not proof that every prior renderer failure was causally repaired. #765 exact head `6ab0d2ba7b6a11b8efadc16ae305b04d87c55572` has Verify, Genesis, Browser, Source Archive, and Synthesis mobile PASS; Android `46031852318` FAIL. The failure cause was not inspected in this run and is UNKNOWN. #764 exact head `9d1958a82f88fa09006740de48c7e2f70501a3b8` has Verify, Genesis, and Browser PASS. These are test sub-gates, not full G3.

**Selected gap:** #764 proves two clients can reconnect after a server-process restart; #765 proves concurrent actions and request-ID conflict behavior before restart. Neither test directly exercises the mobile failure mode where an action commits, its response is lost, the server restarts, and the client retries the same request ID. Source inspection of `game/server.mjs` shows the ordinary action route checks persisted events by request ID and action fingerprint, returning the prior action result for an exact actor/action replay and HTTP 409 for a mismatched reuse. This source path warranted an executable restart regression rather than a runtime rewrite.

**Work performed:** Created draft PR [#767](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/767), child of #765, branch `test/restart-idempotency-replay-20261127-run12`, head `60243c6da2403163d071aa6c41f8aa373ce39591`. Added only `test/game-multiplayer-restart-idempotency.test.mjs` (102 lines). It starts the actual game server with a temporary persistent data directory, commits one Commons message using a stable request ID, discards the response, closes/recreates the server, restores the original Witness session cookie, retries the exact request, and asserts original result, one retained event, unchanged event IDs/revision/XP. It then reuses the request ID with altered text and asserts HTTP 409 `IDEMPOTENCY_CONFLICT` with no world-state mutation. The new file was fetched back from GitHub (4,884 bytes; blob `fd9f3371f582ba1d326b5a786ed98f742c31d616`). No production runtime, existing worker-owned test file, package manifest, authority, or canonical game state was changed.

**Exact-head verification:** Genesis `46048769092` completed successfully on #767 head. Verify `46048769085` and Browser `46048769106` were IN_PROGRESS at last observation. No test pass is claimed for the new test until Verify reaches terminal success and its output confirms Node test discovery/execution. Local Node/preflight execution was unavailable. The test is automatically discovered by `node --test`; the explicit portable-preflight target list was left unchanged to avoid modifying #765's active `package.json` ownership.

**Authority and product limits:** No merge, release, deployment, key/credential/permission change, spending, Founder approval, trust enrollment, or authority transition occurred. No APK or physical-device acceptance was produced. The test covers one Commons action and one server process/data directory; it does not prove multi-instance consistency, distinct human participants, or complete G3. The #765 Android failure remains uninvestigated.

**Next handoff:** Worker B: poll #767 exact-head Verify and inspect whether the new test is discovered and passes; repair only a reproduced test or runtime defect. Worker A: inspect #765 Android failure `46031852318` and continue the read-only authority/GitHub-write seam review without touching Worker B's active game/server paths. Both workers: re-observe exact PR heads and checks before relying on these results. Physical Android testing and Founder-controlled trust/credential prerequisites remain separate blockers.


### Relay v1.9 — 2026-11-27 — Exact-head restart-replay verification

PR #767 exact head `60243c6da2403163d071aa6c41f8aa373ce39591` now has Full Verify `46048769085` **PASS** and Genesis `46048769092` **PASS**. The Verify workflow definition was inspected: it runs `npm run verify`, and `scripts/verify.mjs` invokes Node `--test` automatic discovery, so the newly added `test/game-multiplayer-restart-idempotency.test.mjs` is included in the complete test stage. Browser acceptance `46048769106` remained IN_PROGRESS at the latest poll; do not infer a result. The PR description was updated with these exact-head statuses. No local test execution occurred. No merge, runtime change, release, deployment, Founder decision, authority transition, or additional spend.

### Relay v2.0 — 2026-11-27 — Founder Above-and-Beyond enforcement implementation

**Founder direction:** The Neophyte Founder explicitly authorized implementation of an enforceable Above-and-Beyond operating standard. The standard must reduce the Founder's burden, require initiative beyond literal task completion, distinguish compliance from performance, and preserve Founder authority.

**Current worker state revalidated:** PR #762 is the existing continuity-relay proposal; this work extends that proposal rather than creating a competing governance branch. PR #723 contains a separate proposed invariant kernel and is not merged; this run does not duplicate or import its evaluator. Worker B's #767 restart-replay test has Full Verify `46048769085` and Genesis `46048769092` PASS; Browser `46048769106` was IN_PROGRESS at the latest observation. Worker A's #766 steering proposal has Verify and Genesis PASS, Browser FAIL, and Android FAIL; those failures remain distinct and are not attributed to documentation changes. #758 remains a proposed Worker B checkpoint/ledger branch, not canonical main.

**Implementation proposed on this PR branch:**
- Add `docs/operations/NEOPHYTE_FOUNDER_ABOVE_AND_BEYOND_PROTOCOL.md` as the governing behavioral standard.
- Require the protocol in root AGENTS and the shared scheduler sequence.
- Require the relay and Above-and-Beyond protocol to be fingerprinted by portable preflight, with mandatory sections checked fail-closed.
- Add the dedicated Founder Protocol Gate workflow. It runs preflight and governance regression tests, and for new PRs created on or after 2026-11-28 UTC requires a Founder-facing outcome, evidence, limitations, next action, self-audit, and an updated continuity relay.
- Preserve the distinction between an automated check and a required merge gate. A repository administrator must configure the resulting status check as required; this session does not have a supported branch-protection write action.

**Evidence and limitations:** Local checkout, local Node execution, and local preflight were not available through this session. Hosted exact-head CI is required to verify the implementation. The GitHub rulesets read returned an empty array; the branch-protection read returned 403, so legacy protection status is UNKNOWN. No branch protection, credentials, permissions, trust anchors, or Founder decision rights were changed. PR #762 remains proposed until reviewed and merged.

**Founder-facing result:** No user-facing game capability was changed in this run. The proposed institution now has a concrete behavioral standard, a fail-closed preflight requirement, and an automated workflow intended to catch missing governance records. It is not yet canonical or a hard merge block.

**Next handoff:** Recheck PR #762's exact current head and run the hosted Founder Protocol Gate and Full Verify. Inspect every failure on the exact head; do not transfer passes from parent commits. After review/merge, a repository administrator must mark `Founder Protocol Gate / founder-protocol` and the relevant verification check as required on `main`. Then validate a deliberately incomplete new PR and confirm the gate rejects it.

### Relay v2.1 — 2026-11-27 — Founder Protocol Gate negative-path tests

**Work performed:** Extracted the new-pull-request acceptance check into a separately testable validator. The workflow now runs six unit cases covering a complete PR, missing Founder-facing sections, missing continuity update, both failures together, legacy-PR grandfathering, and malformed/missing timestamps. The hosted gate continues to run the portable governance preflight and document regression suite before evaluating PR metadata.

**Purpose of the additional test:** The first Founder Protocol Gate run proved that the workflow and document/preflight checks execute successfully. The original #762 PR predates the 2026-11-28 effective date, so its PR-description enforcement branch was correctly grandfathered. These new unit tests exercise the fail-closed PR-record logic without pretending the legacy PR was a valid new-PR test case.

**Limits:** Unit tests exercise the decision logic with controlled PR data; the GitHub event fetch/diff path is exercised only on an eligible new PR after the effective date. The check remains advisory for merging until a repository administrator marks `Founder Protocol Gate / founder-protocol` as required. No branch-protection change was made.

**Next handoff:** Inspect the new exact-head Founder Protocol Gate and Full Verify results. On the first eligible post-effective-date PR, verify that the workflow obtains the actual PR diff and rejects a deliberately incomplete record before accepting a complete one.

### Relay v2.2 — 2026-11-27 — Repair Founder Protocol Gate test discovery

**Observed failure preserved:** On exact head `9d21cf476c200f67bf2c109c74af1e4c0b5db9cc`, the Founder Protocol Gate's governance preflight regression suite passed 40/40. The next step failed before executing the six new PR-gate cases: `python3 -m unittest test/test_founder_protocol_gate.py -v` attempted to import `test.test_founder_protocol_gate`, but the repository's test directory is not a Python package. This was a test invocation/import-path defect, not a failure of the gate's validation logic. The run therefore did NOT verify the new negative cases.

**Repair applied:** Change the workflow to unittest discovery (`python3 -m unittest discover -s test -p 'test_founder_protocol_gate.py' -v`) and explicitly add the repository root to the test module's import path before importing the validator. Preserve the original failed run as evidence; do not relabel it as passing.

**Verification state:** The repair is committed to the same PR branch. New exact-head Founder Protocol Gate, Full Verify, Browser, Genesis, and Android results are pending; no pass is transferred from the failed prior head.

**Next handoff:** Inspect the new exact-head workflow logs. Require all six PR-gate unit tests to execute and pass, then inspect the remaining exact-head checks. If discovery still fails, repair only the reproduced import/test-runner issue and preserve another dated record.

### Relay v2.3 — 2026-11-27 — Restart-replay acceptance challenged

**Fresh exact-head observation:** PR #767 head `60243c6da2403163d071aa6c41f8aa373ce39591` has Full Verify `46048769085` PASS, Genesis `46048769092` PASS, and Browser `46048769106` PASS. The Browser result has now completed successfully; no parent-head transfer was used.

**Independent source challenge:** Fetched the exact #767 commit diff. Its test comment says the first action response is deliberately discarded, but the test stores and reads `committed.body.result`, revision, XP, and event IDs before restart. The test does demonstrate persisted replay, stable actor identity, no duplicate canonical event, and altered-payload conflict rejection. It does not faithfully model a client that never received the original response. This is a test-coverage/claim-scope gap, not evidence that the runtime idempotency behavior is broken. Recommended correction: never inspect the original POST response; after posting, obtain the baseline only through a separate `/api/state` read, then restart and retry the exact request. Assert the replay result is bound to the retained message/event found in that independent snapshot.

**No collision or mutation:** Worker B owns the active multiplayer restart test path. This run did not edit its test or runtime files, did not create a duplicate branch/PR, and did not merge anything. The finding is handed to Worker B for incorporation into the existing #767 lineage.

**Other boundaries:** no local checkout or local Node execution was available. No Android physical-device test, multi-instance server test, distinct-human proof, live LLM interaction, Founder trust enrollment, GitHub write path, release, or deployment is established by these checks.

**Next:** Worker B should correct the lost-response simulation in #767's existing branch, run exact-head Full Verify/Genesis/Browser, and preserve the original passing head as historical evidence. Worker A continues the separate authority/GitHub adapter review without touching Worker B's active game/server paths.

**Process correction for Relay v2.3:** The relay file was updated before checking its nested instruction paths. Subsequent checks of `docs/AGENTS.md` and `docs/operations/AGENTS.md` returned 404, so no nested instructions were present at those paths, but the required pre-edit order was not followed. Local portable preflight and local tests were unavailable. Procedural compliance for this run is PARTIAL; do not represent the relay update as fully preflighted.


### Relay v2.4 — 2026-11-28 — Complete downstream response-loss test independently verified

**Founder objective inherited:** deliver a real, visual, nontechnical Android Founder journey through the playable world, Decision Chamber, accumulated Founder Decision Stack, live assistant continuity, explicit Founder authorization, supported Guild Gate GitHub operation, independent external verification, and durable close/reopen history. No authority expansion is implied.

**Bootstrap and instructions:** Read root `AGENTS.md`, complete shared scheduler protocol, Institutional Charter, current relay v2.3, and Above-and-Beyond Protocol in the required sequence. Read the MMORPG Completion Contract and current Worker B checkpoint/ledger handoff from PR #758. Nested `docs/AGENTS.md`, `docs/operations/AGENTS.md`, `test/AGENTS.md`, and `game/AGENTS.md` were absent on the inspected branch (GitHub 404). The canonical main checkpoint/ledger remain stale at Run 271; #758 is a proposed, newer Worker B documentation branch, not canonical main. Local checkout, portable preflight, local tests, emulator, and physical Android device were unavailable in this execution; no local/device pass is claimed.

**Current work and ownership:** Re-observed open PRs #769–#772 and the current #762 continuity branch. Worker B owns the multiplayer restart/response-loss test lineage. PR #772 adds only `test/game-multiplayer-total-response-loss.test.mjs`; it does not edit runtime or Worker A's authority paths. The prior #767 v2.3 relay challenge correctly identified that #767's first response was discarded only by the test helper, while the test still inspected the response body. #772 is a separate child of #767 and corrects that coverage gap rather than editing Worker B's owned #767 test file.

**Exact test observation:** Fetched the full #772 test from branch `test/multiplayer-total-response-loss-20261127-run9` and inspected its source. The proxy forwards the request with the original opaque session cookie, waits for upstream completion, consumes the complete upstream body, then destroys the downstream socket without forwarding status or headers. It asserts the client sees a transport error and the proxy observed upstream status 200. A separate state request locates the retained event by request ID and verifies actor identity, one event, one revision increment, and no XP. The test restarts the server against the same data directory, restores the same actor via the opaque cookie, retries the exact request, and checks unchanged revision/event IDs/XP and the original message identity. Altered payload reuse must return 409 `IDEMPOTENCY_CONFLICT` with no state mutation. This source-level inspection supports the test's intended semantics; it is not itself a local test execution.

**Exact-commit hosted verification:** Commit `eb53b5bbd0340e56f801a36c0c42a3ce45acd67b` has Full Verify `46096952199` PASS, Genesis Evidence Invariant `46096952244` PASS, and Browser Acceptance `46096952220` PASS. Full Verify's world-projection job `140830395169` completed successfully, including the combined test/package/bounded institutional exercise step, portable preflight receipt, and diagnostics preservation. These are exact-commit hosted results. No Android workflow result was returned for this commit; Android acceptance is not inferred.

**Interpretation and limits:** This materially improves the restart/idempotency evidence over #767 by modelling total loss of the HTTP response, not merely discarding its body after headers. It demonstrates a single-server-process, single-durable-directory test scenario only. It does not prove multi-instance locking/consistency, two distinct humans, physical Android operation, a complete playable journey, Founder trust enrollment, live LLM collaboration, GitHub write capability, or complete G3. PR #772 remains a proposal; no merge, release, deployment, credential change, authority transition, external publication, or spending occurred.

**Acceptance matrix:** No Founder journey status is promoted. Physical Android install/launch, Decision Chamber, accumulated Decision Stack, live LLM relay, provenance review, durable Founder decision journey, in-game GitHub write-and-verify, and complete Founder acceptance remain NOT TESTED or FAILED as recorded in §5. The exact PR #772 hosted checks are technical subgate evidence only.

**Fluency concept:** `Fault injection` is established reliability-engineering terminology: deliberately introduce a controlled failure (here, dropping the entire downstream HTTP response) to observe recovery behavior. Plain English: make the phone lose the whole reply after the server has done the work. Technical: a proxy terminates the downstream connection after consuming the upstream response, then a restart/retry verifies idempotent replay against durable state. Skeptical defense: a test description is not enough; inspect the proxy code, the exact commit's test run, and the post-restart state assertions. Exercise: distinguish “response body lost” from “no HTTP response received at all.”

**Next highest-value action:** Worker B should retain ownership and reconcile #772's exact-head checks with any subsequent branch changes; pursue multi-instance behavior only after a shared-storage/locking design is implemented and independently tested. Worker A should continue the separate, read-only Founder authorization/GitHub adapter review without touching Worker B's active game/server/test paths. Founder-controlled trust enrollment and any in-game credential/installation decision remain separate Founder-only prerequisites.

**Compliance vs performance:** Manual bootstrap and source/hosted evidence review completed; local portable preflight and local execution unavailable, so procedural compliance is PARTIAL. Performance: one material test-coverage gap is corrected in a separate Worker B proposal and exact-commit hosted checks pass; no Founder-facing capability was delivered in this cycle.

**Six-standard self-audit:** Relevance—directly advances mobile resilience and multiplayer durability. Initiative—challenged the prior lost-response claim against source and identified the exact coverage distinction. Execution—no code changes made because Worker B owns the path; current relay updated to preserve the finding. Verification—test source, commit, and exact hosted runs inspected. Leverage—gives the next worker a concrete, already-tested response-loss subgate. Continuity—records exact refs, boundaries, missing Android evidence, and next action.

**No consequential action:** No merge, release, deployment, spending, external publication, Founder approval, key/credential/permission change, trust enrollment, or authority transition. Additional cash cost: $0.
