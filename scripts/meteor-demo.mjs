import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
import {openLedger} from '../src/institution/ledger.mjs';
import {artifactReceipt} from '../src/institution/kernel.mjs';
const exec=promisify(execFile),ROOT=fileURLToPath(new URL('..',import.meta.url));

/** Real, bounded institutional exercise, with a fixture courier worker and actual candidate programs. */
export async function runMeteor({outDir}={}){
 if(!outDir){await mkdir(join(ROOT,'.runtime'),{recursive:true});outDir=await mkdtemp(join(ROOT,'.runtime/meteor-'));}
 outDir=resolve(outDir);await mkdir(outDir,{recursive:true,mode:0o700});
 const start=performance.now(),stages=[];
 async function stage(name,args){const at=performance.now();const {stdout,stderr}=await exec(process.execPath,args,{cwd:ROOT,timeout:60000,maxBuffer:4*1024*1024});await writeFile(join(outDir,`${name}.stdout.log`),stdout,{mode:0o600});await writeFile(join(outDir,`${name}.stderr.log`),stderr,{mode:0o600});const parsed=JSON.parse(stdout);stages.push({name,wallMs:performance.now()-at,exitCode:0});return parsed;}
 const courier=await stage('courier',['scripts/courier.mjs','demo','--data-dir',join(outDir,'courier'),'--out',join(outDir,'courier-receipts.json')]);
 if(courier.externalProviderExecuted!==false||courier.request.seats[0].status!=='RESPONDED')throw Error('Courier fixture did not complete its signed transport exercise');
 const forge=await stage('forge',['scripts/forge.mjs','demo','--out',join(outDir,'forge')]);
 const outcomes=forge.results.map(r=>r.outcome);if(JSON.stringify(outcomes)!==JSON.stringify(['passing','failed','timed_out']))throw Error('Forge did not distinguish the three actual programs');
 const repository=await stage('repository-verification',['scripts/forge.mjs','verify','--out',join(outDir,'repository')]);
 const verification=JSON.parse(await readFile(join(outDir,'repository/report.json'),'utf8'));
 if(!verification.correct||verification.tests.counts.tests<1||!verification.integrity.passed)throw Error('Actual copied repository verification failed');
 const result={schema:'ngl.meteor-exercise.v1',mode:'LOCAL_EXECUTION',externalProvidersExecuted:[],courier:{workerPid:courier.worker.pid,requestId:courier.request.requestId,status:courier.request.seats[0].status,acknowledgmentVerified:true,responseVerified:true,dissent:courier.request.seats[0].dissent??courier.request.seats[0].response?.payload?.dissent??null},forge:{taskId:forge.taskId,outcomes,results:forge.results,timing:forge.timing},repository:{taskId:verification.taskId,outcome:verification.outcome,tests:verification.tests.counts,integrity:verification.integrity,timing:verification.timing},stages,limitations:['The courier worker is a real local fixture process, not an external model or an independent Council seat.','The kernel observation verifies exact report bytes and explicitly tested statuses; it does not establish market demand or public deployment.','No human-labor baseline,3600-fold speedup or autonomous constitutional modification is claimed.']};
 const bytes=Buffer.from(JSON.stringify(result,null,2)+'\n'),r=artifactReceipt(bytes),actors=[{id:'commissioned-founder',roles:['founder']},{id:'local-engineering',roles:['executor']},{id:'local-report-verifier',roles:['observer']}];
 const ledger=await openLedger({directory:join(outDir,'ledger'),actors,founderId:'commissioned-founder'});
 try{
  const workId='meteor-local-exercise',subject={id:'meteor-execution-report',version:1},grantId='meteor-report-grant',executionId='meteor-report-execution',at=Date.now();
  const append=async(type,actor,fields)=>ledger.append({id:`meteor-${type}`,type,actor,at:new Date(at+ledger.state.revision).toISOString(),expectedRevision:ledger.state.revision,workId,...fields},{artifacts:new Map([[r.digest,bytes]])});
  await append('claim','local-engineering',{subject,action:'preserve-local-execution-report'});
  await append('authorize','commissioned-founder',{grantId,executorId:'local-engineering',observerId:'local-report-verifier',scope:{subjectId:subject.id,subjectVersion:1,action:'preserve-local-execution-report'}});
  await append('execute','local-engineering',{grantId,executionId,subject,outputs:[r]});
  await append('observe','local-report-verifier',{grantId,executionId,subject,outputs:[r],passed:true,checks:['Signed local courier reached RESPONDED','Actual Forge outcomes passing/failed/timed_out','Exact report SHA-256 bytes retained']});
  await append('adjudicate','commissioned-founder',{grantId,executionId,subject,outputs:[r],observationId:'meteor-observe',decision:'accept'});
  await writeFile(join(outDir,'exercise.json'),JSON.stringify({...result,reportReceipt:r,kernel:{revision:ledger.state.revision,work:ledger.state.works[workId],head:ledger.head},wallMs:performance.now()-start},null,2)+'\n',{mode:0o600});
 }finally{await ledger.close();}
 return{outDir,report:join(outDir,'exercise.json'),wallMs:performance.now()-start,outcomes,courierStatus:result.courier.status};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--out'))throw Error('Usage: npm run meteor -- [--out fresh-directory]');console.log(JSON.stringify(await runMeteor({outDir:args[1]}),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
