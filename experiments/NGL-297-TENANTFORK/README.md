# NGL-297 — TENANTFORK™ (Research Record)

No_Gas_Labs™ · 2026-10-16 · experiment status: internal quality pass; market and external evidence on hold.

TENANTFORK is an offline counterfactual authorization-policy workbench. It enumerates declared principal × resource × action decisions, compares baseline/candidate policies with deny-overrides and tenant/owner scopes, preserves rule-level witnesses, flags cross-tenant grants, and synthesizes an exact minimum-cardinality regression witness suite for up to 14 coverage obligations.

**Controlled verification:** 31 Python unit tests; 500 synthetic investigations; 17,472 independent reference decisions with zero disagreements; 150 independent exact-suite checks with zero disagreements; 100/100 malformed cases rejected in both Python and JS; 50 Chromium UI assertions. A rule-ID/effect-only baseline missed decision changes in 195 of 500 constructed cases.

**Limit:** All models and identities are operator-supplied. No production authorization enforcement, real security incident, independent buyer trial, sale, or revenue was observed. $39 is an untested price hypothesis. Cerbos, Permit.io, OPA, AWS Access Analyzer and open-source authorization testers are substantial alternatives.

The downloadable executable and source package are delivered through the NGL-297 conversation and ChatGPT Library catalog, **not this GitHub research record**. No public executable release is claimed.
