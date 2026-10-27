# Stutter-step checkpoint — bounded institutional report input

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
Base `main` rechecked before checkpoint: `545482cbc7bb8a13c5293c98addc9e4df5e4c5c0`
Branch: `security/bounded-institution-report-input-20261027`

## Source-backed defect

The executable startup path read `NGL_INSTITUTION_REPORT` using unbounded `readFile(..., 'utf8')` and immediately called `JSON.parse`. Unlike the API request parser and Founder INSTALL approval path, this configured report input did not have a byte cap, fatal UTF-8 check, duplicate-key rejection, or nesting preflight. A large or ambiguous report could consume unbounded memory or yield parser-dependent report meaning before the server was initialized.

## Functional changes

1. Promoted the existing bounded regular-file reader from `scripts/bounded-file-reader.mjs` to `src/bounded-file-reader.mjs`, preserving its chunk cap, no-follow/regular-file checks, path/handle identity and metadata checks, and strict UTF-8 validation.
2. Updated the Founder INSTALL CLI and its existing reader tests to use the shared source utility; removed the old duplicate utility file.
3. Added `src/institution/report-reader.mjs`: institution reports are capped at 16 MiB, must be regular non-symlink files, must be valid UTF-8, reject duplicate keys and nesting beyond 128 before `JSON.parse`, and must have an object root.
4. Replaced the server CLI's direct unbounded report read with `readInstitutionReport`.
5. Added seven unit regressions for valid JSON, escaped duplicate keys, malformed UTF-8, symlinks, oversized sparse files, excessive nesting, and non-object roots; added a CLI integration regression proving an ambiguous report exits before creating the runtime directory.

## Implementation commits before this checkpoint

- `a06e603bb3a94305821547450499b4e6b92d5e42` — promote shared reader
- `bef9ec30779a921fbfae0946866464f732d0ae47` — update approval CLI import
- `fbe46fa84e29baeef8d8f43159e62d144aeff632` — update existing reader tests
- `b05246a073559bd1776d0499e3433aebe6f01a07` — remove duplicate old utility
- `2c0ec491dc6086a326cab758c61d45567befe13b` — add strict report reader
- `f364f856e075cc3ef8766f4d20d8483dfd9e60e6` — add seven unit regressions
- `9b009a588d433bf983b7e38382a1c49d6bbfb657` — wire startup to reader
- `800ec057711924c2c6772b23146a75f13f9b32fb` — add fail-before-side-effects integration test
- `64b201606d8b172376e3079ef98d1b0f7d259e8c` — fix escaped-duplicate integration fixture

## Verification status — code head before this checkpoint refresh

Code head `871f9c65ef3f29f36de3284df724d7458f19561c` completed all three PR-triggered GitHub Actions workflows successfully:

- Full repository verification run [40553489901](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40553489901): success; workflow report `passed: true`.
- Genesis Evidence Invariant run [40553489620](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40553489620): success.
- Browser acceptance run [40553489689](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40553489689): success. Logs show all nine journeys passed: desktop, phone, four institutional-location actions, two-session shared world, 320px and 412px layouts, standalone file, exact-byte packaging, and restart persistence. Browser receipts/screenshots are preserved in [artifact 12757045181](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40553489689/artifacts/12757045181).

An intermediate full-verification failure on `800ec057711924c2c6772b23146a75f13f9b32fb` was traced to a wrongly escaped duplicate-key fixture. The fixture was corrected in `64b201606d8b172376e3079ef98d1b0f7d259e8c`; the later code head passed full verification.

This checkpoint refresh is documentation-only and changes the branch head. Inspect the new exact-head workflow runs before treating the final branch head as verified. No local test run is claimed.

## Limits and unresolved blockers

- The 16 MiB cap is deliberately fail-closed; larger legitimate reports require a separate format/streaming design rather than bypassing the bound.
- Filesystem identity checks are best-effort and are not an atomic `openat` capability boundary.
- A valid report receipt establishes byte identity only; it does not prove its claims, independent observation, or real-world truth.
- Issue #17 remains open for independently controlled Founder signing/key custody and crash/stale-lock recovery. PR #16 remains closed and superseded by merged PR #18.
- Signed world attestation in PR #76 remains unwired into the live mutation path; no production trust roots are provisioned.

## Next actions

1. Open a draft PR and inspect Full verification, Genesis Evidence Invariant, and Browser acceptance on the exact final head.
2. Fix any real failures, re-inspect the diff and base SHA, and rerun the affected workflows.
3. Keep the PR open and unmerged; do not provision keys or enable production observation trust.
