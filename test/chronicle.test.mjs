import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { projectChronicle } from "../game/chronicle.mjs";
import { createWorld, applyAction } from "../game/model.mjs";
import { sourceObservationRequestMaterial } from "../game/research-records.mjs";

function fixture() {
  const world = {
    creations: [{
      id: "creation-observatory", title: "Source Observatory", version: 2,
      versions: [{ version: 1, title: "Source Observatory" }],
    }],
    events: [
      { id: "publish-v1", type: "publish", creationId: "creation-observatory", version: 1, actor: { id: "damien", name: "Damien", role: "founder" }, at: "2026-10-26T10:00:00.000Z" },
      { id: "report-v1", type: "report", creationId: "creation-observatory", version: 1, actor: { id: "witness-1", name: "Witness", role: "witness" }, at: "2026-10-26T10:05:00.000Z" },
      { id: "orphan-report", type: "report", creationId: "missing-creation", version: 9, actor: { id: "witness-2", name: "Second Witness" }, at: "2026-10-26T10:06:00.000Z" },
    ],
    reports: [
      { id: "report-record-1", creationId: "creation-observatory", version: 1, text: "The claim needs a source.", actor: { id: "witness-1", name: "Witness", role: "witness" }, at: "2026-10-26T10:05:00.000Z" },
    ],
    contributions: [],
    discoveries: [],
  };
  const kernel = {
    events: [
      { id: "observe-1", type: "observe", workId: "work-1", actor: "local-byte-verifier", at: "2026-10-26T10:04:00.000Z", passed: false },
      { id: "adjudicate-1", type: "adjudicate", workId: "work-1", actor: "damien", at: "2026-10-26T10:07:00.000Z", decision: "reject" },
    ],
    works: {},
  };
  return { world, kernel };
}

test("chronicle merges retained world and institutional events newest-first deterministically", () => {
  const { world, kernel } = fixture();
  const first = projectChronicle({ world, kernel });
  const second = projectChronicle({ world: structuredClone(world), kernel: structuredClone(kernel) });
  assert.deepEqual(first, second);
  assert.deepEqual(first.entries.map(entry => entry.id), [
    "kernel:adjudicate-1", "world:orphan-report", "world:report-v1",
    "kernel:observe-1", "world:publish-v1",
  ]);
});

test("reports remain visible against their exact retained version with the actual report text", () => {
  const { world, kernel } = fixture();
  const chronicle = projectChronicle({ world, kernel });
  const report = chronicle.entries.find(entry => entry.id === "world:report-v1");
  assert.equal(report.targetTitle, "Source Observatory");
  assert.equal(report.version, 1);
  assert.equal(report.targetAvailable, true);
  assert.equal(report.detail, "The claim needs a source.");
  assert.match(report.summary, /report.*not an adjudication/i);
});

test("orphaned reports remain visible and are not assigned an invented target", () => {
  const { world, kernel } = fixture();
  const orphan = projectChronicle({ world, kernel }).entries.find(entry => entry.id === "world:orphan-report");
  assert.equal(orphan.targetAvailable, false);
  assert.equal(orphan.targetTitle, "");
  assert.match(orphan.warning, /unavailable/i);
});

test("local observation failures are described as byte checks, not truth verdicts", () => {
  const { world, kernel } = fixture();
  const observation = projectChronicle({ world, kernel }).entries.find(entry => entry.id === "kernel:observe-1");
  assert.match(observation.summary, /Local byte check: failed/i);
  assert.match(observation.summary, /not a truth verdict or independent-human review/i);
});

test("projection is read-only and malformed retained slots remain visible", () => {
  const { world, kernel } = fixture();
  world.events.push(null);
  const beforeWorld = structuredClone(world);
  const beforeKernel = structuredClone(kernel);
  const chronicle = projectChronicle({ world, kernel });
  assert.equal(chronicle.malformed, 1);
  assert.ok(chronicle.entries.some(entry => entry.warning?.includes("Malformed retained event payload")));
  assert.deepEqual(world, beforeWorld);
  assert.deepEqual(kernel, beforeKernel);
});


test("non-array world and institutional event collections remain visible instead of appearing empty", () => {
  const { world, kernel } = fixture();
  world.events = { length: 1, 0: { id: "hidden-event", type: "report" } };
  kernel.events = "corrupt-event-list";

  const chronicle = projectChronicle({ world, kernel });
  assert.equal(chronicle.malformed, 2);
  assert.ok(chronicle.entries.some(entry => entry.id === "world:unclassified-events"));
  assert.ok(chronicle.entries.some(entry => entry.id === "kernel:unclassified-events"));
  assert.equal(chronicle.entries.some(entry => entry.id === "world:hidden-event"), false);
  assert.equal(
    chronicle.entries.filter(entry => entry.warning?.includes("Malformed retained event collection")).length,
    2
  );
});

test("accessor-backed event collections are rejected without executing their getters", () => {
  let worldReads = 0;
  let kernelReads = 0;
  const world = { reports: [], contributions: [] };
  const kernel = { works: {} };
  Object.defineProperty(world, "events", {
    enumerable: true,
    get() { worldReads += 1; throw new Error("world events getter executed"); }
  });
  Object.defineProperty(kernel, "events", {
    enumerable: true,
    get() { kernelReads += 1; throw new Error("kernel events getter executed"); }
  });

  const chronicle = projectChronicle({ world, kernel });
  assert.equal(worldReads, 0);
  assert.equal(kernelReads, 0);
  assert.equal(chronicle.malformed, 2);
  assert.ok(chronicle.entries.some(entry => entry.id === "world:unclassified-events"));
  assert.ok(chronicle.entries.some(entry => entry.id === "kernel:unclassified-events"));
});


