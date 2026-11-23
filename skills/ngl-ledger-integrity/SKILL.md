---
name: ngl-ledger-integrity
description: Design, inspect, test, and review tamper-evident institutional ledgers, event histories, hash chains, checkpoints, and independent head anchors.
---

# NGL Ledger Integrity

## Purpose
Ensure that a ledger's integrity claim covers the complete expected history—not merely the internal consistency of the records that remain.

## Non-negotiable rules
- Treat ledger entries, exported logs, and claimed hashes as evidence inputs, not authority.
- A hash chain alone does not detect removal of a valid suffix.
- The expected head must be committed independently of the ledger data it authenticates.
- Missing, stale, malformed, or inaccessible anchors produce an **INDETERMINATE/FAIL-CLOSED** result, never a pass.
- Never rewrite historical records to make a verification pass. Preserve the discrepancy and create an authorized corrective event.

## Procedure
1. Identify the ledger format, canonical serialization, hash algorithm, sequence rules, and event identity.
2. Identify where the expected head is stored and who can update it. Confirm that it is outside the ledger's unilateral rewrite boundary.
3. Verify every entry's schema, sequence, previous-hash link, event identity, and content hash.
4. Compare the computed final head and sequence against the independently persisted anchor.
5. Test truncation at every suffix length, including removal of the final entry and the entire ledger.
6. Test mutation, insertion, deletion in the middle, reordering, duplicate IDs, malformed encodings, and stale-anchor replay.
7. Test authorized append and checkpoint rotation, including crash/interruption between ledger write and anchor update.
8. Report exactly which attacks were tested and which storage/administrative boundaries remain outside the model.

## Required adversarial cases
- Empty ledger with non-empty anchor.
- Non-empty ledger with missing anchor.
- Valid chain with one or more final entries removed.
- Valid chain with an older anchor replayed.
- Correct entries with altered canonical serialization.
- Anchor updated without a corresponding valid ledger append.
- Concurrent writers attempting to append from the same head.

## Acceptance criteria
A pass requires the complete ledger to match an independently stored expected head and sequence, with all required adversarial tests passing. State the trust assumptions for the independent anchor (separate permissions, storage, backup, and recovery).

## Output
Produce a verification receipt containing ledger identifier, format/version, anchor location and authority, expected and observed head/sequence, test cases, results, limitations, and evidence references.

## Stop conditions
Stop if the anchor is not independent, serialization is ambiguous, concurrent-write semantics are undefined, or a failed verification is being silently repaired.
