# NGL-245 — ALLOWANCEORBIT™
No_Gas_Labs™ | Digital Product Experiment | 2026-10-14

**Status:** Offline standalone HTML and complete source package created and internally tested; external buyers, sales, and revenue unverified. This GitHub branch is a research record, not the downloadable executable.

## Problem
CPG promotion deductions may compete for the same shipped units across overlapping promotions. Simple per-promotion spreadsheets can double-count available units. An operator also needs to distinguish shipment-date eligibility, declared grace windows, non-stacking terms, documentary review, and incomplete exports.

## Mechanism
An integer min-cost residual-flow network maximizes supported promotion dollars across shipment-unit capacities, promotion unit caps, and deduction unit caps. All monetary values are integer cents. Two independently implemented engines (Python and JavaScript) agree across the tested cases. Separate exhaustive enumeration verifies small-case optimality.

## Fictional counterexample
Two overlapping promotions claim 180 units against 140 available shipment units. Declared rates are $2.50 and $3.00 per unit. Total claims: $490; global optimum support: $390; difference: $100. These are synthetic values, not an actual retailer overcharge.

## Evidence boundaries
Operator-reviewed source labels do not authenticate contracts, shipments, remittances, or payments. The allocation assumes exclusive non-stacking promotions and shipment-date eligibility. Unknown policies, incomplete ledgers, unreviewed sources, and ambiguous claim chronology prevent definitive conclusions. No recovery, entitlement, compliance, or customer-value claim is made.

## Gates
Market: CONDITIONAL (CPG deduction pain evidenced; strong free and paid substitutes).
Quality: internal mathematical/browser pass within defined scope; mobile-device execution not tested.
Evidence: internal calculation pass, external commercial HOLD.

## Commercial hypothesis
$79 one-time; twenty qualified CPG controllers/AR analysts; measure explicit $79 purchase requests per verified qualified exposure. No outreach or purchases observed.

## Reproducibility
The finished package includes: standalone HTML, Python and JS engines, eleven fictional investigations, CSV import/export, exact input SHA-256, automated unit/differential/exhaustive/browser tests, production recipe, failure ledger, and market-evidence register.

The complete downloadable package is delivered in the associated ChatGPT artifact. This repository branch does not currently contain the executable or test logs.