test("report text is not attributed when actor identity metadata is missing on both records", () => {
  const { world, kernel } = fixture();
  world.events[1].actor = { name: "Witness" };
  world.reports[0].actor = { name: "Witness" };

  const report = projectChronicle({ world, kernel }).entries.find(entry => entry.id === "world:report-v1");
  assert.equal(report.detail, "");
  assert.match(report.warning, /complete actor, version, or timestamp/i);
});

test("report text is not arbitrarily selected when multiple records share the same metadata", () => {
  const { world, kernel } = fixture();
  world.reports.push({
    ...structuredClone(world.reports[0]),
    id: "report-record-ambiguous",
    text: "A different report with the same metadata.",
  });

  const report = projectChronicle({ world, kernel }).entries.find(entry => entry.id === "world:report-v1");
  assert.equal(report.detail, "");
  assert.match(report.warning, /attribution is ambiguous/i);
});


test("accessor-bearing event payloads are rejected without invoking top-level or nested getters", () => {
  const { world, kernel } = fixture();
  let getterCalls = 0;
  const badWorld = {
    id: "getter-world", type: "publish", version: 1,
    actor: { id: "witness-getter" }, at: "2026-10-26T10:08:00.000Z",
  };
  Object.defineProperty(badWorld, "creationId", {
    enumerable: true, configurable: true,
    get() { getterCalls += 1; return "creation-observatory"; },
  });
  Object.defineProperty(badWorld.actor, "name", {
    enumerable: true, configurable: true,
    get() { getterCalls += 1; return "Injected actor"; },
  });
  const badKernel = {
    id: "getter-kernel", type: "adjudicate", workId: "work-1",
    actor: "damien", at: "2026-10-26T10:09:00.000Z",
  };
  Object.defineProperty(badKernel, "decision", {
    enumerable: true, configurable: true,
    get() { getterCalls += 1; return "accept"; },
  });
  world.events.push(badWorld);
  kernel.events.push(badKernel);

  const chronicle = projectChronicle({ world, kernel });
  assert.equal(getterCalls, 0);
  assert.equal(chronicle.malformed, 2);
  assert.ok(chronicle.entries.some(entry => entry.id === "world:unclassified-3"));
  assert.ok(chronicle.entries.some(entry => entry.id === "kernel:unclassified-2"));
  assert.equal(chronicle.entries.some(entry => entry.id === "world:getter-world"), false);
  assert.equal(chronicle.entries.some(entry => entry.id === "kernel:getter-kernel"), false);
});

test("sparse retained event arrays fail closed without presenting partial history as complete", () => {
  const { world, kernel } = fixture();
  delete world.events[1];

  const chronicle = projectChronicle({ world, kernel });
  assert.equal(chronicle.malformed, 1);
  assert.ok(chronicle.entries.some(entry => entry.id === "world:unclassified-events"));
  assert.equal(chronicle.entries.some(entry => entry.id === "world:publish-v1"), false);
});

test("accessor-backed event array slots are rejected without executing the slot getter", () => {
  const { world, kernel } = fixture();
  let getterCalls = 0;
  Object.defineProperty(world.events, "1", {
    enumerable: true, configurable: true,
    get() { getterCalls += 1; return { id: "hidden-event", type: "publish" }; },
  });

  const chronicle = projectChronicle({ world, kernel });
  assert.equal(getterCalls, 0);
  assert.equal(chronicle.malformed, 1);
  assert.ok(chronicle.entries.some(entry => entry.id === "world:unclassified-events"));
  assert.equal(chronicle.entries.some(entry => entry.id === "world:hidden-event"), false);
});

test("hidden and symbol properties make an event payload visibly malformed", () => {
  const { world, kernel } = fixture();
  const hidden = { id: "hidden-event", type: "publish", actor: "damien", at: "2026-10-26T10:08:00.000Z" };
  Object.defineProperty(hidden, "unrecorded", { value: "not part of enumerable evidence", enumerable: false });
  const symbolic = { id: "symbol-event", type: "publish", actor: "damien", at: "2026-10-26T10:09:00.000Z" };
  symbolic[Symbol("unserialized")] = "hidden payload";
  world.events.push(hidden, symbolic);

  const chronicle = projectChronicle({ world, kernel });
  assert.equal(chronicle.malformed, 2);
  assert.ok(chronicle.entries.some(entry => entry.id === "world:unclassified-3"));
  assert.ok(chronicle.entries.some(entry => entry.id === "world:unclassified-4"));
  assert.equal(chronicle.entries.some(entry => entry.id === "world:hidden-event"), false);
  assert.equal(chronicle.entries.some(entry => entry.id === "world:symbol-event"), false);
});


test("revocation history exposes the recorded grant and exact work/version without a private work map", () => {
  const { world } = fixture();
  const kernel = {
    revision: 3,
    eventCount: 3,
    events: [
      {
        id: "claim-revoked-work",
        type: "claim",
        workId: "work-revoked",
        actor: "damien",
        at: "2026-10-26T10:00:00.000Z",
        action: "preserve-artifact-bytes",
        subject: { id: "creation-observatory", version: 1 },
      },
      {
        id: "authorize-revoked-work",
        type: "authorize",
        workId: "work-revoked",
        actor: "damien",
        at: "2026-10-26T10:01:00.000Z",
        grantId: "grant-revoked",
        executorId: "local-forge",
        observerId: "local-byte-verifier",
        scope: { subjectId: "creation-observatory", subjectVersion: 1, action: "preserve-artifact-bytes" },
      },
      {
        id: "revoke-work",
        type: "revoke",
        workId: "work-revoked",
        actor: "damien",
        at: "2026-10-26T10:02:00.000Z",
        grantId: "grant-revoked",
        reason: "The requested scope changed.",
      },
    ],
  };
  const before = { world: structuredClone(world), kernel: structuredClone(kernel) };
  const entry = projectChronicle({ world, kernel }).entries.find(item => item.id === "kernel:revoke-work");

  assert.equal(entry.eventType, "revoke");
  assert.equal(entry.creationId, "creation-observatory");
  assert.equal(entry.version, 1);
  assert.equal(entry.targetAvailable, true);
  assert.match(entry.detail, /Grant ID: grant-revoked/);
  assert.match(entry.detail, /Work scope: creation-observatory v1/);
  assert.match(entry.detail, /does not erase earlier history/);
  assert.match(entry.summary, /Reason: The requested scope changed/);
  assert.equal(entry.warning, "");
  assert.deepEqual({ world, kernel }, before);
});

