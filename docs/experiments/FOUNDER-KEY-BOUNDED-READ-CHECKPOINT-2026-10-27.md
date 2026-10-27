# Stutter-step checkpoint: bounded persisted Founder-key reads

Date: 2026-10-27 UTC

## Fresh-state inspection and challenge

- Alpha One `main` was re-read at `78bd30f60e89a32b08a538f71203c16dfcc50c65` before implementation and rechecked unchanged after the first two commits.
- PR #98's exact head `4a005e3d49a5ea55a3f27cda1b4c82322f5c2a05` has completed Full verification, Genesis Evidence Invariant, and browser acceptance successfully. That resolves the previous browser-readiness checkpoint; no merge was performed.
- `game/server.mjs` still used `handle.readFile('utf8')` for persisted `founder.key`, and only checked the 1,024-byte key limit after the whole file had been allocated. This is independent of the bounded `service.json` reader merged through PR #96.
- Existing PR #63 overlaps `game/server.mjs` and `test/founder-key-file-hardening.test.mjs` but is based on stale main `17096dd6789299ad1bcd6de544db602a529da3c3` and reports non-mergeable. This branch starts directly from current main; do not import PR #63 history wholesale.
- Issue #17 remains open for independently controlled Founder-key custody/identity, adversarial concurrency, and crash/stale-lock recovery. A locally generated key or configured fingerprint is not proof of Damien's identity.

## Functional implementation cycles

1. **Bound credential reads** — commit `337ec9771e91e26ef81b661779cfd7276a914780`.
   - Cap persisted key-file input at 1,025 bytes (a maximum 1,024-byte key plus its generated newline).
   - Reject oversized files before opening, recheck the opened descriptor size, and read through a fixed 1,026-byte buffer to detect growth without unbounded allocation.
   - Verify current-user ownership, private permissions, regular-file status, and inode identity; use `O_NOFOLLOW` and `O_NONBLOCK` where available.
   - Recheck descriptor/path metadata and byte count after reading. This reduces race and allocation risk but does not prove immunity to every hostile-filesystem race.

2. **Boundary regression tests** — commit `f650df276eca421282d601fec762e52e976f4a11`.
   - A 1,024-byte persisted key plus newline remains accepted.
   - A sparse 1,026-byte `founder.key` is rejected with the explicit limit error before `service.json` is created.
   - Existing symlink, permissions, directory privacy, generated-key reuse, and session-churn tests remain in the same test file.

## Verification status

- No local test run is claimed.
- Exact-head GitHub Actions have not yet been triggered for this branch; create the draft PR and inspect all three workflows before claiming success.
- PR #98's green checks are on its own test-only head and do not verify this change.

## Next priorities

1. Inspect exact-head Full verification, Genesis Evidence Invariant, and browser acceptance. If any fail, read the failing job logs, fix the defect, and rerun.
2. Reinspect the PR diff and base/head SHAs; keep it draft/unmerged until verified.
3. Reconcile PR #63's unique remaining changes against current main, not by wholesale merge.
4. Continue Issue #17's independent key custody, concurrency, and crash-recovery acceptance. Do not provision, rotate, revoke, or fabricate Founder credentials.
5. Keep PR #76 and related trust adapters non-production until independent trust roots and the live mutation path are actually verified.

No merge, deployment, release, spending, production key operation, or Founder-identity claim occurred.
