# Strict Writer-Lock Metadata Checkpoint — 2026-10-28

## Fresh state and supersession
- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- Current `main` observed at `a442e913e6cb612609666267d0286deb6991d923`; PR #144 has merged. The prior post-probe checkpoint's “CI pending” state is superseded by the merge and current-main state.
- PR #16 remains closed and superseded by merged PR #18. Do not revive the self-signing branch.
- Issue #17 remains open for independently controlled Founder key custody/identity, adversarial concurrency, and crash/stale-lock recovery.
- Current main already includes Founder key-file and data-directory hardening. Do not duplicate PR #63's older branch wholesale.
- Signed world-attestation PRs #66 and #76 remain open/unmerged and are not wired into the live server with independently controlled production trust roots.

## Functional changes on this branch
Branch: `fix/strict-lock-metadata-json-20261028`
Base: `a442e913e6cb612609666267d0286deb6991d923`

1. Reuse `assertNoDuplicateJsonObjectKeys` before parsing JSON lock metadata. Duplicate keys, including escaped spellings that decode to the same key, are reported as malformed with `reason: duplicate-json-key`.
2. Recognize the three lock schemas currently emitted by the service store, institutional ledger, and decision store:
   - `ngl.service-lock.v1`
   - `ngl.ledger-lock.v1`
   - `ngl.decisions-lock.v1`
3. Metadata that claims a schema but names an unknown or non-string schema is reported as `format: unrecognized-json`, `reason: unsupported-lock-schema`; it is not presented as owner metadata.
4. Preserve backward compatibility for schema-less legacy owner metadata. All results remain diagnostic-only with `safeToRemove: false`.

## Regression coverage
- Reject duplicate `pid` keys.
- Reject escaped duplicate spellings such as `pid` and `p\\u0069d`.
- Accept all three schemas emitted by current lock writers.
- Do not interpret an unknown future schema as recognized owner metadata.
- Existing replacement/disappearance/metadata-mutation tests remain in place.

## Commits
- `e75d1b33a6b4a8b9775a310f234a79d0c9006223` — reject duplicate JSON keys.
- `4a1ddc811126b8414c6da0f71cd853ab29f91738` — duplicate-key regressions.
- `9ce0f6ea1d74a90f9d2e4de718e518bfef659038` — classify unsupported schemas.
- `ea0e57d00f4386d2551856b4552116b29db44e0a` — schema compatibility regressions.

## Verification boundary
- Code/test head before checkpoint: `ea0e57d00f4386d2551856b4552116b29db44e0a`.
- Compare against base: 4 commits ahead, 0 behind; 2 files changed (inspector and tests).
- GitHub Actions must verify the final PR head. No local test execution or passing CI result is claimed in this checkpoint.
- PID probes remain advisory; schema validation does not establish lock ownership, staleness, Founder identity, or safe deletion.
- No lock is deleted and no automatic stale-lock recovery is introduced.

## Next steps
1. Inspect exact-head Full Repository Verification, Genesis Evidence Invariant, and Browser Acceptance; repair only observed failures and rerun.
2. Reinspect branch/base/PR state after CI.
3. Continue Issue #17 concurrency and crash/stale-lock acceptance without automatically deleting potentially live or replacement locks.
4. Keep production Founder trust fail-closed until independently controlled identity/key custody and live mutation-path integration are evidenced.

No merge, deployment, release, spending, production key operation, or Founder decision occurred.
