# Stable Recovery Reference Reads — Checkpoint (2026-10-28)

## Fresh repository state and supersession

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- Starting `main`: `2352d1831a466969e669c4cac2196725601a5e2f` (merge of PR #136, read-only writer-lock diagnostics).
- PR #136 is merged; its old checkpoint is historical.
- PR #63 remains open but stale: head `29e46760e67bae1b7b2133927a6c7d7a10f9df43` is 8 commits ahead and 93 behind current main. Current `game/server.mjs` already contains bounded no-follow persisted Founder-key file checks. Do not merge PR #63 wholesale.
- PR #16 is closed/unmerged; merged PR #18 supersedes its original self-signing flow.
- Issue #17 remains open for independently controlled Founder identity/key custody, adversarial concurrency, and safe crash/stale-lock recovery.
- Linked `ngl-damien/ngl-mesh` PR #1 remains draft/unmerged at `839f553f5255f47b3d7fcbd1272efbdeb5ac73af`. Isolated operator-trust and durable-marker checks do not establish full APK/RAE integration; required recovered-source archive, reference APK and RAE report remain absent.

## Functional changes on this branch

Branch: `fix/recovery-reference-stable-read-20261028`.

1. Added `src/institution/recovery-files.mjs` with bounded reads from regular files, final-symlink rejection, open-handle/path identity checks, and before/after metadata stability checks.
2. The continuity record is limited to 1 MiB and must be a regular non-symlink file with valid UTF-8 before JSON parsing.
3. Each hash-pinned reference is checked for safe relative path shape, restricted path classes (`.runtime`, `.git`, secrets/credentials, `.key`, `.pem`), symlinked path components, repository containment, and regular-file status.
4. Reference bytes are read through a stable file handle with a 64 MiB bound. SHA-256 is computed from those bytes.
5. Recovery output preserves the existing `recovered` path list and adds per-reference receipts with expected/observed SHA-256, byte size and status. It reports all reference failures in one run, emits a compatibility stderr diagnostic for changed receipts, and exits nonzero if any reference is unsafe, missing, changed or mismatched.
6. Nine tests cover stable reads, symlink rejection, byte limits, traversal/sensitive paths, checksum mismatch, invalid UTF-8, controlled successful child-process recovery, and fail-closed reporting for the actual default continuity record.

## CI failures inspected and repaired

- Exact-head full verification run `40652767809` failed because the default continuity record's stored SHA-256 for `src/institution/decisions.mjs` no longer matched current repository bytes. The initial test incorrectly assumed all historical pins still matched.
- On the next code head, full verification run `40653370507` exposed two further test-contract issues: the existing `test/institution-continuity.test.mjs` expects a `changed` diagnostic on stderr, and the new controlled-success test asserted a nonexistent `sha256` field instead of `expectedSha256`.
- The implementation now preserves the stderr diagnostic while emitting structured receipts, and the test asserts the actual report schema. The default-record test checks all ten references and requires a nonzero exit whenever any receipt is not verified; the controlled fixture tests the successful path independently.
- Genesis Evidence Invariant runs `40652767829` and `40653370788` passed. Browser run `40653370724` was still in progress at the last poll. Inspect all workflows again on the newest head; no post-repair full-verification or browser success is claimed yet.

I did **not** rewrite the continuity record's pinned digest to make CI green. That would silently replace historical evidence binding. A deliberate record refresh needs its own provenance decision.

## Commits

- `00ee6a710d6138b04605de02868be42b3dfdf868` — add bounded stable recovery-file reader.
- `c8975eac5ce6bf19b5689fa187b9c90df3979e8f` — use stable reads in continuity recovery.
- `958e254eef0a65435d9bb1d684b9a8f34016bfcb` — add recovery-file tests.
- `815b121b4272b0615c4bac22a98873f499030413` — emit verified reference receipts.
- `0f7c0b2e6a18439a71c9329cfefec35a7b54ab91` — expand symlink/receipt/UTF-8 regression coverage.
- `796c00654094cbf60afef5a374a4fafd1b245bd1` — initial checkpoint.
- `7a7e6b6056db0aa3a92ee8a4b805e91f89a1cec4` — return expected/observed hashes for every reference.
- `062459a6054ccae83b662b45fb71c3df00a69195` — report all mismatches and fail closed.
- `c51b516d6a4290427cb688e24a4fafb7d008c00b` — test stale-receipt reporting and controlled success.
- `c2a664a59fb2664719cc5946d565e1e21640d826` — preserve stderr diagnostics for changed receipts.
- `75106e5cf47e60e957626c2cef8a9b4ee6514a63` — align receipt assertions with the report schema.
- The checkpoint refresh commit must be inspected as the final head.

## Verification boundary

No local test execution is claimed. The full Node suite, package build, bounded institutional exercise, Genesis Evidence Invariant, and browser acceptance must be inspected on the final checkpoint head. Main's prior green workflows are not evidence for this branch.

## Safety limits / unresolved blockers

- This is read-only recovery hardening. It does not delete/release writer locks and does not solve the check-then-unlink race.
- Path/inode checks are best-effort, not an atomic `openat` capability boundary.
- A hash match proves byte equality to a digest stored in the continuity record, not the truth of the record's claims or the identity of its author.
- The default continuity record has at least one stale pin (`src/institution/decisions.mjs`). Keep it visible; do not automatically rewrite historical hashes. A separately reviewed continuity-record update is needed if its source-of-truth status is intentionally refreshed.
- Production trust roots remain absent; PR #76 is draft and unwired into `game/server.mjs`.
- No merge, deployment, release, spending, or production key operation is included.

## Next steps

1. Inspect all three workflows on the newest PR head. Fix only demonstrated defects and rerun.
2. Review all ten reported continuity receipts; decide separately whether the record is historical or should be deliberately re-pinned with a provenance note.
3. Continue Issue #17's concurrency and crash/stale-lock acceptance without automatic lock deletion.
4. Reconcile stale security branches against fresh main; keep production trust fail-closed until independently controlled key custody and actual mutation-path wiring are demonstrated.
