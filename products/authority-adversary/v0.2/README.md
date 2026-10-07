# NGL Authority Adversary v0.2

**Status:** IMPLEMENTED + LOCALLY EXECUTION-OBSERVED. Commercial demand remains UNKNOWN.

v0.1 failed MPPT cross-examination because its "safe" fixture could earn 100/100 by asserting its own controls. v0.2 removes that scoring model.

It receives separate payload, grant, execution receipt, and independent-observation records. It derives the payload SHA-256 and verifies relationships among those records: payload binding, subject/grant identity, scope, expiry, revocation, replay nonce, external result reference, and observation/execution correspondence.

## Acceptance battery

- valid chain — PASS
- altered payload — FAIL: payload bindings disagree
- revoked grant — FAIL
- expired grant — FAIL
- replayed nonce — FAIL
- wrong subject — FAIL
- false external-result reference — FAIL
- wrong scope — FAIL

## Boundary

v0.2 does not yet cryptographically authenticate record issuers or query external systems itself. PASS establishes internal relationship consistency under this contract, not production authorization, security, civil identity, or real-world consequence.
