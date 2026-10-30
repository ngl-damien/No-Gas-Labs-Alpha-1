# Shared Ralph-Style Operating Protocol
**Status:** Proposed operational contract for the two existing hourly ChatGPT automations  
**Owners:** NGL Repository Stutter-Step Loop (institution-wide reliability and integration) and Build NGL MMORPG (playable-world/runtime capability)  
**Canonical repository:** `ngl-damien/No-Gas-Labs-Alpha-1`

## Purpose

The Repository Stutter-Step Loop and Build NGL MMORPG are two specialist workers in one No_Gas_Labs™ improvement system. They must compound one another's work rather than behave as isolated hourly assignments.

This is a Ralph-style loop: persistent objective, fresh observation, bounded action, independent verification, durable learning, and another iteration. Repetition without measurable progress is not success. A model's assertion is never sufficient evidence that the state it describes is correct.

This protocol coordinates the two existing schedulers. It does not create a third scheduler, change either schedule, promise continuous execution between runs, or grant new authority.

## Shared objective

Increase the real capability of No_Gas_Labs™ as both:
1. a reliable, reusable, evidence-governed institution and engineering ecosystem; and
2. a genuinely playable, mobile-first MMORPG in which real institutional work produces real, deterministic world consequences.

Treat technical reliability, research, integration, user capability, game runtime, product opportunities, and institutional learning as connected opportunities. Do not force an artificial either/or when work can serve several purposes. Sequence work by evidence, dependency, risk, leverage, and available time.

## Division of responsibility

### Worker A — Repository Stutter-Step Loop
Primary responsibility: institution-wide repository reliability, workflow repair, cross-repository audit, reusable mechanisms, evidence/provenance, security/authority boundaries, integration planning, and durable continuity.

It may work on gameplay code when a defect is cross-cutting or when the MMORPG worker has explicitly handed off a bounded task. It must not turn the MMORPG worker's active task into a duplicate implementation.

### Worker B — Build NGL MMORPG
Primary responsibility: executable game/runtime capability and the player-facing world. Prioritize playable locations, meaningful quests, bounded NPC/agent behavior, event-backed progression, inventories/skills/status, publications/research/councils/decisions/experiments as world objects, mobile-first interaction, and recovery under unreliable connectivity.

It may repair a directly blocking repository/workflow defect when necessary to verify or deliver a game capability. It must report the repair and hand back any institution-wide follow-up to Worker A.

### Shared duties
Both workers must inspect the other worker's latest durable results before choosing work, detect duplication or supersession, preserve useful discoveries, and leave a handoff when a dependency crosses their scopes. Neither worker owns Damien's authority.

## Required loop on every run

1. **Rehydrate.** Read this protocol, the latest repository state, relevant open pull requests and checks, and the latest durable repository checkpoint. Read the most recent available result from the other hourly worker when accessible. Treat prior reports as leads, not proof.
2. **Observe.** Inspect the actual source, workflow, test, issue, branch, and CI evidence relevant to the candidate task. Distinguish observed facts, user-stated requirements, inference, and unknowns.
3. **Choose.** Rank candidate work by user-visible capability, evidence quality, reliability, autonomy, reuse, cross-project leverage, risk, and cost. Prefer a real functional improvement over a cosmetic report, new scaffolding, or easy checkmark.
4. **Challenge.** Reinspect the proposed target and competing branches/PRs immediately before editing. Check whether the defect or opportunity is already fixed, superseded, duplicated, or blocked.
5. **Act.** Make a bounded, substantive change on a dedicated safe branch. Reuse existing mechanisms where justified; do not copy whole repositories or invent interfaces. Keep the additional cash cost at $0 unless Damien explicitly authorizes otherwise.
6. **Verify.** Run the most relevant available tests and inspect exact-head hosted checks/logs. Add negative tests for important failure/security boundaries. A passing test proves only what that test actually exercises. If verification cannot run, state precisely what was and was not observed.
7. **Review.** Inspect the resulting diff and current repository state again. Look for regressions, race conditions, stale assumptions, duplicate work, and effects on the other worker's scope. Repair attributable failures within the run budget.
8. **Preserve.** Record exact repository, branch, commit, PR, changed paths, commands, test totals, hosted run IDs/statuses, evidence links, known limits, unresolved blockers, and next best action in a durable repository checkpoint or PR description/comment.
9. **Handoff.** If the next action belongs primarily to the other worker, leave a concise handoff with: objective, why it matters, exact source paths/refs, evidence already gathered, work completed, remaining work, acceptance criteria, risks, and whether the other worker can safely proceed. Do not merely say "coordinate."
10. **Repeat.** Within the available run budget, complete multiple observe → choose → challenge → act → verify → review cycles when safe and useful. Do not stop after one trivial change. Do not manufacture extra changes to satisfy an iteration count.

