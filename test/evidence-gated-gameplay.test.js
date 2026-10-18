import test from "node:test";
import assert from "node:assert/strict";
import { projectWorld } from "../src/world/project.js";
import { makeReceipt } from "../src/evidence/content-addressed.js";

const artifact = Buffer.from("actual executed artifact");
const receipt = makeReceipt(artifact);
const event = {
  event_id:"proof-1", event_type:"SYSTEM_EVENT", subject:"forge-gate",
  admission:"ACCEPTED", authority:"AUTHORIZED", execution:"EXECUTED",
  evidence:"OBSERVED", observation_verification:"VERIFIED", outcome:"SUCCEEDED", receipts:[receipt],
  world_effect:{xp:100, inventory:{proof_shard:1}, world:{forgeOpen:true}}
};

test("verified artifact bytes can mint world consequences", () => {
  const s=projectWorld([event], undefined, {resolveArtifact:()=>artifact});
  assert.equal(s.xp,100);
  assert.equal(s.inventory.proof_shard,1);
  assert.equal(s.world.forgeOpen,true);
});

for (const [label, verification] of [
  ["absent", undefined],
  ["UNVERIFIED", "UNVERIFIED"],
  ["an invalid string", "verified"],
  ["an invalid type", true]
]) {
  test(`valid artifact bytes with ${label} observation verification cannot mint world consequences`, () => {
    const unverified = {...event, event_id:`proof-${label}`};
    if (verification === undefined) delete unverified.observation_verification;
    else unverified.observation_verification = verification;
    const s = projectWorld([unverified], undefined, {resolveArtifact:()=>artifact});
    assert.equal(s.xp, 0);
    assert.deepEqual(s.inventory, {});
    assert.deepEqual(s.world, {});
    assert.equal(s.quests["forge-gate"], undefined);
    assert.deepEqual(s.history, [unverified]);
  });
}

test("a VERIFIED-looking label without artifact bytes cannot mint XP", () => {
  const forged={...event,event_id:"proof-2",observation_verification:"VERIFIED"};
  const s=projectWorld([forged]);
  assert.equal(s.xp,0);
  assert.equal(s.world.forgeOpen,undefined);
});

test("mutated artifact bytes invalidate the receipt", () => {
  const s=projectWorld([event], undefined, {resolveArtifact:()=>Buffer.from("different artifact")});
  assert.equal(s.xp,0);
});

test("forged digest invalidates the receipt", () => {
  const forged={...event,event_id:"proof-3",receipts:[{...receipt,digest:"f".repeat(64)}]};
  const s=projectWorld([forged], undefined, {resolveArtifact:()=>artifact});
  assert.equal(s.xp,0);
});
