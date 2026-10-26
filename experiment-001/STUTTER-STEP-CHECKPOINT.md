# NGL Stutter-Step Checkpoint

> **Current handoff refreshed 2026-10-26 UTC.** This section is the active handoff; the historical checkpoint is retained below and is not a statement of current repository state.

## Fresh state observed before the final handoff

- Canonical repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- `main` observed at `871e642886e3e9f51028f1614c6d6ccca2f9a7fd`; no main-branch write or merge was made.
- Eight open Alpha One PRs observed: #61 browser acceptance; #60 storage durability/lock ownership; #59 role-safe institutional activities; #58 ledger schema/read hardening; #57 TaskAgile source recovery; #49 UI primitive recovery; #48 assimilation checkpoint; #26 independent observation verification.
- PR #16 is closed unmerged. Merged PR #18 supersedes its old self-signing INSTALL flow; the original #16 branch is not a live fix target.
- Issue #17 remains open for real Founder key custody, broader concurrency, and crash/stale-lock recovery.
- PR #26 is open draft, exact head `2b7e3c108983849a27ce418922d8af832ae746cd`, reported mergeable. It fails closed without host-injected observation/adjudication verifiers, but it is not wired into the live game server and has no production trust root.
- PR #61 is open and not merged; browser acceptance head `49a5e100d392c69136c11d41d045bd6e61f5cb8f` has successful browser run [40278603000](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40278603000), verify run [40278602980](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40278602980), and Genesis Evidence Invariant run [40278603007](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40278603007).
- Local clone execution was unavailable through this tool path. Exact-head GitHub Actions are the observed verification evidence; no local test execution is claimed.

## Work executed during this run

### Alpha One — writer-lock replacement protection

Draft PR #60: [fix(storage): harden atomic commit durability across both stores](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/60).

- `game/service-store.mjs` captures the identity of the file opened with exclusive lock creation and removes it only if the path still points to that same non-symlink inode. A copied ownership token alone is not treated as proof of ownership.
- `src/institution/ledger.mjs` applies the same inode check during normal close and failed initialization cleanup.
- Added `test/lock-ownership-regression.test.mjs` with three regressions: service-store close preserves a replacement lock with copied bytes; initialization failure preserves a replacement lock; ledger close preserves a replacement writer lock.
- Commits: service-store `e76f3c7d0a782773a8ab851a285e3a49c8a75ab3`; ledger `0b1e1f643ba790eb28b60deba1dab7132075d79b`; tests `8cbaec57bf48e647bceacffa18efdc707794dab9`.
- Current PR #60 head: `8cbaec57bf48e647bceacffa18efdc707794dab9`. Exact-head [verify run 40281396610](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40281396610) succeeded (Node test suite, Python inspector, package build, bounded institutional exercise); [Genesis Evidence Invariant run 40281396655](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40281396655) succeeded.
- Limit: this is an inode-identity guard at release time, not an atomic compare-and-unlink primitive. A hostile same-directory writer could still race between `lstat` and `unlink`; private directory permissions and manual recovery remain important. This does not implement crash/stale-lock recovery.

### Linked NGL Mesh — explicit test-only operator-pin fallback

Safe branch: `ngl-damien/ngl-mesh:security/pin-relay-operator-key-20261026`, no PR opened.

