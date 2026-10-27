# Stutter-step checkpoint: Experiment 001 durability uncertainty

Date: 2026-10-26 UTC

## Source-backed defect

On current main `33f8aa9cb601788dc829097fe84553602112ea59`, `experiment-001/institutional-cycle.mjs` atomically renamed the next ledger envelope, then attempted a containing-directory sync. It assigned `state = next` before that sync and reported `COMMIT_DURABILITY_UNCERTAIN` on sync failure, but the same store instance remained writable. That allowed later commits to proceed despite an unresolved durability boundary.

## Change on a clean branch

Branch: `fix/experiment001-durability-uncertain-latch-20261026`

- `92b39350fb7885475e77d6f911d4c43a7d797767` — latch the store after post-rename directory-sync failure; keep the in-memory snapshot at the prior sequence; reject further commits with `COMMIT_DURABILITY_UNCERTAIN` until a fresh validated `openInstitution()`.
- `9e017c7c4eba130f166f0e55c9c73fb3df5fb105` — add child-process fault injection against `FileHandle.sync` to force the directory-sync failure after the temp-file sync, then assert: the first commit reports uncertainty, the live snapshot stays at sequence 0, a second commit is blocked, and a fresh open validates the visible sequence-1 ledger.
- This is separate from PR #60's service-store and `src/institution/ledger.mjs` changes; it closes the analogous gap in the Experiment 001 ledger.

## Reinspection and conflicts

- Latest observed main remains `33f8aa9cb601788dc829097fe84553602112ea59`.
- Compare against main before checkpoint artifact: 2 commits ahead, 0 behind; only the Experiment 001 implementation and its test changed.
- Existing concurrency and stale-lock tests already cover independent writers, process races, retry after `LEDGER_LOCKED`, and fail-closed stale locks. No automatic stale-lock deletion was added.
- PR #67's canonical-JSON fix is separate and remains open; this branch does not touch its files.
- Issue #17 remains open. PR #16's self-signing flow is superseded by merged PR #18; actual Founder key custody/identity remains unproven.

## Verification status

GitHub Actions must verify the final PR head. No local test run is claimed. Do not count a workflow as passing until its completed exact-head result is inspected.

## Limits / next priorities

1. Inspect all exact-head CI workflows; repair any failure and update this checkpoint with the new commit/result.
2. Keep `COMMIT_DURABILITY_UNCERTAIN` fail-closed: the renamed file may be visible, but crash durability is unknown until a validated reopen and cannot be inferred from a model assertion.
3. Continue Issue #17's separate Founder custody and crash/concurrency acceptance work. No production key or external signing service is available in this repository.
4. Do not merge, deploy, provision/rotate/revoke keys, or claim Founder identity/autonomous discovery.

No merge, deployment, release, spending, key operation, or Founder-approval claim occurred.
