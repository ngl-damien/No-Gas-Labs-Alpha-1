# Proof-Carrying Work Exchange

**Status:** Commercial thesis and implementation wedge
**Audience:** prospective design partners, builders, and operators
**Date:** 2026-09-20

## The commercial leap

NGL Mesh should not compete as another chat assistant, model wrapper, or generic Android automation layer. Those products sell access to intelligence. Mesh can sell something harder to obtain and easier for a business to budget for: **evidence that an AI-produced result is fit to accept**.

The product is a **Proof-Carrying Work Exchange**:

> A customer posts a bounded job. One or more AI or human execution nodes produce candidate work. Mesh records the inputs, methods, evidence, checks, failures, authorizations, and final acceptance decision. The customer pays for accepted work and a durable proof package—not for unverifiable model output.

This turns the existing provenance and authority ideas into a transaction-shaped product without claiming that provenance makes an answer true. It makes the path to acceptance inspectable.

## Why this is more valuable than another assistant

Businesses already have access to cheap model output. Their expensive problems are rework, review, disputes, missed evidence, unclear responsibility, and the inability to explain how a deliverable was produced. Mesh targets the budget attached to those failures.

The initial customer does not need to trust an autonomous agent. They only need to trust a deterministic acceptance protocol enough to run a small paid pilot.

## The first wedge: evidence-backed deliverables

Start with jobs that are narrow, repeatable, and reviewable:

1. **Vendor and market brief:** collect public sources, extract claims, flag contradictions, and return a citation-backed brief.
2. **Repository due-diligence packet:** inventory a codebase, identify security and maintenance signals, and attach evidence to each finding.
3. **Policy-to-control mapping:** map an internal policy to an evidence checklist and identify missing controls.
4. **Grant or procurement response pack:** assemble requirements, draft responses, and show which source supports every material claim.

These are not promises of correctness. They are deliverables with explicit acceptance criteria and an inspectable evidence trail.

## Product loop

```text
CUSTOMER JOB
    -> acceptance criteria + budget + deadline
    -> execution nodes propose plans
    -> Mesh runs independent collection / transformation / challenge passes
    -> candidate artifact + provenance graph + failure evidence
    -> customer or delegated reviewer accepts, rejects, or requests revision
    -> accepted package becomes reusable evidence
    -> Mesh learns which nodes and checks produce accepted work
```

A model proposal, connector response, or file never becomes authoritative merely by appearing in the graph. Only the stated acceptance path can mark work as accepted.

## How Mesh earns money

The product should support several revenue surfaces, but launch with one simple meter:

| Revenue surface | Buyer | Initial pricing hypothesis | Why it can work |
|---|---|---:|---|
| Verification runs | Teams with recurring AI work | $0.50–$5 per run or monthly minimum | Directly tied to usage and review savings |
| Managed job execution | SMBs without internal AI operations | $250–$1,500 per bounded job | Converts the protocol into an outcome |
| Private evidence workspace | Regulated or proprietary teams | $500–$3,000/month | Keeps sensitive artifacts in a controlled environment |
| Exchange take-rate | Buyers and specialist execution nodes | 10–20% of accepted job value | Creates a network effect after demand exists |
| Enterprise integration/support | AI vendors and consultancies | Contract pricing | Monetizes deployment, controls, and custom adapters |

These are hypotheses for customer discovery, not guaranteed earnings or financial projections. The first milestone is **one customer paying for one accepted job**, not token issuance, speculative yield, or a large marketplace.

## The smallest sellable MVP

The first version does not need Android, a token, a public marketplace, or autonomous money movement. It needs a buyer-visible proof package.

### Inputs

- job description;
- explicit acceptance criteria;
- source references or permitted connectors;
- execution-node declarations;
- human reviewer identity or role;
- optional budget and deadline metadata.

### Outputs

- the requested artifact;
- a content-addressed manifest;
- source and transformation records;
- claim-to-evidence links;
- check results and failed checks;
- reviewer decision;
- a machine-readable verification report;
- a stable shareable report for procurement or internal review.

### The paid demo

A prospect uploads a vendor PDF or repository URL and asks for a defined diligence packet. Mesh returns:

- an executive summary;
- a list of claims with evidence links;
- unsupported or conflicting claims;
- reproducible check commands where applicable;
- a review queue;
- an acceptance receipt that names exactly what was accepted and what remained unresolved.

The demo should be usable by a nontechnical buyer in under ten minutes and should make uncertainty visible instead of hiding it behind a confidence score.

## Trust boundaries that are part of the product

The trust model is the differentiator and must remain testable:

- A model may propose work; it cannot authorize itself.
- A connector may return evidence; it cannot rewrite canonical state.
- A failed execution remains evidence rather than disappearing from the report.
- A superseded or replayed control record cannot silently reactivate.
- A customer acceptance event is separate from model confidence.
- Missing provenance or ambiguous authority stops acceptance instead of being papered over.
- A report must distinguish **verified process facts**, **source claims**, **model inferences**, and **customer decisions**.

Mesh sells accountable process, not a magical truth badge.

## Go-to-market experiment

Run a seven-day design-partner sprint:

1. Pick one narrow deliverable, preferably repository due diligence or vendor-claim verification.
2. Produce three reports from public or customer-provided material.
3. Ask five operators what they currently pay in analyst time, review time, or rework.
4. Offer a fixed-price pilot with a human review step and a written acceptance boundary.
5. Charge before adding automation. If nobody pays for the report, more architecture is not the answer.
6. Record every rejected claim and every requested revision; these become the first product requirements.

Success is a paid pilot or a specific objection from a qualified buyer. Stars, downloads, and social engagement are secondary signals.

## Implementation sequence

### Phase 1 — Proof package

- define a canonical `Job`, `Artifact`, `Evidence`, `Check`, `Decision`, and `AcceptanceReceipt` record;
- implement deterministic hashing and append-only event ordering;
- create a local CLI that turns a folder of sources plus a report into a verification bundle;
- ship JSON Schema and golden fixtures;
- add negative tests for authority escalation, replay, missing evidence, and failed checks.

### Phase 2 — Reviewable service

- expose a small HTTP API for job creation and bundle retrieval;
- add a browser review surface;
- support one document parser and one repository collector;
- generate a static, shareable report;
- add usage metering without storing provider secrets in artifacts.

### Phase 3 — Exchange

- allow multiple execution nodes to submit competing candidate packages;
- rank nodes by acceptance history and transparent check coverage, not opaque model claims;
- add revision requests and dispute evidence;
- introduce paid job routing only after the single-provider workflow is reliable.

## Deliberate non-goals

The first release must not:

- issue a speculative token or promise passive returns;
- custody customer funds or make financial decisions;
- claim that a provenance graph proves an underlying claim is true;
- expose private customer evidence in a public repository;
- grant capabilities based on filenames, model output, or connector responses;
- build a general assistant before one narrow paid workflow works.

## The decisive metric

The north-star metric is:

> **Accepted, paid deliverables per active customer, with zero unexplained provenance gaps.**

A secondary metric is time from customer upload to a human-understandable acceptance receipt. The product is earning its keep when a customer can defend a decision faster because Mesh preserved the path from source to accepted result.

## Current repository implication

The present repository contains the right conceptual ingredients—authority states, provenance, failure evidence, and capability boundaries—but not the commercial loop. This document is intentionally a bridge from architecture to a revenue test. The next code contribution should implement the Phase 1 proof package as a local, deterministic CLI and fixture set, then use it to sell a narrowly scoped pilot.

That sequence is more creative than adding another adapter, and more honest than claiming the current mesh can already generate income.
