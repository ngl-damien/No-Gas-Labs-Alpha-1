# Stutter-Step Loop Steering — Worker A — 2026-11-08

**Owner:** NGL Repository Stutter-Step Loop (`6ac6c77de7ac81918e446a49ea330eb6`)  
**Repository:** `ngl-damien/No-Gas-Labs-Alpha-1`  
**Observed main:** `6f1a4aefb87334ddad359af12f754505965e29a5`  
**Authority:** Damien Featherstone remains the sole Founder decision authority. This file does not authorize merges, releases, deployments, key custody/enrollment, spending, external publication, or production state changes.

## Scheduler state — do not misrepresent

The ChatGPT automation exists but is currently disabled. A resume attempt on 2026-11-08 was rejected with `too_many_active_automations` (3 active tasks / plan limit 3). No other task was paused or disabled to make room. Do not claim hourly execution is active. A future explicit resume can retry after the Founder frees task capacity or changes the plan. Preserve this task ID and its `do_not_delete` status.

## Supersession corrections

- The old #301 / #300 / #298 priority sequence is stale. #301's historical gate is complete; do not block useful work on it or repeat the old caller-`verification.valid` fix.
- PR #16 is closed/unmerged and its self-signing allegation is superseded by merged PR #18. Do not describe #16 as the current live defect.
- `src/authority/decision.js` on current main still has an optional-nonce branch (`if (signed.nonce)`); absence skips nonce validation. This is a separate current-main gap, not the old #16 issue.
- The proposed fail-closed nonce stack is not integrated: #348 exact head `b74ea6456dd96f1d68d61bcc80e927acc42a9b6f` and child #353 exact head `a5dded30355858e5f7d233c0357fdbd6194bec9d` each have Verify, Genesis, and Browser checks completed successfully. #353's five missing/malformed nonce cases are test-only. Keep the ancestry and review #351/#352 sibling recovery-state changes before proposing any consolidation. Do not merge without Founder authorization.
- Main `docs/authority/founder.pub.json` remains `NOT_ENROLLED`. The live `game/server.mjs` Decision Gate route still authorizes through the local Founder session and `decisions[method](...)`; it does not invoke `authorizationEvent()`. Do not generate, enroll, export, rotate, or provision a Founder key. Real Founder-controlled trust-root enrollment and custody are human-gated prerequisites.

## Current cross-worker coordination

- Worker B owns the active game stack and PR #418, branch `game/animated-github-founder-gate-20261108`, a child of #417. It adds an animated, read-only live GitHub gate for open PRs, issues, and recent workflow runs. Do not duplicate its game/client/UI work.
- Worker A left an independent review on #418 (review ID `5820512730`): `readJson()` has no request deadline/abort, so a never-settling fetch leaves Refresh disabled indefinitely. Requested bounded fetch + regression; await Worker B's response and re-inspect before acting.
- Current main's GitHub source review confirms `authorizationEvent()` re-verifies signatures itself; do not revive the already-fixed caller-supplied-valid defect.

## Ranked Worker A priorities

1. Reconcile the #342 → #348 → #353 nonce-writer/replay-protection stack with sibling #351/#352. Verify exact current heads and checks, review for overlap, and preserve the fact that this is proposed branch work, not mainline capability.
2. Close the remaining live-server authorization integration gap only after a separately Founder-controlled trust anchor exists. Until then, keep the production boundary fail-closed and document the exact human prerequisite; no agent key generation or enrollment.
3. Recheck #418's timeout review response and exact-head hosted checks; coordinate with Worker B rather than editing game paths.
4. Rehydrate the latest Worker B checkpoint and MMORPG ledger. Distinguish current-main capability from branch proposals; do not infer MMORPG completion from green PRs.
5. Continue independent, unowned institutional reliability work only when it removes a demonstrated blocker and does not duplicate active branches.

## Execution and evidence rules

- Each run: read root `AGENTS.md`, then the complete shared protocol, then the Institutional Charter, in that exact sequential order. Read the latest checkpoint and relevant other-worker result before choosing work.
- Inspect nested `AGENTS.md` files for every target path. Run portable preflight before edits when a checkout/runtime is available. If unavailable, record the limitation and follow the full manual sequence; never claim a preflight receipt.
- Reinspect before and after each change. Prefer a source-backed defect, test-first reproduction, safe branch, exact-head verification, and durable handoff. No cosmetic PR fan-out.
- Record exact SHAs, changed paths, tests, CI run IDs/statuses, unresolved blockers, and the next action. A PR is not integrated until observed on main.
- Preserve $0 additional spend. Never claim background execution between host runs.
