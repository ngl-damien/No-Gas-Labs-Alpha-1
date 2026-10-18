import {artifactReceipt} from './kernel.mjs';
import {validateExperimentReport} from './experiment-report.mjs';
export function projectProjection(report){
 const result={schema:'ngl.institution-projects.v1',projects:[],accomplishments:[],disputes:[],decisions:[],witnessParticipation:'UNVERIFIED',roles:{viewer:'Read-only records.',resident:'Persistent resident accounts are not implemented; Witness sessions are ephemeral.',founder:'Authenticated scoped decisions.'},limitations:['Fingerprints identify bytes, not truth or independent witnesses.','These records grant no XP, promotion or authority.']};
 if(report==null)return result;
 validateExperimentReport(report);
 const receipt=artifactReceipt(JSON.stringify(report));result.reportReceipt=receipt;result.projects.push({id:report.id,title:'Alpha 1 · transferable component delivery',status:report.classification||'INCONCLUSIVE',evidenceDigest:receipt.digest});
 for(const key of ['A','B']){const task=report.tasks[key];result.accomplishments.push({id:`${report.id}-${key}`,title:task.title,status:task.m1.accepted===true?'LOCALLY_TESTED':'NOT_ACCEPTED',evidenceDigest:receipt.digest,requiredFiles:task.requiredFiles,baselineAccepted:task.m0.accepted,candidateAccepted:task.m1.accepted,limitation:'Report consistency only; not independent verification of execution or external use.'});}
 result.disputes=report.contradictions.map((entry,index)=>({id:`${report.id}-dispute-${index}`,statement:String(entry.statement).slice(0,2000),disposition:String(entry.disposition).slice(0,1000),evidenceDigest:entry.evidenceDigest||receipt.digest}));result.decisions.push({id:`${report.id}-adoption`,title:'Whether to adopt the experimental component exporter',status:'AWAITING_OPERATIONAL_GATE',reviewWindowHours:24,clockStarted:false,evidenceDigest:receipt.digest,limitation:'The authorized clock starts only after verified HTTPS reachability and evidence readiness.'});return result;
}
