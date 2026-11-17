import { isStrictTimestamp } from './timestamps.mjs';

const MAX_REPORT_CHARACTERS = 1000;
const MAX_RETAINED_VERSIONS = 100_000;
const MAX_REPORT_TITLE_CHARACTERS = 60;

const FIELDS = Object.freeze([
  Object.freeze({
    id: "claim",
    label: "Claim under test",
    prompt: "State one specific, falsifiable claim.",
    placeholder: "What exact statement should be tested?",
    maxLength: 140,
  }),
  Object.freeze({
    id: "source",
    label: "Best source or direct observation",
    prompt: "Name an inspectable source or direct observation. A model assertion alone is not evidence.",
    placeholder: "What source or observation can another person inspect?",
    maxLength: 140,
  }),
  Object.freeze({
    id: "falsifier",
    label: "Counterexample or possible falsifier",
    prompt: "What observation would weaken or disprove the claim?",
    placeholder: "What could show the claim is wrong?",
    maxLength: 140,
  }),
  Object.freeze({
    id: "unknown",
    label: "Unknown and next test",
    prompt: "What remains unknown, and what small test could resolve it?",
    placeholder: "What should be checked next?",
    maxLength: 140,
  }),
]);

function boundedText(value, label, maxLength) {
  if (typeof value !== "string") throw new Error(label + " must be text");
  const text = value.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/gu, " ").trim();
  if (!text) throw new Error(label + " is required");
  if (Array.from(text).length > maxLength) {
    throw new Error(label + " exceeds " + maxLength + " characters");
  }
  return text;
}

// Descriptor reads do not execute accessors. Require ordinary data objects so
// inherited fields and exotic prototypes cannot supply a retained version.
function requirePlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " must be a plain object");
  }
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw new Error(label + " is malformed");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(label + " must be a plain object");
  }
}

function ownDataValue(object, key) {
  if (!object || typeof object !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && Object.hasOwn(descriptor, "value")
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

// Never spread or iterate caller-owned version arrays: Symbol.iterator may be
// replaced by a getter or method. Read a bounded, dense, exact index set instead.
function ownDataArray(value, label) {
  if (!Array.isArray(value)) throw new Error(label + " must be a plain array");
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new Error(label + " is malformed");
  }
  if (prototype !== Array.prototype) throw new Error(label + " must be a plain array");

  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, "value")
    ? lengthDescriptor.value
    : null;
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RETAINED_VERSIONS) {
    throw new Error(label + " is malformed or exceeds the version limit");
  }

  const allowedKeys = new Set(["length"]);
  const entries = [];
  for (let index = 0; index < length; index++) {
    const key = String(index);
    allowedKeys.add(key);
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
      throw new Error(label + " must contain dense own data entries");
    }
    entries.push(descriptor.value);
  }
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      throw new Error(label + " contains unexpected properties");
    }
  }
  return entries;
}