- Production trust continues to prefer `NGL_RELAY_OPERATOR_KEY_SHA256` from the host environment.
- A JVM property pin is now ignored unless `ngl.relay.allowTestOperatorKeyProperty=true` is explicitly opted into; the integration fixture and documentation were updated accordingly.
- Commits: implementation `941ae561a09523641a93edb699f9ce61a592bc25`; isolated regression `afc2e55bcde1edc7157d90ca32ab1c10b9746042`; integration fixture `a6de4af4741848e180621b52e9fd468b2720a8a9`; documentation/final head `dcad69c98c919a7a570248f4a38c106d4ed89d58`.
- Exact-head [Relay operator-key trust run 40281699810](https://github.com/ngl-damien/ngl-mesh/actions/runs/40281699810) succeeded and logged **9 checks passed**.
- The broader Relay/RAE bridge harness was not run: recovered-source archive, reference APK and RAE report were not available in the repository. No APK rebuild/install or real operator identity is claimed.

## Next ranked steps

1. **Observation trust boundary:** review PR #26 against the actual production mutation path; only wire it after separately controlled observer and adjudicator trust roots are provisioned. Never substitute an always-true verifier.
2. **Crash and stale-lock recovery:** add fault-injection around lock acquisition, atomic rename and directory sync; preserve ambiguous commits and never automatically delete a lock that might still be live. Continue Issue #17.
3. **Browser acceptance:** review PR #61's scripted journey coverage and exact-head receipts; do not merge without Founder authorization.
4. **Founder key custody/history:** coordinate only with explicit authorization. No private key contents were copied or displayed; no key rotation/revocation occurred.
5. **Reconcile linked repositories:** distinguish preserved source from tested integration; the NGL Mesh branch above remains unmerged and its broader integration remains blocked on external evidence inputs.

## Authority and evidence boundary

No merge, deployment, release, spending, Founder-approval claim, production trust-root provisioning, or private-key rotation/revocation was performed. Green CI is evidence for the exact tested commit and workflow only; it is not proof of public deployment, physical-device behavior, real-world identity, or uninterrupted work between runs.

---

## Historical checkpoint archive (superseded)

### Prior run's work initiated on safe branch (historical)

Branch: `stutter-step/experiment001-hardening-20261026-r2`, created from main SHA `960ad5c7d32c1cf86b53cb584882bf1e2fe3954c`; four non-overlapping mainline commits arrived afterward. Draft PR #40 is open; GitHub now reports it mergeable, but no merge was performed. No main write or merge was made.

1. Ported PR #29's stable, versioned strategy identities and narrow legacy-ledger replay compatibility onto the current main base. New INSTALL records use semantic strategy IDs; historical source-hash records are accepted only during replay, while new installs must use the current identity.
2. Ported PR #25's two-independent-process INSTALL contention regression and its test-only worker. A contending process may only receive explicit `LEDGER_LOCKED`; a fresh retry must commit, and the reopened ledger must contain both records.
3. Ported PR #28's offline, review-bound Founder signer and its tests/docs. This is a key-possession signing helper, not proof of Damien's identity or consent and not hardware-backed key custody.
4. Hardened signer file opening: reject symlinks with `lstat` even where `O_NOFOLLOW` is unavailable, and compare the pre-open path identity with the opened handle to reject a path swap. Added a symlink regression.
5. Updated the Experiment 001 document so the closed PR #16 / merged PR #18 history and remaining stale-lock limits are not misstated.

### Exact-head verification evidence

At code/test head `cb90ba4456c571169f16192d925f78cda76caf72`, both GitHub Actions workflows completed successfully:
- [verify — run 40265292590](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40265292590): success. Node `--test`, Python `test_engine.py`, `scripts/build-game.mjs`, and `scripts/meteor-demo.mjs --out <temporary exercise directory>` all exited 0.
- [Genesis Evidence Invariant — run 40265292482](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40265292482): success. The genesis invariant and attack-evidence-boundary step both completed successfully.

The workflow did not expose a reliable test-count summary in the captured log, so no count is claimed. No local test run is claimed. The checkpoint commit `b4f8482ca28b302fcd77fa0f292031c2492300cd` also passed both workflows: verify run `40265427136` and Genesis Evidence Invariant run `40265427141`. This next checkpoint refresh is documentation-only and will trigger CI again; the next run must inspect its exact head before claiming that newest revision is green. PR #40 remains draft.

### Remaining blockers

- Real Founder identity and private-key custody are unproven; the signer can prove possession of the matching key only.
- No production observation-attestation trust root has been provisioned or wired to the real world/XP mutation path. PR #26 remains a separate draft and its test allowlists are not production trust.
- Stale-lock recovery is deliberately not automated. Crash windows around atomic rename and directory sync need a defined safe protocol preserving `COMMIT_DURABILITY_UNCERTAIN`.
- Linked private repository `ngl-damien/Damien-Featherstone` has open PR #1 to remove the tracked private-key field and open Issue #2 for coordinated rotation/history verification. PR #1 explicitly says not to merge alone; no CI runs were observed for its head. The potentially exposed key requires a human-authorized rotation/revocation and history audit; this run did not take those consequential actions.
- No merge, deployment, XP award, external release, spending, or linked-repository write occurred.

### Next prioritized steps

1. Inspect CI on the next checkpoint-only head; synchronize PR #40 with current mainline if needed, then rerun exact-head Node tests, Python inspector, package build, institutional exercise, and Genesis Evidence Invariant.
2. If green, review signer failure modes and ledger compatibility behavior; keep the PR draft.
3. Integrate a real host-controlled observation verifier only after independently provisioned trust configuration exists; fail closed rather than injecting an always-true callback.
4. Define and test crash-safe recovery without deleting a potentially live lock.
5. Address the linked-repository key exposure only with appropriate Founder authorization; never copy the private key into Alpha One.
6. Reinspect PR #26/#27/#30/#33 and issue #17 against the then-current main before choosing the next capability improvement.

---

Updated: 2026-10-22. This checkpoint is evidence-bound; it distinguishes tested prototype behavior from real Founder authorization or production autonomy.

### Fresh repository state

- `main`: `7b5085b5f1686290569d564ff20774e313a69aea` (`docs(ngl-318): record RELEASEPATH deployment-integrity experiment`). No merge performed.
- PR #16: open, draft, base `main`, head branch `experiment-001/institutional-cycle-20261020`. Current code/test commit at checkpoint: `d05b94800828441c8822acc52dc8ddbef1b2c8fd`.
- Issue #17 remains open. PRs #13, #14, and #15 also remain open. Their status was rechecked; none was merged by this run.

### Completed stutter steps

1. **`73860eb4e650bdc9a634d0ad0c706c20884aaedd` — pin the Founder key outside proposal input.** `openInstitution` no longer accepts a caller-supplied fingerprint. It captures `NGL_FOUNDER_KEY_FINGERPRINT` at module import, and tests reject a caller-selected key/pin and fail closed when the startup pin is absent.
2. **`6c00077f4183b77e33bfae0951078d4f29c6c917` — test restart durability.** Added a test-only child-process worker. The parent signs and persists INSTALL; a separate Node process performs signed REUSE against the same ledger; the parent then reopens the ledger and verifies the use count and replay rejection.
3. **`d05b94800828441c8822acc52dc8ddbef1b2c8fd` — add three adversarial regressions.** A modified proof remains invalid even when signed; an INSTALL signature cannot be reused after changing capability identity; and REUSE for an unknown capability ID is rejected without consuming the installed grant.

### Exact verification evidence

At code/test SHA `d05b94800828441c8822acc52dc8ddbef1b2c8fd`, all four observed Actions runs completed successfully:

- `verify`, push: [39821518359](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/39821518359) — success.
- `Genesis Evidence Invariant`, push: [39821518382](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/39821518382) — success.
- `verify`, pull request: [39821525403](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/39821525403) — success.
- `Genesis Evidence Invariant`, pull request: [39821525406](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/39821525406) — success.

The `verify` job's `world-projection` step ran `npm test` and completed successfully. The experiment test file now declares nine tests. A local clone/test could not be run in this runtime because GitHub hostname resolution failed; the exact-head Actions runs above are the observed verification evidence.

### Remaining blockers and limits

- This is a configured trust anchor, **not proof of real-world Founder identity or consent**. No real Founder public key, private signer, or independent signing service is present. The operator must provision the fingerprint before module import; arbitrary code executing before import or compromised runtime configuration remains outside this prototype's protection.
- The tests use ephemeral keys. They do not prove Damien supplied approval, that a production key is safely held, or that an autonomous proposer cannot reach a separately deployed signer.
- The two candidate strategies are deterministic examples, not independent AI agents. The hash chain is not externally anchored.
- Stale-lock recovery and hostile concurrent-writer behavior are not yet tested.
- This prototype is not integrated into the real reducer/XP path. PR #15 and PR #14 remain separate open integration work; PR #13 is still a reference authority gate.
- PR #16 stays draft. No merge, deployment, XP award, external release, or spending was authorized or performed.

### Next prioritized steps

1. Add two-process concurrent-writer tests and define stale-lock recovery without deleting a live lock.
2. Specify the operator-controlled key provisioning and separate approval workflow; do not claim actual Founder approval until a real key/signature is supplied through that workflow.
3. Map actual reducer mutation entry points and test the authority gate against real XP/world projection paths.
4. Reassess PR #14's integration diff and PR #15's observation-verification boundary against current `main`; preserve founder review before any merge.

