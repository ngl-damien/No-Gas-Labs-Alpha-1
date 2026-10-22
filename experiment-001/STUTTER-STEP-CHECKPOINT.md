# NGL Stutter-Step Checkpoint

Updated: 2026-10-22. This checkpoint is evidence-bound; it distinguishes tested prototype behavior from real Founder authorization or production autonomy.

## Fresh repository state

- `main`: `7b5085b5f1686290569d564ff20774e313a69aea` (`docs(ngl-318): record RELEASEPATH deployment-integrity experiment`). No merge performed.
- PR #16: open, draft, base `main`, head branch `experiment-001/institutional-cycle-20261020`. Current code/test commit at checkpoint: `d05b94800828441c8822acc52dc8ddbef1b2c8fd`.
- Issue #17 remains open. PRs #13, #14, and #15 also remain open. Their status was rechecked; none was merged by this run.

## Completed stutter steps

1. **`73860eb4e650bdc9a634d0ad0c706c20884aaedd` — pin the Founder key outside proposal input.** `openInstitution` no longer accepts a caller-supplied fingerprint. It captures `NGL_FOUNDER_KEY_FINGERPRINT` at module import, and tests reject a caller-selected key/pin and fail closed when the startup pin is absent.
2. **`6c00077f4183b77e33bfae0951078d4f29c6c917` — test restart durability.** Added a test-only child-process worker. The parent signs and persists INSTALL; a separate Node process performs signed REUSE against the same ledger; the parent then reopens the ledger and verifies the use count and replay rejection.
3. **`d05b94800828441c8822acc52dc8ddbef1b2c8fd` — add three adversarial regressions.** A modified proof remains invalid even when signed; an INSTALL signature cannot be reused after changing capability identity; and REUSE for an unknown capability ID is rejected without consuming the installed grant.

## Exact verification evidence

At code/test SHA `d05b94800828441c8822acc52dc8ddbef1b2c8fd`, all four observed Actions runs completed successfully:

- `verify`, push: [39821518359](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/39821518359) — success.
- `Genesis Evidence Invariant`, push: [39821518382](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/39821518382) — success.
- `verify`, pull request: [39821525403](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/39821525403) — success.
- `Genesis Evidence Invariant`, pull request: [39821525406](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/39821525406) — success.

The `verify` job's `world-projection` step ran `npm test` and completed successfully. The experiment test file now declares nine tests. A local clone/test could not be run in this runtime because GitHub hostname resolution failed; the exact-head Actions runs above are the observed verification evidence.

## Remaining blockers and limits

- This is a configured trust anchor, **not proof of real-world Founder identity or consent**. No real Founder public key, private signer, or independent signing service is present. The operator must provision the fingerprint before module import; arbitrary code executing before import or compromised runtime configuration remains outside this prototype's protection.
- The tests use ephemeral keys. They do not prove Damien supplied approval, that a production key is safely held, or that an autonomous proposer cannot reach a separately deployed signer.
- The two candidate strategies are deterministic examples, not independent AI agents. The hash chain is not externally anchored.
- Stale-lock recovery and hostile concurrent-writer behavior are not yet tested.
- This prototype is not integrated into the real reducer/XP path. PR #15 and PR #14 remain separate open integration work; PR #13 is still a reference authority gate.
- PR #16 stays draft. No merge, deployment, XP award, external release, or spending was authorized or performed.

## Next prioritized steps

1. Add two-process concurrent-writer tests and define stale-lock recovery without deleting a live lock.
2. Specify the operator-controlled key provisioning and separate approval workflow; do not claim actual Founder approval until a real key/signature is supplied through that workflow.
3. Map actual reducer mutation entry points and test the authority gate against real XP/world projection paths.
4. Reassess PR #14's integration diff and PR #15's observation-verification boundary against current `main`; preserve founder review before any merge.
