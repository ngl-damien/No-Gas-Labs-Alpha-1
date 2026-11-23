---
name: ngl-constitutional-reconciliation
description: Reconcile institutional constitutions, operating contracts, agent skills, scripts, workflows, and runtime behavior into a traceable control map.
---

# NGL Constitutional Reconciliation

## Purpose
Determine whether written institutional rules, agent instructions, scripts, CI enforcement, and observed runtime behavior agree—and identify gaps without inventing compliance.

## Non-negotiable rules
- The Constitution, operating contract, skill files, scripts, workflows, and runtime are separate evidence sources.
- Textual agreement does not prove executable enforcement.
- A script's existence does not prove it is invoked; a test's existence does not prove it is required.
- Do not infer the contents of missing files or unavailable package material.
- Preserve the Founder-approved baseline and identify conflicts rather than silently choosing the most permissive interpretation.

## Procedure
1. Inventory the Constitution, operating contract, all skills, scripts, workflows, templates, fixtures, and relevant runtime modules.
2. Record exact source refs, versions, hashes where available, and access limitations.
3. Extract each normative requirement as a uniquely identified control.
4. Map every control to the skills that instruct it, scripts that implement it, tests that verify it, and runtime/platform settings that enforce it.
5. Classify each mapping as **Aligned**, **Partial**, **Conflict**, **Missing**, or **Unknown**.
6. Test the highest-risk controls with negative/adversarial cases; inspect the effective platform configuration where required.
7. Record conflicts, gaps, compensating controls, owners, and proposed remediation.
8. Produce a traceability matrix and a disposition for each control; do not approve the whole Constitution if any critical control remains unresolved.

## Required dimensions
Evidence integrity; authority separation; safe command execution; independent CI governance; validation completeness; authorization and secrets; traceability and recovery.

## Acceptance criteria
A pass requires every critical constitutional control to have an identified owner, an implemented enforcement point, an independent verification method, and retained evidence. Unavailable sources remain Unknown; untested controls remain unverified.

## Output
Produce a source inventory, control traceability matrix, conflict register, critical-risk summary, test evidence, and explicit approval/block recommendation.

## Stop conditions
Stop if the governing Constitution or required source artifacts are missing, the reviewer is asked to certify unseen material, or reconciliation would require unauthorized changes to protected policy.
