# Service Store Concurrent Commit Checkpoint — 2026-10-28

## Current state

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
- Base inspected before edits: `main` at `cd1507e64104ddd4614a3226ad1954fde2168d5d` (Moonshot retained-challenge feature).
- Safe branch: `fix/service-store-concurrent-commit-guard-20261028`
- Draft PR: [#132 — serialize service-store commits and guard stale revisions](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/132), open and unmerged.
- Code/test head before this checkpoint refresh: `f3195b66a444494f8faa0977d5af8e0b7ff0a2d6`
- This checkpoint update will create a new exact head; inspect its CI before claiming final verification.
- No merge, deployment, release, spending, or production key operation occurred.

## Why this was prioritized

Fresh inspection showed that `game/server.mjs` serializes its HTTP action writes with an `enqueue` queue, but the exported `createServiceStore().commit()` primitive itself did not serialize concurrent callers or reject a candidate derived from an older revision. It also released its writer lock immediately on `close()` without waiting for an already-running commit. This is a store-abstraction reliability gap; the inspection did **not** establish an observed lost-update through the current HTTP path.

Issue #17 also asks for stronger concurrent-writer evidence. Existing tests cover competing store opens and process-level lock exclusion; the added ledger test now directly exercises two simultaneous appends from the same expected revision.

## Functional changes

1. Serialize commits within one service-store lease.
2. When both current and candidate payloads expose a safe integer revision (top-level `revision` or canonical `world.revision`), require the candidate to advance exactly one revision. Reject stale or skipped candidates with `SERVICE_STALE_REVISION` / HTTP status 409.
3. Snapshot commit input immediately as strict canonical JSON. Accessor-backed/exotic data is rejected without invoking getters; caller mutation while the commit waits cannot change the candidate.
4. Drain commits accepted before `close()` releases the writer lease. Reject new commits once closing starts.
5. Preserve stale-revision conflicts at the HTTP error boundary instead of obscuring them as generic persistence failures.
6. Add an adversarial ledger concurrency acceptance test: two appends with the same expected revision must yield one committed event and one `STALE_REVISION`, with the single winner retained after reopen.

## Commits in this run

- `756192b691dfea8ed5eb43f45734d3ef6b38f05b` — serialize commits and reject stale revisions.
- `78174415f4ec039b529bc080e15a03eaff600ba3` — concurrent service-store stale-revision regression.
- `4ddbc5b634a903e2f67d268886d8aae8f3b511a2` — drain accepted commits on close and snapshot candidates.
- `63b44a3bd56e261cc1bb470872b497581f1af7fb` — close-drain, caller-mutation, and accessor regressions.
- `c1375417aa950ed49b6a3ad7d7175e769cad69e7` — surface stale-revision conflicts at the HTTP boundary.
- `fe620533373bfedf7c8bbc1372fd5aa254ffa405` — test canonical nested world revisions.
- `4a4e4d9e93ec92e6a3538e63c25ea7c2312d9d37` — initial durable checkpoint.
- `f3195b66a444494f8faa0977d5af8e0b7ff0a2d6` — concurrent ledger append acceptance.

Six new regression tests cover same-revision service-store commits and reopen, nested world revision, close draining, caller mutation after submission, accessor rejection without getter invocation, and simultaneous ledger appends with stale-revision refusal and reopen.

## Verification evidence

On exact code/checkpoint head `4a4e4d9e93ec92e6a3538e63c25ea7c2312d9d37` before the additional ledger test and this checkpoint refresh:

- [Push verification run 40633767244](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40633767244) — **success**; its `world-projection` job's `Execute tests, package and bounded institutional exercise` step succeeded.
- [Push Genesis Evidence Invariant run 40633767238](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40633767238) — **success**, including the attack-evidence-boundary step.
- Browser acceptance runs [40633767261](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40633767261) and [40633800380](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40633800380) were **still in progress** at last inspection. Do not call browser acceptance green based on these runs.
- The new ledger concurrency test was added after those results; those results do **not** verify it.
- No local test run is claimed.

The final checkpoint head must be re-verified. Inspect the newest full verification, Genesis Evidence Invariant, and browser acceptance workflows; repair any demonstrated failure and rerun on the resulting exact head.

## Remaining blockers and boundaries

1. Issue [#17](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/issues/17) remains open for independently controlled Founder key custody/identity and safe crash/stale-lock recovery. PR #16 is closed and superseded by merged PR #18; no independent proof of Damien's key custody exists.
2. PR #60's directory-sync/durability hardening is already represented in current `main` source, although that old PR remains open and diverged. Do not merge stale branches wholesale.
3. PR #76's signed-attestation adapter is still not wired into the live mutation path and production trust roots are absent.
4. NGL Mesh PR #1 remains draft; full APK/RAE integration is not verified because the recovered-source archive, reference APK, and RAE report are unavailable.
5. This change strengthens the reusable service-store API; the current HTTP route already has its own serial queue. It does not prove a deployed exploit or establish production security.
6. Lock release still uses an inode check followed by unlink; those are not an atomic compare-and-unlink primitive. Stale-lock recovery remains fail-closed and manual; this run does not claim to solve that race.

## Next steps

1. Inspect exact-final-head full verification, Genesis Evidence Invariant, and browser acceptance.
2. If a workflow fails, inspect its actual logs, fix the demonstrated defect, and rerun; otherwise record exact successful run IDs.
3. Reinspect current `main`, open PRs, and Issue #17 before selecting the next implementation.
4. Continue independent key-custody and crash/concurrency acceptance without automatically deleting potentially live locks or performing key operations.
