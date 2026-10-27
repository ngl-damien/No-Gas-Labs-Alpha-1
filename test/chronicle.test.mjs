import test from "node:test";
import assert from "node:assert/strict";
import { projectChronicle } from "../game/chronicle.mjs";

function fixture() {
  const world = {
    creations: [{
      id: "creation-observatory", title: "Source Observatory", version: 2,
      versions: [{ version: 1, title: "Source Observatory" }],
    }],
    events: [
      { id: "publish-v1", type: "publish", creationId: "creation-observatory", version: 1, actor: { id: "damien", name: "Damien" }, at: "2026-10-26T10:00:00.000Z" },
      { id: "report-v1", type: "report", creationId: "creation-observatory", version: 1, actor: { id: "witness-1", name: "Witness" }, at: "2026-10-26T10:05:00.000Z" },
      { id: "orphan-report", type: "report", creationId: "missing-creation", version: 9, actor: { id: "witness-2", name: "Second Witness" }, at: "2026-10-26T10:06:00.000Z" },
    ],
    reports: [
      { id: "report-record-1", creationId: "creation-observatory", version: 1, text: "The claim needs a source.", actor: { id: "witness-1", name: "Witness" }, at: "2026-10-26T10:05:00.000Z" },
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
