# NGL Repository Stutter-Step Checkpoint

Updated: 2026-10-25 local / 2026-10-26 UTC. Evidence-bound handoff; no merge, deployment, XP award, external release, or spending performed.

## Fresh state observed

- Primary repository: `ngl-damien/No-Gas-Labs-Alpha-1`; `main` remains `0969df84cce7748d4f0db8e79ec06d13ad826a31` — `Connect Common Ground quests to recorded activity`.
- Open PRs observed: #21 (draft), #25 (draft), #26 (draft), #27 (ready for review), #28 (draft), #29 (draft). PR #16 is closed unmerged; PR #18 is the merged replacement.
- PR #25 head `fc7f025400f0a75d58c56afe7f8d7eacad326c96`: `verify` [40256041852](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40256041852) and `Genesis Evidence Invariant` [40256041862](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40256041862) succeeded.
- PR #26 head `2b7e3c108983849a27ce418922d8af832ae746cd`: `verify` [40259013270](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40259013270) and `Genesis Evidence Invariant` [40259013346](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40259013346) succeeded.
- PR #27 head `12a4f4a4ba7ba2f190b727b7ac48e46a268188ee`: `verify` [40255483069](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40255483069) and `Genesis Evidence Invariant` [40255483306](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40255483306) succeeded.
- PR #28 offline Founder signer code/test head `1f06ea08af957742fee521cc79a53d5d4588b5c2`: `verify` [40261005600](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40261005600) and `Genesis Evidence Invariant` [40261005598](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40261005598) succeeded. A checkpoint-only refresh below will advance PR #28's head; recheck CI on the new head next run.
- PR #29 versioned implementation identity head `fa712958e4b940c491832198a505ab0398f59fff`: `verify` [40261360678](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40261360678) and `Genesis Evidence Invariant` [40261360781](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40261360781) succeeded. The `verify` job observed all four stages exit 0: Node tests, Python inspector, game package build, institutional exercise.
- Issue #17 remains open for real key custody, concurrency, crash recovery, and integration boundaries. No real Founder key or real approval was supplied.

## Stutter-step A — rank against current reality

1. **Founder authorization:** PR #16's old self-signing-flow finding is superseded by PR #18 (`213f3b5c7771da24b36f9ce6ebdde871d22e4602`). The remaining gap is real key custody/identity, not re-adding the old defect.
2. **Offline approval capability:** PR #28 adds a two-step proposal inspection and exact-digest confirmation flow, then emits a detached Ed25519 signature. This improves the operator workflow but does not establish hardware custody or human identity.
3. **Ledger durability:** PR #29 replaces source-text hashes for new installs with stable versioned semantic IDs and retains narrow legacy replay compatibility. The compatibility test exercises a signed legacy ledger, rejects new legacy-format INSTALL, reuses the historical grant, and reopens the ledger.
4. **Observation trust:** PR #26 adds a host-injected verifier boundary to `src/world/project.js` and quest projection, but its test allowlists are stubs and the adapter is not wired into `game/server.mjs`.
5. **Contention and UI:** PR #25 adds cross-process contention regression coverage; PR #27 exposes canonical work receipts in TownSquare with explicit limits. Both remain unmerged.

## Stutter-step B — reinspection and conflict check

Re-read the current main source, tests, package scripts, workflow, checkpoint, and current PR metadata before acting. `experiment-001/institutional-cycle.mjs` originally derived implementation hashes from `Function.toString()` and replayed old INSTALL proofs against the loaded code. That creates a source-derived compatibility risk, not a reproduced production failure. `validateInstallationProposal` now uses stable identities for new proposals and accepts pinned legacy hashes only in ledger replay; new legacy-hash installs are rejected.

Reinspection also caught a signer-workflow weakness before PR #28 was opened: the first CLI version signed immediately when invoked. It was replaced with a separate `--inspect` step and an explicit full-digest `--confirm` invocation. The confirmation is an accident-prevention step, not proof that a human reviewed the proposal.

## Stutter-step C — implemented changes

### PR #28 — review-bound offline Founder signer

Branch `codex/founder-offline-approval-cli-20261025`.
- `da2fad58d6533d7b80e327f448bf5ff6264b7ad2` — two-step review/confirmation, bounded regular-file reads, POSIX key permission check, trust-pin matching, and fail-closed validation.
- `bd6b5d56d46f6713acc260a8cab755a16ae98407` — regression tests for review-only output, signature verification, altered payload, digest mismatch, wrong pin, expiry, and POSIX key permissions.
- `7408011c8c6ff70983669cc6bd0c6f609164a673` — two-step usage and limits documentation.
- `1f06ea08af957742fee521cc79a53d5d4588b5c2` — checkpoint refresh; exact-head CI above passed.

### PR #29 — versioned capability identity / replay compatibility

Branch `codex/experiment001-versioned-implementation-ids-20261025`.
- `4bfb3083541d1ca67ce7984f85d553f6332a4854` — stable semantic IDs for new installs and replay-only compatibility for historical source-hash records.
- `5884d6210da75d3aab95115049a084ef8b4d71b0` — legacy-ledger replay/reuse and new-legacy-install rejection coverage.
- `6843926f58b2e7f183a7f8d14995e36d07758bee` — compatibility contract documentation.
- `fa712958e4b940c491832198a505ab0398f59fff` — latest test code head; exact-head CI above passed.

## Linked repository inspection

- `ngl-damien/Damien-Featherstone` remains at `021d358d3cabdd3887cef58bbebac1adbfd39bb8`, with only `main`, no open PRs, and no changes made.
- `ngl-damien/ngl-mesh` remains at `be43452a2133ba920a3814e19d7812e5c964117d`, with no open PRs or issues and several recovery/experiment branches. Its Relay/RAE verification harness requires operator-supplied recovered-source ZIP, reference APK and RAE report; those inputs are not available through the repository inspection, so a reproducible run was not claimed and no write was made there.

## Limits still open

- No real Founder key, separate hardware-backed signer, or independent signing service is configured. Tests use ephemeral keys. The offline signer does not write to the ledger, install a capability, deploy, or award XP.
- The observation verifier is not integrated into the actual host path with an independently provisioned trust root. Do not use an always-true callback.
- Cross-process contention coverage is not crash-recovery proof. Stale-lock recovery and the `COMMIT_DURABILITY_UNCERTAIN` boundary still require work.
- The hash chain is not externally anchored. Stable strategy IDs are compatibility contracts, not cryptographic proof of semantic correctness; a behavior change requires a new version and tests.
- No local clone/tests were run from this runtime. CI is the observed execution evidence for the exact code/test heads cited above.

## Next prioritized steps

1. Re-inspect PR #28 after this checkpoint-only commit and verify exact-head `verify` plus `Genesis Evidence Invariant`; fix any failure and re-check the new head.
2. Keep PRs #28 and #29 draft pending Damien's review; do not merge.
3. Specify/provision an independently controlled signer trust root and demonstrate an actual operator-supplied signature without exposing a real key in CI.
4. Integrate PR #26's observation verifier into the real host boundary only when a separately controlled observer key and configuration are available.
5. Add crash injection around temp write, atomic rename and directory sync; design safe stale-lock recovery without deleting a live lock.
6. Reassess PR #25 and #27 against the new heads of `main` before any future merge; preserve their evidence and limits.
