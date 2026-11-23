---
name: ngl-traceability-and-recovery
description: Create durable, independently inspectable records of agent work, decisions, validation runs, failures, and cross-session recovery.
---

# NGL Traceability and Recovery

## Purpose
Make consequential work reconstructable after context loss, process interruption, agent handoff, or later independent review.

## Non-negotiable rules
- Distinguish **Verified**, **Reported**, **Simulated**, **Proposed**, and **Unknown**.
- Preserve failed, rejected, and dissenting events; do not overwrite history to create a clean narrative.
- A summary is not a substitute for source evidence.
- Every material claim should identify its source, time, scope, and verification method.
- Do not claim persistence until the durable write has been independently read back.

## Procedure
1. Establish the current repository/ref, project state, task owner, and latest durable checkpoint.
2. Define the intended outcome, acceptance criteria, authority limits, and stop conditions before acting.
3. Record the baseline and relevant source references before modification.
4. During work, capture actions, commands, inputs, outputs, failures, approvals, and exact artifact identifiers.
5. Separate observations from interpretations and recommendations.
6. After writing a durable record, read it back through an independent retrieval path.
7. On interruption, rehydrate from the last verified checkpoint and re-check current state before resuming.
8. Produce a handoff with completed work, uncompleted work, blockers, evidence references, and one next action.

## Required receipt fields
Task identifier; worker; timestamp; repository and exact ref; changed artifact identifiers; authorization basis; commands/tests and exit status; evidence links; failure/dissent records; state labels; limitations; next owner/action.

## Acceptance criteria
A pass requires a durable record that another worker can retrieve and use to reconstruct the relevant decisions and results without relying on the original agent's memory or unsupported claims.

## Stop conditions
Stop if the baseline cannot be established, the evidence source is unavailable, a write cannot be read back, or a handoff would conceal unresolved failures.
