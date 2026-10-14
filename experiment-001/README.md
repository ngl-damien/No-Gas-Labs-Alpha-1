# Experiment 001 — Authority Gate reference implementation

This is a **candidate boundary**, not an integrated or production-secure engine. It does not intercept existing reducer calls. Its HMAC demonstrates message integrity only under a single trusted issuer; a signed consent receipt is **not** proof of real-world human consent. All state (revocations, replay IDs) is in memory and resets on restart. No key rotation, durable ledger, key custody, event-schema validation, or cross-process atomicity is implemented.

Run on Node.js 18+: `node --test experiment-001/authority-gate.test.js`.

Acceptance requirements before integration:
1. Map each actual reducer entry point and ensure no unguarded mutations remain.
2. Replace demonstration HMAC issuer with independently controlled identity and policy decisions.
3. Persist revocations and replay IDs atomically with state transitions.
4. Bind evidence references and consent to provenance, scope, time, and revocation.
5. Run historical adversarial regressions against the real engine, not merely this reference module.
6. Reject unknown fields and validate event schema before evaluating authority.

Authored as an NGL Experiment 001 candidate for review; no execution or successful tests are asserted by this file.
