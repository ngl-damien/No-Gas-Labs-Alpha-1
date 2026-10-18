import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=new URL('..',import.meta.url);
const valid=JSON.parse(await readFile(new URL('docs/institution/compounding/evidence/experiment.json',root),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function recover(report){const dir=await mkdtemp(join(tmpdir(),'ngl-report-transfer-'));try{
 await mkdir(join(dir,'scripts'));await mkdir(join(dir,'src/institution'),{recursive:true});
 for(const path of ['scripts/recover-institution.mjs','src/institution/experiment-report.mjs'])await copyFile(new URL(path,root),join(dir,path));
 const bytes=JSON.stringify(report);await writeFile(join(dir,'experiment.json'),bytes);
 const state={schema:'ngl.institution-continuity.v1',principal:'Damien Featherstone',authority:'Founder retains protected authority',assignments:[{role:'executor',task:'Verify retained work'}],references:[{path:'experiment.json',sha256:hash(bytes)}],machinery:{M0:'incumbent',M1:'candidate'},openFailures:['No operational HTTPS Gate'],taskB:{status:'held-out coherence check'},founderDecision:{clockStarted:false},nextAction:'Recover before continuing',rollback:'Preserve incumbent'};
 await writeFile(join(dir,'state.json'),JSON.stringify(state));return spawnSync(process.execPath,[join(dir,'scripts/recover-institution.mjs'),join(dir,'state.json')],{encoding:'utf8',timeout:10000});
 }finally{await rm(dir,{recursive:true,force:true});}}
test('fresh-process recovery retains a byte-matching consistent experiment',async()=>{const result=await recover(valid);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).passed,true);});
for(const [name,mutate]of [['string acceptance',r=>r.tasks.A.m1.accepted='false'],['zero tests',r=>r.tasks.A.m1.tests.count=0],['failed tests',r=>r.tasks.A.m1.tests.exitCode=1],['failed integrity',r=>r.tasks.A.m1.integrity=false]])test('fresh-process recovery rejects byte-matching '+name,async()=>{const report=structuredClone(valid);mutate(report);const result=await recover(report);assert.notEqual(result.status,0);assert.match(result.stderr,/experiment report/i);});
