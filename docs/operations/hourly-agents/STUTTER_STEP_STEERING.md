# Stutter-Step Loop Steering — Worker A

**Observed:** 2026-11-03  
**Repository:** `ngl-damien/No-Gas-Labs-Alpha-1`  
**Observed main:** `cc317d49c8fdf003c78aa40f38a177095019066e`  
**Root instructions:** `AGENTS.md` blob `a4beeee1c0ec46faab28502957c0e53850b2855d`  
**Shared protocol:** `docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md` blob `9a26ee4c17d2462dd66e99e90d258eaa9bcab79f` (read in full)  
**Portfolio and bootstrap gates:** `docs/operations/hourly-agents/REGISTRY.json` → `repository_portfolio`.

## Mandatory rehydration

At the beginning of every run, in order:

1. Read current root `AGENTS.md`.
2. Read the complete canonical shared scheduler protocol.
3. Read `docs/operations/LATEST_CHECKPOINT.md` and compare its declared head with live main.
4. Read the latest Worker B result, all relevant active PR heads, changed files, comments, and exact-head workflow runs.
5. Read every nested `AGENTS.md` applicable to paths that may be inspected or changed.
6. Reinspect the repository after forming a priority hypothesis, before editing.

If an instruction file or required bootstrap cannot be read/run, stop source work in that repository and record the exact gate. Do not silently substitute a report or another repository.

## Current repository facts

- Main is `cc317d49c8fdf003c78aa40f38a177095019066e`.
- Main `LATEST_CHECKPOINT.md` is stale: it declares `ea025a587e0bb3113423ea67035ddfa83ea7dc9f`. PR #314/#317 have checkpoint edits on their branches; do not create a competing update until those owners reconcile the stack.
- PR #301 is merged at `8c2c953c8d88ebe53388f660cc9c02de39e4cfb6`; its four exact-head workflows passed. The old “do not create another PR until #301 verifies” gate is satisfied. PR #300 is closed unmerged.
- PR #312 remains an open/draft parent; its last observed exact-head checks were 3/3. PR #313 remains 2/3 because Verify uses a stale Decision Chamber fixture; rebase it only after #312 is integrated.
- PR #314 and #315 last observed 3/3; #315 owns the preflight target-fingerprinting work. Do not duplicate its validator changes.
- PR #316 is a Worker A security child of #312 at `385ab39f808f9f4d952535f609d40c1797ddf7f3`. Verify, Genesis, and Browser all passed (12/12 browser journeys). It now requires host-configured trust and durable cross-process nonce storage. It remains helper-level; no host environment or Founder key was provisioned, and the live game server does not import it. Keep draft; do not merge independently of #312.
- PR #317 is the current 3/3-green Source Observatory candidate at `abc71df5965864cefd46adcdccf6c3b660bd4282`; Browser passed 12/12. The earlier missing-helper-import failure on `74bdd025` was fixed on the newer head.
- PR #318 remains at `baff7251c6b289533017355e249913b3d41d53ce`; Verify and Genesis pass, Browser fails the witness quest projection: retained server event, but UI objective remains `OPEN · 0/1`. PR #317 and #318 overlap on the core model/server/client/quest lifecycle. Do not integrate both independently.
- PR #16’s alleged self-signing `demonstrate()` issue is superseded by merged PR #18; issue #17 records that the final PR #16 production diff did not contain the alleged self-signing path.

## Ranked next actions

1. **Worker B — choose one Source Observatory implementation.** Keep #317 as the current evidence-green candidate. Update the G6 ledger and checkpoint to exact head `abc71df` and its current 3/3 evidence. Compare #318 for genuinely unique direct-entry UX; if retained, port only that UX as a separate, narrowly scoped, tested follow-up. Preserve the #318 Browser failure as a regression case; do not weaken the quest assertion.
2. **Worker A — preserve the Founder boundary.** Keep #316 draft and stacked on #312. Recheck its exact head and all three workflows each run. Do not provision `NGL_FOUNDER_TRUST_ANCHOR_PATH`, `NGL_FOUNDER_NONCE_LEDGER_PATH`, generate/enroll keys, or integrate live mutation routes without Founder-controlled custody and host provisioning.
3. **Stack reconciliation.** After #312 integrates, rebase #313 and rerun all exact-head checks. Reconcile #314/#315/#317 dependencies before any integration; no merges are authorized in this loop.
4. **Checkpoint repair.** Once #314/#317 agree on ownership, refresh `LATEST_CHECKPOINT.md` against the actual main SHA. Until then, use the current PR descriptions/comments and this registry as handoff evidence; never claim the stale checkpoint is current.
5. **Linked repositories.** Follow the `repository_portfolio` gates. Nine repositories have no root `AGENTS.md`; AI-BI and governance have root instructions but require bootstrap scripts that cannot currently be run because no local checkout/shell or online remote device is available. Do not inspect their source until the gate is satisfied.

## Execution and evidence constraints

- The available remote desktop device was offline; no local checkout, local test run, or pre-edit local preflight is claimed. Hosted exact-head GitHub Actions are the observed verification source.
- Hosted post-change preflight receipts are not pre-edit evidence.
- Main `game/server.mjs` does not import `authorizationEvent()`; it uses its separate session-based local Founder path and `founder.key` storage. Do not describe PR #316 as live server authorization.
- Keep `NOT ASSESSED` distinct from absent or failed. Keep emulator evidence distinct from physical-device acceptance.
- No merges, releases, deployments, spending, key operations, external publication, or Founder-reserved decisions.
