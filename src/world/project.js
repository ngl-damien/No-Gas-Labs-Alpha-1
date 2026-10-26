import { verifyReceipt } from "../evidence/content-addressed.js";

const EMPTY = () => ({
  history: [], quests: {}, xp: 0, inventory: {}, world: {}, seen: [], revoked: []
});

// Event labels are claims, not attestations. The host injects trust roots
// independently of the event producer; missing, non-boolean or throwing
// verifiers fail closed. Events are still retained in history for later review.
function trustedByHost(event, verifier) {
  if (typeof verifier !== "function") return false;
  try {
    return verifier(structuredClone(event)) === true;
  } catch {
    return false;
  }
}

export function hasVerifiedObservation(e, resolveArtifact, verifyObservation) {
  return e?.admission === "ACCEPTED" &&
    e.authority === "AUTHORIZED" &&
    e.execution === "EXECUTED" &&
    ["OBSERVED", "REFUTED"].includes(e.evidence) &&
    e.observation_verification === "VERIFIED" &&
    Array.isArray(e.receipts) &&
    e.receipts.length > 0 &&
    e.receipts.every(receipt => verifyReceipt(receipt, resolveArtifact)) &&
    trustedByHost(e, verifyObservation);
}

export function isVerifiedAdjudication(event, verifyAdjudication) {
  return trustedByHost(event, verifyAdjudication);
}

const terminalSuccess = (e, resolveArtifact, verifyObservation) =>
  e?.outcome === "SUCCEEDED" &&
  e.evidence === "OBSERVED" &&
  hasVerifiedObservation(e, resolveArtifact, verifyObservation);

export function projectWorld(events, seed = EMPTY(), { resolveArtifact, verifyObservation, verifyAdjudication } = {}) {
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
      if (isVerifiedAdjudication(event, verifyAdjudication) && typeof event.revokes === "string" && event.revokes) revoked.add(event.revokes);
      continue;
    }

    const subject = event.subject || event.event_id;

    if (event.event_type === "CLAIM" || event.event_type === "PROPOSAL") {
      state.quests[subject] = { status: "PROPOSED", source_event: event.event_id };
      continue;
    }

    if (event.admission === "REJECTED" && isVerifiedAdjudication(event, verifyAdjudication)) {
      state.quests[subject] = { ...(state.quests[subject] || {}), status: "REJECTED", source_event: event.event_id };
      continue;
    }

    if (event.outcome === "FAILED" || event.evidence === "REFUTED") {
      if (hasVerifiedObservation(event, resolveArtifact, verifyObservation)) {
        state.quests[subject] = {
          ...(state.quests[subject] || {}),
          status: event.outcome === "FAILED" ? "FAILED" : "REJECTED",
          source_event: event.event_id
        };
      }
      continue;
    }

    // An unverified rejection remains in history but cannot change projected state.
    if (event.admission === "REJECTED") continue;

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
