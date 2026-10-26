import test from "node:test";
import assert from "node:assert/strict";
import { defineQuest, projectQuest, authorizeQuest, QUEST_STATUS } from "../src/quest/engine.js";
import { makeReceipt } from "../src/evidence/content-addressed.js";

const quest = defineQuest({
  quest_id: "reconstitute-alpha-1",
  title: "Reconstitute Alpha-1",
  objective: "Make No_Gas_Labs progressively capable without inventing execution.",
  acceptance: ["mesh-protocol", "adversarial-tests"],
  capabilities: ["repository.write", "evidence.verify"]
});
const auth = authorizeQuest({ quest, grant_id: "g-alpha" });
const bytes = Buffer.from("independently checked test artifact");
const receipt = makeReceipt(bytes);
const verifiedObservationIds = new Set();
const trustedAuthorizationIds = new Set([auth.event_id]);
const trustedExecutionIds = new Set();
const resolveArtifact = candidate => candidate.digest === receipt.digest ? bytes : null;
const verifyObservation = event => verifiedObservationIds.has(event.event_id);
// Test-only trust-root stand-in; production must inject an independently controlled verifier.
const verifyAuthorization = event =>
  trustedAuthorizationIds.has(event.event_id) || trustedExecutionIds.has(event.event_id);
const project = events => projectQuest(quest, events, {
  resolveArtifact, verifyObservation, verifyAuthorization
});

function execution(event_id, acceptance_satisfied, grant_id = "g-alpha") {
  return {
    event_id,
    event_type: "EXECUTION_ADJUDICATION",
    quest_id: quest.quest_id,
    subject: quest.quest_id,
    grant_id,
    admission: "ACCEPTED",
    authority: "AUTHORIZED",
    execution: "EXECUTED",
    evidence: "OBSERVED",
    observation_verification: "VERIFIED",
    outcome: "SUCCEEDED",
    receipts: [receipt],
    acceptance_satisfied
  };
}

test("definition alone earns nothing", () =>
  assert.equal(projectQuest(quest).status, QUEST_STATUS.OPEN));

test("an authorization-shaped claim is not authority without a host verifier", () =>
  assert.equal(projectQuest(quest, [auth]).status, QUEST_STATUS.OPEN));

test("a verified authorization is not completion", () =>
  assert.equal(project([auth]).status, QUEST_STATUS.AUTHORIZED));

test("authorization actor labels cannot bypass the host gate", () => {
  const forged = { ...auth, event_id: "forged-auth", actor: "npc" };
  assert.equal(projectQuest(quest, [forged], { verifyAuthorization: () => true }).status, QUEST_STATUS.OPEN);
});

test("executor-shaped claim cannot complete quest", () => {
  const claim = { event_id: "claim", quest_id: quest.quest_id, outcome: "SUCCEEDED", acceptance_satisfied: quest.acceptance };
  assert.equal(project([auth, claim]).status, QUEST_STATUS.AUTHORIZED);
});

test("partial accepted evidence remains in progress only with the authorized grant", () => {
  const event = execution("e1", ["mesh-protocol"]);
  verifiedObservationIds.add(event.event_id);
  trustedExecutionIds.add(event.event_id);
  assert.equal(project([auth, event]).status, QUEST_STATUS.IN_PROGRESS);
});

test("all acceptance conditions require independently verified execution and authorization", () => {
  const events = quest.acceptance.map((condition, index) => execution("e" + index, [condition]));
  for (const event of events) {
    verifiedObservationIds.add(event.event_id);
    trustedExecutionIds.add(event.event_id);
  }
  assert.equal(project([auth, ...events]).status, QUEST_STATUS.COMPLETED);
});

test("an execution using a different grant cannot satisfy the quest", () => {
  const event = execution("wrong-grant", quest.acceptance, "g-other");
  verifiedObservationIds.add(event.event_id);
  trustedExecutionIds.add(event.event_id);
  assert.equal(project([auth, event]).status, QUEST_STATUS.AUTHORIZED);
});

test("rejected evidence cannot satisfy acceptance without trusted adjudication", () => {
  const event = {
    event_id: "bad",
    event_type: "EXECUTION_ADJUDICATION",
    subject: quest.quest_id,
    quest_id: quest.quest_id,
    grant_id: "g-alpha",
    admission: "REJECTED",
    outcome: "SUCCEEDED",
    acceptance_satisfied: quest.acceptance
  };
  assert.equal(project([auth, event]).status, QUEST_STATUS.AUTHORIZED);
});

test("authorization helper rejects non-Founder actor labels", () => {
  assert.throws(() => authorizeQuest({ quest, grant_id: "g-other", actor: "npc" }), /founder actor/);
});
