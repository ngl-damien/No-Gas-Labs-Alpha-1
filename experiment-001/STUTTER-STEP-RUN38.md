# Repository Stutter-Step — Run 38 checkpoint

**Date:** 2026-10-21 (UTC date from run context)  
**Repository:** `ngl-damien/No-Gas-Labs-Alpha-1`  
**Safe branch:** `stutter-step/run38-founder-approval-20261021`  
**Code base inspected:** PR #16 head `5266589731d8267fbb3ab29394143b1cd6abbad1`

## Finding carried forward

Issue #17's source finding was reproduced: the previous `demonstrate()` path used the same HMAC key for verification and test signing, and the persisted ledger did not retain an independently verifiable authorization signature. The test's fake approval check did not establish separation of authority.

## Local candidate

The local candidate replaces symmetric HMAC authorization with Ed25519 verification, requires a separately supplied public-key fingerprint, signs an immutable proposal digest, binds the signature to capability ID / implementation digest / proof / nonce / validity / bounded authority, persists and re-verifies signatures on ledger replay, and adds a TTY-only offline signer plus bounded capability invocation.

It includes adversarial tests for absent/forged approval, altered proposal fields, wrong verifier fingerprint, recomputed record hashes with a tampered signature, expired approval, replay, quota exhaustion, invalid inputs, and a fresh-process invocation producing `8² = 64`.

## Local verification

Commands:
- `node --check experiment-001/institutional-cycle.mjs`
- `node --check experiment-001/founder-approval.mjs`
- `npm test`

Result: **10/10 automated tests passed**. The tests use ephemeral synthetic Ed25519 keys and temporary files only. They do not establish actual Founder authentication or independent AI-provider acquisition.

## Repository persistence and integration

The checkpoint itself was committed on the safe branch at `d49c962d3c3c957da8e083b43fc3403ebef8a217`. The branch remains based on PR #16's head.

- [Verify workflow run 39719191485](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/39719191485): **passed**, but tested inherited source.
- [Genesis Evidence Invariant run 39719191522](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/39719191522): **passed**, but tested inherited source.
- Attempts to persist the candidate executable/test update were rejected by repository-tool safety checks. The executable changes are therefore **local only**; this branch has no Run 38 executable-source commit, and exact-head CI for the candidate has not been obtained.
- No PR was opened for the checkpoint-only branch; that would misrepresent it as an integrated fix.

## Remaining blockers / constraints

- The public-key fingerprint must be pinned through a trusted out-of-band process; the repository cannot establish Damien's identity.
- The JSON ledger still assumes a single writer and lacks parent-directory fsync, external rollback anchoring, key rotation, and production-grade crash recovery.
- No actual Founder private key was accessed or generated for use outside the synthetic test fixture.
- The proposal candidates remain deterministic examples, not four-provider outputs.
- No merge is authorized.

## Next prioritized steps

1. Reinspect PR #16 and issue #17 before retrying any source write; do not assume the local candidate is on GitHub.
2. Obtain a permitted source-and-test update and exact-head CI. If tool safety checks continue to reject executable writes, preserve the local candidate and document that blocker rather than claiming integration.
3. Inspect the tampered-record signature and expired-approval controls on exact-head CI.
4. Design a separately controlled, Founder-owned fingerprint enrollment process; do not fabricate enrollment evidence.
5. Only after authority review, demonstrate a fresh-process invocation using a real Founder-approved test proposal, recording exactly who approved it.
6. Pursue provider-generated candidate artifacts only after their origin can be independently attributed.
