# NGL Stutter-Step Checkpoint

Updated: 2026-10-25 local / 2026-10-26 UTC. Evidence-bound operational handoff; not a claim of autonomous discovery or production security.

## Fresh state observed

- Primary repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- `main` at `0969df84cce7748d4f0db8e79ec06d13ad826a31` — “Connect Common Ground quests to recorded activity.”
- PR #25 is open as a draft: [cross-process ledger contention coverage](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/25), branch `codex/experiment001-cross-process-contention-20261025`. Current checkpoint branch head before this documentation update: `b8f82f608539b31586d35282bc5522519b77810b`.
- PR #26 is open as a draft: [independent observation verifier boundary](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/26), branch `codex/world-projection-verifier-boundary-20261025`, head `5b284fdaf9fad32f41f7ab90014c29a7a62bb27a`.
- PR #21 remains the other open draft. No merge or deployment occurred in this run.
- PR #16 is closed **unmerged**. Its old self-signing-flow diagnosis is superseded by PR #18, which merged as `213f3b5c7771da24b36f9ce6ebdde871d22e4602` with detached Ed25519 approval and a configured startup fingerprint. That fingerprint is not proof Damien personally controls the key or supplied a decision.
- PR #14 is merged. PRs #13 and #15 are closed unmerged; do not revive their stale branches without comparing their actual diffs and authority boundaries against current `main`.
- Linked private repo `ngl-damien/Damien-Featherstone` remains at observed `main` `021d358d3cabdd3887cef58bbebac1adbfd39bb8`; no linked-repo write was made.

## Stutter-step A — cross-process ledger contention

Main already had same-process independent-store contention coverage and a fail-closed existing-lock test. The concrete remaining concurrency gap was separate Node processes racing to install capabilities.

PR #25 adds:
- `experiment-001/commit-worker.mjs`, a test-only child-process worker with a readiness barrier.
- A regression in `experiment-001/institutional-cycle.test.mjs` that releases two independent processes to commit distinct INSTALL decisions against one ledger. It accepts only successful serialization or explicit `LEDGER_LOCKED` followed by a successful fresh retry, then reopens the ledger and checks both capabilities and records persisted.
- A durable checkpoint with evidence, limitations and next steps.

Relevant commits:
- `04e1f1d2e85bb3e2c6cb4a696698f624a345a049` — initial worker.
- `0d56c7348daef8ae10b0576c8d823909ad508888` — fixed worker line termination after reinspection.
- `534a9f3cf6b5fd7feec1d809fbc7a8b2044639d9` — test added; CI exposed a missing `spawn` import.
- `1296aebb8260a4db755e3ffd71835b2df7571b95` — fixed import; push and PR CI passed.
- `b8f82f608539b31586d35282bc5522519b77810b` — durable checkpoint update.

Exact-head evidence for code/test commit `1296aebb...`:
- [verify — push run 40250732455](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40250732455): success; Node tests, Python inspector, package build and institutional exercise each exited 0.
- [Genesis Evidence Invariant — push run 40250732496](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40250732496): success.
- [verify — PR run 40250897454](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40250897454) and [Genesis — PR run 40250897464](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40250897464) on checkpoint head `b8f82f6...`: success.
- No production runtime code or signing policy changed in PR #25. This is concurrency regression evidence, not proof of hostile-load or crash-recovery safety.

## Stutter-step B — self-asserted observation status

Inspection of `src/world/project.js` found a separate evidence gap: a caller-supplied `observation_verification: "VERIFIED"` flag plus a valid artifact receipt could mint canonical progress. The receipt proves bytes match a digest, not who independently observed the event.

PR #26 changes the projector contract:
- `projectWorld` requires a host-injected synchronous `verifyObservation(event)` callback to return literal `true`; missing, rejecting, non-boolean or throwing verifiers fail closed.
- The callback receives a structured clone and runs only after other event predicates and receipt validation.
- `replayInstitution` and `verifyReplay` propagate the verifier rather than bypassing the boundary.
- Existing evidence-gated gameplay, execution-mesh and world-spine callers/tests were updated. `scripts/verify.mjs` now prints captured output when a verification stage fails; that exposed three missing verifier propagations during this run.

Relevant commits:
- `974116293212e5a03d82e65826669f2137d014f6` — first implementation; CI correctly exposed three existing callers that did not supply the new verifier.
- `9e1096dc0bab37d6dc5af36baf63f3baf795e1de` — reordered verifier invocation after receipt checks; callers still needed propagation.
- `ece690fa1a7844d50413d2fd8a6f2d7904d82c08` — added failure-output visibility.
- `5d5826b16eee314ede218eac33e43ce7cb52eba2` — propagated the verifier through replay and updated the three callers/tests.

Exact-head evidence for PR #26 head `5b284fdaf9fad32f41f7ab90014c29a7a62bb27a`:
- [verify — PR run 40251537415](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40251537415): success. Node test runner, Python inspector, package build and institutional exercise each exited 0.
- [Genesis Evidence Invariant — PR run 40251537413](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40251537413): success.
- The test suite had 256 tests in the preceding failing run (253 passed, 3 failed due to missing callback propagation); the final exact-head run exited 0 after the three callers were corrected.
- A local clone/test attempt could not resolve `github.com`; executable verification was performed by GitHub Actions.

## Remaining blockers and limits

- **Real Founder identity/key custody:** no real Founder key or external signing service is configured. A fingerprint is a configured trust anchor, not proof Damien supplied approval. Tests use ephemeral keys.
- **Real observation verifier:** PR #26's event-ID allowlist is a **test stub**, not a production verifier. The callback boundary is now explicit in the draft branch, but no trusted production verifier or host wiring has been configured; current `main` is unchanged.
- **Crash recovery:** existing ledger locks fail closed. There is no safe automatic stale-lock recovery yet; crash windows around atomic rename/directory sync remain untested. Never delete a lock merely because it looks old.
- **Integration:** the Experiment 001 capability ledger is not proven to govern every real execution, canonical world projection, or XP mutation path. A separate projector now requires a verifier callback in PR #26, but that is not yet merged or wired into production.
- **Scope:** deterministic example strategies are not independent AI agents; a hash chain without an external anchor is not tamper-proof against wholesale ledger rewrite.

## Next prioritized steps

1. Specify and implement a separately provisioned observation attestation/verifier whose trust root is outside the event producer; wire it into the actual host path and prove untrusted/missing attestations cannot award progress.
2. Establish a separate Founder signing/operator workflow and key provisioning boundary. Do not claim real Founder authorization until an approval is supplied through it.
3. Define crash-safe lock recovery for process death before/after rename and directory sync, preserving `COMMIT_DURABILITY_UNCERTAIN`; add adversarial tests before changing runtime behavior.
4. Reinspect current reducers and the actual Forge/XP/world-projection entry points after PR #26 review. Do not revive PR #13/#15 branches or merge either draft automatically.
5. After authorized review/merge, rerun both concurrency and independent-verifier checks from a fresh process/environment.

No merge, deployment, XP award, external release, or spending occurred.