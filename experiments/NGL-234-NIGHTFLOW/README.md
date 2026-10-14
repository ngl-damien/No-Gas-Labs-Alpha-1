# NGL-234 NIGHTFLOW™ — research record

Date: 2026-10-14. Institution: No_Gas_Labs™. Product: offline hourly water-use anomaly examiner.

Positioning: A high water bill is a symptom. A leak is a diagnosis. Examine the evidence between them.

Engine: matched weekday-hour historical min/max envelopes, integer-gallon observed-hour excess intervals, 00:00–05:00 UTC persistent night-minimum screening, missing-evidence gate, integer-cent cost mapping, local JSON/CSV reports and SHA-256 input receipts. No leak or actual savings is proven by a model result.

Synthetic example: 168 comparable target hours; 2,856–3,192 gallons above historical envelopes; $45.70–$51.07 modeled cost at a declared $16/1,000 gallons; seven elevated nights. All fictional.

Verification: 14 Python test methods passed; 420 randomized JavaScript/Python comparisons with 0 disagreements; 360 independent pandas reference cases with 0 disagreements; 55 Chromium browser assertions across 1440/390/320 pixels passed; no external requests or browser errors observed. Direct mobile execution not verified.

Market: EPA WaterSense and SFPUC document water-meter leak-screening workflows. Alternatives include WINT, Alert Labs, Flume, and free DOE VERIFI. Proposed $39 one-time; market gate CONDITIONAL, evidence gate INTERNAL PASS / COMMERCIAL HOLD. No buyers, traffic, checkout, sales, or revenue evidenced.

The standalone executable is distributed separately; this research commit is not a hosted executable release.
