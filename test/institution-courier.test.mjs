import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, open, readFile, writeFile, stat, readdir, rm, symlink } from 'node:fs/promises';
import { renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

let module;
try { module = await import('../src/institution/courier.mjs'); } catch {}
import { inspectWriterLock } from '../src/institution/lock-inspector.mjs';
const exec = promisify(execFile);
const keys = () => generateKeyPairSync('ed25519');
const provider = (id, key, extra = {}) => ({id, publicKey:key.publicKey.export({format:'pem',type:'spki'}), capabilities:['review'], ...extra});
async function fixture(t, providers) {
  assert.ok(module?.createCourier, 'courier must expose a real durable authenticated implementation');
  const dataDir = await mkdtemp(join(tmpdir(),'ngl-courier-test-'));
  t.after(() => rm(dataDir,{recursive:true,force:true}));
  let time = 1000;
  const options = {dataDir, providers, now:()=>time};
  return {dataDir, options, courier:await module.createCourier(options), tick:(n)=>{time=n;}};
}
function receipt(packet, kind, privateKey, extra={}) {
  return module.signEnvelope({schema:`ngl.courier.${kind}.v1`, request:packet.payload, requestDigest:packet.digest, at:1100, ...(kind==='ack'?{accepted:true}:{output:{verdict:'checked'}, dissent:null}), ...extra}, privateKey);
}

test('dispatch remains unexecuted until enrolled key signs ack and response; restart preserves dissent', async t => {
  const key=keys(); const f=await fixture(t,[provider('seat-a',key)]);
  const request=await f.courier.dispatch({requestId:'req-1',capability:'review',input:{text:'actual bytes 🦤'},expiresAt:5000});
  assert.equal(request.status,'DISPATCHED');
  assert.equal(request.seats[0].response,null);
  const packet=await f.courier.exportDispatch('req-1','seat-a');
  assert.equal(module.payloadDigest(packet.payload),packet.digest);
  f.tick(1200);
  await f.courier.acknowledge(receipt(packet,'ack',key.privateKey));
  const reply=receipt(packet,'reply',key.privateKey,{output:{verdict:'reject'},dissent:'Keep the minority view.'});
  const done=await f.courier.respond(reply);
  assert.equal(done.status,'RESPONDED');
  assert.equal(done.seats[0].response.payload.dissent,'Keep the minority view.');
  assert.deepEqual(await f.courier.respond(reply),done);
  const restarted=await module.createCourier(f.options);
  assert.deepEqual((await restarted.snapshot()).requests[0],done);
  assert.equal((await stat(f.dataDir)).mode & 0o777,0o700);
  assert.equal((await stat(join(f.dataDir,'courier.json'))).mode & 0o777,0o600);
});

test('signature authentication rejects wrong-key, content tamper, and request swaps before any state change', async t => {
  const key=keys(), wrong=keys(); const f=await fixture(t,[provider('seat-a',key)]);
  for (const id of ['one','two']) await f.courier.dispatch({requestId:id,capability:'review',input:{id},expiresAt:5000});
  const packet=await f.courier.exportDispatch('one','seat-a'); f.tick(1200);
  await assert.rejects(f.courier.acknowledge(receipt(packet,'ack',wrong.privateKey)),{code:'INVALID_SIGNATURE'});
  const tampered=receipt(packet,'ack',key.privateKey); tampered.payload.request.input.id='two';
  await assert.rejects(f.courier.acknowledge(tampered),{code:'REQUEST_MISMATCH'});
  const swapped=receipt(packet,'ack',key.privateKey); swapped.payload.request.requestId='two';
  await assert.rejects(f.courier.acknowledge(swapped),{code:'REQUEST_MISMATCH'});
  assert.ok((await f.courier.snapshot()).requests.every(r=>r.status==='DISPATCHED'));
});

test('all exact request fields and reply bytes are signed and bound', async t => {
  const key=keys(); const f=await fixture(t,[provider('seat-a',key)]);
  await f.courier.dispatch({requestId:'bind',capability:'review',input:{a:1,b:2},nonce:'fixed-nonce',expiresAt:5000});
  const packet=await f.courier.exportDispatch('bind','seat-a'); f.tick(1200);
  for (const [field,value] of [['providerId','other'],['capability','execute'],['nonce','different'],['expiresAt',5001]]) {
    const signed=receipt(packet,'ack',key.privateKey); signed.payload.request[field]=value;
    await assert.rejects(f.courier.acknowledge(signed));
  }
  await f.courier.acknowledge(receipt(packet,'ack',key.privateKey));
  const reply=receipt(packet,'reply',key.privateKey); reply.payload.output.verdict='fabricated';
  await assert.rejects(f.courier.respond(reply),{code:'INVALID_SIGNATURE'});
  assert.equal((await f.courier.snapshot()).requests[0].status,'ACKNOWLEDGED');
});

test('duplicate exact dispatch and receipts are idempotent; conflicting identities and receipts reject', async t => {
  const key=keys(); const f=await fixture(t,[provider('seat-a',key)]);
  const args={requestId:'retry',capability:'review',input:{a:1},expiresAt:5000};
  const first=await f.courier.dispatch(args); f.tick(1200);
  assert.deepEqual(await f.courier.dispatch(args),first);
  await assert.rejects(f.courier.dispatch({...args,input:{a:2}}),{code:'CONFLICT'});
  const packet=await f.courier.exportDispatch('retry','seat-a'); const ack=receipt(packet,'ack',key.privateKey);
  await f.courier.acknowledge(ack); const after=await f.courier.snapshot();
  await f.courier.acknowledge(ack); assert.deepEqual(await f.courier.snapshot(),after);
  await assert.rejects(f.courier.acknowledge(receipt(packet,'ack',key.privateKey,{at:1150})),{code:'CONFLICT'});
  const changed=keys();
  await assert.rejects(module.createCourier({...f.options,providers:[provider('seat-a',changed)]}),{code:'IDENTITY_CONFLICT'});
});

test('expiry, unavailable seats and local failure are explicit and cannot produce completed work', async t => {
  const key=keys(); const f=await fixture(t,[provider('seat-a',key),provider('offline',keys(),{available:false})]);
  const request=await f.courier.dispatch({requestId:'expiry',capability:'review',input:{},expiresAt:1500});
  assert.equal(request.seats.find(s=>s.providerId==='offline').status,'UNAVAILABLE');
  const packet=await f.courier.exportDispatch('expiry','seat-a'); f.tick(1501);
  await assert.rejects(f.courier.acknowledge(receipt(packet,'ack',key.privateKey)),{code:'EXPIRED'});
  assert.equal((await f.courier.snapshot()).requests[0].status,'EXPIRED');
  await f.courier.dispatch({requestId:'failed',capability:'review',input:{},providerIds:['seat-a'],expiresAt:5000});
  await f.courier.fail({requestId:'failed',providerId:'seat-a',reason:'Transport disconnected'});
  const failed=(await f.courier.snapshot()).requests.find(r=>r.requestId==='failed');
  assert.equal(failed.status,'FAILED'); assert.equal(failed.seats[0].response,null);
  const absent=await f.courier.dispatch({requestId:'absent',capability:'missing',input:{},expiresAt:5000});
  assert.equal(absent.status,'UNAVAILABLE');
});

test('responses require an ack and each council seat keeps its independent response and dissent', async t => {
  const a=keys(), b=keys(); const f=await fixture(t,[provider('a',a),provider('b',b)]);
  await f.courier.dispatch({requestId:'council',capability:'review',input:{proposal:'x'},expiresAt:5000}); f.tick(1200);
  const pa=await f.courier.exportDispatch('council','a'), pb=await f.courier.exportDispatch('council','b');
  await assert.rejects(f.courier.respond(receipt(pa,'reply',a.privateKey)),{code:'ACK_REQUIRED'});
  for(const [p,k,verdict] of [[pa,a,'accept'],[pb,b,'reject']]) {
    await f.courier.acknowledge(receipt(p,'ack',k.privateKey));
    await f.courier.respond(receipt(p,'reply',k.privateKey,{output:{verdict},dissent:verdict==='reject'?'unsafe':null}));
  }
  const result=(await f.courier.snapshot()).requests[0];
  assert.equal(result.status,'RESPONDED');
  assert.deepEqual(result.seats.map(s=>s.response.payload.output.verdict),['accept','reject']);
  assert.equal(result.seats[1].response.payload.dissent,'unsafe');
  assert.equal(Object.hasOwn(result,'approved'),false);
});

test('concurrent operations serialize and fail closed on persisted tampering', async t => {
  const key=keys(); const f=await fixture(t,[provider('seat-a',key)]);
  await Promise.all(Array.from({length:12},(_,i)=>f.courier.dispatch({requestId:`parallel-${i}`,capability:'review',input:{i},expiresAt:5000})));
  const second=await module.createCourier(f.options);
  assert.equal((await second.snapshot()).requests.length,12);
  assert.deepEqual((await readdir(f.dataDir)).sort(),['courier.json']);
  const file=join(f.dataDir,'courier.json'); const raw=JSON.parse(await readFile(file,'utf8'));
  raw.requests[0].input.i='tampered'; await writeFile(file,JSON.stringify(raw));
  await assert.rejects(module.createCourier(f.options),{code:'CORRUPT_STATE'});
});

test('plain JSON inputs are bounded, detached, and reject ambiguous values', async t => {
  const f=await fixture(t,[]);
  for(const input of [undefined,{x:undefined},{x:NaN},{x:BigInt(1)},new Date()]) {
    await assert.rejects(f.courier.dispatch({capability:'review',input}),{code:'INVALID_INPUT'});
  }
  await assert.rejects(f.courier.dispatch({capability:'review',input:'x'.repeat(140000)}),{code:'INVALID_INPUT'});
  const input={text:'before'};const result=await f.courier.dispatch({capability:'review',input}); input.text='after'; result.input.text='mutated';
  assert.equal((await f.courier.snapshot()).requests[0].input.text,'before');
});

test('CLI fixture demonstrates a real signed worker child without an external provider claim', async t => {
  const dir=await mkdtemp(join(tmpdir(),'ngl-courier-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const {stdout}=await exec(process.execPath,['scripts/courier.mjs','demo','--data-dir',dir],{cwd:new URL('..',import.meta.url).pathname});
  const result=JSON.parse(stdout);
  assert.equal(result.mode,'LOCAL_SIGNED_FIXTURE'); assert.equal(result.externalProviderExecuted,false);
  assert.equal(result.request.status,'RESPONDED');
  assert.ok(result.worker.pid>0);assert.notEqual(result.worker.pid,process.pid);
  assert.equal(result.request.seats[0].response.payload.output.processId,result.worker.pid);
  const exported=await exec(process.execPath,['scripts/courier.mjs','status','--data-dir',dir],{cwd:new URL('..',import.meta.url).pathname});
  assert.equal(JSON.parse(exported.stdout).requests[0].status,'RESPONDED');
  assert.equal((await readdir(dir)).some(f=>f.includes('private')),false);
});

test('CLI dispatch, export, import and status perform real independent file handoff across processes', async t => {
  const key=keys(); const dir=await mkdtemp(join(tmpdir(),'ngl-courier-handoff-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const dataDir=join(dir,'store'),providersFile=join(dir,'providers.json'),requestFile=join(dir,'request.json');
  await writeFile(providersFile,JSON.stringify([provider('real-file-seat',key)]));
  await writeFile(requestFile,JSON.stringify({requestId:'file-handoff',capability:'review',input:{contents:'Do not claim a model ran.'}}));
  const cli=(...args)=>exec(process.execPath,['scripts/courier.mjs',...args],{cwd:new URL('..',import.meta.url).pathname});
  const dispatched=JSON.parse((await cli('dispatch','--data-dir',dataDir,'--providers',providersFile,'--request',requestFile)).stdout);
  assert.equal(dispatched.request.status,'DISPATCHED');
  const packetFile=join(dir,'packet.json');await cli('export','--data-dir',dataDir,'--request-id','file-handoff','--provider-id','real-file-seat','--out',packetFile);
  const packet=JSON.parse(await readFile(packetFile,'utf8'));
  assert.equal(packet.digest,dispatched.packets[0].digest);
  assert.equal((await stat(packetFile)).mode & 0o777,0o600);
  const at=Date.now(),binding={request:packet.payload,requestDigest:packet.digest,at};
  const ack=module.signEnvelope({schema:'ngl.courier.ack.v1',...binding,accepted:true},key.privateKey);
  const reply=module.signEnvelope({schema:'ngl.courier.reply.v1',...binding,output:{review:'actual enrolled test signer'},dissent:'This is file transport, not evidence of an external AI.'},key.privateKey);
  for(const [name,envelope] of [['ack',ack],['reply',reply]]) {
    const file=join(dir,`${name}.json`);await writeFile(file,JSON.stringify(envelope));
    await cli('import','--data-dir',dataDir,'--file',file);
  }
  const snapshot=JSON.parse((await cli('status','--data-dir',dataDir)).stdout);
  assert.deepEqual(snapshot.requests[0].seats[0].response,reply);
});

test('state validation rechecks historic signatures even when a tamperer recomputes the checksum', async t => {
  const key=keys();const f=await fixture(t,[provider('seat-a',key)]);
  await f.courier.dispatch({requestId:'historic',capability:'review',input:{},expiresAt:5000});f.tick(1200);
  const packet=await f.courier.exportDispatch('historic','seat-a');
  await f.courier.acknowledge(receipt(packet,'ack',key.privateKey));await f.courier.respond(receipt(packet,'reply',key.privateKey));
  const path=join(f.dataDir,'courier.json'),raw=JSON.parse(await readFile(path,'utf8'));
  raw.requests[0].seats[0].response.payload.output.verdict='altered';
  const {checksum,...body}=raw;raw.checksum=module.payloadDigest(body);await writeFile(path,JSON.stringify(raw));
  await assert.rejects(module.createCourier(f.options),{code:'CORRUPT_STATE'});
});

test('snapshot revision reflects persisted expiration and concurrent dispatch options are detached', async t => {
  const key=keys();const f=await fixture(t,[provider('seat-a',key)]);
  await f.courier.dispatch({requestId:'rev',capability:'review',input:{},expiresAt:1500});f.tick(1600);
  const expired=await f.courier.snapshot(),stored=JSON.parse(await readFile(join(f.dataDir,'courier.json'),'utf8'));
  assert.equal(expired.revision,stored.revision);
  const ids=['seat-a'];const dispatched=f.courier.dispatch({requestId:'detach',capability:'review',input:{},providerIds:ids,expiresAt:5000});ids[0]='wrong';
  assert.equal((await dispatched).seats[0].providerId,'seat-a');
});

test('full-size valid input can receive a signed acknowledgment without losing request binding', async t => {
  const key=keys();const f=await fixture(t,[provider('seat-a',key)]);
  await f.courier.dispatch({requestId:'large',capability:'review',input:'x'.repeat(131000),expiresAt:5000});f.tick(1200);
  const packet=await f.courier.exportDispatch('large','seat-a');
  assert.equal((await f.courier.acknowledge(receipt(packet,'ack',key.privateKey))).status,'ACKNOWLEDGED');
});

for(const mode of ['cross-request','cross-seat']) {
  test(`restart rejects ${mode} rebinding of valid signed receipts with a recomputed checksum`, async t => {
    const a=keys(),b=keys();const f=await fixture(t,[provider('seat-a',a),provider('seat-b',b)]);
    await f.courier.dispatch({requestId:'source',capability:'review',input:{proposal:'source'},providerIds:mode==='cross-seat'?['seat-a','seat-b']:['seat-a'],expiresAt:5000});
    if(mode==='cross-request')await f.courier.dispatch({requestId:'target',capability:'review',input:{proposal:'different'},providerIds:['seat-a'],expiresAt:5000});
    f.tick(1200);
    const packet=await f.courier.exportDispatch('source','seat-a');
    await f.courier.acknowledge(receipt(packet,'ack',a.privateKey));
    await f.courier.respond(receipt(packet,'reply',a.privateKey));
    const path=join(f.dataDir,'courier.json'),raw=JSON.parse(await readFile(path,'utf8'));
    const source=raw.requests.find(r=>r.requestId==='source').seats[0];
    const targetRequest=raw.requests.find(r=>r.requestId===(mode==='cross-request'?'target':'source'));
    const target=targetRequest.seats.find(s=>s.providerId===(mode==='cross-seat'?'seat-b':'seat-a'));
    target.acknowledgment=structuredClone(source.acknowledgment);
    target.response=structuredClone(source.response);
    target.status='RESPONDED';targetRequest.status='RESPONDED';
    const {checksum,...body}=raw;raw.checksum=module.payloadDigest(body);await writeFile(path,JSON.stringify(raw));
    await assert.rejects(module.createCourier(f.options),{code:'CORRUPT_STATE'});
  });
}

test('concurrent clients preserve stale lock and state until explicit recovery; normal clients serialize', async t => {
  const f=await fixture(t,[]),lock=join(f.dataDir,'.courier.lock');
  const before=await readFile(join(f.dataDir,'courier.json'),'utf8');
  const stale=JSON.stringify({pid:2147483647});await writeFile(lock,stale,{mode:0o600});
  const source=`import {createCourier} from ${JSON.stringify(new URL('../src/institution/courier.mjs',import.meta.url).href)}; const courier=await createCourier({dataDir:process.argv[1]}); await courier.dispatch({requestId:process.argv[2],capability:'review',input:{source:'real-process'}});`;
  const run=id=>exec(process.execPath,['--input-type=module','-e',source,f.dataDir,id]);
  const blocked=await Promise.allSettled(Array.from({length:6},(_,i)=>run(`blocked-${i}`)));
  assert.equal(blocked.filter(result=>result.status==='fulfilled').length,0);
  for(const result of blocked)assert.match(result.reason.stderr,/STALE_LOCK/);
  assert.equal(await readFile(lock,'utf8'),stale);
  assert.equal(await readFile(join(f.dataDir,'courier.json'),'utf8'),before);
  // Test owner explicitly recovers only after every child has stopped.
  await rm(lock);
  const normal=await Promise.allSettled(Array.from({length:6},(_,i)=>run(`normal-${i}`)));
  for(const result of normal)assert.equal(result.status,'fulfilled',result.reason?.stderr);
  const reopened=await module.createCourier(f.options);
  const snapshot=await reopened.snapshot();assert.equal(snapshot.requests.length,6);
  assert.deepEqual(snapshot.requests.map(r=>r.requestId).sort(),Array.from({length:6},(_,i)=>`normal-${i}`));
});


async function fixtureWithReplacementLock(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-courier-replaced-lock-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const replacement = JSON.stringify({
    schema: 'ngl.courier-lock.v1',
    pid: process.pid,
    openedAt: '2026-10-28T15:00:00.000Z'
  });
  let replaced = false;
  const now = () => {
    if (!replaced) {
      const path = join(dataDir, '.courier.lock');
      // Keep the old inode alive so immediate inode-number reuse cannot mask replacement.
      renameSync(path, path + '.displaced');
      writeFileSync(path, replacement, { mode: 0o600 });
      replaced = true;
    }
    return 1000;
  };
  const courier = await module.createCourier({ dataDir, providers: [], now });
  return { dataDir, courier, replacement, wasReplaced: () => replaced };
}

test('courier reports ownership loss and preserves a replacement lock after a committed dispatch', async t => {
  const f = await fixtureWithReplacementLock(t);
  await assert.rejects(
    f.courier.dispatch({ requestId: 'replacement-committed', capability: 'review', input: { safe: true }, expiresAt: 5000 }),
    { code: 'LOCK_OWNERSHIP_LOST' }
  );
  assert.equal(f.wasReplaced(), true);
  await assert.rejects(f.courier.snapshot(), { code: 'LOCK_OWNERSHIP_LOST' },
    'the instance must remain fenced after losing its lock');
  const lockPath = join(f.dataDir, '.courier.lock');
  assert.equal(await readFile(lockPath, 'utf8'), f.replacement);
  const persisted = JSON.parse(await readFile(join(f.dataDir, 'courier.json'), 'utf8'));
  assert.equal(persisted.requests.some(request => request.requestId === 'replacement-committed'), true,
    'the error deliberately signals that the operation may already have committed');
  const diagnostic = await inspectWriterLock(lockPath);
  assert.equal(diagnostic.status, 'present');
  assert.equal(diagnostic.format, 'owner-metadata');
  assert.equal(diagnostic.owner.schema, 'ngl.courier-lock.v1');
  assert.equal(diagnostic.safeToRemove, false);
});

test('courier preserves a replacement lock when the transaction itself fails', async t => {
  const f = await fixtureWithReplacementLock(t);
  await assert.rejects(
    f.courier.dispatch({ requestId: 'replacement-rejected', capability: 'invalid capability', input: {}, expiresAt: 5000 }),
    { code: 'LOCK_OWNERSHIP_LOST' }
  );
  assert.equal(f.wasReplaced(), true);
  await assert.rejects(f.courier.snapshot(), { code: 'LOCK_OWNERSHIP_LOST' },
    'the instance must remain fenced after losing its lock');
  assert.equal(await readFile(join(f.dataDir, '.courier.lock'), 'utf8'), f.replacement);
  const persisted = JSON.parse(await readFile(join(f.dataDir, 'courier.json'), 'utf8'));
  assert.equal(persisted.requests.length, 0);
});


test('courier rejects symlinked storage ancestors before creating descendants', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ngl-courier-symlink-parent-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const actual = join(root, 'actual');
  await mkdir(actual);
  const alias = join(root, 'alias');
  await symlink(actual, alias, 'dir');
  const dataDir = join(alias, 'nested', 'courier');

  await assert.rejects(
    module.createCourier({ dataDir, providers: [] }),
    { code: 'INVALID_INPUT' }
  );
  assert.deepEqual(await readdir(actual), [],
    'the rejected path must not create directories through the symlinked parent');
});


test('courier fences the current instance after post-rename directory-sync uncertainty', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ngl-courier-durability-uncertain-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let failNextSync = false;
  const syncDirectory = async directory => {
    if (failNextSync) {
      failNextSync = false;
      throw Object.assign(new Error('injected courier directory-sync failure after rename'), { code: 'EIO' });
    }
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  };
  const options = { dataDir, providers: [], now: () => 1000, syncDirectory };
  const courier = await module.createCourier(options);
  failNextSync = true;

  await assert.rejects(
    courier.dispatch({ requestId: 'durability-uncertain', capability: 'review', input: { retained: true }, expiresAt: 5000 }),
    { code: 'COMMIT_DURABILITY_UNCERTAIN' }
  );
  await assert.rejects(courier.snapshot(), { code: 'COMMIT_DURABILITY_UNCERTAIN' });

  const retained = JSON.parse(await readFile(join(dataDir, 'courier.json'), 'utf8'));
  assert.equal(retained.requests.some(request => request.requestId === 'durability-uncertain'), true,
    'rename may expose the new state even though directory durability was not confirmed');

  const reopened = await module.createCourier({ dataDir, providers: [], now: () => 1001 });
  const snapshot = await reopened.snapshot();
  assert.equal(snapshot.requests[0].requestId, 'durability-uncertain',
    'a fresh instance validates the retained state before continuing');
});


test('courier rejects oversized lock metadata without changing the lock or state', async t => {
  const f = await fixture(t, []);
  const lockPath = join(f.dataDir, '.courier.lock');
  const statePath = join(f.dataDir, 'courier.json');
  const oversized = 'x'.repeat(4097);
  const stateBefore = await readFile(statePath, 'utf8');
  await writeFile(lockPath, oversized, { mode: 0o600 });

  await assert.rejects(module.createCourier(f.options), { code: 'CORRUPT_LOCK' });
  assert.equal(await readFile(lockPath, 'utf8'), oversized);
  assert.equal(await readFile(statePath, 'utf8'), stateBefore);
});

test('courier rejects an explicitly unsupported lock schema instead of treating it as owner metadata', async t => {
  const f = await fixture(t, []);
  const lockPath = join(f.dataDir, '.courier.lock');
  const statePath = join(f.dataDir, 'courier.json');
  const unknown = JSON.stringify({
    schema: 'ngl.future-lock.v99',
    pid: 2147483647,
    openedAt: '2026-10-28T12:00:00.000Z'
  });
  const stateBefore = await readFile(statePath, 'utf8');
  await writeFile(lockPath, unknown, { mode: 0o600 });

  await assert.rejects(module.createCourier(f.options), { code: 'CORRUPT_LOCK' });
  assert.equal(await readFile(lockPath, 'utf8'), unknown);
  assert.equal(await readFile(statePath, 'utf8'), stateBefore);
});

test('courier rejects a FIFO lock path promptly instead of blocking startup', {
  skip: process.platform === 'win32'
}, async t => {
  const f = await fixture(t, []);
  const lockPath = join(f.dataDir, '.courier.lock');
  const statePath = join(f.dataDir, 'courier.json');
  const stateBefore = await readFile(statePath, 'utf8');
  await exec('/usr/bin/mkfifo', [lockPath]);

  const moduleUrl = new URL('../src/institution/courier.mjs', import.meta.url).href;
  const source = `import { createCourier } from ${JSON.stringify(moduleUrl)};
try {
  await createCourier({ dataDir: ${JSON.stringify(f.dataDir)}, providers: [], now: () => 1000 });
  console.error('unexpected success');
  process.exitCode = 2;
} catch (cause) {
  if (cause.code === 'UNSAFE_LOCK') console.log('UNSAFE_LOCK: non-regular lock rejected');
  else { console.error(cause); process.exitCode = 1; }
}`;
  const result = await exec(process.execPath, ['--input-type=module', '-e', source], { timeout: 5000 });
  assert.match(result.stdout, /UNSAFE_LOCK: non-regular lock rejected/);
  assert.equal((await stat(lockPath)).isFIFO(), true);
  assert.equal(await readFile(statePath, 'utf8'), stateBefore);
});


test('courier rejects duplicate PID keys instead of classifying the last value as stale owner metadata', async t => {
  const f = await fixture(t, []);
  const lockPath = join(f.dataDir, '.courier.lock');
  const statePath = join(f.dataDir, 'courier.json');
  const duplicate = '{"schema":"ngl.courier-lock.v1","pid":2147483647,"pid":2147483648,"openedAt":"2026-10-28T12:00:00.000Z"}';
  const stateBefore = await readFile(statePath, 'utf8');
  await writeFile(lockPath, duplicate, { mode: 0o600 });

  await assert.rejects(module.createCourier(f.options), { code: 'CORRUPT_LOCK' });
  assert.equal(await readFile(lockPath, 'utf8'), duplicate);
  assert.equal(await readFile(statePath, 'utf8'), stateBefore);
});

test('courier rejects escaped duplicate PID keys after JSON key decoding', async t => {
  const f = await fixture(t, []);
  const lockPath = join(f.dataDir, '.courier.lock');
  const statePath = join(f.dataDir, 'courier.json');
  const duplicate = '{"schema":"ngl.courier-lock.v1","pid":2147483647,"p\\u0069d":2147483648,"openedAt":"2026-10-28T12:00:00.000Z"}';
  const stateBefore = await readFile(statePath, 'utf8');
  await writeFile(lockPath, duplicate, { mode: 0o600 });

  await assert.rejects(module.createCourier(f.options), { code: 'CORRUPT_LOCK' });
  assert.equal(await readFile(lockPath, 'utf8'), duplicate);
  assert.equal(await readFile(statePath, 'utf8'), stateBefore);
});
