import { validatedEventList, isVerifiedAuthorization } from "./project.js";

export function projectGuildHall({
  institution, quest_id, events = [], agents = [], verifyAuthorization
}) {
  if (!institution?.projection) throw new Error("institution projection required");
  const eventList = validatedEventList(events, "Guild Hall event");
  if (typeof quest_id !== "string" || quest_id.length === 0) {
    throw new Error("quest_id required");
  }
  const projectedQuests = institution.projection.quests;
  // Projection maps are ordinary objects. Bracket lookup alone can return an
  // inherited Object.prototype member for an unknown quest ID (for example,
  // "toString"), incorrectly passing the not-found check.
  const quest = projectedQuests && Object.hasOwn(projectedQuests, quest_id)
    ? projectedQuests[quest_id]
    : undefined;
  if (!quest) throw new Error("quest not projected");

  const proposals = eventList.filter(event =>
    event?.type === "PROPOSAL" && event.quest_id === quest_id
  ).map(event => Object.freeze({
    proposal_id: event.event_id,
    actor: event.actor || "unknown",
    summary: event.summary || "",
    status: eventList.some(candidate =>
      candidate?.type === "QUEST_AUTHORIZED" &&
      candidate.proposal_id === event.event_id &&
      candidate.quest_id === event.quest_id &&
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
