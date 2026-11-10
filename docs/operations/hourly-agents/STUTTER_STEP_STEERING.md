# Stutter-Step Loop Steering — Worker A — 2026-11-09

**Owner:** NGL Repository Stutter-Step Loop (`6ac6c77de7ac81918e446a49ea330eb6`)  
**Repository:** `ngl-damien/No-Gas-Labs-Alpha-1`  
**Observed main:** `6f1a4aefb87334ddad359af12f754505965e29a5`  
**Authority:** Damien Featherstone remains the sole Founder decision authority. This file does not authorize merges, releases, deployments, key custody/enrollment, spending, external publication, or production state changes.

## Scheduler state — do not misrepresent

The ChatGPT automation exists but is currently disabled. A resume attempt on 2026-11-08 was rejected with `too_many_active_automations` (3 active tasks / plan limit 3). No other task was paused or disabled to make room. Do not claim hourly execution is active. Preserve this task ID and its `do_not_delete` status.

## Supersession and authority corrections

- The old #301 / #300 / #298 priority sequence is stale. #301's historical gate is complete; do not block useful work on it or repeat the old caller-`verification.valid` fix.
- PR #16 is closed/unmerged and its self-signing allegation is superseded by merged PR #18. Do not describe #16 as the current live defect.
- Current main `src/authority/decision.js` still checks nonce shape only inside `if (signed.nonce)`; omission bypasses nonce validation. This is a current-main defect distinct from the historical #16 allegation.
- Current main trust anchor `docs/authority/founder.pub.json` remains `NOT_ENROLLED`. The live server's Founder-session authorization path does not invoke the signed `authorizationEvent()` path. Do not generate, enroll, export, rotate, or provision a Founder key. Real trust-root enrollment/custody is Founder-controlled.
- PR #434 is the focused current-main proposal for the optional-nonce gap: branch `security/mainline-required-founder-nonce-20261109-run1`, head `984d80ad19ae00276574aa0980fc0292ca9281dc`, two files. It requires the 128-bit lowercase-hex nonce emitted by `newNonce()` and adds five malformed-shape cases at both verification and authorization entry points. Exact-head Verify `42728253519`, Genesis `42728253421`, and Browser `42728253416` all pass. It does **not** add durable replay storage or live-server integration. Draft/unmerged.
- The larger nonce-ledger stack is separate proposed work. PR #348 head is `b3c8d4c6c23ed55bab967ed3099f846d33c63eda`, based on #342 head `cc9f00e46ff8a7707776aaf9a546393d6c721079`. Compare to main: 124 commits ahead / 8 behind. Its child PRs #351 (4 commits ahead), #352 (2 ahead), and #353 (2 ahead) are based directly on that exact #348 head; all three have exact-head Verify, Genesis, and Browser checks passing. A previous Worker A comment incorrectly called #351/#352 stale by comparing against unrelated commit `b74ea645...`; corrective comments are recorded on #348, #351 and #352. Do not repeat that mistaken ancestry claim. Do not merge the large stack as-is.
- The #348/#351/#352/#353 stack includes durable nonce-ledger, recovery and initialization work. Review the exact PR ancestry/diffs before deciding whether to integrate it; PR #434 intentionally isolates only nonce-shape validation.

## Current cross-worker coordination

- Worker B's latest observed Synthesis Clerk work is PR #432 (head `6bbfe9b20a00d5644a6645a9c070872458f506bb`) and child #433 (head `0c4591118fca4ac76aecd10d9462199098879ad0`). #433 changes only `scripts/verify-browser.py`, allowing the generic browser harness to distinguish a receipt-verified dated snapshot from an explicit unavailable state. Exact-head Verify `42727791774`, Genesis `42727791700`, and Browser `42727791829` pass; Android `42727791682` was still running at last observation. Worker A left a review/coordination comment on #433. Do not duplicate the game implementation.
- Current-main snapshot PR #429 (head `77294a36db3b2399e3d40af11edeedf1ecb60146`) contains the 85-path proposed playable-world stack. Verify, Genesis, Academy, Council, Quest Board, Synthesis Clerk mobile, and Browser pass. Android Alpha-1 run `42674895131` failed after APK assembly; 6/11 instrumentation tests completed and `publishedSourceObservatoryRestoresNativeBackupThroughPreviewAndAppendWithoutWorldProgress` was marked failed. Its XML failure body is empty and instrumentation reports a process crash; available logcat does not establish a root cause. Artifact `13705092199` is a debug APK, not device acceptance. Do not call this snapshot Android-verified or release-ready.
- PR #430's Android run `42720219817` failed before tests began (XML reports 0 tests); do not conflate it with #429's later six-test run.
- PR #431 is Worker B's documentation-only ledger/checkpoint update on its own branch; inspect its latest exact head before depending on it.
- Worker A previously reviewed #418's hung-fetch failure. Worker B implemented a 10-second deadline, abort support, Promise.race fallback, and regression; exact head `15757249d2cc388a1e0ea362f37dd962380362e5` had Verify, Genesis, Browser and mobile acceptance passes, while Android Alpha-1 failed. Later #418 descendants may supersede that head; inspect current PR metadata before reusing it.

## Ranked Worker A priorities

1. Recheck PR #434 exact-head workflows and review feedback; keep its limited nonce-shape claim separate from durable replay protection. If checks remain green, request independent review; do not merge.
2. Reconcile the #348 → #351/#352/#353 durable nonce-ledger stack against main with exact ancestry and source review. Its 124-ahead / 8-behind divergence is material; do not merge the stack wholesale.
3. Inspect the exact Android failure in #429's snapshot and coordinate a focused diagnostic with Worker B. The current evidence identifies one failed instrumentation journey plus process crash, not a root cause.
4. Rehydrate Worker B's newest checkpoint/ledger and #431/#432/#433 descendants. Keep current-main capability separate from draft-branch capability.
5. Continue independent, unowned institutional reliability work only when it removes a demonstrated blocker and does not overlap Worker B's active paths.

## Execution and evidence rules

- Every run: read root `AGENTS.md`, then the complete shared protocol, then the Institutional Charter, sequentially in that exact order. Then read the latest checkpoint and relevant other-worker result.
- Inspect nested `AGENTS.md` files for every target path. Run portable preflight before edits when a checkout/runtime is available. If unavailable, record the limitation and follow the full manual sequence; never claim a preflight receipt.
- Reinspect before and after each change. Prefer a source-backed defect, test-first reproduction, safe branch, exact-head verification, and durable handoff. No cosmetic PR fan-out.
- Record exact SHAs, changed paths, test/CI run IDs and statuses, unresolved blockers, and next action. A PR is not integrated until observed on main.
- Preserve $0 additional spend. Never claim background execution between host runs.
