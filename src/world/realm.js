export const locations = Object.freeze({
  guild_hall: "Guild Hall",
  forge: "Forge",
  evidence_archive: "Evidence Archive",
  decision_chamber: "Decision Chamber",
  town_square: "TownSquare",
  academy: "Polymath Academy"
});

export function projectRealm(state) {
  return {
    locations,
    avatar: { xp: state.xp || 0, inventory: { ...(state.inventory || {}) } },
    quests: { ...(state.quests || {}) },
    history: (state.history || []).map(event => event.event_id)
  };
}
