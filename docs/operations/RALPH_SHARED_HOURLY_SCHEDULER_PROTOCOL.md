# Shared Ralph-Style Operating Protocol
**Status:** Proposed operational contract for the two existing hourly ChatGPT automations  
**Owners:** NGL Repository Stutter-Step Loop (institution-wide reliability and integration) and Build NGL MMORPG (playable-world/runtime capability)  
**Canonical repository:** `ngl-damien/No-Gas-Labs-Alpha-1`

## Purpose

The Repository Stutter-Step Loop and Build NGL MMORPG are two specialist workers in one No_Gas_Labs™ improvement system. They must compound one another's work rather than behave as isolated hourly assignments.

This is a Ralph-style loop: persistent objective, fresh observation, bounded action, independent verification, durable learning, and another iteration. Repetition without measurable progress is not success. A model's assertion is never sufficient evidence that the state it describes is correct.

This protocol coordinates the two existing schedulers. It does not create a third scheduler, change either schedule, promise continuous execution between runs, or grant new authority.

## Universal institutional doctrine\n\nEvery worker governed by this protocol inherits the [No_Gas_Labs™ Institutional Charter](../institution/INSTITUTIONAL-CHARTER.md). It is the canonical, provider-agnostic doctrine for every project, repository, division, experiment, and future initiative—not a Codex-specific mission. Apply its AOTA scope rule and chronological invention lifecycle to research, design, implementation, evaluation, deployment, publication, and preservation. Local task instructions may specialize but may not silently narrow or contradict it.\n\n## Shared objective

Increase the real capability of No_Gas_Labs™ as both:
1. a reliable, reusable, evidence-governed institution and engineering ecosystem; and
2. a genuinely playable, mobile-first MMORPG in which real institutional work produces real, deterministic world consequences.

Treat technical reliability, research, integration, user capability, game runtime, product opportunities, and institutional learning as connected opportunities. Do not force an artificial either/or when work can serve several purposes. Sequence work by evidence, dependency, risk, leverage, and available time.

## MMORPG completion gates and delivery priority

The MMORPG is a product to finish, not an endless source of isolated tickets. The authoritative acceptance criteria live in `docs/operations/MMORPG_COMPLETION_CONTRACT.md`; the current evidence state lives in `docs/operations/MMORPG_COMPLETION_LEDGER.md`.

Worker B must maintain that ledger on every substantive game run. For each gate, record a status, exact source/branch/commit/PR, test or device evidence, known limits, owner/dependency, and next action. Use the defined lifecycle states; do not invent a completion percentage. Distinguish current-main capability from proposed branch work. A draft PR is not integrated capability.

The release gates cover:
- a coherent playable loop from exploration through meaningful action and consequence to progression and return;
- persistent character and world state;
- server-authoritative multiplayer demonstrated by at least two independent clients sharing and changing the same authoritative world;
- core RPG systems, including character development, skills, inventory/equipment, encounters, and quests;
- social and economic systems, including communication, groups/guilds, and safe player-to-player exchange;
- repeatable world/content loops and durable progression;
- an Android-first, mobile-first experience verified on actual supported devices (a web/PWA shell is an interim delivery, not proof of a native Android application);
- operational security, recovery, observability, and performance appropriate to the declared player scale; and
- an evidence-backed release/acceptance pass.

Do not label a prototype, single-player demo, map with clickable panels, or collection of disconnected features an MMORPG. Use honest stage labels: prototype, playable vertical slice, multiplayer alpha, feature-complete beta, release candidate, and released. "Complete" requires every mandatory release gate to be independently evidenced and the Founder acceptance boundary to be satisfied. Deployment or publication still requires explicit authorization.

Prioritize the next unblocked gate that most increases actual player capability. Infrastructure work is justified when it removes a demonstrated blocker, closes a material risk, or directly enables a gate; otherwise it must not displace game delivery indefinitely. Worker A should hand off game-specific blockers with concrete evidence and acceptance criteria, not create parallel gameplay implementations.


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

