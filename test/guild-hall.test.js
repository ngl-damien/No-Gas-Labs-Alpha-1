import test from "node:test";
import assert from "node:assert/strict";
import { defineQuest, authorizeQuest } from "../src/quest/engine.js";
import { replayInstitution } from "../src/world/spine.js";
import { projectGuildHall, proposeGuildAction } from "../src/world/guild-hall.js";

const quest = defineQuest({
  quest_id: "q1", title: "Reconstitute Alpha-1",
  objective: "Build through demonstrated work.",
  acceptance: ["mesh"], capabilities: ["repository.write"]
});
const verifyAuthorization = event => event.type === "QUEST_AUTHORIZED" &&
  event.quest_id === "q1" && event.grant_id === "g1" && event.actor === "founder";
const empty = replayInstitution({ events: [], quests: [quest], resolveArtifact: () => null });
const proposal = proposeGuildAction({
  quest_id: "q1", proposal_id: "p1", actor: "critic-agent",
  summary: "Harden Mesh", capability: "repository.write"
});

test("room renders projected truth rather than optimistic UI state", () => {
  const room = projectGuildHall({ institution: empty, quest_id: "q1", events: [], agents: [] });
  assert.equal(room.quest.status, "OPEN");
  assert.equal(room.quest.acceptance[0].status, "UNPROVEN");
  assert.equal(room.exits.forge, "LOCKED");
});

test("proposal opens a route to Decision Chamber but not the Forge", () => {
  const room = projectGuildHall({ institution: empty, quest_id: "q1", events: [proposal], agents: [] });
  assert.equal(room.proposals[0].status, "PROPOSED");
  assert.equal(room.exits.decision_chamber, "AVAILABLE");
  assert.equal(room.exits.forge, "LOCKED");
});

test("host-verified authorization changes proposal state without fabricating completion", () => {
  const auth = { ...authorizeQuest({ quest, grant_id: "g1" }), proposal_id: "p1" };
  const events = [proposal, auth];
  const institution = replayInstitution({
    events, quests: [quest], resolveArtifact: () => null, verifyAuthorization
  });
  const room = projectGuildHall({
    institution, quest_id: "q1", events, agents: [], verifyAuthorization
  });
  assert.equal(room.proposals[0].status, "AUTHORIZED");
  assert.equal(room.quest.status, "AUTHORIZED");
  assert.equal(room.exits.forge, "LOCKED");
});

test("authorization for another quest cannot authorize this proposal", () => {
  const mismatchedAuthorization = {
    ...authorizeQuest({ quest, grant_id: "g2" }),
    quest_id: "q2",
    proposal_id: "p1"
  };
  const verifyOtherQuestAuthorization = event =>
    event.type === "QUEST_AUTHORIZED" &&
    event.quest_id === "q2" &&
    event.grant_id === "g2" &&
    event.actor === "founder";

  const room = projectGuildHall({
    institution: empty,
    quest_id: "q1",
    events: [proposal, mismatchedAuthorization],
    agents: [],
    verifyAuthorization: verifyOtherQuestAuthorization
  });

  assert.equal(room.proposals[0].status, "PROPOSED");
  assert.equal(room.quest.status, "OPEN");
  assert.equal(room.exits.decision_chamber, "AVAILABLE");
  assert.equal(room.exits.forge, "LOCKED");
});

test("self-asserted authorization labels leave proposal and quest unapproved", () => {
  const auth = { ...authorizeQuest({ quest, grant_id: "g1" }), proposal_id: "p1" };
  const events = [proposal, auth];
  const institution = replayInstitution({ events, quests: [quest], resolveArtifact: () => null });
  const room = projectGuildHall({ institution, quest_id: "q1", events, agents: [] });
  assert.equal(room.proposals[0].status, "PROPOSED");
  assert.equal(room.quest.status, "OPEN");
});

test("capability roster reports fit but grants no authority", () => {
  const room = projectGuildHall({
    institution: empty, quest_id: "q1", events: [],
    agents: [
      { agent_id: "builder", capabilities: ["repository.write"] },
      { agent_id: "poet", capabilities: ["verse"] }
    ]
  });
  assert.equal(room.roster[0].can_contribute, true);
  assert.equal(room.roster[1].can_contribute, false);
  assert.equal(room.quest.status, "OPEN");
});
test("unknown inherited object properties are not treated as projected quests", () => {
  for (const questId of ["toString", "constructor", "hasOwnProperty", "valueOf", "__proto__"]) {
    assert.throws(() => projectGuildHall({
      institution: empty, quest_id: questId, events: [], agents: []
    }), /quest not projected/, "unknown quest " + questId + " must fail as not projected");
  }
  assert.throws(() => projectGuildHall({
    institution: empty, quest_id: "", events: [], agents: []
  }), /quest_id required/);
});

test("malformed Guild Hall events are rejected before filtering can execute getters", () => {
  let getterCalls = 0;
  const hostile = { event_id: "hostile", quest_id: "q1", actor: "unknown", summary: "" };
  Object.defineProperty(hostile, "type", {
    enumerable: true,
    get() { getterCalls += 1; return "PROPOSAL"; }
  });
  assert.throws(() => projectGuildHall({
    institution: empty, quest_id: "q1", events: [hostile], agents: []
  }), /invalid Guild Hall event payload/);
  assert.equal(getterCalls, 0);

  const sparse = [];
  sparse.length = 1;
  assert.throws(() => projectGuildHall({
    institution: empty, quest_id: "q1", events: sparse, agents: []
  }), /invalid Guild Hall event list/);
});
