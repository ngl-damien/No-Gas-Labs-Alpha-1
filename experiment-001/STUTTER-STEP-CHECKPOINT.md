# NGL Stutter-Step Checkpoint

Updated: 2026-10-25 local / 2026-10-26 UTC. Evidence-bound operational handoff; not a claim of autonomous discovery or production security.

## Fresh state observed

- Primary repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- `main` at `0969df84cce7748d4f0db8e79ec06d13ad826a31` — “Connect Common Ground quests to recorded activity.”
- PR #25 is open as a draft: [cross-process ledger contention coverage](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/25), branch `codex/experiment001-cross-process-contention-20261025`, code/test head `1296aebb8260a4db755e3ffd71835b2df7571b95`.
- PR #21 is the other open draft. No merge or deployment occurred in this run.
- PR #16 is closed **unmerged**. Its old self-signing-flow diagnosis is superseded by PR #18, which merged as `213f3b5c7771da24b36f9ce6ebdde871d22e4602` with detached Ed25519 approval and a configured startup fingerprint.
- PR #14 is merged. PRs #13 and #15 are closed unmerged; do not revive their stale branches without comparing their actual diffs and authority boundaries against current `main`.
- Linked private repo `ngl-damien/Damien-Featherstone` remains at observed `main` `021d358d3cabdd3887cef58bbebac1adbfd39bb8`; no linked-repo write was made.

## Stutter-step work completed

1. Re-inspected the current source and corrected the stale checkpoint: main already contains same-process independent-store contention coverage and a fail-closed existing-lock test. The remaining concrete gap was separate Node processes racing to install capabilities.
2. Added `experiment-001/commit-worker.mjs`, a test-only child-process worker with a readiness barrier.
3. Added a test in `experiment-001/institutional-cycle.test.mjs` that releases two independent processes to commit distinct INSTALL decisions against one ledger. It accepts only successful serialization or an explicit `LEDGER_LOCKED` result followed by a successful fresh retry, then reopens the ledger and checks that both capabilities and records survived.
4. No production runtime code or signing policy changed. This is reliability evidence for the existing lock protocol, not proof of hostile-load safety or real Founder identity.

Relevant branch commits:
- `04e1f1d2e85bb3e2c6cb4a696698f624a345a049` — initial test worker.
- `0d56c7348daef8ae10b0576c8d823909ad508888` — corrected worker line termination after source reinspection.
- `534a9f3cf6b5fd7feec1d809fbc7a8b2044639d9` — added the test but CI exposed a missing `spawn` import.
- `1296aebb8260a4db755e3ffd71835b2df7571b95` — fixed the import; exact-head verification passed.

## Exact verification evidence

For code/test commit `1296aebb8260a4db755e3ffd71835b2df7571b95`:
- [verify — push run 40250732455](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40250732455): **success**. Workflow log records Node tests, Python inspector, package build, and institutional exercise each exiting 0.
- [Genesis Evidence Invariant — push run 40250732496](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40250732496): **success**.
- [Genesis Evidence Invariant — PR run 40250828071](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40250828071): **success**.
- [verify — PR run 40250828008](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40250828008): was **in progress** at the last status read; recheck before treating the PR as green.
- Intermediate commit `534a9f3...` failed `verify`; the subsequent observed passing run is on `1296aebb...`.
- A local clone/test attempt failed because this runtime could not resolve `github.com`; local execution is therefore **not established**. GitHub Actions performed the observed verification.

## Remaining blockers and limits

- **Founder identity/key custody:** the environment fingerprint is a configured trust anchor, not proof Damien controls the private key or supplied approval. The tests use ephemeral keys. No separately controlled signer or real Founder approval was configured.
- **Crash recovery:** existing locks fail closed. There is no safe automatic stale-lock recovery yet, and crash windows around atomic rename/directory sync remain untested. Never delete a lock merely because it looks old.
- **Integration:** this experiment is not proven to govern all canonical reducers, world projection, or XP mutation paths. The old PR #15 is not an integration proof.
- **Scope:** deterministic example strategies are not independent AI agents; a hash chain without an external anchor is not tamper-proof against wholesale ledger rewrite.

## Next prioritized steps

1. Reinspect the current reducer, world-projection, and XP mutation entry points; map where authorization and observation gates actually run. Use current `main`, not stale PR #13/#15 branches.
2. Define crash-safe lock recovery for process death before/after rename and directory sync, preserving `COMMIT_DURABILITY_UNCERTAIN`; add adversarial tests before changing runtime behavior.
3. Specify a genuinely separate Founder signing/operator workflow and key provisioning boundary. Do not claim real Founder authorization until an approval is supplied through it.
4. Recheck PR #25's final-head CI and request founder review; do not merge it automatically.

No merge, deployment, XP award, external release, or spending occurred.