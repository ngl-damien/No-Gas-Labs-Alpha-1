# Durable Checkpoint — Universal Agent Bootstrap
**Recorded:** 2026-10-30 UTC  
**Repository:** ngl-damien/No-Gas-Labs-Alpha-1  
**Branch:** ops/universal-agent-loop-bootstrap-20261030  
**State:** Draft PR open; not merged; no release or deployment.

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
- scripts/validate-agent-governance.mjs now provides a fail-closed preflight with SHA-256 fingerprints for root instructions, shared protocol, all four standard vendor pointers, applicable nested AGENTS.md files, and a caller-supplied checkpoint.
- The preflight rejects unsafe repository-relative paths, target/instruction symlink escapes, missing or invalid vendor pointers, missing checkpoint for scoped work, remote protocol URLs without a locally pinned copy, and receipt overwrites or escaping receipt directories.
- package.json exposes npm run agent:preflight.
- test/agent-governance.test.mjs contains 12 focused tests covering successful scope discovery, checkpoint requirement, traversal, missing protocol, vendor pointer failures, receipt persistence/non-overwrite, instruction and target symlink escapes, and pinned remote protocol handling.

## Current branch and verification

- Branch head at checkpoint creation: 861932caec73aade501aff21999bd14ae046bd15 (21 commits ahead of main, 0 behind).
- Exact-head Verify run 41129076320: success. Its logs show the preflight ready in root-only mode, Node test command exit 0, Python inspector tests exit 0, package build exit 0, and institutional exercise exit 0 with passed=true.
- Exact-head Genesis Evidence Invariant run 41129077059: success.
- Exact-head Browser Acceptance run 41129076160: was still in progress when this checkpoint was recorded; do not infer its result from an earlier head.
- The hosted Verify invocation so far was root-only. It did not yet run the new preflight against an actual target list and this checkpoint file.
- No local test execution is claimed.

## Cross-repository discovery

The installed-repository search returned 32 candidate repositories. Seven root AGENTS.md files were successfully read in the initial sample; several other content lookups returned 404 and are not yet distinguished between missing instruction files and inaccessible repositories.

Three additional repositories already have agent-governance work on separate branches, so do not duplicate or overwrite it:
- no-gas-labs-command-center: operations/agent-governance-2026-10-30, 6 commits ahead and 1 behind main; no open PR.
- ngl-mesh: operations/agent-governance-2026-10-30, 7 commits ahead and 1 behind main; no open PR. Open PRs #3 and #1 contain separate Relay/security work.
- no-gas-labs-monorepo: operations/agent-governance-2026-10-30, 5 commits ahead and 1 behind main; no open PR.

Their main branches already expose agent-governance workflows and root AGENTS.md files. Reconcile existing branches before further cross-repository rollout.

## Outstanding work

1. Wire the preflight into CI with an explicit target-path list and this checkpoint, so CI exercises scoped instructions rather than only root files.
2. Re-run all exact-head workflows after that change and update this checkpoint with the resulting head and evidence.
3. Reconcile the three existing agent-governance branches; do not overwrite their work.
4. Roll out the portable preflight and standard vendor pointers to other eligible NGL repositories after reading each repository's instructions and local continuity requirements.
5. Create and maintain the NGL repository portfolio/work-claim registry. It is not yet implemented.
6. Keep PR #229 draft and unmerged until Founder review. No merge, release, deployment, credentials/permissions changes, branch deletion, spending, or external publication is authorized by this checkpoint.

## Important limitation

This contract tells an invoked agent to continue iterating for as much useful compute as its host session permits. It does not create compute, start an agent by itself, or keep a model running after its host session ends.
