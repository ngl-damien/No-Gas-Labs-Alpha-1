import { createHash } from "node:crypto";
import { projectWorld } from "./project.js";
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
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
      throw new TypeError("state hash cannot include sparse or decorated arrays");
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
  const ids=new Set();
  for (const e of events) {
    if (!e?.event_id || ids.has(e.event_id)) throw new Error("duplicate or missing event_id");
    const parents=Array.isArray(e.parents)?e.parents:[];
    if (parents.some(p=>!ids.has(p))) throw new Error("unresolved parent for " + e.event_id);
    ids.add(e.event_id);
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
