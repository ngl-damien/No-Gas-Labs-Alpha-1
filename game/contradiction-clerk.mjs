const MAX_REPORT_CHARACTERS = 1000;
const MAX_RETAINED_VERSIONS = 100_000;

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
  return {
    id,
    title,
    version,
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

export function formatContradictionReport(creation, version, answers) {
  const review = prepareContradictionReview(creation, version);
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new Error("structured challenge answers are required");
  }
  const values = challengeAnswers(answers);
  const text = [
    "CONTRADICTION CLERK · STRUCTURED CHALLENGE",
    "Target: " + review.target.title + " [" + review.target.creationId + "] v" + review.target.version,
    "Target bytes: sha256:" + review.target.receipt.digest + " · " + review.target.receipt.size + " bytes.",
    "Claim under test: " + values.claim,
    "Source / direct observation: " + values.source,
    "Possible falsifier / counterexample: " + values.falsifier,
    "Unknown / next test: " + values.unknown,
    "Disposition: REPORT ONLY — NOT A VERDICT.",
    "Boundary: Receipt identifies bytes, not truth; no AI/provider call or independent observation occurred.",
  ].join("\n");
  if (Array.from(text).length > MAX_REPORT_CHARACTERS) {
    throw new Error("structured challenge exceeds the retained report limit");
  }
  return text;
}
