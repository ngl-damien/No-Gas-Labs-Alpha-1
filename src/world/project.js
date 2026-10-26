import { verifyReceipt } from "../evidence/content-addressed.js";

const EMPTY = () => ({
  history: [], quests: {}, xp: 0, inventory: {}, world: {}, seen: [], revoked: []
});

// The status field is not an attestation. The host must inject a trusted
// verifier that validates observer provenance independently of the event producer.
function independentlyVerifiedObservation(event, verifyObservation) {
  if (typeof verifyObservation !== "function") return false;
  try {
    return verifyObservation(structuredClone(event)) === true;
  } catch {
    return false;
  }
}

const terminalSuccess = (e, resolveArtifact, verifyObservation) =>
  e.admission === "ACCEPTED" &&
  e.authority === "AUTHORIZED" &&
  e.execution === "EXECUTED" &&
  e.evidence === "OBSERVED" &&
  e.outcome === "SUCCEEDED" &&
  e.observation_verification === "VERIFIED" &&
  Array.isArray(e.receipts) &&
  e.receipts.length > 0 &&
  e.receipts.every(receipt => verifyReceipt(receipt, resolveArtifact)) &&
  independentlyVerifiedObservation(e, verifyObservation);

export function projectWorld(events, seed = EMPTY(), { resolveArtifact, verifyObservation } = {}) {
  const state = structuredClone(seed);
  const seen = new Set(state.seen || []);
  const revoked = new Set(state.revoked || []);

  for (const event of events) {
    if (!event?.event_id || seen.has(event.event_id)) continue;

    const parents = Array.isArray(event.parents) ? event.parents : [];
    if (parents.some(parent => !seen.has(parent))) throw new Error(`unresolved parent for ${event.event_id}`);

    seen.add(event.event_id);
    state.history.push(event);

    if (event.event_type === "REVOCATION") {
      if (typeof event.revokes === "string" && event.revokes) revoked.add(event.revokes);
      continue;
    }

    const subject = event.subject || event.event_id;

    if (event.event_type === "CLAIM" || event.event_type === "PROPOSAL") {
      state.quests[subject] = { status: "PROPOSED", source_event: event.event_id };
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

    if (revoked.has(event.grant_id) || !terminalSuccess(event, resolveArtifact, verifyObservation)) continue;

    state.quests[subject] = { ...(state.quests[subject] || {}), status: "COMPLETED", source_event: event.event_id };
    const effect = event.world_effect || {};
    if (Number.isFinite(effect.xp) && effect.xp > 0) state.xp += effect.xp;
    for (const [item, amount] of Object.entries(effect.inventory || {})) {
      if (Number.isFinite(amount)) state.inventory[item] = (state.inventory[item] || 0) + amount;
    }
    Object.assign(state.world, effect.world || {});
  }

  state.seen = [...seen];
  state.revoked = [...revoked];
  return state;
}
