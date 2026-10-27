# Stutter-step checkpoint — cross-process and stale-lock acceptance

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
Base `main`: `26eb65938552714f76839f3bd6851c5c9a9f2a56`
Branch: `test/cross-process-writer-locks-current-main-20261027`

## Fresh-state findings

- PR #108 has merged into current `main`; its canonical persisted-envelope and uncertain-ledger-read changes are already present.
- PR #104 remains open on the older base `e3f7c0c8effd383b76c2d68df54d051b333d511c`. Its cross-process tests were re-applied to a branch created from current `main`, not merged wholesale.
- Issue #17 remains open. The service store, ledger, and decision store intentionally fail closed on an existing lock after owner death; each documents that stale locks require explicit offline recovery.
- PR #16 is closed/unmerged and superseded by merged PR #18. A configured Founder-key fingerprint is not proof of real-world identity or private-key custody.

## Functional change

Updated `test/lock-ownership-regression.test.mjs` with a child-process lock holder (10-second readiness timeout, stderr capture, cleanup hook) and six process-boundary acceptance tests:

1. Service store: competing process receives `SERVICE_LOCKED`; normal owner release allows a fresh open.
2. Institutional ledger: competing process receives `LEDGER_LOCKED`; normal owner release allows a fresh open.
3. Decision store: competing process receives `DECISIONS_LOCKED`; normal owner release allows a fresh open.
4. Service store: after owner `SIGKILL`, the stale lock still blocks opening until the test explicitly removes it in the isolated temporary directory; reopening then succeeds.
5. Institutional ledger: same fail-closed-after-`SIGKILL` and explicit temporary-directory recovery acceptance.
6. Decision store: same fail-closed-after-`SIGKILL` and explicit temporary-directory recovery acceptance.

The killed-owner tests verify that the implementation does not silently infer that a lock is safe to reclaim. Their manual unlink is confined to the test's fresh temporary directory after the child is confirmed dead; this is not a production recovery procedure.

## Commit trail

- `6002809577dc81cffbd30cc79d32834acc90ba1f`: cross-process service-store and ledger lock tests.
- `d06449d3f8f09573042fb88f5e3cfaae4e21559b`: decision-store cross-process lock test.
- `ac482e5d1b62cb5bb75fe4bd9d9b604e0d6b8e14`: service-store fail-closed stale-lock test.
- `42a426a22370a5ce93e574952a3b13cef6b74b6e`: ledger and decision-store fail-closed stale-lock tests.

## Verification boundary

- Branch was created from current `main` at `26eb65938552714f76839f3bd6851c5c9a9f2a56`.
- PR #109: https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/109
- Exact-head Full verification, Genesis Evidence Invariant, and Browser acceptance must be inspected after the final checkpoint commit. No local test run is claimed.

These tests establish cross-process exclusion and fail-closed behavior under the exercised normal-release and `SIGKILL` paths. They do **not** prove power-loss recovery, distributed-host locking, race-free lock unlink, or real Founder identity.

## Unresolved blockers / next priorities

1. Inspect all exact-head Full verification, Genesis Evidence Invariant, and Browser acceptance results; repair failures and rerun.
2. Continue Issue #17 with a separately designed and authorized offline stale-lock recovery procedure. Do not infer liveness from PID alone or add automatic lock reclamation without a sound ownership protocol.
3. Reconcile PR #104 with PR #109 after CI evidence; do not merge either automatically.
4. Inspect PR #16/PR #18 state and the live server mutation path before further authorization work. No production trust-root provisioning or key operation is authorized here.
5. Keep PR #76's signed-attestation adapter untrusted for production until independently controlled trust roots and actual server mutation-path integration are verified.

No merge, deployment, release, spending, external key operation, or Founder-identity claim is included.
