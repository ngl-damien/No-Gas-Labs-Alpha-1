# Stutter-step checkpoint — bounded Founder approval input reads

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
Base `main`: `6a5bbf8d2c00f41f9bb8320dbc17431e00ea22c1`
Branch: `security/bounded-founder-install-file-reads-20261027`

## Fresh-state findings

- Current `main` is `6a5bbf8d2c00f41f9bb8320dbc17431e00ea22c1`; PR #111 has merged as `c09a1fe818ff9a89a71cce500f3e23ed90896827`. Strict UTF-8 checks for the service store and ledger are already present in main.
- PR #16 is closed and unmerged. Merged PR #18 supersedes its self-signing INSTALL flow. Reopening or reimplementing PR #16 is not the right fix.
- PR #63's Founder-key-file hardening branch is open but unmergeable and stale; the current main already contains a hardened `game/server.mjs` key loader. This run targets a separate remaining input path in `scripts/approve-install.mjs`.
- The approval CLI stat-checks proposal/private-key files and then calls `FileHandle.readFile()`, checking the byte limit only after the entire file has been read. It also decodes UTF-8 permissively and does not recheck path/handle metadata after reading.

## Functional change

- Added `scripts/bounded-file-reader.mjs`: bounded 16 KiB chunk reads, a max+1 overflow sentinel, symlink/non-regular rejection, `O_NOFOLLOW`/`O_NONBLOCK` where supported, opened-file identity checks, pre/post size and timestamp checks, and strict UTF-8 round-trip validation.
- Wired `scripts/approve-install.mjs` to use the helper for both proposal and private-key inputs.
- Private-key reads additionally require private permissions and, where supported, current-process ownership.
- Added `test/approve-install-file-reader.test.mjs` with eight tests: multi-chunk valid reads; symlink rejection; oversized sparse-file rejection; malformed UTF-8 rejection; valid proposal inspection; malformed UTF-8 in an otherwise parseable proposal; successful signing using ephemeral test keys; and malformed UTF-8 rejection for a private-key file.

## Commit trail before this checkpoint

- `e152e7c84aadec253aff9861b4d0432f354c6b01` — bounded strict-UTF-8 reader.
- `9ffac011b2108eb6bf781ff2bb76b4ec559ce341` — use it in Founder approval CLI.
- `1a9bcc8b65be1bc4f4a2e28b09e4ebfb5f3dabc3` — adversarial and positive-path tests.

## Verification status

- Branch comparison before checkpoint: 3 commits ahead, 0 behind, 3 changed files.
- Source was re-read after implementation; `approve-install.mjs` no longer contains the unbounded `handle.readFile()` path.
- Exact-head GitHub Actions verification is pending PR creation. Do not claim test success until the completed runs are inspected on the final PR head.
- No local test run is claimed.

## Limits and next priorities

1. Inspect Full verification, Genesis Evidence Invariant, and Browser acceptance on the exact PR head; diagnose and fix any failure, then re-inspect final-head checks.
2. Keep approval signing scoped to explicit proposal-digest confirmation and an independently configured key fingerprint. These changes do not establish Damien's identity or independent private-key custody.
3. Continue Issue #17's independently controlled Founder-key custody and crash/stale-lock acceptance. Never automatically delete a potentially live lock or infer human identity from a fingerprint.
4. Reconcile PR #76 against fresh main before integration. Its signed-attestation adapter is not wired into the live server mutation path, and production trust roots are absent.
5. Keep production observation trust disabled until independent trust-root custody and live mutation-path integration are verified.

No merge, deployment, release, spending, production key provisioning/rotation/revocation, or Founder-identity claim is included.
