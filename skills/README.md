# Alpha-1 Governance Skills

These seven skills operationalize the governance review dimensions commissioned for the v4.0.0 Constitution reconciliation.

They are instruction artifacts for human and AI reviewers. They do not themselves enforce CI, anchor ledgers, sandbox commands, grant permissions, or validate package bytes. Those controls require corresponding implementation, platform configuration, and tests.

## Skills

1. [Ledger Integrity](ngl-ledger-integrity/SKILL.md) — tamper evidence, independent head anchors, truncation and replay tests.
2. [Safe Execution Boundaries](ngl-safe-execution-boundaries/SKILL.md) — treat external specifications as data; constrain any authorized execution.
3. [Independent CI Governance](ngl-independent-ci-governance/SKILL.md) — keep required enforcement independent of candidate changes.
4. [Validation Completeness](ngl-validation-completeness/SKILL.md) — prevent incomplete packages from receiving complete validation claims.
5. [Authorization and Secrets](ngl-authorization-and-secrets/SKILL.md) — least privilege, Founder authorization, and credential protection.
6. [Traceability and Recovery](ngl-traceability-and-recovery/SKILL.md) — durable receipts, evidence labels, and context-loss recovery.
7. [Constitutional Reconciliation](ngl-constitutional-reconciliation/SKILL.md) — map written rules to skills, scripts, tests, and observed enforcement.

## Operating rule

Apply the existing [NGL Evidence-Governed Delivery](ngl-evidence-governed-delivery/SKILL.md) skill alongside these controls when work crosses repositories, agents, or authority boundaries.

Every review must distinguish **Verified**, **Reported**, **Simulated**, **Proposed**, and **Unknown**. A skill document is not proof that its prescribed control has been implemented or independently tested.
