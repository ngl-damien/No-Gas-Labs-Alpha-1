import {readFile,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateExperimentReport} from '../src/institution/experiment-report.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const text=value=>typeof value==='string'&&value.trim().length>0;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const machinery=value=>text(value)||(record(value)&&text(value.source)&&text(value.operation));
try{
 const path=process.argv[2]?resolve(process.argv[2]):resolve(root,'docs/institution/compounding/STATE.json');
 const state=JSON.parse(await readFile(path,'utf8'));
 if(state.schema!=='ngl.institution-continuity.v1'||state.principal!=='Damien Featherstone'||!Array.isArray(state.references)||!state.references.length||!Array.isArray(state.assignments)||!state.assignments.length||!state.authority||!state.nextAction||!state.rollback||!state.machinery?.M0||!state.machinery?.M1||!Array.isArray(state.openFailures)||!state.taskB||!state.founderDecision)throw Error('Incomplete continuity record');
 if(!text(state.authority)||!text(state.nextAction)||!text(state.rollback)||state.assignments.some(value=>!record(value)||!text(value.role)||!text(value.task))||!machinery(state.machinery.M0)||!machinery(state.machinery.M1)||state.openFailures.some(value=>!text(value))||!record(state.taskB)||!text(state.taskB.status)||!record(state.founderDecision)||typeof state.founderDecision.clockStarted!=='boolean'||(state.founderDecision.reviewWindowHours!==undefined&&(!Number.isSafeInteger(state.founderDecision.reviewWindowHours)||state.founderDecision.reviewWindowHours<1)))throw Error('Incomplete continuity record: responsibility and decision fields must have meaningful types');
 const recovered=[],validatedReports=[];
 for(const reference of state.references){if(typeof reference.path!=='string'||reference.path.includes('\\')||/(^|\/)(\.runtime|\.git|secrets|credentials)(\/|$)|\.(key|pem)$/i.test(reference.path)||!/^[a-f0-9]{64}$/.test(reference.sha256))throw Error('Unsafe recovery reference');const target=await realpath(resolve(root,reference.path)),r=relative(root,target);if(r==='..'||r.startsWith('..'+sep)||r.startsWith(sep))throw Error('Recovery reference escapes repository');const bytes=await readFile(target);if(createHash('sha256').update(bytes).digest('hex')!==reference.sha256)throw Error('Recovery reference changed: '+reference.path);if(reference.path.endsWith('.json')){const value=JSON.parse(bytes);if(value?.schema==='ngl.compounding-experiment.v1'){validateExperimentReport(value);validatedReports.push(reference.path);}}recovered.push(reference.path);}
 console.log(JSON.stringify({schema:'ngl.fresh-process-recovery.v1',passed:true,principal:state.principal,authority:state.authority,assignments:state.assignments,machinery:state.machinery,openFailures:state.openFailures,taskB:state.taskB,founderDecision:state.founderDecision,nextAction:state.nextAction,rollback:state.rollback,recovered,validatedReports,scope:'New Node process using durable files only; not a fresh cloud/environment restoration.'},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
