import test from "node:test";
import assert from "node:assert/strict";
import {normalizeFix} from "../src/location/consent.js";
import {createLocationObservation,projectLocationEvidence} from "../src/location/evidence.js";
import {defineQuest,projectQuest,QUEST_STATUS} from "../src/quest/engine.js";
import {projectWorld} from "../src/world/project.js";
import {projectRealm} from "../src/world/realm.js";

const fix=normalizeFix({coords:{latitude:39.1234,longitude:-94.5678,accuracy:30},timestamp:Date.parse("2026-10-08T12:00:00Z")});
const quest=defineQuest({quest_id:"geo-1",title:"Field research",objective:"Observe",acceptance:["independent-verification"]});
const event=createLocationObservation(fix,{quest_id:"geo-1",event_id:"geo-event-1",consent:true});

test("consent required for location evidence",()=>assert.throws(()=>createLocationObservation(fix,{quest_id:"geo-1",event_id:"x"}),/consent/));
test("location observation is explicitly unverified",()=>{assert.equal(event.authority,"UNVERIFIED");assert.equal(event.observation.verified,false)});
test("quest surfaces observation but does not authorize or complete",()=>{const result=projectQuest(quest,[event]);assert.equal(result.status,QUEST_STATUS.OPEN);assert.equal(result.authorized,false);assert.equal(result.location_observations.length,1)});
test("world grants no XP from location observation",()=>{const result=projectWorld([{...event,world_effect:{xp:999}}]);assert.equal(result.xp,0)});
test("realm routes location evidence to archive",()=>{const realm=projectRealm(projectWorld([event]));assert.deepEqual(realm.institutions.evidence_archive.event_ids,["geo-event-1"])});
test("unrelated quests cannot see location observations",()=>assert.equal(projectLocationEvidence([event],"other").length,0));

test("location observations retain a detached, immutable snapshot of the normalized fix",()=>{
  const source={...fix};
  const recorded=createLocationObservation(source,{quest_id:"geo-1",event_id:"geo-event-copy",consent:true});
  source.latitude=0;
  source.longitude=0;
  assert.equal(recorded.observation.latitude,fix.latitude);
  assert.equal(recorded.observation.longitude,fix.longitude);
  assert.ok(Object.isFrozen(recorded));
  assert.ok(Object.isFrozen(recorded.observation));
});

test("location evidence rejects forged, malformed, and extended fix objects",()=>{
  const invalid=[
    {...fix,verified:true},
    {...fix,authority:"FOUNDER"},
    {...fix,source:"user-input"},
    {...fix,latitude:91},
    {...fix,accuracy_m:-1},
    {...fix,observed_at:"not-a-timestamp"},
    {...fix,unexpected:"extra-field"}
  ];
  for(const candidate of invalid){
    assert.throws(
      ()=>createLocationObservation(candidate,{quest_id:"geo-1",event_id:"invalid-fix",consent:true}),
      /untrusted location fix/
    );
  }
});

test("location evidence rejects accessor-backed fixes without executing getters",()=>{
  let reads=0;
  const hostile={...fix};
  Object.defineProperty(hostile,"latitude",{enumerable:true,get(){reads++;return fix.latitude}});
  assert.throws(
    ()=>createLocationObservation(hostile,{quest_id:"geo-1",event_id:"accessor-fix",consent:true}),
    /untrusted location fix/
  );
  assert.equal(reads,0);
});

test("location evidence rejects accessor-backed consent options without executing getters",()=>{
  let reads=0;
  const options={consent:true,event_id:"accessor-options"};
  Object.defineProperty(options,"quest_id",{enumerable:true,get(){reads++;return "geo-1"}});
  assert.throws(()=>createLocationObservation(fix,options),/invalid observation options/);
  assert.equal(reads,0);
});

test("projection drops forged or malformed location events and returns a fresh frozen fix",()=>{
  const forged={...event,observation:{...fix,verified:true}};
  const wrongSubject={...event,subject:"other"};
  const wrongAdmission={...event,admission:"ACCEPTED"};
  const projected=projectLocationEvidence([event,forged,wrongSubject,wrongAdmission],"geo-1");
  assert.equal(projected.length,1);
  assert.equal(projected[0].event_id,event.event_id);
  assert.deepEqual(projected[0].observation,fix);
  assert.ok(Object.isFrozen(projected));
  assert.ok(Object.isFrozen(projected[0]));
  assert.ok(Object.isFrozen(projected[0].observation));
});
