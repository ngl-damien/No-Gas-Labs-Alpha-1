# Reconciliation Contract — Preserve the Distinctions

**Status:** specification, NOT evidence of runtime integration, passing tests, founder access or deployment.  
**Canonical mission:** [CODEX-MISSION.md](CODEX-MISSION.md).  
**Principle:** Reconcile interfaces. Do not collapse independently testable duties.

## 1. Roles / authority

- T.R.U. reconstructs provenance-linked state histories, including contradictions and unknowns. It does **not** judge candidate fitness or authorize consequences.
- AOTA² creator proposes alternatives. Adversarial evaluator owns the tests; candidate code cannot alter workload, evaluator, policy or promotion boundary.
- RAE validates artifact identity, manifests and claims. EvidenceOS/ledger retains sources, receipts, contradictory accounts and dispositions.
- Founder Gate authenticates and authorizes explicit decisions, enforces deadlines, and persists audit history. SFAO is access control, not truth certification.
- Runtime/hosting provides reachability and durable operation, but is not evidence of correctness on its own.

## 2. Wire contracts (proposed v1 shapes, to be reconciled with existing implementations)

These are minimum fields, not a demand to replace existing repo schemas. Codex should either adapt or document a justified incompatibility.

### TemporalEvent

```json
{
  "schema": "ngl.temporal-event.v1",
  "id": "event:example",
  "subject_id": "capability:example",
  "occurred_at": "2026-10-17T12:00:00Z",
  "recorded_at": "2026-10-17T12:03:00Z",
  "mode": "OBSERVED",
  "statement": "Artifact changed in repository",
  "source_receipt_ids": ["receipt:example"],
  "related_event_ids": [],
  "uncertainty": "Repository mutation observed; motive unknown"
}
```

Modes: OBSERVED, REPORTED, INFERRED, SIMULATED, FICTIONAL. Modes **cannot** self-upgrade; promotion needs newly linked evidence and provenance. A fictional event in the 2041 authored history is not an event observed in 2041. A simulated future is not a forecast proven true.

### CandidateEvaluation

```json
{
  "schema": "ngl.candidate-evaluation.v1",
  "id": "evaluation:example",
  "incumbent_ref": "commit-or-artifact:baseline",
  "candidate_ref": "commit-or-artifact:proposal",
  "workload_ref": "sha256:workload",
  "environment_ref": "sha256:environment",
  "evaluator_ref": "sha256:evaluator",
  "test_receipt_ids": ["receipt:execution"],
  "negative_case_ids": ["case:tamper"],
  "measurements": {"duration_ms": null, "memory_bytes": null},
  "rollback_ref": "commit-or-artifact:baseline",
  "recommendation": "INCONCLUSIVE",
  "limitations": ["Independent execution authentication not yet established"]
}
```

Requirements: both alternatives run the **same workload**; record actual environment, policy and test harness versions. Null is permitted for unmeasured metrics; invented numeric values are not. RECOMMENDATION does not grant authorization.

### EvidenceReceipt

```json
{
  "schema": "ngl.evidence-receipt.v1",
  "id": "receipt:execution",
  "artifact_digest": "sha256:...",
  "source_type": "local_execution",
  "producer": "identified-tool-or-job",
  "observed_at": "2026-10-17T12:04:00Z",
  "assurance": "UNVERIFIED",
  "raw_log_ref": "path-or-immutable-reference",
  "witness_ref": null,
  "signature_ref": null,
  "limitations": ["Self-recorded run; no independent witness"]
}
```

Distinguish: artifact integrity, execution observation, authenticated witness, independent corroboration, and truth. Do not infer upper layers from lower layers. Never claim an independently signed receipt when no verified signing identity exists.

### FounderDecision

```json
{
  "schema": "ngl.founder-decision.v1",
  "id": "decision:example",
  "evaluation_id": "evaluation:example",
  "status": "PENDING",
  "created_at": "2026-10-17T12:05:00Z",
  "expires_at": "2026-10-18T12:05:00Z",
  "deadline_basis": "actual-policy-or-founder-authorization-ref",
  "founder_identity_ref": "authenticated-principal-reference",
  "allowed_actions": ["APPROVE", "REJECT", "DEFER"],
  "evidence_receipt_ids": ["receipt:execution"],
  "risks": [],
  "rollback_ref": "commit-or-artifact:baseline",
  "decision_event_id": null
}
```

This shape is **illustrative**. Sample timestamps are not actual decisions or deadlines. Founder Gate must enforce authentication, authorization, expiry and anti-replay **server-side**. Authorized APPROVE is not evidence that a candidate is objectively better, and may not itself execute irreversible effects.

## 3. Contract invariants (test both positive and negative cases)

1. **Identity**: every linked object resolves to a stable ID and its provenance, or the interface records unresolved state.
2. **Separation**: T.R.U. cannot convert FICTIONAL/SIMULATED into OBSERVED without new evidence; evaluator cannot unilaterally authenticate itself; EvidenceOS cannot impersonate Founder approval.
3. **Reproducibility**: same source, harness, workload and environment are retained for incumbent and candidate; changes to one invalidate direct comparisons until rerun.
4. **Immutability and retention**: disposition history stays inspectable; provenance loss is disclosed rather than silently repaired.
5. **Security**: unauthenticated, wrong-principal, expired, duplicate and replayed decisions fail closed. Audit logs redact secrets.
6. **Expiry**: real server enforcement, not only a browser countdown.
7. **Rollback**: actual recovery route and its tested limits; no destructive switch without requisite authority.
8. **No false completion**: a static T.R.U. page, local evidence hash, test receipt, report or even a functioning unauthenticated public UI cannot satisfy the mission completion token.

## 4. Traceability matrix

| Requirement | Producer | Consumer | Minimum verification |
| --- | --- | --- | --- |
| Temporal history | T.R.U. | Evaluator + gate presentation | Timeline query with a real repository event and contradiction |
| Reproducible comparison | AOTA² evaluation | RAE + ledger | Both variants run same input and negative case |
| Receipt validation | RAE / attestation adapter | EvidenceOS + Gate | Tamper and forged-receipt rejection |
| Durable provenance | EvidenceOS / ledger | T.R.U. + Gate | Restart retains evidence and disposition |
| Pending decision | Decision service | Founder Gate | Real linked evaluation and deadline basis |
| Founder authentication | Existing founder authority provider | Founder Gate server | Reject unauthenticated/wrong actor |
| Authorized action | Founder Gate | Authorized effect handler | Idempotency, expiry, audit, rollback |
| Public endpoint | Deployment/runtime | Founder browser | Fresh HTTPS retrieval and live end-to-end checks |

## 5. Disposition and reconciliation ledger

For every discovered pre-existing NGL module and both handoff prototypes, record:
`path/ref | purpose | observed implementation | status and test receipt | overlaps | decision (REUSE/ADAPT/REPLACE/RETAIN SEPARATELY/REJECT) | migration / interface adapter | risk | owner | rollback`.

Do not delete, merge or rename projects merely because their labels overlap. Tests establish **behavior**, while diagrams establish **intent**. Keep both.

## 6. Completion and blockers

The final completion token is a **verified actual HTTPS Founder Gate with a legitimate pending time-sensitive decision** for the Neophyte Founder™, with authenticated access and server-validated consequences, independently checked evidence and recovery. Intermediate tests are necessary, never sufficient.

For suspected missing hosting, access, identity or secrets, maintain `dependency | hypothesis | observations | authorized alternatives attempted | result | next independent work | founder action (if truly necessary)`. Mark a blocker confirmed only after observing material obstruction and exhausting applicable safe authorized paths; report it as incomplete, not success.