test("revocation with missing work binding stays visible and warns instead of inventing scope", () => {
  const { world } = fixture();
  const kernel = {
    events: [{
      id: "revoke-unbound",
      type: "revoke",
      workId: "missing-work",
      actor: "damien",
      at: "2026-10-26T10:02:00.000Z",
      grantId: "grant-unknown",
      reason: "Scope cannot be resolved.",
    }],
  };
  const entry = projectChronicle({ world, kernel }).entries.find(item => item.id === "kernel:revoke-unbound");
  assert.equal(entry.creationId, "");
  assert.equal(entry.version, null);
  assert.equal(entry.targetAvailable, false);
  assert.match(entry.detail, /Work scope: not resolvable/);
  assert.match(entry.warning, /do not infer a missing grant or exact work\/version scope/);
});


test("a later claim cannot retroactively supply the scope of an earlier revocation", () => {
  const { world } = fixture();
  const kernel = {
    events: [
      {
        id: "revoke-before-claim",
        type: "revoke",
        workId: "work-out-of-order",
        actor: "damien",
        at: "2026-10-26T10:00:00.000Z",
        grantId: "grant-out-of-order",
        reason: "Claim is missing at this point in history.",
      },
      {
        id: "claim-after-revocation",
        type: "claim",
        workId: "work-out-of-order",
        actor: "damien",
        at: "2026-10-26T10:01:00.000Z",
        action: "preserve-artifact-bytes",
        subject: { id: "creation-observatory", version: 1 },
      },
    ],
  };
  const entry = projectChronicle({ world, kernel }).entries.find(item => item.id === "kernel:revoke-before-claim");
  assert.equal(entry.creationId, "");
  assert.equal(entry.version, null);
  assert.equal(entry.targetAvailable, false);
  assert.match(entry.detail, /Work scope: not resolvable/);
  assert.match(entry.warning, /do not infer a missing grant or exact work\/version scope/);
});


function revocationHistory({
  authorizationGrantId = "grant-revoked",
  revokeGrantId = "grant-revoked",
  authorizationScope = { subjectId: "creation-observatory", subjectVersion: 1, action: "preserve-artifact-bytes" },
  includeAuthorization = true,
  duplicateAuthorization = false,
} = {}) {
  const claim = {
    id: "claim-binding",
    type: "claim",
    workId: "work-binding",
    actor: "damien",
    at: "2026-10-26T10:00:00.000Z",
    action: "preserve-artifact-bytes",
    subject: { id: "creation-observatory", version: 1 },
  };
  const authorization = {
    id: "authorize-binding",
    type: "authorize",
    workId: "work-binding",
    actor: "damien",
    at: "2026-10-26T10:01:00.000Z",
    grantId: authorizationGrantId,
    executorId: "local-forge",
    observerId: "local-byte-verifier",
    scope: authorizationScope,
  };
  const revoke = {
    id: "revoke-binding",
    type: "revoke",
    workId: "work-binding",
    actor: "damien",
    at: "2026-10-26T10:02:00.000Z",
    grantId: revokeGrantId,
    reason: "The requested scope changed.",
  };
  const events = [claim];
  if (includeAuthorization) {
    events.push(authorization);
    if (duplicateAuthorization) events.push({ ...authorization, id: "authorize-binding-duplicate" });
  }
  events.push(revoke);
  return events;
}

function projectedRevocation(options) {
  const { world } = fixture();
  const kernel = { events: revocationHistory(options) };
  return projectChronicle({ world, kernel }).entries.find(entry => entry.id === "kernel:revoke-binding");
}

test("revocation scope stays unresolved without a prior authorization or when its grant ID differs", () => {
  for (const options of [
    { includeAuthorization: false, revokeGrantId: "grant-never-authorized" },
    { authorizationGrantId: "grant-authorized", revokeGrantId: "grant-other" },
  ]) {
    const entry = projectedRevocation(options);
    assert.equal(entry.creationId, "");
    assert.equal(entry.version, null);
    assert.equal(entry.targetAvailable, false);
    assert.match(entry.detail, /Work scope: not resolvable/);
    assert.match(entry.warning, /missing or mismatched/);
  }
});

test("revocation scope stays unresolved when the prior grant scope disagrees with the claim", () => {
  const entry = projectedRevocation({
    authorizationScope: { subjectId: "creation-other", subjectVersion: 1, action: "preserve-artifact-bytes" },
  });
  assert.equal(entry.creationId, "");
  assert.equal(entry.version, null);
  assert.equal(entry.targetAvailable, false);
  assert.match(entry.warning, /missing or mismatched/);
});

test("duplicate prior authorization records make a revocation binding ambiguous", () => {
  const entry = projectedRevocation({ duplicateAuthorization: true });
  assert.equal(entry.creationId, "");
  assert.equal(entry.version, null);
  assert.equal(entry.targetAvailable, false);
  assert.match(entry.detail, /Work scope: not resolvable/);
  assert.match(entry.warning, /ambiguous/);
});


