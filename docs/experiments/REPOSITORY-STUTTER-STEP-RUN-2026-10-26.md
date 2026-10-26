# Repository stutter-step run checkpoint — 2026-10-26 UTC

This is the current handoff for the next repository loop. Start by inspecting live GitHub state; do not assume any head, PR count, or workflow result below remains current.

## Alpha One — No-Gas-Labs-Alpha-1

- PR: [#66 — independent observation attestation](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/66), open and unmerged.
- Safe branch: `security/observation-attestation-mainline-20261026`.
- Before this checkpoint artifact is committed, branch head was `7527b53283800853314ed134c7fb63bc5944ff95`; the historical checkpoint path was aligned to the current `main` file blob to remove a same-path conflict. Recheck PR mergeability and the new artifact commit's CI after this file is added.
- Code/test head `1c110543bdae008f859af25e08ffc47f2a7dffa9` passed:
  - [Full verification run 40317442221](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40317442221): success.
  - [Genesis Evidence Invariant run 40317442225](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40317442225): success.
  - [Browser acceptance run 40317442383](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40317442383): final success after the first attempt failed at the Source Observatory article count and rerun job `121554655222` passed without code changes.
- Documentation-only head `61814ce3a8e28cf5b9cd19eaf42198c41246e524` also passed full verification run `40318180151`, Genesis run `40318180179`, and browser acceptance run `40318180158`.
- Earlier pre-follow-up head `a27a635cbf9178a899d152c2de148e0dabab478e` had all three workflows green (runs `40315329167`, `40315329162`, `40315329220`). These older green runs do not substitute for checking the latest head.

### Three Alpha One implementation cycles

1. **Audience/domain separation:** `acdec375911bc174fd12b36bcab387c0c1163697` requires a host-configured expected audience; `0333ea1cf546d6c98180609790738bab9e8cf437` tests that a valid signature for another audience cannot project progress here.
2. **Prototype-safe projection writes:** `89a5a4c8febbcc0729b32b9e7a4a94ac6f5a18e2` uses own data properties for quest/inventory/world keys; `42c55fb1a65fa2a2454383b3d60f55a0631363c5` tests `__proto__` and `constructor` keys.
3. **Evidence-history snapshot isolation:** `b016cfd9906ed851b92f2d429606f52aae4d9d0b` clones retained events; `0063bb5f40b27ee75a0fb74056b14aa97a80add0` verifies later caller mutation cannot rewrite the projection's history snapshot.

Related documentation commits: `29bc56b481513553e4cd6262e071a50bb4e5af26`, `1dfc8d350589f22b52f723e48bfad010659b8659`. Checkpoint commits include `1c110543bdae008f859af25e08ffc47f2a7dffa9`, `61814ce3a8e28cf5b9cd19eaf42198c41246e524`, and `337cd66ff2b4500c2c2e86a32dbe68a7c904fecd`.

**Production trust remains unresolved.** The adapter is not wired into `game/server.mjs`; no separately controlled observer key, authorization trust root, or custody contract is provisioned. Test keys and callbacks prove code paths only, not independent observation, Damien's identity, or deployment. Keep canonical progress fail-closed until trust material is independently controlled.

## Linked NGL Mesh — operator trust

- PR: [ngl-mesh #1](https://github.com/ngl-damien/ngl-mesh/pull/1), draft/open/unmerged.
- Safe branch: `security/pin-relay-operator-key-20261026`.
- Current code/test head before this checkpoint: `e108be26f7b6a6de5fce875ac6eaaf32f41f992e`.
- [Relay operator-key trust run 40318420477](https://github.com/ngl-damien/ngl-mesh/actions/runs/40318420477): success; `OperatorKeyTrustTest` passed 9 checks and `DurableMarkerTest` passed 11 checks.
- Fixes in this run reject symlinks in any marker-path ancestor and sync newly created directory entries outermost-first. The tests cover symlinked grandparent redirection and nested marker-directory creation.
- Broader APK/RAE integration is still unverified: recovered-source archive, reference APK, and RAE report are absent. The isolated workflow does not compile the complete `EvidenceAuthorizedTransition` integration.

## Founder authorization / PR #16

- PR #16 is closed and unmerged. Merged PR #18 supersedes the old self-signing INSTALL flow; reopening #16 is not the fix.
- Issue #17 remains open for real Founder key custody, adversarial concurrent-writer tests, and crash/stale-lock recovery.
- Preserve `COMMIT_DURABILITY_UNCERTAIN`; never auto-delete a potentially live lock. Do not provision, rotate, or revoke real keys without authorization.

## Operational incident — main checkpoint content restored

One checkpoint update accidentally omitted the branch argument and briefly created documentation-only commit `78ef9278e3013986505a533646f926858b494c11` on `main`. A corrective commit `5ac551c0c730515a723a0615460e06768cd57dfa` immediately restored the checkpoint file to the exact prior blob `22d2a0568cd48172e44fe22fa241b3ef77d01159`. No source or functional code was written to `main`, and no PR was merged; the main branch history did advance with those two documentation-only commits. The Alpha One safe branch's historical checkpoint file was aligned to that same blob, and this separate artifact preserves the new run's handoff.

## Next priorities

1. Freshly inspect Alpha One `main`, all open PRs, PR #66 mergeability, and workflows on the current branch head; repair any actual conflict without merging to main.
2. Inspect the current-head browser result and test logs; treat the earlier Source Observatory failure as flaky only because a no-code-change retry passed.
3. Keep production observation/adjudication/authorization trust fail-closed until independent host trust roots and audience are configured.
4. Advance issue #17's crash/concurrency acceptance work.
5. Continue NGL Mesh integration only after recovering the required APK/RAE reference artifacts.
