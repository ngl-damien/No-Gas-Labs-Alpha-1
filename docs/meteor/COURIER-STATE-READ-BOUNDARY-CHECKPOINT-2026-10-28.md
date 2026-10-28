# Courier State Read-Boundary Checkpoint — 2026-10-28

## Fresh-state basis

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- `main` remains at `f4183146fa7959e24603026cbcac7133c4a6c809`, the merge commit for PR #151.
- Safe branch: `fix/courier-state-regular-file-boundary-20261028`, created from that exact main head.
- Implementation and repair history: `0abc686d4264656683d0956b67b827eefc5b6f7f`, `99e2b9bff5e8ec383065becb16a02c337e86fe84`, `44be170d58e39f9ccc2db12d1a57a9f7f0a4905d` (intermediate diagnostic edit superseded by the next repair), and `a12695a8d024c7ec4c5d24e480a54c1464ff0f87`.
- PR #152 is open, draft, and unmerged. Issue #17 remains open. PR #16 is closed/unmerged; merged PR #18 supersedes its self-signing approach.
- PR #60 remains draft and addresses other durable-store sync boundaries; it does not replace the courier state-file read path changed here.

## Functional change 1 — bounded regular-file reader

The courier previously opened `courier.json` with `O_NOFOLLOW`, checked `stat().size`, then called unbounded `readFile()`. A FIFO is not a symlink and can block startup; a file that grows after the initial size check can exceed the intended read budget.

The new reader:

1. Adds `O_NONBLOCK` where supported and rejects non-regular state objects before reading.
2. Reads in 64 KiB chunks and consumes at most `MAX_STATE + 1` bytes, failing closed if the configured limit is exceeded.
3. Compares file identity and metadata before/after the read and checks that the pathname still names the same file.
4. Rejects invalid UTF-8 instead of silently decoding replacement characters.

Added `test/courier-state-file-boundary.test.mjs`. On non-Windows systems it creates a FIFO at `courier.json`, launches a child with a bounded timeout, and requires prompt `CORRUPT_STATE` rejection.

## Functional change 2 — retain failed exercise diagnostics

The first exact-head verification attempt at `851748f6c0bc79972e429b480afc5644a8c44273` failed in the bounded institutional exercise even though the Node suite, Python inspector, and package build passed. `scripts/meteor-demo.mjs` discarded a failed child's captured stdout/stderr, preventing direct inspection of the nested report.

Inspection of `src/forge/runner.mjs` showed that the bounded verifier deliberately sets `PATH` to the Node executable directory. The new FIFO regression initially invoked `mkfifo` by name, which depends on PATH lookup. The test was corrected to use `/usr/bin/mkfifo` on non-Windows POSIX runners and a five-second child timeout. The exact nested error from the first failed run was not directly captured, so the PATH diagnosis is a source-backed explanation, not a claim that the hidden stderr was observed.

`scripts/meteor-demo.mjs` now writes stdout and stderr even when a stage fails, records the stage exit code, and surfaces a bounded diagnostic tail. An intermediate implementation commit `44be170d58e39f9ccc2db12d1a57a9f7f0a4905d` was immediately corrected by `a12695a8d024c7ec4c5d24e480a54c1464ff0f87`; the current branch source has the corrected log paths and bounded error output.

## Exact-head verification evidence

On implementation head `a12695a8d024c7ec4c5d24e480a54c1464ff0f87`, all three required GitHub Actions workflows passed:

- Full repository verification: [run 40729099320](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40729099320) — Node suite, Python inspector, package build, and bounded institutional exercise passed.
- Genesis Evidence Invariant: [run 40729099518](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40729099518) — passed.
- Browser acceptance: [run 40729099436](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40729099436) — passed, including desktop/mobile/shared-world/recovery journeys and receipt preservation.

Duplicate push-triggered workflows on the same exact head also passed: verify [40729091043](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40729091043), Genesis [40729091065](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40729091065), browser [40729091059](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40729091059).

These are observed GitHub-hosted results; no local test execution is claimed. This checkpoint-only commit changes the branch head, so inspect all three workflows again on the new exact head before treating verification as current.

## Remaining limits / next priorities

1. Inspect exact-head workflows after this checkpoint commit; repair any demonstrated failure and rerun.
2. File identity/metadata comparison is a detection boundary, not an atomic filesystem snapshot primitive.
3. Courier lock release still has a documented check-to-unlink race. Do not automatically remove uncertain or potentially live locks.
4. Issue #17's independently controlled Founder identity/private-key custody, adversarial concurrent-writer acceptance, and crash/stale-lock recovery remain open.
5. Keep signed world-attestation work fail-closed until separately controlled trust roots and actual live mutation-path integration are demonstrated.
6. Reinspect `main` and open PRs before any integration; do not merge automatically.

No merge, deployment, release, spending, production key operation, or Founder decision occurred. No real-world Founder-identity proof or autonomous-discovery breakthrough is claimed.
