import { createHash } from "node:crypto";
import { projectWorld } from "./project.js";
import { projectQuest } from "../quest/engine.js";

function canonical(value) {
  if (Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
  if (value && typeof value==="object") return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";
  return JSON.stringify(value);
}

export function hashState(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function validateHistory(events) {
  const ids=new Set();
  for (const e of events) {
    if (!e?.event_id || ids.has(e.event_id)) throw new Error("duplicate or missing event_id");
    const parents=Array.isArray(e.parents)?e.parents:[];
    if (parents.some(p=>!ids.has(p))) throw new Error(`unresolved parent for ${e.event_id}`);
    ids.add(e.event_id);
  }
  return true;
}

export function replayInstitution({events,quests=[],resolveArtifact}) {
  validateHistory(events);
  const world=projectWorld(events,undefined,{resolveArtifact});
  const questState=Object.fromEntries(quests.map(q=>[q.quest_id,projectQuest(q,events)]));
  const projection={world,quests:questState};
  return Object.freeze({projection,state_hash:hashState(projection),event_count:events.length});
}

export function verifyReplay({events,quests=[],resolveArtifact,expected_hash}) {
  const replay=replayInstitution({events,quests,resolveArtifact});
  return Object.freeze({...replay,matches:replay.state_hash===expected_hash});
}
