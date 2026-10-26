# Repository stutter-step checkpoint — 2026-10-26 UTC

## Scope and branch

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
- Base `main` at inspection: `17096dd6789299ad1bcd6de544db602a529da3c3`
- Safe branch: `security/observation-attestation-mainline-20261026`
- Initial source commit: `89297a95d1bd45fc38025196cf875b45026bd66c`
- Status: source hardening committed; regression suite and CI evidence are being added on this branch. Do not merge automatically.

## Source-backed defect

The current mainline `src/world/project.js` treated event-supplied labels as sufficient for success projection and let unverified failure/rejection/revocation events alter state. `src/quest/engine.js` had a parallel path that could satisfy acceptance from event claims alone. The existing PR #26 addresses this area but diverges from current main by 15 commits ahead / 25 behind, so merging that branch directly is not the safe route.

## Changes on this branch

- `projectWorld`: requires host-injected observation verification returning literal `true`; missing/throwing/non-boolean verifiers fail closed. Only separately verified adjudications can reject or revoke. Unverified events remain in history.
- `projectQuest`: only independently verified, byte-checked observations satisfy acceptance or set failure; rejections require adjudication verification.
- `replayInstitution` and `verifyReplay`: propagate the trust callbacks consistently into both world and quest projections.
- Added an Ed25519 observation-attestation adapter with a host-pinned DER public-key fingerprint and observer ID. The signature binds the complete canonical event outside its own envelope.

## Verification boundary

- The test suite uses ephemeral generated keys only. It verifies cryptographic binding and fail-closed behavior, not an actual outside observer or Damien's identity.
- The adapter is not wired into `game/server.mjs`; no production trust root/private key is configured.
- No merge, deployment, key provisioning/rotation, or external release is authorized or claimed.
- CI must be inspected against the exact final branch head before reporting tests as passing.

## Remaining blockers / next priorities

1. Inspect exact-head CI and fix any failures.
2. Review the production mutation path in `game/server.mjs`; wire a separately controlled observer trust root only after its custody/provisioning contract is defined.
3. Add cross-process tests with an independently held signing key and explicit key-rotation/revocation semantics.
4. Keep PR #16 closed: merged PR #18 supersedes its old self-signing flow. Real Founder identity/key custody remains unresolved under issue #17.
5. Reinspect current `main` and all open PRs before any future port/rebase; do not merge without Founder authorization.
