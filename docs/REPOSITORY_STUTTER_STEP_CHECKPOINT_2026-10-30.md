# Repository Stutter-Step Checkpoint — 2026-10-30

## Baseline and operating boundary

- Canonical repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- Current `main`: `7d8c77367f6acb2d85e35cd9a195797555d1ac7d` (unchanged during this run).
- Fresh inventory: **37 open Alpha 1 PRs**, **2 open issues**, **454 branch refs**, and **0 refs marked protected** by the GitHub branch-list API. The branch count includes this run's location-evidence branch. No branch was deleted.
- Root `AGENTS.md` and the full `docs/operations/RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md` were reread before repository work.
- This is a selected source/PR audit, not a complete source audit of all 32 repositories previously inventoried.
- Local clone/test execution was unavailable because the container could not resolve `github.com`. Hosted GitHub checks are the verification source for this run.

## Implemented this run — location evidence contract

**Draft PR #209:** [fix(location): validate and preserve user-consented observations](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/209)

- Branch: `fix/location-evidence-contract-20261030`.
- Latest head: `5411b9d6c19700c277637d4f53f62a98275ce8b3`.
- Base: `7d8c77367f6acb2d85e35cd9a195797555d1ac7d`.
- Four files changed: `src/location/consent.js`, `src/location/evidence.js`, `test/location-consent.test.js`, and `test/location-rpg-integration.test.js`.
- The original path accepted any object carrying three marker fields, spread it without schema validation, and projected records after checking only a few event markers. It also replaced a valid timestamp of zero with the current time and accepted negative accuracy.
- The branch now validates timestamp and accuracy bounds; preserves epoch-zero timestamps; requires the complete normalized fix schema, canonical UTC timestamp, bounded coordinates and precision-consistent rounding; rejects extra/accessor-backed fix and consent fields without invoking getters; snapshots and freezes the evidence; and revalidates event scope and fix shape during projection.
- Existing policy is preserved: this is still consented, self-reported, **unverified** location. It does not prove physical presence, identity, anti-spoofing, or Founder authority; it does not award XP or upload/persist location.
- Regression coverage added for invalid timestamps/accuracy, forged or malformed fixes, accessors, immutable snapshots, projection filtering, and unchanged quest/XP behavior.
- Exact-head hosted verification for the latest head `5411b9d6...` was not yet available at checkpoint creation. Earlier head `a10a2fa27e02582cdd5952d87088a18e28d3050a` had Verify and world-projection success, but its Playable-world run was still in progress when a final negative-infinity accuracy edge case was added. **Do not carry those earlier results forward as latest-head verification.** Recheck the latest head's three checks and fix any failure.

## Founder authorization — source-backed status

- The old self-signing PR #16 finding is superseded: issue #17 states PR #8 was the earlier signed-decision prototype and PR #18 integrated the replacement Experiment 001 path. Do not reopen or duplicate PR #16.
- Current main still has a forgeable boundary in `src/authority/decision.js`: `authorizationEvent` accepts a caller-supplied verification object and checks its `valid` property.
- Draft PR #203, head `861fd38b7e08c4af96e1e1bb5c3f353a7e2fb901`, seals verifier results with a module-private WeakMap and binds the signed decision to an institution audience. Exact-head Verify, world-projection, and Playable-world checks all succeeded.
- The live `game/server.mjs` uses a separate host-key / ephemeral-session gate and does not import `verifyFounderDecision` or `authorizationEvent`. PR #203 is not live server integration.
- Issue #17 remains open. Real independent key custody, proof Damien controls the signing key, server integration, crash/stale-lock recovery, and complete concurrency acceptance remain unresolved. No key was created, read, provisioned, or rotated.

## Current work owned by other PRs — do not duplicate

| PR | Current exact head | Observed exact-head checks |
|---|---|---|
| #205 writer-lease hardening | `03a7365ee2a5681f85e37278e2b66c335c64a04e` | Verify, world-projection, Playable-world: all success |
| #206 verified quest retry status | `52c9d15cbecb318dafaf991b2b04a534cac25f1d` | Verify, world-projection, Playable-world: all success |
| #207 Questkeeper skill | `03d940147d235b8818d31010729d3f786adf09de` | Verify, world-projection, Playable-world: all success |
| #208 manual preview-first branch cleanup | `393c42c48499534f19ee025b8b18b9342294e89e` | Verify, world-projection, Playable-world: all success |

No gameplay, writer-lease, or cleanup-workflow files were edited in this run. PR #208 was not dispatched; no branch deletion occurred. Its inherited workflow-level `contents: write` scope remains broader than the read-only preview step. Permission changes require explicit Founder authorization.

## Linked NGL repositories inspected

- **ngl-mesh PR #1** — exact head `d10fe10fee8924d085afbd513f162dae8e4fb734`; operator-key trust, durable replay/revocation markers, and signed revocation checks succeeded. The public revocation API now routes through the signed verifier on that branch. Full APK/RAE integration remains unverified because the recovered source archive, reference APK, and RAE report are absent. PR remains draft/unmerged.
- **evidenceos PR #1** — exact head `7fbb4c83412e83882ea43df92532a346d524e00b`; hosted test workflow succeeded. The branch fixes false-green partial repository scans and the zero-test command. It remains draft/unmerged. A separate follow-up risk was observed in `src/server.js`: if configured to listen beyond loopback, the HTTP API has no request authentication while it can use an environment GitHub token. PR #1 already owns `src/server.js`; do not edit it concurrently. Review this boundary after that PR settles.

## Branch / PR hygiene findings

- PR #191's checkpoint branch is not a clean checkpoint-only diff: its current base is `933648a23608d4da4c4e007906cdda62eaf1afd5`, with 47 commits, 22 changed files, 1,307 additions and 21 deletions. Its checks pass on its head, but its base is older than current main. Do not merge it as a documentation-only checkpoint.
- PR #192's CI-trigger branch has the same old base `933648a...`, 13 commits and 24 changed files (386 additions, 21 deletions), despite its body describing only three workflow trigger changes. Do not treat the body as a complete diff summary; reconcile the full changed-file set before review or merge.
- The branch-list API marked no branch protected. This is a governance observation, not permission to change branch protection or delete refs.

## Next actions, in order

1. Recheck all three hosted workflows on PR #209's **latest** head `5411b9d6...`; inspect logs, repair any source-backed failure, and record the final exact SHA and run IDs.
2. Review PR #203's sealed verifier and define a narrow live-server integration design. Do not create or handle real Founder key material; key custody requires an explicit, independently controlled signing process.
3. Finish issue #17's stale-lock/crash-recovery and cross-process concurrency acceptance against the current writer-lease work. Do not duplicate PR #205.
4. Leave Worker B's #206/#207 gameplay files untouched; their current exact-head checks are green.
5. Reconcile stale-base PRs #191/#192 before any merge. Keep branch classification read-only; no deletion or permission changes.
6. After EvidenceOS PR #1 settles, address the non-loopback HTTP authentication boundary with tests and an explicit deployment configuration contract.
7. Recover the missing APK/source/report inputs before claiming full ngl-mesh RAE integration.

## Authority and result

No merge, release, deployment, branch deletion, workflow dispatch, secret/key/credential change, permission change, spending, or external service operation occurred. Main remains unchanged. PR #209 is a draft proposal; its latest-head hosted verification was still pending at this checkpoint.
