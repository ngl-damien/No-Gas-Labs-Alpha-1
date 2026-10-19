import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createGameServer} from '../game/server.mjs';
import {artifactReceipt} from '../src/institution/kernel.mjs';
const key='fake-ten-minute-gate-http-fixture-key';
const bytes='Qualification fixture: local results, unresolved risks; no external certification.';
const proposal={id:'qualification-fixture',title:'Founders Day qualification',evaluation:{bytes,receipt:artifactReceipt(bytes)},risks:['Fixture only'],rollback:'Keep original source',proposedEffect:'Controlled specialist review only; no public deployment.'};
async function host(options={}){const directory=await mkdtemp(join(tmpdir(),'ngl-gate-http-'));const server=await createGameServer({dataDir:directory,founderKey:key,founderGate:proposal,...options});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,directory,origin:`http://127.0.0.1:${server.address().port}`,async close(){await server.closeGame();await rm(directory,{recursive:true,force:true});}};}
test('page status does not start a clock and HTTP cannot activate the operational review',async()=>{const h=await host();try{const state=await fetch(h.origin+'/api/founder-gate');assert.equal(state.status,200);const initial=await state.json();assert.equal(initial.reviewWindowMs,600000);assert.equal(initial.decision,null);assert.equal(initial.ready,false);assert.equal(initial.ceremony.location,'Carter Lake, Iowa');assert.doesNotMatch(JSON.stringify(initial),/Qualification fixture:/);
 const login=await fetch(h.origin+'/api/login',{method:'POST',headers:{origin:h.origin,'content-type':'application/json'},body:JSON.stringify({key})});const cookie=login.headers.get('set-cookie').split(';')[0];await login.json();
 const start=await fetch(h.origin+'/api/founder-gate/activate',{method:'POST',headers:{cookie,origin:h.origin,'content-type':'application/json'},body:'{}'});assert.equal(start.status,503);assert.equal((await start.json()).error.code,'GATE_NOT_READY');assert.equal((await(await fetch(h.origin+'/api/founder-gate',{headers:{cookie}})).json()).decision,null);
 const legacy=async(path,value)=>fetch(h.origin+path,{method:'POST',headers:{cookie,origin:h.origin,'content-type':'application/json'},body:JSON.stringify(value)});
 assert.equal((await legacy('/api/decisions/policy',{id:'alternate-qualification',reviewWindowMs:600000,basis:'synthetic alternate policy'})).status,200);
 const bypass=await legacy('/api/decisions/proposals',proposal);assert.equal(bypass.status,403);assert.equal((await bypass.json()).error.code,'GATE_ROUTE_REQUIRED');
 assert.equal((await legacy('/api/decisions/choose',{decisionId:proposal.id,expectedRevision:1,requestId:'legacy-bypass',action:'APPROVE'})).status,403);
 }finally{await h.close();}});
test('verified TLS session starts one ten-minute review and records a scoped choice',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ngl-gate-tls-'));let h,agent;
 try{execFileSync('/usr/bin/openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-days','1','-nodes','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,DNS:founder.example.test,IP:127.0.0.1','-keyout',join(directory,'fixture.key'),'-out',join(directory,'fixture.crt')],{stdio:'ignore'});
 const cert=await readFile(join(directory,'fixture.crt'));h=await host({tls:{key:await readFile(join(directory,'fixture.key')),cert},founderGateOrigin:'https://founder.example.test'});agent=new https.Agent({ca:cert});
 function client(){let cookie='';return async(path,value,extra={})=>new Promise((resolve,reject)=>{const body=value===undefined?null:JSON.stringify(value);const request=https.request({hostname:'127.0.0.1',port:h.server.address().port,path,method:body===null?'GET':'POST',agent,headers:{host:'founder.example.test',cookie,...(body===null?{}:{origin:'https://founder.example.test','content-type':'application/json','content-length':Buffer.byteLength(body)}),...extra}},response=>{if(response.headers['set-cookie'])cookie=response.headers['set-cookie'][0].split(';')[0];const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{try{resolve({status:response.statusCode,headers:response.headers,body:JSON.parse(Buffer.concat(chunks))});}catch(error){reject(error);}});});request.on('error',reject);request.end(body);});}
 const owner=client(),witness=client();assert.equal((await witness('/api/founder-gate/activate',{})).status,403);assert.equal((await owner('/api/login',{key})).status,200);const initial=await owner('/api/founder-gate');assert.equal(initial.body.ready,true);assert.equal(initial.body.decision,null);
 const start=await owner('/api/founder-gate/activate',{});assert.equal(start.status,200,JSON.stringify(start.body));const decision=start.body.decision;assert.equal(Date.parse(decision.expiresAt)-Date.parse(decision.createdAt),600000);assert.equal(decision.status,'PENDING');assert.equal((await owner('/api/founder-gate/activate',{})).body.decision.expiresAt,decision.expiresAt);
 const publicState=await witness('/api/founder-gate');assert.doesNotMatch(JSON.stringify(publicState.body),/Qualification fixture:/);assert.equal((await witness('/api/founder-gate/choose',{expectedRevision:1,requestId:'witness-choice',action:'APPROVE'})).status,403);
 const choice={expectedRevision:decision.revision,requestId:'actual-fixture-choice',action:'DEFER'};assert.equal((await owner('/api/founder-gate/choose',choice,{origin:'https://unrelated.invalid'})).status,403);const chosen=await owner('/api/founder-gate/choose',choice);assert.equal(chosen.status,200,JSON.stringify(chosen.body));assert.equal(chosen.body.decision.status,'DEFERRED');assert.equal((await owner('/api/founder-gate/choose',choice)).body.decision.status,'DEFERRED');assert.equal((await owner('/api/state')).body.world.xp,0);assert.equal((await owner('/api/decisions')).body.decisions.length,1);
 }finally{agent?.destroy();if(h)await h.close();await rm(directory,{recursive:true,force:true});}
});
