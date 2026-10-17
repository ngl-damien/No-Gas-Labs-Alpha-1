import test from "node:test";
import assert from "node:assert/strict";
import { projectWorld } from "../src/world/project.js";
import { makeReceipt } from "../src/evidence/content-addressed.js";

const bytes = Buffer.from("genuine output");
const grant = "authorized-grant-1";
const event = {
  event_id: "authorization-attempt",
  event_type: "EXECUTION_ADJUDICATION",
  subject: "q1",
  grant_id: grant,
  admission: "ACCEPTED",
  authority: "AUTHORIZED",
  execution: "EXECUTED",
  evidence: "OBSERVED",
  outcome: "SUCCEEDED",
  receipts: [makeReceipt(bytes)],
  world_effect: { xp: 100, inventory: { token: 1 }, world: { forgeOpen: true } }
};
const resolveArtifact = () => bytes;

test("strict projection refuses to run without an independent authorization verifier", () => {
  assert.throws(
    () => projectWorld([event], undefined, { resolveArtifact, requireVerifiedAuthorization: true }),
    /authorization verifier required/
  );
});

test("forged AUTHORIZED label cannot award rewards when independent verification rejects it", () => {
  const world = projectWorld([event], undefined, {
    resolveArtifact,
    requireVerifiedAuthorization: true,
    verifyAuthorization: () => false
  });
  assert.equal(world.xp, 0);
  assert.deepEqual(world.inventory, {});
  assert.deepEqual(world.world, {});
  assert.equal(world.quests.q1, undefined);
  assert.equal(world.history.length, 1);
});

test("a trusted grant verifier permits evidence-backed consequences", () => {
  const world = projectWorld([event], undefined, {
    resolveArtifact,
    requireVerifiedAuthorization: true,
    verifyAuthorization: e => e.grant_id === grant
  });
  assert.equal(world.xp, 100);
  assert.equal(world.inventory.token, 1);
  assert.equal(world.world.forgeOpen, true);
});

test("verified evidence cannot substitute for authorization", () => {
  const world = projectWorld([{ ...event, event_id: "wrong-grant", grant_id: "forged-grant" }], undefined, {
    resolveArtifact,
    requireVerifiedAuthorization: true,
    verifyAuthorization: e => e.grant_id === grant
  });
  assert.equal(world.xp, 0);
});

test("authorization is checked for each reward-bearing event, not merely once", () => {
  let calls = 0;
  const world = projectWorld([event, { ...event, event_id: "second", grant_id: "forged-grant" }], undefined, {
    resolveArtifact,
    requireVerifiedAuthorization: true,
    verifyAuthorization: e => { calls++; return e.grant_id === grant; }
  });
  assert.equal(calls, 2);
  assert.equal(world.xp, 100);
});

test("an authorization verifier must affirm with literal true", () => {
  const world = projectWorld([event], undefined, {
    resolveArtifact,
    requireVerifiedAuthorization: true,
    verifyAuthorization: () => ({ valid: true })
  });
  assert.equal(world.xp, 0);
});
