# NGL-186 — METERSEAM

Research record — 2026-10-12. No_Gas_Labs™ / Digital Product Experiment 186.

**Problem.** Usage events, metering aggregates and invoice lines are not the same observation. A recorded event can be retried, ingested after an invoice cutoff, or canceled; invoice amounts are calculated under pricing terms. An assertion of invoice accuracy is not independent evidence.

**Product.** METERSEAM is an offline retrospective examiner with source+id event deduplication, pre-close cancellation replay, late-ingestion quarantine, close-time summary comparison, invoice quantity and rate checks, source-linked contradiction witnesses, SHA-256 receipts and an independently implemented Python oracle. It is not a billing engine, invoice certification or source-authentication service.

**Market observations.** Stripe's official Billing API documentation describes asynchronously aggregated meter event summaries and event cancellation adjustments (https://docs.stripe.com/api/versioning). OpenMeter documents source+id deduplication (https://openmeter.io/docs/metering/events/usage-events) and buffering/replay (https://openmeter.io/docs/collectors/buffer). Lago (https://getlago.com/), OpenMeter (https://openmeter.io/) and Metronome (https://metronome.com/) are significant incumbents, including free/open-source competition. These observations establish workflow complexity, **not** a customer demand signal.

**Commercial hypothesis.** $49 one-time; independent SaaS billing consultants and AI/API product operators. Preregistered test: 20 qualified exposures in 14 active outreach days; continue only if >=3 independent examinations, >=1 externally corroborated consequential discrepancy and >=1 explicit $49 purchase request. No buyer exposure, purchase request, sales or revenue evidenced.

**Scope and limitations.** Only UTC, SUM, single USD rate per 1000 units with included units, one invoice line per customer/meter, and cancellation events. Operator-provided records and completeness are not authenticated. BOUNDED means no supported contradiction within the supplied model.

**Status.** Self-contained product, CLI, reference oracle, synthetic fixtures and QA package prepared. This GitHub research record is not an executable public release. Product files and tests are in the NGL Catalog package, not asserted present in this repository.