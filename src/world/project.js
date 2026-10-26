import { verifyReceipt } from "../evidence/content-addressed.js";

const EMPTY = () => ({
  history: [], quests: {}, xp: 0, inventory: {}, world: {}, seen: [], revoked: []
});
const OBSERVATION_EVENT_TYPES = new Set(["SYSTEM_EVENT", "EXECUTION_ADJUDICATION"]);

function setOwn(target, key, value) {
  Object.defineProperty(target, key, {
    value, enumerable: true, configurable: true, writable: true
  });
}

function denseArrayValues(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Object.keys(value).length !== value.length ||
      Reflect.ownKeys(value).length !== value.length + 1) {
    throw new Error("invalid " + label);
  }
  const values = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
      throw new Error("invalid " + label + " item");
    }
    values.push(descriptor.value);
  }
  return values;
}

// Validate the complete object graph before cloning or comparing it. Hidden
// fields, accessors, symbols, sparse arrays and exotic prototypes are not JSON.
function stableEventValue(value, ancestors = new Set()) {
  if (value === null) return ["null"];
  const type = typeof value;
  if (type === "string" || type === "boolean") return [type, value];
  if (type === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number in event payload");
    return ["number", Object.is(value, -0) ? "-0" : String(value)];
  }
  if (type !== "object") throw new Error("non-JSON value in event payload");
  if (ancestors.has(value)) throw new Error("cyclic event payload");
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    const items = denseArrayValues(value, "array");
    result = ["array", items.map(item => stableEventValue(item, ancestors))];
  } else {
    const prototype = Object.getPrototypeOf(value);
    const keys = Object.keys(value);
    if ((prototype !== Object.prototype && prototype !== null) ||
        Reflect.ownKeys(value).length !== keys.length) {
      throw new Error("non-JSON object in event payload");
    }
    result = ["object", keys.sort().map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
        throw new Error("accessor or hidden field in event payload");
      }
      return [key, stableEventValue(descriptor.value, ancestors)];
    })];
  }
  ancestors.delete(value);
  return result;
}

function sameEventPayload(left, right) {
  return JSON.stringify(stableEventValue(left)) === JSON.stringify(stableEventValue(right));
}

// Parent metadata is causal evidence. It must be explicit, enumerable data;
// malformed ancestry is never coerced into a root event.
export function eventParents(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("invalid event for parent validation");
  }
  const idProperty = Object.getOwnPropertyDescriptor(event, "event_id");
  if (idProperty && (!("value" in idProperty) || idProperty.enumerable !== true)) {
    throw new Error("event ID metadata must be an enumerable data property");
  }
  const label = typeof idProperty?.value === "string" && idProperty.value
    ? idProperty.value : "<unknown>";
  const property = Object.getOwnPropertyDescriptor(event, "parents");
  if (!property) return [];
  if (!("value" in property) || property.enumerable !== true) {
    throw new Error("parent metadata must be an enumerable data property for " + label);
  }
  const parents = denseArrayValues(property.value, "parents for " + label);
  const unique = new Set();
  for (const parent of parents) {
    if (typeof parent !== "string" || parent.trim().length === 0) {
      throw new Error("invalid parent reference for " + label);
    }
    if (unique.has(parent)) throw new Error("duplicate parent for " + label);
    unique.add(parent);
  }
  return parents;
}

// These callbacks are supplied by the trusted host, never by the event or UI.
// Missing, throwing, non-boolean, or false verification fails closed.
function trustedByHost(event, verifier) {
  if (typeof verifier !== "function") return false;
  try {
    return verifier(structuredClone(event)) === true;
  } catch {
    return false;
  }
}

function receiptsMatch(event, resolveArtifact) {
  if (typeof resolveArtifact !== "function" || !Array.isArray(event?.receipts) ||
      event.receipts.length === 0) return false;
  try {
    return event.receipts.every(receipt => verifyReceipt(receipt, resolveArtifact));
  } catch {
    return false;
  }
}

export function hasVerifiedObservation(event, resolveArtifact, verifyObservation) {
  return OBSERVATION_EVENT_TYPES.has(event?.event_type) &&
    event.admission === "ACCEPTED" &&
    event.authority === "AUTHORIZED" &&
    event.execution === "EXECUTED" &&
    ["OBSERVED", "REFUTED"].includes(event.evidence) &&
    event.observation_verification === "VERIFIED" &&
    receiptsMatch(event, resolveArtifact) &&
    trustedByHost(event, verifyObservation);
}

export function isVerifiedAuthorization(event, verifyAuthorization) {
  const validExecutionGrant = OBSERVATION_EVENT_TYPES.has(event?.event_type) &&
    event.authority === "AUTHORIZED" &&
    typeof event.grant_id === "string" && event.grant_id.length > 0;
  const validQuestGrant = event?.type === "QUEST_AUTHORIZED" &&
    typeof event.quest_id === "string" && event.quest_id.length > 0 &&
    typeof event.grant_id === "string" && event.grant_id.length > 0 &&
    event.actor === "founder";
  return (validExecutionGrant || validQuestGrant) &&
    trustedByHost(event, verifyAuthorization);
}

