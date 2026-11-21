import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { projectChronicle, resolveWorldChronicleSnapshotState } from "../game/chronicle.mjs";
import { institutionActivityCount, institutionDestinationsForEvent } from "../game/world-view.mjs";
import { projectCharacter, findRetainedPublicationEventId } from "../game/character-sheet.mjs";
import { createWorld, applyAction } from "../game/model.mjs";
import { buildGitHubSourceArchiveBody, GITHUB_SOURCE_ARCHIVE_INTENT_PREFIX } from "../game/artifacts.mjs";
import { sourceObservationRequestMaterial, SOURCE_PREDICATE_PUBLIC_RETENTION_ACK_VERSION } from "../game/research-records.mjs";

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

const contrastFounder = Object.freeze({ id: "chronicle-founder", name: "Founder", role: "founder" });
const contrastWitness = Object.freeze({ id: "chronicle-witness", name: "Witness", role: "witness" });
const contrastRepository = "ngl-damien/No-Gas-Labs-Alpha-1";
const contrastBytes = Buffer.from("NGL_CHRONICLE_PRESENT\nA retained byte-predicate fixture.\n", "utf8");
let contrastClock = Date.parse("2026-11-17T08:00:00.000Z");
const contrastTick = () => new Date(contrastClock += 1000).toISOString();
const contrastSha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const contrastGitBlobSha = bytes => createHash("sha1")
  .update(Buffer.concat([Buffer.from("blob " + bytes.length + "\0", "utf8"), bytes]))
  .digest("hex");

async function publishChronicleSource(world, { commitSha, path }) {
  const capturedAt = contrastTick();
  const digest = contrastSha256(contrastBytes);
  const capture = {
    schema: "ngl.github-source-capture.v1",
    integrityStatus: "hashes-match",
    repository: contrastRepository,
    commitSha,
    path,
    permalink: "https://github.com/" + contrastRepository + "/blob/" + commitSha + "/" + path,
    captureId: JSON.stringify([contrastRepository, commitSha, path, digest]),
    gitBlobSha: contrastGitBlobSha(contrastBytes),
    sha256: digest,
    size: contrastBytes.length,
    text: contrastBytes.toString("utf8"),
    bytesBase64: contrastBytes.toString("base64"),
    fetchedAt: capturedAt,
    capturedAt,
    retrievalMode: "server-rechecked"
  };
  const html = await buildGitHubSourceArchiveBody(capture);
  const draft = await applyAction(world, {
    type: "draft",
    kind: "custom",
    title: "Chronicle source contrast fixture",
    intent: GITHUB_SOURCE_ARCHIVE_INTENT_PREFIX + " test-only fixture",
    html
  }, contrastFounder, { now: contrastTick() });
  const published = await applyAction(draft.world, {
    type: "publish",
    draftId: draft.result.draftId,
    expectedVersion: 0
  }, contrastFounder, { now: contrastTick() });
  return {
    world: published.world,
    archive: {
      creationId: published.result.creationId,
      version: published.result.version,
      sha256: digest,
      size: contrastBytes.length
    }
  };
}

async function republishChronicleSource(world, archive) {
  const repaired = await applyAction(world, {
    type: "repair",
    creationId: archive.creationId,
    expectedVersion: archive.version,
    intent: GITHUB_SOURCE_ARCHIVE_INTENT_PREFIX + " Retain the same pinned source capture as a new published version."
  }, contrastFounder, { now: contrastTick() });
  const published = await applyAction(repaired.world, {
    type: "publish",
    draftId: repaired.result.draftId,
    expectedVersion: archive.version
  }, contrastFounder, { now: contrastTick() });
  return {
    world: published.world,
    archive: { ...archive, version: published.result.version }
  };
}

async function evaluateChroniclePredicate(world, actor, archive, literal, predicateKind) {
  const result = await applyAction(world, {
    type: "evaluate-source-archive-predicate",
    creationId: archive.creationId,
    version: archive.version,
    predicateKind,
    literal,
    publicRetentionAcknowledgementVersion: SOURCE_PREDICATE_PUBLIC_RETENTION_ACK_VERSION
  }, actor, { now: contrastTick(), allowSourceArchivePredicate: true });
  return { world: result.world, event: result.world.events.at(-1) };
}

test("Chronicle projects a complete Source Analyst contrast as a read-only dossier after its second event", async () => {
  contrastClock = Date.parse("2026-11-17T08:00:00.000Z");
  let world = createWorld({
    id: "chronicle-source-contrast-world",
    founderName: "Damien Featherstone",
    now: new Date(contrastClock).toISOString()
  });
  const published = await publishChronicleSource(world, {
    commitSha: "a".repeat(40),
    path: "docs/chronicle-contrast.md"
  });
  world = published.world;
  const literal = "NGL_CHRONICLE_PRESENT";
  const contains = await evaluateChroniclePredicate(
    world, contrastFounder, published.archive, literal, "contains-literal"
  );
  world = contains.world;
  assert.equal(contains.event.outcome, "MATCH");
  const doesNotContain = await evaluateChroniclePredicate(
    world, contrastFounder, published.archive, literal, "does-not-contain-literal"
  );
  world = doesNotContain.world;
  assert.equal(doesNotContain.event.outcome, "NO_MATCH");
  const laterStudy = await applyAction(world, {
    type: "study",
    creationId: published.archive.creationId,
    version: published.archive.version,
    question: "Does the literal occur in the retained bytes?",
    attempt: "The two operators are complements for this exact byte sequence.",
    nextCheck: "Inspect the retained source metadata separately."
  }, contrastFounder, { now: contrastTick() });
  world = laterStudy.world;

  const before = structuredClone(world);
  const chronicle = projectChronicle({ world });
  const dossier = chronicle.entries.find(entry =>
    entry.eventType === "source-archive-predicate-contrast-projection"
  );
  assert.ok(dossier, "a complete validated contrast must become a Chronicle dossier");
  assert.equal(dossier.projectionKind, "DERIVED_READ_ONLY");
  assert.equal(dossier.actor, "Founder");
  assert.equal(dossier.category, "MOONSHOT FIELD · CONTRAST DOSSIER");
  assert.equal(dossier.streamPosition, 4,
    "the dossier is anchored to the second predicate's original append position after draft and publication events");
  assert.deepEqual(dossier.derivedFromEventIds, [contains.event.id, doesNotContain.event.id]);
  assert.match(dossier.title, /NGL_CHRONICLE_PRESENT/);
  assert.match(dossier.detail, /contains-literal → MATCH/);
  assert.match(dossier.detail, /does-not-contain-literal → NO_MATCH/);
  assert.match(dossier.detail, /Source truth: NOT_ASSESSED/);
  assert.match(dossier.warning, /not a new canonical event/i);
  assert.match(dossier.warning, /not a natural-language claim verdict/i);

  const worldEntries = chronicle.entries.filter(entry => entry.source === "world");
  const secondPredicatePosition = worldEntries.findIndex(entry => entry.id === "world:" + doesNotContain.event.id);
  assert.ok(secondPredicatePosition > 0);
  assert.equal(worldEntries[secondPredicatePosition - 1].id, dossier.id,
    "the derived dossier must remain adjacent to the later predicate in append history");
  assert.ok(worldEntries.some(entry => entry.id === "world:" + contains.event.id));
  assert.ok(worldEntries.some(entry => entry.id === "world:" + doesNotContain.event.id));
  assert.equal(chronicle.entries.filter(entry =>
    entry.eventType === "source-archive-predicate-contrast-projection"
  ).length, 1);
  assert.equal(world.events.length, before.events.length,
    "Chronicle projection must not append a canonical event");
  assert.equal(world.xp, 100,
    "only the explicit publication reward exists; predicate and dossier projection award no XP");
  assert.deepEqual(world, before, "Chronicle dossier projection must remain read-only");
});

