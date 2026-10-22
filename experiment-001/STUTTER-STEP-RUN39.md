# Stutter-Step Run 39 — Founder Approval Separation

Date: 2026-10-21 (America/Chicago)

## Scope and baseline

- Repository: ngl-damien/No-Gas-Labs-Alpha-1
- Safe branch: experiment-001/ed25519-founder-approval-20261021
- Branch base: 5266589731d8267fbb3ab29394143b1cd6abbad1 (PR #16 head)
- Main remains 7b5085b5f1686290569d564ff20774e313a69aea.
- Issue #17 remains the source-backed acceptance blocker for self-authorized installation.
- PR #16 remains draft; do not merge.

## Local candidate implemented and tested

The local candidate replaces same-process HMAC signing with:
- Ed25519 installation approval, verified against an independently configured public-key fingerprint.
- An immutable proposal bound to capability ID, implementation SHA-256, proof, nonce, expiry, and bounded reuse count.
- A separate interactive signer CLI that refuses non-TTY execution and requires the operator to type the proposal digest.
- Signature revalidation on ledger reopen, so recomputing a record hash cannot turn a modified INSTALL into an authorized one.
- Bounded no-follow ledger reads, exclusive writer locking, atomic replacement, and parent-directory synchronization.
- A signed INSTALL grant authorizes only the stated maximum number of REUSE operations before expiry.

Local source files:
- institutional-cycle.mjs
- institutional-cycle.test.mjs
- approve-decision.mjs

## Evidence observed locally

- 14/14 Node automated tests passed.
- Adversarial coverage includes absent/forged approval, wrong key fingerprint, altered capability ID, implementation hash, proof, nonce, expiry, recomputed ledger hash after decision tampering, symlink/oversized ledger, stale handles, writer lock, bounded reuse, and replay.
- Interactive signer smoke test passed under a pseudo-terminal using synthetic keys; its emitted signature was independently verified by a separate Node process.
- All credentials used in these tests are synthetic. No real Founder key has been enrolled or used.

## Repository integration status

The source update attempt was rejected by the connected GitHub action's safety checks. No executable-source commit was created. Do not claim the candidate is integrated or that GitHub CI tested it.

This checkpoint is being persisted separately so the next run can resume without relying on chat context. The executable candidate remains local until a permitted source update is available.

## Unresolved limits

- Expected public-key fingerprint must be provisioned through a genuinely independent channel; this run did not establish Founder identity or custody.
- The JSON ledger has no external witness/anchor, so a complete rollback or rewritten unsigned REUSE tail is not ruled out.
- The interactive prompt is a human-confirmation guardrail, not a hardware-backed identity proof or secure sandbox.
- No independent AI-provider artifact was acquired.

## Next prioritized steps

1. Reinspect PR #13, PR #16, issue #17, and linked RAE authority contract for supersession.
2. Obtain a permitted source-and-test update, then run exact-head CI.
3. Add a durable external witness/rollback anchor and verify REUSE receipts against it.
4. Enroll Founder-controlled signing credentials only through an independently controlled trust channel.
5. After authority enforcement is demonstrated, pursue independently attributable AI-provider capability acquisition.