export function isVerifiedAdjudication(event, verifyAdjudication) {
  const revocation = event?.event_type === "REVOCATION" &&
    typeof event.revokes === "string" && event.revokes.length > 0;
  const rejection = event?.event_type === "EXECUTION_ADJUDICATION" &&
    event.admission === "REJECTED";
  return (revocation || rejection) && trustedByHost(event, verifyAdjudication);
}

const terminalSuccess = (event, resolveArtifact, verifyObservation, verifyAuthorization) =>
  event?.outcome === "SUCCEEDED" &&
  event.evidence === "OBSERVED" &&
  hasVerifiedObservation(event, resolveArtifact, verifyObservation) &&
  isVerifiedAuthorization(event, verifyAuthorization);

function reduceWorld(events, { resolveArtifact, verifyObservation, verifyAdjudication, verifyAuthorization } = {}) {
  const eventList = denseArrayValues(events, "event list");
  const state = EMPTY();
  const historyById = new Map();
  const seen = new Set();
  const revoked = new Set();

  for (const event of eventList) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error("invalid event payload");
    }
    const parents = eventParents(event);
    stableEventValue(event);
    if (typeof event.event_id !== "string" || event.event_id.trim().length === 0) {
      throw new Error("invalid event ID");
    }
    const id = event.event_id;

    if (seen.has(id)) {
      const prior = historyById.get(id);
      if (!prior) throw new Error("duplicate event ID has no retained payload: " + id);
      if (!sameEventPayload(prior, event)) throw new Error("conflicting duplicate event ID: " + id);
      continue;
    }
    if (parents.some(parent => !historyById.has(parent))) {
      throw new Error("unresolved parent for " + id);
    }

    const retained = structuredClone(event);
    seen.add(id);
    historyById.set(id, retained);
    state.history.push(retained);

    if (event.event_type === "REVOCATION") {
      if (isVerifiedAdjudication(event, verifyAdjudication)) revoked.add(event.revokes);
      continue;
    }

    const subject = event.subject === undefined || event.subject === null
      ? event.event_id : event.subject;
    if (typeof subject !== "string" || subject.trim().length === 0) {
      throw new Error("invalid event subject for " + id);
    }

    if (event.event_type === "CLAIM" || event.event_type === "PROPOSAL") {
      setOwn(state.quests, subject, { status: "PROPOSED", source_event: id });
      continue;
    }

    if (event.admission === "REJECTED") {
      if (isVerifiedAdjudication(event, verifyAdjudication)) {
        const previous = Object.hasOwn(state.quests, subject) ? state.quests[subject] : {};
        setOwn(state.quests, subject, { ...previous, status: "REJECTED", source_event: id });
      }
      continue;
    }

    if (event.outcome === "FAILED" || event.evidence === "REFUTED") {
      if (hasVerifiedObservation(event, resolveArtifact, verifyObservation) &&
          isVerifiedAuthorization(event, verifyAuthorization)) {
        const previous = Object.hasOwn(state.quests, subject) ? state.quests[subject] : {};
        setOwn(state.quests, subject, {
          ...previous,
          status: event.outcome === "FAILED" ? "FAILED" : "REJECTED",
          source_event: id
        });
      }
      continue;
    }

    if (revoked.has(event.grant_id) ||
        !terminalSuccess(event, resolveArtifact, verifyObservation, verifyAuthorization)) continue;

    const previous = Object.hasOwn(state.quests, subject) ? state.quests[subject] : {};
    setOwn(state.quests, subject, { ...previous, status: "COMPLETED", source_event: id });

    const effect = event.world_effect;
    if (!effect || typeof effect !== "object" || Array.isArray(effect)) continue;
    if (Number.isFinite(effect.xp) && effect.xp > 0) state.xp += effect.xp;

    const inventory = effect.inventory;
    if (inventory && typeof inventory === "object" && !Array.isArray(inventory)) {
      for (const [item, amount] of Object.entries(inventory)) {
        if (!Number.isFinite(amount)) continue;
        const priorAmount = Object.hasOwn(state.inventory, item) && Number.isFinite(state.inventory[item])
          ? state.inventory[item] : 0;
        setOwn(state.inventory, item, priorAmount + amount);
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

// A seed is accepted only when it exactly matches a fresh replay of its own
// retained history under the same host trust callbacks. Caller-supplied XP,
// inventory, world flags, or revoked grants cannot bootstrap canonical state.
export function projectWorld(events, seed = EMPTY(), options = {}) {
  if (!seed || typeof seed !== "object" || Array.isArray(seed)) {
    throw new Error("invalid projection seed");
  }
  stableEventValue(seed);
  if (!Array.isArray(seed.history)) throw new Error("invalid retained event history");
  const eventList = denseArrayValues(events, "event list");

  const replayedSeed = reduceWorld(seed.history, options);
  if (!sameEventPayload(replayedSeed, seed)) {
    throw new Error("seed projection differs from verified retained history");
  }
  return reduceWorld([...seed.history, ...eventList], options);
}
