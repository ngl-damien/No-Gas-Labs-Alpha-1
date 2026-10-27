# Chronicle scope and revocation-binding checkpoint

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
PR: [#122](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/122)
Branch: `feat/inspectable-grant-revocations-20261027`
Base `main`: `c1b2da251c42e98368d2fe5b155c4ba87b84cc3b`
Verified code/test head: `ad005d4a1bf1fbeef5dcf6b02ebceca15d416d19`

## Functional improvements

1. **Revocation binding:** A revocation's work/version is shown only when exactly one earlier authorization for the same work has the same grant ID, its scope exactly matches the earlier claim's subject ID/version/action, and the grant ID is unique across all prior authorization events. Missing, mismatched, duplicate, or cross-work-reused grants remain visible with unresolved scope and a warning.
2. **Claim-authoritative stage scope:** `execute`, `observe`, and `adjudicate` events cannot self-assign their displayed subject. The projection uses the earlier claim's valid subject/version, warns when an event's own subject conflicts, and does not infer scope when no valid prior claim exists. Authorization-scope mismatches remain visible.
3. **Read-only evidence:** The Chronicle does not create authority, revocation, adjudication, XP, or other canonical state. The displayed event remains a record, not proof that the underlying claim is true.

## Regression coverage

- Positive revocation with a prior claim and matching authorization.
- Missing prior authorization; mismatched grant ID; authorization scope mismatch.
- Duplicate prior authorization and cross-work grant-ID reuse.
- Earlier revocation cannot inherit scope from a later claim.
- Stage event subject mismatch; stage subject with no prior claim; authorization scope mismatch.
- Existing projection immutability and malformed-data regressions.

## Verification on code/test head `ad005d4a1bf1fbeef5dcf6b02ebceca15d416d19`

- [Full repository verification — run 40590372368](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40590372368): **success**. Node test suite, Python inspector, package build, and bounded institutional exercise all exited 0; final report `passed: true`.
- [Genesis Evidence Invariant — run 40590372348](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40590372348): **success**.
- [Browser acceptance — run 40590372546](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40590372546): **success**; all nine journeys passed (desktop, phone, institutional-location actions, two-session shared-world, 320px/412px, standalone-file, exact-byte packaging, shared restart). [Browser evidence artifact 12774405371](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40590372546/artifacts/12774405371).

A prior full-verification run on head `b5f8e17725a93b126756e9a9e60f70042379a745` failed at `test/institution-view.test.mjs:133`. The fixture's claim had a valid subject/version but omitted action; the first hardening pass incorrectly treated the missing action as absence of displayable subject. Commit `ad005d4a1bf1fbeef5dcf6b02ebceca15d416d19` separated subject validity from full authorization-binding validity. The three workflows above passed on that repaired code/test head.

This checkpoint update is documentation-only; inspect CI on the resulting new PR head before claiming that head is green. No local test run is claimed.

## Blockers and next priorities

1. Inspect exact-head workflows after this checkpoint-only commit; fix any real failure and rerun.
2. Keep PR #122 draft and unmerged pending review; `main` remains unchanged.
3. Issue [#17](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/issues/17) remains open for independently controlled Founder signing/key custody and safe crash/stale-lock recovery. Automation cannot manufacture proof that Damien controls a private key.
4. PR [#76](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/76) remains draft, diverged, and unwired into the live mutation path; production trust roots are absent. Do not merge stale history wholesale or enable production trust.
5. Linked [NGL Mesh PR #1](https://github.com/ngl-damien/ngl-mesh/pull/1) remains draft. Its isolated operator-key workflow passed, but APK/RAE integration remains unverified because the recovered-source archive, reference APK, and RAE report are absent.

No merge, deployment, release, spending, production key provisioning/rotation/revocation, or Founder-identity claim occurred.
