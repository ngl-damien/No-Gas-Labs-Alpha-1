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

// Parent metadata is part of the event contract, not optional data to coerce.
// A malformed list or duplicate edge must fail closed instead of turning an
// event into a root event or obscuring its causal path.
export function eventParents(event) {
  const label = typeof event?.event_id === "string" && event.event_id
    ? event.event_id
    : "<unknown>";
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("invalid event for parent validation");
  }
  const property = Object.getOwnPropertyDescriptor(event, "parents");
  if (!property) return [];
  // The parent edge must participate in canonical signing/serialization. Never
  // invoke an accessor or accept hidden ancestry metadata.
  if (!("value" in property) || property.enumerable !== true) {
    throw new Error("parent metadata must be an enumerable data property for " + label);
  }
  const parents = property.value;
  if (!Array.isArray(parents) || Object.getPrototypeOf(parents) !== Array.prototype ||
      Reflect.ownKeys(parents).length !== parents.length + 1) {
    throw new Error("invalid parents for " + label);
  }
  const unique = new Set();
  for (let index = 0; index < parents.length; index++) {
    const item = Object.getOwnPropertyDescriptor(parents, String(index));
    if (!item || !("value" in item) || item.enumerable !== true) {
      throw new Error("invalid parent reference for " + label);
    }
    const parent = item.value;
    if (typeof parent !== "string" || parent.trim().length === 0) {
      throw new Error("invalid parent reference for " + label);
    }
    if (unique.has(parent)) throw new Error("duplicate parent for " + label);
    unique.add(parent);
  }
  return parents;
}

// Produce a type-tagged, key-order-independent comparison value. Event IDs
// identify one immutable payload; they are not permission to silently discard
// a different payload that reuses the same ID.
function stableEventValue(value, ancestors = new Set()) {
  if (value === null) return ["null"];
  const type = typeof value;
  if (type === "undefined") return ["undefined"];
  if (type === "string" || type === "boolean") return [type, value];
  if (type === "number") {
    const normalized = Number.isNaN(value) ? "NaN"
      : value === Infinity ? "Infinity"
      : value === -Infinity ? "-Infinity"
      : Object.is(value, -0) ? "-0" : String(value);
    return ["number", normalized];
  }
  if (type === "bigint") return ["bigint", String(value)];
  if (type === "symbol") return ["symbol", String(value.description ?? "")];
  if (type === "function") return ["function", String(value)];
  if (ancestors.has(value)) throw new Error("cyclic event payload");
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = ["array", Array.from({ length: value.length }, (_, index) =>
      index in value ? stableEventValue(value[index], ancestors) : ["hole"]
    )];
  } else {
    result = ["object", Object.keys(value).sort().map(key =>
      [key, stableEventValue(value[key], ancestors)]
    )];
  }
  ancestors.delete(value);
  return result;
}

function sameEventPayload(left, right) {
  return JSON.stringify(stableEventValue(left)) === JSON.stringify(stableEventValue(right));
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
  const historyById = new Map();
  for (const retained of state.history || []) {
    if (!retained?.event_id) continue;
    if (historyById.has(retained.event_id)) {
      throw new Error("duplicate event_id in retained history: " + retained.event_id);
    }
    const parents = eventParents(retained);
    if (parents.some(parent => !historyById.has(parent))) {
      throw new Error("unresolved parent for " + retained.event_id);
    }
    historyById.set(retained.event_id, retained);
  }
  const seen = new Set(state.seen || []);
  for (const id of historyById.keys()) seen.add(id);
  const revoked = new Set(state.revoked || []);

  for (const event of events) {
    if (!event?.event_id) continue;

    if (seen.has(event.event_id)) {
      const prior = historyById.get(event.event_id);
      if (!prior) throw new Error("duplicate event_id has no retained payload: " + event.event_id);
      if (!sameEventPayload(prior, event)) {
        throw new Error("conflicting duplicate event_id: " + event.event_id);
      }
      continue;
    }

    const parents = eventParents(event);
    if (parents.some(parent => !historyById.has(parent))) {
      throw new Error("unresolved parent for " + event.event_id);
    }

    seen.add(event.event_id);
    // Keep a snapshot: later mutation of the caller's event object must not
    // silently rewrite the projection's retained evidence history.
    const retained = structuredClone(event);
    state.history.push(retained);
    historyById.set(event.event_id, retained);

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
