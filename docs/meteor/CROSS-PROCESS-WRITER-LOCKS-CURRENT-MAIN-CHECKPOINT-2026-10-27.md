# Stutter-step checkpoint — cross-process writer-lock acceptance

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
Base `main`: `26eb65938552714f76839f3bd6851c5c9a9f2a56`
Branch: `test/cross-process-writer-locks-current-main-20261027`

## Fresh-state findings

- PR #108 has merged into current `main`; its canonical persisted-envelope and uncertain-ledger-read changes are therefore already present.
- PR #104 remains open but is based on the older `main` SHA `e3f7c0c8effd383b76c2d68df54d051b333d511c`. Its cross-process writer tests were not discarded; they were re-applied to a branch created from the current mainline.
- Issue #17 remains open. The ledger and service store explicitly treat stale locks after process death as requiring operator recovery; this change does not silently delete a possibly live lock.
- PR #16 is closed/unmerged and superseded by merged PR #18. The configured Founder-key fingerprint is not proof of real-world identity or private-key custody.

## Functional change

Updated `test/lock-ownership-regression.test.mjs` with a bounded child-process lock holder and three cross-process acceptance tests:

1. Service store: while a separate Node process owns `.service.lock`, another process must receive `SERVICE_LOCKED`; after the owner releases normally, a fresh open succeeds.
2. Institutional ledger: a competing process must receive `LEDGER_LOCKED`; after normal release, a fresh open succeeds.
3. Decision store: a competing process must receive `DECISIONS_LOCKED`; after normal release, a fresh open succeeds.

The child helper has a 10-second readiness timeout, captures stderr for failures, and registers cleanup so a failed assertion does not intentionally leave a child process running.

## Evidence boundary

- Test-file commit adding service-store and ledger process-boundary tests: `6002809577dc81cffbd30cc79d32834acc90ba1f`.
- Test-file commit adding decision-store process-boundary coverage: `d06449d3f8f09573042fb88f5e3cfaae4e21559b`.
- The new branch was created from current `main` at `26eb65938552714f76839f3bd6851c5c9a9f2a56`.
- GitHub Actions exact-head results must be checked after the checkpoint/PR is created. No local test run is claimed.

These tests establish exclusion between separate processes under the exercised normal-release path. They do **not** establish power-loss recovery, safe stale-lock reclamation, distributed-host locking, or real Founder identity.

## Unresolved blockers / next priorities

1. Inspect exact-head Full verification, Genesis Evidence Invariant, and Browser acceptance. Repair any failures and rerun against the final head.
2. Continue Issue #17 with crash/stale-lock recovery acceptance. Keep stale locks fail-closed until a separately authorized offline recovery protocol can prove the previous owner is no longer active; do not infer liveness from a PID alone.
3. Reconcile PR #104 with this current-mainline PR after CI evidence; do not merge either automatically.
4. Inspect PR #16/PR #18 state and the live server mutation path before considering any authorization work. No production trust-root provisioning or key operation is authorized here.
5. Keep PR #76's signed-attestation adapter untrusted for production until independently controlled trust roots and actual server mutation-path integration are verified.

No merge, deployment, release, spending, external key operation, or Founder-identity claim is included.
