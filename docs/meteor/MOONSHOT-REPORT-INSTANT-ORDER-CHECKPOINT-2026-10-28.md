# Stutter-step checkpoint — Moonshot report chronology and mutation clock guard

Date: 2026-10-28 UTC  
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`  
Base `main` at implementation start: `427ff2993cab3d83bb0d18e64f0f9ae09513090f`  
Branch: `fix/moonshot-report-instant-order-20261028`  
PR: #130 (draft, open, unmerged)

## Fresh-state challenge

PR #129 has been merged. Current `main` already compares imported event/source chronology by parsed instants and binds publication timestamps to retained publish events. The remaining live mutation path in `applyAction(report-experiment)` still compared a proposal's timestamp lexically to the report instant. The model transition also did not reject a caller-supplied action time earlier than the world's current `updatedAt`, so it could return a state that import validation would later reject.

## Implemented cycles

### Cycle 1 — Resolve report eligibility by instant

- `ef78c1484eeb9cc7cd06571d5dceb20ee4340f04`: replace lexical proposal/report comparison with parsed-instant comparison; require one unique retained proposal ID.
- `7712de090c23fb6edfed75970fa0e6f084f01ebd`: add regression proving a valid earlier proposal timestamp with offset `2026-10-27T02:00:03+02:00` can be reported at `00:00:04Z`.

### Cycle 2 — Reject clock rollback at the transition boundary

- `d7094798c03a7a40af3a7e316f7a40687353c6b9`: reject mutation when `now` precedes the current world's parsed `updatedAt`, with `INVALID_CHRONOLOGY` / HTTP-style status 409. Equal instants remain allowed.
- `d603317c43f8c58f4a4c673ca2ed48de50214fe3`: add regression that a backwards action is rejected without mutating caller-owned state, while an action at the same instant remains valid.

Regression file: `test/game-temporal-order.test.mjs`.

## Verification evidence

- Main at the beginning of the run: exact-head workflows passed on `427ff2993cab3d83bb0d18e64f0f9ae09513090f`: [verify 40620195608](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40620195608), [Genesis 40620195551](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40620195551), [browser 40620195603](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40620195603).
- Cycle 1 code head `7712de090c23fb6edfed75970fa0e6f084f01ebd`: verify passed [40623019714](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40623019714); Genesis passed [40623019722](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40623019722). Browser runs [40623019713](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40623019713) and [40623048297](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40623048297) were still in progress at last poll; no browser pass is claimed for that head.
- Cycle 2 code head `d603317c43f8c58f4a4c673ca2ed48de50214fe3`: Genesis passed [40623127460](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40623127460). Full verification [40623127396](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40623127396) and [40623125233](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40623125233), and browser runs [40623127341](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40623127341) and [40623125321](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40623125321), were in progress at last poll. These are not claimed as passes.
- No local test run is claimed. Exact-head checks after this checkpoint commit must be inspected before reporting final status.

## Unresolved blockers and next steps

1. Inspect verify, Genesis Evidence Invariant, and browser acceptance on the final PR head. Read failure logs and repair only demonstrated defects.
2. Re-inspect `main` and PR #130 before further changes; do not assume this branch remains current.
3. Issue #17 remains open for independently controlled Founder signing/key custody, adversarial concurrency, and safe crash/stale-lock recovery. Do not invent credentials or automatically delete a potentially live lock.
4. PR #16 remains closed and superseded by merged PR #18. PR #76 remains draft and unwired into the live server mutation path; no production trust roots are provisioned.
5. Keep all merges, deployment, release, spending, and production key operations outside this run.

No merge, deployment, release, spending, production key operation, or Founder-identity claim occurred.
