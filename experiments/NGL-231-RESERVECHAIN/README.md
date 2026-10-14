# NGL-231 — RESERVECHAIN™

**Status:** Offline artifact built and internally tested; buyer validation not observed.

RESERVECHAIN is an independent, exact-cent cross-cycle marketplace reserve and payout reconciliation examiner. It checks whether declared reserve holds/releases, available balances, payout records and posted bank entries can all coexist under a user-supplied USD ledger. The mathematical identity is:

opening available + opening reserved + sales - refunds - fees + adjustments - payouts = closing available + closing reserved.

Reserve holds and releases transfer value between available and reserved, not out of the combined balance. Each cycle's modeled closing balances must match the next cycle's opening balances. A bank-posted amount differing from its declared payout produces HOLD; pending bank evidence produces REVIEW. Missing source references or unsupported completeness declarations produce REVIEW. A clean conditional calculation produces BOUNDED, **not** proof of actual bank delivery, complete exports, accounting compliance or entitlement.

**Technical tests:** 11 Python methods; 700 randomized independent JavaScript/Python differential cases; 20 adversarial/demo cross-language cases; 350 separate aggregate-algebra oracle cases; 72 Chromium browser assertions at 1440/390/320 pixels. No disagreements in tested scenarios. Chromium file URL navigation was blocked in the test environment, so browser acceptance loaded the exact standalone HTML bytes. Direct mobile file execution unverified.

**Market (2026-10-14):** A2X (from $29/month Shopify App Store), Synder (from $65/month monthly), Link My Books, free SkuSum, local Reconcilly and $19/report PayoutCheck are material competition. Proposed $49 one-time price is a hypothesis; zero independently observed buyers, purchase requests or sales.

**Sources:**
- Shopify reserve mechanics: https://help.shopify.com/en/manual/payments/shopify-payments/payouts/reserves
- Shopify payout activity: https://help.shopify.com/en/manual/payments/shopify-payments/payouts/payouts-activity-report
- A2X: https://apps.shopify.com/a2x
- Synder: https://synder.com/pricing/
- SkuSum: https://www.skusum.com/
- Reconcilly: https://pypi.org/project/reconcilly/

**Distribution boundary:** This README is a research record, not an executable public release. The downloadable offline HTML, source code, demos, and tests are separately packaged and archived in the NGL Catalog. No checkout, outreach, traffic or revenue is claimed.