function retainedVersion(creation, version) {
  requirePlainObject(creation, "a retained creation");
  const id = boundedText(ownDataValue(creation, "id"), "creation ID", 80);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("a positive retained version is required");
  }

  const currentVersion = ownDataValue(creation, "version");
  const versions = ownDataArray(ownDataValue(creation, "versions"), "retained version history");
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 1 ||
      versions.length !== currentVersion - 1) {
    throw new Error("the requested version is not uniquely retained");
  }

  // Validate the entire flat history before selecting a historical version.
  // A malformed or duplicate entry must not make another version look unique.
  for (let index = 0; index < versions.length; index++) {
    const candidate = versions[index];
    requirePlainObject(candidate, "a retained historical version");
    if (ownDataValue(candidate, "id") !== id ||
        ownDataValue(candidate, "version") !== index + 1) {
      throw new Error("the requested version is not uniquely retained");
    }
  }

  const source = version === currentVersion ? creation : versions[version - 1];
  if (!source) throw new Error("the requested version is not uniquely retained");
  requirePlainObject(source, "the selected retained version");
  const title = boundedText(ownDataValue(source, "title"), "retained version title", 80);
  const publishedAt = ownDataValue(source, "publishedAt");
  if (!isStrictTimestamp(publishedAt)) {
    throw new Error("the requested version is not a strictly timestamped publication");
  }
  const html = ownDataValue(source, "html");
  if (typeof html !== "string") {
    throw new Error("the requested version has no retained HTML bytes");
  }

  // The world loader independently recomputes this receipt against the exact
  // retained HTML bytes. The Clerk carries that validated receipt forward; it
  // does not treat the digest as proof that the artifact's claims are true.
  const sourceReceipt = ownDataValue(source, "receipt");
  try {
    requirePlainObject(sourceReceipt, "the retained version receipt");
  } catch {
    throw new Error("the requested version has no valid SHA-256 byte receipt");
  }
  const algorithm = ownDataValue(sourceReceipt, "algorithm");
  const digest = ownDataValue(sourceReceipt, "digest");
  const size = ownDataValue(sourceReceipt, "size");
  if (algorithm !== "sha256" ||
      typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest) ||
      !Number.isSafeInteger(size) || size < 1) {
    throw new Error("the requested version has no valid SHA-256 byte receipt");
  }
  let byteLength;
  try {
    byteLength = new TextEncoder().encode(html).byteLength;
  } catch {
    throw new Error("the requested version byte length cannot be checked");
  }
  if (byteLength !== size) {
    throw new Error("the requested version receipt size does not match retained HTML bytes");
  }
  return {
    id,
    title,
    version,
    publishedAt,
    receipt: Object.freeze({ algorithm, digest, size }),
  };
}

/**
 * The Contradiction Clerk is a deterministic local challenge protocol.
 * It asks bounded questions; it is not an AI call, independent observer,
 * adjudicator, authority source, or source of canonical progress.
 */
export function prepareContradictionReview(creation, version) {
  const target = retainedVersion(creation, version);
  return Object.freeze({
    schema: "ngl.contradiction-review.v1",
    clerk: Object.freeze({
      id: "contradiction-clerk",
      name: "The Contradiction Clerk",
      role: "bounded-adversary",
    }),
    target: Object.freeze({
      creationId: target.id,
      title: target.title,
      version: target.version,
      publishedAt: target.publishedAt,
      receipt: target.receipt,
    }),
    prompts: FIELDS,
    authority: "NONE",
    providerCall: "NOT_MADE",
    verdict: "NOT_ISSUED",
  });
}

function challengeAnswers(answers) {
  requirePlainObject(answers, "structured challenge answers");
  const keys = Reflect.ownKeys(answers);
  if (keys.length !== FIELDS.length ||
      keys.some(key => typeof key !== "string" || !FIELDS.some(field => field.id === key))) {
    throw new Error("structured challenge answers must contain exactly the required fields");
  }

  const values = Object.create(null);
  for (const field of FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(answers, field.id);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
      throw new Error("structured challenge answers must use own data fields");
    }
    values[field.id] = boundedText(descriptor.value, field.label, field.maxLength);
  }
  return values;
}

const REPORT_HEADER = "CONTRADICTION CLERK · STRUCTURED CHALLENGE";
const REPORT_VERDICT = "REPORT ONLY — NOT A VERDICT.";
const REPORT_RECEIPT_NOTE = "Receipt = bytes, not truth; no AI/provider call or independent observation occurred.";

function reportTitleExcerpt(title) {
  const titleCharacters = Array.from(title);
  return titleCharacters.length > MAX_REPORT_TITLE_CHARACTERS
    ? titleCharacters.slice(0, MAX_REPORT_TITLE_CHARACTERS - 1).join("") + "…"
    : title;
}