1. **Rehydrate.** Read this protocol and the [Institutional Charter](../institution/INSTITUTIONAL-CHARTER.md), then the latest repository state, relevant open pull requests and checks, and the latest durable repository checkpoint. Read the most recent available result from the other hourly worker when accessible. Treat prior reports as leads, not proof.
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


## Provider-agnostic, compute-bounded agent workforce

This protocol is the shared execution contract for any capable agent entering an NGL repository, regardless of provider or interface. The workers named above are responsibility lanes, not exclusive model identities. A replacement or additional agent inherits the same objective, reads the same current instructions, inspects the same durable state, and leaves compatible evidence and handoffs.

The loop continues for the full useful execution budget of each run: rehydrate → observe → rank → claim → challenge → act → verify → review → preserve → handoff → repeat. Do not stop after a report or one small change while safe, unowned, high-value work and compute remain. Do not manufacture activity, claim execution beyond the host session, or promise background work after a run ends. Actual stop conditions are exhausted compute/time, unavailable required access, a hard technical blocker, an authority boundary, or no remaining safe meaningful task.

Before claiming work, inspect other agents' latest durable results and active branches/PRs across the relevant repository portfolio. A branch/PR is a coordination claim, not a correctness guarantee. If a global work registry is unavailable, coordinate through durable branch/PR records and explicit handoffs; never pretend a global lock exists. Re-observe before resuming stale claims.

Where available, run the portable preflight (npm run agent:preflight) with every intended target path and the latest checkpoint path. Preserve its machine-readable receipt. The receipt hashes the exact instruction/checkpoint bytes read; it does not prove comprehension, correctness, or execution. If the preflight is unavailable in another repository, follow the manual entry sequence and record that limitation rather than skipping instructions.


## Ralph research specialization — Retrieval State, Monroe Gateway, and the Time Crystal

This specialization extends the universal Ralph loop; it does not replace it, create a parallel workflow, or weaken the evidence, safety, cost, coordination, or Founder-authority rules above. Apply it whenever work concerns the uploaded **Executive Summary** on retrieval states / temporal linkage or the **Founder-Operated Monroe Gateway Protocol for No_Gas_Labs™**, and to downstream research, software, experiments, and institutional decisions derived from them.

### Required Ralph cycle and research gates

For substantial research or implementation in this program, explicitly execute the account-wide Ralph cycle:

**Rehydrate → Observe → Define → Rank → Baseline → Act → Challenge → Verify → Transfer → Recover → Preserve → Repeat.**

Map these stages onto the repository's shared worker loop. Do not omit stages because a task appears creative, speculative, or small. Routine low-risk tasks may use a lightweight version, but research claims and consequential changes require the full version.

