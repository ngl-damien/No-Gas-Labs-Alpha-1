import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, readFile, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {challenge,competition,demonstrate,openInstitution,signDecision} from "./institutional-cycle.mjs";
const key="LOCAL-TEST-KEY-NEVER-USE-IN-PRODUCTION";
async function temporary(fn) {
  const dir=await mkdtemp(join(tmpdir(),"ngl-cycle-"));
  try {await fn(dir);} finally {await rm(dir,{recursive:true,force:true});}
}
test("competing strategies face the same adversarial cases",()=>{
  assert.equal(competition().length,2);
  assert.equal(challenge("square").passed,4);
  assert.ok(challenge("double").passed < 4);
});
test("independent reopening discovers installed capability and reuses it",()=>temporary(async dir=>{
  const result=await demonstrate(dir,key);
  assert.equal(result.capability.strategy,"square");
  const next=await openInstitution(dir,key);
  assert.equal(next.snapshot().capabilities["square-v1"].strategy,"square");
  const reuse={kind:"REUSE",id:"square-v1",nonce:"second-session"};
  await next.commit(reuse,signDecision(key,reuse));
  const restarted=await openInstitution(dir,key);
  assert.deepEqual(restarted.snapshot().used,["second-session"]);
  await assert.rejects(()=>restarted.commit(reuse,signDecision(key,reuse)),/REPLAY/);
}));
test("unauthorized and unsupported changes cannot commit",()=>temporary(async dir=>{
  const institution=await openInstitution(dir,key);
  const bad={kind:"INSTALL",id:"bad",strategy:"double",proof:challenge("double")};
  await assert.rejects(()=>institution.commit(bad,"invalid"),/UNAUTHORIZED/);
  await assert.rejects(()=>institution.commit(bad,signDecision(key,bad)),/PROOF_REJECTED/);
  const missing={kind:"REUSE",id:"missing",nonce:"1"};
  await assert.rejects(()=>institution.commit(missing,signDecision(key,missing)),/CAPABILITY_NOT_FOUND/);
  assert.equal(institution.snapshot().sequence,0);
}));
test("tampered persisted snapshot is rejected on restart",()=>temporary(async dir=>{
  await demonstrate(dir,key);
  const path=join(dir,"institution.json");
  const state=JSON.parse(await readFile(path,"utf8"));
  state.capabilities["square-v1"].strategy="double";
  await writeFile(path,JSON.stringify(state));
  await assert.rejects(()=>openInstitution(dir,key),/LEDGER_MISMATCH/);
}));
