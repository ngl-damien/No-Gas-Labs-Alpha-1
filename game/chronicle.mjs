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

function findVersion(world, creationId, version) {
  if (typeof creationId !== "string" || !Number.isInteger(version) || version < 1) return null;
  const creation = (Array.isArray(world?.creations) ? world.creations : []).find(item => item?.id === creationId);
  if (!creation) return null;
  if (creation.version === version) return creation;
  return Array.isArray(creation.versions) ? creation.versions.find(item => item?.version === version) || null : null;
}

function matchingNote(records, event, consumed) {
  const index = records.findIndex(record =>
    !consumed.has(record) &&
    record?.creationId === event.creationId &&
    record?.version === event.version &&
    record?.at === event.at &&
    actorId(record?.actor) === actorId(event.actor)
  );
  if (index < 0) return null;
  const [record] = records.splice(index, 1);
  consumed.add(record);
  return record;
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
    const record = matchingNote(records, event, notes.consumed);
    entry.title = type === "report"
      ? `Report retained · ${target ? text(target.title) || creationId : creationId || "target unavailable"}`
      : `Contribution retained · ${target ? text(target.title) || creationId : creationId || "target unavailable"}`;
    entry.category = type === "report" ? "DISSENT & FAILURE" : "FIELD CONTRIBUTION";
    entry.summary = type === "report"
      ? "A report was retained against the referenced version. It remains a report, not an adjudication."
      : "A contribution was retained against the referenced version.";
    entry.detail = text(record?.text);
    if (!record) entry.warning = "The event is retained, but its corresponding text record is absent from this snapshot.";
  } else if (type === "discover") {
    entry.title = `Visit recorded · ${location || text(event?.locationId) || "unmapped location"}`;
    entry.category = "EXPLORATION";
    entry.summary = "A visit was recorded. Discovery does not establish that a claim is true or grant authority.";
    if (!location) entry.warning = "This location ID is not in the current map; the original ID is retained without inventing a location.";
  }

  if (["publish", "contribute", "report", "repair"].includes(type) && (!target || !creationId || !version)) {
    entry.targetAvailable = false;
    entry.warning ||= "The referenced artifact version is unavailable in this snapshot; the event remains visible without an invented target.";
  }
  if (!text(event?.id)) entry.warning ||= "The retained event has no usable source ID; this display key is local to the view.";
  if (!entry.at) entry.warning ||= "The retained event has no parseable timestamp; it is shown after timestamped records.";
  return entry;
}

function kernelEntry(event, index, kernel, world) {
  const type = text(event?.type) || "unknown";
  const id = text(event?.id) || `unidentified-${index}`;
  const work = typeof event?.workId === "string" ? kernel?.works?.[event.workId] : null;
  const subject = event?.subject || work?.subject || null;
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
  return {
    id: `kernel:${id}`,
    source: "kernel",
    eventType: type,
    at: timestamp(event?.at),
    actor: actorName(event?.actor),
    title,
    category: "INSTITUTIONAL WORK",
    summary: `Work ${text(event?.workId) || "ID unavailable"} · ${summary}`,
    detail: "",
    creationId,
    version,
    targetTitle: target ? text(target.title) || creationId : "",
    targetAvailable: Boolean(target),
    warning: !text(event?.id) ? "The retained event has no usable source ID; this display key is local to the view."
      : !timestamp(event?.at) ? "The retained event has no parseable timestamp; it is shown after timestamped records." : "",
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
  const worldEvents = Array.isArray(world?.events) ? world.events : [];
  const kernelEvents = Array.isArray(kernel?.events) ? kernel.events : [];

  for (let index = 0; index < worldEvents.length; index += 1) {
    const event = worldEvents[index];
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      malformed += 1;
      entries.push({
        id: `world:unclassified-${index}`, source: "world", eventType: "unknown",
        at: "", actor: "unknown actor", title: "Unclassified retained world event",
        category: "WORLD ACTIVITY", summary: "A malformed event slot is present; no claim or consequence is inferred.",
        detail: "", creationId: "", version: null, targetTitle: "", targetAvailable: false,
        warning: "Malformed retained event payload; inspect the source store before adjudicating it.",
      });
      continue;
    }
    entries.push(worldEntry(event, index, world, notes));
  }

  for (let index = 0; index < kernelEvents.length; index += 1) {
    const event = kernelEvents[index];
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      malformed += 1;
      entries.push({
        id: `kernel:unclassified-${index}`, source: "kernel", eventType: "unknown",
        at: "", actor: "unknown actor", title: "Unclassified institutional event",
        category: "INSTITUTIONAL WORK", summary: "A malformed event slot is present; no claim or consequence is inferred.",
        detail: "", creationId: "", version: null, targetTitle: "", targetAvailable: false,
        warning: "Malformed retained event payload; inspect the source store before adjudicating it.",
      });
      continue;
    }
    entries.push(kernelEntry(event, index, kernel, world));
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
