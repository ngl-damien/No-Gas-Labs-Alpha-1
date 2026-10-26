import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionRequest, recordExecution, adjudicateExecution, toWorldEvent } from "../src/mesh/execution.js";
import { projectWorld } from "../src/world/project.js";

const request = createExecutionRequest({
  request_id: "r1", quest_id: "q1", grant_id: "g1", capability: "build", outputs: ["apk"]
});
const bytes = Buffer.from("built artifact");
const result = recordExecution({
  request, executor_id: "github-actions", outcome: "SUCCEEDED",
  artifacts: [{ artifact_id: "apk", bytes }]
});
const resolve = ({ artifact_id, receipt }) =>
  artifact_id === "apk" && receipt.digest === result.artifacts[0].receipt.digest ? bytes : null;
const trust = {
  resolveArtifact: receipt => resolve({ artifact_id: "apk", receipt }),
  // Test-only host verifier stand-ins; the result payload cannot provide these callbacks.
  verifyObservation: event => event.event_id === "e1" && event.event_type === "EXECUTION_ADJUDICATION",
  verifyAuthorization: event => event.event_id === "e1" &&
    event.grant_id === request.grant_id && event.authority === "AUTHORIZED"
};

test("executor claim alone cannot create a world consequence", () => {
  assert.equal(
    adjudicateExecution({ request, result: { ...result, artifacts: [] }, resolveArtifact: resolve }).status,
    "REJECTED"
  );
});

test("verified authorized artifact can cross adjudication into gameplay", () => {
  const adjudication = adjudicateExecution({ request, result, resolveArtifact: resolve });
  assert.equal(adjudication.status, "ACCEPTED");
  const event = toWorldEvent({
    event_id: "e1", request, adjudication,
    world_effect: { xp: 10, inventory: { execution_receipt: 1 } }
  });
  const world = projectWorld([event], undefined, trust);
  assert.equal(world.xp, 10);
  assert.equal(world.inventory.execution_receipt, 1);
});

test("missing host verification keeps an accepted-looking event out of canonical progress", () => {
  const adjudication = adjudicateExecution({ request, result, resolveArtifact: resolve });
  const event = toWorldEvent({ event_id: "e1", request, adjudication, world_effect: { xp: 10 } });
  const world = projectWorld([event], undefined, { resolveArtifact: trust.resolveArtifact });
  assert.equal(world.xp, 0);
  assert.equal(world.history.length, 1);
});

test("mutated bytes defeat executor success claim", () => {
  assert.deepEqual(
    adjudicateExecution({ request, result, resolveArtifact: () => Buffer.from("tampered") }),
    { status: "REJECTED", reason: "EVIDENCE_NOT_VERIFIED" }
  );
});

test("result cannot be laundered into another authorization", () => {
  const other = createExecutionRequest({
    request_id: "r2", quest_id: "q1", grant_id: "g2", capability: "build", outputs: ["apk"]
  });
  assert.deepEqual(
    adjudicateExecution({ request: other, result, resolveArtifact: resolve }),
    { status: "REJECTED", reason: "REQUEST_BINDING_MISMATCH" }
  );
});

test("valid receipt for wrong artifact identity cannot substitute", () => {
  const substituted = { ...result, artifacts: [{ ...result.artifacts[0], artifact_id: "report" }] };
  assert.deepEqual(
    adjudicateExecution({ request, result: substituted, resolveArtifact: () => bytes }),
    { status: "REJECTED", reason: "OUTPUT_BINDING_MISMATCH" }
  );
});

test("resolver receives artifact identity and exact request binding", () => {
  let seen;
  const adjudication = adjudicateExecution({
    request, result, resolveArtifact: query => { seen = query; return bytes; }
  });
  assert.equal(adjudication.status, "ACCEPTED");
  assert.equal(seen.artifact_id, "apk");
  assert.equal(seen.request_id, "r1");
});