function formatContradictionReportText(target, values) {
  const text = [
    REPORT_HEADER,
    "Target: " + reportTitleExcerpt(target.title) + " [" + target.creationId + "] v" + target.version,
    "SHA-256 " + target.receipt.digest + " · " + target.receipt.size + "B",
    "Claim: " + values.claim,
    "Source: " + values.source,
    "Falsifier: " + values.falsifier,
    "Unknown: " + values.unknown,
    REPORT_VERDICT,
    REPORT_RECEIPT_NOTE,
  ].join("\n");
  if (Array.from(text).length > MAX_REPORT_CHARACTERS) {
    throw new Error("structured challenge exceeds the retained report limit");
  }
  return text;
}

export function formatContradictionReport(creation, version, answers) {
  const review = prepareContradictionReview(creation, version);
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new Error("structured challenge answers are required");
  }
  return formatContradictionReportText(review.target, challengeAnswers(answers));
}

/** Parse only the exact bounded report format emitted by the Contradiction Clerk. */
export function parseContradictionReport(text) {
  try {
    if (typeof text !== "string" || Array.from(text).length > MAX_REPORT_CHARACTERS) return null;
    const lines = text.split("\n");
    if (lines.length !== 9 || lines[0] !== REPORT_HEADER ||
        lines[7] !== REPORT_VERDICT || lines[8] !== REPORT_RECEIPT_NOTE) return null;

    const targetMatch = /^Target: (.+) \[([^\]]+)\] v([1-9][0-9]*)$/.exec(lines[1]);
    if (!targetMatch) return null;
    const titleExcerpt = targetMatch[1];
    if (!titleExcerpt || Array.from(titleExcerpt).length > MAX_REPORT_TITLE_CHARACTERS) return null;
    const creationId = boundedText(targetMatch[2], "creation ID", 80);
    if (creationId !== targetMatch[2]) return null;
    const version = Number(targetMatch[3]);
    if (!Number.isSafeInteger(version) || version < 1) return null;

    const receiptMatch = /^SHA-256 ([a-f0-9]{64}) · ([1-9][0-9]*)B$/.exec(lines[2]);
    if (!receiptMatch) return null;
    const digest = receiptMatch[1];
    const size = Number(receiptMatch[2]);
    if (!Number.isSafeInteger(size) || size < 1) return null;

    const answers = Object.create(null);
    for (let index = 0; index < FIELDS.length; index++) {
      const field = FIELDS[index];
      const prefix = field.id[0].toUpperCase() + field.id.slice(1) + ": ";
      const line = lines[index + 3];
      if (!line.startsWith(prefix)) return null;
      const value = line.slice(prefix.length);
      const normalized = boundedText(value, field.label, field.maxLength);
      if (normalized !== value) return null;
      answers[field.id] = normalized;
    }

    const canonical = formatContradictionReportText({
      creationId, title: titleExcerpt, version, receipt: { digest, size },
    }, answers);
    if (canonical !== text) return null;
    return Object.freeze({
      creationId, titleExcerpt, version, digest, size,
      answers: Object.freeze(answers),
    });
  } catch {
    return null;
  }
}

/**
 * Bind a parsed Clerk report to one exact retained version and its SHA-256 receipt.
 * The validated world loader recomputes the digest over artifact bytes; this
 * read-only projection does not treat byte identity as truth or verification.
 */
export function isContradictionReportForVersion(text, creationId, version) {
  try {
    const parsed = parseContradictionReport(text);
    if (!parsed) return false;
    const id = boundedText(creationId, "creation ID", 80);
    if (id !== creationId) return false;
    requirePlainObject(version, "a retained published version");
    if (ownDataValue(version, "id") !== id ||
        !Number.isSafeInteger(ownDataValue(version, "version")) ||
        ownDataValue(version, "version") < 1 ||
        !isStrictTimestamp(ownDataValue(version, "publishedAt"))) return false;
    const title = boundedText(ownDataValue(version, "title"), "retained version title", 80);
    if (title !== ownDataValue(version, "title")) return false;
    const receipt = ownDataValue(version, "receipt");
    requirePlainObject(receipt, "the retained version receipt");
    const algorithm = ownDataValue(receipt, "algorithm");
    const digest = ownDataValue(receipt, "digest");
    const size = ownDataValue(receipt, "size");
    if (algorithm !== "sha256" || typeof digest !== "string" ||
        !/^[a-f0-9]{64}$/.test(digest) || !Number.isSafeInteger(size) || size < 1) return false;
    return parsed.creationId === id &&
      parsed.version === ownDataValue(version, "version") &&
      parsed.titleExcerpt === reportTitleExcerpt(title) &&
      parsed.digest === digest && parsed.size === size;
  } catch {
    return false;
  }
}


