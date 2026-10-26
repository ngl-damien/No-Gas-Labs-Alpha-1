import { createHash } from "node:crypto";
import { projectWorld, eventParents } from "./project.js";
import { projectQuest } from "../quest/engine.js";

function eventValues(events) {
  if (!Array.isArray(events) || Object.getPrototypeOf(events) !== Array.prototype ||
      Object.keys(events).length !== events.length ||
      Reflect.ownKeys(events).length !== events.length + 1) {
    throw new Error("event history must be a dense plain array");
  }
  const values = [];
  for (let index = 0; index < events.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(events, String(index));
    if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
      throw new Error("event history contains an accessor or hidden entry");
    }
    values.push(descriptor.value);
  }
  return values;
}

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ":" + canonical(value[key])
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function hashState(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function validateHistory(events) {
  const ids = new Set();
  for (const event of eventValues(events)) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error("duplicate or missing event_id");
    }
    const parents = eventParents(event);
    const idProperty = Object.getOwnPropertyDescriptor(event, "event_id");
    const id = idProperty?.value;
    if (!idProperty || typeof id !== "string" || !id.trim() || ids.has(id)) {
      throw new Error("duplicate or missing event_id");
    }
    if (parents.some(parent => !ids.has(parent))) {
      throw new Error("unresolved parent for " + id);
    }
    ids.add(id);
  }
  return true;
}

export function replayInstitution({
  events, quests = [], resolveArtifact, verifyObservation,
  verifyAuthorization, verifyAdjudication
}) {
  validateHistory(events);
  const trust = { resolveArtifact, verifyObservation, verifyAuthorization, verifyAdjudication };
  const world = projectWorld(events, undefined, trust);
  const questState = Object.fromEntries(quests.map(quest => [
    quest.quest_id, projectQuest(quest, events, trust)
  ]));
  const projection = { world, quests: questState };
  return Object.freeze({
    projection, state_hash: hashState(projection), event_count: events.length
  });
}

export function verifyReplay({
  events, quests = [], resolveArtifact, verifyObservation,
  verifyAuthorization, verifyAdjudication, expected_hash
}) {
  const replay = replayInstitution({
    events, quests, resolveArtifact, verifyObservation,
    verifyAuthorization, verifyAdjudication
  });
  return Object.freeze({ ...replay, matches: replay.state_hash === expected_hash });
}