1. **Rehydrate:** Retrieve the current versions of both source documents, the relevant Alpha One records, protocol version, prior session records, open PRs, and the last durable Ralph checkpoint. Treat reports and summaries as leads until their source evidence is inspected.
2. **Observe:** Separate (a) direct observations, (b) user-supplied hypotheses, (c) published or archival claims, (d) model interpretations, and (e) unknowns. Preserve exact wording and provenance where material. Never silently promote a hypothesis to a finding.
3. **Define:** State the question, operational definitions, primary outcome, comparison condition, falsifiable prediction, exclusion rules, data-quality criteria, stopping rule, and decision that the result is intended to inform.
4. **Rank:** Prioritize safety, evidence quality, feasibility, cost, and the highest-value uncertainty. Keep the program founder-only during formation; do not open Neophyte intake or recruit a public participant cohort under this instruction.
5. **Baseline (M0):** Before changing a protocol, workflow, or analysis, preserve its exact version and record the current performance / behavior / evidence state. Define a protected comparison and the metrics that will be used to judge M1. For cognitive tasks, use repeatable baseline tasks and record practice/order effects; do not compare unlike tasks or selectively chosen sessions.
6. **Act:** Make one bounded, versioned intervention at a time. Record the exact audio asset and version, session duration, device and settings, environment, task, timing, and deviations. Keep the additional cash-cost limit at $0 unless the Founder explicitly authorizes otherwise.
7. **Challenge:** Actively try to disprove the apparent result. Check sensory leakage, target-selection leakage, cueing, memory contamination, expectancy, confirmation bias, judge bias, optional stopping, multiple comparisons, selective exclusions, device artifacts, and ordinary cognitive explanations. Include negative controls and shuffled / decoy comparisons where relevant.
8. **Verify:** Use preregistered analysis and independent verification where the claim requires it. A founder-only self-session can test usability, safety, repeatability, and data capture; it cannot by itself establish blinded remote-viewing accuracy, eliminate expectancy effects, or demonstrate retrocausal information transfer. Never claim an EEG/HRV pattern proves a Gateway state or validates anomalous information access.
9. **Transfer:** Test whether any claimed improvement generalizes to a different, previously unseen task or target set, with the same frozen protocol and scoring rules. A result that only works on the task used to tune it is not a demonstrated capability.
10. **Recover:** Conduct a fresh-session recovery test: restore the protocol, raw data, analysis code, target commitments, and decision history from durable records without relying on conversational memory. Verify hashes and signatures, and document what they do and do not establish.
11. **Preserve:** Append the complete session / experiment record, raw-data references, protocol version, deviations, failed attempts, null findings, analysis, limitations, and decision to Alpha One's existing evidence ledger. Preserve prior versions; corrections are new linked records, never silent overwrites.
12. **Repeat:** Continue only while a safe, meaningful, unowned question remains and the evidence can improve the next decision. Stop or redesign when predeclared futility, safety, data-integrity, or cost boundaries are reached. Do not keep iterating merely to produce a positive result.

### Scientific claim boundaries

Maintain separate, explicitly labeled hypotheses; do not collapse them into one claim:

- **Cognitive retrieval-state hypothesis:** a repeatable induction may change attention, relaxation, imagery, recall, or performance on specified ordinary cognitive tasks. These are measurable cognitive / behavioral outcomes and do not imply access to information outside normal channels.
- **Blinded target-information hypothesis:** Gateway preparation may or may not change performance on a controlled remote-viewing task. Test it against CRV-only, Gateway-only, and ordinary / sham control conditions with randomized targets, strict target custody, sealed responses, independent blind judging, preregistered scoring, and replication.
- **Temporal-linkage / future-state hypothesis:** a response irreversibly committed at T1 may or may not correspond to genuinely unpredictable target content generated only after that commitment at T2. A target selected earlier but revealed later is not a future-origin target. Treat this as a distinct, higher-burden hypothesis. Predefine and independently audit the temporal ordering, future entropy source, target-generation procedure, response and target commitments, trusted timestamp source, information barriers, analysis, and controls before any trial. A later match is an anomaly to investigate, not proof of backward causation; leakage, ordinary prediction, chance, retrospective selection, and analysis flexibility must be challenged.
- **Neurophysiological hypothesis:** EEG, HRV, or other sensors may characterize correlates of a session. They are secondary or manipulation-check measures unless independently validated for a specific claim; do not infer hemisphere synchronization, a special state, or anomalous information transfer from a generic spectral change.
- **Computational Time Crystal:** use this name for the proposed auditable temporal information system only as an explicitly identified engineering metaphor. Model immutable historical events, timestamped observations, versioned forecasts / scenarios, and causal or dependency links. Do not describe this software model as a physical time crystal, time travel, precognition, or a demonstrated mechanism for retrocausality. In physics, time crystals are a distinct physical phase / dynamical phenomenon and do not establish backward information transfer.

