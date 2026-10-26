import { createHash } from "node:crypto";
import { projectWorld, eventParents } from "./project.js";
import { projectQuest } from "../quest/engine.js";

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
  if (!Array.isArray(events)) throw new Error("event history must be an array");
  const ids = new Set();
  for (const event of events) {
    if (!event || typeof event.event_id !== "string" || !event.event_id.trim() ||
        ids.has(event.event_id)) throw new Error("duplicate or missing event_id");
    const parents = eventParents(event);
    if (parents.some(parent => !ids.has(parent))) {
      throw new Error("unresolved parent for " + event.event_id);
    }
    ids.add(event.event_id);
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
