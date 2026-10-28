# Stutter-step checkpoint — instant-based world chronology

Date: 2026-10-28 UTC  
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`  
Base: `main` at `9dc981afaca02ddac476ec83e6aba89a400fc9f4`  
Working branch: `fix/instant-chronology-validation-20261027`

## Fresh-state reconciliation

The current `main` head introduced Moonshot experiment reports and exact evidence-version references. The previous temporal-order checkpoint existed only on an unmerged branch; its general lesson was still relevant, but it did not cover the new report/evidence path. Open PR #76 remains draft and does not wire signed attestations into the live server. PR #16 remains closed and superseded by merged PR #18. Issue #17 remains open for independent Founder key custody, concurrency, and crash recovery.

## Source-backed defects

- Model and server history validation compared timestamp strings, so valid offset timestamps could sort differently from their actual instants.
- Moonshot source and experiment-evidence publication checks used lexical comparisons.
- The model importer did not require each retained published version's `publishedAt` to match exactly one retained `publish` event.
- World event chronology and the `updatedAt`/last-event relationship were not consistently enforced at the model import boundary.

## Implementation

- `37ef7ab25a680da7b12f7af06aa7b7356ee2f72b` — compare model chronology and evidence timestamps as parsed instants; reject backward event histories and inconsistent world timestamp bounds.
- `d4da36c63e3a132ebf9479856a9d13dbaf05551e` — add offset-time model regressions.
- `19f56d3cf8a4bb5c1d78c93772a2ff214a62a0ba` — compare persisted server history, source publication, and repeat-discovery chronology by instant.
- `a8eafa37148410362e6c1558488ae18340808274` — add a persisted-envelope startup regression for offset timestamps that sort forward but move backward in real time.
- `53b755ad36f0d3b4ca052edcd5ba6b3ce998db18` — compare proposal/report binding instants in the server.
- `44a78ce7add45801cca5ff3a113d8b4d4ad0df22` — bind every published version timestamp to exactly one retained publication event in model validation.
- `4d0024c9b2a9666a889a98cdf4e909d407efd015` — test rejection of forged publication timestamps.

Regression file: `test/game-temporal-order.test.mjs`. Server startup regression is appended to `test/game-server.test.mjs`.

## Verification status

- No local test execution is claimed. A local shallow clone attempt failed because this runtime could not resolve `github.com`.
- GitHub Actions for the current branch have not yet been observed to complete. Passing status is **not yet established**.
- The tests are designed to cover: a future source version hidden by an offset string, forged source/report evidence timestamps, backwards event chronology, and startup rejection of a persisted corrupt envelope.

## Unresolved blockers and next priorities

1. Open a draft PR to trigger exact-head verification; inspect full, Genesis Evidence Invariant, and browser acceptance results. Repair only demonstrated failures.
2. Recheck current `main` and the PR head before interpreting any workflow result; the base may advance.
3. Continue Issue #17's independently controlled Founder signing, concurrent-writer, and crash/stale-lock acceptance. Do not invent credentials or automatically delete a potentially live lock.
4. Keep PR #76 unwired into the live mutation path and production trust disabled until separately controlled trust roots and live integration are verified.
5. Reconcile stale storage/key-loading PRs against current `main` rather than importing old branch history wholesale.

No merge, deployment, release, spending, production key operation, or Founder-identity claim occurred.
