# Experiment 001 — Bounded institutional cycle (candidate)

**Hypothesis:** A later process can recover an installed capability from a persisted evidence ledger without a human relaying the previous run's transcript.

**Scope:** Competing deterministic example strategies, bounded challenge cases, detached Ed25519 INSTALL approval, persisted hash-chained ledger, capability reuse, and replay/tamper rejection. This is an integration experiment—not multi-agent AI, a general theorem, production security, or independent discovery.

Run on Node.js 20 (the repository CI runtime): `node --test experiment-001/institutional-cycle.test.mjs`.

## Trust and durability boundaries

- `NGL_FOUNDER_KEY_FINGERPRINT` is captured when the module is imported. The operator must set it before process startup/import; the proposal handler cannot supply a replacement fingerprint as a function argument. Regression tests cover caller-supplied self-pinning and a missing startup pin.
- This is only a configured trust anchor. It does **not** prove the real-world identity of the person who configured it, protect against arbitrary code executing before module import, or establish that Damien has approved anything. No real Founder public key or private signer is included in this repository. Tests use ephemeral keys.
- INSTALL approval is a detached Ed25519 signature over the canonical decision. The private signing key must remain outside the proposal-handling runtime; this repository does not implement a separate signing service or prove key custody.
- The hash chain detects inconsistent record edits, but it is not externally anchored. Someone able to rewrite the complete ledger can recalculate its hashes.
- Writes use an exclusive lock file, a synced temporary file, atomic rename, and directory sync. Stale-lock recovery is not automatic. A directory-sync failure after rename is reported as `COMMIT_DURABILITY_UNCERTAIN`; the visible file may already have changed.
- The test now performs signed REUSE in a child Node process and reopens the ledger in the parent afterward. Concurrency and stale-lock tests remain acceptance work.
- Do not merge, award in-world XP, or make commercial claims based on this experiment. Keep PR #16 draft until exact-head CI, adversarial review, and cross-process evidence are recorded.

## Next experiment

Test concurrent writers and stale-lock recovery, then compare the candidate with the real reducer/authority entry points for integration.
