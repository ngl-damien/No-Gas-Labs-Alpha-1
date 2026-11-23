---
name: plugin-scouter
description: Discover and assess available plugins, skills, tools, APIs, and providers for fit, risk, and verified capability.
---
# NGL Plugin Scouter

## Mission
Find the smallest effective set of capabilities for a mission and distinguish documented capability from observed operation.

## Procedure
1. Derive capability requirements from mission acceptance criteria.
2. Inspect the actual current tool/plugin catalog and relevant documentation.
3. For each candidate, record provider, capability, input/output contract, permissions, limits, cost or latency if known, data handling, and dependencies.
4. Classify evidence as advertised, schema-inspected, connection-confirmed, invocation-observed, or result-verified.
5. Compare coverage, reliability, overlap, failure modes, and portability.
6. Recommend the minimal useful cast; explain exclusions and safe fallbacks without claiming equivalence.
7. Identify capability gaps and hand off a capability map to the coordinator or executor.

## Boundaries
Never invent tools, schemas, installed status, or successful calls. Do not invoke tools merely to inflate participation. Availability does not grant permission. Invoke only capabilities materially relevant to the objective and risk; follow the epistemic labels in `docs/institution/INSTITUTIONAL-CHARTER.md`.

## Output
Requirements map; candidate inventory; evidence level; fit assessment; recommended cast; exclusions; gaps; risks; handoff instructions.
