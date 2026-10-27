# Stutter-step checkpoint: Founder login throttling

Date: 2026-10-27 UTC

## Fresh-state inspection

- Current `main` was re-read at `e3f7c0c8effd383b76c2d68df54d051b333d511c` after PR #99 merged as `e3f7c0c8effd383b76c2d68df54d051b333d511c`.
- PR #99's bounded persisted Founder-key read is now on main. PR #63 overlaps the older key-file hardening on a stale base; do not merge its branch wholesale.
- The active server still had no failed-login throttle. `/api/login` compared the shared Founder secret with timing-safe equality but accepted repeated guesses without a per-peer limit.
- PR #65's stable request-ID behavior is already present in current `game/server.mjs`, `game/client.mjs`, and tests; treat that older PR as a reconciliation candidate, not fresh work.
- PRs #66/#76 contain related observation-attestation work, but the signed adapter is not wired to the live server mutation path and production trust roots are absent. Issue #17 remains open for independent Founder key custody/identity, concurrency, and crash/stale-lock acceptance.

## Functional changes

1. **`a76b4243df8f3d2fce2073d915c30342acbe04ea` — throttle repeated failed Founder logins**
   - Default: 5 credential failures per socket peer within 60 seconds; then a 60-second lockout.
   - Return HTTP 429 with `LOGIN_RATE_LIMITED` and a `Retry-After` header during lockout.
   - Clear that peer's failure budget after successful authentication.
   - Bound the in-memory peer table to 1,024 entries.
   - Use `request.socket.remoteAddress`; never trust caller-controlled `X-Forwarded-For`.
   - Keep rejected and rate-limited attempts from allocating a session/cookie.

2. **`8af603054a5fca3506783e41c2a575db6bb7d2e5` — add route-level regression coverage**
   - Verify repeated wrong credentials trigger 429.
   - Verify spoofed forwarding headers do not change the peer bucket.
   - Verify the `Retry-After` header and absence of a session cookie.
   - Verify the lockout expires and successful authentication resets prior failures.

## Verification evidence at code head

On code head `8af603054a5fca3506783e41c2a575db6bb7d2e5`:
- Full verification run [40491683699](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40491683699): success.
- World-projection run [40491683788](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40491683788): success.
- Playable-world run [40491683826](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40491683826): in progress at checkpoint creation; do not treat as green until the completed exact-head result is inspected.
- These are GitHub-hosted workflow observations; no local test run is claimed.

## Limits

- The limiter is process-local and resets on process restart; it is not a distributed production authentication service.
- Behind a reverse proxy, all clients may share the proxy's socket address. Do not trust forwarded headers without a separately configured trusted-proxy boundary.
- This reduces simple repeated guessing; it does not prove Founder identity, private-key custody, or production security.
- No key was provisioned, rotated, or revoked.

## Next priorities

1. Inspect exact-head Full verification, Genesis Evidence Invariant, and browser acceptance; diagnose and fix any failures.
2. Reinspect current main and open PRs before any integration. Reconcile stale PR #63 and determine which parts of PR #65 are already superseded.
3. Continue Issue #17's independent custody, concurrent-writer, and crash/stale-lock acceptance without fabricating identity evidence.
4. Reconcile PR #66/#76 against current main before considering signed-attestation wiring; keep production trust fail-closed while host-controlled roots are absent.
5. Advance Issue #22 only through a preregistered, evidence-preserving comparison; no hybrid-cognition superiority claim is established.

No merge, deployment, release, spending, production key operation, or Founder-identity claim occurred.
