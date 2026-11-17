import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGameServer } from "../game/server.mjs";
import {
  GITHUB_SOURCE_ARCHIVE_INTENT_PREFIX,
  GITHUB_SOURCE_ARCHIVE_SERVER_RETRIEVED_LABEL,
  GITHUB_SOURCE_ARCHIVE_PREDICATE_EVALUATOR
} from "../game/artifacts.mjs";
import { SOURCE_PREDICATE_PUBLIC_RETENTION_ACK_VERSION } from "../game/research-records.mjs";
import { projectCharacter } from "../game/character-sheet.mjs";
import { projectChronicle } from "../game/chronicle.mjs";
import { getQuestTrail } from "../game/quests.mjs";
import { institutionActivityCount } from "../game/world-view.mjs";

// Immutable public source pinned to canonical main at the start of Run 170.
// Expected digests were independently computed from the fetched file bytes.
const SOURCE = Object.freeze({
  repository: "ngl-damien/No-Gas-Labs-Alpha-1",
  commitSha: "6f1a4aefb87334ddad359af12f754505965e29a5",
  path: "docs/WORLD_PROJECTION_CONTRACT.md",
  permalink: "https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/blob/6f1a4aefb87334ddad359af12f754505965e29a5/docs/WORLD_PROJECTION_CONTRACT.md",
  gitBlobSha: "25502c0e4941a4fc394059aaaeb39b002325a128",
  sha256: "38871e1f27fbdf460222a80c0dc2c47b5cfca61068e77907fe4414cdbd993d54",
  size: 1489
});

const founderKey = "ngl-live-source-archive-test-" + randomUUID();
const dataDir = await mkdtemp(join(tmpdir(), "ngl-source-archive-live-"));
let server = null;
const originalFetch = globalThis.fetch;
const nativeFetch = originalFetch.bind(globalThis);
const githubFetchCalls = [];
globalThis.fetch = (input, options) => {
  const url = typeof input === "string" ? input : input?.url || String(input);
  if (url.startsWith("https://api.github.com/")) {
    githubFetchCalls.push({ url, method: options?.method || input?.method || "GET" });
  }
  return nativeFetch(input, options);
};

function updatedCookie(response, previous = "") {
  const value = response.headers.get("set-cookie");
  return value ? value.split(";", 1)[0] : previous;
}

async function request(origin, path, { body, cookie } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    headers.origin = origin;
  }
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    redirect: "error"
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return { response, payload, cookie: updatedCookie(response, cookie) };
}

function expectStatus(result, status, label) {
  assert.equal(result.response.status, status, label + ": " + JSON.stringify(result.payload));
}

function worldOf(result, label) {
  assert.ok(result.payload?.world && typeof result.payload.world === "object", label + " must return a world projection");
  return result.payload.world;
}

