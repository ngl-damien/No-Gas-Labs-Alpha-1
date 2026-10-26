# Bounded Event Validation — Stutter-Step Checkpoint

Date: 2026-10-26 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
Stacked on: [PR #72 — host-verified progress gates](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/72)
Branch: `security/mainline-host-verification-20261026`

## Changes in this cycle

- Source commit: `0d6887ca7097c6bb2cb474325be887009ab683ad` — `src/world/project.js` now rejects event object graphs deeper than 128 levels before recursive canonical validation can exhaust the JavaScript stack.
- Regression commit: `7885b87578efe6964be12dac54af095a80119bb7` — `test/world-projection.test.js` exercises both deeply nested object and array payloads (160 levels) and requires a controlled fail-closed error.
- The bound is deliberately on structural depth, not total retained-history length, so this change does not impose a new event-count ceiling.

## Evidence and limits

- Parent PR #72 head inspected before change: `1f0efb4890a1508dcc9793e1a66a5ec7542d5053`.
- Its recorded GitHub Actions runs were `verify` [40376635371](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40376635371), Genesis Evidence Invariant [40376635392](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40376635392), and browser acceptance [40376635368](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40376635368). Those are parent-head results, not evidence for this new change.
- The new code and tests require fresh exact-head CI; no local execution is claimed.
- This is a library projection hardening change. It does not wire an independently controlled trust root into `game/server.mjs`, provision keys, prove real-world identity, or establish deployment.

## Next steps

1. Inspect exact-head `verify`, Genesis Evidence Invariant, and browser acceptance; repair any failure before claiming completion.
2. Inspect `game/server.mjs` separately: it is a distinct local shared-world persistence path and is not wired to the `src/world/project.js` verifier callbacks in this PR.
3. Keep PR #72 unmerged pending review and actual production trust-root design. Do not reopen PR #16: merged PR #18 supersedes its old self-signing INSTALL flow.
4. Continue Issue #17's concurrency/crash-recovery acceptance without automatically deleting potentially live locks.

Authority boundary: no merge, deployment, release, spending, key provisioning, rotation, or revocation.
