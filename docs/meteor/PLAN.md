# Meteor Commission Implementation Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans. The Founder explicitly selected autonomous parallel engineering; no additional approval rounds are required.

**Goal:** Turn Alpha1 into a usable local institutional environment with a playable world, one-button launch rehearsal, strict kernel, signed courier and measured Forge.

**Architecture:** Independent Node-built-in kernel, courier and Forge mechanisms integrate with a browser-compatible game model through a local HTTP service. All runtime state stays outside static assets. Package public source and a standalone playable workshop.

**Tech Stack:** Node24+, ES modules, native crypto/HTTP/Canvas, PythonPlaywright only for optional browser checks.

**Spec:** `docs/meteor/CONTRACT.md`.

## Global Constraints

Zero additional provider spending; Founder authority retained. No external publication, no invented provider replies, no dropped historical files. Existing59 tests remain passing. Each worker owns disjoint files; root handles integration and commits. No runtime keys or private state in distributions.

## Review Focus

- Conflicting retries and stale versions reject without extra rewards: kernel/model tests.
- Authenticated routing binds the exact provider, request and bytes; dispatch alone never completes: courier tests.
- Timeout and output saturation terminate real children; candidate work cannot rewrite constitutional files: Forge tests.
- Witness state/SSE/export must not expose drafts; atomic write failure preserves prior state: server tests.
- Narrow-phone input, keyboard focus, iframe forms/downloads and unrelated shared updates must keep working: browser journeys.

###1 Kernel

Files `src/institution/{kernel,ledger}.mjs`, `test/institution-kernel.test.mjs`. Implement and test exact scoped grant, five-stage transition, content-addressed receipts, revocation/expiry, replay/idempotency, durable serialized write/load. Run scoped RED→GREEN and report exportedAPI. Root reviews and integrates publication-byte preservation.

###2 Courier

Files `src/institution/courier.mjs`, `scripts/courier.mjs`, `test/institution-courier.test.mjs`. Build enrolled-key Ed25519 request/ack/reply protocol with durable seats/dissent/failure. Test wrong key/request/expiry, restart, identical retry. Execute actual local-worker fixture; external models remain unavailable.

###3 Forge

Files `src/forge/runner.mjs`, `scripts/forge.mjs`, `fixtures/forge/`, `test/forge-runner.test.mjs`. Copy safe source into candidate workspaces, execute allowlisted workload with bounded Node processes, compare correctness/runtime and preserve receipts. Observe passing/wrong/timeout behavior. No automatic integration or change of constitutional rules.

###4 Playable world

Files `game/{index.html,styles.css,client.mjs,world-view.mjs,model.mjs,artifacts.mjs}`, `test/game-{model,geometry}.test.mjs`. Use locked browsermodel/HTTP/launch APIs. RED→GREEN model/geometry; real phone/gamejourney. Controls enter usable creations, protect draft/history, persist private work, show real Witnesses.

###5 Root integration and delivery

Files `game/{server,launchpad}.mjs`, `scripts/{build-game,verify,verify-browser,meteor-demo}.mjs` or Pythonbrowser check, associated tests, package.json, README and recovery docs. Define meaningful tests first; create actual one-button launchstage with factual checks and portable exhibition. Atomically bind publication to strict kernel state. Run baseline+new suite, actual two-session browser, actual standalonefile and extracted-source build. Record durations with workload, verification costs and scope. Commit verified changes; save reusable startup configuration. Independent review precedes closure.
