# Stutter-step checkpoint — strict API JSON input

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
Base main inspected before branch creation: `10d2d4c00b35ad7d6fee7d642daaeeae6f8ed5d9`
Branch: `security/strict-api-json-input-20261027`

## Fresh-state finding

The live HTTP body parser bounded request size at 256 KiB but decoded bytes with `Buffer.toString('utf8')` and called `JSON.parse` directly. That decoder replaces malformed UTF-8. JavaScript JSON parsing also accepts duplicate object keys with last-key-wins behavior. In particular, a login body with a wrong first `key` and correct second `key` can authenticate under one parser while a first-key-wins intermediary would interpret a different credential. The existing Founder INSTALL CLI already had a duplicate-key scanner, but it was private to that script.

## Functional changes

- Extracted the duplicate-key / bounded-nesting preflight into shared `src/strict-json.mjs`.
- Reused it in the Founder INSTALL approval CLI, preserving the existing `PROPOSAL_DUPLICATE_JSON_KEY` and `PROPOSAL_JSON_TOO_DEEP` errors. The bounded-depth scan now runs before `JSON.parse`, so over-deep input is rejected before the parsed object graph is built.
- Hardened `game/server.mjs` request parsing: malformed UTF-8, duplicate object keys (including escaped key spellings), and nesting beyond 128 levels now fail as `INVALID_JSON` before route/session side effects.
- Added HTTP regressions for duplicate login credentials, escaped duplicate keys, malformed UTF-8, and excessive nesting. Each asserts HTTP 400 and no Set-Cookie.

## Verification status

GitHub Actions are being evaluated against the evolving PR head; record the exact final-head results in the PR discussion after all three workflows complete. No local test run is claimed.

## Limits and next priorities

1. Inspect all three exact-head workflows; fix real failures and rerun.
2. Keep PR #16 closed and superseded by merged PR #18; Issue #17 still requires independently controlled Founder signing/key custody and crash/stale-lock recovery.
3. Reconcile PR #76 only after its exact-head checks and the live server mutation-path integration are independently verified. No production trust roots are provisioned.
4. Keep production observation trust disabled until actual mutation-path integration and independently controlled trust roots exist.

No merge, deployment, release, spending, key provisioning/rotation/revocation, or Founder-identity claim is included.
