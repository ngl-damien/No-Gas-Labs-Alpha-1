# Courier Atomic Lock Publication Checkpoint — 2026-10-28

## Fresh-state basis

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- Default branch at implementation start: `main` at `5ff8b276078f0644e4ef748f43ba3685de5c0070`, merge commit for PR #154 (bounded and validated lock metadata).
- PR #154 is now merged; the remaining `lstat`-then-`unlink` lock-release race is explicitly unresolved.
- Open Alpha One PRs at reinspection: 11; no open PR was found specifically addressing atomic lock publication.
- Issue #17 remains open for independently controlled Founder identity/key custody, adversarial concurrency, and crash/stale-lock recovery.
- PR #16 remains closed and unmerged; merged PR #18 supersedes the original self-signing approach.
- Linked `ngl-damien/ngl-mesh` PR #1 remains draft. This run does not establish full APK/RAE integration.

## Functional change

The previous `acquireLock()` created `.courier.lock` directly with exclusive create, then wrote and synced JSON metadata. The canonical pathname became visible before the metadata write completed. That race required bounded retry logic when a concurrent client read syntactically incomplete JSON.

The new implementation:

1. Creates a private sibling named `.courier-lock-<random>.tmp` with mode 0600.
2. Writes the full `ngl.courier-lock.v1` record, syncs the file, and closes it.
3. Publishes the completed inode with same-directory `link(temp, .courier.lock)`. Hard-link creation is atomic and fails with `EEXIST` rather than replacing an existing lock.
4. Removes the temporary link in best-effort cleanup. A process crash may leave a private temporary artifact; it is not the canonical lock and is not automatically deleted.

The implementation deliberately fails closed if same-directory hard links are unsupported. It does not fall back to exposing an empty/partial canonical lock. The existing bounded retry remains for compatibility/defense against legacy or externally written lock files.

## Changes and evidence

- Source commit: `09a39abd018ead6cd62cb98831bdc5fcf45f67d8` — switch lock creation to private temp file plus atomic hard-link publication.
- Source repair commit: `7a31770e85a082157c907a12cb22d6d6da17bcf0` — import the path helper used to locate the sibling temp file; caught during source reinspection.
- Test commit: `caa9fd024faf089d9a86e281ee4d7d9fdfb036cf` — launch ten concurrent child-process clients, verify all requests persist, and assert no canonical lock or temporary publication artifacts remain after success.
- Documentation commit: `03aa5a5d11e02333f18eb1ff4e8d9ecee0091de2` — document atomic publication, hard-link filesystem requirement, and remaining release-race limitation.
- At checkpoint creation, GitHub-hosted CI for this branch had not yet been inspected on the final head. Do not claim tests pass until the exact PR head's full verification, Genesis Evidence Invariant, and browser acceptance workflows are observed.
- No local test run is claimed.

## Remaining limitations

- The release path still performs identity check followed by unlink; this is not atomic compare-and-unlink and remains a race.
- PID liveness is advisory. No stale lock is automatically removed.
- A crash can leave a private `.courier-lock-*.tmp` file. This run does not add automatic cleanup for orphan temporary files.
- The hard-link publication step may be unsupported on some filesystems; the code fails closed instead of reverting to unsafe direct publication.
- No independently controlled Founder signing operation was available. A configured fingerprint is not real-world identity proof.
- Signed world-attestation PRs #66/#73/#74/#76 remain unmerged and do not establish production mutation-path trust-root provisioning.

## Next prioritized steps

1. Inspect all three exact-head GitHub Actions workflows after PR creation; fix demonstrated failures and rerun.
2. Reinspect `main` and PR state before further edits.
3. Continue adversarial lock release and crash-recovery work, preserving `LOCK_OWNERSHIP_LOST` and `COMMIT_DURABILITY_UNCERTAIN` distinctions; do not claim atomic release without a platform-supported primitive.
4. Continue Issue #17's independently controlled Founder key-custody acceptance only when a separately controlled signing operation can be evidenced.
5. Keep production authorization fail-closed until independently controlled trust roots and actual mutation-path integration are demonstrated.

No merge, deployment, release, spending, production key operation, automatic lock deletion, or Founder decision occurred.