test("a grant ID reused by another work makes the revocation scope globally ambiguous", () => {
  const { world } = fixture();
  const kernel = {
    events: [
      {
        id: "claim-work-a", type: "claim", workId: "work-a", actor: "damien",
        at: "2026-10-26T10:00:00.000Z", action: "preserve-artifact-bytes",
        subject: { id: "creation-observatory", version: 1 },
      },
      {
        id: "authorize-work-a", type: "authorize", workId: "work-a", actor: "damien",
        at: "2026-10-26T10:01:00.000Z", grantId: "grant-shared",
        scope: { subjectId: "creation-observatory", subjectVersion: 1, action: "preserve-artifact-bytes" },
      },
      {
        id: "claim-work-b", type: "claim", workId: "work-b", actor: "damien",
        at: "2026-10-26T10:02:00.000Z", action: "deploy",
        subject: { id: "creation-other", version: 1 },
      },
      {
        id: "authorize-work-b", type: "authorize", workId: "work-b", actor: "damien",
        at: "2026-10-26T10:03:00.000Z", grantId: "grant-shared",
        scope: { subjectId: "creation-other", subjectVersion: 1, action: "deploy" },
      },
      {
        id: "revoke-work-a", type: "revoke", workId: "work-a", actor: "damien",
        at: "2026-10-26T10:04:00.000Z", grantId: "grant-shared", reason: "Review binding.",
      },
    ],
  };
  const entry = projectChronicle({ world, kernel }).entries.find(item => item.id === "kernel:revoke-work-a");
  assert.equal(entry.creationId, "");
  assert.equal(entry.version, null);
  assert.equal(entry.targetAvailable, false);
  assert.match(entry.detail, /Work scope: not resolvable/);
  assert.match(entry.warning, /ambiguous/);
});


test("institutional stage scope follows the prior claim and warns on a conflicting event subject", () => {
  const { world } = fixture();
  const kernel = {
    events: [
      {
        id: "claim-stage-scope", type: "claim", workId: "work-stage-scope", actor: "damien",
        at: "2026-10-26T10:00:00.000Z", action: "preserve-artifact-bytes",
        subject: { id: "creation-observatory", version: 1 },
      },
      {
        id: "observe-conflicting-subject", type: "observe", workId: "work-stage-scope", actor: "local-byte-verifier",
        at: "2026-10-26T10:01:00.000Z", passed: true,
        subject: { id: "creation-other", version: 9 },
      },
    ],
  };
  const entry = projectChronicle({ world, kernel }).entries.find(item => item.id === "kernel:observe-conflicting-subject");
  assert.equal(entry.creationId, "creation-observatory");
  assert.equal(entry.version, 1);
  assert.equal(entry.targetAvailable, true);
  assert.match(entry.warning, /disagrees with the earlier claim/);
});

test("an institutional stage cannot establish scope from its own subject when no prior claim exists", () => {
  const { world } = fixture();
  const kernel = {
    events: [{
      id: "observe-self-declared-scope", type: "observe", workId: "work-unclaimed",
      actor: "local-byte-verifier", at: "2026-10-26T10:01:00.000Z", passed: true,
      subject: { id: "creation-observatory", version: 1 },
    }],
  };
  const entry = projectChronicle({ world, kernel }).entries.find(item => item.id === "kernel:observe-self-declared-scope");
  assert.equal(entry.creationId, "");
  assert.equal(entry.version, null);
  assert.equal(entry.targetAvailable, false);
  assert.match(entry.warning, /No valid earlier claim binds this institutional stage/);
});

test("authorization scope disagreement is visible while display scope remains anchored to the claim", () => {
  const { world } = fixture();
  const kernel = {
    events: [
      {
        id: "claim-authorize-scope", type: "claim", workId: "work-authorize-scope", actor: "damien",
        at: "2026-10-26T10:00:00.000Z", action: "preserve-artifact-bytes",
        subject: { id: "creation-observatory", version: 1 },
      },
      {
        id: "authorize-wrong-scope", type: "authorize", workId: "work-authorize-scope", actor: "damien",
        at: "2026-10-26T10:01:00.000Z", grantId: "grant-wrong-scope",
        scope: { subjectId: "creation-other", subjectVersion: 9, action: "deploy" },
      },
    ],
  };
  const entry = projectChronicle({ world, kernel }).entries.find(item => item.id === "kernel:authorize-wrong-scope");
  assert.equal(entry.creationId, "creation-observatory");
  assert.equal(entry.version, 1);
  assert.match(entry.warning, /authorization scope disagrees with the earlier claim/);
});


test("accessor-bearing report records are rejected without executing getters or attaching text", () => {
  const { world, kernel } = fixture();
  let getterCalls = 0;
  const record = {
    id: "report-record-hostile",
    creationId: "creation-observatory",
    version: 1,
    actor: { id: "witness-1", name: "Witness" },
    at: "2026-10-26T10:05:00.000Z",
  };
  Object.defineProperty(record, "text", {
    enumerable: true,
    get() { getterCalls += 1; return "Injected report text"; },
  });
  world.reports = [record];

  const chronicle = projectChronicle({ world, kernel });
  const report = chronicle.entries.find(entry => entry.id === "world:report-v1");
  assert.equal(getterCalls, 0);
  assert.equal(chronicle.malformed, 1);
  assert.equal(report.detail, "");
  assert.match(report.warning, /reports text collection is malformed/i);
  assert.ok(chronicle.entries.some(entry => entry.id === "world:unclassified-reports"));
});

test("accessor-backed report collection properties are rejected without invoking the getter", () => {
  const { world, kernel } = fixture();
  let getterCalls = 0;
  Object.defineProperty(world, "reports", {
    enumerable: true,
    configurable: true,
    get() { getterCalls += 1; return []; },
  });

  const chronicle = projectChronicle({ world, kernel });
  const report = chronicle.entries.find(entry => entry.id === "world:report-v1");
  assert.equal(getterCalls, 0);
  assert.equal(chronicle.malformed, 1);
  assert.equal(report.detail, "");
  assert.match(report.warning, /reports text collection is malformed/i);
});

