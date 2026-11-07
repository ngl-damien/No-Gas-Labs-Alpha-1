import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inflateRawSync} from 'node:zlib';
import {runInNewContext} from 'node:vm';
import {buildGame} from '../scripts/build-game.mjs';
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'ngl-pack-'));await mkdir(join(dir,'game/assets/comic'),{recursive:true});await mkdir(join(dir,'.runtime'));await writeFile(join(dir,'.runtime/operator.key'),'FAKE_PRIVATE_FIXTURE');await writeFile(join(dir,'game/index.html'),'<html><head><link rel="manifest" href="./manifest.webmanifest"><link rel="stylesheet" href="./styles.css"></head><body><script type="module" src="./client.mjs"></script></body></html>');await writeFile(join(dir,'game/styles.css'),'body{color:teal}');await writeFile(join(dir,'game/client.mjs'),'import {name} from "./helper.mjs";document.title=name;');await writeFile(join(dir,'game/helper.mjs'),'export const name="real instrument";');await writeFile(join(dir,'game/assets/comic/cover_a.jpg'),'IMAGE_BYTES');return dir;}
function unzip(bytes){const entries=new Map();let at=0;while(bytes.readUInt32LE(at)===0x04034b50){const method=bytes.readUInt16LE(at+8),size=bytes.readUInt32LE(at+18),n=bytes.readUInt16LE(at+26),extra=bytes.readUInt16LE(at+28),name=bytes.subarray(at+30,at+30+n).toString(),start=at+30+n+extra,raw=bytes.subarray(start,start+size);entries.set(name,method===8?inflateRawSync(raw):raw);at=start+size;}assert.equal(bytes.readUInt32LE(at),0x02014b50);return entries;}
test('standalone carries recursive modules, styles and unchanged original assets',async()=>{const dir=await fixture();try{const r=await buildGame({rootDir:dir});const html=await readFile(r.htmlPath,'utf8');assert.ok(html.includes('data:text/javascript;base64,'));assert.ok(html.includes('body{color:teal}'));assert.ok(html.includes(Buffer.from('IMAGE_BYTES').toString('base64')));assert.ok(html.includes('NGL_ASSETS'));assert.ok(!html.includes('manifest.webmanifest'));assert.ok(!html.includes('src="./client.mjs"'));}finally{await rm(dir,{recursive:true,force:true});}});
test('distribution is independently readable ZIP, excludes runtime and includes verifiable manifest',async()=>{const dir=await fixture();try{const r=await buildGame({rootDir:dir}),entries=unzip(await readFile(r.zipPath));assert.ok(entries.has('play.html')&&entries.has('game/helper.mjs'));assert.equal(entries.get('game/assets/comic/cover_a.jpg').toString(),'IMAGE_BYTES');assert.ok([...entries.keys()].every(n=>!n.includes('.runtime')&&!n.includes('operator.key')&&!n.includes('..')));assert.ok([...entries.values()].every(b=>!b.includes(Buffer.from('FAKE_PRIVATE_FIXTURE'))));const manifest=JSON.parse(entries.get('manifest.json'));assert.ok(manifest.files.every(f=>/^[a-f0-9]{64}$/.test(f.sha256)));}finally{await rm(dir,{recursive:true,force:true});}});
test('module escaping game source fails instead of packaging private bytes',async()=>{const dir=await fixture();try{await writeFile(join(dir,'game/client.mjs'),'import x from "../.runtime/operator.key";');await assert.rejects(buildGame({rootDir:dir}),/escape|outside|module/i);}finally{await rm(dir,{recursive:true,force:true});}});
test('standalone supplies its own network-denying host policy without a server header',async()=>{const dir=await fixture();try{const r=await buildGame({rootDir:dir}),html=await readFile(r.htmlPath,'utf8');assert.match(html,/http-equiv="Content-Security-Policy"/);assert.ok(html.includes("connect-src 'none'"));assert.ok(html.includes("script-src 'unsafe-inline' data:"));assert.ok(html.includes("img-src data:"));}finally{await rm(dir,{recursive:true,force:true});}});
test('runtime data nested beneath source roots never enters a public source archive',async()=>{const dir=await fixture();try{await mkdir(join(dir,'src/runtime'),{recursive:true});await writeFile(join(dir,'src/runtime/service.json'),'PRIVATE_NESTED_STATE_FIXTURE');await writeFile(join(dir,'src/saved-state.json'),'PRIVATE_CUSTOM_STATE_FIXTURE');const r=await buildGame({rootDir:dir}),entries=unzip(await readFile(r.zipPath));assert.ok(!entries.has('src/runtime/service.json'));assert.ok(!entries.has('src/saved-state.json'));assert.ok([...entries.values()].every(b=>!b.includes(Buffer.from('PRIVATE_NESTED_STATE_FIXTURE'))&&!b.includes(Buffer.from('PRIVATE_CUSTOM_STATE_FIXTURE'))));}finally{await rm(dir,{recursive:true,force:true});}});


