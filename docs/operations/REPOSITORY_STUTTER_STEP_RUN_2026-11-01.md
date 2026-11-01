# Repository Stutter-Step Run — 2026-11-01

**Worker:** Repository Stutter-Step / institution-wide reliability (Worker A).  
**Status:** in progress; proposed branch only; no merge, deployment, release, spending, key handling, or external publication.

## Bootstrap and continuity

- Root `AGENTS.md` was read alone as the first repository operation; canonical `docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md` was read alone as the second. The portable local preflight could not be executed through the connector-only runtime. The first hosted attempt at a scoped preflight regression exposed that current main's `runPreflight` accepts `--path` values but does not read/hash those target bytes; PR #259 and the active #258/#264 stack already own that exact preflight gap. This branch removed the incorrect target-hash assertion rather than editing their shared files or claiming a scoped receipt.
- Prior durable handoff: draft PR #210, branch `audit/repository-stutter-step-checkpoint-2026-10-30`, latest run record `docs/REPOSITORY_STUTTER_STEP_RUN_2026-10-31.md`. It records PR #16 as closed/unmerged and superseded by merged PR #18.
- Fresh Alpha-1 main at branch creation: `ea025a587e0bb3113423ea67035ddfa83ea7dc9f`.
- Latest Worker B proposal inspected: PR #265, Guild Hall / Commons actor-bound quests, stacked on the active Relay/recovery integration branch. Its game/server and game-quest scope was left untouched.
- Active competing work left untouched: PR #244 Founder decision seals/context binding; #245 service-store ownership; #251 explicit production/network Founder key; #258/#259/#264 preflight stack; #265 game quest stack.
- PR #16 is closed and unmerged. PR #18 is the merged replacement for its old self-signing flow. The remaining Founder-authentication issue is not being duplicated here; PR #244 owns the current helper hardening and the server integration remains a separate, human-trust-bound task.

## Ranked objective and challenge

1. **Selected — make the login limiter's own API enforce its bounded/monotonic invariants.** Source inspection found that `failure(address, now)` could append indefinitely if called without the companion `assertAllowed`, despite the limiter's bounded-memory claim. The injected `now` value also accepted NaN, infinity, negative, or regressing values; `prune(NaN)` filters away existing failures and can make a lockout appear clear. The current HTTP route calls `assertAllowed` before `failure`, so this is not claimed as a demonstrated remote exploit; it is a real reusable-primitive robustness gap.
2. **Deferred — live Founder authorization integration.** Current PR #244 owns `src/authority/decision.js`; #245/#251/#265 own overlapping `game/server.mjs` paths. Do not duplicate or race those branches.
3. **Deferred — linked-repository changes.** Discovered Command Center, ngl-mesh, no-gas-labs-monorepo, and EvidenceOS roots returned 404 for `AGENTS.md` on the accessible default refs. Per repository contract, no further inspection or edits were made in those repos.

## Intended change

- Reject invalid or regressing monotonic timestamps before pruning or mutating limiter state.
- Make `failure()` enforce the per-address failure cap itself, so repeated direct calls cannot grow a bucket without bound.
- Add negative tests for NaN/infinity/negative/regressing time and direct repeated failure recording. The scoped-preflight experiment was removed after it identified the independently owned mainline target-fingerprinting gap in PR #259/#264.

## Verification and limits

- No local checkout, npm test, or local preflight receipt is claimed. The first hosted Verify run (41339092745) executed 715 tests: 714 passed and the single failure was the new scoped-preflight assertion that expected target files in `result.files`. Inspection confirmed current main does not hash requested targets; PR #259/#264 already own that fix. The incorrect assertion was removed, and no change was made to their preflight files.
- Genesis Evidence Invariant run 41339092714 succeeded on the first head. Browser Acceptance run 41339092698 was still in progress at the time of this checkpoint.
- A passing unit test will prove only the tested in-process limiter behavior; it will not prove production deployment, server integration, identity, or real Founder key custody.
- No repository files outside this bounded limiter/test/checkpoint scope are intended to change.

## Next action

Complete the two limiter hardening steps, inspect the resulting diff, create a draft PR, inspect exact-head hosted checks, repair any attributable failure, then append exact commit/run evidence and hand off the next ranked action.


## Failure correction — 2026-11-01

- First Verify run 41339092745 failed only the added scoped-preflight assertion after 714/715 tests passed. The rate-limiter regressions passed.
- Root cause: current-main `scripts/validate-agent-governance.mjs` validates target path syntax and nested-instruction discovery but does not call `inspect(target, 'target')`; therefore `result.files` correctly omitted the changed source/test paths. The source defect is already owned by PR #259 (target byte fingerprinting) and PR #264 (the active preflight stack); this branch will not duplicate or race that work.
- Corrective action: removed the overreaching preflight test/imports. No claim of a scoped preflight receipt is made. The required instruction sequence was manually completed, and the limitation is recorded.
