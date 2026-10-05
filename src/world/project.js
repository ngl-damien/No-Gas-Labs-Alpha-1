const EMPTY = () => ({
  history: [],
  quests: {},
  xp: 0,
  inventory: {},
  world: {},
  seen: []
});

const terminalSuccess = e =>
  e.admission === "ACCEPTED" &&
  e.authority === "AUTHORIZED" &&
  e.execution === "EXECUTED" &&
  e.evidence === "OBSERVED" &&
  e.outcome === "SUCCEEDED" &&
  Array.isArray(e.receipts) && e.receipts.length > 0;

export function projectWorld(events, seed = EMPTY()) {
  const state = structuredClone(seed);
  const seen = new Set(state.seen || []);

  for (const event of events) {
    if (!event?.event_id || seen.has(event.event_id)) continue;
    seen.add(event.event_id);
    state.history.push(event);

    const subject = event.subject || event.event_id;

    if (event.event_type === "CLAIM" || event.event_type === "PROPOSAL") {
      state.quests[subject] = {
        status: "PROPOSED",
        source_event: event.event_id
      };
      continue;
    }

    if (event.outcome === "FAILED" || event.evidence === "REFUTED" || event.admission === "REJECTED") {
      state.quests[subject] = {
        ...(state.quests[subject] || {}),
        status: event.outcome === "FAILED" ? "FAILED" : "REJECTED",
        source_event: event.event_id
      };
      continue;
    }

    if (!terminalSuccess(event)) continue;

    state.quests[subject] = {
      ...(state.quests[subject] || {}),
      status: "COMPLETED",
      source_event: event.event_id
    };

    const effect = event.world_effect || {};
    if (Number.isFinite(effect.xp) && effect.xp > 0) state.xp += effect.xp;

    for (const [item, amount] of Object.entries(effect.inventory || {})) {
      if (Number.isFinite(amount)) state.inventory[item] = (state.inventory[item] || 0) + amount;
    }

    Object.assign(state.world, effect.world || {});
  }

  state.seen = [...seen];
  return state;
}
