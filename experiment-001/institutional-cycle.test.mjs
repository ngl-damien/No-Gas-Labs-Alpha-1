import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {challenge,competition,demonstrate,openInstitution} from "./institutional-cycle.mjs";
const keys=()=>generateKeyPairSync("ed25519");
const approve=(k,e)=>sign(null,Buffer.from(JSON.stringify(e)),k).toString("base64");
async function temporary(fn) {
  const dir=await mkdtemp(join(tmpdir(),"ngl-cycle-"));
  try {await fn(dir);} finally {await rm(dir,{recursive:true,force:true});}
}
test("competing strategies reject the losing candidate",()=>{
  assert.equal(competition().length,2);
  assert.equal(challenge("square").passed,4);
  assert.ok(challenge("double").passed<4);
});
test("installation and actual invocation survive reopening",()=>temporary(async dir=>{
  const k=keys();
  await demonstrate(dir,k.publicKey,e=>approve(k.privateKey,e));
  const second=await openInstitution(dir,k.publicKey);
  const decision={kind:"REUSE",id:"square-v1",nonce:"second",input:7,output:49};
  await second.commit(decision,approve(k.privateKey,second.proposal(decision)));
  const third=await openInstitution(dir,k.publicKey);
  assert.equal(third.snapshot().invocations[0].output,49);
  await assert.rejects(()=>third.commit(decision,approve(k.privateKey,third.proposal(decision))),/REPLAY/);
}));
test("missing approval and incorrect signer do not install",()=>temporary(async dir=>{
  const k=keys(),other=keys();
  await assert.rejects(()=>demonstrate(dir,k.publicKey),/EXTERNAL_AUTHORIZATION_REQUIRED/);
  await assert.rejects(()=>demonstrate(dir,k.publicKey,e=>approve(other.privateKey,e)),/UNAUTHORIZED/);
  assert.equal((await openInstitution(dir,k.publicKey)).snapshot().sequence,0);
}));
test("incorrect result is not recorded",()=>temporary(async dir=>{
  const k=keys();
  await demonstrate(dir,k.publicKey,e=>approve(k.privateKey,e));
  const inst=await openInstitution(dir,k.publicKey);
  const decision={kind:"REUSE",id:"square-v1",nonce:"wrong",input:7,output:14};
  await assert.rejects(()=>inst.commit(decision,approve(k.privateKey,inst.proposal(decision))),/OUTPUT_MISMATCH/);
  assert.equal(inst.snapshot().sequence,1);
}));
test("replayed ledger rejects modifications",()=>temporary(async dir=>{
  const k=keys();
  await demonstrate(dir,k.publicKey,e=>approve(k.privateKey,e));
  const path=join(dir,"institution.json");
  const state=JSON.parse(await readFile(path,"utf8"));
  state.records[0].decision.id="different";
  await writeFile(path,JSON.stringify(state));
  await assert.rejects(()=>openInstitution(dir,k.publicKey),/UNAUTHORIZED_RECORD/);
}));
