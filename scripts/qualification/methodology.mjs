import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../..',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:root});
const report=JSON.parse(await readFile(root+'/docs/institution/compounding/evidence/experiment.json','utf8'));
const records=[];
const check=(id,work)=>{work();records.push({id,outcome:'PASS'});};
check('Q-SCI-001-harness-binding',()=>assert.equal(sha(git('show',`${report.source.commit}:${report.harness.path}`)),report.harness.sha256));
for(const key of ['A','B']){
 const profile=git('show',`${report.source.profileFreeze}:docs/institution/compounding/task-${key.toLowerCase()}.profile.json`);
 check(`Q-SCI-002-${key}-frozen-profile-binding`,()=>assert.equal(sha(profile),report.tasks[key].profileSHA256));
 check(`Q-SCI-003-${key}-changed-profile-negative`,()=>assert.notEqual(sha(Buffer.concat([profile,Buffer.from('\nchanged synthetic fixture')])),report.tasks[key].profileSHA256));
 check(`Q-AI-001-${key}-scoped-transfer-consistency`,()=>{const t=report.tasks[key];assert.equal(t.m0.integrity,true);assert.equal(t.m0.accepted,false);assert.equal(t.m1.accepted,true);assert.ok(t.m1.tests.count>0);assert.equal(t.m1.tests.exitCode,0);assert.equal(t.m1.matchedFiles,t.requiredFiles);});
 const bytes=await readFile(root+'/'+report.tasks[key].artifact);
 check(`Q-SCI-004-${key}-delivered-byte-binding`,()=>assert.equal(sha(bytes),report.tasks[key].m1.archiveSHA256));
}
check('Q-SCI-005-negative-tests-recorded',()=>{assert.equal(report.negative.tamperedZIPRejected,true);assert.equal(report.negative.undeclaredPrivateMemberRejected,true);});
check('Q-AI-002-no-human-speedup-inference',()=>{assert.equal(report.founderBurden.baselineHumanInterventions,null);assert.match(report.founderBurden.conclusion,/INCONCLUSIVE/);assert.match(report.criterion,/not a speed comparison/);});
check('Q-AI-003-no-fabricated-operational-gate',()=>{assert.equal(report.governance.operationalDecisionCreated,false);assert.equal(report.governance.clockStarted,false);});
const result={schema:'ngl.qualification.methodology.v1',baseline:'3d8485a7a5bf592dbc30d64691848f63e54b2211',scope:'Internal AI provenance/coherence checks, not re-observation of historical processes or independent specialist certification.',reportSHA256:sha(await readFile(root+'/docs/institution/compounding/evidence/experiment.json')),records,limitations:['The prior experiment measures declared delivery capability against a narrower incumbent, not comparable elapsed speed.','Source tests and the evaluator remain controlled by one institution; pins identify bytes but do not establish an independent functional oracle.','Worker isolation was procedural. No cross-provider operation or sustained autonomy is established.','No historical human-intervention baseline or external-user acceptance is available.','The separate delegated methodology turn failed at a tool safety boundary; its unexecuted candidate-output concern remains a hypothesis, not a confirmed finding.']};
await mkdir(root+'/docs/institution/qualification/evidence',{recursive:true});await writeFile(root+'/docs/institution/qualification/evidence/methodology-autonomy.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({checks:records.length,passed:true}));
