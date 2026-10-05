export function guildHallView(room) {
  if (room?.room!=="Guild Hall") throw new Error("Guild Hall projection required");
  return Object.freeze({
    screen_id:"guild-hall",
    title:"Guild Hall",
    subtitle:room.quest.title,
    state_hash:room.state_hash,
    primary:Object.freeze({
      status:room.quest.status,
      objective:room.quest.objective,
      acceptance:room.quest.acceptance
    }),
    actions:Object.freeze([
      ...room.proposals.filter(p=>p.status==="PROPOSED").map(p=>Object.freeze({id:`review:${p.proposal_id}`,label:"Take to Decision Chamber",enabled:true,target:"decision-chamber"})),
      Object.freeze({id:"enter-forge",label:"Enter Forge",enabled:room.exits.forge==="UNLOCKED",target:"forge"}),
      Object.freeze({id:"open-evidence",label:"Evidence Archive",enabled:true,target:"evidence-archive"})
    ]),
    roster:room.roster
  });
}
