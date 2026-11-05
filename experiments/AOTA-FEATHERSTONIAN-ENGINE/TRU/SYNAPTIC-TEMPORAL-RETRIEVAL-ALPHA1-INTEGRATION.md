# Synaptic Temporal Retrieval — Alpha 1 Integration Contract

**Status:** Proposed research/integration contract; not an approved scientific result or production capability.  
**Institutional home:** No_Gas_Labs™ Alpha 1 → existing T.R.U. temporal evidence workbench.  
**Scope:** Founder-only research formation. No public participant intake, external deployment, or authority expansion is implied.

## 1. Integration decision

Extend the existing T.R.U. workbench; do not create a parallel institution, a competing evidence ledger, or a second Founder Gate.

The current T.R.U. kernel already reconstructs temporal events, distinguishes OBSERVED / REPORTED / INFERRED / SIMULATED / FICTIONAL modes, validates source lineage, compares incumbent/candidate claims, and keeps imported assurance labels untrusted. Alpha 1 already supplies the strict institutional kernel, durable hash-chained ledger, authenticated Founder boundary, content-addressed artifacts, and explicit claim → authorize → execute → observe → adjudicate lifecycle.

Reuse those mechanisms:

- **T.R.U. workbench:** temporal case definition, hypothesis comparison, session inspection, scoring packet preparation, and research exports.
- **Alpha 1 institutional kernel:** scoped authorization and event lifecycle; no new role or self-enrollment.
- **Alpha 1 durable ledger:** append-only institutional decisions and event references; exact artifacts stored by digest. A hash chain is not proof that an event is true.
- **Evidence Archive / Source Observatory:** retain source provenance, primary documents, protocol versions, preregistrations, analysis plans, datasets, deviations, and independent reviews as versioned research artifacts.
- **Founder Gate:** governs whether institutional resources or publication actions are authorized. Founder approval is not scientific validation and cannot rewrite blind scores or raw observations.

This document defines the integration boundary. It does not claim the workbench has been modified to run live trials, that the temporal hypothesis is true, or that Alpha 1 has gained a time-manipulation capability.

## 2. Preserve the research hypothesis

The core hypothesis must not be reduced to ordinary prospective memory:

> A retrieval state may be established at a particular temporal distinction. Once a connection is established, information associated with that state may be retrievable from another temporal point. One proposed case is that a person's future state establishes information or a connection that their present state can access.

Keep this as a hypothesis. Do not assume a mechanism, identity continuity, retrocausality, precognition, or successful information transfer.

Operational terms:

- **Temporal state:** a bounded, timestamped configuration of a participant, system, protocol, or information object.
- **Temporal distinction:** a declared boundary between states or events, including the time at which information becomes available.
- **Retrieval state:** a predeclared state in which a participant or computational process attempts to recover specified information.
- **Connection:** a hypothesized relation between two temporal states, defined before analysis by a protocol-specific observable or predicted dependency.
- **Retrieval event:** a timestamped response, machine output, or independently scored record produced under a fixed protocol.
- **Future-origin information:** target content generated only after the response is irreversibly committed, from an independently audited source unavailable to participant and session personnel beforehand.
- **Temporal blurring/activity:** a descriptive label for a hypothesized reduction in separability between temporal states; it must be translated into measurable variables per experiment and cannot itself serve as an explanation.
- **Identity continuity:** the protocol's explicit claim that the same participant or system is linked across the two states; identity continuity does not imply information transfer.

Keep interpretations separate: computational indexing, psychological memory/prediction, conventional physical time symmetry, retrocausal models, and anomalous information acquisition are competing explanations, not interchangeable labels.

## 3. Hypothesis families and discriminating predictions

Each study must specify which model it tests and what observation would distinguish it.

| Model | Candidate explanation | Discriminating checks |
|---|---|---|
| Ordinary cognition | Memory, expectation, priming, guessing, reconstruction | Randomized targets, response-before-target ordering, sham trials, confidence calibration, leakage audits |
| Information leakage | Human, software, metadata, timing, or network channel | Adversarial red-team review, isolated target generation, access logs, sealed files, independent operators |
| Retrospective selection | Flexible matching after target reveal | Frozen response, predeclared scoring, decoys, blind independent judges, no post-hoc target choice |
| Predictive processing | Participant predicts target distribution or experimenter intent | Uniform target distributions, target-set audits, balanced cues, preregistered baseline |
| Conventional time-symmetric physics | Formal descriptions with time-symmetric boundary conditions | State the exact physical model and derive a measurable prediction; do not infer usable backward signalling from delayed-choice or post-selection results |
| Anomalous information acquisition | Information about a target appears before ordinary access | Future-generated target protocol, strict blinding, independent replication, robust above-chance effect under adversarial audit |
| Computational temporal retrieval | A system retrieves prior records by index, event relation, or state transition | Reproducible retrieval benchmark, exact query/record lineage, latency and corruption tests |

