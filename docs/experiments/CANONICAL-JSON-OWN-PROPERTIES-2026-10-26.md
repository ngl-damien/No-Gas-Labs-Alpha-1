# Stutter-step checkpoint: canonical JSON own-property integrity

Date: 2026-10-26 UTC

## Change

On safe branch `fix/canonical-json-own-properties-20261026`, based on observed main commit `0bb21d770111447983e930055b9476693d602a63`:

- `dd30d2be5f4b47e4f439769a59dcb7896e016567` — `canonicalStringify` now rejects non-enumerable own properties on plain objects and arrays instead of silently omitting them from signed/canonical data.
- `a5ec171e7d949936f01e292a47c6b30d101c306b` — regression coverage for hidden object/array properties and a valid dense-array control.

## Why it matters

The canonical serializer's stated contract is to reject lossy or non-JSON values. Before this change, `Object.keys` omitted non-enumerable properties. A plain object or array could therefore contain additional own data that canonical output ignored. This patch uses `Reflect.ownKeys` to require all own properties to be represented by the accepted JSON shape. Symbol keys and accessors remain rejected by existing checks.

## Evidence and verification

- Source and test files were re-read on `main` and the PR #66 security branch before editing; both contained the same original kernel/test blob SHAs (`6a7238b9b2e3ba90425a00d43c9e7cfac3727609`, `55ae0b46ae8f7d4caf68df9bc7309acf0cf0081e`). This was not superseded on main.
- Regression tests have been committed, but no test result is claimed yet. Creating the draft PR is expected to trigger GitHub Actions; inspect all exact-head checks after the final checkpoint commit.
- No local test execution is claimed.

## Unresolved boundaries

- PR #16's original self-signing INSTALL flow is superseded by merged PR #18; real Founder key custody remains unresolved in issue #17.
- PR #66 remains open/unmerged and keeps observation/authorization trust fail-closed; no independently controlled production trust roots are provisioned.
- This branch does not wire observation verification into production and does not prove independent observation, human identity, or deployment.

## Next priorities

1. Reinspect this branch's exact head and run all triggered GitHub Actions; fix any observed failure.
2. Inspect the separate world-projection duplicate-ID comparator on PR #66 for lossy comparisons of hidden/sparse/exotic payload data; avoid merging the diverged PR automatically.
3. Continue issue #17's crash/concurrency acceptance work without deleting potentially live locks or erasing `COMMIT_DURABILITY_UNCERTAIN`.
4. Keep all branches unmerged absent Founder authorization.

No merge, deployment, release, spending, key provisioning, rotation, or revocation occurred.

## Verification follow-up — 2026-10-26 UTC

Observed exact code/test head before this documentation-only update: `ced6c7944484bc5c16b37615a85fb2ac75a443d1`.

- [Full verification — run 40324999523](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40324999523): **success**; the world-projection job's test, package-build, and bounded institutional exercise step passed.
- [Genesis Evidence Invariant — run 40324999415](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40324999415): **success**.
- [Browser acceptance — run 40324999374](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40324999374): **success**; the playable-world job and browser receipt preservation completed.

PR [#67](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/67) remains draft/open/unmerged. This checkpoint-only commit changes the branch head; recheck the new exact-head workflows before treating the branch as fully verified. No local test execution is claimed.
