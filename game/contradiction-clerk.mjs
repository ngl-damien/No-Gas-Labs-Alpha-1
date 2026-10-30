const MAX_REPORT_CHARACTERS = 1000;

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

// Read only own data properties. A hostile or malformed object must not run
// getters while the Clerk is preparing a source-bound challenge.
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

function retainedVersion(creation, version) {
  if (!creation || typeof creation !== "object" || Array.isArray(creation)) {
    throw new Error("a retained creation is required");
  }
  const id = boundedText(ownDataValue(creation, "id"), "creation ID", 80);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("a positive retained version is required");
  }
  const versions = ownDataValue(creation, "versions");
  const candidates = [
    creation,
    ...(Array.isArray(versions) ? versions : []),
  ];
  const matches = candidates.filter(candidate =>
    candidate && ownDataValue(candidate, "version") === version
  );
  if (matches.length !== 1) {
    throw new Error("the requested version is not uniquely retained");
  }
  const source = matches[0];
  if (ownDataValue(source, "id") !== id) {
    throw new Error("the requested version is not uniquely retained");
  }
  const title = boundedText(ownDataValue(source, "title"), "retained version title", 80);

  // The world loader independently recomputes this receipt against the exact
  // retained HTML bytes. The Clerk carries that validated receipt forward; it
  // does not treat the digest as proof that the artifact's claims are true.
  const sourceReceipt = ownDataValue(source, "receipt");
  if (!sourceReceipt || typeof sourceReceipt !== "object" || Array.isArray(sourceReceipt)) {
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

export function formatContradictionReport(creation, version, answers) {
  const review = prepareContradictionReview(creation, version);
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new Error("structured challenge answers are required");
  }
  const values = Object.fromEntries(FIELDS.map(field => [
    field.id,
    boundedText(answers[field.id], field.label, field.maxLength),
  ]));
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
