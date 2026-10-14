# NGL-229 — RATCHETWITNESS™
Research status: local standalone application built and internally tested, commercial hypothesis unvalidated.

**Positioning:** Your peak demand and your billed demand are not necessarily the same.

RATCHETWITNESS is an offline declared-model examiner for electricity demand charges. It reconstructs current-month peak, historical demand ratchet, minimum billed demand, and modeled invoice charges. It flags missing meter intervals, absent history, and unverified source references.

**Synthetic demonstration:** September 2026: observed peak 105 kW; prior peaks 150, 130, 110 kW; fictional 80% three-month ratchet; $18/kW rate. Model bills 120 kW = $2,160. Fictional invoice claims 138 kW = $2,484, producing a $324 *declared-model discrepancy*, not an authenticated overcharge.

**Market research:** Garland Power & Light documents a 15-minute peak and seasonal historical ratchet. Gridium advertises paid energy management, while Wattif and Energy Solutions offer free demand-charge tools. This product does not implement Garland's seasonal rule. Price hypothesis $49 one-time, not tested.

**Evidence boundaries:** No tariff authentication, local-time/DST billing rules, seasonal eligibility, coincident demand, TOU demand, kVA/power factor, energy/taxes, meter multiplier, physical cap verification, or actual refund entitlement. All demonstrations are synthetic. No independent buyer trials, sales, or revenue observed.

**Research sources:**
- https://www.gpltexas.org/my-account/about-us/commercial-rates
- https://gridium.com/pricing/
- https://wattif.ai/tools/demand-charge-decoder
- https://energy-solutions.co/tools/industrial-electricity-bill-optimizer

This GitHub record is research documentation, not a public executable release or proof of commercial validation.