Historical-source discipline is mandatory: distinguish the U.S. Army 1983 Gateway report's authorship from its later presence in the CIA Reading Room; distinguish SRI / SAIC research and the broader Stargate program; and represent the 1995 outside evaluation as reporting laboratory statistical effects while finding remote viewing insufficiently reliable for operational intelligence use. Do not say that CIA archival custody proves CIA authorship, endorsement, or validation. Keep documented fact, disputed evidence, hypothesis, and unsupported assertion visibly separate.

### Experimental integrity and founder-only stage

- The first founder-only stage is a **feasibility / instrumentation / repeatability pilot**, not a confirmatory paranormal study. It may establish that the Founder can run the protocol consistently, that records are complete, and that ordinary cognitive or physiological outcomes can be measured.
- Do not treat repeated trials by one person as independent participants. Account for within-person dependence, practice effects, fatigue, expectancy, and order effects.
- Any later claim of above-chance target information requires a prospectively specified target pool, independent target custodian, randomized assignment, no target access by the participant or session operator, response sealing before feedback, blind judges who do not know target or condition, decoy / shuffled controls, predeclared scoring, multiplicity control, and an independent replication plan.
- Do not inherit sample-size numbers from a draft as settled power analysis. Calculate power from the exact primary outcome, unit of analysis, design, smallest effect of interest, clustering / repeated measures, attrition, and multiplicity. A small pilot estimates feasibility and variance; it does not validate efficacy.
- Freeze the protocol and analysis plan before confirmatory data collection. Any deviation or exploratory analysis must be labeled and logged as such. Report all registered outcomes, nulls, adverse events, exclusions, and protocol deviations.
- For self-study, participation is voluntary. Use a safe seated or reclined setting, comfortable audio volume, breaks, and immediate stop on distress, dizziness, headache, hearing symptoms, or other adverse effects. Do not use the protocol as medical treatment or a substitute for clinical advice. If a relevant seizure, cardiac, hearing, or other medical concern exists, do not proceed without appropriate professional guidance. Do not make unsupported claims that binaural audio is universally benign or that an EEG pattern verifies a proprietary Focus level.

### Time Crystal evidence model and Alpha One integration

Alpha One remains the single institutional source of truth. The Founder Decision Chamber is the private founder control surface for review, authorization, and adjudication; it is not a second ledger. Do not create a competing database, parallel authority service, or separate blockchain as a prerequisite.

Every experiment/session should be represented by append-only, linked records with at least:

- `protocol_id`, immutable `protocol_version`, source-document references, and a content hash;
- `session_id`, trial ID, condition, operator / participant role, and consent / safety status;
- UTC event timestamp, clock source, precision / uncertainty, and sequence number;
- baseline and post-session observations, task definition, raw response reference, and deviations;
- target ID / commitment and custody metadata, access-control evidence, and reveal time where applicable;
- raw-file references, cryptographic hashes, signature / signer identity, and backup / recovery references;
- analysis version, preregistered outcome, score, judge identity / blinding status, and adjudication;
- claim classification (observation, inference, hypothesis, forecast, or decision), confidence / limitations, and links to supporting or contradicting evidence;
- causal / dependency edges that state their relation type and evidence basis, without presenting correlation as causation.

The ledger stores events and provenance; current-state screens are deterministic projections of those events. Forecasts and scenarios are versioned, labeled as forecasts, and never overwrite historical records. Hashes prove byte identity relative to a recorded digest, not truth, authorship, safety, or scientific validity. Use existing Alpha One signing, custody, and evidence mechanisms where available; do not assume those mechanisms are implemented or verified until inspected and tested.

The Founder Decision Chamber may display session status, evidence completeness, deviations, risk flags, pending approvals, and adjudication history. Founder authorization must be explicit, authenticated, scoped, and logged. No automated agent, model, sensor, forecast, or experimental result may grant itself authority or alter Founder authority. Maintain the founder-only formation boundary and the existing no-automatic-transfer rule.

### Transfer, continuity, and the 2048 horizon

