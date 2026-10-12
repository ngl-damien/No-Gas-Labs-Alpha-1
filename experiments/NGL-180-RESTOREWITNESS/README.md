# NGL-180 — RESTOREWITNESS (research record)

No_Gas_Labs™ / Damien Featherstone, Neophyte Founder™. Research date: 2026-10-12.

RESTOREWITNESS is a zero-network, offline evidence examiner for operator-supplied backup, recovery-point, restore-test, and service-dependency records. It checks declared RPO/RTO thresholds, integrity, offsite policy, test freshness, required checks, missing dependencies, cycles, and downstream blocking evidence. It distinguishes backup completion time from the recoverable data timestamp.

Four fictional controls: HOLD (6 blocking and 1 review finding), BOUNDED (0 findings), REVIEW (5 review findings), and dependency cascade HOLD (2 blocking findings). Internal evidence: 31 passing Node tests, 520 independent Python-vs-JavaScript scenarios with 0 disagreements, 63 Chromium assertions at 1440/390/320px, and 600 SHA-256 reference comparisons. The browser test used HTML injection because file:// was blocked by the managed environment. Direct Android file execution remains unverified.

Market observation: CISA recommends restore testing; Veeam SureBackup and Acronis perform actual backup validation; the free MIT-licensed restoredrill project actually restores PostgreSQL/MySQL backups. This experiment does not do a restore or authenticate evidence. Its proposed distinction is independent cross-workload evidence reconciliation. Price hypothesis: $49 one-time, not validated.

Gates: MARKET CONDITIONAL; QUALITY PASS within defined scope; EVIDENCE TECHNICAL PASS / EXTERNAL HOLD. No public executable release, customer traffic, sales, purchase requests, or revenue established by this research record.

The downloadable artifact is preserved in the NGL Catalog. This GitHub README is a research record, not an executable release.
