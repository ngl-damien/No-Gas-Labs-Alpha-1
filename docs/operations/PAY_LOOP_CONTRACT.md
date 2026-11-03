# Pay loop contract — S0→S8

Institution funds Founder via real artifacts, not pitch decks.

## States
- S0 ARTIFACT — finished digital good exists + SHA-256
- S1 CATALOGED — NGL catalog entry
- S2 DISTRIBUTED — exposed to qualified buyers
- S3 ENGAGED — attributable behavior
- S4 PURCHASED — payment evidence
- S5 DELIVERED — buyer received artifact
- S6 USED — post-delivery use/feedback
- S7 REPEATABLE — second comparable sale
- S8 SYSTEM — repeated positive economics

## Rails (configure out-of-band; never commit secrets)
- Stripe Connect endpoint + webhook verify signature
- Optional BTCPay / self-custodial path
- Split rule: Founder settlement account is the only production payee until DAO exists

## First SKU candidate
- Forge Nail bound to exact-head `8c2c953c` trusted-read work — catalog id pending recovery of #301 onto main ancestry
- Price test: $12 provisional (work-instance contract)

## Gate
No claim of S4+ without transaction id + receipt hash in Chronicle.
