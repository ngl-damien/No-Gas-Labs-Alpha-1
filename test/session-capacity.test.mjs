import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createGameServer} from '../game/server.mjs';
test('anonymous session turnover does not evict an authenticated Founder',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ngl-session-capacity-'));const server=await createGameServer({dataDir:directory,founderKey:'fake-capacity-key-not-a-secret'});
 try{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const login=await fetch(origin+'/api/login',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({key:'fake-capacity-key-not-a-secret'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];await login.json();
 for(let i=0;i<512;i++){const response=await fetch(origin+'/api/state');assert.equal(response.status,200);await response.json();}
 const response=await fetch(origin+'/api/state',{headers:{cookie}});assert.equal((await response.json()).viewer.role,'founder');
 }finally{await server.closeGame();await rm(directory,{recursive:true,force:true});}
});
test('expired authenticated sessions do not reserve capacity forever',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ngl-session-expiry-')),realNow=Date.now;const server=await createGameServer({dataDir:directory,founderKey:'fake-capacity-key-not-a-secret'});
 try{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const login=()=>fetch(origin+'/api/login',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({key:'fake-capacity-key-not-a-secret'})});
 for(let i=0;i<512;i++){const response=await login();assert.equal(response.status,200);await response.json();}
 Date.now=()=>realNow()+86400001;
 const response=await fetch(origin+'/api/state');assert.equal(response.status,200);assert.equal((await response.json()).viewer.role,'witness');const authenticated=await login();assert.equal(authenticated.status,200);assert.equal((await authenticated.json()).viewer.role,'founder');
 }finally{Date.now=realNow;await server.closeGame();await rm(directory,{recursive:true,force:true});}
});