Quantum formalism, delayed-choice experiments, or mathematical time symmetry do not by themselves demonstrate controllable communication into the past. Any proposed physical mechanism must make a distinct prediction beyond established no-signalling results and must be evaluated against the relevant literature.

## 4. Staged experimental program

### Stage A — software-only temporal retrieval benchmark

Build a deterministic benchmark for retrieving records across declared temporal boundaries. It tests the data model, not anomalous cognition.

Acceptance:
- immutable protocol and dataset versions;
- synthetic event sequences with known ground truth;
- deterministic retrieval by event ID, state relation, and allowed temporal window;
- negative tests for missing, duplicated, reordered, corrupted, and future-inaccessible records;
- measured retrieval accuracy, latency, persistence, and recovery after process restart;
- independent replay from exported artifacts.

### Stage B — response-before-future-target experiment

The target must not exist in accessible form when the participant responds.

1. Independently generate a trial nonce and protocol ID; publish or externally timestamp the protocol version and target-generation rules.
2. The participant records a response in a controlled interface. The exact response bytes, trial ID, and protocol digest are committed before target generation. The commitment must be independently timestamped; the participant cannot edit the committed response.
3. Only after that commitment is externally observable, an independent target generator obtains fresh, unpredictable entropy and generates the target packet. A preselected public randomness beacon may be used only if its relevant future pulse is not yet available at response time; alternatively use audited hardware entropy with independent custody and logs.
4. Publish a target commitment immediately after generation, then reveal the target packet to the scoring team only after the response commitment is locked. Preserve generator version, entropy-source evidence, timestamps, target-set definition, and custody logs.
5. Independent judges, blind to trial condition and participant identity, score the frozen response against the target and predeclared decoys using the registered rubric.
6. Release a reproducible packet containing response commitment, target commitment, timestamps, source attestations, scoring records, deviations, and analysis.

**Critical distinction:** a target selected now but revealed later is not future-origin information. A target generated by a process whose output is already determined or accessible before the response is not a clean test. The protocol must establish that the target content was generated only after the response commitment and that neither participant nor intermediaries could predict, inspect, or influence it. A future public randomness pulse can supply unpredictable entropy, but it does not by itself prove metaphysical future-to-past communication. If target generation occurs after the response in ordinary forward time, any earlier match is an anomaly to explain, not a pre-labelled proof of retrocausality.

### Stage C — Gateway-state interaction

Only after Stage B is technically valid and the non-Gateway baseline is stable:

- randomize and counterbalance Gateway/Hemi-Sync preparation versus matched non-Gateway control;
- standardize duration, instructions, environment, rest, and target protocol;
- blind judges and, where feasible, the session operator;
- record subjective experience separately from target accuracy;
- test the incremental effect of Gateway condition rather than presuming efficacy;
- report nulls, adverse experiences, protocol deviations, and all registered outcomes.

### Statistical and replication contract

Before data collection, publish: primary outcome, scoring rubric, target pool and decoys, randomization algorithm, sample-size/power rationale, minimum effect of interest, exclusion rules, missing-data handling, multiple-comparison correction, Bayesian priors/sensitivity analysis, frequentist test, stopping rule, and replication threshold.

Use independent target generation and independent scoring. No optional stopping, p-hacking, post-hoc target matching, selective trial deletion, or changing primary outcomes after unblinding. Determine sample size from a preregistered effect-size threshold and desired power; run a simulation-based power analysis using the actual scoring distribution before enrolling participants. A successful pilot is not confirmatory evidence. Require a preregistered independent replication before upgrading the claim.

## 5. Temporal Evidence Ledger integration

Use Alpha 1's existing content-addressed artifact and institutional-ledger mechanisms rather than creating a second authority ledger.

Proposed research artifact types:
- temporal.protocol.v1 — protocol, hypotheses, blinding, scoring, exclusions, analysis plan.
- temporal.preregistration.v1 — frozen hypotheses, outcomes, power plan, stopping rule, and timestamp evidence.
- temporal.response-commitment.v1 — response bytes/digest, trial ID, protocol digest, and trusted timestamp reference.
- temporal.target-commitment.v1 — post-response target digest, generator version, entropy-source reference, and timestamp.
- temporal.scoring.v1 — blind judge IDs, rubric version, item scores, and adjudication lineage.
- temporal.deviation.v1 — deviations and their timing; never overwrite the original record.
- temporal.analysis.v1 — reproducible code, environment, raw/derived dataset digests, and full registered analysis.
- temporal.replication.v1 — independent site/operator, protocol digest, deviations, and outcome.

