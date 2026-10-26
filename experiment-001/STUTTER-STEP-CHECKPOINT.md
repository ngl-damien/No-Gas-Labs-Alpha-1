# NGL Stutter-Step Checkpoint

> **Active handoff refreshed 2026-10-26 UTC.** Historical notes remain below; only this section represents the latest observed state.

## Fresh repository state

- Alpha One **main**: **17096dd6789299ad1bcd6de544db602a529da3c3**.
- **Seven open Alpha One PRs:** #63 Founder-key file hardening; #60 storage durability/lock ownership; #58 ledger schema/read hardening; #57 TaskAgile source recovery; #49 UI primitive recovery; #48 account-wide assimilation checkpoint; #26 independent observation verification.
- PR #61 was observed **merged** as **46f651140197148709852080835df192648ce0ad**; its browser-acceptance follow-up is on current main. Do not describe #61 as open.
- PR #16 remains closed and unmerged. Its old self-signing INSTALL flow is superseded by merged PR #18; real Founder identity/key custody is still unresolved.
- Issue #17 remains open for real key custody, adversarial concurrency, and crash/stale-lock recovery.
- PR #26 is still draft at **2b7e3c108983849a27ce418922d8af832ae746cd**. It fails closed without host-injected observation/adjudication verifiers, but the verifier is not wired into the live game server and no production trust root is provisioned.
- PR #60 remains draft at **e56b935d85150ed5c8fe0fbf039ebb33f6f6dfd9**. The branch comparison now reports **10 commits ahead and 2 behind current main**; reconcile it with main before any merge/review decision. Its inode check is not an atomic compare-and-unlink primitive, and stale-lock recovery remains manual.
- NGL Mesh main: **be43452a2133ba920a3814e19d7812e5c964117d**. Draft PR #1 is open at **0d60a746a022766fc105bfa12396daf255d47bd0**, 23 commits ahead and 0 behind main.

## Work completed and exact-head evidence

### Alpha One — persisted Founder-key file hardening

Draft PR [#63](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/63).

- Commits: server implementation **d3213b7f6c56a1685d191adca21b0d95b35d57b5**; regression tests / exact head **9684ef4c89817699a961c33e3781e0ed3cab9323**.
- Rejects symlink/non-regular founder.key files and group/world-readable permissions; checks opened file identity before and after reading; preserves the explicit environment-key path and generated private-key behavior.
- Exact-head [verify run 40288629612](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40288629612): success; the repository verify script reports all four stages passed (Node tests, Python inspector, package build, bounded institutional exercise).
- [Genesis Evidence Invariant run 40288629527](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40288629527): success.
- [Browser acceptance run 40288629481](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40288629481): success; nine journeys passed, including desktop, phone, four institutional-location actions, shared two-session work, narrow layouts, standalone-byte checks, and restart persistence. No browser page errors were recorded.
- This hardens local secret-file handling only; it does not establish Damien's real-world identity or private-key custody.

### NGL Mesh — host-pinned operator authority and crash-aware replay markers

Draft PR [#1](https://github.com/ngl-damien/ngl-mesh/pull/1).

- Exact head **0d60a746a022766fc105bfa12396daf255d47bd0**; branch is 23 commits ahead and 0 behind main.
- Operator trust requires a host-provisioned Ed25519 fingerprint; request-supplied keys cannot establish their own trust root. JVM-property fallback requires explicit test/development opt-in.
- Replay/revocation markers now use exclusive creation, file sync, and directory sync before the consequential append. Newly created state-directory entries are synced; duplicate/symlink markers are not overwritten. A sync failure aborts the transition, but a marker may remain and consume a grant without an append.
- Exact-head [Relay operator-key trust run 40289454132](https://github.com/ngl-damien/ngl-mesh/actions/runs/40289454132): success. Logs show **9 operator trust checks** and **8 durable-marker checks** passed.
- The broader recovered-APK/RAE integration remains unrun because the recovered-source archive, reference APK, and RAE report are not available in the repository. No APK rebuild/install or real operator identity is claimed.

## Ranked next steps

1. **Reconcile PR #60 onto current Alpha One main** before further review; preserve its COMMIT_DURABILITY_UNCERTAIN behavior and do not automatically remove a potentially live lock.
2. **Production observation trust:** review PR #26 against the actual mutation path; only integrate after separately controlled observer and adjudicator trust roots exist. Never substitute an always-true verifier or test allowlist.
3. **Crash/concurrency acceptance:** add fault injection around lock acquisition, atomic rename, directory sync, and concurrent writers; continue issue #17.
4. **Founder-key custody/history:** coordinate any real key custody, rotation, or historical secret remediation only with explicit Founder authorization.
5. **NGL Mesh integration:** run the broader bridge harness only when the exact source archive, reference APK, and RAE report are supplied; no APK/runtime claim without evidence.

## Authority and evidence boundary

No merge, deployment, release, spending, provider call, production trust-root provisioning, or key rotation/revocation was performed in this run. PR #61 was already merged when observed; this run did not merge it. Exact-head GitHub Actions are the verification evidence; no local test run, physical-device behavior, real-world identity, or uninterrupted between-run execution is claimed.

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

