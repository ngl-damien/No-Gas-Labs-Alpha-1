'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {sign,gate}=require('./authority-gate');
const key='LOCAL-TEST-ONLY-REPLACE-IN-REAL-DEPLOYMENT';
const grants={g:{subject:'alice',scopes:['AWARD_XP','RECORD_LOCATION'],expiresAt:2000,maxXp:25},
  admin:{subject:'admin',scopes:['REVOKE_GRANT','SET_QUEST_STATUS'],expiresAt:2000}};
function signed(body){return {...body,mac:sign(key,body)};}
function setup(){return gate({issuerKey:key,grants,now:()=>1000});}
test('valid scoped reward and replay denial',()=>{
 const g=setup(), e=signed({id:'1',grantId:'g',actor:'alice',action:'AWARD_XP',xp:25});
 assert.equal(g.accept(e).ok,true);assert.equal(g.accept(e).reason,'REPLAY_OR_BAD_ID');
});
test('tampered reward and over-limit signed reward rejected',()=>{
 const g=setup(),e=signed({id:'2',grantId:'g',actor:'alice',action:'AWARD_XP',xp:25});
 assert.equal(g.accept({...e,xp:999}).reason,'INVALID_SIGNATURE');
 assert.equal(g.accept(signed({...e,id:'3',xp:999,mac:undefined})).reason,'REWARD_OUT_OF_SCOPE');
});
test('unprivileged verdict and revocation rejected',()=>{
 const g=setup();
 assert.equal(g.accept(signed({id:'4',grantId:'g',actor:'alice',action:'SET_QUEST_STATUS',status:'COMPLETED'})).reason,'NOT_AUTHORIZED');
 assert.equal(g.accept(signed({id:'5',grantId:'g',actor:'alice',action:'REVOKE_GRANT',targetGrantId:'g'})).reason,'NOT_AUTHORIZED');
});
test('authorized revocation blocks subsequent reward',()=>{
 const g=setup();
 assert.equal(g.accept(signed({id:'6',grantId:'admin',actor:'admin',action:'REVOKE_GRANT',targetGrantId:'g'})).ok,true);
 assert.equal(g.accept(signed({id:'7',grantId:'g',actor:'alice',action:'AWARD_XP',xp:2})).reason,'NOT_AUTHORIZED');
});
test('consent flag alone and invalid coordinates rejected',()=>{
 const g=setup(),base={id:'8',grantId:'g',actor:'alice',action:'RECORD_LOCATION',lat:40,lon:-105,location_consent:true};
 assert.equal(g.accept(signed(base)).reason,'INVALID_LOCATION_OR_CONSENT_RECEIPT');
 const receipt={subject:'alice',purpose:'location',expiresAt:1500};
 receipt.mac=sign(key,receipt);
 assert.equal(g.accept(signed({...base,id:'9',lat:999,consentReceipt:receipt})).reason,'INVALID_LOCATION_OR_CONSENT_RECEIPT');
});
test('signed consent receipt accepted only as issuer attestation',()=>{
 const g=setup(),r={subject:'alice',purpose:'location',expiresAt:1500};r.mac=sign(key,r);
 assert.equal(g.accept(signed({id:'10',grantId:'g',actor:'alice',action:'RECORD_LOCATION',lat:40,lon:-105,consentReceipt:r})).ok,true);
});
test('expired grants rejected',()=>{
 const g=gate({issuerKey:key,grants,now:()=>2000});
 assert.equal(g.accept(signed({id:'11',grantId:'g',actor:'alice',action:'AWARD_XP',xp:1})).reason,'NOT_AUTHORIZED');
});
