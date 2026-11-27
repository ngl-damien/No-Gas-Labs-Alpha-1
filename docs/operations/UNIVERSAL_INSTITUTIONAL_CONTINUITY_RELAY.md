# Universal No_Gas_Labs™ Institutional Continuity Relay Harness

**Status:** Proposed canonical operating record and handoff mechanism  
**Proposed canonical path:** `docs/operations/UNIVERSAL_INSTITUTIONAL_CONTINUITY_RELAY.md`  
**Initial record:** Relay v1 · 2026-11-27
**Latest revision:** Relay v1.1 · 2026-11-27  
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
5. Read the latest durable checkpoint and the most recent relevant handoff from other active workers.
6. Only then inspect current repository state, branches, PRs, issues, workflows, source, tests, environments, or artifacts.
7. Revalidate inherited claims against current authoritative evidence before relying on them.
8. Before handoff or session end, update the current-state section and append a new dated relay-log entry.

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
- Do not generate, custody, enroll, export, or provision a Founder private key. Founder trust enrollment requires a Founder-controlled platform keystore, proof of possession, independent custody verification, and a separate explicit Founder decision.

## 7. Operating and coordination rules

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

## 8. Required update format

At the end of each execution cycle, update the **Current relay state** below and append one entry under **Append-only relay log**.

The current state is a concise index to the latest verified facts. The log preserves historical handoffs. Do not delete earlier entries; correct an error by adding a dated correction that identifies the superseded claim and its evidence.

### Current relay state

- **Relay version:** 1.1
- **Last updated:** 2026-11-27
- **Last agent:** ChatGPT execution agent — continuity relay establishment and repository handoff.
- **Objective:** Founder-controlled, visual Android Decision Chamber → assistant continuity → explicit authorization → real GitHub state change → independent verification → close/reopen persistence.
- **Current blocker:** The live Founder decision route is fail-closed; Founder trust is NOT_ENROLLED; the in-game GitHub gate is read-only and no in-game write adapter/credential flow is evidenced.
- **Continuity relay implementation:** Proposed in draft PR [#762](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/762), branch `docs/universal-institutional-continuity-relay-20261127`, exact head `dcc6a0b4d7127c395e7d843c6f6783be86056a1c`. It adds this relay and makes reading/updating it mandatory in root AGENTS and the shared scheduler protocol. It is not canonical until reviewed and merged.
- **PR #762 exact-head checks:** Verify `45977508493` PASS; World Projection `45977508426` IN_PROGRESS; Playable World `45977508467` IN_PROGRESS. No aggregate pass is claimed while checks remain pending.
- **PR #755 exact-head observation:** `1c3cdeeaa888fac2bead8863b1e4eff4b8c6c64e`; 10 check runs PASS, one deploy job SKIPPED, and Android emulator acceptance `45951191102` remains IN_PROGRESS; combined status PENDING. Do not transfer results from its earlier parent head.
- **PR #761 exact-head observation:** `a8c39fbac00e2de357546cc9a25a0ff0cba84fda`; Playable World `45972900886`, World Projection `45972900854`, and Full Verify `45972900877` PASS. This is a server-restart collaborator-response subgate only; the response is test-supplied, not a live LLM interaction.
- **Active implementation owner:** Worker B for game/runtime; Worker A for cross-cutting authority review. Do not edit Worker B's active server/game paths concurrently.
- **Next recommended action:** Worker B and Worker A coordinate a bounded, game-native first slice: implement the GitHub write adapter and exact signed authorization boundary without bypassing the Founder trust prerequisite. Keep the first write narrowly scoped (candidate: create one issue in the canonical repository) and verify it by independently retrieving the created issue. Do not attempt production execution until authorization and credential prerequisites are met.

## 9. Append-only relay log

### Relay v1 — 2026-11-27 — Initial institutional handoff

**What was inherited and read:** root AGENTS, shared scheduler protocol, Institutional Charter, main checkpoint Run 271, current Worker B checkpoint PR #758, Worker A Run 9/Run 10 evidence in PR #760, and the current MMORPG completion contract and World Projection Contract.

**What was freshly verified:** canonical main SHA; active PR heads and roles listed above; Founder trust file is NOT_ENROLLED; live server does not import or invoke `authorizationEvent`; server status helper keeps all live Founder dispositions unavailable; GitHub Decision Gate uses public GET-only requests and explicitly identifies itself as read-only.

**What was not done:** no production source changes; no GitHub issue creation from the game; no key generation or trust enrollment; no merge, deployment, release, external publication, credential/permission change, or spending. No physical Android device acceptance or live LLM-to-NPC continuity was tested.

**Recommended handoff:** Worker B owns the next game/runtime vertical slice. Worker A should coordinate the authority integration review and ensure the signed route remains fail-closed until Founder-controlled trust enrollment is separately completed. The Founder-only enrollment prerequisite must be presented as a future, understandable in-game setup journey, not as a technical task dumped on the Founder.


### Relay v1.1 — 2026-11-27 — First execution handoff

**Work performed:** Created draft PR [#762](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/762) from canonical main. Added this continuity relay, updated root `AGENTS.md` to require it before further review/work, and updated the shared scheduler protocol to require reading and updating it on every execution cycle.

**Exact proposed head:** `dcc6a0b4d7127c395e7d843c6f6783be86056a1c`. Three changed files; 181 additions / 21 deletions. The relay file, updated AGENTS, and updated protocol were fetched back from the exact branch and checked for the required bootstrap, mandatory read, and handoff/update clauses.

**Verification:** Full Verify `45977508493` PASS. World Projection `45977508426` and Playable World `45977508467` were still IN_PROGRESS at the last check. No full CI pass is claimed. No local checkout or local test execution was available. PR #762 remains draft/open/unmerged; it is not yet the canonical relay.

**Fresh state reconciliation:** PR #755 exact head `1c3cdeeaa888fac2bead8863b1e4eff4b8c6c64e` has ten successful check runs, one skipped deploy job, and Android emulator acceptance `45951191102` still IN_PROGRESS; combined status PENDING. PR #761 exact head `a8c39fbac00e2de357546cc9a25a0ff0cba84fda` has Playable World, World Projection, and Full Verify all PASS, but its test-supplied response is not live LLM communication.

**No consequential action:** No runtime source change, GitHub issue write through the game, key generation/enrollment, merge, release, deployment, spending, credential/permission change, external publication, or Founder authority transition occurred.

**Handoff:** The next runtime implementation belongs to Worker B. Worker A owns cross-cutting authority review. Re-observe both active branches before touching shared paths. The live Founder disposition route remains fail-closed, Founder trust remains NOT_ENROLLED, and the existing in-game GitHub gate remains read-only. The next meaningful product proof is one visually authorized in-game Guild Gate action that creates a narrowly scoped GitHub issue and independently verifies it, but only after the authorization and in-game credential boundaries are implemented and Founder-authorized.
