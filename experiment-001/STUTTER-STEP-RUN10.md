# Repository Stutter-Step Run 10 — 2026-10-20

Baseline (fresh inspection): main `7b5085b5`; PR #16 open/draft at `5266589`; issue #17 open; Run 9 checkpoint at `406670f`. Run 9 executable candidate remains **local only**, not present on this branch. Run 9 baseline rerun: 36/36 Node tests passed.

## Reproduced trust failures (local candidate, before modification)
1. A caller supplying an attacker-controlled witness key and a valid attacker signature could open a rolled-back, authentically Founder-signed ledger: **ACCEPTED**.
2. Omitting the witness entirely also opened the rolled-back ledger: **ACCEPTED**.
3. A strict witness checked at open was not rechecked before a second commit on the same handle: **ACCEPTED**.

## Bounded corrective experiment (not pushed)
Separated independently pinned witness trust policy from untrusted checkpoint/signature; fail closed when only a witness is provided or trusted policy has no witness; reject embedded self-asserted witness key; detach caller-supplied witness objects; recheck strict freshness on **each** commit. A legitimate commit succeeds; another on the same handle fails until an independently signed refreshed checkpoint is provided.

After changes: **42/42 Node tests passed** (36 previous plus six new). Existing 100-race stress test: 100 committed, 400 rejected, zero observed overwritten records. Independent Python Ed25519 audit: 7/7 assertions passed. A separate Node process signed witness checkpoints using a key held outside the ledger directory.

Adversarial limit: rolling back BOTH ledger and witness to a previously valid pair remains accepted. A third independent monotonic anchor is needed. The pinned root is supplied by the calling authority; it is NOT authenticated to Damien. Unanchored legacy mode still exists; no system-wide enforcement or production claim.

## Integration
Created safe branch `stutter-step/run10-witness-integrity-20261020` from Run 9 checkpoint. Direct test-source update was **blocked by connected repository safety checks**; no executable code was uploaded. Existing CI green at base commit does NOT validate Run 10. No merge, deployment, spending, or Founder signature.

## Next
1. Authorized integration of the local Run 10 source/tests and exact-head CI; address the repository write block without bypassing safeguards.
2. Enforce pinned trust at every consequential entry point, not optional call sites.
3. Add an independent monotonic third anchor and test two-store rollback; then test crash recovery and compromised worker keys.
4. Resume independent provider-generated candidate experiments only after authority and evidence boundaries survive.

Verified major breakthroughs: **0**. Classification: reproduced local security flaw and locally tested corrective behavior; not an independently validated breakthrough.
