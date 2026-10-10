# NGL-144 — SETTLEMENTWITNESS (research manifest)

Date: 2026-10-10  
Institution: No_Gas_Labs™  
Status: offline artifact produced and internally tested; commercial demand unverified.

**Problem:** A processor payout, the lines that make it up, and a bank deposit are three distinct records. An apparent exact amount/date match may not uniquely identify a deposit.

**Proposed mechanism:** Integer-minor-unit gross-to-net reconstruction; source-row contradiction witnesses; maximum payout-to-deposit matching; alternative-matching search that marks ambiguous assignments REVIEW; explicit coverage cutoff; deterministic SHA-256 receipt. No live bank or processor access.

**Independent tests recorded in the commercial package:** 222 Node.js tests, 360 independent Python scenarios / 1,812 assertions, and desktop/mobile Chromium examination. All use synthetic data. Direct Android/iOS local-file navigation has not been verified.

**Current market observations (2026-10-10):**
- Shopify documents payout-specific CSV exports: https://help.shopify.com/en/manual/payments/shopify-payments/payouts/view-details
- Stripe's payout filter on balance transactions applies to automatic payouts: https://docs.stripe.com/api/balance_transactions/retrieve
- A2X Shopify advertises entry pricing at $29/month: https://www.a2xaccounting.com/shopify/pricing
- Reconciler offers automated processor-to-bank matching from $29/month billed yearly: https://reconciler.co/
- Synder advertises paid accounting synchronization: https://synder.com/pricing/

**Strongest objection:** Existing software already matches payouts and deposits, integrates with accounting systems, and handles scenarios this offline tool does not. No claim of category novelty or validated customer demand.

**Proposed offer:** $29 one-time offline spot-check tool for small ecommerce operators/bookkeepers; pricing not validated. **No sales, revenue, buyer usage, traffic, or executable public release are asserted by this manifest.**

**Evidence boundary:** A SHA-256 receipt proves deterministic bytes and calculations, not that the records came from an authentic bank or that funds arrived. HOLD is a modeled contradiction, REVIEW means uncertainty, BOUNDED is only absence of contradictions under the declared model.

**Commercial test:** 20 qualified demonstrations within 14 days; continue only after 3 real-data examinations, 1 independently corroborated consequential finding, and 1 explicit $29 purchase request. Otherwise modify/abandon as described in the commercial package.

This branch contains research metadata only, not the commercial executable.