## Shared work coordination rules

- Before starting a new change, inspect all relevant open PRs and active branches. Prefer continuing a sound existing branch/PR over creating a competing implementation.
- Never edit the same feature or files concurrently on separate branches when one worker's active PR already owns that change. The other worker should review, test, identify a distinct complementary improvement, or leave a handoff.
- Use narrow, descriptive branches and PRs. Keep unrelated changes separate.
- A PR is proposed work, not merged or deployed work. Never report a PR as integrated until the merge is observed on the target branch.
- When one worker changes a shared primitive, the other must inspect the resulting diff and exact-head checks before depending on it.
- Cross-worker handoffs are recommendations, not authorization. The receiving worker must independently re-observe current state before acting.
- If the workers' reports conflict, the current repository state, exact commit, source bytes, and independently observed test/CI result outrank either report.
- If no safe, meaningful change is available, perform a useful independent review, reproduce or falsify a claim, close a documented knowledge gap, or record a precise blocker. Do not invent progress.

## Evidence and state rules

- A model assertion is never sufficient evidence that the state it describes is correct.
- Separate source presence, test execution, test result, hosted CI, artifact creation, external observation, authorization, merge, release, deployment, adoption, and user outcome. Do not collapse them into "done."
- Preserve failed attempts, contradictions, rejected claims, negative results, and uncertainty. Do not rewrite history to make the loop look successful.
- Hashes establish byte identity only; they do not establish truth, authorship, safety, authority, or execution.
- Game XP, inventory, status, quest completion, world changes, and canonical progress must be deterministic projections of demonstrated events, never invented by an NPC, model, UI, or scheduler.
- Consequential external actions require the applicable human authorization and independently observable evidence. No self-approval, no bypassing repository governance, no secret/credential changes, no merges, releases, deployments, spending, external publication, or permission changes without explicit authority.
- Preserve $0 additional-cost constraint and phone-controllable workflows where practical.

## Collision, failure, and stop handling

- If a target branch changes during work, fetch the new head and reconcile; never overwrite another worker's commit or checkpoint.
- If a PR or test run is superseded, identify the exact replacement and do not count cancelled or stale runs as failures or passes for the current head.
- If an operation fails, capture the actual error, determine whether it is attributable to the change, and fix it when safe. Do not repeatedly rerun an unchanged failing operation.
- If the same failure recurs without new diagnostic information, stop the loop on that item and escalate with a minimal reproduction and next diagnostic action.
- Stop before destructive, irreversible, costly, externally consequential, credential-sensitive, or founder-authority-bound actions.
- If a worker cannot access the other worker's latest result, say so and continue from repository evidence without pretending coordination occurred.
- Hourly triggers are opportunities to resume; they do not imply uninterrupted background execution or guaranteed ordering. The shared repository state is the continuity mechanism.

## Run record minimum

Each run must leave a concise record containing:

- worker identity and run timestamp;
- prior checkpoint and other-worker result inspected (or access limitation);
- selected objective and why it ranked highest;
- exact files/commits/PRs changed;
- commands and verification evidence, including exact-head status;
- observed outcome versus unverified claim;
- regressions, negative results, and blockers;
- handoff to the other worker, if any;
- next ranked action.

## Acceptance standard

The system is improving only when repository evidence shows at least one of:
- a real defect corrected and independently verified;
- a user capability delivered and tested;
- a reusable mechanism integrated without weakening its guarantees;
- a prior claim reproduced, falsified, or materially clarified;
- a meaningful risk or blocker removed;
- a durable knowledge gap closed in a way that changes the next action.

More commits, more files, more agent activity, and more green checks by themselves are not the objective.

**Founder authority remains with Damien Featherstone.** This protocol coordinates work; it does not transfer sovereignty.
