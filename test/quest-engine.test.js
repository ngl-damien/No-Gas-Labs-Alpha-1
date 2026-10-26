import test from "node:test"; import assert from "node:assert/strict";
import {defineQuest,projectQuest,authorizeQuest,QUEST_STATUS} from "../src/quest/engine.js";
import {makeReceipt} from "../src/evidence/content-addressed.js";
const quest=defineQuest({quest_id:"reconstitute-alpha-1",title:"Reconstitute Alpha-1",objective:"Make No_Gas_Labs progressively capable without inventing execution.",acceptance:["mesh-protocol","adversarial-tests"],capabilities:["repository.write","evidence.verify"]});
const auth=authorizeQuest({quest,grant_id:"g-alpha"});
const bytes=Buffer.from("independently checked test artifact"), receipt=makeReceipt(bytes);
const verifiedIds=new Set();
const resolveArtifact=r=>r.digest===receipt.digest?bytes:null;
const verifyObservation=event=>verifiedIds.has(event.event_id);
const project=(events)=>projectQuest(quest,events,{resolveArtifact,verifyObservation});
function execution(event_id,acceptance_satisfied){
 return {event_id,event_type:"EXECUTION_ADJUDICATION",quest_id:quest.quest_id,subject:quest.quest_id,grant_id:"g-alpha",admission:"ACCEPTED",authority:"AUTHORIZED",execution:"EXECUTED",evidence:"OBSERVED",observation_verification:"VERIFIED",outcome:"SUCCEEDED",receipts:[receipt],acceptance_satisfied};
}
test("definition alone earns nothing",()=>assert.equal(projectQuest(quest).status,QUEST_STATUS.OPEN));
test("authorization is not completion",()=>assert.equal(projectQuest(quest,[auth]).status,QUEST_STATUS.AUTHORIZED));
test("executor-shaped claim cannot complete quest",()=>assert.equal(projectQuest(quest,[auth,{quest_id:quest.quest_id,outcome:"SUCCEEDED",acceptance_satisfied:quest.acceptance}]).status,QUEST_STATUS.AUTHORIZED));
test("partial accepted evidence remains in progress",()=>{const e=execution("e1",["mesh-protocol"]);verifiedIds.add(e.event_id);assert.equal(project([auth,e]).status,QUEST_STATUS.IN_PROGRESS);});
test("all acceptance conditions require independently verified accepted adjudications",()=>{const es=quest.acceptance.map((a,i)=>execution(`e${i}`,[a]));es.forEach(e=>verifiedIds.add(e.event_id));assert.equal(project([auth,...es]).status,QUEST_STATUS.COMPLETED);});
test("rejected evidence cannot satisfy acceptance without trusted adjudication",()=>{const e={event_id:"bad",event_type:"EXECUTION_ADJUDICATION",subject:quest.quest_id,admission:"REJECTED",outcome:"SUCCEEDED",acceptance_satisfied:quest.acceptance};assert.equal(project([auth,e]).status,QUEST_STATUS.AUTHORIZED);});
