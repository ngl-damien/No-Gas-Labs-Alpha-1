# NGL-151 — CONSENTCUT (research manifest)

**Status:** internally tested, complete offline product; public commercial executable **not released**.  
**Institution:** No_Gas_Labs™ · Damien Featherstone, the Neophyte Founder™  
**Observed:** 2026-10-11.

## The mechanism
A newsletter subscriber migration can preserve addresses while incorrectly promoting an unsubscribe, overwriting an existing field, or triggering an automation. CONSENTCUT is a deliberately narrow offline preflight: two normalized CSVs (source and destination) → conservative cross-record consent-state triage → candidate, suppression, review, and tag-plan outputs → SHA-256 source/output receipts.

Negative subscription states defeat optimistic source rows. Duplicate or incomplete records require review. Existing destination subscribers are never included in the new-import candidate file. Tags are exported separately to avoid unexamined automation triggers. An operator must explicitly attest complete destination coverage; that attestation is **not** verified by the software.

## Test observations
- 22 Node.js tests passed.
- 420 independently generated Python cross-check scenarios; 3,562 independent assertions; 0 observed cross-language disagreements.
- 65 Chromium UI assertions across 1440, 390, and 320 pixel widths; 0 observed external requests and uncaught browser errors.
- Browser direct file:// navigation was blocked by the managed test environment; actual Android/iOS file execution remains unverified.
- Deterministic 34-file ZIP SHA-256: `a16d3c96bd698bac8a1c4b5180f6c7838295e980af5d222b3f4647f65df260c1`.
- The complete product was delivered to the operator and added to the private NGL Catalog. This research manifest does not contain the executable or private contact records.

## Market observations (not proof of NGL demand)
Kit's June 26, 2026 CSV import documentation warns that blank fields can overwrite existing data and that tags/forms/sequences can trigger automations:
https://help.kit.com/en/articles/2502555-how-to-import-a-subscriber-list

Mailchimp documents separate audience suppression and import-status workflows:
https://mailchimp.com/help/import-suppression-lists/

A March 31, 2026 newsletter-creator discussion asks whether 1,500 dormant subscribers can be safely imported:
https://www.reddit.com/r/beehiiv/comments/1s8o4hy/importing_old_subscriber_list/

Existing free importers and list cleaners are serious competitors. Proposed price: **$19 one-time**, subject to founder authorization and actual checkout verification.

## Evidence boundary
CONSENTCUT cannot authenticate consent, verify deliverability, interpret law, confirm destination completeness, or establish that platform automations are inert. A fabricated but internally consistent source can still produce a candidate.

**Public executable release:** not evidenced. **Qualified external users:** none evidenced. **Purchases/revenue:** none evidenced. No product superiority or novelty is claimed from internal tests alone.
