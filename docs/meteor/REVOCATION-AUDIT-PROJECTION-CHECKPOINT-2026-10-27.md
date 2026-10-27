# Stutter-step checkpoint — event-level revocation audit

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
Base `main`: `e5421862a6632b4b705182fea6ef6c6de7f9686c`
Branch: `feat/revocation-audit-projection-20261027`
Implementation head before this checkpoint: `c5848259fa281c652464f08ee32683eb01fd4491`

## Fresh-state inspection and challenged priority

PR #120 was confirmed merged at `e5421862a6632b4b705182fea6ef6c6de7f9686c`; the current main SHA remained unchanged on a second inspection. The previous world-projection checkpoint explicitly called for reviewing consumers of scoped revocation audit data.

In `src/world/project.js`, `state.revoked` is a Set-derived unique list of grant IDs. It intentionally preserves compatibility, but it collapses separate revocation events and their scope when the same grant is revoked in more than one quest. `src/world/realm.js` exposed no event-level revocation audit. Canonical history retained the records, but the realm projection did not provide a scoped audit view.

## Implemented cycles

1. **Projection evidence:** Added `state.revocation_audit`, derived only from host-verified revocation events. Each entry records `event_id`, `grant_id`, `scope` (`global` or `quest`), and nullable `quest_id`. The existing `state.revoked` remains a unique grant-ID list.
2. **Realm integration:** `projectRealm()` now exposes a defensive copy of event-level audit entries without changing world-effect semantics.
3. **Seed compatibility and integrity:** Pre-audit seeds lacking `revocation_audit` are accepted only after replay reconstructs the field and every legacy field still matches. If the field is supplied, it must match replay; caller-provided scope cannot override the audit.
4. **Regression coverage:** Tests cover two different scoped revocations of the same grant, a global revocation, omission of an unverified revocation, realm exposure, legacy-seed replay, and rejection of a forged audit seed.

## Commits

- `ac39d9a50cff62ffecda2e849ba827b15b427b78` — event-level audit and legacy-seed normalization.
- `9e6b4735b7961ed057dcce59960a139cddf6a9d7` — scope, duplicate-grant, unverified-event, and legacy-seed regressions.
- `f4ac6b1e1b6ea3cce9fd542f80c74b2ab51e0f3e` — expose audit through realm projection.
- `6a95748e4e6d2969549567978562ce9b3d2aacad` — clarify compatibility semantics.
- `c5848259fa281c652464f08ee32683eb01fd4491` — reject caller-supplied forged audit data.

## Verification boundary

GitHub Actions exact-head workflows must be inspected after PR creation. No local test execution is claimed. Until those runs finish, these tests are added but not yet reported as passing.

## Unresolved blockers / next priorities

1. Inspect all exact-head CI workflows; fix any real failure and rerun.
2. Keep PR #16 closed and unmerged; merged PR #18 supersedes its self-signing flow.
3. Issue #17 remains open for independently controlled Founder identity/key custody and safe crash/stale-lock recovery. No real private key was provisioned.
4. PR #76 remains an unwired signed-attestation adapter without production trust roots; do not enable production trust.
5. Reconcile other security branches against fresh main rather than importing stale histories wholesale.

No merge, deployment, release, spending, production key provisioning/rotation/revocation, or Founder-identity claim.
