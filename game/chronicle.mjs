const PLACE_NAMES = Object.freeze({
  workbench: "The Making Bench",
  relay: "The Relay",
  river: "River of Receipts",
  overlook: "The Long View",
  ruins: "The Unfinished",
  "town-square": "TownSquare"
});

const text = value => typeof value === "string" && value.trim() ? value : "";
const actorName = actor => typeof actor === "string"
  ? actor
  : text(actor?.name) || text(actor?.id) || "unknown actor";
const actorId = actor => typeof actor === "string" ? actor : text(actor?.id);
const timestamp = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
const eventTime = value => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
};

function denseDataArray(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor?.value;
    if (!Number.isSafeInteger(length) || length < 0) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1) return false;
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) return false;
    }
    return keys.every(key => key === "length" ||
      (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key) && Number(key) < length));
  } catch {
    return false;
  }
}

function snapshotPlainData(value, active = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite event value");
    return value;
  }
  if (typeof value !== "object" || active.has(value)) throw new TypeError("Unsupported event value");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (!denseDataArray(value)) throw new TypeError("Malformed event array");
      const length = Object.getOwnPropertyDescriptor(value, "length").value;
      const copy = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        copy.push(snapshotPlainData(descriptor.value, active));
      }
      return copy;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Non-plain event object");
    const copy = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError("Symbol event key");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError("Hidden or accessor event property");
      }
      Object.defineProperty(copy, key, {
        value: snapshotPlainData(descriptor.value, active),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return copy;
  } finally {
    active.delete(value);
  }
}