test("sparse contribution collections fail closed rather than attaching partial text", () => {
  const { world, kernel } = fixture();
  world.events.push({
    id: "contribute-sparse-records",
    type: "contribute",
    creationId: "creation-observatory",
    version: 1,
    actor: { id: "contributor-1", name: "Contributor" },
    at: "2026-10-26T10:08:00.000Z",
  });
  world.contributions = new Array(1);

  const chronicle = projectChronicle({ world, kernel });
  const contribution = chronicle.entries.find(entry => entry.id === "world:contribute-sparse-records");
  assert.equal(chronicle.malformed, 1);
  assert.equal(contribution.detail, "");
  assert.match(contribution.warning, /contributions text collection is malformed/i);
  assert.ok(chronicle.entries.some(entry => entry.id === "world:unclassified-contributions"));
});

test("accessor-backed creation metadata is rejected without executing getters", () => {
  const { world, kernel } = fixture();
  let getterCalls = 0;
  Object.defineProperty(world, "creations", {
    enumerable: true,
    configurable: true,
    get() { getterCalls += 1; return []; },
  });

  const chronicle = projectChronicle({ world, kernel });
  const publication = chronicle.entries.find(entry => entry.id === "world:publish-v1");
  assert.equal(getterCalls, 0);
  assert.equal(chronicle.malformed, 1);
  assert.equal(publication.targetAvailable, false);
  assert.match(publication.warning, /artifact version is unavailable/i);
  assert.ok(chronicle.entries.some(entry => entry.id === "world:unclassified-creations"));
});


test("duplicate creation identities do not select an arbitrary target", () => {
  const { world, kernel } = fixture();
  world.creations.push({
    id: "creation-observatory",
    title: "Conflicting duplicate creation",
    version: 1,
    versions: [],
  });

  const chronicle = projectChronicle({ world, kernel });
  const publication = chronicle.entries.find(entry => entry.id === "world:publish-v1");
  assert.equal(publication.targetAvailable, false);
  assert.equal(publication.targetTitle, "");
  assert.match(publication.warning, /artifact version is unavailable/i);
});

test("duplicate historical version entries do not select an arbitrary title", () => {
  const { world, kernel } = fixture();
  world.creations[0].versions.push({
    version: 1,
    title: "Conflicting duplicate version",
  });

  const chronicle = projectChronicle({ world, kernel });
  const report = chronicle.entries.find(entry => entry.id === "world:report-v1");
  assert.equal(report.targetAvailable, false);
  assert.equal(report.targetTitle, "");
  assert.match(report.warning, /artifact version is unavailable/i);
});


test("collaborator responses and experiment challenges remain visible as untrusted chronicle objects", () => {
  const { world, kernel } = fixture();
  world.events.push(
    {
      id: "challenge-v1",
      type: "experiment-challenged",
      reportId: "report-v1",
      moonshotId: "moonshot-1",
      challengeType: "methodology",
      challengeText: "The report does not state the control condition.",
      actor: { id: "witness-2", name: "Second Witness" },
      at: "2026-10-26T10:07:00.000Z",
      evidenceCreationId: null,
      evidenceVersion: null,
    },
    {
      id: "collaborator-response-v1",
      type: "collaborator-response-recorded",
      responseId: "collaborator-response-1",
      role: "adversary",
      moonshotId: "moonshot-1",
      sourceEventIds: ["proposal-v1", "report-v1"],
      packetJson: "{}",
      packetReceipt: { algorithm: "sha256", digest: "a".repeat(64), size: 2 },
      responseText: "{\"challengeDraft\":\"Preserved dissent\"}",
      responseReceipt: { algorithm: "sha256", digest: "b".repeat(64), size: 38 },
      validationStatus: "rejected",
      validationReason: "RESPONSE_SCHEMA_OR_SCOPE_INVALID",
      validator: "ngl.collaborator-response.v1",
      actor: { id: "witness-2", name: "Second Witness" },
      at: "2026-10-26T10:08:00.000Z",
    },
  );
  const chronicle = projectChronicle({ world, kernel });
  const challenge = chronicle.entries.find(entry => entry.id === "world:challenge-v1");
  const response = chronicle.entries.find(entry => entry.id === "world:collaborator-response-v1");
  assert.equal(challenge.category, "DISSENT & CHALLENGE");
  assert.match(challenge.summary, /does not adjudicate/i);
  assert.equal(response.category, "GUILD HALL");
  assert.match(response.title, /REJECTED · PRESERVED/);
  assert.match(response.detail, /Packet SHA-256/);
  assert.match(response.detail, /Response SHA-256/);
  assert.match(response.warning, /untrusted text/i);
});

test("Source Observation notes remain visible as user-bound, explicitly unverified Chronicle objects", () => {
  const actor = { id: "damien", name: "Damien", role: "founder" };
  const creationId = "chronicle-source-observatory";
  const at = "2026-10-26T10:00:00.000Z";
  const note = {
    claim: "The model says the bridge is open.",
    sourceKind: "model-assertion",
    source: "Model output only; no source retrieved.",
    falsifier: "A direct inspection finds it closed.",
    uncertainty: "No independent observation.",
    nextTest: "Inspect the bridge."
  };
  const digest = createHash("sha256").update(sourceObservationRequestMaterial({
    actorId: actor.id, actorRole: actor.role, creationId, version: 1, ...note
  })).digest("hex");
  const world = {
    creations: [{
      id: creationId, kind: "observatory", title: "Source Observatory",
      version: 1, publishedAt: at, versions: []
    }],
    events: [
      { id: "publish-source", type: "publish", creationId, version: 1, actor, at },
      {
        id: "source-note", type: "source-observation-recorded", actor,
        at: "2026-10-26T10:01:00.000Z",
        observationId: "source-observation-" + digest, creationId, version: 1, ...note,
        originSchema: "ngl.source-observatory.v2", bindingMode: "USER_SELECTED",
        sourceRetrieval: "NOT_PERFORMED", independentVerification: "NOT_PERFORMED",
        modelAssertions: "LEADS_ONLY", execution: "NOT_EXECUTED",
        normalizedRecordDigest: digest
      }
    ],
    reports: [], contributions: [], discoveries: []
  };
  const entry = projectChronicle({ world, kernel: { events: [], works: {} } }).entries
    .find(item => item.id === "world:source-note");
  assert.equal(entry.category, "RESEARCH NOTE");
  assert.equal(entry.targetAvailable, true);
  assert.match(entry.warning, /Model assertions are leads only, not evidence/);
  assert.match(entry.warning, /export origin is not cryptographically established/);
  assert.match(entry.detail, /direct inspection finds it closed/);
});

