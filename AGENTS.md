# Mandatory instructions for every agent

**STOP: Read this file before inspecting, editing, testing, reviewing, or proposing changes in this repository.**

1. Read [the shared Ralph-style operating protocol](docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md) in full. It governs every AI agent, coding assistant, autonomous worker, scheduled task, and human-directed agent session working here.
2. Read the relevant local instructions and the latest durable checkpoint before acting. Search for nested `AGENTS.md` files in the directories you touch; more specific instructions add to, but do not silently cancel, this repository contract.
3. Identify your role (Repository Stutter-Step / institution-wide reliability, MMORPG / playable world, or bounded contributor). Inspect the other worker's latest durable result and relevant open PRs. Do not duplicate active work.
4. Follow the protocol's rehydrate → observe → rank → challenge → act → verify → review → preserve → handoff → repeat loop. Make substantive, bounded changes. Reinspect the repository before and after edits.
5. Verify claims from source, commands, test output, and exact-commit CI. A model's assertion is never sufficient evidence. Preserve failures, uncertainty, and limitations.
6. Preserve the human authority boundary. Do not merge, release, deploy, spend, publish externally, alter credentials/secrets/permissions, or take destructive/irreversible actions without explicit authorization.
7. Before finishing, leave a durable, factual record and a useful handoff. State what was observed, what changed, what passed/failed, what remains unknown, and the next best action.

## If you cannot read or follow the protocol

Do not proceed with repository changes. Report the exact access or instruction conflict and request clarification. Do not claim compliance by merely acknowledging this file.

## Canonical source and precedence

The canonical operating contract is `docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md`. This file is its mandatory entry point, not a substitute. Vendor-specific instruction files point back here. Local task instructions may narrow the task but cannot weaken evidence, safety, coordination, or founder-authority requirements.


## Portable preflight and continuous execution

After reading this file and the complete shared protocol, but before inspecting implementation paths, run the portable preflight with every intended target and the latest durable checkpoint:

    npm run agent:preflight -- --path src/example.mjs --checkpoint docs/operations/LATEST_CHECKPOINT.md --receipt artifacts/agent-runs/worker-a-iteration-001.json

Repeat --path for every intended target. Use a unique receipt path for each run; never overwrite an earlier receipt. The command must return status ready. It verifies and hashes the root instructions, shared protocol, vendor pointers, applicable nested AGENTS.md files, and checkpoint. A ready receipt proves which bytes were read, not that they were understood. If preflight is unavailable, follow the manual sequence and record the limitation; never skip instructions.

Agents are compute-bounded continuous workers, not one-shot responders. Follow the shared protocol's rehydrate → observe → rank → claim → challenge → act → verify → review → preserve → handoff → repeat loop for as much useful work as the actual session budget permits. Continue to the next safe, unowned, high-value task after each verified iteration. Do not claim background execution after the host session ends.
