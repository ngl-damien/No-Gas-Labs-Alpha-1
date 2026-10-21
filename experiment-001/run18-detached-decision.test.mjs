import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openInstitution,challenge} from "./institutional-cycle.mjs";

test("signed decision bytes are detached from later caller mutations",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ngl-authority-regression-"));
 try {
  const key=generateKeyPairSync("ed25519");
  const institution=await openInstitution(dir,key.publicKey);
  const decision={kind:"INSTALL",id:"approved",strategy:"square",proof:challenge("square")};
  const signature=sign(null,Buffer.from(JSON.stringify(institution.proposal(decision))),key.privateKey).toString("base64");
  await institution.commit(decision,signature);
  decision.id="unapproved";decision.proof.passed=0;
  assert.equal(institution.snapshot().records[0].decision.id,"approved");
  assert.equal(institution.snapshot().capabilities.approved.strategy,"square");
  assert.equal((await openInstitution(dir,key.publicKey)).snapshot().records[0].decision.id,"approved");
 } finally {await rm(dir,{recursive:true,force:true});}
});
