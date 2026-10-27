# Stutter-step checkpoint — canonical persisted data and decision-store hardening

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
Base `main`: `3458fe31051b09ee198d33a2ce3e185851266ab4`
Branch: `security/canonical-persisted-envelopes-utf8-20261027`

## Source-backed changes

1. `game/service-store.mjs`: require persisted `service.json` to round-trip exactly through `canonicalStringify` before trusting its payload. Duplicate-key, whitespace, and other noncanonical encodings fail with `SERVICE_STORE_NONCANONICAL`.
2. `src/institution/ledger.mjs`: require canonical JSON before ledger replay. Noncanonical or duplicate-key history fails as `LEDGER_TAMPERED`.
3. `game/server.mjs`: reject malformed UTF-8 in persisted `founder.key` instead of silently replacing invalid bytes.
4. `src/institution/decisions.mjs`: replace the decision envelope's stat-then-unbounded-`readFile` path with bounded chunk reads (64 MiB maximum), no-follow/regular-file checks, owner and mode checks, inode/size/time rechecks, strict UTF-8 validation, and canonical JSON enforcement. Require a private, owned decision directory. Writer cleanup now checks the acquired lock inode rather than relying on copied token bytes.

## Regression evidence added

- Duplicate-schema-key fixtures for service store, ledger, and decision store must fail closed.
- Malformed UTF-8 Founder-key fixture must fail before service state is created.
- Decision store rejects symlinked, permissively accessible, and oversized persisted envelopes and releases its lock on failed initialization.
- Decision store rejects a group/world-accessible directory before creating its lock.
- Decision-store lock-release tests preserve replacement regular-file and symlink locks; existing service-store/ledger lock regressions remain.
- Existing ledger tamper/projection tests write canonical JSON so they continue exercising semantic hash-chain and projection validation independently.

## Verification status

Inspect all three GitHub Actions workflows on the final exact head. Earlier pre-extension runs are superseded by later commits and must not be treated as final verification. No local test run is claimed. No merge, deployment, release, production key provisioning/rotation/revocation, or Founder-identity claim is included.

## Remaining blockers / next priorities

1. Poll exact-head full verification, Genesis Evidence Invariant, and browser acceptance; repair failures and rerun.
2. Reconcile PR #107 against its now-completed browser workflow and current `main`; do not merge automatically.
3. Continue Issue #17 with safe stale-lock/crash-recovery acceptance and independently controlled Founder signing. A configured fingerprint is not proof of Damien's identity or key custody.
4. Reconcile PR #76 only after its signed adapter is wired into the live server mutation path and independent trust roots can be provisioned under separately controlled custody.
5. Linked `ngl-mesh` APK/RAE integration remains unverified while required reference artifacts are absent.
