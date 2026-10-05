export function projectGuildHall({institution, quest_id, events=[], agents=[]}) {
  if (!institution?.projection) throw new Error("institution projection required");
  const quest=institution.projection.quests?.[quest_id];
  if (!quest) throw new Error("quest not projected");

  const proposals=events.filter(e=>e?.type==="PROPOSAL"&&e.quest_id===quest_id).map(e=>Object.freeze({
    proposal_id:e.event_id,
    actor:e.actor||"unknown",
    summary:e.summary||"",
    status:events.some(x=>x?.type==="QUEST_AUTHORIZED"&&x.proposal_id===e.event_id)?"AUTHORIZED":"PROPOSED"
  }));

  const roster=agents.map(a=>Object.freeze({
    agent_id:a.agent_id,
    capabilities:Array.isArray(a.capabilities)?[...a.capabilities]:[],
    can_contribute:(a.capabilities||[]).some(c=>quest.quest.capabilities.includes(c))
  }));

  return Object.freeze({
    room:"Guild Hall",
    state_hash:institution.state_hash,
    quest:Object.freeze({
      quest_id,
      title:quest.quest.title,
      objective:quest.quest.objective,
      status:quest.status,
      acceptance:quest.acceptance.map(a=>Object.freeze({id:a.id,status:a.satisfied?"SATISFIED":"UNPROVEN"}))
    }),
    proposals:Object.freeze(proposals),
    roster:Object.freeze(roster),
    exits:Object.freeze({
      decision_chamber:proposals.some(p=>p.status==="PROPOSED")?"AVAILABLE":"QUIET",
      forge:institution.projection.world.world?.forgeOpen===true?"UNLOCKED":"LOCKED",
      evidence_archive:"AVAILABLE"
    })
  });
}

export function proposeGuildAction({quest_id,proposal_id,actor,summary,capability}) {
  if (![quest_id,proposal_id,actor,summary,capability].every(v=>typeof v==="string"&&v.length)) throw new Error("complete proposal required");
  return Object.freeze({event_id:proposal_id,type:"PROPOSAL",quest_id,actor,summary,capability});
}
