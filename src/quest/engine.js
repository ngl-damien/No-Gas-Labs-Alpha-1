export const QUEST_STATUS=Object.freeze({OPEN:"OPEN",AUTHORIZED:"AUTHORIZED",IN_PROGRESS:"IN_PROGRESS",COMPLETED:"COMPLETED",FAILED:"FAILED"});

export function defineQuest({quest_id,title,objective,acceptance,capabilities=[]}) {
  if (![quest_id,title,objective].every(v=>typeof v==="string"&&v.length)) throw new Error("quest identity required");
  if (!Array.isArray(acceptance)||acceptance.length===0||acceptance.some(a=>typeof a!=="string"||!a)) throw new Error("acceptance conditions required");
  return Object.freeze({schema:"ngl.quest.v1",quest_id,title,objective,acceptance:[...acceptance],capabilities:[...capabilities]});
}

export function projectQuest(quest, events=[], {authorize}={}) {
  const relevant=events.filter(e=>e?.quest_id===quest.quest_id||e?.subject===quest.quest_id);
  const authorized=relevant.some(e=>e.type==="QUEST_AUTHORIZED"&&e.grant_id&&typeof authorize==="function"&&authorize(e)===true);
  const executions=authorized?relevant.filter(e=>e.event_type==="EXECUTION_ADJUDICATION"&&e.admission==="ACCEPTED"&&typeof authorize==="function"&&authorize(e)===true):[];
  const succeeded=executions.filter(e=>e.outcome==="SUCCEEDED");
  const failed=executions.filter(e=>e.outcome==="FAILED");
  const satisfied=new Set(succeeded.flatMap(e=>Array.isArray(e.acceptance_satisfied)?e.acceptance_satisfied:[]));
  const complete=quest.acceptance.every(a=>satisfied.has(a));
  const status=complete?QUEST_STATUS.COMPLETED:failed.length&&authorized?QUEST_STATUS.FAILED:succeeded.length?QUEST_STATUS.IN_PROGRESS:authorized?QUEST_STATUS.AUTHORIZED:QUEST_STATUS.OPEN;
  return Object.freeze({quest,status,authorized,acceptance:Object.freeze(quest.acceptance.map(id=>Object.freeze({id,satisfied:satisfied.has(id)}))),executions:Object.freeze(executions.map(e=>e.event_id))});
}

export function authorizeQuest({quest,grant_id,actor="founder"}) {
  if (!grant_id) throw new Error("grant_id required");
  return Object.freeze({event_id:`authorize:${quest.quest_id}:${grant_id}`,type:"QUEST_AUTHORIZED",quest_id:quest.quest_id,grant_id,actor});
}
