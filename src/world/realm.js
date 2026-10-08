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

export const routes = Object.freeze({
  guild_hall: Object.freeze(["decision_chamber", "town_square", "academy"]),
  decision_chamber: Object.freeze(["guild_hall", "forge", "evidence_archive"]),
  forge: Object.freeze(["decision_chamber", "evidence_archive", "moonshot_field"]),
  evidence_archive: Object.freeze(["forge", "decision_chamber", "publication_house"]),
  town_square: Object.freeze(["guild_hall", "publication_house"]),
  publication_house: Object.freeze(["town_square", "evidence_archive"]),
  academy: Object.freeze(["guild_hall", "moonshot_field"]),
  moonshot_field: Object.freeze(["academy", "forge"])
});

export function canTravel(from, to) {
  return Boolean(locations[from] && locations[to] && routes[from]?.includes(to));
}

function classifyEvent(event) {
  if (event.event_type === "LOCATION_OBSERVATION") return "evidence_archive";
  if (event.event_type === "REVOCATION") return "decision_chamber";
  if (event.outcome === "FAILED" || event.evidence === "REFUTED" || event.admission === "REJECTED") {
    return "evidence_archive";
  }
  if (event.event_type === "PUBLICATION" || event.event_type === "SATIRE") return "publication_house";
  if (event.event_type === "MOONSHOT") return "moonshot_field";
  if (event.event_type === "LEARNING" || event.event_type === "SKILL_EVIDENCE") return "academy";
  if (event.event_type === "PUBLIC_COMMENT" || event.event_type === "PARTICIPATION") return "town_square";
  if (event.event_type === "CLAIM" || event.event_type === "PROPOSAL") return "guild_hall";
  if (event.authority === "AUTHORIZED" && event.execution !== "EXECUTED") return "decision_chamber";
  if (event.execution === "EXECUTED") return "forge";
  return "evidence_archive";
}

export function projectRealm(state) {
  const institutions = Object.fromEntries(
    Object.keys(locations).map(id => [id, { event_ids: [], exits: [...routes[id]] }])
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
