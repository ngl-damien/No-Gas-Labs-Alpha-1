# Stutter-step checkpoint: Experiment 001 canonical input integrity

Date: 2026-10-27 UTC

## Fresh state and supersession checks

- Alpha One `main` was re-read at `001bcd895fb82f5ac1064a00a6a155f9c7bacaab` before and after implementation.
- Safe branch: `security/experiment001-canonical-input-integrity-20261027`, created from that exact main SHA.
- Code/test head before this checkpoint: `7861a0bbc2f00b33f9cca723da00fc74d00cc104`; 4 commits ahead, 0 behind; two changed code/test files.
- PR #89 (durability uncertainty latch) and PR #91 (role-scoped quest progress) are now merged into main. This run did not merge them.
- PR #16 remains closed/unmerged; merged PR #18 supersedes its self-signing flow. Issue #17 remains open for real Founder key custody/identity, concurrency, and crash/stale-lock acceptance.
- PR #67 remains open/draft but is 41 commits behind current main. Its canonical-JSON hidden-property change is already present on main in commit `8bf954fb02863a9b86f1b0fa5f3e6858ef4c00ff`; do not merge the old PR branch wholesale.
- PR #58 remains open/draft and diverged (observed 6 ahead / 46 behind). It contains separate ledger-reader changes and an earlier exact-schema fix; this branch is a clean current-main transplant, but its `exactKeys` edit may conflict if PR #58 is later reconciled. Reinspect both before integration.
- No local clone/test runtime was available. GitHub Actions are the verification source.

## Functional changes

- `54ec0f2c92127556dd9017f795daf0d7ad8ca6c1`: replace Experiment 001's lossy canonical serializer with explicit own-key and property-descriptor validation. Reject hidden properties, symbol keys, accessor-backed properties, sparse/decorated arrays, cycles, non-finite numbers, non-plain objects, and nesting beyond 100 levels. Validate the caller's original decision before `structuredClone` can discard hidden properties or normalize accessors.
- `b334b61402b1ae3daaf768c6f29a2c8a45f26bfc`: add regression tests for hidden object/array properties, symbols, sparse/decorated arrays, accessors, canonical output stability, and pre-clone rejection without executing a getter.
- `c564a84f758fb4d0c34e53b71458318760f8b61a`: replace NUL-delimiter-joined `exactKeys` comparison with exact own-key count/membership, plain-object, data-descriptor, and hidden/symbol-key checks.
- `7861a0bbc2f00b33f9cca723da00fc74d00cc104`: add a regression for the actual `expiresAt\0id` delimiter collision, plus hidden-property and accessor rejection in direct INSTALL schema validation.

The changes preserve legitimate capability IDs such as `constructor` and `toString`; the serializer does not ban those values as object keys.

## Exact-head verification status

At code/test head `7861a0bbc2f00b33f9cca723da00fc74d00cc104`:
- [Full verification run 40451356054](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40451356054): **success**.
- [Genesis Evidence Invariant run 40451356062](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40451356062): **success**.
- [Browser acceptance run 40451355969](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40451355969): **in progress** at checkpoint time; do not claim it passed until its completed result is inspected.

These are push-triggered GitHub Actions runs. No local test run is claimed.

## Limits and next priorities

1. Poll browser acceptance on the code/test head, inspect its logs if it fails, and repair any real regression.
2. Open a draft PR against current `main`, then inspect all PR-triggered checks on the exact final head.
3. Reconcile PR #58's NUL-key and ledger-reader work without importing its 46-commit-diverged branch.
4. Continue Issue #17's independent Founder custody, concurrency, and crash/stale-lock acceptance. The configured fingerprint remains a trust anchor, not proof of Damien's identity or key possession.
5. Keep production observation verification fail-closed until distinct, independently controlled trust roots are provisioned and the verifier is wired into the real mutation path.
6. Reinspect NGL Mesh PR #1's missing reference artifacts before claiming Android/RAE integration.

No merge, deployment, release, spending, production key provisioning, rotation, or revocation occurred. No Founder-identity or autonomous-discovery breakthrough is claimed.
