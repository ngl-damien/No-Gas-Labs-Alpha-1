import test from "node:test"; import assert from "node:assert/strict";
import {defineQuest,authorizeQuest} from "../src/quest/engine.js";
import {makeReceipt} from "../src/evidence/content-addressed.js";
import {replayInstitution,verifyReplay} from "../src/world/spine.js";

const quest=defineQuest({quest_id:"reconstitute-alpha-1",title:"Reconstitute Alpha-1",objective:"Build the lab by demonstrated work.",acceptance:["mesh-protocol"],capabilities:["repository.write"]});
const bytes=Buffer.from("mesh protocol artifact"), receipt=makeReceipt(bytes);
const auth=authorizeQuest({quest,grant_id:"g1"});
const done={event_id:"e1",parents:[auth.event_id],event_type:"EXECUTION_ADJUDICATION",subject:quest.quest_id,quest_id:quest.quest_id,grant_id:"g1",admission:"ACCEPTED",authority:"AUTHORIZED",execution:"EXECUTED",evidence:"OBSERVED",outcome:"SUCCEEDED",receipts:[receipt],acceptance_satisfied:["mesh-protocol"],world_effect:{xp:100,inventory:{alpha_1_seal:1},world:{forgeOpen:true}}};
const events=[auth,done], resolve=r=>r.digest===receipt.digest?bytes:null;

test("same canonical history reconstructs identical institutional state",()=>{
 const a=replayInstitution({events,quests:[quest],resolveArtifact:resolve});
 const b=replayInstitution({events:structuredClone(events),quests:[structuredClone(quest)],resolveArtifact:resolve});
 assert.equal(a.state_hash,b.state_hash); assert.deepEqual(a.projection,b.projection);
 assert.equal(a.projection.quests[quest.quest_id].status,"COMPLETED"); assert.equal(a.projection.world.xp,100);
});

test("tampered consequence produces a different state hash",()=>{
 const baseline=replayInstitution({events,quests:[quest],resolveArtifact:resolve});
 const tampered=structuredClone(events); tampered[1].world_effect.xp=1000000;
 const replay=verifyReplay({events:tampered,quests:[quest],resolveArtifact:resolve,expected_hash:baseline.state_hash});
 assert.equal(replay.matches,false);
});

test("history cannot reference a future or missing parent",()=>{
 assert.throws(()=>replayInstitution({events:[done,auth],quests:[quest],resolveArtifact:resolve}),/unresolved parent/);
});

test("duplicate event identities are rejected instead of silently replayed",()=>{
 assert.throws(()=>replayInstitution({events:[auth,auth],quests:[quest],resolveArtifact:resolve}),/duplicate or missing/);
});
