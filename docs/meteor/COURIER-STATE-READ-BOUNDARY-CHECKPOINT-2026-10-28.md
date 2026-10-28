# Courier State Read-Boundary Checkpoint — 2026-10-28

## Fresh-state basis

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- `main` was re-inspected at `f4183146fa7959e24603026cbcac7133c4a6c809`, the merge commit for PR #151.
- Safe branch: `fix/courier-state-regular-file-boundary-20261028`, created from that exact main head.
- Implementation commit: `0abc686d4264656683d0956b67b827eefc5b6f7f`.
- Issue #17 remains open. PR #16 is closed/unmerged; merged PR #18 supersedes its self-signing approach.
- PR #60 is draft and addresses other durable-store sync boundaries; it does not replace the courier's state-file read path changed here.

## Functional change

The courier previously opened `courier.json` with `O_NOFOLLOW`, checked `stat().size`, and then called unbounded `readFile()`. `O_NOFOLLOW` rejects symbolic links but does not reject a FIFO. Opening a FIFO for reading can block startup indefinitely, and a file that grows after the initial size check could exceed the intended read budget.

The new reader:

1. Adds `O_NONBLOCK` where supported and rejects any opened state object that is not a regular file before reading it.
2. Reads in 64 KiB chunks and consumes at most `MAX_STATE + 1` bytes, failing closed if the state exceeds its configured limit.
3. Compares the opened file's identity and metadata before/after reading and checks that the pathname still names that same file.
4. Rejects invalid UTF-8 rather than silently decoding replacement characters.

Added `test/courier-state-file-boundary.test.mjs`, which creates a FIFO on non-Windows platforms and launches a child process with a two-second timeout. The child must promptly report `CORRUPT_STATE` with the regular-file-boundary message instead of hanging.

## Commits and evidence

- `0abc686d4264656683d0956b67b827eefc5b6f7f` — bounded regular-file reader and FIFO regression.
- This checkpoint is a separate commit. Refresh the branch head and inspect Full Repository Verification, Genesis Evidence Invariant, and Browser Acceptance on the exact final PR head before claiming success.
- No local test execution is claimed.

## Remaining limits / next priorities

1. Inspect all exact-head GitHub Actions results after the checkpoint commit; repair demonstrated failures and rerun.
2. The file identity/metadata comparison is a detection boundary, not a universal atomic filesystem snapshot primitive.
3. Courier lock release still uses a best-effort identity check followed by unlink; the check-to-unlink race remains explicitly unresolved. Do not automatically remove uncertain or potentially live locks.
4. Issue #17's independently controlled Founder identity/private-key custody, adversarial concurrent-writer acceptance, and crash/stale-lock recovery remain open.
5. Keep signed world-attestation work fail-closed until separately controlled trust roots and actual live mutation-path integration are demonstrated.
6. Reinspect current `main` and open PRs before any integration; do not merge automatically.

No merge, deployment, release, spending, production key operation, or Founder decision occurred. No real-world Founder-identity proof or autonomous-discovery breakthrough is claimed.