test("Chronicle never combines Source Analyst contrast predicates across actors or versions of one creation", async () => {
  contrastClock = Date.parse("2026-11-17T09:00:00.000Z");
  let world = createWorld({
    id: "chronicle-source-contrast-isolation",
    founderName: "Damien Featherstone",
    now: new Date(contrastClock).toISOString()
  });
  const first = await publishChronicleSource(world, {
    commitSha: "b".repeat(40),
    path: "docs/contrast-first.md"
  });
  world = first.world;
  const secondVersion = await republishChronicleSource(world, first.archive);
  world = secondVersion.world;
  assert.equal(secondVersion.archive.creationId, first.archive.creationId);
  assert.equal(secondVersion.archive.version, first.archive.version + 1);
  assert.equal(secondVersion.archive.sha256, first.archive.sha256,
    "the repair retains the same exact source bytes under a distinct published version");
  const literal = "NGL_CHRONICLE_PRESENT";

  const founderContains = await evaluateChroniclePredicate(
    world, contrastFounder, first.archive, literal, "contains-literal"
  );
  world = founderContains.world;
  const witnessDoesNotContain = await evaluateChroniclePredicate(
    world, contrastWitness, first.archive, literal, "does-not-contain-literal"
  );
  world = witnessDoesNotContain.world;
  const founderOtherVersion = await evaluateChroniclePredicate(
    world, contrastFounder, secondVersion.archive, literal, "does-not-contain-literal"
  );
  world = founderOtherVersion.world;

  const before = structuredClone(world);
  const chronicle = projectChronicle({ world });
  assert.equal(chronicle.entries.filter(entry =>
    entry.eventType === "source-archive-predicate-contrast-projection"
  ).length, 0,
  "same-version predicates by different actors and same-actor predicates across versions cannot form a dossier");
  for (const predicate of [founderContains.event, witnessDoesNotContain.event, founderOtherVersion.event]) {
    assert.ok(chronicle.entries.some(entry => entry.id === "world:" + predicate.id),
      "the original predicate event remains visible even when no dossier can be formed");
  }
  assert.equal(world.xp, 200,
    "only the two explicit Founder publications award XP; predicates and absent dossiers do not");
  assert.deepEqual(world, before, "incomplete or isolated contrast history remains unchanged");
});

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

