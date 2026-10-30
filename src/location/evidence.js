// Location evidence is a user-approved observation, never Founder authority or verified physical presence.
const FIX_FIELDS = [
  "schema", "latitude", "longitude", "accuracy_m", "precision",
  "observed_at", "source", "authority", "verified"
];
const EVENT_FIELDS = [
  "event_id", "event_type", "quest_id", "subject", "admission",
  "authority", "evidence", "observation", "location_consent"
];

function snapshotPlainData(value, fields, { exact = true } = {}) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== "string")) return null;
    if (exact && (keys.length !== fields.length || fields.some(key => !Object.hasOwn(descriptors, key)))) {
      return null;
    }
    if (keys.some(key => !fields.includes(key))) return null;

    const snapshot = Object.create(null);
    for (const key of fields) {
      if (!Object.hasOwn(descriptors, key)) continue;
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) {
        return null;
      }
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function snapshotFix(value) {
  const fix = snapshotPlainData(value, FIX_FIELDS);
  if (!fix || fix.schema !== "ngl.location.fix.v1" ||
      fix.authority !== "USER_CONSENT_REQUIRED" || fix.verified !== false ||
      fix.source !== "device-geolocation" ||
      (fix.precision !== "coarse" && fix.precision !== "precise") ||
      !Number.isFinite(fix.latitude) || fix.latitude < -90 || fix.latitude > 90 ||
      !Number.isFinite(fix.longitude) || fix.longitude < -180 || fix.longitude > 180 ||
      !(fix.accuracy_m === null || (Number.isSafeInteger(fix.accuracy_m) && fix.accuracy_m >= 0)) ||
      typeof fix.observed_at !== "string") {
    return null;
  }

  const observedAt = Date.parse(fix.observed_at);
  if (!Number.isFinite(observedAt) || new Date(observedAt).toISOString() !== fix.observed_at) {
    return null;
  }

  const digits = fix.precision === "precise" ? 5 : 2;
  if (fix.latitude !== Number(fix.latitude.toFixed(digits)) ||
      fix.longitude !== Number(fix.longitude.toFixed(digits))) {
    return null;
  }

  return Object.freeze({
    schema: fix.schema,
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracy_m: fix.accuracy_m,
    precision: fix.precision,
    observed_at: fix.observed_at,
    source: fix.source,
    authority: fix.authority,
    verified: false
  });
}

export function createLocationObservation(fix, options = {}) {
  const args = snapshotPlainData(options, ["quest_id", "consent", "event_id"], { exact: false });
  if (!args) throw new Error("invalid observation options");
  if (args.consent !== true) throw new Error("explicit consent required");

  const observation = snapshotFix(fix);
  if (!observation) throw new Error("untrusted location fix");
  if (typeof args.quest_id !== "string" || !args.quest_id.trim() || args.quest_id.length > 256) {
    throw new Error("quest required");
  }
  if (typeof args.event_id !== "string" || !args.event_id.trim() || args.event_id.length > 256) {
    throw new Error("event identity required");
  }

  return Object.freeze({
    event_id: args.event_id,
    event_type: "LOCATION_OBSERVATION",
    quest_id: args.quest_id,
    subject: args.quest_id,
    admission: "PROPOSED",
    authority: "UNVERIFIED",
    evidence: "SELF_REPORTED",
    observation,
    location_consent: true,
    note: "Device-reported location; not independently verified, not authorization, no automatic quest reward"
  });
}

export function projectLocationEvidence(events, quest_id) {
  if (!Array.isArray(events) || typeof quest_id !== "string" || !quest_id.trim()) {
    return Object.freeze([]);
  }

  const projected = [];
  for (const event of events) {
    const record = snapshotPlainData(event, EVENT_FIELDS, { exact: false });
    if (!record || record.event_type !== "LOCATION_OBSERVATION" ||
        record.quest_id !== quest_id || record.subject !== quest_id ||
        record.admission !== "PROPOSED" || record.authority !== "UNVERIFIED" ||
        record.evidence !== "SELF_REPORTED" || record.location_consent !== true ||
        typeof record.event_id !== "string" || !record.event_id.trim() || record.event_id.length > 256) {
      continue;
    }

    const observation = snapshotFix(record.observation);
    if (!observation) continue;
    projected.push(Object.freeze({
      event_id: record.event_id,
      observation,
      verified: false
    }));
  }

  return Object.freeze(projected);
}
