import { projectLocationEvidence } from "../location/evidence.js";
import { hasVerifiedObservation, isVerifiedAdjudication } from "../world/project.js";
export const QUEST_STATUS=Object.freeze({OPEN:"OPEN",AUTHORIZED:"AUTHORIZED",IN_PROGRESS:"IN_PROGRESS",COMPLETED:"COMPLETED",FAILED:"FAILED",REJECTED:"REJECTED"});

export function defineQuest({quest_id,title,objective,acceptance,capabilities=[]}) {
  if (![quest_id,title,objective].every(v=>typeof v==="string"&&v.length)) throw new Error("quest identity required");
  if (!Array.isArray(acceptance)||acceptance.length===0||acceptance.some(a=>typeof a!=="string"||!a)) throw new Error("acceptance conditions required");
  return Object.freeze({schema:"ngl.quest.v1",quest_id,title,objective,acceptance:[...acceptance],capabilities:[...capabilities]});
}

export function projectQuest(quest, events=[], {resolveArtifact,verifyObservation,verifyAdjudication}={}) {
  const relevant=events.filter(e=>e?.quest_id===quest.quest_id||e?.subject===quest.quest_id);
  const authorized=relevant.some(e=>e.type==="QUEST_AUTHORIZED"&&e.grant_id);
  // Keep raw claims visible, but only independently observed, byte-verified
  // executions may satisfy acceptance conditions or set terminal failure.
  const executions=relevant.filter(e=>e.event_type==="EXECUTION_ADJUDICATION"&&e.admission==="ACCEPTED");
  const verifiedExecutions=executions.filter(e=>hasVerifiedObservation(e,resolveArtifact,verifyObservation));
  const succeeded=verifiedExecutions.filter(e=>e.outcome==="SUCCEEDED"&&e.evidence==="OBSERVED");
  const failed=verifiedExecutions.filter(e=>e.outcome==="FAILED"||e.evidence==="REFUTED");
  const rejections=relevant.filter(e=>e.event_type==="EXECUTION_ADJUDICATION"&&e.admission==="REJECTED");
  const verifiedRejections=rejections.filter(e=>isVerifiedAdjudication(e,verifyAdjudication));
  const satisfied=new Set(succeeded.flatMap(e=>Array.isArray(e.acceptance_satisfied)?e.acceptance_satisfied:[]));
  const complete=quest.acceptance.every(a=>satisfied.has(a));
  const status=complete?QUEST_STATUS.COMPLETED:verifiedRejections.length?QUEST_STATUS.REJECTED:failed.length&&authorized?QUEST_STATUS.FAILED:succeeded.length?QUEST_STATUS.IN_PROGRESS:authorized?QUEST_STATUS.AUTHORIZED:QUEST_STATUS.OPEN;
  const location_observations=projectLocationEvidence(relevant,quest.quest_id);
  return Object.freeze({
    quest,status,authorized,location_observations,
    acceptance:Object.freeze(quest.acceptance.map(id=>Object.freeze({id,satisfied:satisfied.has(id)}))),
    executions:Object.freeze(executions.map(e=>e.event_id)),
    verified_executions:Object.freeze(verifiedExecutions.map(e=>e.event_id)),
    rejections:Object.freeze(rejections.map(e=>e.event_id)),
    verified_rejections:Object.freeze(verifiedRejections.map(e=>e.event_id))
  });
}

export function authorizeQuest({quest,grant_id,actor="founder"}) {
  if (!grant_id) throw new Error("grant_id required");
  return Object.freeze({event_id:`authorize:${quest.quest_id}:${grant_id}`,type:"QUEST_AUTHORIZED",quest_id:quest.quest_id,grant_id,actor});
}