Treat each research cycle as an institutional capability test: can the next session be prepared, run, audited, challenged, and recovered with less friction and stronger evidence than the previous one? Measure net benefit against the full costs of time, equipment, compute, storage, and attention; activity volume is not compounding.

The **Temporal Reconnaissance Unit (T.R.U.)** remains a future formal institution in the user's imagined **2048 second-presidential-term scenario**. Do not represent it as currently established. Present-day work may build and test precursor methods, records, and capabilities, while preserving the 2048 milestone as a future-state scenario rather than a forecast or fact.

### Acceptance criteria for this specialization

A Ralph iteration in this research program is accepted only when its record makes clear:

1. which hypothesis or operational question was addressed;
2. which source version, protocol version, and M0 baseline were used;
3. what was actually done, by whom, and when;
4. what raw evidence exists and how its integrity / custody were checked;
5. what analysis was preregistered versus exploratory;
6. what result was observed, including nulls and adverse events;
7. what alternative explanations were challenged and what remains unresolved;
8. whether the result transferred to an unseen task;
9. whether a fresh session recovered the required context and evidence; and
10. what decision follows, with Founder authorization where required.

A complete session log is not proof of the hypothesis. A clean hash is not proof of a true claim. A positive pilot is not independent replication. A proposal, PR, dashboard, or simulated record is not a delivered capability. These distinctions are part of the Ralph contract.


### Reconciliation with the T.R.U. temporal-retrieval integration contract

This Ralph specialization is the **operating and evidence-quality layer** for the proposed T.R.U. research integration in PR #372. The companion contract, when accepted, defines the T.R.U. workbench integration boundary, staged experiment architecture, proposed artifact families, and scientific-proof distinctions. This protocol governs how Ralph workers rehydrate, prioritize, baseline, execute, challenge, verify, transfer, recover, and preserve work under that contract. Neither document creates a parallel ledger, second Founder Gate, new scheduler, or present-day formal T.R.U. institution.

Use the staged order from the T.R.U. contract rather than treating all experiment arms as immediately executable:

1. **Stage A — computational temporal retrieval benchmark:** validate deterministic event retrieval, immutable versions, known-ground-truth fixtures, corruption handling, persistence, and fresh-process recovery. This tests software behavior, not anomalous cognition.
2. **Stage B — response-before-future-target feasibility:** only after Stage A, and only with an independently operated target generator, demonstrate that the exact response is irreversibly committed and externally timestamped before fresh unpredictable target content is generated. Verify custody, entropy provenance, timestamps, access logs, blinding, and independent scoring. A target chosen before the response and merely revealed afterward does not satisfy this gate.
3. **Stage C — Gateway interaction:** only after Stage B's protocol and non-Gateway baseline are technically valid, test whether Gateway/Hemi-Sync preparation adds an effect. Randomized and counterbalanced Gateway versus matched-control conditions may be introduced. The four-arm Gateway+CRV / CRV-only / Gateway-only / ordinary-control design is a later factorial comparison, not a shortcut around Stage B validation or independent target custody.
4. **Replication and claim upgrade:** no confirmatory efficacy claim or strong anomalous-information claim follows from a feasibility pilot. Require preregistration, power based on the exact primary outcome and unit of analysis, independent blind scoring, transparent null reporting, adversarial leakage review, and preregistered independent replication.

For current founder-only formation, keep software feasibility, personal session repeatability, and ordinary cognitive / physiological measures explicitly separate from blinded target-information evidence. Founder-only describes the institutional phase and participant intake boundary; it does not waive the need for independent target custody, judging, or verification when a future experiment makes claims that require them.

The shared Alpha One evidence architecture remains authoritative: the T.R.U. workbench may prepare and inspect research cases; the existing Alpha One ledger retains accepted institutional events and exact artifact references; the Founder Decision Chamber remains the private founder authorization / adjudication surface. Proposed `temporal.*.v1` artifact types in the companion contract are proposals until schemas and validators are actually implemented and tested. Do not describe them as live contracts.

