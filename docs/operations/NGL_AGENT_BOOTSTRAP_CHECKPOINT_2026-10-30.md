# Durable Checkpoint — Universal Agent Bootstrap
**Recorded:** 2026-10-30 UTC  
**Repository:** ngl-damien/No-Gas-Labs-Alpha-1  
**Branch:** ops/universal-agent-loop-bootstrap-20261030  
**State:** Draft PR #229 open; not merged; no release or deployment.

## Objective

Establish a provider-agnostic, compute-bounded operating contract so any capable agent entering an NGL repository can rehydrate institutional state, identify unowned high-value work, execute and verify improvements, preserve receipts and handoffs, and repeat while its actual execution budget and permissions permit.

## Baseline and instruction provenance

- Base branch main: 7d8c77367f6acb2d85e35cd9a195797555d1ac7d.
- Root AGENTS.md read from main, blob c94f9cf4d922699908971a00a9a502cd179187b9.
- Canonical shared protocol read in full, blob a1bd788885865c887ae0fc64b1718c30ce040556.
- Latest preceding institutional checkpoint: PR #210 branch audit/repository-stutter-step-checkpoint-2026-10-30, head edfc7bae9d7a4f55b426741b693b32c947181f3f; latest handoff comment #6533064512.
- Applicable nested instruction paths checked for docs, docs/operations, scripts, test, .github, and .github/workflows; no nested AGENTS.md files were present on main.
- Existing gameplay work inspected: PR #227 (Questkeeper/Moonshot work) and parallel PR #226. No gameplay files were changed in this bootstrap task.

## Work implemented on this branch

- Universal operating contract: docs/operations/NGL_UNIVERSAL_AGENT_OPERATING_CONTRACT.md.
- Root AGENTS.md and shared RALPH protocol now specify scoped preflight and provider-agnostic compute-bounded repetition.
- scripts/validate-agent-governance.mjs provides a fail-closed preflight with SHA-256 fingerprints for root instructions, shared protocol, all four required vendor pointers, applicable nested AGENTS.md files, and a caller-supplied checkpoint.
- The preflight rejects unsafe repository-relative paths, target/instruction symlink escapes, missing or invalid vendor pointers, missing checkpoint for scoped work, remote protocol URLs without a locally pinned copy, receipt overwrites, and receipt directories that escape through symlinks.
- package.json exposes npm run agent:preflight for interactive use and agent:preflight:ci for a target-scoped CI run.
- npm run verify now executes the scoped preflight against the governance contract, protocol, checkpoint, package manifest, implementation, and tests before the existing verification suite.
- test/agent-governance.test.mjs contains 12 focused tests covering successful scope discovery, checkpoint requirement, traversal, missing protocol, vendor pointer failures, receipt persistence/non-overwrite, instruction and target symlink escapes, pinned remote protocol handling, and receipt-directory symlink protection.
- A durable checkpoint is present at docs/operations/NGL_AGENT_BOOTSTRAP_CHECKPOINT_2026-10-30.md and is passed into the CI preflight.

## Current branch and verification

- Branch head immediately before this checkpoint refresh: a2751d82b677eaf8fb94c0d9135a8c70ca24e7a3 (23 commits ahead of main, 0 behind).
- At the prior head 861932caec73aade501aff21999bd14ae046bd15, Verify run 41129076320 passed. Logs show root-only preflight status ready, Node test command exit 0, Python inspector tests exit 0, package build exit 0, and institutional exercise exit 0 with passed=true.
- At that same prior head, Genesis Evidence Invariant run 41129077059 passed.
- Browser Acceptance run 41129076160 was still in progress at checkpoint refresh; do not infer its result.
- New exact-head CI runs for a2751d82b677eaf8fb94c0d9135a8c70ca24e7a3 were queued/pending: Verify 41129468695, Browser Acceptance 41129468766, Genesis Evidence Invariant 41129468870.
- The new Verify run is intended to exercise scoped preflight against this checkpoint and every governance target, not merely root-only mode. Do not call this verified until its exact-head logs confirm the scoped receipt and success.
- No local test execution is claimed.

## Cross-repository discovery

The installed-repository search returned 32 candidate repositories. Seven root AGENTS.md files were successfully read in the initial sample; several other content lookups returned 404 and are not yet distinguished between missing instruction files and inaccessible repositories.

Three additional repositories already have agent-governance work on separate branches, so do not duplicate or overwrite it:
- no-gas-labs-command-center: operations/agent-governance-2026-10-30, 6 commits ahead and 1 behind main; no open PR.
- ngl-mesh: operations/agent-governance-2026-10-30, 7 commits ahead and 1 behind main; no open PR. Open PRs #3 and #1 contain separate Relay/security work.
- no-gas-labs-monorepo: operations/agent-governance-2026-10-30, 5 commits ahead and 1 behind main; no open PR.

