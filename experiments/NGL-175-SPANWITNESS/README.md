# NGL-175 — SPANWITNESS

**No_Gas_Labs™ | Research record | 2026-10-12**

**The JSON is valid. Where's the evidence?**

SPANWITNESS is an offline, dependency-free, proof-carrying extraction examiner. It tests whether AI-extracted literal quotes, numbers, and ISO dates are bound to exact source-text spans. It rejects missing evidence and contradictory offsets, flags repeated passages and semantic ambiguity, and generates a reproducible SHA-256 receipt. A span match is not proof of semantic truth or source authenticity.

**Internal examination:** 23 Node tests passed; 720 generated scenarios agreed with an independent Python oracle; 41 browser assertions passed at 1440/390/320 widths with zero external requests. Direct Android/iOS execution was not verified. Synthetic demo: HOLD (2 blocking, 3 review findings). No customer usage or revenue observed.

**Commercial hypothesis:** $29 one-time. Market gate conditional; quality gate scoped pass; commercial evidence HOLD. No checkout, executable public release, customer exposure, purchase request, or payment is established by this research commit.

**Research basis:** https://arxiv.org/abs/2602.12247 ; https://www.reddit.com/r/LLMDevs/comments/1u968mq/how_do_you_catch_semantically_wrong_extractions/ ; https://www.promptfoo.dev/pricing/

**Institutional invariant:** A model assertion is never sufficient evidence that the state it describes is correct.
