---
name: ngl-validation-completeness
description: Audit package manifests, required templates, fixtures, validators, and test coverage; prevent partial packages from receiving complete validation claims.
---

# NGL Validation Completeness

## Purpose
Make validation claims match the actual delivered package and its declared dependencies.

## Non-negotiable rules
- A partial package cannot receive a complete-package pass.
- Missing required inputs must fail closed with a precise diagnostic.
- A validator that cannot run is **NOT RUN**, not passed or implicitly waived.
- A test skipped because its fixture is absent must remain visible as a blocker.
- Never invent files, fixtures, test results, or package hashes.

## Procedure
1. Obtain the package manifest and identify the claimed file count, required files, optional files, generated files, and external dependencies.
2. Inventory actual files and compare paths, sizes, and content digests with the manifest.
3. Verify every required template, fixture, schema, and test dependency exists and is readable.
4. Inspect validator behavior for missing, duplicate, unexpected, malformed, and path-escaping files.
5. Run validation only after dependencies are present; record exact commands, environment, version, exit status, and output.
6. Run tests independently where possible; distinguish unit, integration, self-validation, and platform checks.
7. Compute cryptographic digests from actual bytes and compare them to a trusted expected manifest.
8. Produce a missing-material report and a reproducible package receipt.

## Required states
Use **PASS**, **FAIL**, **BLOCKED**, **NOT RUN**, and **INDETERMINATE** precisely. A blocked or not-run test must never be counted as passing.

## Acceptance criteria
A complete pass requires all mandatory files and fixtures, successful validator execution, required tests passing, and a digest calculated from the actual package bytes against a trusted expected value.

## Output
Produce a manifest comparison, missing-file list, validator/test matrix, runtime details, digest verification result, and explicit scope limitations.

## Stop conditions
Stop if package provenance is unclear, required files are absent, the validator attempts unsafe execution, or a digest is being inferred from pasted text rather than actual bytes.

## Commission closure check

Before closing a validation mission, compare actual deliverables and observed checks against the originally declared criteria; do not redefine criteria after results are known. Preserve command, environment, output, exit status, and failed or skipped cases. Repair only evidence-supported defects when authorized, then rerun relevant validation. Closure requires every required check to be complete and passing, with the ledger's externally expected head independently confirmed; otherwise report partial, blocked, not-run, or indeterminate status rather than completion.
