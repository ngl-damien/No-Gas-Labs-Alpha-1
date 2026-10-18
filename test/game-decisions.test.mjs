import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGameServer} from '../game/server.mjs';
import {artifactReceipt} from '../src/institution/kernel.mjs';
const key='explicitly-fake-decision-http-test-key';
async function host(directory){const server=await createGameServer({dataDir:directory,founderKey:key});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;return {server,url,client(){let cookie='';return {async request(path,value,headers={}){const response=await fetch(url+path,{method:value===undefined?'GET':'POST',headers:{cookie,...(value===undefined?{}:{'content-type':'application/json',origin:url}),...headers},...(value===undefined?{}:{body:JSON.stringify(value)})});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return {status:response.status,body:await response.json()};}}}};}
test('HTTP Founder Gate authenticates, redacts evidence, rejects CSRF/replay and recovers after restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ngl-decision-http-'));let h=await host(directory);
 try{
  const owner=h.client(),witness=h.client();
  assert.equal((await witness.request('/api/decisions/policy',{id:'fixture',reviewWindowMs:86400000,basis:'synthetic test policy'})).status,403);
  assert.equal((await owner.request('/api/login',{key})).status,200);
  const policy=await owner.request('/api/decisions/policy',{id:'fixture',reviewWindowMs:86400000,basis:'synthetic test policy, not operational activation'});assert.equal(policy.status,200,JSON.stringify(policy.body));
  const bytes='PRIVATE_EVALUATION_FIXTURE';const proposal={id:'fixture-review',title:'Synthetic comparison',evaluation:{bytes,receipt:artifactReceipt(bytes)},risks:['Fixture only'],rollback:'No source changed',proposedEffect:'Record a fixture decision; no promotion'};
  assert.equal((await witness.request('/api/decisions/proposals',proposal)).status,403);
  const created=await owner.request('/api/decisions/proposals',proposal);assert.equal(created.status,200);assert.equal(created.body.status,'PENDING');
  assert.match(JSON.stringify((await owner.request('/api/decisions')).body),/PRIVATE_EVALUATION_FIXTURE/);
  assert.doesNotMatch(JSON.stringify((await witness.request('/api/decisions')).body),/PRIVATE_EVALUATION_FIXTURE|synthetic test policy/);
  const choice={decisionId:proposal.id,expectedRevision:1,requestId:'fixture-choice-1',action:'APPROVE'};
  assert.equal((await owner.request('/api/decisions/choose',choice,{origin:'https://unrelated.invalid'})).status,403);
  assert.equal((await witness.request('/api/decisions/choose',choice)).status,403);
  assert.equal((await owner.request('/api/decisions/choose',choice)).body.status,'APPROVED');
  assert.equal((await owner.request('/api/decisions/choose',choice)).body.status,'APPROVED');
  assert.ok((await owner.request('/api/decisions/choose',{...choice,action:'REJECT'})).status>=400);
  await h.server.closeGame();h=await host(directory);
  const fresh=h.client();assert.equal((await fresh.request('/api/state')).body.viewer.role,'witness');
  await fresh.request('/api/login',{key});const restored=(await fresh.request('/api/decisions')).body;
  assert.equal(restored.decisions[0].status,'APPROVED');assert.equal(restored.policy.reviewWindowMs,86400000);
 }finally{await h.server.closeGame();await rm(directory,{recursive:true,force:true});}
});
test('project projection has no synthetic accomplishments or implicit authority when no report is installed',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ngl-project-http-'));const h=await host(directory);
 try{const viewer=h.client();const result=await viewer.request('/api/projects');assert.equal(result.status,200);assert.equal(result.body.projects.length,0);assert.equal(result.body.witnessParticipation,'UNVERIFIED');assert.equal((await viewer.request('/api/state')).body.world.xp,0);}
 finally{await h.server.closeGame();await rm(directory,{recursive:true,force:true});}
});
