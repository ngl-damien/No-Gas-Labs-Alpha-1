# NGL-329 IMAGEFORK™ — Digital Product Experiment (2026-10-18)

**Status:** standalone offline HTML and source ZIP built, case-level technical tests passed; external buyer validation **not established**. This repository record is a research and release receipt, **not** a hosted application or checkout.

## Market observation
Google Merchant Center Help announces a universal 500×500 product-image minimum effective January 31, 2027, with warnings in 2026. Shopify product media has a distinct 5000×5000/25MP and under-20MB limit. Google's image guidance also requires retention of metadata identifying AI-generated images.

Official sources:
- https://support.google.com/merchants/answer/6324350
- https://support.google.com/merchants/answer/12159030
- https://help.shopify.com/en/manual/products/product-media/product-media-types

## Mechanism
IMAGEFORK™ inspects actual local JPEG/PNG/WebP bytes, SHA-256 fingerprints, dimensions and selected metadata signals; evaluates current/future destination profiles; generates measured browser-local derivatives without upscaling; and solves exact weighted set cover for minimum-cost deliverables across declared profiles. It blocks metadata-stripping derivatives when a recognizable AI-source marker is detected. Marker absence **does not prove non-AI origin**.

## Preserved technical evidence
- 500 deterministic case-level optimizer investigations, 0 independent-oracle disagreements across Python and JavaScript.
- 100 invalid profile requests rejected; 8 boundary assertions.
- Four actual locally generated image fixtures checked independently; two derivative files reopened and verified by SHA-256.
- Chromium at 1440/390/320px: 33 interface assertions, no external requests or page errors.
- Browser tests used in-memory HTML because sandbox file navigation was blocked; customer-device file opening remains unverified.

Case-level Merkle root: `84c235899b568e20196531d5d223ba12d60542dbacc93f1aa57054c7d4833d13`

Standalone HTML SHA-256: `d2bad0e39d639b3c17f133848cb0e9c9fd713925d619f3ff45f02c4dba02ccb6`

Full ZIP SHA-256: `ad70a3a84875d21ccb90a563def4513dc86ce8330f9cbee7f0aaffc984bdf450`

## Commercial gate
**Price hypothesis:** $29 one-time. No independent trials, exposures, checkout requests, sales, traffic or revenue evidenced. Competes against free image compression and vendor-native tools; no superiority claim. Continue only after qualified external trials demonstrate a consequential catch, at least 25% reduction in correct preparation time, and explicit checkout interest.

## Evidence boundary
No guarantee of product identity, rights, color fidelity, accessibility, platform acceptance, URL crawlability or legal compliance. Source byte integrity is not provenance authenticity.

**Institution:** No_Gas_Labs™. **Authority:** Neophyte Founder™. AI-produced assertions are not independent evidence.
