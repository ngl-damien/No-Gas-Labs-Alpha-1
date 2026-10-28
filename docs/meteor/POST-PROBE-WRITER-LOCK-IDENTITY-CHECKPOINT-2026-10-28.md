# Post-Probe Writer-Lock Identity Checkpoint — 2026-10-28

## Fresh state and supersession check

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- `main` observed at `a29caf62f737f41544d38b84966f80f834e0fef2` after merged PR #143 (bounded recovery verification) and PR #142 (Founder data-path/courier race hardening).
- PR #16 remains closed and superseded by merged PR #18; do not revive the self-signing branch.
- Issue #17 remains open for independently controlled Founder key custody/identity, adversarial concurrency, and crash/stale-lock recovery.
- The existing lock inspector is diagnostic-only and always reports `safeToRemove: false`. It already checked file identity around the read, but the PID probe happened after the last identity check.

## Functional change

- After the synchronous PID probe, `inspectWriterLock()` rechecks both the lock pathname and the opened file handle against the original stable snapshot.
- If the path disappears during the probe, return `status: changed` with `lock-disappeared-during-owner-probe`.
- If the path is replaced or the inode metadata changes during the probe, return `status: changed` with `lock-changed-during-owner-probe`; unsafe replacement files remain classified as unsafe.
- No lock is deleted and no diagnostic result authorizes deletion.

## Regression coverage

- Deterministically replace the lock path while `process.kill(pid, 0)` is being probed; assert a changed result and no removal authorization.
- Remove the lock path during the probe; assert the disappearance-specific changed result.
- Mutate owner metadata in place during the probe; assert the changed result.
- The replacement test unlinks before rename so it does not rely on POSIX rename-over-existing behavior.

## Commits

- `9b4959ccf52218ba29e5d1c9ae0e55d628daae2c` — recheck lock identity after PID probe.
- `3c9525f67535e290ede1c2321cdb18e334eae518` — cover replacement and disappearance during probe.
- `9fc926e56c6b9dbc7bc4ab093d10bec65ae74631` — cover in-place metadata mutation and portable replacement.

## Verification boundary

- Branch: `fix/lock-inspector-post-probe-identity-20261028`.
- Base SHA: `a29caf62f737f41544d38b84966f80f834e0fef2`.
- Final implementation SHA before checkpoint: `9fc926e56c6b9dbc7bc4ab093d10bec65ae74631`.
- Exact-head GitHub Actions verification is pending; no local test execution or successful CI result is claimed in this checkpoint.
- PID probes remain advisory: PID reuse, namespaces, permissions and timing prevent them from proving lock ownership or proving staleness.
- Path/inode rechecks are still best-effort, not an atomic `openat` capability boundary.

## Next steps

1. Inspect Full Repository Verification, Genesis Evidence Invariant, and Browser Acceptance for the final PR head; fix only observed failures and rerun.
2. Reinspect the branch and `main` after CI; do not merge automatically.
3. Continue Issue #17's cross-process writer and crash-recovery acceptance without deleting potentially live/replacement locks.
4. Keep production Founder trust fail-closed until independently controlled identity/key custody and live mutation-path integration are evidenced.

No merge, deployment, release, spending, production key operation, or Founder decision occurred.
