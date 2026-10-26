import test from "node:test";
import assert from "node:assert/strict";
import { projectWorld } from "../src/world/project.js";
import { makeReceipt } from "../src/evidence/content-addressed.js";

const artifact = Buffer.from("actual executed artifact");
const receipt = makeReceipt(artifact);
const event = {
  event_id: "proof-1", event_type: "SYSTEM_EVENT", subject: "forge-gate",
  grant_id: "grant-1", admission: "ACCEPTED", authority: "AUTHORIZED",
  execution: "EXECUTED", evidence: "OBSERVED", observation_verification: "VERIFIED",
  outcome: "SUCCEEDED", receipts: [receipt],
  world_effect: { xp: 100, inventory: { proof_shard: 1 }, world: { forgeOpen: true } }
};
const optionsFor = id => ({
  resolveArtifact: () => artifact,
  // These are test doubles for host-owned trust registries, not production trust roots.
  verifyObservation: candidate => candidate.event_id === id,
  verifyAuthorization: candidate => candidate.event_id === id &&
    candidate.grant_id === "grant-1" && candidate.authority === "AUTHORIZED"
});

test("host-verified observation, authorization and actual bytes can mint world consequences", () => {
  const s = projectWorld([event], undefined, optionsFor("proof-1"));
  assert.equal(s.xp, 100);
  assert.equal(s.inventory.proof_shard, 1);
  assert.equal(s.world.forgeOpen, true);
});

test("a VERIFIED-looking label and valid receipt are insufficient without host trust roots", () => {
  const s = projectWorld([event], undefined, { resolveArtifact: () => artifact });
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
  assert.equal(s.history.length, 1);
});

test("a host-verified label without artifact bytes cannot mint XP", () => {
  const forged = { ...event, event_id: "proof-2" };
  const options = {
    verifyObservation: candidate => candidate.event_id === "proof-2",
    verifyAuthorization: candidate => candidate.event_id === "proof-2"
  };
  const s = projectWorld([forged], undefined, options);
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
});

test("mutated artifact bytes invalidate the receipt", () => {
  const s = projectWorld([event], undefined, {
    ...optionsFor("proof-1"), resolveArtifact: () => Buffer.from("different artifact")
  });
  assert.equal(s.xp, 0);
});

test("a forged digest invalidates the receipt even when the host callbacks approve the event", () => {
  const forged = { ...event, event_id: "proof-3", receipts: [{ ...receipt, digest: "f".repeat(64) }] };
  const s = projectWorld([forged], undefined, optionsFor("proof-3"));
  assert.equal(s.xp, 0);
});
