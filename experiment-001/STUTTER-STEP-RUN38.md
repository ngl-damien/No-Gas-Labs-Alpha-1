# Repository Stutter-Step — Run 38 checkpoint

**Date:** 2026-10-21 (UTC date from run context)  
**Repository:** `ngl-damien/No-Gas-Labs-Alpha-1`  
**Safe branch:** `stutter-step/run38-founder-approval-20261021`  
**Base:** PR #16 head `5266589731d8267fbb3ab29394143b1cd6abbad1`

## Finding carried forward

Issue #17's source finding was reproduced: the previous `demonstrate()` path used the same HMAC key for verification and test signing, and the persisted ledger did not retain an independently verifiable authorization signature. The test's fake approval check did not establish separation of authority.

## Changes in this candidate

- Replaced symmetric HMAC authorization with Ed25519 verification using a public key and a separately supplied pinned public-key fingerprint.
- Added strict, canonical proposal serialization and exact-field validation.
- Bound approval to capability ID, implementation digest, challenge proof, nonce, validity window, and bounded authority (`INSTALL`, `REUSE`, one install, 1–3 uses).
- Persisted the approval signature in each installation record and verify it again on ledger replay.
- Added a separate offline signer CLI that refuses non-TTY use, displays the proposal and digest, requires the operator to type the exact digest, and writes a receipt without overwriting an existing one.
- Added a real bounded invocation that persists output, consumes a nonce, and rejects replay or exhausted authority.
- Added a fresh-process test that reopens the ledger and obtains `8² = 64`.

## Local verification

Command: `node --test experiment-001/institutional-cycle.test.mjs`  
Result: **10/10 tests passed**. Three initial harness failures were corrected (working-directory resolution, a no-op mutation, and an async assertion). Additional tests cover non-interactive signer refusal, expired approval, and a tampered Ed25519 signature even when the record hash is recomputed.

The tests use ephemeral synthetic keys and temporary files only. They do not establish actual Founder authentication or independent AI-provider acquisition. The automated end-to-end test confirms the CLI refuses non-interactive signing; cryptographic acceptance is tested with synthetic keys rather than a real human approval session.

## Remaining blockers / constraints

- Exact-head GitHub CI is pending; the source has not been merged and no merge is authorized.
- The public-key fingerprint must be pinned through a trusted out-of-band process; the repository cannot establish Damien's identity.
- The JSON ledger still assumes a single writer and lacks parent-directory fsync, external rollback anchoring, and production-grade crash recovery.
- No actual Founder private key was accessed or generated for use outside the test fixture.
- The proposal candidates remain deterministic examples, not four-provider outputs.

## Next prioritized steps

1. Inspect exact-head CI and repair any integration regressions without merging.
2. Inspect the tampered-record signature and expired-approval controls on exact-head CI.
3. Design a separately controlled, founder-owned fingerprint enrollment process; do not fabricate enrollment evidence.
4. Only after authority review, demonstrate a fresh-process invocation using a real Founder-approved test proposal, recording exactly who approved it.
5. Pursue provider-generated candidate artifacts only after their origin can be independently attributed.
