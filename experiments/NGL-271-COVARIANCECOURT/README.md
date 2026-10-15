# NGL-271 — COVARIANCECOURT™
Research record · 2026-10-16

Offline, evidence-conditioned metrology covariance reviewer. Not calibration management software or an ISO/IEC 17025 certificate generator.

Mechanism: first-order GUM covariance propagation, positive-semidefinite correlation matrix validation, signed variance attribution, unassessed-pair HOLD, user-defined guard-band scenario, and independent Python/JavaScript implementations.

Synthetic shared-reference demo: two standard uncertainties u=0.4, sensitivities c=1, correlation rho=0.9. Correlated combined u=sqrt(0.608)=0.7797435476; naive independent RSS=sqrt(0.32)=0.5656854249; +37.8405%.

Internal verification: 500 Python/JS differential scenarios, 500 independent NumPy matrix-product checks, 100 duplicate-pair rejection cases, 33 Chromium browser assertions at 1440/390/320px, zero browser external requests or horizontal overflow.

Market Gate: HOLD. NIST Uncertainty Machine and Sandia Suncal are powerful free competitors. Price hypothesis: $49 one-time. No independent buyers, trials, checkout requests, sales or revenue observed.

Sources:
- https://uncertainty.nist.gov/
- https://sandialabs.github.io/suncal/
- https://www.nist.gov/pml/nist-technical-note-1297/nist-tn-1297-5-combined-standard-uncertainty
- https://ilac.org/publications-and-resources/ilac-guidance-series/

Commercial artifact SHA-256: 5f13abdef2357f4f79d346446a26c39a9a47d36e3540b05157b34eaaebb00871

The executable ZIP and HTML are archived in the NGL ChatGPT Library at /No_Gas_Labs™/Catalog/NGL-271-COVARIANCECOURT. This GitHub file is a research record, not a hosted executable release.
