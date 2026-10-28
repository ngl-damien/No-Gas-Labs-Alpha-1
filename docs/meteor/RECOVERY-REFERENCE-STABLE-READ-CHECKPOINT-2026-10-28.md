# Stable Recovery Reference Reads — Checkpoint (2026-10-28)

## Fresh repository state and supersession

- Repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- Starting `main`: `2352d1831a466969e669c4cac2196725601a5e2f` (merge of PR #136, read-only writer-lock diagnostics).
- PR #136 is merged; its checkpoint is historical, not pending work.
- Eleven Alpha One PRs were visible in the fresh open-PR search. PR #63 is open but stale: its head `29e46760e67bae1b7b2133927a6c7d7a10f9df43` is 8 commits ahead and 93 behind current main. Do not merge that branch wholesale. Current `game/server.mjs` already contains no-follow, regular-file, private-permission, bounded-read and stable-metadata checks for the persisted Founder key.
- PR #16 is closed/unmerged; merged PR #18 supersedes the original self-signing flow.
- Issue #17 remains open for separately controlled Founder identity/key custody, adversarial concurrency, and safe crash/stale-lock recovery.
- The prior lock-inspector checkpoint explicitly said not to automate deletion of potentially live locks. This change preserves that boundary.

## Functional changes on this branch

Branch: `fix/recovery-reference-stable-read-20261028`.

1. Added `src/institution/recovery-files.mjs` with bounded reads from regular files, final-symlink rejection, open-handle/path identity checks, and before/after metadata stability checks.
2. The continuity record is limited to 1 MiB and must be a regular non-symlink file with valid UTF-8 before JSON parsing.
3. Each hash-pinned reference is checked for safe relative path shape, restricted path classes (`.runtime`, `.git`, secrets/credentials, `.key`, `.pem`), symlinked path components, repository containment, and regular-file status.
4. Reference content is read from a stable file handle with a 64 MiB bound, then SHA-256 checked against the recorded receipt. This closes the previous `realpath()`-then-unbounded-`readFile()` gap.
5. The recovery JSON retains the existing `recovered` path list and adds `receipts` entries containing path, expected SHA-256 and observed byte size. It still does not claim a fresh cloud/environment restoration.
6. Nine tests cover stable reads, symlink rejection, bounds, path traversal/sensitive paths, checksum mismatch, invalid UTF-8, and the actual default recovery command in a child Node process.

## Commits

- `00ee6a710d6138b04605de02868be42b3dfdf868` — add bounded stable recovery-file reader.
- `c8975eac5ce6bf19b5689fa187b9c90df3979e8f` — use stable reads in continuity recovery.
- `958e254eef0a65435d9bb1d684b9a8f34016bfcb` — add recovery-file tests.
- `815b121b4272b0615c4bac22a98873f499030413` — emit verified reference receipts.
- `0f7c0b2e6a18439a71c9329cfefec35a7b54ab91` — expand symlink/receipt/UTF-8 regression coverage.

## Verification status

No local test run is claimed. The nine new Node tests, the existing test suite, package build, bounded institutional exercise, Genesis Evidence Invariant, and browser acceptance must be inspected on the final PR head after the checkpoint commit. Main's prior green workflows are not evidence for this branch.

## Safety limits / unresolved blockers

- This is a read-only recovery hardening change. It does not delete or release writer locks and does not solve the check-then-unlink race.
- Stable pathname and inode checks are best-effort, not an atomic `openat` capability boundary.
- A verified hash proves byte equality to the receipt embedded in the continuity record, not the truth of the record's claims or the identity of its author.
- A configured Founder public-key fingerprint is not proof of Damien's real-world identity or private-key custody.
- PR #76 remains draft and unwired into `game/server.mjs`; production trust roots are absent.
- Linked NGL Mesh APK/RAE integration remains unverified until the recovered-source archive, reference APK, and RAE report are available.

## Next steps

1. Inspect exact-head full verification, Genesis Evidence Invariant, and browser acceptance. Fix only demonstrated failures and rerun.
2. Confirm the actual `npm run recover:institution` child-process regression passes and emits all ten verified receipts.
3. Continue Issue #17's concurrent-writer and crash/stale-lock acceptance without automatic lock deletion.
4. Reconcile stale security branches against fresh main; keep production trust fail-closed until independent custody and actual mutation-path wiring are demonstrated.
