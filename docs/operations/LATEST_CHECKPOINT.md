# Latest Checkpoint — Run 321

Date: 2026-11-22

## Candidate and branch state

- Runtime PR: [#718](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/718), draft and unmerged.
- Runtime branch: `feat/evidence-archive-visible-stream-order-20261120-run272`.
- Exact runtime/test head: `aa26bb0eaf460574aeb5dc2512be37ac4a037c94`.
- Main base: `0d950c501cf128d828ae4f263cc05a9013d7e8c1`.
- PR delta: 405 commits ahead, 0 behind; 48 changed paths.
- Documentation child: [#722](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/722), kept separate from runtime source and tests.

## Run 321 implementation

The R&D Quest Board had a causal-order defect: the event reducer, persisted-history validator, `projectResearchRecords`, and Character Sheet already used retained append positions, but the Quest Trail repeated timestamp-based proposal/report/evidence/challenge checks. A regressed service clock could therefore leave a valid retained experiment chain visible in Character Sheet while suppressing its Quest Board objectives.

The Quest Trail now consumes one shared, fail-closed `projectResearchRecords` projection for:
- unique Moonshot proposals;
- experiment reports linked to an earlier proposal;
- reports whose exact evidence version has one earlier retained publication;
- cross-actor challenges linked to an earlier report;
- original-report-author responses linked to the exact earlier challenge;
- Source Archive predicate/challenge/response records and synthesis source links.

The projection is shared with Character Sheet rather than duplicated. Retained event position orders the chain; strict UTC timestamps remain required metadata, not causal ordering. A challenge may omit optional evidence; if it supplies evidence, the exact retained version must be linked. Ambiguous, malformed, duplicate, or reordered records remain history but do not advance the objective/skill projection.

## Test-first evidence

- [Test-first commit 5a7612c](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/commit/5a7612c91df3f78557006fb2c8f3dc8ea7bc205c) added a synthetic chain whose strict timestamps descend across publication → proposal → report → witness challenge → original-author response. Full Verify [45082844594](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/45082844594) reproduced the Quest Trail defect: 1,520 passed, 1 failed.
- The first runtime patch exposed a test-fixture omission: the challenge artifact needed an explicit SHA-256 receipt. The fixture was corrected in [1bb57a9](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/commit/1bb57a9f1bdddf9892fd9a60fd67ffccbf43c400).
- Refactoring to the shared projection initially excluded evidence-free challenges; the filter was corrected to preserve the established optional-evidence contract while requiring a valid exact link whenever evidence is supplied.
- Final runtime head: `aa26bb0eaf460574aeb5dc2512be37ac4a037c94`.

## Exact-head verification

- Full Verify [45083562119](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/45083562119): PASS. Hosted preflight `ready`, warnings 0, failures 0; Node tests exit 0; Python inspector exit 0; PWA package build exit 0; institutional exercise exit 0; report `passed=true`.
- Genesis Evidence Invariant [45083562116](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/45083562116): PASS.
- PWA build [45083562027](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/45083562027): PASS; deployment skipped.
- Combat Yard [45083562082](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/45083562082): PASS.
- Council Chamber [45083562011](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/45083562011): PASS.
- Academy Study Shelf [45083562269](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/45083562269): PASS.
- Live Source Archive [45083562177](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/45083562177): initial live GitHub fetch returned 502; retry of the failed job PASS.
- Browser acceptance [45083562007](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/45083562007): FAIL in Worker A-owned `scripts/verify-browser.py:254`. Actual nearby institution `guild_hall`; visible action `Enter Guild Hall`; obsolete hidden expectation `Enter Forge`. Handoff: [PR #472 comment](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/472#issuecomment-7087652740).
- Quest Board [45083562159](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/45083562159), Synthesis Clerk [45083561999](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/45083561999), and Android [45083562060](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/45083562060) were IN_PROGRESS at checkpoint preparation. Android had passed preflight, SDK/Gradle setup, project-state snapshot and debug APK assembly; offline-world emulator/JUnit was not terminal.

## Donor and authority boundaries

- RAE evidence bridge: binds imported report to pinned APK digest and byte length; it does not independently re-extract report truth.
- Relay `CaseStore`: append-only parent-linked hashed artifacts. `MethodologyEngine` is prompt/context scaffolding, not a production multi-agent orchestrator.
- Mesh proof-package prototype: distinguishes buyer interest, accepted delivery and payment with evidence-backed transitions.
- Command Center remains reference material; no RuneUX/TownSquare/AGP executable donor integration was identified in this recovered-tree pass.
- No donor code was copied. The implementation reuses Alpha-1's own retained-event research projection.
- No model/NPC/UI can create canonical evidence, truth, XP, approval, authority or success. The new projection only credits structurally valid retained activity; it does not validate the truth of a reported experiment.

## Process and authority

- Root `AGENTS.md`, shared hourly protocol, Institutional Charter, vendor instruction pointers, completion contract and world-projection contract were inspected; no nested `AGENTS.md` was found under the touched `game`, `test`, or `docs` directories.
- Both authorized Desktop Commander devices were Offline. No local pre-edit receipt or local Node/Playwright/Gradle run was possible. Hosted exact-head preflight passed after edits; procedural compliance remains PARTIAL.
- G0–G8: IN_PROGRESS. G9: NOT_STARTED. Founder trust: NOT_ENROLLED.
- No merge, release, deployment, Founder approval, truth verdict or authority transition occurred.

## Next execution

1. Obtain terminal Quest Board and Synthesis mobile acceptance results and inspect their artifacts.
2. Obtain terminal Android emulator/JUnit evidence; no physical-device result or release APK is claimed.
3. Resolve the Browser helper mismatch through Worker A without editing Worker A-owned paths or weakening explicit interaction.
4. Reconcile the 405-commit runtime stack against main path-by-path before any integration decision.

## Prior checkpoint history

The prior Run 320 checkpoint is preserved byte-for-byte at [`checkpoint-history/through-run-320.md`](checkpoint-history/through-run-320.md) (original Git blob SHA `85c73cce8f320136315b41a77d41b1be1e9af419`, 1049713 bytes).