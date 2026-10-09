import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocationCapsule,verifyLocationCapsule,isLocationObservation} from '../src/location/capsule.js';
const fix={schema:'ngl.location.fix.v1',latitude:0,longitude:0,accuracy_m:500,precision:'coarse',observed_at:'2026-10-09T00:00:00.000Z',source:'synthetic-demo',authority:'USER_CONSENT_REQUIRED',verified:false};
const event={event_id:'sample:001',event_type:'LOCATION_OBSERVATION',quest_id:'sample',subject:'sample',admission:'PROPOSED',authority:'UNVERIFIED',evidence:'SELF_REPORTED',observation:fix,location_consent:true};
test('digest matches original',()=>assert.equal(verifyLocationCapsule(createLocationCapsule(event)).integrity,'MATCH'));
test('digest detects changes',()=>{const c=createLocationCapsule(event);assert.equal(verifyLocationCapsule({...c,event:{...event,observation:{...fix,latitude:1}}}).integrity,'REJECTED')});
test('digest does not prove presence',()=>assert.equal(verifyLocationCapsule(createLocationCapsule(event)).physical_presence,'UNVERIFIED'));
test('location cannot claim rewards',()=>assert.equal(isLocationObservation({...event,world_effect:{xp:10}}),false));