function safeEventSnapshot(event) {
  try {
    const snapshot = snapshotPlainData(event);
    return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
}

function retainedEventCollection(owner, key) {
  const descriptor = owner && typeof owner === "object"
    ? Object.getOwnPropertyDescriptor(owner, key)
    : undefined;
  if (!descriptor) return { present: false, valid: true, value: [] };
  if (!Object.hasOwn(descriptor, "value") || !denseDataArray(descriptor.value)) {
    return { present: true, valid: false, value: [] };
  }
  const length = Object.getOwnPropertyDescriptor(descriptor.value, "length").value;
  const snapshot = [];
  for (let index = 0; index < length; index += 1) {
    snapshot.push(Object.getOwnPropertyDescriptor(descriptor.value, String(index)).value);
  }
  return { present: true, valid: true, value: snapshot };
}

function malformedCollectionEntry(source) {
  const institutional = source === "kernel";
  return {
    id: `${source}:unclassified-events`,
    source,
    eventType: "unknown",
    at: "",
    actor: "unknown actor",
    title: institutional ? "Unclassified institutional event collection" : "Unclassified retained world event collection",
    category: institutional ? "INSTITUTIONAL WORK" : "WORLD ACTIVITY",
    summary: `The ${institutional ? "institutional" : "world"} event collection is malformed; no individual events are inferred from it.`,
    detail: "",
    creationId: "",
    version: null,
    targetTitle: "",
    targetAvailable: false,
    warning: "Malformed retained event collection; inspect the source store before adjudicating it.",
  };
}

function malformedEventEntry(source, index) {
  const institutional = source === "kernel";
  return {
    id: `${source}:unclassified-${index}`,
    source,
    eventType: "unknown",
    at: "",
    actor: "unknown actor",
    title: institutional ? "Unclassified institutional event" : "Unclassified retained world event",
    category: institutional ? "INSTITUTIONAL WORK" : "WORLD ACTIVITY",
    summary: "A malformed event payload is present; no claim or consequence is inferred.",
    detail: "",
    creationId: "",
    version: null,
    targetTitle: "",
    targetAvailable: false,
    warning: "Malformed retained event payload; accessor, hidden, sparse, or non-JSON data was rejected without reading it.",
  };
}

function findVersion(world, creationId, version) {
  if (typeof creationId !== "string" || !Number.isInteger(version) || version < 1) return null;
  const creation = (Array.isArray(world?.creations) ? world.creations : []).find(item => item?.id === creationId);
  if (!creation) return null;
  if (creation.version === version) return creation;
  return Array.isArray(creation.versions) ? creation.versions.find(item => item?.version === version) || null : null;
}

function matchingNote(records, event, consumed) {
  const creationId = text(event?.creationId);
  const version = event?.version;
  const at = timestamp(event?.at);
  const actor = text(actorId(event?.actor));
  if (!creationId || !Number.isInteger(version) || version < 1 || !at || !actor) {
    return { record: null, reason: "insufficient-metadata" };
  }

  const matches = records.filter(record =>
    !consumed.has(record) &&
    record?.creationId === creationId &&
    record?.version === version &&
    record?.at === event.at &&
    text(actorId(record?.actor)) === actor
  );
  if (matches.length !== 1) {
    return { record: null, reason: matches.length > 1 ? "ambiguous" : "missing" };
  }

  const record = matches[0];
  const index = records.indexOf(record);
  if (index >= 0) records.splice(index, 1);
  consumed.add(record);
  return { record, reason: null };
}

function worldEntry(event, index, world, notes) {
  const type = text(event?.type) || "unknown";
  const id = text(event?.id) || `unidentified-${index}`;
  const creationId = text(event?.creationId);
  const version = Number.isInteger(event?.version) ? event.version
    : Number.isInteger(event?.baseVersion) ? event.baseVersion : null;
  const target = findVersion(world, creationId, version);
  const location = PLACE_NAMES[event?.locationId];
  const entry = {
    id: `world:${id}`,
    source: "world",
    eventType: type,
    at: timestamp(event?.at),
    actor: actorName(event?.actor),
    title: "Unclassified retained world event",
    category: "WORLD ACTIVITY",
    summary: "The event is retained; no unrecorded consequence is inferred.",
    detail: "",
    creationId,
    version,
    targetTitle: target ? text(target.title) || creationId : "",
    targetAvailable: Boolean(target),
    warning: "",
  };

  if (type === "draft") {
    entry.title = "Private draft created";
    entry.category = "MAKING BENCH";
    entry.summary = "A private draft was recorded. It is not a published artifact and awards no publication status.";
  } else if (type === "repair") {
    entry.title = "Repair draft prepared";
    entry.category = "LONG VIEW";
    entry.summary = "A repair draft was recorded. No new published version is implied until a separate publish event exists.";
  } else if (type === "publish") {
    entry.title = `Publication recorded · ${target ? text(target.title) || creationId : creationId || "target unavailable"}`;
    entry.category = "PUBLICATION";
    entry.summary = "A versioned artifact publication was recorded. Its receipt identifies bytes, not the truth of claims inside.";
  } else if (type === "contribute" || type === "report") {
    const records = type === "report" ? notes.reports : notes.contributions;
    const match = matchingNote(records, event, notes.consumed);
    const record = match.record;
    entry.title = type === "report"
      ? `Report retained · ${target ? text(target.title) || creationId : creationId || "target unavailable"}`
      : `Contribution retained · ${target ? text(target.title) || creationId : creationId || "target unavailable"}`;
    entry.category = type === "report" ? "DISSENT & FAILURE" : "FIELD CONTRIBUTION";
    entry.summary = type === "report"
      ? "A report was retained against the referenced version. It remains a report, not an adjudication."
      : "A contribution was retained against the referenced version.";
    entry.detail = text(record?.text);
    if (!record) {
      if (match.reason === "ambiguous") {
        entry.warning = "Multiple text records match this event's metadata; no text was attached because attribution is ambiguous.";
      } else if (match.reason === "insufficient-metadata") {
        entry.warning = "The event lacks a complete actor, version, or timestamp; its text record cannot be safely attributed.";
      } else {
        entry.warning = "The event is retained, but its corresponding text record is absent from this snapshot.";
      }
    }
  } else if (type === "discover") {
    entry.title = `Visit recorded · ${location || text(event?.locationId) || "unmapped location"}`;
    entry.category = "EXPLORATION";
    entry.summary = "A visit was recorded. Discovery does not establish that a claim is true or grant authority.";
    if (!location) entry.warning = "This location ID is not in the current map; the original ID is retained without inventing a location.";
  }

  if (["publish", "contribute", "report", "repair"].includes(type) && (!target || !creationId || !version)) {
    entry.targetAvailable = false;
    const targetWarning = "The referenced artifact version is unavailable in this snapshot; the event remains visible without an invented target.";
    entry.warning = entry.warning ? entry.warning + " " + targetWarning : targetWarning;
  }
  if (!text(event?.id)) entry.warning ||= "The retained event has no usable source ID; this display key is local to the view.";
  if (!entry.at) entry.warning ||= "The retained event has no parseable timestamp; it is shown after timestamped records.";
  return entry;
}

function kernelEntry(event, index, world, derivedWork = null) {
  const type = text(event?.type) || "unknown";
  const id = text(event?.id) || `unidentified-${index}`;
  // The live public institution endpoint omits its internal work map. A
  // revocation's scope is displayable only when one earlier authorization for
  // this work has the same grant ID and exactly matches the prior claim.
  const work = derivedWork;
  const grantId = type === "revoke" ? text(event?.grantId) : "";
  const expectedSubject = work?.subject;
  const expectedAction = work?.action;
  const priorGrantRecords = type === "revoke" && grantId && Array.isArray(work?.authorizations)
    ? work.authorizations.filter(authorization => authorization?.grantId === grantId)
    : [];
  const scopeMatchesClaim = priorGrantRecords.length === 1 &&
    typeof expectedSubject?.id === "string" &&
    Number.isSafeInteger(expectedSubject?.version) &&
    expectedSubject.version >= 1 &&
    typeof expectedAction === "string" &&
    Boolean(expectedAction.trim()) &&
    priorGrantRecords[0]?.scope?.subjectId === expectedSubject.id &&
    priorGrantRecords[0]?.scope?.subjectVersion === expectedSubject.version &&
    priorGrantRecords[0]?.scope?.action === expectedAction;
  const revokeBindingValid = scopeMatchesClaim;
  const subject = type === "revoke"
    ? (revokeBindingValid ? work?.subject || null : null)
    : event?.subject || work?.subject || null;
  const creationId = text(subject?.id);
  const version = Number.isInteger(subject?.version) ? subject.version : null;
  const target = findVersion(world, creationId, version);
  const labels = {
    claim: ["Work proposal recorded", "A claim or proposal entered the institutional record; it is not an accepted outcome."],
    authorize: ["Authority grant recorded", "A grant record is visible. It does not by itself prove execution or successful observation."],
    execute: ["Execution stage recorded", "An execution-stage event is retained. Inspect its outputs and subsequent observation separately."],
    observe: ["Local byte observation recorded", `Local byte check: ${event?.passed === true ? "passed" : event?.passed === false ? "failed" : "not recorded"}. This is not a truth verdict or independent-human review.`],
    adjudicate: ["Adjudication recorded", `Decision: ${text(event?.decision) || "not recorded"}. The retained decision is shown as recorded, not independently endorsed by this view.`],
    revoke: ["Grant revocation recorded", `Reason: ${text(event?.reason) || "not supplied"}.`],
  };
  const [title, summary] = labels[type] || ["Unclassified institutional event", "The institutional event is retained; no additional consequence is inferred."];
  const workScope = creationId
    ? `${creationId}${version !== null ? ` v${version}` : ""}`
    : "";
  const detail = type === "revoke"
    ? `Grant ID: ${grantId || "not recorded"} · Work scope: ${workScope || "not resolvable"}. This retained event does not erase earlier history.`
    : type === "authorize"
      ? `Grant ID: ${text(event?.grantId) || "not recorded"}.`
      : "";
  let warning = !text(event?.id)
    ? "The retained event has no usable source ID; this display key is local to the view."
    : !timestamp(event?.at)
      ? "The retained event has no parseable timestamp; it is shown after timestamped records."
      : "";
  if (type === "revoke" && (!grantId || !creationId || version === null || !revokeBindingValid)) {
    const bindingWarning = priorGrantRecords.length > 1
      ? "Revocation grant binding is ambiguous; do not infer a missing grant or exact work/version scope."
      : "Revocation grant binding is missing or mismatched; do not infer a missing grant or exact work/version scope.";
    warning = warning ? warning + " " + bindingWarning : bindingWarning;
  }
  return {
    id: `kernel:${id}`,
    source: "kernel",
    eventType: type,
    at: timestamp(event?.at),
    actor: actorName(event?.actor),
    title,
    category: "INSTITUTIONAL WORK",
    summary: `Work ${text(event?.workId) || "ID unavailable"} · ${summary}`,
    detail,
    creationId,
    version,
    targetTitle: target ? text(target.title) || creationId : "",
    targetAvailable: Boolean(target),
    warning,
  };
}

/**
 * Build a read-only chronological view of retained world and institutional events.
 * It never awards progress, changes source records, or treats local byte checks as truth.
 */
export function projectChronicle({ world = {}, kernel = null } = {}) {
  const entries = [];
  let malformed = 0;
  const notes = {
    reports: Array.isArray(world?.reports) ? [...world.reports] : [],
    contributions: Array.isArray(world?.contributions) ? [...world.contributions] : [],
    consumed: new Set(),
  };
  const worldCollection = retainedEventCollection(world, "events");
  const kernelCollection = retainedEventCollection(kernel, "events");
  if (worldCollection.present && !worldCollection.valid) {
    malformed += 1;
    entries.push(malformedCollectionEntry("world"));
  }
  if (kernelCollection.present && !kernelCollection.valid) {
    malformed += 1;
    entries.push(malformedCollectionEntry("kernel"));
  }
  const worldEvents = worldCollection.value;
  const kernelEvents = kernelCollection.value;

  for (let index = 0; index < worldEvents.length; index += 1) {
    const event = safeEventSnapshot(worldEvents[index]);
    if (!event) {
      malformed += 1;
      entries.push(malformedEventEntry("world", index));
      continue;
    }
    entries.push(worldEntry(event, index, world, notes));
  }

  const kernelSnapshots = [];
  for (let index = 0; index < kernelEvents.length; index += 1) {
    const event = safeEventSnapshot(kernelEvents[index]);
    if (!event) {
      malformed += 1;
      entries.push(malformedEventEntry("kernel", index));
      continue;
    }
    kernelSnapshots.push({ event, index });
  }

  // Build a read-only index from safe retained event snapshots. The public API
  // supplies event history but not the reducer's mutable work map. Only a prior
  // claim establishes the subject; a revocation must carry its own grant ID.
  // Later entries can expose recorded scope without manufacturing authority.
  const derivedWorks = new Map();
  for (const { event, index } of kernelSnapshots) {
    const workId = typeof event.workId === "string" && event.workId ? event.workId : "";
    const prior = workId ? derivedWorks.get(workId) : null;
    // Snapshot context before applying this event. A later claim must never be
    // used to invent the scope of an earlier revocation.
    const priorContext = prior && Object.keys(prior).length ? { ...prior } : null;
    entries.push(kernelEntry(event, index, world, priorContext));

    if (!workId) continue;
    const work = prior || {};
    if (!prior) derivedWorks.set(workId, work);
    if (event.type === "claim" && !work.subject &&
        event.subject && typeof event.subject === "object" && !Array.isArray(event.subject)) {
      work.subject = event.subject;
      work.action = typeof event.action === "string" ? event.action : "";
    }
    // Retain only prior authorization evidence. A revoke with a missing,
    // mismatched, or ambiguous grant cannot inherit a claim's scope by work ID.
    if (event.type === "authorize" && work.subject &&
        typeof work.action === "string" && work.action.trim()) {
      if (!Array.isArray(work.authorizations)) work.authorizations = [];
      const scope = event.scope && typeof event.scope === "object" && !Array.isArray(event.scope)
        ? {
          subjectId: event.scope.subjectId,
          subjectVersion: event.scope.subjectVersion,
          action: event.scope.action,
        }
        : null;
      work.authorizations.push({ grantId: text(event.grantId), scope });
    }
  }

  entries.sort((a, b) => {
    const ta = eventTime(a.at), tb = eventTime(b.at);
    if (ta !== tb) {
      if (ta === null) return 1;
      if (tb === null) return -1;
      return tb - ta;
    }
    return a.source.localeCompare(b.source) || a.id.localeCompare(b.id);
  });
  return Object.freeze({
    entries: Object.freeze(entries.map(entry => Object.freeze(entry))),
    malformed,
  });
}
