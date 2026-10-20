# Repository Stutter-Step Checkpoint — 2026-10-20

Repository: ngl-damien/No-Gas-Labs-Alpha-1
Working branch: `stutter-step/pr16-signed-ledger-20261020`
Parent: PR #16 head `5266589731d8267fbb3ab29394143b1cd6abbad1`.
Do not merge or promote to production on this checkpoint alone.

## Source-backed defects and changes
1. PR #16 passed an HMAC signing secret into the institution and exported a signer. This did not separate the authorizing party from the system being authorized. Its persisted records were only hash-linked, so a complete ledger rewrite could be rehashed without an external signature.
2. The revised experimental module accepts a pinned Ed25519 **public** verifier key. It checks exact sequence, prior hash, decision, domain and signature both at commit and during ledger replay. Private signing operations exist only in test code and must remain outside the institution.
3. Original REUSE events recorded a nonce but did not actually invoke the installed capability. Revised REUSE recomputes a bounded deterministic function from an input, rejects an incorrect claimed output, and records the computed output. This is bounded local execution, not independently acquired AI capability.
4. A later change checks the persisted snapshot before a commit and rejects a stale sequential writer. This is not atomic concurrency control: two simultaneous writers can still race between read and rename.

## Durable commits and observed checks
- `7ce151206214b708a86f3a07000b535e0abf0501`: signed transitions, signed replay, computed invocation output and tests. GitHub push verify **failed**: 4 tests raised `ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE` for a public KeyObject. This was investigated rather than concealed.
- `de54055c70d2d85197fd2f84add16f82a2f4d2ab`: accept public KeyObject directly, retaining PEM parsing. GitHub push verify and Genesis Evidence Invariant both **passed** (runs 39468970260 and 39468970225).
- `00c7256134242b6d348f525d778278a63b9dea0c`: stale-handle guard and regression test. At checkpoint drafting, push runs 39469063194 and 39469063568 were in progress. Inspect final results before any promotion.

## Remaining blockers and challenges
- The pinned key is synthetic in tests; there is no evidence of Damien's real cryptographic Founder credential, protected key custody, human consent, or delegated authority.
- The signing callback in tests is deliberately trusted test scaffolding, not a human approval ceremony.
- The ledger lacks a transactional database, concurrent-writer safety, directory fsync and externally anchored history. A process crash can leave a .tmp file.
- Only two hardcoded strategies compete; there is no independent multi-model proposal generation or autonomous discovery.
- A REUSE event computes a deterministic output, but a separate OS-process execution test has not yet been demonstrated on this branch.
- PR creation via the connected write action was blocked. The durable working branch exists, but no follow-up PR was created. PR #16 remains untouched.
- No merge, public publication, XP award, spending, or claim of a breakthrough was authorized or performed.

## Next prioritized loop
1. Reinspect exact-head GitHub Actions runs for the latest commit, read failing logs and repair any attributable defects.
2. Exercise fresh OS-process reopening and output verification; challenge incorrect output, forged signing envelope, stale snapshot and signature replay.
3. Replace single-writer JSON persistence with a transactional primitive before claiming concurrent autonomous workers.
4. Design a Founder-controlled public-key provisioning and signed-delegation process with explicit expiry and revocation; no model-generated approvals.
5. Only after those gates, replace hardcoded candidates with genuinely independent providers and an externally specified acceptance challenge.

Classification: engineering progress with verifiable CI evidence where stated; **not** a verified breakthrough, production security system, or independent capability acquisition.
