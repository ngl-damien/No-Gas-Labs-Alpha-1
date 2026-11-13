import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rehearseLaunch, makeLaunchPage } from '../game/launchpad.mjs';

const html='<!doctype html><title>Playable</title><button onclick="this.textContent=\'It worked\'">Try me</button>';
const receipt=bytes=>({algorithm:'sha256',digest:createHash('sha256').update(bytes).digest('hex'),size:Buffer.byteLength(bytes)});
function fixture(){return {schema:'ngl.world.v2',id:'test-world',founderName:'Damien',xp:100,drafts:[{title:'PRIVATE_MARKER',html:'NEVER_EXPORT'}],creations:[{id:'instrument-1',kind:'custom',title:'A working thing',intent:'Try the real button',version:1,html,receipt:receipt(html),versions:[],checks:[{id:'document',passed:true}]}]};}

test('rehearsal checks actual published bytes; altered bytes fail readiness',async()=>{
 const world=fixture(), report=await rehearseLaunch(world,{now:'2026-10-17T00:00:00.000Z'});
 assert.equal(report.ready,true); assert.equal(report.artifactCount,1);
 assert.equal(report.checks.find(c=>c.id==='artifact-bytes').passed,true);
 assert.ok(report.limitations.some(x=>/audience|demand/i.test(x)));
 world.creations[0].html+='tampered';
 const bad=await rehearseLaunch(world); assert.equal(bad.ready,false); assert.equal(bad.checks.find(c=>c.id==='artifact-bytes').passed,false);
});
test('one-button exhibition preserves usable instruments, excludes drafts, escapes host markup',async()=>{
 const world=fixture();world.creations[0].title='<img src=x onerror=alert(1)>';
 const report=await rehearseLaunch(world), page=await makeLaunchPage(world,report);
 assert.ok(page.startsWith('<!doctype html>'));
 assert.ok(page.includes('sandbox="allow-scripts allow-forms allow-downloads"'));
 assert.ok(page.includes('&lt;img src=x'));
 assert.ok(!page.includes('PRIVATE_MARKER')&&!page.includes('NEVER_EXPORT'));
 assert.ok(!page.includes('allow-same-origin'));
 assert.ok(page.includes('srcdoc=')&&page.includes('It worked'));
 assert.match(page,/rehearsal/i);assert.doesNotMatch(page,/10,000|customers|sold out/);
});
test('empty, inconsistent version history and claims without checked bytes cannot pass',async()=>{
 const empty=fixture();empty.creations=[];assert.equal((await rehearseLaunch(empty)).ready,false);
 const bad=fixture();bad.creations[0].version=2;assert.equal((await rehearseLaunch(bad)).ready,false);
 const unchecked=fixture();unchecked.creations[0].checks[0].passed=false;assert.equal((await rehearseLaunch(unchecked)).ready,false);
});
test('portable exhibition inlines only known comic assets and records changed package bytes',async()=>{
 const world=fixture(), imageHTML='<!doctype html><img src="/assets/comic/cover_a.jpg">';
 const path='/assets/comic/cover_a.jpg',data='data:image/jpeg;base64,YWJj';
 Object.assign(world.creations[0],{html:imageHTML,receipt:receipt(imageHTML)});
 const previous=globalThis.NGL_ASSETS;
 globalThis.NGL_ASSETS={pages:[{path,src:data}]};
 try{
  const called=[];const report=await rehearseLaunch(world,{loadAsset:async assetPath=>{called.push(assetPath);return data;}});
  assert.deepEqual(called,[path]);
  assert.ok((await makeLaunchPage(world,report)).includes(data));
  assert.notEqual(report.exhibit[0].portableReceipt.digest,world.creations[0].receipt.digest);
  assert.equal(report.exhibit[0].originalReceipt.digest,world.creations[0].receipt.digest);
 }finally{if(previous===undefined)delete globalThis.NGL_ASSETS;else globalThis.NGL_ASSETS=previous;}
});
test('public exhibition rejects substituted or stale embedded comic bytes even after receipt recomputation',async()=>{
 const world=fixture(),path='/assets/comic/cover_a.jpg';
 const imageHTML='<!doctype html><img src="'+path+'">';
 const canonical='data:image/jpeg;base64,YWJj',substituted='data:image/jpeg;base64,ZGVm';
 Object.assign(world.creations[0],{html:imageHTML,receipt:receipt(imageHTML)});
 const previous=globalThis.NGL_ASSETS;
 globalThis.NGL_ASSETS={pages:[{path,src:canonical}]};
 try{
  const report=await rehearseLaunch(world);
  assert.equal(report.ready,true);
  const forged=JSON.parse(JSON.stringify(report));
  forged.exhibit[0].html=forged.exhibit[0].html.replace(canonical,substituted);
  assert.notEqual(forged.exhibit[0].html,report.exhibit[0].html);
  assert.equal(Buffer.byteLength(forged.exhibit[0].html),Buffer.byteLength(report.exhibit[0].html));
  forged.exhibit[0].portableReceipt=receipt(forged.exhibit[0].html);
  await assert.rejects(makeLaunchPage(world,forged),/inconsistent/);

  const stale=await rehearseLaunch(world);
  globalThis.NGL_ASSETS={pages:[{path,src:substituted}]};
  await assert.rejects(makeLaunchPage(world,stale),/inconsistent/);
 }finally{if(previous===undefined)delete globalThis.NGL_ASSETS;else globalThis.NGL_ASSETS=previous;}
});