try {
  // No githubSourceFetch override is supplied: the server uses its real Node fetch.
  server = await createGameServer({ dataDir, founderKey });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = "http://127.0.0.1:" + server.address().port;

  const login = await request(origin, "/api/login", {
    body: { key: founderKey, name: "Live Source Archive Acceptance" }
  });
  expectStatus(login, 200, "Founder login");
  const founderCookie = login.cookie;
  assert.ok(founderCookie, "Founder session cookie must be issued");

  const witnessInitial = await request(origin, "/api/state");
  expectStatus(witnessInitial, 200, "Witness initial state");
  const witnessCookie = witnessInitial.cookie;
  assert.ok(witnessCookie, "Witness session cookie must be issued");
  assert.equal(worldOf(witnessInitial, "Witness initial state").revision, 0);

  // A real GitHub retrieval with a deliberately wrong local preview digest must
  // become an attributed, non-progression failure event rather than a draft.
  const mismatchAction = {
    type: "draft-github-source-archive",
    permalink: SOURCE.permalink,
    gitBlobSha: SOURCE.gitBlobSha,
    sha256: "0".repeat(64),
    size: SOURCE.size,
    requestId: "ngl-live-source-archive-mismatch-001"
  };
  const mismatch = await request(origin, "/api/action", { body: mismatchAction, cookie: founderCookie });
  expectStatus(mismatch, 409, "Mismatched live source preview");
  assert.equal(mismatch.payload.error?.code, "SOURCE_CAPTURE_MISMATCH");

  const founderAfterMismatch = await request(origin, "/api/state", { cookie: founderCookie });
  expectStatus(founderAfterMismatch, 200, "Founder failure history");
  const failedWorld = worldOf(founderAfterMismatch, "Founder failure history");
  assert.equal(failedWorld.revision, 1);
  assert.equal(failedWorld.drafts.length, 0);
  assert.equal(failedWorld.xp, 0);
  assert.equal(failedWorld.events.length, 1);
  const failure = failedWorld.events[0];
  assert.equal(failure.type, "source-archive-attempt-failed");
  assert.equal(failure.failureCode, "SOURCE_CAPTURE_MISMATCH");
  assert.equal(failure.retryable, false);
  assert.equal(failure.actor.id, "damien");
  assert.equal(failure.actor.role, "founder");
  assert.equal(failure.repository, SOURCE.repository);
  assert.equal(failure.commitSha, SOURCE.commitSha);
  assert.equal(failure.path, SOURCE.path);
  assert.match(failure.requestIdDigest, /^[a-f0-9]{64}$/);
  assert.match(failure.actionDigest, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(failure, "requestId"), false);
  assert.equal(Object.hasOwn(failure, "actionFingerprint"), false);

  const witnessAfterFailure = await request(origin, "/api/state", { cookie: witnessCookie });
  expectStatus(witnessAfterFailure, 200, "Witness failure Chronicle");
  const witnessFailureWorld = worldOf(witnessAfterFailure, "Witness failure Chronicle");
  assert.equal(witnessFailureWorld.revision, 1);
  assert.equal(witnessFailureWorld.events.length, 1);
  assert.equal(witnessFailureWorld.events[0].type, "source-archive-attempt-failed");
  assert.equal(witnessFailureWorld.drafts.length, 0);
  assert.equal(witnessFailureWorld.xp, 0);
  assert.equal(institutionActivityCount("evidence_archive", witnessFailureWorld), 1);

  // A new stable request ID with the correct pinned digests retrieves the same
  // public file and creates a private, XP-neutral draft.
  const validAction = {
    ...mismatchAction,
    sha256: SOURCE.sha256,
    requestId: "ngl-live-source-archive-success-001"
  };
  const draft = await request(origin, "/api/action", { body: validAction, cookie: founderCookie });
  expectStatus(draft, 200, "Server-rechecked live Source Archive draft");
  assert.equal(draft.payload.idempotentReplay, false);
  const draftId = draft.payload.result?.draftId;
  assert.ok(typeof draftId === "string" && draftId.length > 0);

  const founderAfterDraft = await request(origin, "/api/state", { cookie: founderCookie });
  expectStatus(founderAfterDraft, 200, "Founder private draft");
  const founderWorld = worldOf(founderAfterDraft, "Founder private draft");
  assert.equal(founderWorld.revision, 2);
  assert.equal(founderWorld.xp, 0);
  assert.equal(founderWorld.drafts.length, 1);
  assert.equal(founderWorld.events.filter(event => event.type === "source-archive-attempt-failed").length, 1);
  assert.equal(founderWorld.events.filter(event => event.type === "draft").length, 1);
  assert.equal(founderWorld.drafts[0].id, draftId);
  assert.ok(founderWorld.drafts[0].intent.startsWith(GITHUB_SOURCE_ARCHIVE_INTENT_PREFIX));
  assert.match(founderWorld.drafts[0].intent, /does not establish.*truth/i);

  const html = founderWorld.drafts[0].html;
  assert.ok(html.includes(GITHUB_SOURCE_ARCHIVE_SERVER_RETRIEVED_LABEL));
  const metadata = /<script type="application\/json" id="ngl-source-archive-data">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(metadata, "Server-generated Source Archive metadata must be retained in the private draft");
  const archive = JSON.parse(metadata[1]);
  assert.equal(archive.retrievalMode, "SERVER_RECHECKED");
  assert.equal(archive.repository, SOURCE.repository);
  assert.equal(archive.commitSha, SOURCE.commitSha);
  assert.equal(archive.path, SOURCE.path);
  assert.equal(archive.permalink, SOURCE.permalink);
  assert.equal(archive.gitBlobSha, SOURCE.gitBlobSha);
  assert.equal(archive.sha256, SOURCE.sha256);
  assert.equal(archive.size, SOURCE.size);
  assert.equal(archive.captureId, JSON.stringify([SOURCE.repository, SOURCE.commitSha, SOURCE.path, SOURCE.sha256]));

  const bytes = Buffer.from(archive.bytesBase64, "base64");
  assert.equal(bytes.byteLength, SOURCE.size);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), SOURCE.sha256);
  const gitBlobHeader = Buffer.from("blob " + bytes.byteLength + "\0", "utf8");
  assert.equal(
    createHash("sha1").update(Buffer.concat([gitBlobHeader, bytes])).digest("hex"),
    SOURCE.gitBlobSha
  );
  const decoded = bytes.toString("utf8");
  assert.ok(decoded.includes("Claims and proposals may create visible quests"));
  assert.ok(decoded.includes("Failures, refutations, and rejected candidates remain in history"));

  // Replaying the committed action returns its exact result without another
  // world mutation. The request receipt is not a second publication or reward.
  const replay = await request(origin, "/api/action", { body: validAction, cookie: founderCookie });
  expectStatus(replay, 200, "Idempotent Source Archive replay");
  assert.equal(replay.payload.idempotentReplay, true);
  assert.equal(replay.payload.result?.draftId, draftId);
  const founderAfterReplay = await request(origin, "/api/state", { cookie: founderCookie });
  const replayWorld = worldOf(founderAfterReplay, "Founder replay state");
  assert.equal(replayWorld.revision, 2);
  assert.equal(replayWorld.events.filter(event => event.type === "draft").length, 1);
  assert.equal(replayWorld.xp, 0);

  // Witness sees the public operational failure but never the private draft,
  // draft event, source text, or base64 payload. Redacted history is explicitly
  // reported as incomplete rather than a misleading smaller activity count.
  const witnessAfterDraft = await request(origin, "/api/state", { cookie: witnessCookie });
  expectStatus(witnessAfterDraft, 200, "Witness after private draft");
  const witnessWorld = worldOf(witnessAfterDraft, "Witness after private draft");
  assert.equal(witnessWorld.revision, 2);
  assert.equal(witnessWorld.events.length, 1);
  assert.equal(witnessWorld.events[0].type, "source-archive-attempt-failed");
  assert.equal(witnessWorld.drafts.length, 0);
  assert.equal(witnessWorld.xp, 0);
  assert.equal(JSON.stringify(witnessAfterDraft.payload).includes(archive.bytesBase64), false);
  assert.equal(JSON.stringify(witnessAfterDraft.payload).includes(decoded), false);
  assert.equal(institutionActivityCount("evidence_archive", witnessWorld), null);

  const deniedPublish = await request(origin, "/api/action", {
    body: { type: "publish", draftId, expectedVersion: 0 },
    cookie: witnessCookie
  });
  expectStatus(deniedPublish, 403, "Witness publication denial");
  const witnessAfterDeniedPublish = await request(origin, "/api/state", { cookie: witnessCookie });
  const deniedWorld = worldOf(witnessAfterDeniedPublish, "Witness after denied publication");
  assert.equal(deniedWorld.revision, 2);
  assert.equal(deniedWorld.xp, 0);
  assert.equal(deniedWorld.drafts.length, 0);

  // Only an explicit Founder publication makes this exact server-rechecked
  // version available to the shared-world byte-predicate workbench.
  const founderPublication = await request(origin, "/api/action", {
    body: {
      type: "publish", draftId, expectedVersion: 0,
      requestId: "ngl-live-source-archive-publish-001"
    },
    cookie: founderCookie
  });
  expectStatus(founderPublication, 200, "Explicit Founder Source Archive publication");
  const creationId = founderPublication.payload.result?.creationId;
  assert.ok(typeof creationId === "string" && creationId.length > 0);
  assert.equal(founderPublication.payload.result?.version, 1);

  const founderAfterPublication = await request(origin, "/api/state", { cookie: founderCookie });
  expectStatus(founderAfterPublication, 200, "Founder published Source Archive");
  const publishedFounderWorld = worldOf(founderAfterPublication, "Founder published Source Archive");
  assert.equal(publishedFounderWorld.revision, 3);
  assert.equal(publishedFounderWorld.drafts.length, 0);
  assert.equal(publishedFounderWorld.xp, 100);
  assert.equal(publishedFounderWorld.events.filter(event =>
    event.type === "publish" && event.creationId === creationId && event.version === 1
  ).length, 1);
  const publicationXpDelta = publishedFounderWorld.xp - founderWorld.xp;
  assert.equal(publicationXpDelta, 100, "Only the explicit checked Founder publication awards the existing publication XP");

  const witnessBeforePredicate = await request(origin, "/api/state", { cookie: witnessCookie });
  expectStatus(witnessBeforePredicate, 200, "Witness published Source Archive");
  const witnessPublishedWorld = worldOf(witnessBeforePredicate, "Witness published Source Archive");
  assert.equal(witnessPublishedWorld.revision, 3);
  assert.equal(witnessPublishedWorld.drafts.length, 0);
  assert.equal(witnessPublishedWorld.xp, 100);
  assert.equal(witnessPublishedWorld.creations.filter(item => item.id === creationId).length, 1);
  assert.equal(witnessPublishedWorld.events.some(event =>
    event.type === "publish" && event.creationId === creationId && event.version === 1
  ), true);
  assert.equal(githubFetchCalls.length, 2, "The mismatch and successful capture each perform one live GitHub retrieval");
  assert.equal(githubFetchCalls.every(call => call.method === "GET" && call.url.startsWith("https://api.github.com/repos/")), true);

  // Evaluate both a matching and a non-matching literal against the exact
  // bytes already retained by the server. Predicate evaluation must not
  // perform another upstream request, award XP, or turn the result into truth.
  const githubFetchCountBeforePredicates = githubFetchCalls.length;
  const matchActionWithoutAcknowledgement = {
    type: "evaluate-source-archive-predicate",
    creationId,
    version: 1,
    predicateKind: "contains-literal",
    literal: "Claims and proposals may create visible quests",
    requestId: "ngl-live-source-archive-predicate-match-001"
  };
  const missingAcknowledgement = await request(origin, "/api/action", {
    body: matchActionWithoutAcknowledgement, cookie: witnessCookie
  });
  expectStatus(missingAcknowledgement, 428, "Reject live predicate without public-retention acknowledgement");
  assert.equal(missingAcknowledgement.payload.error?.code, "PUBLIC_RETENTION_ACK_REQUIRED");
  const witnessAfterMissingAcknowledgement = await request(origin, "/api/state", { cookie: witnessCookie });
  const missingAcknowledgementWorld = worldOf(witnessAfterMissingAcknowledgement, "Witness after missing acknowledgement");
  assert.equal(missingAcknowledgementWorld.revision, witnessBeforePredicate.payload.world.revision);
  assert.equal(missingAcknowledgementWorld.events.filter(event =>
    event.type === "source-archive-predicate-evaluated"
  ).length, 0, "A missing acknowledgement must not append a predicate event or consume the request ID.");

  const matchAction = {
    ...matchActionWithoutAcknowledgement,
    publicRetentionAcknowledgementVersion: SOURCE_PREDICATE_PUBLIC_RETENTION_ACK_VERSION
  };
  const matchResult = await request(origin, "/api/action", {
    body: matchAction, cookie: witnessCookie
  });
  expectStatus(matchResult, 200, "Live pinned-source literal match");
  assert.match(matchResult.payload.result?.predicateId || "", /^source-predicate-/);

  const witnessAfterMatch = await request(origin, "/api/state", { cookie: witnessCookie });
  expectStatus(witnessAfterMatch, 200, "Witness after live byte match");
  const matchWorld = worldOf(witnessAfterMatch, "Witness after live byte match");
  const matchEvent = matchWorld.events.find(event =>
    event.type === "source-archive-predicate-evaluated" &&
    event.predicateId === matchResult.payload.result.predicateId
  );
  assert.ok(matchEvent, "The live MATCH must be retained as a world event");
  assert.equal(matchEvent.actor.id, witnessBeforePredicate.payload.viewer.id);
  assert.equal(matchEvent.actor.role, "witness");
  assert.equal(matchEvent.creationId, creationId);
  assert.equal(matchEvent.version, 1);
  assert.equal(matchEvent.predicateKind, "contains-literal");
  assert.equal(matchEvent.literal, matchAction.literal);
  assert.equal(matchEvent.publicRetentionAcknowledgementVersion, SOURCE_PREDICATE_PUBLIC_RETENTION_ACK_VERSION);
  assert.equal(matchEvent.outcome, "MATCH");
  assert.equal(matchEvent.sourceSha256, SOURCE.sha256);
  assert.equal(matchEvent.sourceSize, SOURCE.size);
  assert.equal(matchEvent.retrievalMode, "SERVER_RECHECKED");
  assert.equal(matchEvent.evaluator, GITHUB_SOURCE_ARCHIVE_PREDICATE_EVALUATOR);
  assert.equal(matchEvent.observedBy, "shared-game-server");
  assert.equal(matchEvent.executionContext, "shared-server");
  assert.equal(matchEvent.sourceTruth, "NOT_ASSESSED");
  assert.equal(matchEvent.independentVerification, "NOT_PERFORMED");
  assert.equal(matchEvent.modelAssertions, "LEADS_ONLY");
  const matchCharacter = projectCharacter(matchWorld, witnessAfterMatch.payload.viewer);
  assert.equal(matchCharacter.skills.find(skill => skill.id === "source-analyst")?.count, 1);
  const matchObjective = getQuestTrail(matchWorld, witnessAfterMatch.payload.viewer)
    .find(item => item.id === "witness-source-archive-predicate");
  assert.equal(matchObjective?.progress, 1);
  assert.equal(matchObjective?.complete, true);
  const matchChronicle = projectChronicle({ world: matchWorld });
  const matchChronicleEntry = matchChronicle.entries.find(entry =>
    entry.eventType === "source-archive-predicate-evaluated"
  );
  assert.equal(matchChronicleEntry?.title, "Source predicate · MATCH");
  assert.match(matchChronicleEntry?.warning || "", /not a natural-language claim verdict/i);
  assert.equal(matchWorld.xp, witnessBeforePredicate.payload.world.xp);

  const replayPredicate = await request(origin, "/api/action", {
    body: matchAction, cookie: witnessCookie
  });
  expectStatus(replayPredicate, 200, "Idempotent live predicate replay");
  assert.equal(replayPredicate.payload.idempotentReplay, true);
  const witnessAfterPredicateReplay = await request(origin, "/api/state", { cookie: witnessCookie });
  const predicateReplayWorld = worldOf(witnessAfterPredicateReplay, "Witness after predicate replay");
  assert.equal(predicateReplayWorld.revision, matchWorld.revision);
  assert.equal(predicateReplayWorld.events.filter(event =>
    event.type === "source-archive-predicate-evaluated"
  ).length, 1);

  const absentLiteral = "NGL_LIVE_PREDICATE_LITERAL_NOT_PRESENT_20261117";
  assert.equal(decoded.includes(absentLiteral), false);
  const noMatchAction = {
    ...matchAction,
    literal: absentLiteral,
    requestId: "ngl-live-source-archive-predicate-no-match-001"
  };
  const noMatchResult = await request(origin, "/api/action", {
    body: noMatchAction, cookie: witnessCookie
  });
  expectStatus(noMatchResult, 200, "Live pinned-source literal non-match");
  const witnessAfterNoMatch = await request(origin, "/api/state", { cookie: witnessCookie });
  expectStatus(witnessAfterNoMatch, 200, "Witness after live byte non-match");
  const predicateWorld = worldOf(witnessAfterNoMatch, "Witness after live byte non-match");
  const predicateEvents = predicateWorld.events.filter(event =>
    event.type === "source-archive-predicate-evaluated"
  );
  assert.equal(predicateEvents.length, 2);
  const noMatchEvent = predicateEvents.find(event =>
    event.predicateId === noMatchResult.payload.result?.predicateId
  );
  assert.ok(noMatchEvent, "The live NO_MATCH must be retained rather than discarded");
  assert.equal(noMatchEvent.actor.id, witnessBeforePredicate.payload.viewer.id);
  assert.equal(noMatchEvent.actor.role, "witness");
  assert.equal(noMatchEvent.literal, absentLiteral);
  assert.equal(noMatchEvent.outcome, "NO_MATCH");
  assert.equal(noMatchEvent.sourceSha256, SOURCE.sha256);
  assert.equal(noMatchEvent.sourceSize, SOURCE.size);
  assert.equal(noMatchEvent.retrievalMode, "SERVER_RECHECKED");
  assert.equal(noMatchEvent.sourceTruth, "NOT_ASSESSED");
  assert.equal(noMatchEvent.independentVerification, "NOT_PERFORMED");
  assert.equal(noMatchEvent.modelAssertions, "LEADS_ONLY");
  const witnessCharacter = projectCharacter(predicateWorld, witnessAfterNoMatch.payload.viewer);
  assert.equal(witnessCharacter.skills.find(skill => skill.id === "source-analyst")?.count, 2);
  const predicateObjective = getQuestTrail(predicateWorld, witnessAfterNoMatch.payload.viewer)
    .find(item => item.id === "witness-source-archive-predicate");
  assert.ok(predicateObjective && predicateObjective.progress >= 1 && predicateObjective.complete === true);
  const predicateChronicle = projectChronicle({ world: predicateWorld });
  const predicateChronicleEntries = predicateChronicle.entries.filter(entry =>
    entry.eventType === "source-archive-predicate-evaluated"
  );
  assert.equal(predicateChronicleEntries.length, 2);
  assert.equal(predicateChronicleEntries.some(entry => entry.title === "Source predicate · MATCH"), true);
  assert.equal(predicateChronicleEntries.some(entry => entry.title === "Source predicate · NO_MATCH"), true);
  assert.equal(predicateWorld.xp, witnessBeforePredicate.payload.world.xp);
  assert.equal(predicateWorld.revision, witnessBeforePredicate.payload.world.revision + 2);
  assert.equal(githubFetchCalls.length, githubFetchCountBeforePredicates,
    "Both predicates and the idempotent replay must use retained bytes without another GitHub request");

  const founderAfterPredicates = await request(origin, "/api/state", { cookie: founderCookie });
  expectStatus(founderAfterPredicates, 200, "Founder actor-scoped predicate projection");
  const founderCharacter = projectCharacter(
    worldOf(founderAfterPredicates, "Founder actor-scoped predicate projection"),
    founderAfterPredicates.payload.viewer
  );
  assert.equal(founderCharacter.skills.find(skill => skill.id === "source-analyst")?.count, 0,
    "Witness predicate practice must not be projected onto Founder skill state");

  const predicateXpDelta = predicateWorld.xp - witnessBeforePredicate.payload.world.xp;
  const predicateRevisionDelta = predicateWorld.revision - witnessBeforePredicate.payload.world.revision;
  const predicateUpstreamFetchDelta = githubFetchCalls.length - githubFetchCountBeforePredicates;

  const receipt = {
    schema: "ngl.source-archive-live-acceptance.v1",
    generatedAt: new Date().toISOString(),
    transport: "real Node global fetch through createGameServer; no injected transport or GitHub token",
    source: {
      repository: SOURCE.repository,
      commitSha: SOURCE.commitSha,
      path: SOURCE.path,
      gitBlobSha: SOURCE.gitBlobSha,
      sha256: SOURCE.sha256,
      size: SOURCE.size
    },
    observations: {
      liveGitHubRetrieval: "SERVER_RECHECKED",
      mismatchedPreview: "RETAINED_AS_SOURCE_CAPTURE_MISMATCH",
      evidenceArchiveActivityAfterFailure: 1,
      successfulDraft: "PRIVATE_TO_FOUNDER",
      witnessDraftVisibility: false,
      witnessPublication: "DENIED",
      founderPublication: "EXPLICIT_TEST_FOUNDER_ACTION",
      publicationXpDelta,
      idempotentReplay: true,
      draftXpDelta: 0,
      livePredicateOutcomes: ["MATCH", "NO_MATCH"],
      retainedPredicateEvents: predicateEvents.length,
      sourceAnalystSkillCount: witnessCharacter.skills.find(skill => skill.id === "source-analyst")?.count || 0,
      witnessQuestProgress: predicateObjective.progress + "/" + predicateObjective.target,
      predicateReplayWithoutDuplicate: true,
      predicateXpDelta,
      predicateWorldRevisionDelta: predicateRevisionDelta,
      additionalGitHubFetchesForPredicates: predicateUpstreamFetchDelta,
      independentVerification: "NOT_PERFORMED",
      sourceTruth: "NOT_ASSESSED"
    },
    limitation: "This proves live retrieval and byte identity for one public commit-pinned file, plus exact literal predicates against those retained bytes at test time. MATCH/NO_MATCH is not a natural-language claim verdict and does not establish authorship, primary-source status, claim accuracy, source truth, independent verification, or production availability."
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/source-archive-live-result.json", JSON.stringify(receipt, null, 2) + "\n", { flag: "w" });
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  console.error("Source Archive live acceptance failed:", error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  if (server) await server.closeGame().catch(() => {});
  await rm(dataDir, { recursive: true, force: true });
}