function serviceResponse(body, ok=true, status=ok?200:500) {
  return {ok,status,body,clone(){return serviceResponse(body,ok,status);}};
}

async function serviceWorkerHarness({fetchImpl,openCache}) {
  const handlers=new Map();
  const self={
    location:{origin:'https://ngl.test'},
    clients:{claim:async()=>{}},
    addEventListener:(name,handler)=>handlers.set(name,handler)
  };
  const caches={open:openCache,keys:async()=>[],delete:async()=>true};
  const source=await readFile(join(process.cwd(),'game/sw.js'),'utf8');
  runInNewContext(source,{
    self,caches,fetch:fetchImpl,URL,
    Response:{error:()=>serviceResponse('response-error',false,0)}
  });
  return handlers;
}

async function serviceWorkerResponse(handler,request) {
  let pending=null;
  handler({request,respondWith(value){pending=Promise.resolve(value);}});
  return pending?await pending:null;
}

const shellRequest=(path,mode='no-cors')=>({
  method:'GET',url:'https://ngl.test'+path,mode
});

test('successful navigation survives a cache quota failure instead of falling back to stale HTML',async()=>{
  const cache={
    match:async request=>typeof request==='string'&&request==='https://ngl.test/index.html'
      ?serviceResponse('stale-shell'):null,
    put:async()=>{throw new Error('QuotaExceededError');}
  };
  const handlers=await serviceWorkerHarness({
    fetchImpl:async()=>serviceResponse('fresh-shell'),
    openCache:async()=>cache
  });
  const response=await serviceWorkerResponse(handlers.get('fetch'),shellRequest('/','navigate'));
  assert.equal(response.body,'fresh-shell');
});

test('successful shell asset is returned when its cache write fails',async()=>{
  const cache={match:async()=>null,put:async()=>{throw new Error('QuotaExceededError');}};
  const handlers=await serviceWorkerHarness({
    fetchImpl:async()=>serviceResponse('fresh-module'),
    openCache:async()=>cache
  });
  const response=await serviceWorkerResponse(handlers.get('fetch'),shellRequest('/client.mjs'));
  assert.equal(response.body,'fresh-module');
});

test('successful network asset remains available when Cache Storage cannot open',async()=>{
  let fetchCalls=0;
  const handlers=await serviceWorkerHarness({
    fetchImpl:async()=>{fetchCalls+=1;return serviceResponse('fresh-style');},
    openCache:async()=>{throw new Error('storage unavailable');}
  });
  const response=await serviceWorkerResponse(handlers.get('fetch'),shellRequest('/styles.css'));
  assert.equal(fetchCalls,1);
  assert.equal(response.body,'fresh-style');
});

test('online shell assets do not depend on Cache Storage reads',async()=>{
  let fetchCalls=0,cacheReads=0;
  const handlers=await serviceWorkerHarness({
    fetchImpl:async()=>{fetchCalls+=1;return serviceResponse('fresh-module');},
    openCache:async()=>({match:async()=>{cacheReads+=1;throw new Error('cache read denied');},put:async()=>{}})
  });
  const response=await serviceWorkerResponse(handlers.get('fetch'),shellRequest('/client.mjs'));
  assert.equal(fetchCalls,1);
  assert.equal(cacheReads,0,'a fresh online response does not consult stale cache first');
  assert.equal(response.body,'fresh-module');
});

test('offline navigation still falls back to the cached application shell',async()=>{
  const cache={
    match:async request=>typeof request==='string'&&request==='https://ngl.test/index.html'
      ?serviceResponse('cached-shell'):null
  };
  const handlers=await serviceWorkerHarness({
    fetchImpl:async()=>{throw new Error('offline');},
    openCache:async()=>cache
  });
  const response=await serviceWorkerResponse(handlers.get('fetch'),shellRequest('/','navigate'));
  assert.equal(response.body,'cached-shell');
});

test('transient server navigation errors fall back to the cached application shell',async()=>{
  const cache={
    match:async request=>typeof request==='string'&&request==='https://ngl.test/index.html'
      ?serviceResponse('cached-shell'):null
  };
  const handlers=await serviceWorkerHarness({
    fetchImpl:async()=>serviceResponse('upstream-unavailable',false,503),
    openCache:async()=>cache
  });
  const response=await serviceWorkerResponse(handlers.get('fetch'),shellRequest('/','navigate'));
  assert.equal(response.body,'cached-shell');
});

