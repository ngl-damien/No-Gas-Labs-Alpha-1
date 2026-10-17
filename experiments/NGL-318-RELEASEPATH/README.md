# NGL-318 — RELEASEPATH™

No_Gas_Labs™ Digital Product Experiment, 2026-10-17.

RELEASEPATH is a bounded post-deployment digital-product integrity verifier. It compares a declared static release page and CTA with the actual hosted asset bytes, SHA-256, size, media type, and ZIP integrity; reports PASS/FAIL/UNKNOWN and point-in-time regressions. A generated static release page complements NGL-317 RECEIPTSHELF, whose verification stops at local files.

## Market observations
- Free link checkers [Lychee](https://github.com/lycheeverse/lychee) and [Linkinator](https://github.com/JustinBeckwith/linkinator) are strong substitutes. Generic link checking was rejected.
- [Checkly](https://www.checklyhq.com/pricing/) advertises a free Hobby monitoring tier; [UptimeRobot](https://uptimerobot.com/pricing/) advertises free uptime monitoring. RELEASEPATH is not a monitoring service.
- CSV migration preflight was rejected after checking catalog overlap with NGL-209 and NGL-167.
- Differentiation is the page → visible static CTA → exact payload chain. Commercial demand is unproven.

## Tests
- 14 Python unit tests passed.
- 500 seeded synthetic HTTP investigations matched independently declared fixture outcomes; an HTTP-status-only baseline falsely passed 223 defective cases.
- 100 invalid manifest paths rejected.
- 240 browser portable SHA-256 vectors matched Node crypto.
- 27 Chromium assertions passed at 1440/390/320px; browser navigation was blocked so HTML content injection was used for UI tests.
- Ten existing NGL-317 HTML demos passed a local HTTP check; one silent byte mutation and one broken CTA each triggered one failure.

## Gates
Market CONDITIONAL/HOLD; Quality INTERNAL PASS; Evidence BOUNDED TECHNICAL SUPPORT / EXTERNAL HOLD. Price hypothesis $29 one-time. No independent buyer trials, checkout, public deployment, traffic, sales, or revenue evidenced.

The executable, source, tests, receipts, and production recipe are in the NGL Catalog artifact package, not in this GitHub research README. No GitHub-hosted executable is claimed.
