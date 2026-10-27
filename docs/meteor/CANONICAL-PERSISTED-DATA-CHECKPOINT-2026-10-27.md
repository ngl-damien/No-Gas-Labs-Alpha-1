# Stutter-step checkpoint — canonical persisted data

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
Base `main`: `3458fe31051b09ee198d33a2ce3e185851266ab4`
Branch: `security/canonical-persisted-envelopes-utf8-20261027`

## Source-backed changes

1. `game/service-store.mjs`: require persisted `service.json` to round-trip exactly through `canonicalStringify` before its payload is trusted. Reject duplicate-key/whitespace/noncanonical encodings with `SERVICE_STORE_NONCANONICAL`.
2. `src/institution/ledger.mjs`: require the persisted ledger to be canonical JSON before replay. Noncanonical or duplicate-key encodings fail as `LEDGER_TAMPERED`.
3. `game/server.mjs`: reject malformed UTF-8 in persisted `founder.key` instead of silently replacing invalid bytes.

## Regression evidence added

- Service-store duplicate-schema-key fixture must fail closed and release its writer lock.
- Ledger duplicate-schema-key fixture must fail closed and release its writer lock.
- Existing ledger tamper/projection tests now write canonical JSON so they continue to exercise semantic hash-chain and projection validation separately.
- Malformed UTF-8 Founder-key fixture must be rejected before `service.json` is created.

## Verification status

GitHub Actions must be inspected on the exact final head before claiming success. No local test run is claimed. The work does not provision or rotate Founder keys, change production trust roots, merge a PR, or deploy anything.

## Remaining blockers / next priorities

1. Inspect exact-head full verification, Genesis Evidence Invariant, and browser acceptance; repair failures and rerun.
2. Reconcile PR #107 against the now-completed browser workflow and current `main`; do not merge automatically.
3. Continue Issue #17 with safe stale-lock/crash-recovery acceptance and independently controlled Founder signing. A configured fingerprint is not proof of Damien's identity or key custody.
4. Reconcile PR #76 only after its adapter is wired through the live server mutation path and independent trust roots can be provisioned under separately controlled custody.
5. Linked `ngl-mesh` APK/RAE integration remains unverified while its reference artifacts are absent.
