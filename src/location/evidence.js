import { isLocationObservation } from './schema.js';

// A user-approved observation is NOT proof of presence or Founder authorization.
export function createLocationObservation(fix, {quest_id, consent=false, event_id}={}) {
  if (consent !== true) throw new Error('explicit consent required');
  if (typeof quest_id !== 'string' || !quest_id.trim()) throw new Error('quest required');
  if (typeof event_id !== 'string' || !event_id.trim()) throw new Error('event identity required');
  const event = {
    event_id, event_type:'LOCATION_OBSERVATION', quest_id, subject:quest_id,
    admission:'PROPOSED', authority:'UNVERIFIED', evidence:'SELF_REPORTED',
    observation:{...fix}, location_consent:true,
    note:fix?.source === 'synthetic-demo'
      ? 'Synthetic example; no physical presence claimed'
      : 'Device-reported location; not independently verified, not authorization, no automatic quest reward'
  };
  if (!isLocationObservation(event)) throw new Error('invalid or privilege-bearing location observation');
  return Object.freeze(event);
}

export function projectLocationEvidence(events,quest_id) {
  return Object.freeze(events.filter(e=>e?.quest_id===quest_id && isLocationObservation(e))
    .map(e=>Object.freeze({event_id:e.event_id,observation:e.observation,verified:false,claim_status:'UNVERIFIED'})));
}
