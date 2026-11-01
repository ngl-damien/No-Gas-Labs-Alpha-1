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


## Final verification and re-ranked handoff — 2026-11-01 13:12 CDT

### Fresh reinspection and exact work state

- Alpha-1 `main` remains `ea025a587e0bb3113423ea67035ddfa83ea7dc9f`.
- This PR branch remains `fix/login-rate-limiter-time-boundary-20261101`, code/test head `1ce5cfa29f4d48245aa16bb682991d36bf0c93d5`, based on `main`; PR #266 is still draft/open/unmerged.
- Changed code/test paths are `game/login-rate-limit.mjs` and `test/login-rate-limit-hardening.test.mjs`; the run record is this file.
- No local checkout, local test run, or local preflight receipt was produced.

### Hosted verification observed

The three PR checks associated with this head completed successfully. The Verify job checked merge-ref commit `24fa9b43bcd4cccb635159f9fad43dba39e64bce` (the merge of this branch head into main), so this is PR merge-ref evidence, not a direct branch-head push run:

- Verify [41339333183](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41339333183): success. Hosted preflight returned `ready`, 11 declared targets, seven hashed instruction/vendor/checkpoint inputs, and empty warnings/failures. The standard manifest did **not** fingerprint the two changed limiter paths; the earlier scoped-target assertion was correctly removed rather than claiming otherwise. `node --test`, `python3 -m unittest -v test_engine.py`, `node scripts/build-game.mjs`, and `node scripts/meteor-demo.mjs` each exited 0; the institutional exercise reported `passed: true`. The wrapper log does not expose a final Node test count.
- Genesis Evidence Invariant [41339333188](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41339333188): success.
- Browser Acceptance [41339333191](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41339333191): success; all 12 logged journeys passed. Artifact [13096722297](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41339333191/artifacts/13096722297).

The first Verify failure remains preserved above: 714/715 tests passed and the added assertion incorrectly expected main's preflight to fingerprint scoped target bytes. The independently owned PR #259/#264 stack remains the owner of that preflight source repair.

### Founder-authorization challenge against live source

- PR #16 is closed/unmerged and superseded by merged PR #18. The old `demonstrate()` self-signing flow is not a current open PR to reimplement.
- PR #18's merged prototype requires a detached Ed25519 INSTALL signature and pins the configured public-key fingerprint at module import. This is a configured trust anchor, **not** proof of Damien's real-world identity or private-key custody.
- Re-read open Issue #17 and the current-main Experiment 001 source/tests. Current main already contains regressions for concurrent store instances, two-process contention, stale locks that fail closed, process death after lock publication, and process death after ledger rename with explicit recovery. The last crash-after-rename test is skipped on Windows. These tests close much of the issue's concurrency/crash-recovery checklist at the prototype level; they do not establish production key custody or an independently controlled Founder signing operation.
- The remaining live integration gap is distinct: PR #244's v2 sealed/context-bound helper is in `src/authority/decision.js`, but the active PR #251 server branch's `game/server.mjs` does not import it. Its `/api/decisions/*` routes still authorize through the authenticated Founder bearer session and `src/institution/decisions.mjs`. PR #251 also remains stacked on PR #245, which is based on an earlier PR #244 helper revision. Do not transplant or wire this security boundary blindly: the v2 helper expects canonical proposal/quest/output records that are not yet mapped to the live decision-store schema, and the overlapping server paths remain owned by PRs #245/#251.
- Latest Worker B result inspected: PR #265, actor-bound Guild Hall/Commons quests. Its game implementation remains separate and unmerged; no Worker B files were changed.

### Next ranked actions

1. **Highest security leverage:** reconcile the latest PR #244 helper with the PR #245/#251 server stack, define the exact canonical mapping from retained proposal/quest/output state into the v2 verifier, then add a negative HTTP regression proving bearer-session authentication alone cannot create a signed Founder authorization. Do not perform real key enrollment or claim Founder identity without Damien-controlled provisioning and signature evidence.
2. **Independent capability:** after that authority boundary is specified, demonstrate a fresh-process, fresh-environment reuse run using a separately supplied trust anchor; record exactly which durable files and environment inputs are required. No external signing service or real Founder key is currently evidenced.
3. Keep PR #266 draft/unmerged pending review; do not merge, deploy, release, publish externally, change credentials/permissions, or alter any Founder key.
