import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compareCandidates} from '../src/forge/runner.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
await mkdir(join(root,'.runtime'),{recursive:true});
const out=await mkdtemp(join(root,'.runtime/throughput-'));
const implementations={loop:'export function sum(values){let n=0;for(const v of values)n+=v;return n;}',reduce:'export function sum(values){return values.reduce((n,v)=>n+v,0);}',indexed:'export function sum(values){let n=0;for(let i=0;i<values.length;i++)n+=values[i];return n;}'};
const candidates=Object.entries(implementations).map(([id,source])=>({id,overlay:{'fixtures/forge/workload/candidate.mjs':source}}));
const samples=[];
// Alternate order to expose, rather than hide, warmup and scheduling effects.
for(const[trial,concurrency]of[[1,1],[1,3],[2,3],[2,1]]){
 const result=await compareCandidates({sourceDir:root,outDir:join(out,`trial-${trial}-concurrency-${concurrency}`),candidates,limits:{timeoutMs:1500,maxOutputBytes:65536,concurrency}});
 if(!result.results.every(r=>r.correct))throw Error('A measured candidate failed; throughput comparison is invalid');
 samples.push({trial,concurrency,sourceDigest:result.source.digest,taskId:result.taskId,wallMs:result.timing.wallMs,copyAndSnapshotMs:result.timing.snapshotMs+result.results.reduce((n,r)=>n+r.timing.copyMs,0),aggregateRuntimeMs:result.timing.aggregateRuntimeMs,aggregateVerificationOverheadMs:result.timing.aggregateVerificationOverheadMs,passing:result.results.length});
}
if(new Set(samples.map(s=>s.sourceDigest)).size!==1)throw Error('Source changed during measurement; samples cannot be compared');
const mean=values=>values.reduce((n,v)=>n+v,0)/values.length;
const serialMs=mean(samples.filter(s=>s.concurrency===1).map(s=>s.wallMs)),parallelMs=mean(samples.filter(s=>s.concurrency===3).map(s=>s.wallMs));
const report={schema:'ngl.throughput-measurement.v1',observedAt:new Date().toISOString(),workload:'Three correct vector-sum implementations, each200×10000 numbers plus7 correctness/input-preservation cases; identical frozen source bytes.',samples,serialMeanMs:serialMs,parallelMeanMs:parallelMs,observedRatio:serialMs/parallelMs,ratioMeaning:'Mean sequential wall time / mean three-worker wall time across2 alternating trials. Includes snapshot/copy, Node startup, verification and integrity costs.',limitations:['Two local samples per mode, no statistical significance or cross-machine guarantee.','No measured human-labor baseline; no3600× claim.','The microbenchmark does not establish year-long institutional development acceleration.','Correctness is a prerequisite; wrong and timed-out candidates are tested in the separate institutional exercise.']};
await writeFile(join(out,'throughput.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({report:join(out,'throughput.json'),serialMeanMs:serialMs,parallelMeanMs:parallelMs,observedRatio:report.observedRatio},null,2));
