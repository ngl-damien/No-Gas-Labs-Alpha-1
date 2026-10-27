# Stutter-step checkpoint: bounded service-store recovery

Date: 2026-10-27 UTC

## Fresh state and conflict challenge

- Alpha One `main` observed at `ad89f14e6c2490ebebf183c50ad513d52155cfbf` before implementation and rechecked unchanged.
- PR #95 has since been merged into main at that exact commit. Its ledger/artifact reader hardening does **not** cover `game/service-store.mjs`, which still used unbounded `readFile(service.json)`.
- Safe branch: `security/service-store-bounded-envelope-read-20261027`, created from the exact main SHA above.
- The existing open PR #60 covers atomic durability/latching across stores but is based on an older divergent main; this work does not import that branch's history.
- PR #16 remains closed/unmerged; merged PR #18 supersedes its self-signing INSTALL flow. Issue #17 remains open for real Founder key custody/identity, adversarial concurrency, and crash/stale-lock recovery.
- Current open Alpha One PR count at reinspection: 12. Linked NGL Mesh PR #1 remains open/draft; isolated operator-trust checks do not prove APK/RAE integration.

## Implementation cycles

1. **Bound persisted service envelope reads** — commit `f842283eaefe71aa1cc8231c88f236b82ef0bd45`.
   - Replace unbounded `readFile(path, 'utf8')` with a bounded regular-file reader capped at 64 MiB.
   - Reject symlink/non-regular paths, group/other-accessible or wrong-owner files, and detect inode, size, timestamp, or path changes around the read.
   - Use `O_NOFOLLOW` / `O_NONBLOCK` when supported and fixed-size chunks, stopping at limit + 1 byte.
   - Distinguish a genuinely missing first-read path from a path that disappears during open/read; only the former initializes a new store.

2. **Regression coverage for unsafe persisted envelopes** — commit `02859c425bac133202611a04e961487e6fbd1822`.
   - Add tests for a sparse oversized envelope, a symlinked envelope, and group/world-accessible permissions.
   - Each failed initialization must release its own writer lock.

3. **Fail closed on reads after uncertain commit durability** — commit `8d2db41b147890a4c2fe72a8ff41c1f9a901ca7a`.
   - The service-store `value` getter now throws `COMMIT_DURABILITY_UNCERTAIN` / HTTP 503 after a post-rename directory-sync failure, rather than exposing a potentially stale in-memory projection.
   - This mirrors the Experiment 001 ledger's fail-closed snapshot boundary.

4. **Regression for the read-side uncertainty boundary** — commit `53399142b82fef98336537dc73bdd75ec75c77a8`.
   - Extend the existing injected directory-sync failure test to assert that reading `store.value` fails closed while the retained disk envelope is validated only by a fresh reopen.

## Verification status

- The implementation and tests are committed on the safe branch.
- Exact-head GitHub Actions for the eventual PR are **pending**; do not claim tests passed until all completed results are inspected.
- No local test run is claimed.

## Limits and next priorities

1. Inspect all exact-head PR workflows; investigate logs and repair any failure rather than waiving it.
2. Keep the 64 MiB service-envelope cap fail-closed. It does not archive, truncate, or migrate oversized existing state; assess observed legitimate state sizes before proposing a migration protocol.
3. Path identity checks reduce symlink/special-file races but are not an atomic `openat` capability boundary; do not claim hostile-filesystem race immunity.
4. Reconcile PR #60's remaining unique changes without importing its divergent history.
5. Continue Issue #17's independently controlled Founder custody, concurrency, and crash/stale-lock acceptance. Do not auto-delete stale locks or provision/rotate/revoke keys.
6. Keep production observation trust disabled until independently controlled trust roots and the actual server mutation path are verified.

No merge, deployment, release, spending, production key operation, or Founder-identity claim occurred.
