# NGL-145 — DIRECTIVEFRONTIER (research record)

Date: 2026-10-10
Institution: No_Gas_Labs™
Status: internally tested offline product; commercial hypothesis unvalidated.
Positioning: "Work changed. Who authorized the bill?"
Proposed price: $49 one-time, subject to founder authorization and buyer validation.

## What exists
A deterministic, offline construction change-order authorization and billing examiner. It distinguishes owner directives from signed change orders, reconstructs authorization at invoice submission time, compares cumulative billing with approved change values, and exports SHA-256 receipts. It does not authenticate signatures or establish contractual rights.

Package SHA-256: `3b2e1f16f6088f3a3ef8a99ef979ca1786293fbaf7cd01f2e7d8cbf6b7d20c11`
Package: `NGL_145_DIRECTIVEFRONTIER_v1.zip` (held in NGL Catalog, not released through this repository).

## Verification
724 Node tests passed; 400 independent Python generated scenarios and 3,329 assertions; 51 browser assertions across 1440, 390 and 320px. No external browser requests or uncaught JS errors. Deterministic ZIP rebuild and extracted-package regression passed. Actual Android/iOS direct-file execution not verified.

Synthetic adversarial control: HOLD (4 blocking findings, 3 review findings).
Clean control: BOUNDED. Owner directive control: REVIEW. Fabricated internally consistent packet: BOUNDED, illustrating the source-authenticity boundary.

## Market observations
AIA G701 change order guidance: https://help.aiacontracts.com/hc/en-us/articles/1500009322061-Instructions-G701-2017-Change-Order
AIA G714 construction directive guidance: https://help.aiacontracts.com/hc/en-us/articles/1500009324821-Instructions-G714-2017-Construction-Change-Directive
Knowify change order management: https://knowify.com/construction-change-order-software/
Procore change orders: https://support.procore.com/products/online/user-guide/project-level/change-orders
JobTread pricing: https://www.jobtread.com/pricing

Market gate: conditional pass for buyer validation. Quality gate: internal pass within defined scope. Evidence gate: commercial HOLD.

## Distribution and revenue
Public research manifest only; executable not released on GitHub or a storefront. No customer outreach, independent demos, purchase requests, sales, deliveries or revenue evidenced.

## Test criterion
20 qualified independent demonstrations within 14 days of launch; continue only with three real-packet examinations, one independently corroborated consequential discrepancy and one explicit $49 purchase request. Modify for >50% input preparation over 15 minutes or a reproduced false BOUNDED; abandon standalone commercialization after 40 qualified exposures without meaningful use or purchase interest.

The model's assertion is not evidence of real-world state. No legal or financial claims are certified.
