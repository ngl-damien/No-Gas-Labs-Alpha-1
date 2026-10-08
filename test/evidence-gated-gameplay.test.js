import test from "node:test";
import assert from "node:assert/strict";
import { projectWorld } from "../src/world/project.js";
import { makeReceipt } from "../src/evidence/content-addressed.js";

const artifact = Buffer.from("actual executed artifact");
const receipt = makeReceipt(artifact);
const authorize = e => e.event_id === "proof-1";
const event = {
  event_id:"proof-1", event_type:"SYSTEM_EVENT", subject:"forge-gate",
  admission:"ACCEPTED", authority:"AUTHORIZED", execution:"EXECUTED",
  evidence:"OBSERVED", outcome:"SUCCEEDED", receipts:[receipt],
  world_effect:{xp:100, inventory:{proof_shard:1}, world:{forgeOpen:true}}
};

test("verified artifact bytes can mint world consequences", () => {
  const s=projectWorld([event], undefined, {resolveArtifact:()=>artifact,authorize});
  assert.equal(s.xp,0);
  assert.equal(s.inventory.proof_shard,undefined);
  assert.equal(s.world.forgeOpen,undefined);
});

test("a VERIFIED-looking label without artifact bytes cannot mint XP", () => {
  const forged={...event,event_id:"proof-2",observation_verification:"VERIFIED"};
  const s=projectWorld([forged]);
  assert.equal(s.xp,0);
  assert.equal(s.world.forgeOpen,undefined);
});

test("mutated artifact bytes invalidate the receipt", () => {
  const s=projectWorld([event], undefined, {resolveArtifact:()=>Buffer.from("different artifact"),authorize});
  assert.equal(s.xp,0);
});

test("forged digest invalidates the receipt", () => {
  const forged={...event,event_id:"proof-3",receipts:[{...receipt,digest:"f".repeat(64)}]};
  const s=projectWorld([forged], undefined, {resolveArtifact:()=>artifact});
  assert.equal(s.xp,0);
});
