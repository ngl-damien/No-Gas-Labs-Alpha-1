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
  const text = value.trim();
  if (!text) throw new Error(label + " is required");
  if (Array.from(text).length > maxLength) {
    throw new Error(label + " exceeds " + maxLength + " characters");
  }
  return text;
}

function retainedVersion(creation, version) {
  if (!creation || typeof creation !== "object" || Array.isArray(creation)) {
    throw new Error("a retained creation is required");
  }
  const id = boundedText(creation.id, "creation ID", 80);
  const title = boundedText(creation.title, "creation title", 80);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("a positive retained version is required");
  }
  const candidates = [
    creation,
    ...(Array.isArray(creation.versions) ? creation.versions : []),
  ];
  const matches = candidates.filter(candidate => candidate?.version === version);
  if (matches.length !== 1) {
    throw new Error("the requested version is not uniquely retained");
  }
  return { id, title, version };
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
    "Claim under test: " + values.claim,
    "Source / direct observation: " + values.source,
    "Possible falsifier / counterexample: " + values.falsifier,
    "Unknown / next test: " + values.unknown,
    "Disposition: REPORT ONLY — NOT A VERDICT.",
    "Boundary: Local checklist only; no AI/provider call or independent observation occurred.",
  ].join("\n");
  if (Array.from(text).length > MAX_REPORT_CHARACTERS) {
    throw new Error("structured challenge exceeds the retained report limit");
  }
  return text;
}