test("chronicle preserves append order within each retained stream when timestamps regress", () => {
  const { world, kernel } = fixture();
  world.events[0].at = "2026-10-26T10:00:00.000Z";
  world.events[1].at = "2026-10-26T09:00:00.000Z";
  world.events[2].at = "2026-10-26T08:00:00.000Z";
  world.reports[0].at = world.events[1].at;
  kernel.events[0].at = "2026-10-26T09:30:00.000Z";
  kernel.events[1].at = "2026-10-26T09:15:00.000Z";
  const before = structuredClone({ world, kernel });

  const first = projectChronicle({ world, kernel });
  const second = projectChronicle({
    world: structuredClone(world),
    kernel: structuredClone(kernel),
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.entries.map(entry => entry.id), [
    "kernel:adjudicate-1",
    "kernel:observe-1",
    "world:orphan-report",
    "world:report-v1",
    "world:publish-v1",
  ]);
  assert.deepEqual(
    first.entries.filter(entry => entry.source === "world").map(entry => entry.id),
    ["world:orphan-report", "world:report-v1", "world:publish-v1"],
  );
  assert.deepEqual(
    first.entries.filter(entry => entry.source === "kernel").map(entry => entry.id),
    ["kernel:adjudicate-1", "kernel:observe-1"],
  );
  assert.deepEqual({ world, kernel }, before, "Chronicle projection must remain read-only");
});

test("chronicle exposes one-based append positions independently for each retained stream", () => {
  const { world, kernel } = fixture();
  const entries = projectChronicle({ world, kernel }).entries;
  assert.deepEqual(
    entries.filter(entry => entry.source === "world").map(entry => entry.streamPosition),
    [3, 2, 1],
  );
  assert.deepEqual(
    entries.filter(entry => entry.source === "kernel").map(entry => entry.streamPosition),
    [2, 1],
  );
});

test("malformed event slots keep their stream position while corrupt collections remain unsequenced", () => {
  const { world, kernel } = fixture();
  world.events.splice(1, 0, null);
  const malformed = projectChronicle({ world, kernel }).entries
    .find(entry => entry.id === "world:unclassified-1");
  assert.equal(malformed.streamPosition, 2);

  const corrupt = projectChronicle({ world: { events: {} }, kernel: null });
  assert.equal(corrupt.entries.length, 1);
  assert.equal(Object.hasOwn(corrupt.entries[0], "streamPosition"), false);
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

test("Source Observation Chronicle shows declared snapshot references without treating them as proof", () => {
  const { world, kernel } = fixture();
  const base = {
    type: "source-observation-recorded",
    creationId: "creation-observatory",
    version: 1,
    actor: { id: "damien", name: "Damien", role: "founder" },
    claim: "A model says the bridge is open.",
    sourceKind: "model-assertion",
    source: "Model output only; no primary source retrieved.",
    falsifier: "A direct inspection finds it closed.",
    uncertainty: "No independent observation.",
    nextTest: "Inspect the bridge."
  };
  world.events.push(
    { ...base, id: "source-observation-snapshot", sourceSnapshotRevision: 1, at: "2026-10-26T10:08:00.000Z" },
    { ...base, id: "source-observation-legacy", at: "2026-10-26T10:09:00.000Z" },
    { ...base, id: "source-observation-malformed", sourceSnapshotRevision: "1", at: "2026-10-26T10:10:00.000Z" }
  );
  const before = structuredClone(world);
  const entries = projectChronicle({ world, kernel }).entries;
  const snapshot = entries.find(entry => entry.id === "world:source-observation-snapshot");
  const legacy = entries.find(entry => entry.id === "world:source-observation-legacy");
  const malformed = entries.find(entry => entry.id === "world:source-observation-malformed");

  assert.ok(snapshot);
  assert.match(snapshot.detail, /Declared snapshot reference: world revision 1/);
  assert.match(snapshot.detail, /actor-declared/i);
  assert.match(snapshot.detail, /does not prove the actor viewed that snapshot/i);
  assert.match(legacy.detail, /not recorded on this legacy note/i);
  assert.match(malformed.detail, /malformed or unavailable/i);
  assert.deepEqual(world, before, "Chronicle snapshot-reference disclosure is read-only");
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




test("Forge Chronicle preserves designated-recipient refusals as consent history", async () => {
  const founder = { id: "damien", name: "Damien", role: "founder" };
  const witness = { id: "witness-forge-decline", name: "Witness", role: "witness" };
  const t1 = "2026-11-20T02:00:00.000Z";
  const t2 = "2026-11-20T02:01:00.000Z";
  const t3 = "2026-11-20T02:02:00.000Z";
  const t4 = "2026-11-20T02:03:00.000Z";
  const t5 = "2026-11-20T02:04:00.000Z";
  const t6 = "2026-11-20T02:05:00.000Z";
  const t7 = "2026-11-20T02:06:00.000Z";
  const laterRecipient = { id: "later-recipient", name: "Later recipient", role: "witness" };
  const created = createWorld({ id: "chronicle-forge-decline-world", founderName: "Damien", now: t1 });
  const discovered = await applyAction(created, { type: "discover", locationId: "river" }, witness, { now: t2 });
  const source = discovered.world.events.at(-1);
  const forged = await applyAction(discovered.world, {
    type: "forge-field-item", slotId: "scouting", sourceEventId: source.id
  }, witness, { now: t3 });
  const forgeEvent = forged.world.events.at(-1);
  const offered = await applyAction(forged.world, {
    type: "offer-field-item-transfer", itemEventId: forgeEvent.id,
    recipientId: founder.id, recipientRole: founder.role
  }, witness, { now: t4, allowTransfers: true });
  const offerEvent = offered.world.events.at(-1);
  const xpBeforeDecline = offered.world.xp;
  const declined = await applyAction(offered.world, {
    type: "decline-field-item-transfer", offerId: offerEvent.offerId
  }, founder, { now: t5, allowTransfers: true });
  const declineEvent = declined.world.events.at(-1);
  assert.equal(declined.world.events.filter(event => event.type === "field-item-transferred").length, 0,
    "the refusal itself does not append an ownership transfer");
  const laterOffered = await applyAction(declined.world, {
    type: "offer-field-item-transfer", itemEventId: forgeEvent.id,
    recipientId: laterRecipient.id, recipientRole: laterRecipient.role
  }, witness, { now: t6, allowTransfers: true });
  const laterOfferEvent = laterOffered.world.events.at(-1);
  const laterAccepted = await applyAction(laterOffered.world, {
    type: "accept-field-item-transfer", offerId: laterOfferEvent.offerId
  }, laterRecipient, { now: t7, allowTransfers: true });
  const afterLaterTransfer = laterAccepted.world;
  const laterTransferEvent = afterLaterTransfer.events.at(-1);
  const beforeProjection = structuredClone(afterLaterTransfer);
  const entry = projectChronicle({ world: afterLaterTransfer }).entries
    .find(candidate => candidate.id === `world:${declineEvent.id}`);

  assert.ok(entry);
  assert.equal(entry.eventType, "field-item-transfer-declined");
  assert.equal(entry.title, "Field-item transfer declined");
  assert.equal(entry.category, "FORGE · TRANSFER");
  assert.equal(entry.warning, "");
  assert.match(entry.summary, /designated recipient declined/i);
  assert.match(entry.summary, /refusal did not transfer ownership/i);
  assert.match(entry.summary, /item remained with its owner at the time/i);
  assert.doesNotMatch(entry.summary, /current owner/i,
    "a historical refusal must not claim to describe the item's present owner");
  assert.ok(entry.detail.includes(offerEvent.offerId));
  assert.ok(entry.detail.includes(forgeEvent.itemId));
  assert.ok(entry.detail.includes(founder.id));
  assert.ok(entry.detail.includes(forgeEvent.id));
  assert.equal(afterLaterTransfer.xp, xpBeforeDecline);
  assert.equal(laterTransferEvent.type, "field-item-transferred");
  assert.equal(laterTransferEvent.offerId, laterOfferEvent.offerId);
  assert.equal(afterLaterTransfer.events.filter(event => event.type === "field-item-transferred").length, 1);

  const sender = projectCharacter(afterLaterTransfer, witness);
  const originalRecipient = projectCharacter(afterLaterTransfer, founder);
  const laterOwner = projectCharacter(afterLaterTransfer, laterRecipient);
  assert.equal(sender.fieldInventoryTotal, 0);
  assert.equal(originalRecipient.fieldInventoryTotal, 0);
  assert.equal(laterOwner.fieldInventoryTotal, 1);
  assert.equal(laterOwner.fieldInventory[0].ownerId, laterRecipient.id);
  assert.deepEqual(afterLaterTransfer, beforeProjection, "Chronicle projection is read-only");

  const tampered = structuredClone(afterLaterTransfer);
  const tamperedDecline = tampered.events.find(event => event.id === declineEvent.id);
  tamperedDecline.actor = { ...witness };
  const rejected = projectChronicle({ world: tampered }).entries
    .find(candidate => candidate.id === `world:${declineEvent.id}`);
  assert.equal(rejected.title, "Unvalidated field-item refusal");
  assert.equal(rejected.category, "FORGE · RETAINED HISTORY");
  assert.match(rejected.warning, /designated recipient/i);
  assert.ok(rejected.detail.includes(offerEvent.offerId));
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


test("Chronicle refuses report text when actor IDs are whitespace-only", () => {
  const { world, kernel } = fixture();
  world.events[1].actor = { id: " ", name: "Witness", role: "witness" };
  world.reports[0].actor = { id: " ", name: "Witness", role: "witness" };

  const report = projectChronicle({ world, kernel }).entries.find(entry => entry.id === "world:report-v1");
  assert.equal(report.detail, "");
  assert.match(report.warning, /complete actor, version, or timestamp/i);
});


test("Chronicle preserves a timestamp-regressing field-item transfer as unvalidated history", async () => {
  const founder = { id: "damien", name: "Damien", role: "founder" };
  const witness = { id: "witness-chronology", name: "Witness", role: "witness" };
  const t1 = "2026-11-05T13:00:00.000Z";
  const t2 = "2026-11-05T13:01:00.000Z";
  const t3 = "2026-11-05T13:02:00.000Z";
  const t4 = "2026-11-05T13:03:00.000Z";
  const t5 = "2026-11-05T13:04:00.000Z";
  const created = createWorld({ id: "chronicle-regressed-transfer-world", now: t1 });
  const discovered = await applyAction(created, { type: "discover", locationId: "river" }, witness, { now: t2 });
  const source = discovered.world.events.at(-1);
  const forged = await applyAction(discovered.world, {
    type: "forge-field-item", slotId: "scouting", sourceEventId: source.id
  }, witness, { now: t3 });
  const forgeEvent = forged.world.events.at(-1);
  const offered = await applyAction(forged.world, {
    type: "offer-field-item-transfer", itemEventId: forgeEvent.id,
    recipientId: founder.id, recipientRole: founder.role
  }, witness, { now: t4, allowTransfers: true });
  const offerEvent = offered.world.events.at(-1);
  const accepted = await applyAction(offered.world, {
    type: "accept-field-item-transfer", offerId: offerEvent.offerId
  }, founder, { now: t5, allowTransfers: true });

  const tampered = structuredClone(accepted.world);
  const transferEvent = tampered.events.find(event => event.type === "field-item-transferred");
  transferEvent.at = "2026-11-05T13:02:30.000Z";
  const entries = projectChronicle({ world: tampered }).entries;
  const forgeEntry = entries.find(entry => entry.id === "world:" + forgeEvent.id);
  const offerEntry = entries.find(entry => entry.id === "world:" + offerEvent.id);
  const transferEntry = entries.find(entry => entry.id === "world:" + transferEvent.id);
  assert.equal(forgeEntry.warning, "");
  assert.equal(offerEntry.warning, "");
  assert.equal(transferEntry.title, "Field-item ownership transferred");
  assert.match(transferEntry.warning, /valid designated-recipient offer chain/i);
});


test("invalid field-item source IDs remain visible as unvalidated Chronicle history", () => {
  const { world, kernel } = fixture();
  const actor = { id: "damien", name: "Damien", role: "founder" };
  world.events.push({
    id: "__proto__", type: "discover", locationId: "river",
    actor, at: "2026-10-26T10:08:00.000Z"
  });
  world.events.push({
    id: "field-forge-reserved-source", type: "field-item-forged",
    itemId: "reserved-source-item", slotId: "scouting", sourceEventId: "__proto__",
    actor, at: "2026-10-26T10:09:00.000Z"
  });
  const before = structuredClone(world);
  const entry = projectChronicle({ world, kernel }).entries
    .find(item => item.id === "world:field-forge-reserved-source");
  assert.equal(entry.title, "Unvalidated field-item event");
  assert.match(entry.warning, /canonical actor-owned field-item slot\/source rules/i);
  assert.deepEqual(world, before, "Chronicle preserves the malformed event without mutating history");
});


test("Chronicle retains a forged item whose discovery source is not a valid guide record", () => {
  const witness = { id: "witness-invalid-guide-source", name: "Witness", role: "witness" };
  const sourceAt = "2026-11-05T14:00:00.000Z";
  const forgeAt = "2026-11-05T14:01:00.000Z";
  const world = {
    id: "chronicle-invalid-guide-source-world",
    revision: 0,
    xp: 0,
    creations: [],
    events: [
      {
        id: "invalid-guide-discovery-event",
        type: "discover",
        locationId: "not-a-guide-location",
        actor: witness,
        at: sourceAt
      },
      {
        id: "invalid-guide-forge-event",
        type: "field-item-forged",
        itemId: "invalid-guide-item",
        slotId: "scouting",
        sourceEventId: "invalid-guide-discovery-event",
        actor: witness,
        at: forgeAt
      }
    ],
    discoveries: [{
      id: "invalid-guide-discovery-record",
      locationId: "not-a-guide-location",
      actor: witness,
      at: sourceAt
    }]
  };

  const entry = projectChronicle({ world }).entries
    .find(item => item.id === "world:invalid-guide-forge-event");
  assert.ok(entry);
  assert.equal(entry.title, "Unvalidated field-item event");
  assert.match(entry.warning, /canonical actor-owned field-item slot\/source rules/i);
  assert.match(entry.summary, /does not recognize it as an owned field item/i);
});


test("malformed institutional event slots retain their original append positions", () => {
  const { world } = fixture();
  const kernel = {
    events: [
      {
        id: "kernel-claim-before",
        type: "claim",
        workId: "work-ordered",
        actor: "damien",
        at: "2026-10-26T10:00:00.000Z",
        action: "preserve-artifact-bytes",
        subject: { id: "creation-observatory", version: 1 },
      },
      null,
      {
        id: "kernel-adjudicate-after",
        type: "adjudicate",
        workId: "work-ordered",
        actor: "damien",
        at: "2026-10-26T10:02:00.000Z",
        decision: "reject",
        subject: { id: "creation-observatory", version: 1 },
      },
    ],
  };
  const before = structuredClone({ world, kernel });

  const entries = projectChronicle({ world, kernel }).entries
    .filter(entry => entry.source === "kernel");

  assert.deepEqual(entries.map(entry => ({
    id: entry.id,
    streamPosition: entry.streamPosition,
  })), [
    { id: "kernel:kernel-adjudicate-after", streamPosition: 3 },
    { id: "kernel:unclassified-1", streamPosition: 2 },
    { id: "kernel:kernel-claim-before", streamPosition: 1 },
  ]);
  assert.deepEqual({ world, kernel }, before, "malformed-slot projection must remain read-only");
});

test("duplicate retained event IDs remain ambiguous for Forge source provenance", () => {
  const founder = { id: "damien", name: "Damien", role: "founder" };
  const world = {
    creations: [],
    reports: [],
    contributions: [],
    discoveries: [],
    methods: [],
    events: [
      {
        id: "duplicate-source-event",
        type: "discover",
        locationId: "river",
        actor: founder,
        at: "2026-10-26T10:00:00.000Z",
      },
      {
        id: "duplicate-source-event",
        type: "discover",
        locationId: "river",
        actor: founder,
        at: "2026-10-26T10:01:00.000Z",
      },
      {
        id: "forge-with-ambiguous-source",
        type: "field-item-forged",
        itemId: "field-item-ambiguous",
        slotId: "scouting",
        sourceEventId: "duplicate-source-event",
        actor: founder,
        at: "2026-10-26T10:02:00.000Z",
      },
    ],
  };

  const entry = projectChronicle({ world }).entries
    .find(item => item.id === "world:forge-with-ambiguous-source");

  assert.equal(entry.title, "Unvalidated field-item event");
  assert.match(entry.warning, /missing or ambiguous/i);
});

test("large Chronicle projections preserve both stream orders and freeze the merged result", () => {
  const baseTime = Date.parse("2026-10-26T10:00:00.000Z");
  const worldEvents = Array.from({ length: 250 }, (_, index) => ({
    id: "large-world-" + (index + 1),
    type: "discover",
    locationId: "river",
    actor: { id: "damien", name: "Damien", role: "founder" },
    at: new Date(baseTime + index * 2000).toISOString(),
  }));
  const kernelEvents = Array.from({ length: 175 }, (_, index) => ({
    id: "large-kernel-" + (index + 1),
    type: "claim",
    workId: "large-work-" + (index + 1),
    actor: "local-byte-verifier",
    at: new Date(baseTime + index * 2000 + 1000).toISOString(),
    action: "preserve-artifact-bytes",
    subject: { id: "creation-observatory", version: 1 },
  }));
  const world = {
    events: worldEvents,
    creations: [],
    reports: [],
    contributions: [],
    discoveries: [],
    methods: [],
  };
  const kernel = { events: kernelEvents, works: {} };
  const before = structuredClone({ world, kernel });

  const result = projectChronicle({ world, kernel });
  const repeated = projectChronicle({
    world: structuredClone(world),
    kernel: structuredClone(kernel),
  });

  assert.deepEqual(result, repeated);
  assert.equal(result.entries.length, 425);
  assert.deepEqual(
    result.entries.filter(entry => entry.source === "world").map(entry => entry.streamPosition),
    Array.from({ length: 250 }, (_, index) => 250 - index),
  );
  assert.deepEqual(
    result.entries.filter(entry => entry.source === "kernel").map(entry => entry.streamPosition),
    Array.from({ length: 175 }, (_, index) => 175 - index),
  );
  assert.equal(Object.isFrozen(result.entries), true);
  assert.ok(result.entries.every(Object.isFrozen));
  assert.deepEqual({ world, kernel }, before, "large Chronicle projection must not mutate either source stream");
});


test("Source Archive retrieval failures appear in Chronicle without becoming evidence or progression", () => {
  const { world, kernel } = fixture();
  world.events.push({
    id: "source-archive-failure-1",
    type: "source-archive-attempt-failed",
    actor: { id: "damien", name: "Damien", role: "founder" },
    at: "2026-10-26T10:08:00.000Z",
    attemptId: "source-archive-attempt-1",
    requestIdDigest: "a".repeat(64),
    actionDigest: "b".repeat(64),
    repository: "ngl-damien/No-Gas-Labs-Alpha-1",
    commitSha: "c".repeat(40),
    path: "docs/README.md",
    failureCode: "GITHUB_SOURCE_UNAVAILABLE",
    retryable: true,
    observedBy: "shared-source-archive-service",
    semantics: "Game projection only; no XP, evidence verdict or authority."
  });
  const before = structuredClone({ world, kernel });

  const entry = projectChronicle({ world, kernel }).entries
    .find(item => item.id === "world:source-archive-failure-1");

  assert.ok(entry);
  assert.equal(entry.eventType, "source-archive-attempt-failed");
  assert.equal(entry.title, "Source Archive attempt failed · GITHUB_SOURCE_UNAVAILABLE");
  assert.equal(entry.category, "SOURCE OBSERVATORY · FAILURE");
  assert.match(entry.summary, /same request can be retried/i);
  assert.match(entry.detail, /ngl-damien\/No-Gas-Labs-Alpha-1@/);
  assert.match(entry.detail, /Retryable: yes/);
  assert.match(entry.warning, /does not establish source truth/i);
  assert.equal(entry.targetAvailable, false);
  assert.deepEqual({ world, kernel }, before, "Chronicle projection is read-only");
});


test("Chronicle preserves conflicting repeated Source Analyst outcomes as a read-only contradiction dossier", async () => {
  contrastClock = Date.parse("2026-11-17T10:00:00.000Z");
  let world = createWorld({
    id: "chronicle-source-contrast-conflict",
    founderName: "Damien Featherstone",
    now: new Date(contrastClock).toISOString()
  });
  const published = await publishChronicleSource(world, {
    commitSha: "c".repeat(40),
    path: "docs/chronicle-contrast-conflict.md"
  });
  world = published.world;
  const literal = "NGL_CHRONICLE_PRESENT";
  const contains = await evaluateChroniclePredicate(
    world, contrastFounder, published.archive, literal, "contains-literal"
  );
  world = contains.world;
  const doesNotContain = await evaluateChroniclePredicate(
    world, contrastFounder, published.archive, literal, "does-not-contain-literal"
  );
  world = doesNotContain.world;
  const duplicateContains = await evaluateChroniclePredicate(
    world, contrastFounder, published.archive, literal, "contains-literal"
  );
  world = duplicateContains.world;

  const conflicted = structuredClone(world);
  const duplicate = conflicted.events.find(event => event.id === duplicateContains.event.id);
  assert.ok(duplicate);
  duplicate.outcome = "NO_MATCH";
  const beforeProjection = structuredClone(conflicted);

  const chronicle = projectChronicle({ world: conflicted });
  const conflicts = chronicle.entries.filter(entry =>
    entry.eventType === "source-archive-predicate-conflict-projection"
  );
  assert.equal(conflicts.length, 1);
  const conflict = conflicts[0];
  assert.equal(conflict.projectionKind, "DERIVED_READ_ONLY");
  assert.equal(conflict.category, "MOONSHOT FIELD · CONTRADICTION");
  assert.equal(conflict.streamPosition, conflicted.events.findIndex(event => event.id === duplicateContains.event.id) + 1);
  assert.deepEqual(conflict.derivedFromEventIds, [contains.event.id, duplicateContains.event.id]);
  assert.match(conflict.detail, /contains-literal → MATCH/);
  assert.match(conflict.detail, /contains-literal → NO_MATCH/);
  assert.match(conflict.detail, /Source truth: NOT_ASSESSED/);
  assert.match(conflict.warning, /not a new canonical event/i);
  assert.equal(chronicle.entries.filter(entry =>
    entry.eventType === "source-archive-predicate-contrast-projection"
  ).length, 0, "a conflicted operator cannot produce a completed contrast dossier");

  for (const event of [contains.event, doesNotContain.event, duplicateContains.event]) {
    assert.ok(chronicle.entries.some(entry => entry.id === "world:" + event.id),
      "every original predicate event remains visible beside the derived contradiction");
  }
  const worldEntries = chronicle.entries.filter(entry => entry.source === "world");
  const duplicatePosition = worldEntries.findIndex(entry => entry.id === "world:" + duplicateContains.event.id);
  assert.ok(duplicatePosition >= 0);
  assert.ok(duplicatePosition > 0);
  assert.equal(worldEntries[duplicatePosition - 1].id, conflict.id,
    "the append-after conflict dossier appears immediately before its source event in newest-first Chronicle order");
  assert.equal(conflicted.events.length, beforeProjection.events.length,
    "the derived contradiction is not appended to canonical world history");
  assert.equal(conflicted.xp, 100, "a contradiction dossier awards no XP");
  assert.deepEqual(conflicted, beforeProjection, "Chronicle contradiction projection is read-only");
});


const chronicleCombatActor = Object.freeze({
  id: "chronicle-founder",
  name: "Chronicle Founder",
  role: "founder",
});

async function buildChronicleCombatVictoryWorld() {
  const base = Date.parse("2026-11-20T10:00:00.000Z");
  const offsets = [10, 20, 30, 40, 50, 60, 70];
  let offsetIndex = 0;
  let world = createWorld({
    id: "chronicle-combat-victory-world",
    now: new Date(base).toISOString(),
  });
  const act = async action => {
    const now = new Date(base + offsets[offsetIndex++] * 1000).toISOString();
    const result = await applyAction(world, action, chronicleCombatActor, { now });
    world = result.world;
    return result;
  };
  const started = await act({ type: "start-combat-encounter", opponentId: "yard-scout" });
  for (const move of ["feint", "guard", "strike", "feint", "guard", "strike"]) {
    await act({ type: "combat-move", encounterId: started.result.encounterId, move });
  }
  return world;
}

test("Chronicle renders replay-validated Combat Yard turns in retained order", async () => {
  const world = await buildChronicleCombatVictoryWorld();
  const before = structuredClone(world);
  const entries = projectChronicle({ world }).entries.filter(entry =>
    entry.eventType === "combat-encounter-started" || entry.eventType === "combat-move-resolved"
  );

  assert.equal(entries.length, 7);
  assert.deepEqual(entries.map(entry => entry.streamPosition), [7, 6, 5, 4, 3, 2, 1]);
  assert.match(entries[0].title, /Training Scout.*turn 6/i);
  assert.match(entries[0].summary, /first in-game victory/i);
  assert.match(entries[0].summary, /30 game XP/i);
  assert.equal(entries.filter(entry => entry.summary.includes("30 game XP")).length, 1);
  assert.match(entries.at(-1).title, /encounter started.*Training Scout/i);
  assert.match(entries.at(-1).summary, /grants no XP or skill/i);
  assert.ok(entries.every(entry => entry.category === "COMBAT YARD"));
  assert.ok(entries.every(entry => /deterministic game simulation/i.test(entry.warning)));
  assert.equal(world.updatedAt, new Date(Date.parse("2026-11-20T10:00:00.000Z") + 70_000).toISOString());
  assert.deepEqual(world, before, "Chronicle replay must remain read-only");
});

test("Chronicle ignores untrusted event-supplied combat outcome and XP fields", async () => {
  const base = Date.parse("2026-11-20T10:30:00.000Z");
  let world = createWorld({ id: "chronicle-combat-untrusted-fields", now: new Date(base).toISOString() });
  const started = await applyAction(
    world,
    { type: "start-combat-encounter", opponentId: "yard-scout" },
    chronicleCombatActor,
    { now: new Date(base + 1_000).toISOString() },
  );
  world = started.world;
  const moved = await applyAction(
    world,
    { type: "combat-move", encounterId: started.result.encounterId, move: "feint" },
    chronicleCombatActor,
    { now: new Date(base + 2_000).toISOString() },
  );
  world = moved.world;
  world.events.at(-1).outcome = "victory";
  world.events.at(-1).xpAwarded = 999;

  const entry = projectChronicle({ world }).entries.find(item => item.eventType === "combat-move-resolved");
  assert.equal(entry.category, "COMBAT YARD");
  assert.match(entry.summary, /encounter remains active/i);
  // Encounter IDs are random and may contain the digits 999; assert the forged fields, not arbitrary digits.
  assert.doesNotMatch(entry.summary, /victory/i);
  assert.doesNotMatch(entry.summary, /\\bXP\\b/i);
  assert.doesNotMatch(entry.summary + ' ' + entry.detail, /\\b(?:outcome|xpAwarded)\\b/i);
});

test("Chronicle fails closed for malformed combat history instead of displaying a forged victory", async () => {
  const world = await buildChronicleCombatVictoryWorld();
  world.events.find(event => event.type === "combat-move-resolved").move = "guard";

  const entries = projectChronicle({ world }).entries.filter(entry =>
    entry.eventType === "combat-encounter-started" || entry.eventType === "combat-move-resolved"
  );
  assert.equal(entries.length, 7);
  assert.ok(entries.every(entry => entry.title === "Unvalidated Combat Yard event"));
  assert.ok(entries.every(entry => /failed closed/i.test(entry.warning)));
  assert.ok(entries.every(entry => !/first in-game victory|game XP/i.test(entry.summary)));
});

test("Chronicle preserves retreat as a completed game outcome without XP", async () => {
  const base = Date.parse("2026-11-20T11:00:00.000Z");
  let world = createWorld({ id: "chronicle-combat-retreat", now: new Date(base).toISOString() });
  const started = await applyAction(
    world,
    { type: "start-combat-encounter", opponentId: "yard-scout" },
    chronicleCombatActor,
    { now: new Date(base + 1_000).toISOString() },
  );
  world = started.world;
  const retreated = await applyAction(
    world,
    { type: "combat-move", encounterId: started.result.encounterId, move: "retreat" },
    chronicleCombatActor,
    { now: new Date(base + 2_000).toISOString() },
  );
  world = retreated.world;

  const entry = projectChronicle({ world }).entries.find(item => item.eventType === "combat-move-resolved");
  assert.match(entry.summary, /ended as retreated/i);
  assert.match(entry.summary, /No victory XP is projected/i);
  assert.match(entry.detail, /Move: retreat/);
});

test("Chronicle distinguishes a rematch victory without another first-win reward", async () => {
  let world = await buildChronicleCombatVictoryWorld();
  const base = Date.parse(world.updatedAt);
  let tick = 0;
  const act = async action => {
    const result = await applyAction(
      world,
      action,
      chronicleCombatActor,
      { now: new Date(base + (++tick * 1000)).toISOString() },
    );
    world = result.world;
    return result;
  };
  const started = await act({ type: "start-combat-encounter", opponentId: "yard-scout" });
  for (const move of ["feint", "guard", "strike", "feint", "guard", "strike"]) {
    await act({ type: "combat-move", encounterId: started.result.encounterId, move });
  }

  const finalEvent = world.events.at(-1);
  const entry = projectChronicle({ world }).entries.find(item => item.id === "world:" + finalEvent.id);
  assert.match(entry.summary, /rematch victory/i);
  assert.match(entry.summary, /No additional first-win XP is projected/i);
  assert.doesNotMatch(entry.summary, /game XP/);
  assert.equal(world.events.filter(event => event.type === "combat-encounter-started").length, 2);
});


test("Chronicle fails closed when a combat event ID collides with another world event", async () => {
  const world = await buildChronicleCombatVictoryWorld();
  const start = world.events.find(event => event.type === "combat-encounter-started");
  world.events.push({
    id: start.id,
    type: "draft",
    actor: { id: "other-actor", name: "Other Actor", role: "witness" },
    at: new Date(Date.parse(world.updatedAt) + 1_000).toISOString(),
    creationId: "unavailable-creation",
    version: 1,
  });
  const before = structuredClone(world);

  const entries = projectChronicle({ world }).entries.filter(entry =>
    entry.eventType === "combat-encounter-started" || entry.eventType === "combat-move-resolved"
  );
  assert.equal(entries.length, 7);
  assert.ok(entries.every(entry => entry.title === "Unvalidated Combat Yard event"));
  assert.ok(entries.every(entry => /failed closed/i.test(entry.warning)));
  assert.deepEqual(world, before, "ambiguous event identity must not mutate retained history");
});


test("Chronicle does not let Date.parse leniency promote malformed retained timestamps into chronology", () => {
  const { world, kernel } = fixture();
  const dateOnly = "2026-10-26";
  const calendarRollover = "2026-02-30T10:07:00.000Z";
  assert.ok(Number.isFinite(Date.parse(dateOnly)), "the date-only fixture must demonstrate Date.parse leniency");
  assert.ok(Number.isFinite(Date.parse(calendarRollover)), "the rollover fixture must demonstrate Date.parse leniency");

  world.events[1].at = dateOnly;
  kernel.events[1].at = calendarRollover;
  const before = structuredClone({ world, kernel });

  const result = projectChronicle({ world, kernel });
  const worldEntry = result.entries.find(entry => entry.id === "world:report-v1");
  const kernelEntry = result.entries.find(entry => entry.id === "kernel:adjudicate-1");

  assert.equal(worldEntry.at, "", "a date-only world timestamp must not be displayed as valid chronology metadata");
  assert.equal(kernelEntry.at, "", "a calendar-rollover institutional timestamp must not be displayed as valid chronology metadata");
  assert.match(worldEntry.warning, /strict RFC 3339 timestamp/i);
  assert.match(kernelEntry.warning, /strict RFC 3339 timestamp/i);
  assert.deepEqual(
    result.entries.map(entry => entry.id),
    ["world:orphan-report", "kernel:adjudicate-1", "kernel:observe-1", "world:report-v1", "world:publish-v1"],
    "invalid timestamps must not participate in cross-stream time ordering"
  );
  assert.deepEqual(
    result.entries.filter(entry => entry.source === "world").map(entry => entry.id),
    ["world:orphan-report", "world:report-v1", "world:publish-v1"],
    "invalid timestamps must not reorder the retained world stream"
  );
  assert.deepEqual(
    result.entries.filter(entry => entry.source === "kernel").map(entry => entry.id),
    ["kernel:adjudicate-1", "kernel:observe-1"],
    "invalid timestamps must not reorder the retained institutional stream"
  );
  assert.deepEqual({ world, kernel }, before, "invalid-time Chronicle inspection must remain read-only");
});


test("institution activity counters include retained Commons, guild, and field-item transfer events", () => {
  const types = [
    "message-posted", "message-reported", "message-moderated",
    "guild-created", "guild-joined", "guild-left", "guild-disbanded",
    "guild-leadership-transfer-offered", "guild-leadership-transfer-cancelled",
    "guild-leadership-transfer-declined", "guild-leadership-transferred",
    "field-item-transfer-offered", "field-item-transfer-cancelled",
    "field-item-transfer-declined", "field-item-transferred",
  ];
  const events = types.map((type, index) => ({
    id: "institution-route-fixture-" + index,
    type,
  }));
  const world = { revision: events.length, events };

  assert.equal(institutionActivityCount("town-square", world), 3,
    "all three retained Commons message lifecycle events belong to TownSquare");
  assert.equal(institutionActivityCount("guild_hall", world), 8,
    "guild founding, membership, closure and leadership handoffs belong to Guild Hall");
  assert.equal(institutionActivityCount("forge", world), 4,
    "field-item transfer offers, refusals and acceptance belong to the Forge");
  assert.deepEqual(institutionDestinationsForEvent({ type: "message-posted" }).map(place => place.id),
    ["town-square"]);
  assert.deepEqual(institutionDestinationsForEvent({ type: "guild-created" }).map(place => place.id),
    ["guild_hall"]);
  assert.deepEqual(institutionDestinationsForEvent({ type: "field-item-transferred" }).map(place => place.id),
    ["forge"]);
  assert.deepEqual(institutionDestinationsForEvent({ type: "execute" }, "kernel").map(place => place.id),
    ["forge", "evidence_archive", "town-square"]);
  const accessorEvent = Object.defineProperty({}, "type", {
    get() { throw new Error("retained event accessors must not execute during route projection"); }
  });
  assert.deepEqual(institutionDestinationsForEvent(accessorEvent), [],
    "route projection reads only own data properties and never invokes retained accessors");
});

test("Chronicle entries carry institutional destinations and explicit discovery locations without conflating them", () => {
  const { world, kernel } = fixture();
  const chronicle = projectChronicle({ world, kernel });
  const report = chronicle.entries.find(entry => entry.id === "world:report-v1");
  const publication = chronicle.entries.find(entry => entry.id === "world:publish-v1");
  const adjudication = chronicle.entries.find(entry => entry.id === "kernel:adjudicate-1");

  assert.deepEqual(report.institutionDestinations?.map(place => place.id),
    ["evidence_archive", "town-square"]);
  assert.equal(report.locationId, null,
    "related institutions are not a claim about the report's physical location");
  assert.deepEqual(publication.institutionDestinations?.map(place => place.id),
    ["forge", "evidence_archive", "publication_house"]);
  assert.deepEqual(adjudication.institutionDestinations?.map(place => place.id),
    ["guild_hall", "evidence_archive", "town-square", "decision_chamber"]);

  const discoveryWorld = {
    events: [{
      id: "visit-overlook",
      type: "discover",
      locationId: "overlook",
      actor: { id: "damien", name: "Damien", role: "founder" },
      at: "2026-10-26T10:08:00.000Z",
    }],
    discoveries: [],
  };
  const discovery = projectChronicle({ world: discoveryWorld }).entries
    .find(entry => entry.id === "world:visit-overlook");
  assert.equal(discovery.locationId, "overlook");
  assert.equal(discovery.locationName, "The Long View");
  assert.deepEqual(discovery.institutionDestinations || [], [],
    "a discovery event uses its explicitly retained map location, not an inferred institution route");
});

test("Publication House links one exact retained version to its unique publication event without awarding XP", () => {
  const publishedAtV1 = "2026-11-20T10:00:00.000Z";
  const publishedAtV2 = "2026-11-20T11:00:00.000Z";
  const receipt = { algorithm: "sha256", digest: "a".repeat(64), size: 12 };
  const creation = {
    id: "publication-object", title: "Publication fixture", version: 2,
    publishedAt: publishedAtV2, receipt,
    versions: [{ version: 1, publishedAt: publishedAtV1, receipt }]
  };
  const events = [
    { id: "publication-v1", type: "publish", creationId: creation.id, version: 1,
      actor: { id: "damien", name: "Damien", role: "founder" }, at: publishedAtV1 },
    { id: "publication-v2", type: "publish", creationId: creation.id, version: 2,
      actor: { id: "damien", name: "Damien", role: "founder" }, at: publishedAtV2 }
  ];
  const world = { creations: [creation], events, reports: [], contributions: [], discoveries: [], methods: [], xp: 0 };
  const before = structuredClone(world);

  assert.equal(findRetainedPublicationEventId(world, creation.id, 1), "publication-v1",
    "a historical version links to its own retained publication event");
  assert.equal(findRetainedPublicationEventId(world, creation.id, 2), "publication-v2",
    "the current version links to its own retained publication event");
  assert.equal(findRetainedPublicationEventId(world, creation.id, 3), null,
    "a version with no retained bytes cannot acquire a Chronicle link");
  assert.equal(projectCharacter(world, { id: "damien", role: "founder" }).xp, 0,
    "a publication link does not manufacture a publication reward");
  assert.deepEqual(world, before, "resolving publication lineage is read-only");
});

test("Publication House withholds Chronicle links for missing, duplicate, malformed, or mismatched publication lineage", () => {
  const publishedAt = "2026-11-20T10:00:00.000Z";
  const receipt = { algorithm: "sha256", digest: "b".repeat(64), size: 8 };
  const creation = {
    id: "publication-object", title: "Publication fixture", version: 1,
    publishedAt, receipt, versions: []
  };
  const publication = {
    id: "publication-event", type: "publish", creationId: creation.id, version: 1,
    actor: { id: "damien", name: "Damien", role: "founder" }, at: publishedAt
  };
  const worldWith = events => ({ creations: [creation], events });

  assert.equal(findRetainedPublicationEventId(worldWith([]), creation.id, 1), null,
    "missing publication history stays unlinked");
  assert.equal(findRetainedPublicationEventId(worldWith([publication, { ...publication, id: "publication-duplicate" }]), creation.id, 1), null,
    "two publication events for one version remain ambiguous");
  assert.equal(findRetainedPublicationEventId(worldWith([publication, { id: publication.id, type: "report" }]), creation.id, 1), null,
    "a publication event ID collision across event types remains ambiguous");
  assert.equal(findRetainedPublicationEventId(worldWith([{ ...publication, id: " padded-event-id " }]), creation.id, 1), null,
    "an unnormalized event ID cannot be used as a Chronicle destination");
  assert.equal(findRetainedPublicationEventId(worldWith([{ ...publication, actor: { id: "damien", name: "Damien", role: "witness" } }]), creation.id, 1), null,
    "a non-Founder publication actor cannot supply canonical publication lineage");
  assert.equal(findRetainedPublicationEventId(worldWith([{ ...publication, at: "2026-11-20T10:00:01.000Z" }]), creation.id, 1), null,
    "a publication timestamp that disagrees with the retained version stays unlinked");
  const duplicateVersion = { ...creation, versions: [{ version: 1, publishedAt, receipt }] };
  assert.equal(findRetainedPublicationEventId({ creations: [duplicateVersion], events: [publication] }, creation.id, 1), null,
    "duplicate retained version identities remain ambiguous");
});


test("Chronicle preserves server-projected global positions after actor filtering", () => {
  const visibleEvents = [
    { id: "event-public-1", type: "discover", at: "2026-11-20T12:00:00.000Z", historyPosition: 1 },
    { id: "event-public-3", type: "report", at: "2026-11-20T12:01:00.000Z", historyPosition: 3 },
    { id: "event-public-6", type: "discover", at: "2026-11-20T12:02:00.000Z", historyPosition: 6 },
  ];
  const world = {
    revision: 6,
    events: visibleEvents,
    creations: [],
    reports: [],
    contributions: [],
    discoveries: [],
    methods: [],
  };
  const entries = projectChronicle({ world }).entries.filter(entry => entry.source === "world");
  assert.deepEqual(entries.map(entry => entry.streamPosition), [6, 3, 1]);

  const partialLegacyWorld = {
    ...world,
    events: visibleEvents.map(({ historyPosition, ...event }) => event),
  };
  const partialEntries = projectChronicle({ world: partialLegacyWorld }).entries
    .filter(entry => entry.source === "world");
  assert.ok(partialEntries.every(entry => !Number.isSafeInteger(entry.streamPosition)),
    "a filtered legacy snapshot without global position metadata must not invent positions");

  const completeLocalWorld = { ...partialLegacyWorld, revision: 3 };
  const localEntries = projectChronicle({ world: completeLocalWorld }).entries
    .filter(entry => entry.source === "world");
  assert.deepEqual(localEntries.map(entry => entry.streamPosition), [3, 2, 1],
    "a complete local history may retain the array-index fallback");

  const malformedPositionsWorld = {
    ...world,
    events: [
      { ...visibleEvents[0], historyPosition: 3 },
      { ...visibleEvents[1], historyPosition: 2 },
      visibleEvents[2],
    ],
  };
  const malformedEntries = projectChronicle({ world: malformedPositionsWorld }).entries
    .filter(entry => entry.source === "world");
  assert.ok(malformedEntries.every(entry => !Number.isSafeInteger(entry.streamPosition)),
    "duplicate or regressing projection positions must fail closed");
});

test('Chronicle preserves global append positions when a public snapshot omits earlier events', () => {
  const { world } = fixture();
  const filtered = structuredClone(world);
  filtered.revision = 5;
  filtered.methods = [];
  filtered.events = [
    { ...world.events[0], historyPosition: 2 },
    { ...world.events[2], historyPosition: 5 }
  ];
  const before = structuredClone(filtered);

  const chronicle = projectChronicle({ world: filtered, kernel: null });
  const byId = new Map(chronicle.entries
    .filter(entry => entry.source === 'world')
    .map(entry => [entry.id, entry]));

  assert.equal(byId.get('world:publish-v1')?.streamPosition, 2);
  assert.equal(byId.get('world:orphan-report')?.streamPosition, 5);
  assert.deepEqual(filtered, before, 'Chronicle projection must not mutate the filtered snapshot');
});


test('World Chronicle snapshot policy keeps an explicit pin while a newer accepted revision exists', () => {
  const pinned = Object.freeze({ revision: 7, marker: 'pinned' });
  const current = Object.freeze({ revision: 8, marker: 'current' });
  const state = resolveWorldChronicleSnapshotState({
    currentSnapshot: current,
    pinnedSnapshot: pinned,
    explicitlyPinned: true,
    disconnected: false
  });
  assert.equal(state.snapshot, pinned);
  assert.equal(state.stale, true);
  assert.equal(state.staleReason, 'revision-mismatch');
  assert.equal(state.refreshAvailable, true);
});

test('World Chronicle snapshot policy lets unpinned live views follow accepted updates', () => {
  const previous = Object.freeze({ revision: 7 });
  const current = Object.freeze({ revision: 8 });
  const state = resolveWorldChronicleSnapshotState({
    currentSnapshot: current,
    pinnedSnapshot: previous,
    explicitlyPinned: false,
    disconnected: false
  });
  assert.equal(state.snapshot, current);
  assert.equal(state.stale, false);
  assert.equal(state.staleReason, 'current');
  assert.equal(state.refreshAvailable, false);
});

test('World Chronicle snapshot policy fails closed for offline, unavailable and regressed pins', () => {
  const pinned = Object.freeze({ revision: 8 });
  const newer = Object.freeze({ revision: 9 });
  const offline = resolveWorldChronicleSnapshotState({
    currentSnapshot: newer,
    pinnedSnapshot: pinned,
    explicitlyPinned: true,
    disconnected: true
  });
  assert.equal(offline.snapshot, pinned);
  assert.equal(offline.stale, true);
  assert.equal(offline.staleReason, 'disconnected');
  assert.equal(offline.refreshAvailable, false);

  const regressed = resolveWorldChronicleSnapshotState({
    currentSnapshot: Object.freeze({ revision: 7 }),
    pinnedSnapshot: pinned,
    explicitlyPinned: true,
    disconnected: false
  });
  assert.equal(regressed.snapshot, pinned);
  assert.equal(regressed.stale, true);
  assert.equal(regressed.staleReason, 'revision-regression');
  assert.equal(regressed.refreshAvailable, false);

  const unavailable = resolveWorldChronicleSnapshotState({
    currentSnapshot: Object.freeze({}),
    pinnedSnapshot: pinned,
    explicitlyPinned: true,
    disconnected: false
  });
  assert.equal(unavailable.snapshot, pinned);
  assert.equal(unavailable.stale, true);
  assert.equal(unavailable.staleReason, 'revision-unavailable');
  assert.equal(unavailable.refreshAvailable, false);
});
