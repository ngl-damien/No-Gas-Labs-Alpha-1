import test from "node:test";
import assert from "node:assert/strict";
import { projectWorld } from "../src/world/project.js";
import { makeReceipt } from "../src/evidence/content-addressed.js";

const artifact = Buffer.from("actual executed artifact");
const receipt = makeReceipt(artifact);
const verifyObservation = event => ["proof-1", "proof-2", "proof-3"].includes(event.event_id);
const verifyAuthorization = event => event?.grant_id === "g-proof" && event?.authority === "AUTHORIZED";
const event = {
  event_id: "proof-1",
  event_type: "SYSTEM_EVENT",
  subject: "forge-gate",
  grant_id: "g-proof",
  admission: "ACCEPTED",
  authority: "AUTHORIZED",
  execution: "EXECUTED",
  evidence: "OBSERVED",
  observation_verification: "VERIFIED",
  outcome: "SUCCEEDED",
  receipts: [receipt],
  world_effect: { xp: 100, inventory: { proof_shard: 1 }, world: { forgeOpen: true } }
};

test("verified artifact bytes and separate authorization can mint world consequences", () => {
  const state = projectWorld([event], undefined, {
    resolveArtifact: () => artifact, verifyObservation, verifyAuthorization
  });
  assert.equal(state.xp, 100);
  assert.equal(state.inventory.proof_shard, 1);
  assert.equal(state.world.forgeOpen, true);
});

test("a VERIFIED-looking label without artifact bytes cannot mint XP", () => {
  const forged = { ...event, event_id: "proof-2", observation_verification: "VERIFIED" };
  const state = projectWorld([forged], undefined, { verifyObservation, verifyAuthorization });
  assert.equal(state.xp, 0);
  assert.equal(state.world.forgeOpen, undefined);
});

test("mutated artifact bytes invalidate the receipt", () => {
  const state = projectWorld([event], undefined, {
    resolveArtifact: () => Buffer.from("different artifact"), verifyObservation, verifyAuthorization
  });
  assert.equal(state.xp, 0);
});

test("forged digest invalidates the receipt", () => {
  const forged = { ...event, event_id: "proof-3", receipts: [{ ...receipt, digest: "f".repeat(64) }] };
  const state = projectWorld([forged], undefined, {
    resolveArtifact: () => artifact, verifyObservation, verifyAuthorization
  });
  assert.equal(state.xp, 0);
});

test("observation verifier alone is not authorization", () => {
  const state = projectWorld([event], undefined, { resolveArtifact: () => artifact, verifyObservation });
  assert.equal(state.xp, 0);
  assert.equal(state.inventory.proof_shard, undefined);
});
