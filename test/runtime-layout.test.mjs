import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,cp,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createGameServer} from '../game/server.mjs';
const options=directory=>({dataDir:directory,founderKey:'fake-layout-test-key-not-a-secret'});
test('partial restore cannot silently initialize a missing decision or world store',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ngl-layout-'));
 try{const original=join(root,'original');const server=await createGameServer(options(original));await server.closeGame();
  for(const missing of ['service.json','decisions/decisions.json']){const copy=join(root,missing.startsWith('service')?'world-missing':'decisions-missing');await cp(original,copy,{recursive:true});await rm(join(copy,missing));const other=missing.startsWith('service')?'decisions/decisions.json':'service.json',before=await readFile(join(copy,other));await assert.rejects(async()=>{const unexpected=await createGameServer(options(copy));await unexpected.closeGame();},/incomplete|missing|required/i);assert.deepEqual(await readFile(join(copy,other)),before);}
 }finally{await rm(root,{recursive:true,force:true});}
});
test('an initialized layout detects deletion of both stores and preserves its anchor',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ngl-layout-both-'));
 try{const server=await createGameServer(options(directory));await server.closeGame();await rm(join(directory,'service.json'));await rm(join(directory,'decisions/decisions.json'));await assert.rejects(async()=>{const unexpected=await createGameServer(options(directory));await unexpected.closeGame();},/incomplete|missing|required/i);}finally{await rm(directory,{recursive:true,force:true});}
});
test('an intact prior two-store runtime can be adopted and reopened without changing either store',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ngl-layout-intact-'));
 try{let server=await createGameServer(options(directory));await server.closeGame();await rm(join(directory,'runtime-layout.json'),{force:true});const before=await readFile(join(directory,'service.json'));server=await createGameServer(options(directory));await server.closeGame();assert.deepEqual(await readFile(join(directory,'service.json')),before);assert.equal(JSON.parse(await readFile(join(directory,'runtime-layout.json'),'utf8')).schema,'ngl.runtime-layout.v1');}finally{await rm(directory,{recursive:true,force:true});}
});
test('invalid startup configuration does not poison a fresh runtime directory',async()=>{
 for(const invalid of [{founderKey:'short'},{institutionReport:{schema:'invalid'}}]){const directory=await mkdtemp(join(tmpdir(),'ngl-layout-config-'));try{await assert.rejects(createGameServer({...options(directory),...invalid}));const server=await createGameServer(options(directory));await server.closeGame();}finally{await rm(directory,{recursive:true,force:true});}}
});
