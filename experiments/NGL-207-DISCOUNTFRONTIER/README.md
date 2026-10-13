# NGL-207 DISCOUNTFRONTIER™ — research and release evidence

Neophyte Founder™: Damien Featherstone · No_Gas_Labs™ · 2026-10-13

## Product
Offline early-payment discount portfolio optimizer. The best invoice discount is not always the best portfolio.

One-day budget = cash available − reserve − protected obligations. Deterministic branch-and-bound selects the feasible invoice set maximizing nominal discount minus user-declared simple carry cost. A greedy comparator, five-point liquidity frontier, stress-APR scenario, independent feasibility audit and canonical SHA-256 receipt expose assumptions and search limits.

## Tested locally
- Python automated tests: 16 passed.
- Independent JavaScript/Python randomized scenarios: 460, zero disagreements.
- Independent brute-force small-case oracles: 130, zero objective disagreements.
- SHA-256 cross-language reference strings: 304, zero disagreements.
- Chromium 1440/390/320 viewports: no uncaught errors, no external requests, no body overflow.
- 40-invoice stress: 80,000-node cap reached; REVIEW, not false optimality.
- Deterministic 40-file ZIP, SHA-256: 2260fce2e48688aeb117fb1b6c5bfde0d8720012442ab77378da94a711378945

## Boundaries
No bank access, actual supplier authentication, payment execution, proof of actual savings, customer trial or revenue. Direct Android/iOS file execution not verified. Commercial $49 price is a hypothesis.

## Distribution
Executable HTML and complete ZIP delivered in ChatGPT and archived to the NGL Catalog Library. This branch is a research record, not a publicly verified executable release. Market and commercial gates remain conditional/hold.