// Shared read-only projection for the Character Record and Quest Board. This
// deliberately mirrors the retained-version/publication and one-to-one report
// joins used by the character skill so the two player projections cannot award
// different Contradiction Practice counts for the same world snapshot.
const contradictionProjectionRows = value => Array.isArray(value) ? value : [];
const contradictionProjectionVersionKey = (id, version) => JSON.stringify([id, version]);

function contradictionProjectionUniqueEvents(events) {
  const source = contradictionProjectionRows(events);
  const counts = new Map();
  for (const event of source) {
    if (typeof event?.id === "string" && event.id.length > 0) {
      counts.set(event.id, (counts.get(event.id) || 0) + 1);
    }
  }
  return source.filter(event =>
    typeof event?.id === "string" && event.id.length > 0 && counts.get(event.id) === 1
  );
}

function contradictionProjectionValidVersion(version) {
  return version && Number.isSafeInteger(version.version) && version.version > 0 &&
    isStrictTimestamp(version.publishedAt) &&
    version.receipt?.algorithm === "sha256" &&
    typeof version.receipt.digest === "string" &&
    /^[a-f0-9]{64}$/.test(version.receipt.digest) &&
    Number.isSafeInteger(version.receipt.size) && version.receipt.size >= 0;
}

function contradictionProjectionVersionIndex(world) {
  const index = new Map();
  for (const creation of contradictionProjectionRows(world?.creations)) {
    if (!creation || typeof creation.id !== "string" || !creation.id) continue;
    for (const version of [...contradictionProjectionRows(creation.versions), creation]) {
      if (!contradictionProjectionValidVersion(version)) continue;
      const key = contradictionProjectionVersionKey(creation.id, version.version);
      if (index.has(key)) index.set(key, null);
      else index.set(key, version);
    }
  }
  return index;
}

function contradictionProjectionPublications(world) {
  const events = contradictionProjectionUniqueEvents(world?.events);
  const versions = contradictionProjectionVersionIndex(world);
  const candidates = [];
  for (const event of events) {
    if (event?.type !== "publish" ||
        typeof event.actor?.id !== "string" || !event.actor.id.trim() ||
        event.actor.id.trim() !== event.actor.id || event.actor.role !== "founder" ||
        typeof event.creationId !== "string" || !Number.isSafeInteger(event.version) ||
        event.version < 1 || !isStrictTimestamp(event.at)) continue;
    const key = contradictionProjectionVersionKey(event.creationId, event.version);
    const version = versions.get(key);
    if (!version || version.publishedAt !== event.at) continue;
    candidates.push({ event, key });
  }
  const groups = new Map();
  for (const candidate of candidates) {
    const group = groups.get(candidate.key) || [];
    group.push(candidate);
    groups.set(candidate.key, group);
  }
  const retained = [];
  for (const group of groups.values()) {
    const rewarded = group.filter(candidate =>
      Number.isSafeInteger(candidate.event.reward) && candidate.event.reward === 100
    );
    const selected = rewarded.length === 1 ? rewarded
      : rewarded.length === 0 && group.length === 1 ? group
      : [];
    for (const candidate of selected) retained.push(candidate.event);
  }
  return retained;
}

function contradictionProjectionValidActor(actor) {
  return actor && typeof actor.id === "string" && actor.id.length > 0 &&
    actor.id.trim() === actor.id && ["founder", "witness"].includes(actor.role);
}

