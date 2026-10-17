# NGL-299 BACKFILLFORK™ — Research & Evidence Record

2026-10-16 · No_Gas_Labs™ · Neophyte Founder™ decision authority retained.

## Status
Offline product built and independently tested in the ChatGPT artifact workspace. This branch contains a research record, **not** the executable application. Market gate HOLD; Quality gate INTERNAL PASS (bounded model); Evidence gate MODEL SUPPORTED / EXTERNAL HOLD.

## Mechanism
Declared append-only event-time and arrival-time records; ordered incremental extraction runs; inclusive watermark-minus-lookback selection; record-level missed/pending witnesses; exhaustive integer-hour search for minimum complete observed lookback; re-read cost frontier. No live connectors, production proof or completeness certification.

## Reproducible test receipt
31 Node unit tests; 500 synthetic investigations; 11,455 independent Python oracle checks with zero disagreements; 100/100 invalid inputs rejected; 47 Chromium assertions across 1440/390/320 px, zero external requests or page errors. The browser was loaded through Playwright set_content because direct local-file navigation was blocked.

Product ZIP SHA-256: `33721d6ba997baa72722f149781d50d512c551bdb52136fac248319a71cba64a`.
Standalone HTML SHA-256: `a74318e5da1be09e1f96af217af8eb2596afef429a25136b3d25a6f0bf00aad2`.

## Market context
Official dbt incremental documentation: https://docs.getdbt.com/docs/build/incremental-models
Airbyte incremental protocol: https://docs.airbyte.com/platform/understanding-airbyte/airbyte-protocol
Fivetran sync overview: https://fivetran.com/docs/core-concepts/syncoverview
Free alternative: https://www.datainterview.com/courses/data-pipelines/incremental-models

Positioning: offline second-opinion tool for append-only late-arrival investigations.
Price hypothesis: $39 one-time, **not validated**.

## Commercial evidence
Qualified exposures 0; independent trials 0; purchase requests 0; sales 0; revenue $0 evidenced. No public hosted executable or checkout established.

## Limitations
All inputs and source references operator-supplied. No updates, deletes, clock skew, paging, connector-specific semantics or destination writes modeled. No assertion of a production incident. No Gas Labs invariant: AI is labor; a model's assertion is never sufficient evidence.