test("source-observation challenges appear as linked dissent, not adjudication or evidence", () => {
  const { world, kernel } = fixture();
  world.events.push(
    {
      id: "source-note-event", type: "source-observation-recorded",
      observationId: "source-observation-1", creationId: "creation-observatory", version: 1,
      actor: { id: "damien", name: "Damien", role: "founder" },
      at: "2026-10-26T10:07:00.000Z", claim: "The bridge is open.",
    },
    {
      id: "source-challenge-event", type: "source-observation-challenged",
      challengeId: "challenge-1", observationId: "source-observation-1",
      creationId: "creation-observatory", version: 1,
      actor: { id: "witness-1", name: "Witness", role: "witness" },
      at: "2026-10-26T10:08:00.000Z",
      challengeType: "missing-evidence",
      challengeText: "No retrievable primary source is attached."
    },
    {
      id: "source-response-event", type: "source-observation-challenge-responded",
      responseId: "source-response-1", challengeId: "challenge-1",
      observationId: "source-observation-1", creationId: "creation-observatory", version: 1,
      actor: { id: "damien", name: "Damien", role: "founder" },
      at: "2026-10-26T10:09:00.000Z",
      responseText: "The note is a lead only; source retrieval remains outstanding."
    }
  );
  const entry = projectChronicle({ world, kernel }).entries.find(item => item.id === "world:source-challenge-event");
  assert.equal(entry.category, "DISSENT & CHALLENGE");
  assert.equal(entry.targetTitle, "Source Observatory");
  assert.equal(entry.targetAvailable, true);
  assert.match(entry.summary, /preserved a challenge/i);
  assert.match(entry.summary, /does not decide truth/i);
  assert.match(entry.detail, /No retrievable primary source is attached/);
  assert.match(entry.warning, /attributed dissent, not evidence, a verdict, or authority/i);
  const response = projectChronicle({ world, kernel }).entries.find(item => item.id === "world:source-response-event");
  assert.equal(response.category, "DISSENT & RESPONSE");
  assert.equal(response.targetTitle, "Source Observatory");
  assert.equal(response.targetAvailable, true);
  assert.match(response.summary, /original note and challenge remain intact/i);
  assert.match(response.detail, /source retrieval remains outstanding/i);
  assert.match(response.warning, /not independent evidence, adjudication, a truth verdict/i);
});


test("Commons conversation, private reports, and human moderation are first-class Chronicle entries", () => {
  const { world, kernel } = fixture();
  world.events.push(
    {
      id: "commons-post-1", type: "message-posted", messageId: "message-1", channel: "commons",
      text: "A statement can be retained without being treated as evidence.",
      actor: { id: "witness-1", name: "Witness", role: "witness" }, at: "2026-10-26T10:08:00.000Z",
    },
    {
      id: "commons-report-1", type: "message-reported", reportId: "report-1", messageId: "message-1",
      reason: "privacy", details: "A human should review this wording.",
      actor: { id: "witness-2", name: "Second Witness", role: "witness" }, at: "2026-10-26T10:09:00.000Z",
    },
    {
      id: "commons-hide-1", type: "message-moderated", moderationId: "moderation-1", messageId: "message-1",
      disposition: "hide", reason: "privacy",
      actor: { id: "damien", name: "Damien", role: "founder" }, at: "2026-10-26T10:10:00.000Z",
    },
  );
  const chronicle = projectChronicle({ world, kernel });
  const post = chronicle.entries.find(entry => entry.id === "world:commons-post-1");
  const report = chronicle.entries.find(entry => entry.id === "world:commons-report-1");
  const moderation = chronicle.entries.find(entry => entry.id === "world:commons-hide-1");
  assert.equal(post.category, "THE COMMONS");
  assert.match(post.summary, /Conversation only; not evidence/i);
  assert.match(post.detail, /retained without being treated as evidence/i);
  assert.match(report.category, /PRIVATE REPORT/);
  assert.match(report.summary, /not a verdict/i);
  assert.match(report.warning, /reporting actor and authenticated Founder/i);
  assert.match(moderation.category, /HUMAN MODERATION/);
  assert.match(moderation.summary, /original post and moderation history remain/i);
  assert.match(moderation.warning, /not historical authorship/i);
});


