# Stutter-step checkpoint — temporal ordering across offset timestamps

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
Branch: `fix/moonshot-timestamp-order-20261027`
Base `main` at last reinspection: `31f753c8fe669979f1bc3087463510aefc73f746`
Current code/test head before this checkpoint: `14f11df31d20ea5e733ebf5dbcb69a51b10b735c`

## Source-backed defect

The world model and HTTP service validated that timestamps were parseable, but compared some timestamp strings lexically. An ISO timestamp with a timezone offset can sort after another string while representing an earlier instant. This allowed malformed retained chronology to pass the string-order checks. A source-bound Moonshot proposal also compared source publication time to proposal time using strings.

## Implementation cycles

1. `45a996591ed0a3664d9c2580514ce9058f0032b9` — compare Moonshot source publication and proposal times as parsed instants.
2. `0d42588fded3c3f83536b092af0ad56ce49b59ac` — add a source-binding regression whose timestamp sorts earlier as text but is later in real time.
3. `4b4f2eb4b5eb46b41988b0b15b49188ece3a7743` — change persisted server-history checks for world bounds, event ordering, source binding, and repair-version ordering to compare parsed instants.
4. `ddbfe8d4a62b234fac4fb92234ad873b8f27cc1a` — add an HTTP-service restart regression using a canonically re-checksummed persisted envelope with a backward offset timestamp.
5. `22ec58626654773659e3236c1e31ad259fd61011` — make exported `validateWorld()` reject backward event chronology even outside the HTTP server.
6. `8dbe45ff1d16e5cb074cadb5f0c0bffe4f2204e9` — add source-time and general event-order regressions.
7. `580095d6166995daac01c8a7d16bc27417933a01` — align the server integration test with the model-level failure.
8. `1a5d48cdf9738ddef02f340f2bb7b19e61851f5d` — reject a world whose parsed update instant precedes its creation instant.
9. `184d4ae38b9df681a239d7f3363e095676c3f88b` — test the reversed world-time bound.
10. `14f11df31d20ea5e733ebf5dbcb69a51b10b735c` — keep the event-order test isolated from the top-level world-time check.

## Regression coverage added

- A source publication timestamp that sorts lexically before the proposal but parses to a later instant must be rejected.
- An event timestamp that sorts lexically after the prior event but parses to an earlier instant must be rejected.
- The same malformed chronology is exercised through a persisted service envelope with its digest recomputed, so rejection cannot rely on a stale checksum.
- A world update instant before the world creation instant is rejected.

The timestamp fixture arithmetic was independently checked in the automation runtime. This is not a substitute for executing the repository test suite.

## Verification status

**GitHub Actions exact-head verification is pending PR creation.** No local test execution is claimed. Inspect full repository verification, Genesis Evidence Invariant, and browser acceptance on the PR's final head. If any workflow fails, inspect its logs, repair the demonstrated defect, and rerun on the new exact head.

## Founder authority and remaining blockers

- PR #16's original self-signing flow is closed and superseded by merged PR #18. Do not revive the obsolete flow.
- Issue #17 remains open for separately controlled Founder key custody/identity, adversarial concurrent writers, and safe crash/stale-lock recovery. No credential or independent identity proof is available in this run.
- PR #76 remains draft; its signed-attestation adapter is not wired into `game/server.mjs`, and production trust roots are not provisioned.
- PRs #60 and #63 are still open in GitHub search, but current `main` already contains post-rename durability/uncertain-commit handling and hardened persisted Founder-key loading. Reconcile their diffs against current `main` before treating them as missing capabilities.
- No stale branch should be merged wholesale just because its historical CI was green.

## Next prioritized steps

1. Inspect exact-final-head GitHub Actions after PR creation; repair failures only when supported by logs.
2. Reconcile open storage/key-loading PRs against current `main` and identify genuinely missing code, not duplicated fixes.
3. Continue Issue #17's concurrent-writer and crash/stale-lock acceptance without automatically deleting a potentially live lock.
4. Keep production signed-attestation trust fail-closed until independently controlled trust roots and actual live mutation-path integration are verified.
5. Review linked NGL Mesh PR #1 against fresh source and required APK/RAE artifacts before claiming integration.

No merge, deployment, release, spending, production key provisioning/rotation/revocation, or Founder-identity claim occurred.
