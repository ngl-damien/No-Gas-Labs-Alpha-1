# Forensic Audit + Build MMORPG Steering — GitHub Side — Agent 2 6ac307e1e9bc8191ae21d22f94743802

This file is read by the hourly agent each run — GitHub side steering.

## Mandatory run evidence
Follow `docs/operations/hourly-agents/HEARTBEAT_PROTOCOL.md` on every invocation. At start, update `docs/operations/hourly-agents/heartbeats/6ac307e1e9bc8191ae21d22f94743802.json` to `running`; at completion update it to `completed` with truthful outcome, timestamps, summary, verification, and blocker. Commit both transitions. Never invent a run or completion. If no code change is warranted, record `no_change` and explain why. If interrupted, leave the record running so the monitor can flag it.

Current directive:

- Fresh inventory must note 100 cap hit min not complete — 403 rate limit after 30 repos — 93 accessible vs 95 claim delta 2 unreconciled — 11 public 82 private 65 not archived 28 archived — 100 open PRs 91 draft 9 ready
- PR collision analysis: #301 8c2c953c +123/-2 should supersede #300 divergent +97/-2 — close duplicate via reviewed non-destructive reconciliation not via deletion
- Authority audit: src/authority/decision.js trusts caller-supplied verification?.valid — confirmed — must be fixed with live signed-verifier verifyFounderDecision in-process — negative tests required — docs/authority/founder.pub.json confirmed absent on main — spec aspiration
- MMORPG: world locations embody real institutional functions — Forge real artifacts — Founder Gate genuine authority not decorative — Chronicle what actually happened — quests verifiable objectives — skills inventory from demonstrated activity — deterministic reconstructable — mobile-first Android unreliable-connectivity recovery important
- World visual: RuneScape / Endless Online inspired top-down tile walkable pixel-art buildings — world primary interface not SaaS dashboard with game skin
- First playable location: Forge — retained owned field items from #298 already implements actor-owned inventory + Character Sheet projection + Chronicle projection — boundaries enforced no XP transfer truth authority service-restart persistence — closest to functional — verify via exact-head workflow runs
- Smallest integration: PR #301 receipt → Forge → Gate → verify vs enrolled key → inventory/Chronicle — one coherent integration not three disconnected prototypes