test("player-guild lifecycle and leadership handoffs remain visible without institutional authority", () => {
  const { world, kernel } = fixture();
  const semantics = "A player-guild handoff changes only the in-game guild role; it is not NGL institutional authority, evidence, XP or approval.";
  world.events = [
    {
      id: "guild-created-1", type: "guild-created", guildId: "guild-1",
      name: "Field Researchers", charter: "Compare observations and preserve dissent.",
      actor: { id: "damien", name: "Damien", role: "founder" },
      at: "2026-11-04T10:00:00.000Z", semantics
    },
    {
      id: "guild-joined-1", type: "guild-joined", guildId: "guild-1",
      actor: { id: "witness-1", name: "Witness", role: "witness" },
      at: "2026-11-04T10:01:00.000Z", semantics
    },
    {
      id: "guild-offered-1", type: "guild-leadership-transfer-offered", guildId: "guild-1",
      offerId: "guild-offer-1", recipientId: "witness-1", recipientRole: "witness",
      actor: { id: "damien", name: "Damien", role: "founder" },
      at: "2026-11-04T10:02:00.000Z", semantics
    },
    {
      id: "guild-declined-1", type: "guild-leadership-transfer-declined", guildId: "guild-1",
      offerId: "guild-offer-1",
      actor: { id: "witness-1", name: "Witness", role: "witness" },
      at: "2026-11-04T10:03:00.000Z", semantics
    },
    {
      id: "guild-offered-2", type: "guild-leadership-transfer-offered", guildId: "guild-1",
      offerId: "guild-offer-2", recipientId: "witness-1", recipientRole: "witness",
      actor: { id: "damien", name: "Damien", role: "founder" },
      at: "2026-11-04T10:04:00.000Z", semantics
    },
    {
      id: "guild-cancelled-2", type: "guild-leadership-transfer-cancelled", guildId: "guild-1",
      offerId: "guild-offer-2",
      actor: { id: "damien", name: "Damien", role: "founder" },
      at: "2026-11-04T10:05:00.000Z", semantics
    },
    {
      id: "guild-offered-3", type: "guild-leadership-transfer-offered", guildId: "guild-1",
      offerId: "guild-offer-3", recipientId: "witness-1", recipientRole: "witness",
      actor: { id: "damien", name: "Damien", role: "founder" },
      at: "2026-11-04T10:06:00.000Z", semantics
    },
    {
      id: "guild-transferred-3", type: "guild-leadership-transferred", guildId: "guild-1",
      offerId: "guild-offer-3", fromLeaderId: "damien", fromLeaderRole: "founder",
      actor: { id: "witness-1", name: "Witness", role: "witness" },
      at: "2026-11-04T10:07:00.000Z", semantics
    },
    {
      id: "guild-left-1", type: "guild-left", guildId: "guild-1",
      actor: { id: "damien", name: "Damien", role: "founder" },
      at: "2026-11-04T10:08:00.000Z", semantics
    },
    {
      id: "guild-disbanded-1", type: "guild-disbanded", guildId: "guild-1",
      actor: { id: "witness-1", name: "Witness", role: "witness" },
      at: "2026-11-04T10:09:00.000Z", semantics
    },
  ];
  const entries = projectChronicle({ world, kernel }).entries
    .filter(entry => entry.eventType.startsWith("guild-"));
  assert.deepEqual(entries.map(entry => entry.eventType), [
    "guild-disbanded", "guild-left", "guild-leadership-transferred",
    "guild-leadership-transfer-offered", "guild-leadership-transfer-cancelled",
    "guild-leadership-transfer-offered", "guild-leadership-transfer-declined",
    "guild-leadership-transfer-offered", "guild-joined", "guild-created"
  ]);
  assert.ok(entries.every(entry => entry.category === "GUILD HALL · PLAYER GUILDS"));
  assert.ok(entries.every(entry => /not proof of distinct humans/i.test(entry.warning)));
  assert.ok(entries.every(entry => /no NGL institutional authority/i.test(entry.warning)));
  const offered = entries.find(entry => entry.eventType === "guild-leadership-transfer-offered");
  const declined = entries.find(entry => entry.eventType === "guild-leadership-transfer-declined");
  const transferred = entries.find(entry => entry.eventType === "guild-leadership-transferred");
  assert.match(offered.summary, /until that member accepts/);
  assert.match(declined.summary, /declined the offer/);
  assert.match(transferred.summary, /accepted the in-game guild leader role/);
  assert.match(transferred.detail, /Previous leader: damien/);
  assert.match(entries.at(-1).title, /Field Researchers/);
  assert.match(entries.at(-1).detail, /Compare observations and preserve dissent/);
});


test("Forge Chronicle entries require a valid actor-owned earlier source and retain equipment changes",async()=>{
  const founder={id:"damien",name:"Damien",role:"founder"};
  const witness={id:"witness-forge",name:"Witness",role:"witness"};
  const t1="2026-11-05T12:00:00.000Z";
  const t2="2026-11-05T12:01:00.000Z";
  const t3="2026-11-05T12:02:00.000Z";
  const t4="2026-11-05T12:03:00.000Z";
  const created=createWorld({id:"chronicle-forge-world",founderName:"Damien",now:t1});
  const discovered=await applyAction(created,{type:"discover",locationId:"river"},witness,{now:t2});
  const source=discovered.world.events.at(-1);
  const forged=await applyAction(discovered.world,{type:"forge-field-item",slotId:"scouting",sourceEventId:source.id},witness,{now:t3});
  const item=forged.world.events.at(-1);
  const equipped=await applyAction(forged.world,{type:"equip-field-item",slotId:"scouting",sourceEventId:item.id},witness,{now:t4});
  const entries=projectChronicle({world:equipped.world}).entries;
  const forgeEntry=entries.find(entry=>entry.eventType==="field-item-forged");
  const equipEntry=entries.find(entry=>entry.eventType==="field-item-equipped");
  assert.ok(forgeEntry);
  assert.equal(forgeEntry.title,"Personal field item forged");
  assert.equal(forgeEntry.warning,"");
  assert.match(forgeEntry.detail,/Surveyor/);
  assert.ok(equipEntry);
  assert.equal(equipEntry.category,"FORGE · EQUIPMENT");
  assert.equal(equipEntry.warning,"");

  const tampered=structuredClone(equipped.world);
  const tamperedForge=tampered.events.find(event=>event.type==="field-item-forged");
  tamperedForge.sourceEventId="missing-source";
  const tamperedEntry=projectChronicle({world:tampered}).entries.find(entry=>entry.eventType==="field-item-forged");
  assert.equal(tamperedEntry.title,"Unvalidated field-item event");
  assert.match(tamperedEntry.warning,/missing or ambiguous/i);
});

