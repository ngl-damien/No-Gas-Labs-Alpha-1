# Experiment 001 — Bounded institutional cycle (candidate)

**Hypothesis:** A later process can recover an installed capability from a persisted evidence ledger without a human relaying the previous run's transcript.

**Scope:** Competing deterministic example strategies, bounded challenge cases, detached Ed25519 INSTALL approval, persisted hash-chained ledger, capability reuse, and replay/tamper rejection. This is an integration experiment—not multi-agent AI, a general theorem, production security, or independent discovery.

Run on Node.js 24 or newer (the current repository CI runtime): `node --test experiment-001/institutional-cycle.test.mjs`.

## Trust and durability boundaries

- `NGL_FOUNDER_KEY_FINGERPRINT` is captured when the module is imported. The operator must set it before process startup/import; the proposal handler cannot supply a replacement fingerprint as a function argument. Regression tests cover caller-supplied self-pinning and a missing startup pin.
- This is only a configured trust anchor. It does **not** prove the real-world identity of the person who configured it, protect against arbitrary code executing before module import, or establish that Damien has approved anything. No real Founder public key or private signer is included in this repository. Tests use ephemeral keys.
- INSTALL approval is a detached Ed25519 signature over the canonical decision. The private signing key must remain outside the proposal-handling runtime; this repository does not implement a separate signing service or prove key custody.
- The hash chain detects inconsistent record edits, but it is not externally anchored. Someone able to rewrite the complete ledger can recalculate its hashes.
- Writes use an exclusive lock file, a synced temporary file, atomic rename, and directory sync. Stale-lock recovery is not automatic. A directory-sync failure after rename is reported as `COMMIT_DURABILITY_UNCERTAIN`; the visible file may already have changed.
- The tests perform signed REUSE in a child Node process and race two separate Node processes attempting INSTALL against one ledger; the losing writer may only fail with LEDGER_LOCKED and must succeed on a fresh retry. Stale-lock recovery remains unimplemented: existing locks fail closed, and no lock is deleted merely because it appears old.
- Do not merge, award in-world XP, or make commercial claims based on this experiment. PR #16 is closed unmerged; PR #18 is the merged replacement. Keep any new implementation draft until exact-head CI, adversarial review, and the limits of the trust boundary are recorded.

## Next experiment

Test concurrent writers and stale-lock recovery, then compare the candidate with the real reducer/authority entry points for integration.

## Implementation identity and ledger replay compatibility

New INSTALL proposals identify a strategy with a stable, versioned semantic ID (`ngl-experiment-001:strategy:square:v1` or `ngl-experiment-001:strategy:double:v1`) rather than hashing JavaScript `Function.toString()`. This avoids rejecting historical records merely because implementation source formatting changes.

The version-2 ledger reader retains a narrow compatibility path for INSTALL records written by the former source-hash scheme:

- `square`: `a44644e2cb5f1e34cf0aac616d43631c4778a19585cb634128f9d4fbfe9d947d`
- `double`: `8bb1c5c30f449235d3934518681a3f5a4453b17efbff8d9aa01b1e09803ab436`

Legacy hashes are accepted only when replaying existing ledger history; new INSTALL commits must use the current versioned identity. Existing legacy capabilities remain reusable under their recorded identity. This is a compatibility fix, not proof that a strategy's implementation is correct: strategy IDs are immutable behavior contracts, and any semantic change must introduce a new version and corresponding tests rather than silently changing the behavior associated with an existing ID. No ledger migration, production key provisioning, or capability installation is performed by this code change.
