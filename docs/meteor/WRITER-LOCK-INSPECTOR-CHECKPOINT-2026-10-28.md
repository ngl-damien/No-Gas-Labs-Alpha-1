# Read-Only Writer-Lock Inspection Checkpoint — 2026-10-28

## Fresh state and supersession check

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- Base `main` observed at `e2475032b3542ae925fd97bd242fcf084cbb9a41`.
- PR #134 is now merged as `309305b1fca37e743b4b21a8fa5d9deca1a2ca95`; the previous immutable-snapshot checkpoint is historical, not an open task.
- Eleven Alpha One pull requests were open at the state inspection. Security PR #76 is still draft and explicitly not wired into `game/server.mjs`.
- Main exact-head workflows on `e2475032b3542ae925fd97bd242fcf084cbb9a41`: [verify 40643012454](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40643012454), [Genesis Evidence Invariant 40643012371](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40643012371), and [browser acceptance 40643012457](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40643012457) all reported success.
- Issue #17 remains open for independently controlled Founder key custody/identity, adversarial concurrency, and safe crash/stale-lock recovery.

## Functional changes on this branch

1. `game/service-store.mjs` now writes a schema-tagged `.service.lock` record containing PID and opening time, and syncs the lock file before proceeding.
2. `src/institution/ledger.mjs` tags `.writer.lock` metadata with `ngl.ledger-lock.v1` while retaining the existing file sync.
3. `src/institution/decisions.mjs` writes schema-tagged `.decisions.lock` metadata and syncs it instead of writing an opaque random token.
4. `src/institution/lock-inspector.mjs` adds a read-only bounded inspector. It rejects symlinks/non-regular files, overly broad permissions, owner mismatches and files larger than 4096 bytes; opens with `O_NOFOLLOW` where supported; compares lstat/opened-handle/path identity and stable metadata; validates UTF-8; recognizes owner metadata; and never prints legacy opaque tokens.
5. `scripts/inspect-writer-lock.mjs` and `npm run inspect:lock -- <path>` expose the diagnostic locally without deleting or modifying the lock.
6. `test/writer-lock-inspector.test.mjs` covers missing locks, live metadata from service/ledger/decision writers, legacy-token redaction, symlink rejection, oversized files and partial JSON metadata.

## Commits

- `d013abab7723ecdc634c3fb0c0983d4c3f8461bc` — add durable owner metadata to transient writer locks.
- `5339d679253256ca7e3fb75d8149a1557c9589da` — add read-only inspector, CLI, package command and initial tests.
- `7f6577c06cc31b21c013fa43eef6d90e9002c588` — recheck file identity/permissions after read and test partial metadata.
- The final checkpoint commit contains this handoff; inspect the branch head and CI before using any result.

## Verification boundary

Main's green workflows above are evidence only for the main SHA, not this feature branch. The full repository verification, Genesis Evidence Invariant and browser acceptance must all be checked on the final PR head. No local test execution is claimed.

## Safety limits and blockers

- This is diagnostic only: every result has `safeToRemove: false`. A PID probe (`possibly-alive`, `not-found`, or `inaccessible`) is advisory; PID reuse, namespaces and races mean it cannot establish lock ownership or prove a lock stale.
- No automatic lock deletion/recovery was added. The existing inode-check-then-unlink race is not solved by inspection or metadata.
- PR #16 is closed and superseded by merged PR #18. A configured fingerprint does not prove Damien's real-world identity or private-key custody.
- Production trust roots remain absent; PR #76 remains unwired into the live mutation path.
- Linked NGL Mesh APK/RAE integration remains unverified unless the recovered-source archive, reference APK and RAE report are supplied and inspected.

## Next steps

1. Inspect all three workflows on the final PR head; repair only observed failures and rerun.
2. Check the new inspector against the actual service, ledger and decision lock formats in CI; retain fail-closed behavior for malformed or changing files.
3. Continue Issue #17 with adversarial concurrency and crash-recovery acceptance. Do not automate deletion of potentially live locks.
4. Pursue separately controlled Founder signing/key custody; do not treat a fingerprint or a PID probe as identity/authorization evidence.
