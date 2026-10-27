# Chronicle revocation-binding checkpoint

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
PR: [#122](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/122)
Branch: `feat/inspectable-grant-revocations-20261027`
Base `main`: `c1b2da251c42e98368d2fe5b155c4ba87b84cc3b`
Code/test head at checkpoint: `2ac76488748607f89404d7519cbbf3cdbc6f27e4`

## Functional change

The Chronicle no longer assigns an exact work/version to a revocation merely because its `workId` follows a claim. Scope is displayed only when the retained history contains exactly one prior authorization for that work with the same grant ID, whose scope matches the earlier claim's subject ID, subject version, and action. The grant ID must also be unique across all prior authorization events in the institution history. Missing, mismatched, duplicate, or cross-work-reused bindings remain visible as events but have unresolved scope and a warning.

This is a read-only provenance projection. It does not authorize or revoke anything and does not prove the truth of underlying claims.

## Regression coverage added

- Revocation without a prior authorization.
- Revocation grant ID differs from the prior authorization.
- Authorization scope disagrees with the earlier claim.
- Duplicate prior authorization for the same work/grant.
- Grant ID reused by a different work.
- Existing positive binding and out-of-order history cases remain in the suite.

## Verification evidence on code/test head

- [Full repository verification — run 40589602893](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40589602893): success; Node tests, Python inspector, package build, and bounded institutional exercise completed successfully.
- [Genesis Evidence Invariant — run 40589602958](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40589602958): success.
- [Browser acceptance — run 40589602911](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40589602911): still `in_progress`; no pass is claimed yet. Inspect the final head after this checkpoint commit as well.

These are GitHub-hosted results. No local test run is claimed.

## Blockers and next priorities

1. Confirm browser acceptance outcome and inspect exact-head logs; repair a genuine failure and rerun.
2. Keep PR #122 draft/unmerged pending review; production branch remains unchanged.
3. Issue #17 remains open for an independently controlled Founder signing operation and safe crash/stale-lock recovery. Automation cannot manufacture proof that Damien controls a private key.
4. PR #76 remains an unwired signed-attestation adapter with no production trust roots; keep production trust disabled.
5. Linked NGL Mesh PR #1 remains draft; isolated operator trust checks do not establish APK/RAE integration without the missing reference artifacts.

No merge, deployment, release, spending, production key operation, or Founder-identity claim occurred.
