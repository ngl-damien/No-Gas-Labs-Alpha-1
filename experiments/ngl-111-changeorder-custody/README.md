# NGL-111 — CHANGEORDER CUSTODY

No_Gas_Labs™ digital product experiment, 2026-10-09.

**Problem:** A contractor can record approved, performed change-order work and still fail to issue the corresponding invoice.

**Instrument:** Offline CSV audit: change orders → issued invoices → settled/refunded payments. Identifies missing invoice value, duplicate IDs, source-link contradictions, unreferenced approvals, and unsupported payment records. Uses HOLD / REVIEW / BOUNDED verdicts and SHA-256 source receipts.

**Demonstration (synthetic):** 4 change orders, 2 issued invoices, 1 settled payment. Recorded approved/performed invoice gap USD 270.00. Verdict HOLD (2 blocking, 3 review findings). This is **not** proven collectible revenue.

**Defined quality gate:** 48 named Node tests (including 656 generated scenarios), 44 Chromium desktop/mobile checks, 12 independent Python checks, 3 CLI verdict controls; reproducible package rebuild and extracted package retest.

**Market observations:** Contractor first-hand accounts of unbilled change orders (April 30 2026); COty free tier and $60/month Pro; QuickCO $29/month Solo; Buildwell $9/month Contractor. Strong free/cheap alternatives exist.

**Proposed price:** $19 one-time. Commercial hypothesis unverified. No independent traffic, buyer usage, purchase requests, sales, or revenue established.

**Status:** Full executable package created and archived in the No_Gas_Labs™ ChatGPT Library catalog; this public branch contains a research manifest, **not** the executable product. This distinction is intentional.

**Evidence boundary:** The tool cannot authenticate signatures, prove completion, establish legal collectibility, or verify that all relevant invoices were supplied. No output certifies payment entitlement.

Research sources:
- https://www.reddit.com/r/Contractor/comments/1szg9ak/rookie_mistake_w_cos/
- https://www.reddit.com/r/ConstructionMNGT/comments/1wdppsl/how_to_stop_scope_creep_before_it_eats_your_margin/
- https://www.cotychange.com/
- https://quickco.app/
- https://getbuildwell.com/

NGL invariant: A model's assertion is never sufficient evidence that the state it describes is correct.
