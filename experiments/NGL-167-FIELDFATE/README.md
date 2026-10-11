# NGL-167 FIELDFATE — Migration Evidence Experiment

No_Gas_Labs™ | Damien Featherstone, the Neophyte Founder™

**Research question:** Can an offline, declared-field-contract examiner help CRM migration operators identify silent data loss between source and target CSV exports?

**Implemented locally (not a public release):** exact and composite-key identity matching; duplicate-key refusal; source-field coverage gate; explicit exclusions; decimal/case/whitespace modes; leading-zero erosion, truncation, missing-row, and erased-value witnesses; redacted exports; SHA-256 receipts; independently checked Python oracle.

**Scope:** user-supplied CSV snapshots. The instrument does not authenticate exports, prove source completeness, or verify live destination behavior. BOUNDED is not proof of successful migration.

**Market comparison (2026-10-11):**
- Import2: commercial CRM migration from $499, with some sponsored free migrations. https://www.import2.com/pricing
- csvdiff: capable free open-source key-based CSV diff. https://github.com/aswinkarthik/csvdiff
- Formaty: free local-first CSV comparison. https://formaty.dev/compare-csv
- Oracle documents post-migration source-target verification. https://docs.oracle.com/en/cloud/paas/database-migration/dmsus/data-verification.html

**Commercial hypothesis:** $29 one-time; NOT validated. No independent buyers, completed customer examinations, purchases, sales, or revenue evidenced.

**Proposed validation:** 20 qualified operator exposures; seek 3 independent examinations, one corroborated consequential discrepancy, and one explicit $29 purchase request. Stop or modify if preparation is excessive or free tools satisfy buyers.

**Artifact custody:** Commercial ZIP and quality evidence are maintained in the No_Gas_Labs™ Catalog. This README alone is not an executable product or verification receipt.

**Evidence invariant:** A model's assertion is never sufficient evidence that the state it describes is correct.
