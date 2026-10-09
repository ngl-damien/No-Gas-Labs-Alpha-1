// Pure JavaScript schema validation, safe in browser and Node.
const forbidden = ['world_effect', 'receipts', 'outcome', 'execution', 'grant_id', 'acceptance_satisfied', 'signed_decision', 'decision_payload'];
export function isLocationObservation(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  const fix = event.observation;
  if (!fix || typeof fix !== 'object' || Array.isArray(fix)) return false;
  if (forbidden.some(k => Object.hasOwn(event, k))) return false;
  if (event.event_type !== 'LOCATION_OBSERVATION' || typeof event.event_id !== 'string' || !event.event_id ||
      typeof event.quest_id !== 'string' || !event.quest_id || event.subject !== event.quest_id ||
      event.location_consent !== true || event.admission !== 'PROPOSED' ||
      event.authority !== 'UNVERIFIED' || event.evidence !== 'SELF_REPORTED') return false;
  if (fix.schema !== 'ngl.location.fix.v1' || fix.verified !== false || fix.authority !== 'USER_CONSENT_REQUIRED' ||
      !['coarse','precise'].includes(fix.precision) || !['device-geolocation','synthetic-demo'].includes(fix.source)) return false;
  if (!Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude) || fix.latitude < -90 || fix.latitude > 90 ||
      fix.longitude < -180 || fix.longitude > 180) return false;
  if (fix.accuracy_m !== null && (!Number.isFinite(fix.accuracy_m) || fix.accuracy_m < 0)) return false;
  if (typeof fix.observed_at !== 'string' || !Number.isFinite(Date.parse(fix.observed_at))) return false;
  return true;
}