test('client navigation errors remain visible instead of being hidden by the cached shell',async()=>{
  let cacheMatches=0;
  const cache={match:async()=>{cacheMatches+=1;return serviceResponse('cached-shell');}};
  const handlers=await serviceWorkerHarness({
    fetchImpl:async()=>serviceResponse('not-found',false,404),
    openCache:async()=>cache
  });
  const response=await serviceWorkerResponse(handlers.get('fetch'),shellRequest('/','navigate'));
  assert.equal(response.status,404);
  assert.equal(response.body,'not-found');
  assert.equal(cacheMatches,0);
});

test('server navigation errors remain visible when no cached shell is available',async()=>{
  const cache={match:async()=>null};
  const handlers=await serviceWorkerHarness({
    fetchImpl:async()=>serviceResponse('upstream-unavailable',false,503),
    openCache:async()=>cache
  });
  const response=await serviceWorkerResponse(handlers.get('fetch'),shellRequest('/','navigate'));
  assert.equal(response.status,503);
  assert.equal(response.body,'upstream-unavailable');
});

test('shared-world API reads remain outside the application-shell cache',async()=>{
  let fetchCalls=0,responded=false;
  const handlers=await serviceWorkerHarness({
    fetchImpl:async()=>{fetchCalls+=1;return serviceResponse('unexpected');},
    openCache:async()=>({match:async()=>null,put:async()=>{}})
  });
  handlers.get('fetch')({
    request:shellRequest('/api/state','cors'),
    respondWith(){responded=true;}
  });
  assert.equal(responded,false);
  assert.equal(fetchCalls,0);
});

test('core shell installation remains fail-closed when the complete shell cannot be cached',async()=>{
  const handlers=await serviceWorkerHarness({
    fetchImpl:async()=>serviceResponse('unused'),
    openCache:async()=>({addAll:async()=>{throw new Error('missing core shell resource');}})
  });
  let installation;
  handlers.get('install')({waitUntil(value){installation=Promise.resolve(value);}});
  await assert.rejects(installation,/missing core shell resource/);
});


test('online shell assets refresh stale cached bytes before returning',async()=>{
  const writes=[];
  const cache={
    match:async()=>serviceResponse('stale-module'),
    put:async(request,response)=>writes.push(response.body)
  };
  const handlers=await serviceWorkerHarness({
    fetchImpl:async()=>serviceResponse('fresh-module'),
    openCache:async()=>cache
  });
  const response=await serviceWorkerResponse(handlers.get('fetch'),shellRequest('/client.mjs'));
  assert.equal(response.body,'fresh-module','an installed client must receive the current online module');
  assert.deepEqual(writes,['fresh-module'],'the fresh response replaces the offline fallback');
});

test('offline shell assets fall back to the last cached bytes',async()=>{
  const cache={match:async()=>serviceResponse('cached-module'),put:async()=>{}};
  const handlers=await serviceWorkerHarness({
    fetchImpl:async()=>{throw new Error('offline');},
    openCache:async()=>cache
  });
  const response=await serviceWorkerResponse(handlers.get('fetch'),shellRequest('/client.mjs'));
  assert.equal(response.body,'cached-module');
});

test('transient shell asset server errors fall back to cached bytes',async()=>{
  const cache={match:async()=>serviceResponse('cached-module'),put:async()=>{}};
  const handlers=await serviceWorkerHarness({
    fetchImpl:async()=>serviceResponse('upstream-unavailable',false,503),
    openCache:async()=>cache
  });
  const response=await serviceWorkerResponse(handlers.get('fetch'),shellRequest('/client.mjs'));
  assert.equal(response.body,'cached-module');
});

test('shell asset client errors remain visible instead of serving stale cached bytes',async()=>{
  let writes=0;
  const cache={
    match:async()=>serviceResponse('stale-module'),
    put:async()=>{writes+=1;}
  };
  const handlers=await serviceWorkerHarness({
    fetchImpl:async()=>serviceResponse('not-found',false,404),
    openCache:async()=>cache
  });
  const response=await serviceWorkerResponse(handlers.get('fetch'),shellRequest('/client.mjs'));
  assert.equal(response.status,404);
  assert.equal(response.body,'not-found');
  assert.equal(writes,0);
});

test('offline shell assets fail visibly when no cached fallback exists',async()=>{
  const cache={match:async()=>null,put:async()=>{}};
  const handlers=await serviceWorkerHarness({
    fetchImpl:async()=>{throw new Error('offline');},
    openCache:async()=>cache
  });
  const response=await serviceWorkerResponse(handlers.get('fetch'),shellRequest('/client.mjs'));
  assert.equal(response.status,0);
  assert.equal(response.body,'response-error');
});
