# Founder Gate service

`src/institution/founder-gate.mjs` wraps the existing durable decisions core without changing its authority, persistence, replay, or expiry rules. The repository proposal remains an offline document. Loading the proposal, constructing the service, and requesting status never activate a policy or create a decision.

```js
const proposal = await loadQualificationProposal({ root: repositoryRoot });
const gate = createFounderGate({ decisions, proposal, now: Date.now });
const page = await gate.status(hostAuthenticatedActor, { ready, blockedReason });
const activated = await gate.activate(hostAuthenticatedActor);
const decided = await gate.choose(hostAuthenticatedActor, {
  expectedRevision: activated.revision,
  requestId: uniqueRequestId,
  action: 'APPROVE', // or DEFER / REJECT; no default action
});
```

The host authenticates every actor, enforces actual HTTPS readiness before writes, and serializes writes to the decision store. An actor contains `id`, `role`, and an optional bounded `name`; the wrapper forwards only `id` and `role` to the core. Activation and disposition require exactly `id: 'damien'` with `role: 'founder'`. A caller-supplied identity object is not authentication. Witness and evaluator views omit private evaluation bytes, receipts, risks, rollback, and proposed effect. Neither can activate or choose.

`status()` returns `ngl.founder-gate-page.v1`, server UTC time, the intended 600,000 ms review window, viewer, readiness information, the configured proposal, the matching decision or `null`, and three explicit choices. The prepared ceremony is Inaugural Founders Day, October 18, 2026, in `America/Chicago`, at Carter Lake, Iowa. The location is the Founder-designated venue; it is not a geolocation verification. After activation, the core may durably observe expiry during status requests. This records elapsed time and never records Founder intent.

The first successful activation selects `founder-gate:qualification-2026-10-18-ten-minute` with the basis of the Founder's ten-minute qualification request of October 18, 2026, then creates the configured immutable proposal. The clock starts only when the core commits proposal creation. Repeating activation returns that same decision, including its original deadline and terminal or expired state. It never resets a deadline or allocates another decision ID. Before returning or accepting a disposition, the wrapper checks the existing proposal's exact bytes and scope and confirms that its captured policy and deadline interval are ten minutes. Conflicting proposals or intervals fail with `GATE_CONFLICT`.

The decisions core captures whichever policy is current at creation. Its exact retry of an older policy ID returns that historical policy without selecting it again. If a partial activation left the Gate policy in history but another policy has since become current, the wrapper fails closed before creation. The host's serialized writes must cover the entire activation operation, and other writers must not bypass that boundary.

This qualification policy does not revise a prior first-machinery policy or its 24-hour decisions. Core policy selection is global for subsequent creations. Future unrelated decisions must explicitly select their own applicable Founder-authorized policy; they must not inherit the qualification interval by accident. Already-created decisions retain their captured policy and deadline.

`choose()` accepts exactly `expectedRevision`, `requestId`, and one of `APPROVE`, `DEFER`, or `REJECT`; the decision ID comes from server configuration. The core enforces exact request retries, request-ID conflicts, stale revisions, terminal decisions, expiry at deadline equality, and durable recovery. `APPROVE` records authorization for controlled external specialist review only. `DEFER` requires further hardening; `REJECT` rejects the present qualification. None deploys, publishes, transfers authority, automatically promotes, or extends a clock. An expired decision has no default approval.

`loadQualificationProposal({ root })` reads only the fixed `docs/institution/qualification/FOUNDER-DECISION-PROPOSAL.json` and `REPORT.md`. It rejects alternate report paths, symlink components, nonregular files, oversized manifest/report data, invalid UTF-8, changed manifest shape, and a receipt that does not match the actual report bytes. Limits are 64 KiB for the manifest and 1 MiB for the report. It returns the manifest decision ID, fixed qualification title, copied risks and rollback, verified evaluation bytes/receipt, and a fixed review-only proposed effect. It does not read keys, configure a server, change the offline manifest, or activate a decision.

Run `node --test test/founder-gate-service.test.mjs` for controlled-clock, temporary-store service checks, and `npm test` for the repository suite. The fixtures alone activate clocks; they do not configure an operational host or public URL.
