# Stutter-step Run 9 — 2026-10-20 (experimental, unmerged)

Baseline: PR #16 is open/draft; issue #17 describes the self-signed installation flaw. The existing safe branch at 63101d31 has Ed25519 verification separated from signer, but Run 8 executable candidate remains local.

Local experiment: Run 8 accepted rollback of a complete valid signed ledger snapshot, resetting delegated-worker quota and nonce history. Added a separate Ed25519-signed witness checkpoint bound to institution scope, Founder verification key fingerprint, sequence and record hash. A preserved witness rejects rollback below its sequence. Added strict freshness mode that rejects unwitnessed extensions for high-stakes operations. 36/36 local Node tests and five independent Python audit assertions passed.

Limitations: Witness is independently signed with synthetic test keys; no actual independent witness service, trusted key custody, external checkpoint durability, production deployment or novel cryptography. A stale checkpoint permits rollback above its floor, and rollback of both ledger and witness defeats the guard. Tests were local only.

Repository integration: source upload attempt rejected by connector safety checks. No merge, deployment, spending, or Founder authorization claimed.

Next: integrate reviewed candidate on safe branch, run exact-head CI, externally anchor witness under independently controlled custody, and challenge rollback of both records.