Their main branches already expose agent-governance workflows and root AGENTS.md files. Reconcile existing branches before further cross-repository rollout.

## Outstanding work

1. Verify the new exact-head CI run, especially that Verify executes scoped preflight and writes its JSON receipt successfully.
2. Update this checkpoint with exact-head CI evidence after all relevant checks finish.
3. Reconcile the three existing agent-governance branches; do not overwrite their work.
4. Roll out the portable preflight and standard vendor pointers to other eligible NGL repositories after reading each repository's instructions and local continuity requirements.
5. Create and maintain the NGL repository portfolio/work-claim registry. It is not yet implemented.
6. Keep PR #229 draft and unmerged until Founder review. No merge, release, deployment, credentials/permissions changes, branch deletion, spending, or external publication is authorized by this checkpoint.

## Important limitation

This contract tells an invoked agent to continue iterating for as much useful compute as its host session permits. It does not create compute, start an agent by itself, or keep a model running after its host session ends.


## Delivery-governance correction — 2026-10-30

### Why this was added

The initial protocol described the shared institution/game objective but did not define a testable MMORPG completion standard. That left room for repeated governance, reliability, and isolated feature work to look like progress without demonstrating that the product was approaching a complete MMORPG.

### Changes on this branch

- Root `AGENTS.md` now explicitly requires sequential bootstrap: root instructions alone as the first repository operation, the complete canonical protocol alone as the second, and no repository inventory until both reads finish. Pre-read observations must be discarded.
- `scripts/validate-agent-governance.mjs` now fails preflight if the sequential-bootstrap markers or MMORPG completion section are removed.
- `test/agent-governance.test.mjs` adds a regression proving preflight blocks when the sequential bootstrap requirement is removed.
- `docs/operations/MMORPG_COMPLETION_CONTRACT.md` defines product stages and mandatory G0–G9 gates: product definition, coherent playable loop, persistence, authoritative multiplayer, core RPG systems, social/economic systems, repeatable world/content, Android-first device experience, operational readiness, and release/Founder acceptance.
- `docs/operations/MMORPG_COMPLETION_LEDGER.md` starts each gate at **NOT ASSESSED**. This means the required audit has not yet been completed; it does not claim the capability is absent.
- The shared protocol and universal contract now require Worker B to maintain the evidence ledger, prioritize the highest unblocked player-capability gate, distinguish current-main from proposed-branch evidence, and avoid letting infrastructure-only work displace gameplay indefinitely.
- `package.json` adds both completion documents to the scoped CI preflight targets.

### Other-worker result inspected

Latest observed Worker B result at this checkpoint: PR #211, branch `game/contradiction-clerk-version-receipts-20261030`, exact head `961921e72c521c1df000c38cbf32fcc83d51981a`. Its PR description reports successful exact-head Verify run **41131527105**, Genesis Evidence Invariant run **41131527033**, and Browser Acceptance run **41131527101** (12/12 journeys). The change improves the Contradiction Clerk's binding of review reports to exact retained artifact-version receipts. It does not establish MMORPG completion, provider execution, adjudication, or physical Android-device testing.

Also inspected PR #227 (Questkeeper + snapshot-safe reads + Moonshot flow), whose description reports exact-head Verify **41123352167**, Genesis **41123352194**, and Browser Acceptance **41123352239** (13/13 journeys). PR #226 is a parallel older Questkeeper repair stacked on #207; #227 explicitly selects #207's implementation rather than combining both. These are proposed branches, not integrated mainline capabilities.

### Governance collision and disposition

- PR #228 separately proposes the sequential-bootstrap correction on `AGENTS.md` and `scripts/validate-agent-governance.mjs`.
- This branch now carries the same required sequential bootstrap plus additional completion-gate enforcement in those paths. PR #228 remains open and must be reconciled as superseded/overlapping before merge; do not merge both blindly.
- PR #229 remains draft/open. No PR was merged, no branch deleted, and no deployment, release, key/credential/permission change, spending, or external publication occurred.

### Verification state and limits

- GitHub contents API accepted the sequential edits on this branch. This is evidence of committed source changes, not test success.
- Exact-head hosted checks for the resulting branch have not yet been observed. The new preflight regression, existing 12 tests, full verification, Genesis invariant, and browser acceptance remain pending exact-head CI.
- No local clone/test execution or physical Android-device testing is claimed.
- The completion ledger is intentionally unassessed pending Worker B's source-backed audit of current `main` and active game PRs.

