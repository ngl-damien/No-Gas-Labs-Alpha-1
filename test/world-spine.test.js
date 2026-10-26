import test from "node:test";
import assert from "node:assert/strict";
import { defineQuest, authorizeQuest } from "../src/quest/engine.js";
import { makeReceipt } from "../src/evidence/content-addressed.js";
import { replayInstitution, verifyReplay } from "../src/world/spine.js";

const quest = defineQuest({
  quest_id: "reconstitute-alpha-1",
  title: "Reconstitute Alpha-1",
  objective: "Build the lab by demonstrated work.",
  acceptance: ["mesh-protocol"],
  capabilities: ["repository.write"]
});
const bytes = Buffer.from("mesh protocol artifact");
const receipt = makeReceipt(bytes);
const auth = authorizeQuest({ quest, grant_id: "g1" });
const done = {
  event_id: "e1",
  parents: [auth.event_id],
  event_type: "EXECUTION_ADJUDICATION",
  subject: quest.quest_id,
  quest_id: quest.quest_id,
  grant_id: "g1",
  admission: "ACCEPTED",
  authority: "AUTHORIZED",
  execution: "EXECUTED",
  evidence: "OBSERVED",
  observation_verification: "VERIFIED",
  outcome: "SUCCEEDED",
  receipts: [receipt],
  acceptance_satisfied: ["mesh-protocol"],
  world_effect: { xp: 100, inventory: { alpha_1_seal: 1 }, world: { forgeOpen: true } }
};
const events = [auth, done];
const resolveArtifact = candidate => candidate.digest === receipt.digest ? bytes : null;
const verifyObservation = event => event.event_id === "e1";
const verifyAuthorization = event => event.event_id === auth.event_id || event.event_id === "e1";

test("same canonical history reconstructs identical institutional state", () => {
  const first = replayInstitution({ events, quests: [quest], resolveArtifact, verifyObservation, verifyAuthorization });
  const second = replayInstitution({
    events: structuredClone(events), quests: [structuredClone(quest)],
    resolveArtifact, verifyObservation, verifyAuthorization
  });
  assert.equal(first.state_hash, second.state_hash);
  assert.deepEqual(first.projection, second.projection);
  assert.equal(first.projection.quests[quest.quest_id].status, "COMPLETED");
  assert.equal(first.projection.world.xp, 100);
});

test("tampered consequence produces a different state hash", () => {
  const baseline = replayInstitution({ events, quests: [quest], resolveArtifact, verifyObservation, verifyAuthorization });
  const tampered = structuredClone(events);
  tampered[1].world_effect.xp = 1000000;
  const replay = verifyReplay({
    events: tampered, quests: [quest], resolveArtifact, verifyObservation, verifyAuthorization,
    expected_hash: baseline.state_hash
  });
  assert.equal(replay.matches, false);
});

test("history cannot reference a future or missing parent", () => {
  assert.throws(() => replayInstitution({
    events: [done, auth], quests: [quest], resolveArtifact, verifyObservation, verifyAuthorization
  }), /unresolved parent/);
});

test("event parent metadata must be a unique list of retained event IDs", () => {
  const malformedParents = [
    "authorize:reconstitute-alpha-1:g1",
    null,
    [auth.event_id, auth.event_id],
    [7],
    [""]
  ];
  for (const [index, parents] of malformedParents.entries()) {
    assert.throws(
      () => replayInstitution({
        events: [auth, { ...done, parents, event_id: "bad-causal-edge-" + index }],
        quests: [quest], resolveArtifact, verifyObservation, verifyAuthorization
      }),
      /invalid parents|invalid parent reference|duplicate parent/
    );
  }
});

test("duplicate event identities are rejected instead of silently replayed", () => {
  assert.throws(() => replayInstitution({
    events: [auth, auth], quests: [quest], resolveArtifact, verifyObservation, verifyAuthorization
  }), /duplicate or missing/);
});

test("valid bytes and a VERIFIED label cannot complete a quest without independent verifiers", () => {
  const replay = replayInstitution({ events, quests: [quest], resolveArtifact });
  const projected = replay.projection.quests[quest.quest_id];
  assert.equal(replay.projection.world.xp, 0);
  assert.equal(replay.projection.world.history.length, 2, "unverified event remains in history");
  assert.equal(projected.status, "OPEN");
  assert.equal(projected.acceptance[0].satisfied, false);
  assert.deepEqual(projected.executions, ["e1"], "raw claim remains inspectable");
  assert.deepEqual(projected.verified_executions, []);
});

test("a rejecting observer verifier cannot satisfy a quest acceptance condition", () => {
  const replay = replayInstitution({
    events, quests: [quest], resolveArtifact, verifyAuthorization, verifyObservation: () => false
  });
  const projected = replay.projection.quests[quest.quest_id];
  assert.equal(replay.projection.world.xp, 0);
  assert.equal(projected.status, "AUTHORIZED");
  assert.equal(projected.acceptance[0].satisfied, false);
  assert.deepEqual(projected.verified_executions, []);
});

test("an unverified authorization event remains visible but cannot authorize the quest", () => {
  const replay = replayInstitution({
    events, quests: [quest], resolveArtifact, verifyObservation,
    verifyAuthorization: () => false
  });
  assert.equal(replay.projection.quests[quest.quest_id].status, "OPEN");
  assert.equal(replay.projection.world.xp, 0);
});