test('source-save rehearsal resolves embedded artwork after transfer into standalone workshop',async()=>{
 const world=fixture(),html='<!doctype html><img src="/assets/comic/cover_a.jpg">';
 Object.assign(world.creations[0],{html,receipt:receipt(html)});
 const previous=globalThis.NGL_ASSETS;
 globalThis.NGL_ASSETS={pages:[{path:'/assets/comic/cover_a.jpg',src:'data:image/jpeg;base64,YWJj'}]};
 try{const report=await rehearseLaunch(world);assert.equal(report.ready,true);assert.ok(report.exhibit[0].html.includes('data:image/jpeg;base64,YWJj'));assert.equal(world.creations[0].html,html);assert.deepEqual(world.creations[0].receipt,receipt(html));}finally{if(previous===undefined)delete globalThis.NGL_ASSETS;else globalThis.NGL_ASSETS=previous;}
});


test('portable rehearsal fails closed on unknown, relative, external and decorated comic asset paths',async()=>{
 const world=fixture();
 const badHtml='<!doctype html><img src="/assets/comic/cover_a.png"><img src="/assets/comic/cover_a.jpg?v=1"><img src="../assets/comic/cover_a.jpg"><img src="https://cdn.example.test/assets/comic/cover_a.jpg">';
 Object.assign(world.creations[0],{html:badHtml,receipt:receipt(badHtml)});
 const loaded=[];
 const report=await rehearseLaunch(world,{loadAsset:async path=>{loaded.push(path);return 'data:image/jpeg;base64,YWJj';}});
 assert.deepEqual(loaded,[]);
 assert.equal(report.checks.find(check=>check.id==='portable-assets').passed,false);
 assert.equal(report.ready,false);
 assert.ok(report.exhibit[0].html.includes('/assets/comic/cover_a.png'));
 const page=await makeLaunchPage(world,report);
 assert.ok(page.includes('The rehearsal found work to do.'));
});


test('portable rehearsal fails closed on HTML-entity, CSS-escape and percent-encoded comic paths',async()=>{
 const world=fixture();
 const badHtml='<!doctype html><img src="&#47;assets&#47;comic&#47;cover_a.jpg"><img src="&sol;assets&sol;comic&sol;cover_a.jpg"><style>.cover{background:url(\\2f assets\\2f comic\\2f cover_a.jpg)}</style><img src="%2Fassets%2Fcomic%2Fcover_a.jpg">';
 Object.assign(world.creations[0],{html:badHtml,receipt:receipt(badHtml)});
 const loaded=[];
 const report=await rehearseLaunch(world,{loadAsset:async path=>{loaded.push(path);return 'data:image/jpeg;base64,YWJj';}});
 assert.deepEqual(loaded,[]);
 assert.equal(report.checks.find(check=>check.id==='portable-assets').passed,false);
 assert.equal(report.ready,false);
 const page=await makeLaunchPage(world,report);
 assert.ok(page.includes('The rehearsal found work to do.'));
});