function contradictionProjectionJoinKey(entry, fields) {
  if (!contradictionProjectionValidActor(entry?.actor) || !isStrictTimestamp(entry.at)) return null;
  const values = fields.map(field => entry[field]);
  if (!fields.every((field, index) => field === "version"
      ? Number.isSafeInteger(values[index]) && values[index] > 0
      : typeof values[index] === "string" && values[index].length > 0 && values[index].trim() === values[index])) return null;
  return JSON.stringify([entry.actor.id, entry.actor.role, entry.at, ...values]);
}

function contradictionProjectionMatchedReports(records, allEvents, viewer, predicate) {
  const eventGroups = new Map();
  for (const event of contradictionProjectionRows(allEvents)) {
    if (event?.type !== "report") continue;
    const key = contradictionProjectionJoinKey(event, ["creationId", "version"]);
    if (key === null) continue;
    const group = eventGroups.get(key) || [];
    group.push(event);
    eventGroups.set(key, group);
  }

  const source = contradictionProjectionRows(records);
  const recordIdCounts = new Map();
  for (const record of source) {
    if (typeof record?.id === "string" && record.id.length > 0) {
      recordIdCounts.set(record.id, (recordIdCounts.get(record.id) || 0) + 1);
    }
  }

  const recordGroups = new Map();
  for (const record of source) {
    if (typeof record?.id !== "string" || !record.id || record.id.trim() !== record.id ||
        record.actor?.id !== viewer?.id || record.actor?.role !== viewer?.role) continue;
    const key = contradictionProjectionJoinKey(record, ["creationId", "version"]);
    if (key === null) continue;
    const group = recordGroups.get(key) || [];
    group.push(record);
    recordGroups.set(key, group);
  }

  const matched = [];
  for (const [key, group] of recordGroups) {
    if (group.length !== 1) continue;
    const record = group[0];
    if (recordIdCounts.get(record.id) !== 1) continue;
    const candidates = eventGroups.get(key);
    if (!candidates || candidates.length !== 1) continue;
    let accepted = false;
    try { accepted = predicate(candidates[0], record) === true; } catch { accepted = false; }
    if (accepted) matched.push({ event: candidates[0], record });
  }
  return matched;
}

/**
 * Return only unique actor-attributed Clerk reports bound to one exact retained
 * version and one earlier publication. This is participation bookkeeping,
 * not source truth, independent verification, adjudication, XP or authority.
 */
export function projectContradictionPracticeReports(world, viewer) {
  try {
    if (!contradictionProjectionValidActor(viewer)) return Object.freeze([]);
    const events = contradictionProjectionUniqueEvents(world?.events);
    const positionByEvent = new Map(events.map((event, index) => [event, index]));
    const versions = contradictionProjectionVersionIndex(world);
    const publicationByVersion = new Map(contradictionProjectionPublications(world).map(event => [
      contradictionProjectionVersionKey(event.creationId, event.version), event
    ]));
    const hasEarlierPublication = event => {
      const publication = publicationByVersion.get(
        contradictionProjectionVersionKey(event.creationId, event.version)
      );
      const publicationPosition = publication ? (positionByEvent.get(publication) ?? -1) : -1;
      const activityPosition = positionByEvent.get(event) ?? -1;
      return publicationPosition >= 0 && activityPosition > publicationPosition &&
        isStrictTimestamp(publication.at) && isStrictTimestamp(event.at) &&
        Date.parse(publication.at) <= Date.parse(event.at);
    };
    const matches = contradictionProjectionMatchedReports(
      world?.reports, events, viewer,
      (event, record) => {
        if (!hasEarlierPublication(event)) return false;
        const version = versions.get(
          contradictionProjectionVersionKey(event.creationId, event.version)
        );
        return Boolean(version && isContradictionReportForVersion(
          record?.text, event.creationId, version
        ));
      }
    );
    return Object.freeze(matches.map(match => Object.freeze(match)));
  } catch {
    return Object.freeze([]);
  }
}