These are proposed schemas, not existing runtime contracts. Every artifact must have a schema version, exact byte digest, provenance, creation time, actor/process attribution, and explicit assurance state. Preserve corrections as new linked events; never overwrite raw responses, target packets, or prior scores.

Map institutional work through the existing lifecycle: claim the proposed research action, obtain Founder authorization for its exact scope, execute the protocol, attach observations and external evidence, and record the Founder disposition. Scientific scoring remains independently governed by the preregistered blind process. Founder adjudication controls institutional acceptance or resource decisions; it does not make a scientific result true.

A hash chain proves only that retained bytes are linked relative to a trusted head. It does not prove the target generator was honest, the clock was accurate, a participant's identity, that blinding held, or that a claim is true. Use external timestamping, independent custody, signed attestations, and replication to strengthen those separate claims.

## 6. Alpha 1 implementation boundaries

**Reuse now**
- Existing T.R.U. tru.case.v1 timeline and evidence references for research case inspection.
- Existing T.R.U. validation and canonicalization patterns for bounded imports and deterministic exports.
- Existing institutional kernel and ledger for scoped authorization, durable event history, and exact artifact references.
- Existing Source Observatory / Evidence Archive for source review, preregistration, and independent replication records.

**Do not silently change**
- Existing Founder roles, key custody, identity, session authentication, or authority semantics.
- Existing kernel stage definitions or self-observation restrictions.
- Existing T.R.U. claim/evidence assurance meanings.
- Existing research case schemas or imported fixture semantics.
- Existing public intake, Witness privileges, XP, quests, publication, or deployment policy.

**Future runtime work (separate implementation PRs)**
1. Define and test the temporal.*.v1 artifact schemas and strict validators.
2. Add a local Stage A benchmark runner with deterministic fixtures and exact output receipts.
3. Add the response/target commitment service with an independently operated target generator and trusted timestamp interface.
4. Add blind scoring import and independent analysis verification.
5. Add Stage C randomization and condition tracking only after Stage B infrastructure passes.
6. Add Alpha 1 UI projections only as read-only views of accepted events and versioned artifacts.

No AI agent, participant, scoring process, browser UI, or imported JSON may self-assign Founder authority, independently verify its own claim, change protocol criteria after preregistration, or promote an experiment to OBSERVED without the required external evidence.

## 7. Time Crystal engineering boundary

For Alpha 1, treat “Time Crystal” as a computational research metaphor unless a separate physical time-crystal hypothesis is specified.

Candidate software properties:
- repeatable event cycles under a fixed protocol;
- stable, versioned state transitions;
- synchronization and drift measurement across clocks;
- retrieval latency and temporal-window precision;
- persistence and deterministic replay;
- resilience to missing, reordered, duplicated, and corrupted events.

These properties can establish a robust temporal information system. They do not establish a condensed-matter time crystal, physical time symmetry breaking, time travel, or future-to-past signalling.

## 8. Scientific proof and non-empirical evidence

The broader No_Gas_Labs™ thesis remains intact: non-empirical evidence may independently satisfy proof for claims whose truth conditions are logical, mathematical, formal, definitional, or otherwise appropriately established without physical observation. Do not impose empirical measurement as a universal requirement for every kind of proof.

For claims about physical information transfer across time, the standard must fit the claim: formal arguments can establish mathematical consequences and rule out classes of models, while empirical experiments are needed to establish that a physical process actually occurs. Documentary provenance, testimony, subjective reports, and theoretical coherence remain evidence with defined scope; they must not be relabelled as measurements of future-origin information.

## 9. Formation and governance

This is a founder-only research formation effort. The present T.R.U. workbench is a prototype/precursor and research instrument; this integration does not move the user's stated 2048 second-term formalization horizon for the Temporal Reconnaissance Unit. No public participant intake is authorized by this document.

## 10. Acceptance gates

- [ ] This contract is reviewed against the current T.R.U. workbench and Alpha 1 kernel/ledger.
- [ ] Proposed artifact schemas are frozen and have positive and adversarial negative tests.
- [ ] Stage A benchmark passes deterministic replay, corruption, persistence, and recovery tests.
- [ ] Stage B target generation is independently audited and demonstrably occurs after response commitment.
- [ ] Preregistration, randomization, blinding, and scoring are reviewed by an independent methodologist.
- [ ] Gateway condition is introduced only after Stage B baseline and instrumentation are stable.
- [ ] Independent replication is completed before any strong anomalous-information claim.
- [ ] Founder Gate authorization and scientific validation remain separate.
- [ ] No result is promoted beyond the evidence actually obtained.

**Current state:** proposed architecture only. No new runtime capability, experiment, result, external attestation, independent replication, production deployment, or scientific conclusion is claimed.
