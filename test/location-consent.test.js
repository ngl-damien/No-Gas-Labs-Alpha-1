import test from "node:test";
import assert from "node:assert/strict";
import {normalizeFix,createLocationController} from "../src/location/consent.js";
const position={coords:{latitude:39.123456,longitude:-94.654321,accuracy:13.2},timestamp:Date.parse("2026-10-08T12:00:00Z")};

test("coarse location is default",()=>{
  const x=normalizeFix(position);
  assert.equal(x.latitude,39.12);
  assert.equal(x.longitude,-94.65);
  assert.equal(x.verified,false);
});
test("precise requires explicit selection",()=>assert.equal(normalizeFix(position,{precision:"precise"}).latitude,39.12346));
test("rejects invalid coordinates",()=>assert.throws(()=>normalizeFix({coords:{latitude:120,longitude:0}})));
test("rejects invalid precision",()=>assert.throws(()=>normalizeFix(position,{precision:"raw"})));
test("no request occurs without user call",()=>{let called=0;createLocationController({getCurrentPosition(){called++}});assert.equal(called,0)});
test("permission errors propagate",async()=>{const c=createLocationController({getCurrentPosition(ok,err){err(new Error("denied"))}});await assert.rejects(c.request(),/denied/)});
test("high accuracy is opt-in",async()=>{let high;const c=createLocationController({getCurrentPosition(ok,err,opts){high=opts.enableHighAccuracy;ok(position)}});await c.request();assert.equal(high,false);await c.request({precision:"precise"});assert.equal(high,true)});

test("preserves a valid epoch-zero device timestamp instead of replacing it with the current time",()=>{
  const x=normalizeFix({...position,timestamp:0});
  assert.equal(x.observed_at,"1970-01-01T00:00:00.000Z");
});
test("rejects negative sensor accuracy, including negative infinity",()=>{
  for(const accuracy of [-1,-Infinity]){
    assert.throws(()=>normalizeFix({...position,coords:{...position.coords,accuracy}}),/invalid accuracy/);
  }
});
test("rejects non-finite, negative, or non-numeric device timestamps",()=>{
  for(const timestamp of [NaN,Infinity,-1,"2026-10-08T12:00:00Z"]){
    assert.throws(()=>normalizeFix({...position,timestamp}),/invalid location timestamp/);
  }
});
