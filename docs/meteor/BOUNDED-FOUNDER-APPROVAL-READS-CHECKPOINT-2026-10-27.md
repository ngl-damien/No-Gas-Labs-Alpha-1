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
- Proposal parsing also rejects duplicate JSON object keys before validation/digest confirmation, including escaped spellings that decode to the same key.
- Proposal JSON traversal is capped at 128 nested values so adversarial nesting cannot drive unbounded recursive traversal in the duplicate-key scanner.
- Added `test/approve-install-file-reader.test.mjs` with ten tests: multi-chunk valid reads; symlink rejection; oversized sparse-file rejection; malformed UTF-8 rejection; valid proposal inspection; malformed UTF-8 in an otherwise parseable proposal; successful signing using ephemeral test keys; and malformed UTF-8 rejection for a private-key file; duplicate conflicting `strategy` keys that ordinary JSON.parse would collapse; and over-deep nested JSON rejection.

## Commit trail before this checkpoint

- `e152e7c84aadec253aff9861b4d0432f354c6b01` — bounded strict-UTF-8 reader.
- `9ffac011b2108eb6bf781ff2bb76b4ec559ce341` — use it in Founder approval CLI.
- `1a9bcc8b65be1bc4f4a2e28b09e4ebfb5f3dabc3` — initial adversarial and positive-path tests.
- `9621529871a03969df9913fb78a6ba4a24830aa9` — reject duplicate keys in proposal JSON.
- `9e0b0e2d9342d86c538d93a7147e08b34114b8a5` and `217e5eee80c59a1bd529f7388e6a7afc23ccfe79` — correct escaped-string parsing and regression fixtures.
- `1c5a6e46e99c79a5f2bec6affa81ad6c41065911` and `8900d0e9f331fc9305c64e44d575dc697a368d44` — cap proposal JSON nesting and test rejection.

## Verification status

- Branch comparison after duplicate-key/depth hardening: recheck the current final head before review; the branch is still based directly on `6a5bbf8d2c00f41f9bb8320dbc17431e00ea22c1`.
- Source was re-read after implementation; `approve-install.mjs` no longer contains the unbounded `handle.readFile()` path and now rejects duplicate proposal keys before validation/digest confirmation and caps scanner nesting at 128.
- On the earlier pre-duplicate-key head `32e0d8beb1e45bc4ebca53a928667023ab66496b`, Full verification and Genesis Evidence Invariant passed while Browser acceptance was still in progress. Those results do **not** verify the later duplicate-key/depth commits. Re-run/inspect all workflows on the final PR head before claiming success.
- No local test run is claimed.

## Limits and next priorities

1. Inspect Full verification, Genesis Evidence Invariant, and Browser acceptance on the exact PR head; diagnose and fix any failure, then re-inspect final-head checks.
2. Keep approval signing scoped to explicit proposal-digest confirmation and an independently configured key fingerprint. These changes do not establish Damien's identity or independent private-key custody.
3. Continue Issue #17's independently controlled Founder-key custody and crash/stale-lock acceptance. Never automatically delete a potentially live lock or infer human identity from a fingerprint.
4. Reconcile PR #76 against fresh main before integration. Its signed-attestation adapter is not wired into the live server mutation path, and production trust roots are absent.
5. Keep production observation trust disabled until independent trust-root custody and live mutation-path integration are verified.

No merge, deployment, release, spending, production key provisioning/rotation/revocation, or Founder-identity claim is included.
