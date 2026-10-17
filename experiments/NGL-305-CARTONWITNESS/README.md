# NGL-305 CARTONWITNESS™ — Research Record
Date: 2026-10-17
Institution: No_Gas_Labs™
Status: Offline product built and internally tested; commercial demand not validated.

## Mechanism
An offline, bounded parcel invoice reconstruction and stock-constrained carton allocation engine. It calculates dimensional and actual billable weight under operator-declared profiles, compares invoice line items against operator-declared rate bands, constructs source-level discrepancies, exhaustively searches feasible carton assignments with limited stock, and computes alternative-assignment witnesses.

## Independent technical evidence
- 40 Node unit assertions passed.
- 100/100 adversarial malformed inputs rejected.
- 500 synthetic investigations, 10,150 independent Python reference comparisons, 0 disagreements.
- 34 Chromium browser assertions at 1440/390/320 pixels, 0 runtime errors, 0 external requests.
- Fictional demo: 4 shipments; 2 invoice review leads; exact modeled carton allocation suggests $27.30 hypothetical combined freight-and-carton cost difference.
- All tariff rates in demo are fictional; results do not establish carrier errors or recoverable credits.

## Market and evidence gates
Market: HOLD — free DIM calculators and integrated paid parcel auditors compete; no customer demand proof.
Quality: INTERNAL PASS — finite model only.
Evidence: MODEL SUPPORTED / EXTERNAL HOLD — no verified live carrier contract, invoice, or warehouse fulfillment.
Proposed $49 one-time price is a hypothesis. Qualified exposures, sales and revenue evidenced: zero.

## Distribution boundary
This GitHub file is a research record, NOT an executable product publication. The standalone application and source package are delivered as ChatGPT artifacts and stored in the NGL Library catalog. Do not infer public hosting or checkout.

## Carrier policy caveat
2026 USPS guidance documents a 139 divisor above 1,728 cubic inches. UPS official pages differ in dimension-rounding language; the model requires an explicit operator-declared policy rather than pretending to certify one universal rule.
