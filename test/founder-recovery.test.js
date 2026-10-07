import test from "node:test";
import assert from "node:assert/strict";
import {answerCommitment,createRecoveryPolicy,verifyRecoveryAnswers,recoveryAuthorization} from "../src/authority/recovery.js";

const mk=(id,prompt,salt,answer)=>({challenge_id:id,prompt,salt,answer_commitment:answerCommitment({salt,answer})});
const policy=createRecoveryPolicy({policy_id:"founder-recovery-v1",threshold:3,challenges:[
  mk("c1","Private challenge one","salt-111111111111","alpha"),
  mk("c2","Private challenge two","salt-222222222222","bravo"),
  mk("c3","Private challenge three","salt-333333333333","charlie"),
  mk("c4","Private challenge four","salt-444444444444","delta"),
  mk("c5","Private challenge five","salt-555555555555","echo")
]});

test("threshold of independent answers authorizes recovery",()=>{
  const v=verifyRecoveryAnswers({policy,responses:[{challenge_id:"c1",answer:"Alpha"},{challenge_id:"c2",answer:" bravo "},{challenge_id:"c3",answer:"CHARLIE"}]});
  assert.equal(v.valid,true);
  const a=recoveryAuthorization({policy,verification:v,new_key_fingerprint:"new-founder-key",ceremony_id:"ceremony-001"});
  assert.equal(a.claim,"AUTHENTICATED_AS_NGL_FOUNDER");
  assert.equal(a.new_key_fingerprint,"new-founder-key");
});

test("insufficient correct answers fail closed",()=>{
  const v=verifyRecoveryAnswers({policy,responses:[{challenge_id:"c1",answer:"alpha"},{challenge_id:"c2",answer:"wrong"},{challenge_id:"c3",answer:"charlie"}]});
  assert.equal(v.valid,false); assert.equal(v.reason,"QUORUM_NOT_MET"); assert.equal(v.matched,2);
});

test("duplicate response cannot count twice",()=>{
  const v=verifyRecoveryAnswers({policy,responses:[{challenge_id:"c1",answer:"alpha"},{challenge_id:"c1",answer:"alpha"},{challenge_id:"c2",answer:"bravo"}]});
  assert.equal(v.valid,false); assert.equal(v.matched,2);
});

test("unknown challenge cannot contribute to quorum",()=>{
  const v=verifyRecoveryAnswers({policy,responses:[{challenge_id:"c1",answer:"alpha"},{challenge_id:"c2",answer:"bravo"},{challenge_id:"bogus",answer:"anything"}]});
  assert.equal(v.valid,false); assert.equal(v.matched,2);
});

test("policy rejects duplicate challenge ids",()=>assert.throws(()=>createRecoveryPolicy({policy_id:"x",threshold:2,challenges:[
  mk("same","Private challenge one","salt-111111111111","a"),
  mk("same","Private challenge two","salt-222222222222","b")
]}),/unique challenge_id/));

test("recovery authorization cannot be minted from failed quorum",()=>{
  const v=verifyRecoveryAnswers({policy,responses:[]});
  assert.throws(()=>recoveryAuthorization({policy,verification:v,new_key_fingerprint:"k",ceremony_id:"c"}),/verified recovery quorum/);
});
