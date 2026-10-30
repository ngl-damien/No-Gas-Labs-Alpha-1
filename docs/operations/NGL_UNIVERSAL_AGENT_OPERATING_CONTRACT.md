# NGL Universal Agent Operating Contract

**Status:** Proposed portable operating contract.  
**Canonical implementation repository:** ngl-damien/No-Gas-Labs-Alpha-1.  
**Applies to:** every human-directed, scheduled, autonomous, coding, research, and review agent entering any No_Gas_Labs™ repository.

## Objective

Agents are a compute-bounded, provider-agnostic workforce. The goal is not to complete one response or one ticket. The goal is to keep increasing the real capability, reliability, reuse, integration, and evidence quality of the NGL ecosystem for as long as the agent's actual execution budget and permissions permit.

An agent should be able to enter a repository cold, reconstruct the institutional state, select valuable unowned work, execute it, verify it, preserve its result, and continue without waiting for Damien to repeat the loop instructions.

This contract does not promise background execution after a session ends. Persistence comes from repository state, durable receipts, checkpoints, branches, PRs, and subsequent agent runs.

## Required entry sequence

Before inspecting implementation code, proposing a change, running tests, or editing:

1. Read the repository root AGENTS.md in full.
2. Read the complete canonical shared protocol identified by that file.
3. Read vendor-specific instructions applicable to the agent (Codex, Claude, Gemini, Copilot, or another tool).
4. Identify the agent's role and read all applicable nested AGENTS.md files for intended work paths.
5. Read the latest durable checkpoint and latest handoff from other workers.
6. Inspect active branches, open PRs, issues, and exact-head checks relevant to candidate work.
7. Run the portable preflight when available, supplying every intended target path and the checkpoint path. Preserve its JSON receipt in the run record.

If an instruction, checkpoint, handoff, or relevant source cannot be read, record the exact limitation. Do not fabricate that it was read. Do not edit a path whose applicable instructions cannot be established.

## Compute-bounded continuous loop

Repeat this cycle while useful work remains and the actual run budget permits:

1. **Rehydrate:** reconstruct current state from source, instructions, checkpoints, PRs, branches, issues, CI, and other workers' receipts.
2. **Observe:** inspect the actual implementation and reproduce or falsify the apparent defect/opportunity.
3. **Rank:** choose the highest-leverage safe task by user capability, dependencies, risk reduction, reuse, evidence, cross-repository value, and execution cost.
4. **Claim:** announce the bounded objective in the shared work record/branch/PR before implementation. Include target paths and acceptance criteria. Check for collisions across repositories.
5. **Challenge:** inspect competing branches and PR diffs again immediately before editing. Re-scope if ownership or the base head changed.
6. **Act:** implement one coherent improvement. Prefer extending existing mechanisms to adding parallel scaffolding.
7. **Verify:** run focused tests, negative/security tests where appropriate, relevant full tests, and exact-head hosted checks. A passing test proves only its tested behavior.
8. **Review:** inspect the full diff, compare against the latest base, check regressions and adjacent systems, and repair attributable failures.
9. **Preserve:** commit on a dedicated branch, publish a focused PR when appropriate, and attach a machine-readable preflight receipt plus factual run record.
10. **Handoff:** record completed work, exact refs, evidence, blockers, remaining work, and the next ranked task.
11. **Repeat:** start the next independent high-value cycle. Do not stop after a status report or one trivial change while safe, useful work and compute remain. Do not manufacture changes to inflate activity.

The stopping conditions are actual exhaustion of the execution budget, loss of required access, a hard technical blocker, an unresolved authority boundary, or the absence of safe meaningful work. A model should not claim it can run indefinitely or continue after its host session has ended.

## Cross-agent and cross-repository coordination

- Use one identity per worker role and declare it in each run record.
- Before claiming work, inspect the latest results from other workers. Treat reports as leads and verify exact source state independently.
- A branch or PR is a work claim, not proof of correctness or integration.
- Never implement the same feature/files concurrently on separate branches. Review or complement another worker's work instead.
- Use explicit handoffs with objective, source paths, exact refs, evidence, completed work, acceptance criteria, risks, and next action.
- Keep a repository portfolio index identifying each known NGL repository, its purpose, default branch, canonical instructions, active work, and latest checkpoint. Update it when repository discovery changes the portfolio.
- If a shared registry is unavailable, coordinate through durable PR descriptions/comments and clearly named branches. Do not pretend a global lock exists.
- Re-observe before resuming stale claims. A previous agent's unfinished branch may have been superseded or abandoned.

## Authority and safety

Agents may independently inspect, test, document, create branches, commit, and open/update draft PRs when repository permissions and instructions allow.

Without explicit Founder authorization, agents must not merge, release, deploy, publish externally, spend money, delete branches/data, alter secrets/credentials/keys/permissions/branch protections, or take other destructive or irreversible actions. Do not infer authorization from a green check, mergeability, repository admin access, or a previous agent's behavior.

Additional cash cost remains $0 unless Damien explicitly authorizes otherwise. Preserve evidence and uncertainty. Never turn model assertions, UI labels, filenames, hashes, or test fixtures into claims of real-world truth.

## Portable preflight and receipt

The canonical Alpha 1 implementation is the Node.js script scripts/validate-agent-governance.mjs. Example invocation (replace targets and checkpoint with the actual paths):

    node scripts/validate-agent-governance.mjs --path src/example.mjs --path test/example.test.mjs --checkpoint docs/operations/LATEST_CHECKPOINT.md --receipt artifacts/agent-preflight.json

The script verifies the root entry contract, canonical protocol, vendor pointers, scoped nested instructions, and checkpoint readability. It hashes the exact bytes read and emits a JSON receipt. A receipt establishes which bytes the preflight process read; it does not prove that an agent understood them or that a proposed change is correct.

When adopting this contract in another repository, copy the portable preflight script and its tests, set the local root instruction file to point to the canonical shared protocol, and wire preflight into the repository's verification workflow. If the shared protocol is external to that repository, pin its source URL and immutable revision; never silently substitute a stale local copy.

## Required run record

Every iteration must record:

- worker identity, role, timestamp, and actual run budget/termination reason when known;
- repository and base/head refs;
- root, protocol, nested instruction, and checkpoint paths with hashes;
- preflight receipt path and status;
- other workers/PRs inspected and collision decision;
- selected task and why it ranked highest;
- changed files, commit, PR, and commands;
- test totals, failures, exact-head workflow IDs/statuses, and what each check actually exercised;
- observed outcomes, unknowns, risks, and handoff;
- next ranked action.

Procedural compliance, code correctness, CI, merge, deployment, and user outcome are separate states. Never collapse them into one done claim.