test("Forge Chronicle retains offers, cancellations and accepted ownership without erasing creator provenance",async()=>{
  const founder={id:"damien",name:"Damien",role:"founder"};
  const witness={id:"witness-forge-transfer",name:"Witness",role:"witness"};
  const t1="2026-11-05T13:00:00.000Z";
  const t2="2026-11-05T13:01:00.000Z";
  const t3="2026-11-05T13:02:00.000Z";
  const t4="2026-11-05T13:03:00.000Z";
  const t5="2026-11-05T13:04:00.000Z";
  const t6="2026-11-05T13:05:00.000Z";
  const t7="2026-11-05T13:06:00.000Z";
  const created=createWorld({id:"chronicle-forge-transfer-world",founderName:"Damien",now:t1});
  const discovered=await applyAction(created,{type:"discover",locationId:"river"},witness,{now:t2});
  const source=discovered.world.events.at(-1);
  const forged=await applyAction(discovered.world,{type:"forge-field-item",slotId:"scouting",sourceEventId:source.id},witness,{now:t3});
  const forgeEvent=forged.world.events.at(-1);
  const offered=await applyAction(forged.world,{type:"offer-field-item-transfer",itemEventId:forgeEvent.id,recipientId:founder.id,recipientRole:founder.role},witness,{now:t4,allowTransfers:true});
  const offerEvent=offered.world.events.at(-1);
  const accepted=await applyAction(offered.world,{type:"accept-field-item-transfer",offerId:offerEvent.offerId},founder,{now:t5,allowTransfers:true});
  const transferEvent=accepted.world.events.at(-1);
  const returnedOffer=await applyAction(accepted.world,{type:"offer-field-item-transfer",itemEventId:forgeEvent.id,recipientId:witness.id,recipientRole:witness.role},founder,{now:t6,allowTransfers:true});
  const returnOfferEvent=returnedOffer.world.events.at(-1);
  const cancelled=await applyAction(returnedOffer.world,{type:"cancel-field-item-transfer",offerId:returnOfferEvent.offerId},founder,{now:t7,allowTransfers:true});
  const entries=projectChronicle({world:cancelled.world}).entries;
  const forgeEntry=entries.find(entry=>entry.id===`world:${forgeEvent.id}`);
  const offerEntry=entries.find(entry=>entry.id===`world:${offerEvent.id}`);
  const transferEntry=entries.find(entry=>entry.id===`world:${transferEvent.id}`);
  const cancelEntry=entries.find(entry=>entry.id===`world:${cancelled.world.events.at(-1).id}`);
  assert.equal(forgeEntry.warning,"");
  assert.match(forgeEntry.summary,/ownership can change only through a retained offer/i);
  assert.equal(offerEntry.title,"Field-item transfer offered");
  assert.equal(offerEntry.warning,"");
  assert.match(offerEntry.summary,/not an ownership change/i);
  assert.equal(transferEntry.title,"Field-item ownership transferred");
  assert.equal(transferEntry.warning,"");
  assert.match(transferEntry.detail,/witness-forge-transfer/);
  assert.match(transferEntry.detail,/damien/);
  assert.equal(cancelEntry.title,"Field-item transfer cancelled");
  assert.equal(cancelEntry.warning,"");
  assert.match(cancelEntry.summary,/ownership remains unchanged/i);

  const tampered=structuredClone(accepted.world);
  const tamperedTransfer=tampered.events.find(event=>event.type==="field-item-transferred");
  tamperedTransfer.actor={...witness};
  const tamperedEntries=projectChronicle({world:tampered}).entries;
  const retainedForge=tamperedEntries.find(entry=>entry.id===`world:${forgeEvent.id}`);
  const rejectedTransfer=tamperedEntries.find(entry=>entry.id===`world:${transferEvent.id}`);
  assert.equal(retainedForge.warning,"","a later invalid transfer must not erase the original forge/source history");
  assert.match(rejectedTransfer.warning,/valid designated-recipient offer chain/i);
});



test("Chronicle does not attach retained report or contribution text across a same-ID role boundary", () => {
  const { world, kernel } = fixture();
  const sharedId = "chronicle-role-collision";
  const reportAt = "2026-10-26T10:10:00.000Z";
  const contributionAt = "2026-10-26T10:11:00.000Z";

  world.events.push(
    {
      id: "report-role-collision",
      type: "report",
      creationId: "creation-observatory",
      version: 1,
      actor: { id: sharedId, name: "Founder session", role: "founder" },
      at: reportAt
    },
    {
      id: "contribution-role-collision",
      type: "contribute",
      creationId: "creation-observatory",
      version: 1,
      actor: { id: sharedId, name: "Founder session", role: "founder" },
      at: contributionAt
    }
  );
  world.reports.push({
    id: "report-role-collision-record",
    creationId: "creation-observatory",
    version: 1,
    text: "Witness-only report text must not be attached.",
    actor: { id: sharedId, name: "Witness session", role: "witness" },
    at: reportAt
  });
  world.contributions.push({
    id: "contribution-role-collision-record",
    creationId: "creation-observatory",
    version: 1,
    text: "Witness-only contribution text must not be attached.",
    actor: { id: sharedId, name: "Witness session", role: "witness" },
    at: contributionAt
  });

  const entries = projectChronicle({ world, kernel }).entries;
  const report = entries.find(entry => entry.id === "world:report-role-collision");
  const contribution = entries.find(entry => entry.id === "world:contribution-role-collision");

  assert.equal(report.detail, "");
  assert.match(report.warning, /corresponding text record is absent/i);
  assert.equal(contribution.detail, "");
  assert.match(contribution.warning, /corresponding text record is absent/i);
});