### Handoff to Worker B — game delivery

1. Read the completion contract and ledger before the next game change.
2. Audit current `main` separately from open/stacked game PRs. Populate ledger rows only with exact source refs and test evidence; mark proposed work separately.
3. Identify the highest unblocked release gate and deliver one coherent player-facing capability with end-to-end tests.
4. Demonstrate authoritative multiplayer with two independent clients before marking G3 beyond implemented/tested.
5. Distinguish PWA/browser evidence from native Android package and physical-device evidence.
6. Do not claim feature-complete, release-ready, accepted, or released until the corresponding gates and Founder boundary are satisfied.

### Next actions

1. Inspect the exact resulting PR #229 head and wait for all three exact-head workflows; inspect logs and repair any attributable failure.
2. Reconcile PR #228's overlapping governance change; do not merge either proposal without full diff/base review and explicit Founder authorization.
3. Worker B: perform the G0–G9 baseline audit and maintain the ledger while continuing the highest-value game delivery work.
4. Worker A: resume institution-wide reliability work only after checking the new ledger for cross-cutting blockers; do not duplicate Worker B's game implementation.


## Repository Stutter-Step run — 2026-10-31 UTC (Worker A)

### Rehydration and fresh evidence

- Read current Alpha-1 root `AGENTS.md` alone first, then the complete canonical shared protocol alone second. Read the current MMORPG completion contract, ledger, and durable bootstrap checkpoint. The connector-only session had no repository checkout, so local `npm run agent:preflight` and local tests were unavailable; no local receipt or test pass is claimed.
- Current Alpha-1 `main`: `93bc9157dca95f7d4f552a88e8570823b30c11aa`. Exact-main hosted workflows passed: Verify run **41173616029**, Genesis Evidence Invariant **41173616027**, Browser Acceptance **41173616025**.
- Latest Worker B automation result inspected (run `7776c93b-4a94-8326-a1f5-386419d27efc`): PR #243 head `fbf9b01c61f291db8abd2cf774df06dfea12ece9`, stacked on PR #227 head `4f7b2f97cf2b5d2f109822bfb70207ffdd57132b`; Verify **41192699576**, Genesis **41192699661**, Browser Acceptance **41192699569** all passed, with 15/15 browser journeys. PR #243 changes server/client/social and tests, not `game/service-store.mjs`. Worker B's next player-facing target is the in-world Guild Hall expedition board; no duplicate gameplay implementation was started.
- PR #244 is the current-main transplant for helper-level Founder decision sealing/context binding, draft and unmerged at `90d9a04bf28bcd641dc4e2c6fa287b9f534774d9`; its exact-head Verify **41192611281**, Genesis **41192611309**, and Browser Acceptance **41192611368** passed. It is not live `game/server.mjs` integration and does not establish real Founder identity/key custody.
- The original PR #16 is closed unmerged; PR #18 is merged as `213f3b5c7771da24b36f9ce6ebdde871d22e4602`. Current-main source still pins `NGL_FOUNDER_KEY_FINGERPRINT` at module import and rejects caller-selected fingerprints. Issue #17 remains open for separately controlled Founder key custody, concurrency/crash recovery, and live integration. Do not reimplement the already-integrated PR #16 fix.
- Nested `game/AGENTS.md` and `test/AGENTS.md` probes returned 404 on the selected base branch. No edits were made under `.github`.

### Ranked objective and challenge

1. **Selected:** fail closed in the standalone service-store when current-user ownership cannot be established. Current `game/service-store.mjs` had three conditional checks that silently skipped ownership comparison when `process.getuid` was absent: data-directory ownership, persisted-envelope path ownership, and opened-file descriptor ownership. This remains distinct from Worker B's server-level check in PR #243.
2. **Not duplicated:** PR #244 owns the active sealed Founder-decision helper transplant; PR #241 owns offline signer and lock-inspector UID hardening. Both are separate active branches.
3. **Not duplicated:** Worker B owns the Guild Hall expedition board and the active PR #227/#243 gameplay stack.

Immediately before editing, rechecked main, PR #243/#227, PR #244, and the changed-file lists. Neither PR #243 nor PR #244 changes `game/service-store.mjs`; PR #241 does not change that file either. The new branch is based on PR #244 so its improved byte-exact scoped preflight can verify this target. PR #241 and PR #244 both independently modify `package.json` and `test/agent-governance.test.mjs`; consolidate their preflight-target additions before any future merge.

### Implementation on a safe dependent branch

