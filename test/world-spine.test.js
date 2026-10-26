import test from "node:test";
import assert from "node:assert/strict";
import { defineQuest, authorizeQuest } from "../src/quest/engine.js";
import { makeReceipt } from "../src/evidence/content-addressed.js";
import { replayInstitution, verifyReplay } from "../src/world/spine.js";

const quest = defineQuest({
  quest_id: "reconstitute-alpha-1", title: "Reconstitute Alpha-1",
  objective: "Build the lab by demonstrated work.",
  acceptance: ["mesh-protocol"], capabilities: ["repository.write"]
});
const bytes = Buffer.from("mesh protocol artifact");
const receipt = makeReceipt(bytes);
const auth = authorizeQuest({ quest, grant_id: "g1" });
const done = {
  event_id: "e1", parents: [auth.event_id], event_type: "EXECUTION_ADJUDICATION",
  subject: quest.quest_id, quest_id: quest.quest_id, grant_id: "g1",
  admission: "ACCEPTED", authority: "AUTHORIZED", execution: "EXECUTED",
  evidence: "OBSERVED", observation_verification: "VERIFIED", outcome: "SUCCEEDED",
  receipts: [receipt], acceptance_satisfied: ["mesh-protocol"],
  world_effect: { xp: 100, inventory: { alpha_1_seal: 1 }, world: { forgeOpen: true } }
};
const events = [auth, done];
const resolve = candidate => candidate.digest === receipt.digest ? bytes : null;
const trust = {
  resolveArtifact: resolve,
  verifyObservation: event => event.event_id === "e1",
  verifyAuthorization: event => event.event_id === auth.event_id
    ? event.quest_id === quest.quest_id && event.grant_id === "g1" && event.actor === "founder"
    : event.event_id === "e1" && event.grant_id === "g1" && event.authority === "AUTHORIZED",
  verifyAdjudication: () => false
};

test("same verified canonical history reconstructs identical institutional state", () => {
  const first = replayInstitution({ events, quests: [quest], ...trust });
  const second = replayInstitution({
    events: structuredClone(events), quests: [structuredClone(quest)], ...trust
  });
  assert.equal(first.state_hash, second.state_hash);
  assert.deepEqual(first.projection, second.projection);
  assert.equal(first.projection.quests[quest.quest_id].status, "COMPLETED");
  assert.equal(first.projection.world.xp, 100);
});

test("tampered consequence produces a different state hash", () => {
  const baseline = replayInstitution({ events, quests: [quest], ...trust });
  const tampered = structuredClone(events);
  tampered[1].world_effect.xp = 1000000;
  const replay = verifyReplay({
    events: tampered, quests: [quest], ...trust, expected_hash: baseline.state_hash
  });
  assert.equal(replay.matches, false);
});

test("history cannot reference a future or missing parent", () => {
  assert.throws(
    () => replayInstitution({ events: [done, auth], quests: [quest], ...trust }),
    /unresolved parent/
  );
});

test("duplicate event identities are rejected instead of silently replayed", () => {
  assert.throws(
    () => replayInstitution({ events: [auth, auth], quests: [quest], ...trust }),
    /duplicate or missing/
  );
});

test("replay without host verifiers retains history but grants no progress", () => {
  const replay = replayInstitution({ events, quests: [quest], resolveArtifact: resolve });
  assert.equal(replay.projection.world.xp, 0);
  assert.equal(replay.projection.quests[quest.quest_id].status, "OPEN");
  assert.equal(replay.projection.world.history.length, 2);
});