test('public exhibition refuses inconsistent readiness, artifact counts, receipts and unsupported claims',async()=>{
 const world=fixture(),report=await rehearseLaunch(world);
 const badReady=JSON.parse(JSON.stringify(report));
 badReady.checks.find(check=>check.id==='artifact-bytes').passed=false;
 await assert.rejects(makeLaunchPage(world,badReady),/inconsistent/);

 const badCount=JSON.parse(JSON.stringify(report));
 badCount.artifactCount=2;
 await assert.rejects(makeLaunchPage(world,badCount),/inconsistent/);

 const badReceipt=JSON.parse(JSON.stringify(report));
 badReceipt.exhibit[0].portableReceipt.size+=1;
 await assert.rejects(makeLaunchPage(world,badReceipt),/inconsistent/);

 const badDigest=JSON.parse(JSON.stringify(report));
 badDigest.exhibit[0].html=badDigest.exhibit[0].html.replace('Playable','Playab1e');
 badDigest.exhibit[0].portableReceipt=receipt(badDigest.exhibit[0].html);
 assert.notEqual(badDigest.exhibit[0].html,report.exhibit[0].html);
 assert.equal(Buffer.byteLength(badDigest.exhibit[0].html),Buffer.byteLength(report.exhibit[0].html));
 await assert.rejects(makeLaunchPage(world,badDigest),/inconsistent/);

 const badAnnouncement=JSON.parse(JSON.stringify(report));
 badAnnouncement.announcement='We sold 10,000 copies.';
 await assert.rejects(makeLaunchPage(world,badAnnouncement),/inconsistent/);

 const badLimitations=JSON.parse(JSON.stringify(report));
 badLimitations.limitations.pop();
 await assert.rejects(makeLaunchPage(world,badLimitations),/inconsistent/);
});

test('a consistent failed rehearsal remains visible as a failure instead of being promoted to ready',async()=>{
 const world=fixture();
 world.creations[0].checks[0].passed=false;
 const report=await rehearseLaunch(world);
 assert.equal(report.ready,false);
 const page=await makeLaunchPage(world,report);
 assert.ok(page.includes('The rehearsal found work to do.'));
 assert.ok(page.includes('Declared package checks passed'));
});


test('public exhibition binds source metadata, exact bytes and only allowlisted asset substitutions',async()=>{
 const world=fixture(),report=await rehearseLaunch(world);
 const forgedIntent=JSON.parse(JSON.stringify(report));
 forgedIntent.exhibit[0].intent='A different, unsupported intent';
 await assert.rejects(makeLaunchPage(world,forgedIntent),/inconsistent/);

 const forgedPortable=JSON.parse(JSON.stringify(report));
 forgedPortable.exhibit[0].html=forgedPortable.exhibit[0].html.replace('Playable','Playab1e');
 forgedPortable.exhibit[0].portableReceipt=receipt(forgedPortable.exhibit[0].html);
 await assert.rejects(makeLaunchPage(world,forgedPortable),/inconsistent/);

 const changedSource=fixture(),sourceReport=await rehearseLaunch(changedSource);
 changedSource.creations[0].html=changedSource.creations[0].html.replace('Playable','Playab1e');
 await assert.rejects(makeLaunchPage(changedSource,sourceReport),/inconsistent/);

 const failedWorld=fixture();
 failedWorld.creations[0].html+='tampered';
 const failedReport=await rehearseLaunch(failedWorld);
 assert.equal(failedReport.ready,false);
 assert.equal(failedReport.checks.find(check=>check.id==='artifact-bytes').passed,false);
 assert.ok((await makeLaunchPage(failedWorld,failedReport)).includes('The rehearsal found work to do.'));
});
