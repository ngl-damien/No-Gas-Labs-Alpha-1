# Run 27 — Offline approval boundary (2026-10-21)

**Authority:** Damien Featherstone, Neophyte Founder™ of No_Gas_Labs™. **Classification:** local synthetic experiment verified; source integration blocked; no human identity verification, provider attribution, merge, publication or deployment.

## Fresh state
- main `7b5085b5f1686290569d564ff20774e313a69aea`.
- PR #16 open/draft at `5266589731d8267fbb3ab29394143b1cd6abbad1`; issue #17 open. PR #16 HMAC key still caller-controlled.
- Run26 branch at `be7c1116d0628cb2e0fe366720cdfe3a2f2497a0`; source blob `18468bd26294c0550ead4b7e906522cb2a36ab08`. Run25 and Run26 branches identical. CI run 39628157200 passed inherited SHA, not local fixes.
- This branch started at `be7c111...`. No superseding executable-source commit observed.

## Executed cycles
1. Recovered the Run25 experimental program-verifier and operator delegation; 27/27 baseline tests passed. Prioritized actual offline signing workflow over repeated ledger patches.
2. Implemented `v3/founder-approval.mjs`: complete proposal display, exact SHA-256 confirmation phrase, Ed25519 signer with independent public-key fingerprint check, immutable INSTALL_PROGRAM source/hash/nonce/quota binding, separate signing process, exclusive receipt output, and rejection of legacy unbounded INSTALL/REUSE. The CLI refuses piped non-TTY approval.
3. Adversarially reviewed and corrected key loading: `O_NOFOLLOW` atomic open, descriptor-based mode check, and symlink rejection (including the CLI path).
4. Verified real pseudo-terminal synthetic signing, independent Python signature validation, fresh-process installation/recovery, incorrect-confirmation refusal and symlinked-key refusal. Candidate source remains `UNVERIFIED_CLAIM`.

## Verification
- `node --test v3/*.test.mjs`: **31/31 passed**, 0 failed (27 inherited + 4 new).
- `python v3/run27-e2e.py`: passed positive and negative controls.
- Package independently extracted; both commands rerun successfully.
- Local signer Git blob: `11255eb20eedfc48e7e84bee9680e0a63afba812`; SHA-256 `41105a9db34e8ecb923fee9eb5d565c83406490d3ee3dcb8ff3b8e1bb99d54b1`.
- Archive: `NGL_Stutter_Step_Run27_Local_Candidate.zip`; SHA-256 `386eab7d5950a767830cf0c4a3c4af2be9be32412ecfd4a1fc4ac4c188e24b7c`.
- All keys synthetic; no private key archived; no actual Founder authorization or independently attributable AI provider.

## Persistence and blocker
- Safe branch `stutter-step/run27-offline-approval-20261021` created.
- Checkpoint creation succeeded at `456b58fcbe6f2dbd7979a16bd3271c66e09f5b11`.
- Standard `create_file` of `experiment-001/founder-approval.mjs` **blocked by connected safety checks**. No alternate Git-object or external write routes attempted. Executable source remains local, **not** on this branch; this checkpoint commit is not exact-head source CI.
- No PR created, no merges, no deployments.

## Next ranked steps
1. Obtain a permitted source-and-test integration workflow, commit the exact archived signer and regression tests on a safe branch, obtain exact-head CI. Do not bypass connector restrictions.
2. Founder-controlled key custody, enrollment and out-of-band pin ceremony; an AI-created synthetic key is NOT Damien's authentication.
3. Remove legacy unbounded INSTALL and provide explicitly tested v2/v3 migration.
4. Verify independent provider-origin artifacts using independent challenges and externally retained receipts.
5. Review host compromise, terminal spoofing, key-file races and witness freshness before production.

**Verified major breakthroughs: 0.**