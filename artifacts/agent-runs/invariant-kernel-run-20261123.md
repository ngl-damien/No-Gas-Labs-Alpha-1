# Invariant Kernel local run record

- Timestamp: 2026-11-23 (sandbox task session).
- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- Base: `origin/main` at `21677d88cb027f3d16adacf92dbdd0ec08e96dbd`.
- Local branch: `feat/unified-invariant-core`.
- Authorization: user requested this feature branch and explicitly withheld changes to `main`; later explicitly approved pushing the feature branch and opening PR #723. No merge is authorized yet.
- Scope: unify canonical doctrine and skills, add a typed gate evaluator/mission ledger, add PR separation workflow, test locally.
- Preflight: `artifacts/agent-runs/worker-a-invariant-kernel-final5-20261123.json` (ready; exact source-target hashes and checkpoint receipt; no warnings or failures).

## Observed local checks

- `python3 -m unittest discover -s test -p 'test_ngl.py' -v`: 9 tests, all passed (final run 0.007 s).
- `npm test`: 1,444 passed, 0 failed, 0 skipped; final Node test duration 25,636.076829 ms.
- `git diff --check`: exit 0.
- `python3 -m py_compile scripts/ngl.py scripts/gate_runner.py test/test_ngl.py`: exit 0.
- Live final CLI cycle: `init` succeeded; typed `gate` reported score 100, decision `completed`, aggregate `EXECUTION_OBSERVED`; verify without anchor returned `UNANCHORED` (exit 1); verify with a separate anchor JSON returned `CHAIN_INTACT`, count 2, head `623f4830c80f969449fbb1c7bb17185d837844fa2952b7c729d764d45e53f0dd`.
- Final review also strengthened the regex policy to reject quantified groups and ambiguous quantified alternations, expanded the PR candidate/policy separation surfaces, and changed the truncation regression to anchor against its real original final head.

## Limits / follow-up

- Hosted GitHub Actions, effective branch-protection/ruleset independence, external systems, and actual payment/scheduler provider records were not run or inspected in this local validation. The workflow is proposed source, not observed hosted enforcement.
- `close` is a read-only closure decision: it requires a matching anchored intact head, latest completed gate, scheduler JSON with `ready=true`, named owner and no blockers, and evidence through the declared S0–S8 pay-loop stage. It does not update the anchor or append a closure event.
- An explicit `--expected-head` is caller-supplied evidence; an `--anchor-ref` is required to be outside the ledger directory but still depends on the external store's independent administration.
- The CI separation workflow itself must be protected as a required check on the hosting platform; a PR-controlled workflow alone cannot prove its own independence.
- At initial completion there was no commit or push. Subsequently, authorized commit `03adcc847ffc533af27486d5ca5b08a8daa75124` was pushed to `feat/unified-invariant-core`, opening PR #723. `main` remains unchanged and PR #723 remains unmerged.

## Browser-acceptance investigation and fix (2026-11-23)

- PR #723 baseline head: `03adcc847ffc533af27486d5ca5b08a8daa75124`; failed hosted browser run: `45286359957`.
- Root cause: `origin/main` contains `c34d5e7ed` (`feat(world): station Contradiction Clerk at the Evidence Archive`), which mounts the existing `#contradiction-clerk-npc` in `openEvidenceArchive` and not Guild Hall. The older desktop journey still opened Guild Hall before asserting the selector at `scripts/verify-browser.py:472–473`. The selector and visible text were not renamed; the journey had stale location assumptions.
- Baseline evidence: direct invocation of the unchanged `basic(..., 'desktop')` journey on a detached `origin/main` worktree at `21677d88cb027f3d16adacf92dbdd0ec08e96dbd` failed at the exact `BOUNDED ADVERSARY` assertion. A full local baseline run exited earlier at the separate offline-network assertion (line 5017) under system Chromium; that earlier result was not treated as evidence for the Clerk step.
- Fix on the feature branch: assert the Clerk selector is absent in Guild Hall; navigate to Evidence Archive; retain both original Clerk text assertions verbatim there. No assertion was weakened, skipped, or deleted.
- Local verification after fix: focused desktop journey passed; `npm test` reported 1,444 passed, 0 failed, 0 skipped (26,505.472595 ms); nine kernel tests passed; Python compilation and `git diff --check` passed.
- Preflight receipt: `artifacts/agent-runs/worker-a-browser-failure-final2-20261123.json` (targeting the modified browser verifier; expected ready with no warnings or failures).
- Next: commit and push the fix only to `feat/unified-invariant-core` as authorized, then inspect all checks on the updated PR head. Do not merge until every check is green and Damien explicitly approves the merge.
