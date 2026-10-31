# Latest Durable Checkpoint

**Updated:** 2026-10-31 UTC  
**Repository:** `ngl-damien/No-Gas-Labs-Alpha-1`  
**Worker:** Worker A — Repository Stutter-Step / institution-wide reliability  
**Current main baseline:** `ea025a587e0bb3113423ea67035ddfa83ea7dc9f`  
**Status:** proposed on `ops/canonical-checkpoint-preflight-20261031-run10`; not merged.

## Canonical checkpoint and preflight repair

Root `AGENTS.md` requires targeted work to run `npm run agent:preflight` with `--checkpoint docs/operations/LATEST_CHECKPOINT.md`. On current main that path returns 404. The hosted `agent:preflight:ci` script in `package.json` instead passes the historical `NGL_AGENT_BOOTSTRAP_CHECKPOINT_2026-10-30.md` as its checkpoint and does not include the canonical path. This means interactive and hosted preflight do not hash the same current handoff.

Worker B identified this mismatch in [PR #210 comment 6549935064](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/210#issuecomment-6549935064) and explicitly handed reconciliation to Worker A. The earlier branch `docs/latest-checkpoint-path-20261031` contains a checkpoint and a regression test, but it is three commits ahead of its merge base, two commits behind current main, has no open PR, and main contains a revert that intentionally kept that proposal off main. This proposal uses a clean Worker A branch from current main rather than editing or merging that branch.

### Changes proposed here

- Restore `docs/operations/LATEST_CHECKPOINT.md` as the current canonical durable handoff.
- Change `agent:preflight:ci` to use that path as `--checkpoint` and include it in the scoped `--path` list. Keep the 2026-10-30 bootstrap checkpoint as a separately hashed historical input.
- Add `test/latest-checkpoint-contract.test.mjs` to verify that root instructions, the actual checkpoint file, and hosted preflight all agree on the canonical path, and that the regression itself is included in preflight targets.

The change is governance/reliability work only; it does not modify game runtime or Worker B's Android/game files.

## Current repository and worker state observed

- Current main: `ea025a587e0bb3113423ea67035ddfa83ea7dc9f`. The latest-checkpoint branch is not integrated.
- PR #16 is closed unmerged and superseded by merged PR #18 (`213f3b5c7771da24b36f9ce6ebdde871d22e4602`). Do not recreate the self-signing implementation.
- Issue #17 remains open for real Founder identity/key custody, live-server authorization integration, and concurrency/crash-recovery acceptance. No key was generated, enrolled, or changed.
- PR #241 is draft at `55f4b105a5cf209192fec92168e7a9229775503e`; PR #244 is draft at `90d9a04bf28bcd641dc4e2c6fa287b9f534774d9`; PR #245 is draft at `8e93f75c9be1d07e471e42c39d974113387a3218`, stacked on #244. Their package/preflight and governance-test changes still require reconciliation before integration.
- PR #245 exact-head Verify [41242507287](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41242507287), Genesis [41242507296](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41242507296), and Browser Acceptance [41242507297](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41242507297) passed on the recorded head.
- Worker B's latest automation run was recorded `in_progress`; its latest completed result is older than current PR #246. Current PR #246 head `d42b3d74fff95b646eee2c70b0234d3d757eff20` has Verify [41244105095](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41244105095), Genesis [41244105115](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41244105115), and Browser Acceptance [41244105044](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41244105044) passed.
- Current PR #243 head `1b4ea596d19ecde266823d3fbe72b61fb2348af0` has Verify [41211280249](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41211280249), Genesis [41211280235](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41211280235), and Browser Acceptance [41211280237](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41211280237) passed.
- Current PR #239 head `c6c52b6dd72801abda453dd8de75adb5ef0279c4` has Verify [41248470223](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41248470223), Genesis [41248470203](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41248470203), and Browser Acceptance [41248470247](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41248470247) passed.
- Current PR #247 head `811e61dafbac064e37547e41baf5f9d513117a5e` has Verify [41248202687](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41248202687), Genesis [41248202697](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41248202697), and Browser Acceptance [41248202722](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41248202722) passed. Android Alpha-1 [41248202670](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/41248202670) was still in progress at the latest observation; no emulator or device acceptance is claimed.
- Mainline MMORPG ledger G0–G9 remains `NOT ASSESSED`; proposed PRs are not integrated capabilities.

## Verification and limitations

- Local portable preflight was not completed. The connected Windows environment has Node 24.22.2 but `git` is not available in PATH; PowerShell blocked `npm.ps1` under its execution policy. A direct `npm.cmd`/Node attempt did not return a usable result, and no local preflight receipt was observed. The local snapshot also lacked `LATEST_CHECKPOINT.md` and the new regression test. Do not claim local tests or a local ready receipt.
- Exact-head hosted Verify/Genesis/Browser checks for this proposal are pending. Hosted Verify must show scoped preflight `ready`, zero warnings/failures, and the new regression passing before this proposal is considered verified.
- Nested-instruction probes for `docs/AGENTS.md`, `docs/operations/AGENTS.md`, and `test/AGENTS.md` returned 404 on main; no files in those directories are being modified concurrently by another worker.
- No merge, release, deployment, external publication, spending, key/credential/permission change, branch deletion, or Founder acceptance occurred.

## Next prioritized actions

1. Inspect this proposal's exact-head Verify, Genesis, and Browser Acceptance checks; repair only attributable failures and refresh this file with exact results.
2. Reconcile the overlapping scoped-preflight targets across PRs #241, #244, and #245 on a clean integration proposal; do not merge.
3. Refresh Worker B's current result and PR #247 Android run; require the actual API 35 export/import journey and later physical-device evidence before any G7 acceptance claim.
4. Continue issue #17's real Founder key-custody and live-server authorization acceptance without generating or enrolling credentials.
5. Keep G0–G9 current-main evidence separate from all proposed game branches.

The chronological run history and longer cross-worker handoffs remain on [PR #210](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/210).
