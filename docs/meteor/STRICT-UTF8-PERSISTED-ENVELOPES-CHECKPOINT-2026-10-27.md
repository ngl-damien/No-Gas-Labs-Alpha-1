# Stutter-step checkpoint — strict UTF-8 persisted-envelope reads

Date: 2026-10-27 UTC
Repository: `ngl-damien/No-Gas-Labs-Alpha-1`
Base `main`: `f75a5112d34d0ec189c1ad73f6ba14493ca92f06`
Branch: `security/strict-utf8-persisted-envelope-reads-20261027`

## Fresh-state finding

The service store and institutional ledger bounded reads, then decoded bytes with `Buffer.toString('utf8')` before canonical JSON comparison. Replacement decoding can map malformed byte sequences to U+FFFD. If the canonical envelope itself contains U+FFFD and its digest is valid for that decoded payload, the old path can compare the decoded string as canonical even though the persisted bytes are not valid UTF-8.

The decision store already had a byte-round-trip UTF-8 check. This change does not duplicate that production code; it adds regression coverage to preserve the existing boundary.

## Functional changes

- `game/service-store.mjs`: reject bytes that do not round-trip through UTF-8 decoding with `SERVICE_STORE_INVALID_UTF8`, before JSON parsing and canonical-envelope validation.
- `src/institution/ledger.mjs`: reject malformed UTF-8 as `LEDGER_TAMPERED` before JSON parsing, deterministic replay, or projection acceptance.
- Service-store regression: writes a valid canonical envelope containing U+FFFD, replaces its UTF-8 byte sequence with invalid byte 0xFF, then verifies rejection and writer-lock cleanup.
- Ledger regression: repeats the malformed-byte construction in the persisted trusted roster and verifies rejection and lock cleanup.
- Decision-store regression: pins the already-existing strict UTF-8 rejection with the same replacement-decoding edge case.

These are persisted-byte integrity checks, not authentication. They do not establish that a digest is signed or that persisted state came from an independently trusted actor.

## Commit trail

- `0005c36ef6fad409edd3b90a04969b8009628427` — strict UTF-8 check for service-store envelope.
- `013c946130a62e99033a55a54fd608b6a58992ed` — service-store malformed-byte regression.
- `f408387a57461b6a1e1002f55848645fc3573613` — strict UTF-8 check for ledger.
- `f560c0fef755d2e2287e541ce1cdb9fe5c124fdc` — ledger malformed-byte regression.
- `a78074a7c6986fc2fbc454b38cef1563e6c8a639` — decision-store strict UTF-8 regression.

## Verification status

- Fresh compare against main before this checkpoint: 5 commits ahead, 0 behind, 5 changed files.
- Source reinspection confirmed the service and ledger no longer use permissive direct UTF-8 replacement decoding for persisted envelopes; the decision store retains its existing round-trip check.
- Local execution was attempted but blocked because this runtime could not resolve `github.com`; **no local test run is claimed**.
- Exact-head GitHub Actions verification must be inspected after the PR is opened. Do not claim CI success until each completed run is observed on the final head.

## Unresolved blockers and next priorities

1. Inspect full verification, Genesis Evidence Invariant, and browser acceptance on the exact PR head; diagnose and fix any failure, then rerun.
2. Reinspect current main and the PR after CI to detect supersession before any integration decision.
3. Continue Issue #17's independent Founder-key custody, concurrent-writer, and crash/stale-lock acceptance. PR #16 is closed/unmerged and superseded by merged PR #18; a configured fingerprint does not prove Damien's identity or private-key custody.
4. Keep production observation trust disabled until independently controlled trust roots and the actual server mutation path are verified. PR #76 remains an adapter not wired into the live mutation path.
5. Issue #22's hybrid-cognition comparison remains a proposal; preserve preregistered criteria and raw outputs before claiming capability gains.

No merge, deployment, release, spending, production key provisioning/rotation/revocation, or Founder-identity claim is included.
