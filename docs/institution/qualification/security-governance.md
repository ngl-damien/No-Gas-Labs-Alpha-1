# Security and governance — bounded internal qualification

The executed baseline probe is `evidence/security-governance.json`. It used disposable loopback services, fake Founder credentials and generated fixture identities; no live record or third-party system was tested. A later delegated review turn was tool-rejected, so no final sign-off by that worker is claimed. Root reviewed the retained evidence and exercised the capacity repair separately. This is internal AI criticism, not human specialist certification.

## Q-SEC-001 — Anonymous session churn displaced Founder

**Claim:** unauthenticated session turnover should not revoke an authenticated Founder's session. **Classification:** REPRODUCED. At baseline, 512 cookie-less state reads displaced the Founder through the global FIFO. Impact: bounded authentication availability failure, not acquisition of Founder authority. Preconditions: reachable service and repeated unauthenticated requests. Detection: next request becomes Witness; recovery: reauthenticate. This violated session-priority isolation even though authentication checks themselves held.

**Alternatives:** protect authenticated sessions and evict least-recent Witness entries, rejecting admission when none is evictable (selected); or separate registries with rate/admission controls (larger unimplemented change). Root's real HTTP regression failed before the change and passed afterward; internal engineering review checked the victim-selection code. Rollback is the prior session allocator, which restores the known flaw. The selected change does not establish general denial-of-service resilience, rate limiting or production load adequacy. Gate A: original failure contained. Gate B: bounded priority requirement supported, broader availability unknown. Gate C: detection/reproduction/fix/regression preserved.

## Q-GOV-001 / Q-GOV-002 — Storage owner can rewrite or roll back history

**Classification:** REPRODUCED within the explicitly trusted host/storage-owner boundary. A coherent offline rewrite of a fixture decision file changed REJECTED to APPROVED; restoring an older internally valid snapshot returned PENDING. Projection-only inconsistent edits were rejected. No remote access or real Founder credentials were involved. These host-owner limits were already disclosed in the prior store documentation; they are qualification boundaries, not newly invented remote vulnerabilities.

Impact is high if the threat model includes a hostile canonical-storage owner. Detection currently requires a separately retained trusted head; internal hashes alone do not supply one. Recover from a known-good full backup while owners are stopped. Alternatives: independently controlled append-only/head anchors; or externally verifiable Founder signatures and versioned backups under a separate authority. Neither is configured or claimed here. Gate A: no new improvement claimed. Gate B: insufficient for hostile-host governance integrity. Gate C: internally inconsistent corruption detects, coherent rewrite/rollback remains unresolved without an external trust anchor.

## Q-SEC-002 — Courier enrollment pin drift under writable storage

**Classification:** REPRODUCED on disposable courier state. Replacing enrollment and matching fixture signatures was accepted by an already-open configured instance; reopening with the original pins rejected identity conflict. Preconditions: write access to courier storage and replacement fixture identity. This is not demonstrated remote compromise. Impact: enrollment continuity fails if mutable storage is considered outside the trusted configuration boundary. Alternatives: enforce original configuration pins on every reload; or independently anchored immutable enrollment versions. No repair is claimed in this execution. Preserve known-good registry/heads before offline recovery. Gates A/B/C remain incomplete for a hostile-storage threat model.

## Supported controls and exposure limits

Baseline HTTP checks rejected wrong keys, role injection, Witness private writes, bad Origin/fetch-site, unsupported content type and oversized bodies. Private draft/evaluation redaction, logout and restart session revocation passed. Founder dispositions require explicit choices and do not promote source automatically. These are scoped control results, not complete OWASP ASVS, NIST or production compliance claims.

Externally defensible requirements include deny-by-default writes, explicit authenticated authority, correct revocation, tamper/rollback-aware recovery, secure transport and deployment-appropriate resource controls. The local host trusts the OS owner and clock. Verified HTTPS Founder access and independent human security/governance review remain absent. No operational qualification decision or 24-hour clock has been activated; silence cannot approve it.
