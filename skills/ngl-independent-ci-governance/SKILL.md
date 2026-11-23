---
name: ngl-independent-ci-governance
description: Design and audit CI enforcement so candidate changes cannot weaken or replace the rules and tests used to approve themselves.
---

# NGL Independent CI Governance

## Purpose
Ensure that required checks are controlled by a trusted policy boundary independent of the pull request or commit under evaluation.

## Non-negotiable rules
- A candidate change must not be the sole authority defining its own acceptance criteria.
- Required workflows, policy versions, and evaluator identities must be traceable.
- A green check is evidence only of the exact workflow and code that ran; it is not proof of broader correctness.
- Do not merge, approve, or promote a change solely because its self-modified tests pass.

## Procedure
1. Identify required checks, workflow definitions, reusable workflows, action references, test scripts, policy files, and branch/ruleset protections.
2. Trace which of these can be changed by the candidate pull request.
3. Identify the trusted enforcement source: protected default-branch workflow, centrally controlled reusable workflow, signed policy bundle, or equivalent independently governed mechanism.
4. Verify that required status checks are bound to the trusted workflow identity and expected event/ref.
5. Ensure policy changes require independent review and cannot disable their own review requirement.
6. Pin third-party actions and dependencies to immutable revisions where supported.
7. Test a candidate change that attempts to skip tests, weaken thresholds, replace the validator, alter required workflow triggers, or spoof a success result.
8. Record the exact base/head SHA, workflow run, evaluator version, policy version, and check result.

## Acceptance criteria
A pass requires that a candidate PR cannot make its own mandatory checks disappear, redefine their meaning, or substitute an untrusted evaluator. Required protections must be verified from the hosting platform's effective configuration, not inferred from repository YAML alone.

## Output
Produce a CI trust map, required-check inventory, policy ownership map, adversarial test results, and exact-run evidence.

## Stop conditions
Stop if branch protection/ruleset state cannot be inspected, evaluator provenance is unknown, or a required check is controlled solely by the candidate change.