- Branch: `security/service-store-owner-verification-20261031`
- Base: PR #244 head `90d9a04bf28bcd641dc4e2c6fa287b9f534774d9` (itself based on current main).
- Source commit: `2219c197bd9983b774e8d3b091841be6efefa7cb` — add a fail-closed UID verifier; missing, throwing, or invalid UID lookup now raises structured errors rather than skipping owner checks. Apply it to directory, persisted-envelope path, and opened descriptor ownership checks.
- Regression commit: `e8ece9a73d93a192035170d99ff8122dfe919e14` — add child-process tests for unavailable/throwing/invalid UID and failures at persisted-envelope path/descriptor checks.
- Fixture correction: `7f1bdbfe53cd384cbcec30d7b29c368f644d43e9` — correct the newline written to child-process preload modules after source review.
- Scoped preflight commit: `2188027b7e5e50fd2d841763f1f1005331c4cdc5` — include `game/service-store.mjs` and `test/service-store-durability.test.mjs` in `agent:preflight:ci`.
- Governance regression commit: `14daaca81be0c34f18343eec35798e46719179c6` — require both paths to remain in the scoped preflight list.
- Changed paths: `game/service-store.mjs`, `test/service-store-durability.test.mjs`, `package.json`, `test/agent-governance.test.mjs`.
- Compare before this checkpoint append: 5 commits ahead / 0 behind PR #244 base. No force update or branch deletion.

### Verification, risks, and limits

- No local test or local portable-preflight execution is claimed. The PR will trigger hosted Verify, Genesis Evidence Invariant, and Browser Acceptance; report only exact-head results after observing them.
- The tests exercise fail-closed startup before lock publication and release of an acquired writer lock when later owner verification fails. A passing test proves only those paths; it does not eliminate filesystem TOCTOU risks.
- Standard Windows Node lacks `process.getuid`; this store now intentionally fails closed there until an ACL-aware owner verifier is implemented. This is a compatibility limitation, not a Windows test result.
- Existing symlink/path checks remain best-effort, not an atomic `openat` boundary.
- No key material was read/generated/enrolled. No merge, release, deployment, external publication, spending, credential/permission change, or branch deletion occurred.

### Linked-repository recheck

- Command Center main remains `28a131ca0448c4fdd11b196ae6e2ae4549274698`. Draft PR #5 keeps the high-severity audit fail-closed and uploads machine-readable JSON; exact-head CI run **41190656532** failed only at the audit gate as intended. Its artifact reports 167 vulnerabilities: 5 critical, 56 high, 92 moderate, 14 low. No lockfile was changed because a real patched pnpm/lockfile regeneration environment was unavailable; do not hand-edit lockfile integrity data. Draft PR #3's dev API proxy/capability-health changes passed exact-head CI run **41192204493** (build), **41192204561** (build/test), and **41192204489** (security scan); it remains a worker-owned PR with older base ancestry.
- ngl-mesh main remains `b4d17f38fab4a38cfd23bd17ef33016c844a63c1`. PR #1 operator-key/durable-marker checks and PR #3 strict UTF-8 report-import checks passed on their exact heads. The recovered-source archive, reference APK, and RAE report remain unavailable; full bridge/APK rebuild and device validation are not established. No Mesh source was changed.

### Next actions

1. Finish this dependent PR's exact-head hosted Verify/preflight, Genesis, and Browser checks; fix attributable failures and re-inspect the final diff.
2. Keep this PR draft/unmerged. Reconcile the overlapping preflight path lists in PR #241 and PR #244 before any integration.
3. Worker B: continue the Guild Hall expedition-board capability on its existing game stack; keep the G0–G9 ledger distinct between current main and proposed branches.
4. Worker A: after this PR's checks, inspect the service-store and server owner-verification boundaries together for any remaining independent fail-open paths; do not invent an ACL-based Windows verifier.
5. Command Center: regenerate the dependency lockfile with a real patched pnpm toolchain, then rerun frozen install/tests/build/audit. Mesh: resume full integration only when the missing recovered archive, reference APK, and RAE report are supplied.


### Additional negative-path refinement — 2026-10-31 UTC

After the first hosted Verify/Genesis passes, a review of the UID helper found two branches that deserved direct regression coverage: a throwing `process.getuid` property getter and a valid-but-mismatched current UID. Added both child-process cases in commit `451049ac6606a9660a46bc7ab329737ff652e7d1`. The directory-startup matrix now covers missing UID, throwing getter, throwing function, invalid UID, and mismatched UID; the persisted-envelope matrix still injects failure before path ownership comparison and after descriptor open, checking that the writer lock is released. The new commit invalidates the earlier exact-head CI results; rerun all three workflows on the updated PR head before reporting final verification.
