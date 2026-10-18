# T.R.U. — Temporal Reconnaissance Unit / Evidence Workbench

Zero-dependency JavaScript temporal-evidence assessment kernel and browser interface, incorporated as a **Codex integration candidate** within the AOTA² / Featherstonian Engine handoff.

## Run

From this directory:

```sh
node --test test.mjs
python -m http.server 8765
```

Open `http://localhost:8765/` to inspect the interactive interface. Python is required only for the simple local static web server; the implementation uses standard JavaScript and browser APIs.

## Current working capabilities

- Import and export bounded `tru.case.v1` JSON case files.
- Reconstruct an event timeline with separate OBSERVED / REPORTED / INFERRED / SIMULATED / FICTIONAL modes.
- Calculate a deterministic SHA-256 local case fingerprint.
- Compare an incumbent with candidate implementations and expose recorded PASS / FAIL / UNKNOWN statuses.
- Flag repeated evidence digests, missing evidence references, lack of independent corroboration, and unverified provenance.
- Export local assessments and **unauthorized** decision proposals in `tru.founder-decision-packet.v1`.
- Fourteen offline Node tests were run locally before repository transfer and passed. Codex must rerun the committed files in its own environment.

## Integrity and authorization boundaries

Evidence labels originate from case data and are untrusted. A hash proves only local byte integrity. No authenticated execution receipt, independent witness, protected persistent decision, SFAO implementation, Founder Gate authentication, authorization, or real time travel is provided. Never treat an exported proposal as an approved operation.

The 2041 T.R.U. activation and temporal artifact extraction are **authored future-history**, not demonstrated physical capabilities. Example cases include synthetic evaluation inputs; they are not real NGL audit results.

## Codex integration mandate

Inspect and test these files alongside the existing Python AOTA prototype and the actual NGL kernel/ledger/Forge architecture. Reuse functional mechanisms; reconcile evidence schema and timeline records, or document why the workbench should remain isolated. Add an end-to-end acceptance test binding a genuine evaluated candidate to a server-side decision record. Do not let this static interface satisfy the actual mission completion token.

The required completion token remains a verified, remotely reachable HTTPS Founder Gate with founder authentication, a real pending time-sensitive decision, actionable server-validated controls, secure persistence, and independently reproducible evidence. Apparent credentials, hosting, or authorization obstacles must be **investigated and confirmed**, never presumed. Do not fabricate a URL or urgency and do not bypass founder authority.
