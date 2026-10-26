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
const bytes = Buffer.from("independently inspected acceptance artifact");
const receipt = makeReceipt(bytes);
const observedIds = new Set(["e0", "e1"]);
const trust = {
  resolveArtifact: () => bytes,
  verifyAuthorization: event => event.type === "QUEST_AUTHORIZED"
    ? event.event_id === auth.event_id && event.grant_id === "g-alpha" && event.actor === "founder"
    : event.grant_id === "g-alpha" && event.authority === "AUTHORIZED",
  verifyObservation: event => observedIds.has(event.event_id)
};
const execution = (event_id, acceptance_satisfied, outcome = "SUCCEEDED") => ({
  event_id, event_type: "EXECUTION_ADJUDICATION", subject: quest.quest_id,
  grant_id: "g-alpha", admission: "ACCEPTED", authority: "AUTHORIZED",
  execution: "EXECUTED", evidence: "OBSERVED", observation_verification: "VERIFIED",
  outcome, receipts: [receipt], acceptance_satisfied
});

test("definition alone earns nothing", () =>
  assert.equal(projectQuest(quest).status, QUEST_STATUS.OPEN));

test("a self-asserted authorization does not change canonical quest status", () =>
  assert.equal(projectQuest(quest, [auth]).status, QUEST_STATUS.OPEN));

test("host-verified authorization is not completion", () =>
  assert.equal(projectQuest(quest, [auth], trust).status, QUEST_STATUS.AUTHORIZED));

test("executor-shaped claim cannot complete quest", () =>
  assert.equal(projectQuest(quest, [auth, {
    quest_id: quest.quest_id, outcome: "SUCCEEDED",
    acceptance_satisfied: quest.acceptance
  }], trust).status, QUEST_STATUS.AUTHORIZED));

test("partial host-verified evidence remains in progress", () => {
  const event = execution("e1", ["mesh-protocol"]);
  assert.equal(projectQuest(quest, [auth, event], trust).status, QUEST_STATUS.IN_PROGRESS);
});

test("all acceptance conditions require verified adjudications", () => {
  const events = quest.acceptance.map((acceptance, index) =>
    execution("e" + index, [acceptance])
  );
  assert.equal(projectQuest(quest, [auth, ...events], trust).status, QUEST_STATUS.COMPLETED);
});

test("unverified execution labels cannot satisfy acceptance", () => {
  const event = execution("untrusted", quest.acceptance);
  const noObservationTrust = {
    ...trust, verifyObservation: () => false,
    verifyAuthorization: () => true
  };
  assert.equal(projectQuest(quest, [auth, event], noObservationTrust).status, QUEST_STATUS.AUTHORIZED);
  assert.equal(projectQuest(quest, [auth, event]).status, QUEST_STATUS.OPEN);
});

test("rejected evidence cannot satisfy acceptance", () => {
  const event = {
    event_id: "bad", event_type: "EXECUTION_ADJUDICATION",
    subject: quest.quest_id, admission: "REJECTED", outcome: "SUCCEEDED",
    acceptance_satisfied: quest.acceptance
  };
  assert.equal(projectQuest(quest, [auth, event], trust).status, QUEST_STATUS.AUTHORIZED);
});
