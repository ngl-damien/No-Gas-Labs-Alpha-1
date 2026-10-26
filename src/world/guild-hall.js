import { isVerifiedAuthorization } from "./project.js";

export function projectGuildHall({
  institution, quest_id, events = [], agents = [], verifyAuthorization
}) {
  if (!institution?.projection) throw new Error("institution projection required");
  const quest = institution.projection.quests?.[quest_id];
  if (!quest) throw new Error("quest not projected");

  const proposals = events.filter(event =>
    event?.type === "PROPOSAL" && event.quest_id === quest_id
  ).map(event => Object.freeze({
    proposal_id: event.event_id,
    actor: event.actor || "unknown",
    summary: event.summary || "",
    status: events.some(candidate =>
      candidate?.type === "QUEST_AUTHORIZED" &&
      candidate.proposal_id === event.event_id &&
      isVerifiedAuthorization(candidate, verifyAuthorization)
    ) ? "AUTHORIZED" : "PROPOSED"
  }));

  const roster = agents.map(agent => Object.freeze({
    agent_id: agent.agent_id,
    capabilities: Array.isArray(agent.capabilities) ? [...agent.capabilities] : [],
    can_contribute: (agent.capabilities || []).some(capability =>
      quest.quest.capabilities.includes(capability)
    )
  }));

  return Object.freeze({
    room: "Guild Hall",
    state_hash: institution.state_hash,
    quest: Object.freeze({
      quest_id,
      title: quest.quest.title,
      objective: quest.quest.objective,
      status: quest.status,
      acceptance: quest.acceptance.map(item =>
        Object.freeze({ id: item.id, status: item.satisfied ? "SATISFIED" : "UNPROVEN" })
      )
    }),
    proposals: Object.freeze(proposals),
    roster: Object.freeze(roster),
    exits: Object.freeze({
      decision_chamber: proposals.some(proposal => proposal.status === "PROPOSED") ? "AVAILABLE" : "QUIET",
      forge: institution.projection.world.world?.forgeOpen === true ? "UNLOCKED" : "LOCKED",
      evidence_archive: "AVAILABLE"
    })
  });
}

export function proposeGuildAction({ quest_id, proposal_id, actor, summary, capability }) {
  if (![quest_id, proposal_id, actor, summary, capability].every(value =>
    typeof value === "string" && value.length
  )) throw new Error("complete proposal required");
  return Object.freeze({ event_id: proposal_id, type: "PROPOSAL", quest_id, actor, summary, capability });
}
