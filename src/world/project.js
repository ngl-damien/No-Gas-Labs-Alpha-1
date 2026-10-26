import { verifyReceipt } from "../evidence/content-addressed.js";

const EMPTY = () => ({
  history: [], quests: {}, xp: 0, inventory: {}, world: {}, seen: [], revoked: []
});
const OBSERVATION_EVENT_TYPES = new Set(["SYSTEM_EVENT", "EXECUTION_ADJUDICATION"]);

function setOwn(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  });
}

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
  return OBSERVATION_EVENT_TYPES.has(e?.event_type) &&
    e?.admission === "ACCEPTED" &&
    e.authority === "AUTHORIZED" &&
    e.execution === "EXECUTED" &&
    ["OBSERVED", "REFUTED"].includes(e.evidence) &&
    e.observation_verification === "VERIFIED" &&
    Array.isArray(e.receipts) &&
    e.receipts.length > 0 &&
    e.receipts.every(receipt => verifyReceipt(receipt, resolveArtifact)) &&
    trustedByHost(e, verifyObservation);
}

export function isVerifiedAuthorization(event, verifyAuthorization) {
  const isExecutionAuthorization = OBSERVATION_EVENT_TYPES.has(event?.event_type) &&
    event.authority === "AUTHORIZED" &&
    typeof event.grant_id === "string" && event.grant_id.length > 0;
  const isQuestAuthorization = event?.type === "QUEST_AUTHORIZED" &&
    typeof event.quest_id === "string" && event.quest_id.length > 0 &&
    typeof event.grant_id === "string" && event.grant_id.length > 0 &&
    event.actor === "founder";
  return (isExecutionAuthorization || isQuestAuthorization) &&
    trustedByHost(event, verifyAuthorization);
}

export function isVerifiedAdjudication(event, verifyAdjudication) {
  const isRevocation = event?.event_type === "REVOCATION" &&
    typeof event.revokes === "string" && event.revokes.length > 0;
  const isRejection = event?.event_type === "EXECUTION_ADJUDICATION" &&
    event.admission === "REJECTED";
  return (isRevocation || isRejection) && trustedByHost(event, verifyAdjudication);
}

const terminalSuccess = (e, resolveArtifact, verifyObservation, verifyAuthorization) =>
  e?.outcome === "SUCCEEDED" &&
  e.evidence === "OBSERVED" &&
  hasVerifiedObservation(e, resolveArtifact, verifyObservation) &&
  isVerifiedAuthorization(e, verifyAuthorization);

export function projectWorld(events, seed = EMPTY(), { resolveArtifact, verifyObservation, verifyAdjudication, verifyAuthorization } = {}) {
  const state = structuredClone(seed);
  const seen = new Set(state.seen || []);
  const revoked = new Set(state.revoked || []);

  for (const event of events) {
    if (!event?.event_id || seen.has(event.event_id)) continue;

    const parents = Array.isArray(event.parents) ? event.parents : [];
    if (parents.some(parent => !seen.has(parent))) throw new Error("unresolved parent for " + event.event_id);

    seen.add(event.event_id);
    state.history.push(event);

    if (event.event_type === "REVOCATION") {
      if (isVerifiedAdjudication(event, verifyAdjudication) && typeof event.revokes === "string" && event.revokes) {
        revoked.add(event.revokes);
      }
      continue;
    }

    const subject = event.subject || event.event_id;

    if (event.event_type === "CLAIM" || event.event_type === "PROPOSAL") {
      setOwn(state.quests, subject, { status: "PROPOSED", source_event: event.event_id });
      continue;
    }

    if (event.admission === "REJECTED" && isVerifiedAdjudication(event, verifyAdjudication)) {
      const previous = Object.hasOwn(state.quests, subject) ? state.quests[subject] : {};
      setOwn(state.quests, subject, { ...previous, status: "REJECTED", source_event: event.event_id });
      continue;
    }

    if (event.outcome === "FAILED" || event.evidence === "REFUTED") {
      if (hasVerifiedObservation(event, resolveArtifact, verifyObservation) &&
          isVerifiedAuthorization(event, verifyAuthorization)) {
        const previous = Object.hasOwn(state.quests, subject) ? state.quests[subject] : {};
        setOwn(state.quests, subject, {
          ...previous,
          status: event.outcome === "FAILED" ? "FAILED" : "REJECTED",
          source_event: event.event_id
        });
      }
      continue;
    }

    // An unverified rejection remains in history but cannot change projected state.
    if (event.admission === "REJECTED") continue;

    if (revoked.has(event.grant_id) ||
        !terminalSuccess(event, resolveArtifact, verifyObservation, verifyAuthorization)) continue;

    const previous = Object.hasOwn(state.quests, subject) ? state.quests[subject] : {};
    setOwn(state.quests, subject, { ...previous, status: "COMPLETED", source_event: event.event_id });

    const effect = event.world_effect || {};
    if (Number.isFinite(effect.xp) && effect.xp > 0) state.xp += effect.xp;

    const inventory = effect.inventory;
    if (inventory && typeof inventory === "object" && !Array.isArray(inventory)) {
      for (const [item, amount] of Object.entries(inventory)) {
        if (!Number.isFinite(amount)) continue;
        const previousAmount = Object.hasOwn(state.inventory, item) && Number.isFinite(state.inventory[item])
          ? state.inventory[item]
          : 0;
        setOwn(state.inventory, item, previousAmount + amount);
      }
    }

    const worldEffect = effect.world;
    if (worldEffect && typeof worldEffect === "object" && !Array.isArray(worldEffect)) {
      for (const [key, value] of Object.entries(worldEffect)) setOwn(state.world, key, value);
    }
  }

  state.seen = [...seen];
  state.revoked = [...revoked];
  return state;
}
