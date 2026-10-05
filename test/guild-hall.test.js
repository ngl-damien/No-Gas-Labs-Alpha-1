import test from "node:test"; import assert from "node:assert/strict";
import {defineQuest,authorizeQuest} from "../src/quest/engine.js";
import {replayInstitution} from "../src/world/spine.js";
import {projectGuildHall,proposeGuildAction} from "../src/world/guild-hall.js";

const quest=defineQuest({quest_id:"q1",title:"Reconstitute Alpha-1",objective:"Build through demonstrated work.",acceptance:["mesh"],capabilities:["repository.write"]});
const empty=replayInstitution({events:[],quests:[quest],resolveArtifact:()=>null});
const proposal=proposeGuildAction({quest_id:"q1",proposal_id:"p1",actor:"critic-agent",summary:"Harden Mesh",capability:"repository.write"});

test("room renders projected truth rather than optimistic UI state",()=>{
 const room=projectGuildHall({institution:empty,quest_id:"q1",events:[],agents:[]});
 assert.equal(room.quest.status,"OPEN"); assert.equal(room.quest.acceptance[0].status,"UNPROVEN"); assert.equal(room.exits.forge,"LOCKED");
});

test("proposal opens a route to Decision Chamber but not the Forge",()=>{
 const room=projectGuildHall({institution:empty,quest_id:"q1",events:[proposal],agents:[]});
 assert.equal(room.proposals[0].status,"PROPOSED"); assert.equal(room.exits.decision_chamber,"AVAILABLE"); assert.equal(room.exits.forge,"LOCKED");
});

test("authorization changes proposal state without fabricating completion",()=>{
 const auth={...authorizeQuest({quest,grant_id:"g1"}),proposal_id:"p1"};
 const institution=replayInstitution({events:[proposal,auth],quests:[quest],resolveArtifact:()=>null});
 const room=projectGuildHall({institution,quest_id:"q1",events:[proposal,auth],agents:[]});
 assert.equal(room.proposals[0].status,"AUTHORIZED"); assert.equal(room.quest.status,"AUTHORIZED"); assert.equal(room.exits.forge,"LOCKED");
});

test("capability roster reports fit but grants no authority",()=>{
 const room=projectGuildHall({institution:empty,quest_id:"q1",events:[],agents:[{agent_id:"builder",capabilities:["repository.write"]},{agent_id:"poet",capabilities:["verse"]}]});
 assert.equal(room.roster[0].can_contribute,true); assert.equal(room.roster[1].can_contribute,false); assert.equal(room.quest.status,"OPEN");
});
