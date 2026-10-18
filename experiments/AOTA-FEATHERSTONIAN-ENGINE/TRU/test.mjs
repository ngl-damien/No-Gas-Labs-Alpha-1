import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {example,assess,sha256,assertCase,makeDecisionPacket,canonical} from './core.mjs';
test('SHA256 known digest', async()=>assert.equal(await sha256('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
test('stable canonicalization',()=>assert.equal(canonical({b:2,a:1}),canonical({a:1,b:2})));
test('report temporal ordering',()=>assert.deepEqual(assess(example).events.map(x=>x.id),['t1','t2','t3']));
test('fiction not promoted into reality',()=>assert.ok(assess(example).issues.some(x=>x.text.includes('Fictional'))));
test('unverified candidate cannot auto-promote',()=>assert.equal(assess(example).decisions[0].recommendation,'INCONCLUSIVE'));
test('fails closed on failed test',()=>{const c=structuredClone(example); c.candidates[1].testResults.push({name:'Security',outcome:'FAIL'});assert.equal(assess(c).decisions[0].recommendation,'REJECT')});
test('invalid evidence type rejected',()=>{const c=structuredClone(example);c.evidence[0].assurance='MAGIC';assert.throws(()=>assertCase(c))});
test('duplicate ids rejected',()=>{const c=structuredClone(example);c.evidence[0].id='t1';assert.throws(()=>assertCase(c))});
test('invalid timelines rejected',()=>{const c=structuredClone(example);c.events[0].at='yesterday';assert.throws(()=>assertCase(c))});
test('missing links flagged',()=>{const c=structuredClone(example);c.candidates[0].evidenceIds=['missing'];assert.ok(assess(c).issues.some(x=>x.severity==='ERROR'))});
test('digest reuse flagged',()=>{const c=structuredClone(example);c.evidence[0].digest='a'.repeat(64);c.evidence[1].digest='a'.repeat(64);assert.ok(assess(c).issues.some(x=>x.text.includes('Identical payload'))) });
test('decision packet is expressly unauthorized',()=>{const p=makeDecisionPacket(example,'cand','2026-10-19T00:00:00Z');assert.match(p.authorization,/NOT GRANTED/);assert.match(p.gateStatus,/NOT AUTHENTICATED/) });
test('invalid deadline rejected',()=>assert.throws(()=>makeDecisionPacket(example,'cand','not a date')));
test('unknown candidate rejected',()=>assert.throws(()=>makeDecisionPacket(example,'inc','2026-10-19T00:00:00Z')));

const comparisonCase=()=>{
 const c=structuredClone(example);
 c.evidence[0].assurance='INDEPENDENT';
 for(const x of c.candidates){x.workloadId='frozen-suite-v1';x.evidenceIds=['e1'];x.testResults=[{id:'correctness',name:'Correctness',outcome:'PASS'}]}
 return c;
};
test('case id is a bounded identifier',()=>{
 for(const value of [undefined,12,'','x'.repeat(81),'bad/id']){const c=structuredClone(example);if(value===undefined)delete c.caseId;else c.caseId=value;assert.throws(()=>assertCase(c),/case id/i)}
});
test('candidate roles are explicit and baseline is unique',()=>{
 for(const role of [undefined,'FOUNDER',12]){const c=structuredClone(example);if(role===undefined)delete c.candidates[1].role;else c.candidates[1].role=role;assert.throws(()=>assertCase(c),/role/i)}
 const c=structuredClone(example);c.candidates[1].role='INCUMBENT';assert.throws(()=>assertCase(c),/incumbent/i);
});
test('evidence references must be arrays of unique identifiers',()=>{
 for(const value of ['e1',[null],[2],['e1','e1'],Array(501).fill('e1')]){const c=structuredClone(example);c.candidates[1].evidenceIds=value;assert.throws(()=>assertCase(c),/evidence reference/i)}
});
test('event references cannot silently cite missing evidence',()=>{
 const c=comparisonCase();c.events[0].evidenceIds=['absent'];assert.ok(assess(c).issues.some(x=>x.severity==='ERROR' && x.text.includes('absent')));
});
test('all known text fields reject empty, coercible and oversized values',()=>{
 const edits=[c=>c.title=7,c=>c.subtitle='x'.repeat(2001),c=>c.rollback={},c=>c.rollback='x'.repeat(2001),c=>c.events[0].at=0,c=>c.events[0].description='',c=>c.candidates[0].testResults[0].name='x'.repeat(201),c=>c.candidates[0].name=' ',c=>c.evidence[0].digest=123];
 for(const edit of edits){const c=structuredClone(example);edit(c);assert.throws(()=>assertCase(c))}
});
test('rollback is required before staging a proposal',()=>{
 const c=structuredClone(example);delete c.rollback;assert.throws(()=>makeDecisionPacket(c,'cand','2026-10-19T00:00:00Z'),/rollback/i);
});
test('imported assurance never authenticates a witness or makes reviewable evidence',()=>{
 for(const assurance of ['INDEPENDENT','AUTHENTICATED']){const c=comparisonCase();c.evidence[0].assurance=assurance;const a=assess(c);assert.equal(a.scored[1].independent,0);assert.equal(a.scored[1].confidence,'INCONCLUSIVE');assert.equal(a.decisions[0].recommendation,'INCONCLUSIVE');assert.ok(a.issues.some(x=>/untrusted/i.test(x.text)))}
});
test('equal pass counts with unequal test IDs are an invalid comparison',()=>{
 const c=comparisonCase();c.candidates[1].testResults[0].id='unrelated';const a=assess(c);assert.equal(a.decisions[0].comparable,false);assert.ok(a.issues.some(x=>x.severity==='ERROR' && /test identities/i.test(x.text)));assert.notEqual(a.decisions[0].recommendation,'REVIEW');
});
test('different workload IDs are an invalid comparison',()=>{
 const c=comparisonCase();c.candidates[1].workloadId='different-suite';const a=assess(c);assert.equal(a.decisions[0].comparable,false);assert.ok(a.issues.some(x=>x.severity==='ERROR' && /workload/i.test(x.text)));
});
test('undeclared workloads cannot establish a comparable evaluation',()=>{
 const c=comparisonCase();for(const x of c.candidates)delete x.workloadId;const a=assess(c);assert.equal(a.decisions[0].comparable,false);assert.ok(a.issues.some(x=>x.severity==='ERROR' && /workload/i.test(x.text)));
});
test('duplicate test names or IDs are rejected instead of counting more passes',()=>{
 for(const row of [{id:'correctness',name:'Other',outcome:'PASS'},{id:'other',name:'Correctness',outcome:'PASS'}]){const c=comparisonCase();c.candidates[1].testResults.push(row);assert.throws(()=>assertCase(c),/duplicate test/i)}
});
test('missing reference errors block reviewable proposals',()=>{
 const c=comparisonCase();c.candidates[1].evidenceIds.push('missing');const a=assess(c);assert.equal(a.scored[1].confidence,'INCONCLUSIVE');assert.notEqual(a.decisions[0].recommendation,'REVIEW');const p=makeDecisionPacket(c,'cand','2026-10-19T00:00:00Z');assert.equal(p.reviewable,false);assert.ok(p.riskFlags.some(x=>x.severity==='ERROR'));
});
test('canonical object ordering uses code units, independent of locale',()=>{
 assert.equal(canonical({'ä':1,z:2,A:3,a:4}),'{'+'"A":3,"a":4,"z":2,"ä":1}');
});
test('canonical integer-like keys retain code-unit ordering',()=>{
 assert.equal(canonical({'2':'two','10':'ten'}),'{"10":"ten","2":"two"}');
});
test('timeline equal-time ordering is deterministic by identifier',()=>{
 const c=structuredClone(example);c.events[1].at=c.events[0].at;c.events[0].id='z';c.events[1].id='a';assert.deepEqual(assess(c).events.slice(0,2).map(x=>x.id),['a','z']);
});
test('digest casing cannot hide reuse of the same bytes',()=>{
 const c=structuredClone(example);c.evidence[0].digest='a'.repeat(64);c.evidence[1].digest='A'.repeat(64);assert.ok(assess(c).issues.some(x=>x.text.includes('Identical payload')));
});
test('oversized extensions and deep metadata are bounded in the kernel',()=>{
 const c=structuredClone(example);c.note='x'.repeat(2001);assert.throws(()=>assertCase(c));delete c.note;let value=c;for(let i=0;i<20;i++)value=value.extra={};assert.throws(()=>assertCase(c));
});

// Execute the actual browser handlers with a small DOM adapter; SHA promises can
// be held to reproduce edits while asynchronous work is still in flight.
async function workbench() {
 const elements=new Map(),downloads=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:id==='download',click(){},addEventListener(type,handler){this['on'+type]=handler}});return elements.get(id)};
 const queue=[];
 let hold=false,skip=0;
 const hash=async value=>{const result=await sha256(value);if(hold){if(skip>0)skip--;else await new Promise(resolve=>queue.push(resolve))}return result};
 const kernel={example,assertCase,assess,sha256:hash,makeDecisionPacket};
 const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
 const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*?;\s*/,'const {example,assertCase,assess,sha256,makeDecisionPacket}=kernel;\n');
 const sandbox={kernel,JSON,structuredClone,Blob,Date,setTimeout,document:{getElementById:element,createElement:()=>({click(){downloads.push(sandbox.lastBlob)}})},URL:{createObjectURL(blob){sandbox.lastBlob=blob;return 'blob:local'},revokeObjectURL(){}}};
 vm.runInNewContext(script,sandbox);
 const tick=()=>new Promise(resolve=>setTimeout(resolve,10));await tick();
 return {element,tick,downloads,hold(count=0){hold=true;skip=count},async release(reverse=false){hold=false;while(queue.length)(reverse?queue.pop():queue.shift())();await tick()},async waiting(count=1){for(let n=0;n<100 && queue.length<count;n++)await tick();assert.ok(queue.length>=count,'expected pending hashes')},async generate(){element('deadline').value='2030-01-01T00:00';await element('packet').onclick()},async import(c){await element('file').onchange({target:{files:[{size:100,text:async()=>JSON.stringify(c)}],value:'case.json'}})}};
}
test('successful import clears visible packet and disables download',async()=>{
 const ui=await workbench();await ui.generate();assert.ok(ui.element('output').textContent);await ui.import({...structuredClone(example),caseId:'new-case'});assert.equal(ui.element('output').textContent,'');assert.equal(ui.element('download').disabled,true);
});
test('deadline edits invalidate the staged packet',async()=>{
 const ui=await workbench();await ui.generate();ui.element('deadline').value='2030-02-01T00:00';ui.element('deadline').oninput?.();assert.equal(ui.element('output').textContent,'');assert.equal(ui.element('download').disabled,true);
});
test('reset while hashing cannot restore a stale staged packet',async()=>{
 const ui=await workbench();ui.hold(1);const pending=ui.generate();await ui.waiting();ui.element('reset').onclick();await ui.release();await pending;assert.equal(ui.element('output').textContent,'');assert.equal(ui.element('download').disabled,true);
});
test('failed import invalidates a previously staged packet',async()=>{
 const ui=await workbench();await ui.generate();await ui.import({schema:'wrong'});assert.equal(ui.element('output').textContent,'');assert.equal(ui.element('download').disabled,true);assert.ok(ui.element('error').textContent);
});
test('an older file read cannot replace a newer import',async()=>{
 const ui=await workbench();let finish;const old=ui.element('file').onchange({target:{files:[{size:100,text:()=>new Promise(resolve=>finish=resolve)}],value:'old.json'}});await ui.import({...structuredClone(example),caseId:'newest-case'});finish(JSON.stringify({...structuredClone(example),caseId:'old-case',events:[]}));await old;assert.match(ui.element('timeline').innerHTML,/authored timeline/);
});
test('an assessment export interrupted by import never mixes case revisions',async()=>{
 const ui=await workbench();ui.hold();const pending=ui.element('receipt').onclick();await ui.waiting();const imported=ui.import({...structuredClone(example),caseId:'new-case',events:[]});await ui.release();await Promise.all([pending,imported]);assert.equal(ui.downloads.length,0);
});
test('an older render cannot repaint a newer case after hashing',async()=>{
 const ui=await workbench();ui.hold();const old=ui.import({...structuredClone(example),caseId:'old-case',events:[]});await ui.waiting();const newest=ui.import({...structuredClone(example),caseId:'new-case'});await ui.waiting(2);await ui.release(true);await Promise.all([old,newest]);assert.match(ui.element('timeline').innerHTML,/authored timeline/);
});
test('failed import repaints the retained case after cancelling an in-flight render',async()=>{
 const ui=await workbench();await ui.import({...structuredClone(example),caseId:'old-case',events:[]});ui.hold();ui.element('reset').onclick();await ui.waiting();const invalid=ui.import({schema:'wrong'});await ui.tick();await ui.release();await invalid;assert.match(ui.element('timeline').innerHTML,/authored timeline/);assert.ok(ui.element('error').textContent);
});
test('real lineage example imports as untrusted source history without execution claims',async()=>{
 const c=JSON.parse(await readFile(new URL('./examples/real-lineage.case.json',import.meta.url),'utf8')),a=assess(c);
 assert.deepEqual(c.evidence.map(x=>x.source.commit.slice(0,7)),['facee28','cab8dfb','a9d4389']);
 assert.ok(c.evidence.every(x=>x.assurance==='UNVERIFIED' && /^[a-f0-9]{64}$/.test(x.digest)));
 assert.ok(c.candidates.every(x=>x.testResults.every(t=>t.outcome==='UNKNOWN')));
 assert.equal(a.issues.filter(x=>x.severity==='ERROR').length,0);assert.equal(a.decisions[0].comparable,true);assert.equal(a.decisions[0].recommendation,'INCONCLUSIVE');assert.equal(c.deadline,undefined);
 const ui=await workbench();await ui.import(c);assert.equal(ui.element('error').textContent,'');assert.match(ui.element('timeline').innerHTML,/Meteor/);
});
