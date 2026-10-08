// Location evidence is a user-approved observation, never Founder authority or verified physical presence.
export function createLocationObservation(fix, {quest_id, consent=false, event_id}={}) {
  if (consent !== true) throw new Error("explicit consent required");
  if (fix?.schema !== "ngl.location.fix.v1" || fix.verified !== false || fix.authority !== "USER_CONSENT_REQUIRED") throw new Error("untrusted location fix");
  if (typeof quest_id !== "string" || !quest_id.trim()) throw new Error("quest required");
  if (typeof event_id !== "string" || !event_id.trim()) throw new Error("event identity required");
  return Object.freeze({
    event_id, event_type:"LOCATION_OBSERVATION", quest_id, subject:quest_id,
    admission:"PROPOSED", authority:"UNVERIFIED", evidence:"SELF_REPORTED",
    observation:{...fix}, location_consent:true,
    note:"Device-reported location; not independently verified, not authorization, no automatic quest reward"
  });
}
export function projectLocationEvidence(events,quest_id) {
  return Object.freeze(events.filter(e=>e?.event_type==="LOCATION_OBSERVATION"&&e.quest_id===quest_id&&e.location_consent===true&&e.observation?.schema==="ngl.location.fix.v1").map(e=>Object.freeze({event_id:e.event_id,observation:e.observation,verified:false})));
}
