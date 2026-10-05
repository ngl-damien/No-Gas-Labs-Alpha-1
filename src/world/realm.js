export const locations = Object.freeze({
  guild_hall: "Guild Hall",
  forge: "Forge",
  evidence_archive: "Evidence Archive",
  decision_chamber: "Decision Chamber",
  town_square: "TownSquare",
  academy: "Polymath Academy",
  moonshot_field: "Moonshot Field",
  publication_house: "Publication House"
});

function classifyEvent(event) {
  if (event.event_type === "REVOCATION") return "decision_chamber";
  if (event.outcome === "FAILED" || event.evidence === "REFUTED" || event.admission === "REJECTED") {
    return "evidence_archive";
  }
  if (event.event_type === "CLAIM" || event.event_type === "PROPOSAL") return "guild_hall";
  if (event.authority === "AUTHORIZED" && event.execution !== "EXECUTED") return "decision_chamber";
  if (event.execution === "EXECUTED") return "forge";
  return "evidence_archive";
}

export function projectRealm(state) {
  const institutions = Object.fromEntries(
    Object.keys(locations).map(id => [id, { event_ids: [] }])
  );

  for (const event of state.history || []) {
    institutions[classifyEvent(event)].event_ids.push(event.event_id);
  }

  return {
    locations,
    institutions,
    avatar: { xp: state.xp || 0, inventory: { ...(state.inventory || {}) } },
    quests: { ...(state.quests || {}) },
    history: (state.history || []).map(event => event.event_id)
  };
}
