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
