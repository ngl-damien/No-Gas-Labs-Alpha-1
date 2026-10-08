# NGL-093 — ClaimSplit: Conversion Claim Ledger

**Status:** Internal release candidate. **Price hypothesis:** $29 one-time. **Market gate:** conditional. **Quality gate:** 80 named engine tests, 256 generated scenarios, 43 browser checks. **Evidence gate:** synthetic tests only; no buyer use, traffic, sales, or revenue verified.

## Why it exists
An order may receive credit from multiple advertising platforms. Adding those platform-reported conversions does not establish distinct purchases. ClaimSplit reconciles first-party order IDs with identity-level ad conversion claims, reports overlapping platform credit, and flags contradictions against explicitly declared source coverage.

## Scope
Offline HTML app and Node.js CLI; exact-cent order/refund reconciliation; CSV/JSON imports; aggregate-vs-identity gap review; deterministic unsigned SHA-256 receipts; adversarial and bounded synthetic controls. It **does not** authenticate exports, estimate causal incrementality, recover ad spend, or identify fraud.

## Verification and distribution
The full tested package is retained in the private No_Gas_Labs™ Catalog as `NGL_093_ClaimSplit_Conversion_Ledger_v1.zip`. This branch README is an experiment manifest, **not** evidence that the application ZIP is publicly downloadable or that a checkout works. The source, fixtures, test logs, and package SHA-256 are recorded in the Catalog.

**Commercial validation target:** 20 qualified paid-media practitioners, 3 independent real-data examinations, 1 independently corroborated useful finding, and 1 explicit $29 purchase request within 14 days of beginning outreach. None of these events has been observed.

## Market context (2026-10-08)
- Google Ads conversion counting: https://support.google.com/google-ads/answer/3438531
- Google Ads conversion windows: https://support.google.com/google-ads/answer/3123169
- Triple Whale: https://triplewhale.com/pricing
- Northbeam: https://www.northbeam.io/pricing
- mbuzz: https://mbuzz.co/pricing

No_Gas_Labs™ — a model's assertion is never sufficient evidence that the state it describes is correct.
