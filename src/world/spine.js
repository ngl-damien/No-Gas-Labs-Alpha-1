import { createHash } from "node:crypto";
import { projectWorld, eventParents } from "./project.js";
import { projectQuest } from "../quest/engine.js";

function canonical(value, ancestors = new Set()) {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "string" || type === "boolean") return JSON.stringify(value);
  if (type === "number") {
    if (!Number.isFinite(value)) throw new TypeError("state hash requires finite JSON-compatible values");
    return JSON.stringify(value);
  }
  if (type !== "object") throw new TypeError("state hash requires JSON-compatible values");
  if (ancestors.has(value)) throw new TypeError("state hash cannot include cyclic values");
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError("state hash cannot include symbol keys");

  const keys = Object.keys(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype ||
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index)) ||
        Reflect.ownKeys(value).length !== value.length + 1) {
      throw new TypeError("state hash cannot include sparse or decorated arrays");
    }
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) {
        throw new TypeError("state hash cannot include accessor properties");
      }
    }
    ancestors.add(value);
    try {
      return "[" + value.map(item => canonical(item, ancestors)).join(",") + "]";
    } finally {
      ancestors.delete(value);
    }
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("state hash requires plain JSON objects");
  }
  if (Reflect.ownKeys(value).length !== keys.length) {
    throw new TypeError("state hash cannot include non-enumerable properties");
  }

  ancestors.add(value);
  try {
    const fields = keys.sort().map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) {
        throw new TypeError("state hash cannot include accessor properties");
      }
      return JSON.stringify(key) + ":" + canonical(descriptor.value, ancestors);
    });
    return "{" + fields.join(",") + "}";
  } finally {
    ancestors.delete(value);
  }
}

export function hashState(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function validateHistory(events) {
  if (!Array.isArray(events)) throw new Error("event history must be an array");
  const ids = new Set();
  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error("duplicate or missing event_id");
    }
    const idProperty = Object.getOwnPropertyDescriptor(event, "event_id");
    if (!idProperty || !("value" in idProperty) || idProperty.enumerable !== true ||
        typeof idProperty.value !== "string" || idProperty.value.trim().length === 0 ||
        ids.has(idProperty.value)) {
      throw new Error("duplicate or missing event_id");
    }
    const eventId = idProperty.value;
    const parents = eventParents(event);
    if (parents.some(parent => !ids.has(parent))) {
      throw new Error("unresolved parent for " + eventId);
    }
    ids.add(eventId);
  }
  return true;
}

export function replayInstitution({events,quests=[],resolveArtifact,verifyObservation,verifyAdjudication,verifyAuthorization}) {
  validateHistory(events);
  const world=projectWorld(events,undefined,{resolveArtifact,verifyObservation,verifyAdjudication,verifyAuthorization});
  const questState=Object.fromEntries(quests.map(q=>[q.quest_id,projectQuest(q,events,{resolveArtifact,verifyObservation,verifyAdjudication,verifyAuthorization})]));
  const projection={world,quests:questState};
  return Object.freeze({projection,state_hash:hashState(projection),event_count:events.length});
}

export function verifyReplay({events,quests=[],resolveArtifact,verifyObservation,verifyAdjudication,verifyAuthorization,expected_hash}) {
  const replay=replayInstitution({events,quests,resolveArtifact,verifyObservation,verifyAdjudication,verifyAuthorization});
  return Object.freeze({...replay,matches:replay.state_hash===expected_hash});
}
