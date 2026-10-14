# NGL-241 · DISPATCHBOUND™
2026-10-14 · No_Gas_Labs™ · Digital Product Experiment

**Positioning:** A savings claim is a number. Rebuild the dispatch behind it.

DISPATCHBOUND is a standalone offline 24/48-hour battery proposal claim examiner. It uses an exact dynamic program on a declared 0.1 kWh state-of-charge lattice, operator-supplied hourly loads and time-of-use tariffs, charging/discharging efficiencies, power limits, and identical opening/closing battery state. It compares a proposal's **same-window** claimed savings against the optimum *within this discrete model*. It exports hourly calculation witnesses and a SHA-256 fingerprint of the examined dossier.

**Internal examination (synthetic only):** 16 Python tests; 330 JavaScript/Python differential cases with zero disagreements; 160 independent brute-force small cases for each of two objectives; 63 Chromium assertions across 1440/390/320 px. Browser external requests: zero. No Android/iOS acceptance.

**Market gate:** conditional, high free-substitute risk. SAM and OpenSolar provide free, broader battery modeling; Energy Toolbase sells enterprise proposal modeling. Proposed test price: $49 one-time, not validated.

**Quality gate:** internal technical pass for the declared model only. The discretization is not a physical-world upper bound. No solar, export, demand charges, annualization, tariff authentication, or real hardware verification.

**Evidence gate:** internal synthetic mathematical pass, external validation hold. No independent buyers, purchase requests, traffic, sales, or revenue evidenced.

**Buyer experiment:** 20 qualified exposures, 4 independent trials, 2 explicit $49 requests, 1 independently corroborated consequential model-specific finding to continue. Modify for >25% setup time over 15 minutes or >20% unusable hourly records. Abandon standalone after 40 qualified exposures and 12 trials without credible purchase interest.

The full tested application and source package are retained in the No_Gas_Labs™ Catalog under NGL-241. This GitHub file is a research record, not a publicly hosted executable release.