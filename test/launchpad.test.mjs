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
 const report=await rehearseLaunch(world), page=makeLaunchPage(world,report);
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
 Object.assign(world.creations[0],{html:imageHTML,receipt:receipt(imageHTML)});
 const called=[];const report=await rehearseLaunch(world,{loadAsset:async path=>{called.push(path);return 'data:image/jpeg;base64,YWJj';}});
 assert.deepEqual(called,['/assets/comic/cover_a.jpg']);
 assert.ok(makeLaunchPage(world,report).includes('data:image/jpeg;base64,YWJj'));
 assert.notEqual(report.exhibit[0].portableReceipt.digest,world.creations[0].receipt.digest);
 assert.equal(report.exhibit[0].originalReceipt.digest,world.creations[0].receipt.digest);
});
test('source-save rehearsal resolves embedded artwork after transfer into standalone workshop',async()=>{
 const world=fixture(),html='<!doctype html><img src="/assets/comic/cover_a.jpg">';
 Object.assign(world.creations[0],{html,receipt:receipt(html)});
 const previous=globalThis.NGL_ASSETS;
 globalThis.NGL_ASSETS={pages:[{path:'/assets/comic/cover_a.jpg',src:'data:image/jpeg;base64,YWJj'}]};
 try{const report=await rehearseLaunch(world);assert.equal(report.ready,true);assert.ok(report.exhibit[0].html.includes('data:image/jpeg;base64,YWJj'));assert.equal(world.creations[0].html,html);assert.deepEqual(world.creations[0].receipt,receipt(html));}finally{if(previous===undefined)delete globalThis.NGL_ASSETS;else globalThis.NGL_ASSETS=previous;}
});
