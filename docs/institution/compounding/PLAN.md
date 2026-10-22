# Alpha 1 two-task implementation plan

> For agentic workers: use bounded subagent implementation and independent review. Damien already commissioned autonomous parallel engineering and supplied the revised specification; do not introduce repeated approval stages.

Goal: test one reusable production improvement across two useful deliverables while retaining honest governance, continuity and Witness boundaries.

Specification: `experiments/AOTA-FEATHERSTONIAN-ENGINE/ALPHA1-INSTITUTIONAL-THESIS.md` imported unchanged from `a9d4389fa9c3431c561311399980d6504f7b530a`. Meteor baseline is `cab8dfb0d6ae41626db8010ae300210ccd0ca7a2`. Import commit preserves the original defective Python program for reproduction. Read the reconciliation contract as well.

## Architecture and constraints

Node24/Python standard libraries; zero additional provider expenditure. Existing kernel, ledger, courier, Forge, shared world and source history remain. Native Codex workers perform engineering; no external AI transport is claimed. Work on `institution/2026-10-18-compounding`, with no force push, blind branch merge or public deployment. A specification is not an execution receipt.

Task A repairs and delivers the real AOTA local evidence inspector. M0 is the actual Meteor game/source exporter at `cab8dfb`: it exports the workshop, not arbitrary institutional components. M1 adds a reusable, explicitly declared component exporter with byte manifests and fail-closed public-source boundaries. This is a capability-expansion experiment, not a claim that M0 was defective at its original game-export purpose, and not a speed comparison between unequal outputs.

Task B repairs and delivers the independently useful T.R.U. temporal evidence workbench. Its acceptance profile is frozen before M1 implementation. The machinery worker receives only the Task A profile and generic profile schema. Task B is evaluated afterward by the owning parent against the frozen profile. No tuning after Task B results may be reported as held-out evidence.

## Frozen delivery acceptance

For each task: all profile files must appear with exact source bytes and retained paths; ZIP CRCs and independent SHA-256/size checks pass; no runtime, credential or traversal path enters; fresh extraction runs the component's real tests and documented entry point. M0 and M1 receive the same source snapshot and acceptance profile. Report accepted required files and actual executable checks, failures, raw outputs, source/harness hashes and elapsed time. Retain M0 rollback at `cab8dfb`; M1 remains an experimental candidate, with no automatic production promotion.

Task A must preserve the 21 original Python cases and add real NUL, invalid digest, duplicate inode/bytes, symlink and oversized/malformed input regressions. No local evidence-kind label becomes independent verification or authority.

Task B must preserve the 14 original Node cases and add malformed case/schema/reference/workload comparison tests. Imported assurance remains untrusted. Invalid references or unequal tests cannot yield a reviewable packet. Browser imports/deadline edits invalidate stale export. Actual primary lineage sources retain their provenance; authored future history stays fictional.

## Tasks and ownership

1. **Task A:** `experiments/AOTA-FEATHERSTONIAN-ENGINE/{engine.py,test_engine.py,example_claims.json,README.md}`. Capture initial parse/test failure; repair; execute meaningful tests and CLI; document residual filesystem trust/race limits. Worker owns only these files plus `docs/institution/compounding/task-a.md`.
2. **Machinery M1:** `src/production/component-package.mjs`, `scripts/package-component.mjs`, `test/component-package.test.mjs`. Export `buildComponent({rootDir,profile,outDir}) -> {archivePath,manifestPath,manifest}`. Profile is `ngl.component-profile.v1`, `id`, `files:[{source,target}]`, `entryPoint`; target paths remain repository-relative. No arbitrary shell, auto merge or authority. Permit declared JSON while rejecting private/runtime/credential paths, symlinks, hardlink aliases, duplicates, absolute/traversal/NUL and mutable inputs. Use a standard ZIP and exact byte manifest. Worker sees Task A only.
3. **Task B:** `experiments/AOTA-FEATHERSTONIAN-ENGINE/TRU/{core.mjs,index.html,test.mjs,README.md}` plus `examples/real-lineage.case.json` and `docs/institution/compounding/task-b.md`. Worker receives frozen requirements without M1 implementation or results. Validate source before execution; RED→GREEN real regressions.
4. **Governance:** `src/institution/decisions.mjs`, `test/institution-decisions.test.mjs`, scoped documentation. Export durable `openDecisions({directory,now?})` with `setPolicy(actor,policy)`, `create(actor,proposal)`, `decide(actor,input)`, `snapshot(actor)`, `close()`. Trusted server actors: Founder `{id:'damien',role:'founder'}`, evaluator `{id:'local-evaluator',role:'executor'}`, Witness `{id,role:'witness'}`. Policy requires authenticated Founder, explicit `reviewWindowMs` and `basis`; no invented operational deadline. Pending proposals retain exact evaluation artifact SHA-256 bytes, scoped proposed effect, risks and rollback. Decisions APPROVE/REJECT/DEFER require Founder, exact expected revision and request id; enforce expiry, replay, durable history, restart, tamper and one writer. Approval records a disposition and never executes source promotion. Public snapshot redacts evaluation/private details.
5. **Root integration and evidence:** source-bound paired comparison, fresh-process recovery using only durable context, HTTP Gate routes using existing session authentication/Origin checks, and grounded project/accomplishment/dispute/decision interface. Root owns game server/client integration, experiment scripts, source profiles, recovery and final report. No imported packet or label grants XP, identity or authority.

## Review focus

- Candidate packaging must not silently broaden source export into keys/private state; independently inspect exact delivered ZIPs.
- A green Node suite can omit a broken Python component; execute both languages explicitly.
- Local signatures, hashes and role IDs do not establish independent people or authenticated external witnesses.
- Measure actual Founder interventions separately from automated steps or required-operator-step proxies. With no observed M0 human baseline, burden improvement is INCONCLUSIVE.
- A fresh process is a process-level continuity test, not proof of a fresh cloud restoration. A localhost Gate is locally tested, not an externally reachable HTTPS release.

## Verification order

Capture imported baselines → freeze profiles → focused RED/GREEN workers → independent review → freeze source → paired M0/M1 Task A and held-out B extraction/tests → fresh-process recovery → full repository checks and actual browser/HTTP probes → preserve evidence/commits/artifacts. Report each M1–M7 milestone independently. Strong Alpha1 success remains unestablished unless the full thesis criteria, actual burden benefit and live Gate are evidenced.
