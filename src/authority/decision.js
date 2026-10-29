import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

const verificationSeals = new WeakMap();
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RESERVED_IDENTIFIERS = new Set(["constructor", "prototype"]);
const isIdentifier = value => typeof value === "string" && IDENTIFIER.test(value) && !RESERVED_IDENTIFIERS.has(value);
const FINGERPRINT = /^[a-f0-9]{64}$/;
const DECISION_KEYS = ["schema", "proposal_id", "quest_id", "capabilities", "outputs", "acceptance", "expires_at"];
const SIGNED_KEYS = ["payload_sha256", "key_fingerprint", "signature"];

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export const decisionDigest = payload => createHash("sha256").update(canonical(payload)).digest("hex");

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function copyScope(values) {
  try {
    if (!Array.isArray(values)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(values);
    const keys = Reflect.ownKeys(descriptors);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 1 || length > 32 ||
        keys.length !== length + 1 || !keys.includes("length")) return null;

    const copy = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) return null;
      const value = descriptor.value;
      if (typeof value !== "string" || value.length === 0 ||
          value.length > 128 || value.trim() !== value) return null;
      copy.push(value);
    }
    if (new Set(copy).size !== copy.length) return null;
    return Object.freeze(copy);
  } catch {
    return null;
  }
}

function isScope(values) {
  return copyScope(values) !== null;
}

function isDecisionPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const keys = Object.keys(payload).sort();
  if (keys.length !== DECISION_KEYS.length ||
      keys.some((key, index) => key !== [...DECISION_KEYS].sort()[index])) return false;
  return payload.schema === "ngl.founder-decision.v1" &&
    isIdentifier(payload.proposal_id) &&
    isIdentifier(payload.quest_id) &&
    isScope(payload.capabilities) && isScope(payload.outputs) && isScope(payload.acceptance) &&
    isCanonicalUtcTimestamp(payload.expires_at);
}

function rejected(reason) {
  return Object.freeze({ valid: false, reason });
}

function snapshotDataObject(value, expectedKeys) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== expectedKeys.length ||
        keys.some(key => typeof key !== "string" || !expectedKeys.includes(key))) return null;

    const snapshot = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function snapshotSelectedDataFields(value, fields) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot = Object.create(null);
    for (const field of fields) {
      const descriptor = descriptors[field];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) return null;
      snapshot[field] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function snapshotDecisionPayload(payload) {
  const raw = snapshotDataObject(payload, DECISION_KEYS);
  if (!raw) return null;
  const capabilities = copyScope(raw.capabilities);
  const outputs = copyScope(raw.outputs);
  const acceptance = copyScope(raw.acceptance);
  if ([capabilities, outputs, acceptance].some(scope => scope === null)) return null;
  return Object.freeze({
    schema: raw.schema,
    proposal_id: raw.proposal_id,
    quest_id: raw.quest_id,
    capabilities,
    outputs,
    acceptance,
    expires_at: raw.expires_at
  });
}

function snapshotSignedReceipt(signed) {
  const raw = snapshotDataObject(signed, SIGNED_KEYS);
  if (!raw || typeof raw.payload_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.payload_sha256) ||
      typeof raw.key_fingerprint !== "string" || !FINGERPRINT.test(raw.key_fingerprint) ||
      typeof raw.signature !== "string" || raw.signature.length === 0 || raw.signature.length > 16384) return null;
  return Object.freeze({
    payload_sha256: raw.payload_sha256,
    key_fingerprint: raw.key_fingerprint,
    signature: raw.signature
  });
}

export function makeDecisionPayload({ proposal, quest, capabilities, outputs, acceptance, expires_at }) {
  const proposalFields = snapshotSelectedDataFields(proposal, ["event_id", "type", "quest_id"]);
  if (!proposalFields || !isIdentifier(proposalFields.event_id) || proposalFields.type !== "PROPOSAL") {
    throw new Error("proposal required");
  }
  const questFields = snapshotSelectedDataFields(quest, ["quest_id", "capabilities", "acceptance"]);
  if (!questFields || !isIdentifier(questFields.quest_id) || proposalFields.quest_id !== questFields.quest_id) {
    throw new Error("quest binding mismatch");
  }
  const questCapabilities = copyScope(questFields.capabilities);
  const questAcceptance = copyScope(questFields.acceptance);
  if (questCapabilities === null || questAcceptance === null) {
    throw new Error("quest scope must contain valid capability and acceptance lists");
  }
  const capabilityScope = copyScope(capabilities);
  const outputScope = copyScope(outputs);
  const acceptanceScope = copyScope(acceptance);
  if ([capabilityScope, outputScope, acceptanceScope].some(scope => scope === null)) {
    throw new Error("decision scope arrays must contain unique, bounded, non-empty strings");
  }
  if (capabilityScope.some(capability => !questCapabilities.includes(capability))) {
    throw new Error("decision capabilities exceed quest scope");
  }
  if (acceptanceScope.length !== questAcceptance.length ||
      questAcceptance.some(condition => !acceptanceScope.includes(condition))) {
    throw new Error("decision acceptance must preserve quest acceptance");
  }
  if (!isCanonicalUtcTimestamp(expires_at)) {
    throw new Error("canonical UTC expiry required");
  }

  const payload = Object.freeze({
    schema: "ngl.founder-decision.v1",
    proposal_id: proposalFields.event_id,
    quest_id: questFields.quest_id,
    capabilities: capabilityScope,
    outputs: outputScope,
    acceptance: acceptanceScope,
    expires_at
  });
  if (!isDecisionPayload(payload)) throw new Error("decision payload invalid");
  return payload;
}

export function verifyFounderDecision({ signed, payload, public_key_jwk, expected_fingerprint, now = Date.now() }) {
  const decision = snapshotDecisionPayload(payload);
  if (!decision || !isDecisionPayload(decision)) return rejected("DECISION_PAYLOAD_INVALID");

  const digest = decisionDigest(decision);
  if (!signed || typeof signed !== "object" || Array.isArray(signed)) return rejected("PAYLOAD_DIGEST_MISMATCH");
  const receipt = snapshotSignedReceipt(signed);
  if (!receipt) return rejected("SIGNATURE_INVALID");
  if (receipt.payload_sha256 !== digest) return rejected("PAYLOAD_DIGEST_MISMATCH");
  if (typeof expected_fingerprint !== "string" || !FINGERPRINT.test(expected_fingerprint) ||
      receipt.key_fingerprint !== expected_fingerprint) return rejected("KEY_NOT_ENROLLED");
  if (!Number.isFinite(now)) return rejected("VERIFICATION_TIME_INVALID");
  if (now >= Date.parse(decision.expires_at)) return rejected("DECISION_EXPIRED");

  try {
    const key = createPublicKey({ key: public_key_jwk, format: "jwk" });
    const actualFingerprint = createHash("sha256")
      .update(key.export({ type: "spki", format: "der" }))
      .digest("hex");
    if (actualFingerprint !== expected_fingerprint) return rejected("KEY_NOT_ENROLLED");
    const signatureBytes = Buffer.from(receipt.signature, "base64url");
    if (signatureBytes.length === 0 || signatureBytes.toString("base64url") !== receipt.signature) {
      return rejected("SIGNATURE_INVALID");
    }

    const valid = verifySignature(
      "sha256",
      Buffer.from(canonical(decision)),
      key,
      signatureBytes
    );
    if (!valid) return rejected("SIGNATURE_INVALID");

    const verification = Object.freeze({ valid: true, reason: null });
    verificationSeals.set(verification, {
      payload: decision,
      payloadDigest: digest,
      signature: receipt.signature,
      keyFingerprint: receipt.key_fingerprint
    });
    return verification;
  } catch {
    return rejected("SIGNATURE_INVALID");
  }
}

export function authorizationEvent({ signed, payload, verification }) {
  const seal = verification && typeof verification === "object"
    ? verificationSeals.get(verification)
    : null;
  const candidate = snapshotDecisionPayload(payload);
  const receipt = snapshotSignedReceipt(signed);
  if (!seal || verification.valid !== true || !candidate || !isDecisionPayload(candidate) || !receipt) {
    throw new Error("verified Founder decision required");
  }

  const digest = decisionDigest(candidate);
  if (digest !== seal.payloadDigest || receipt.payload_sha256 !== seal.payloadDigest ||
      receipt.signature !== seal.signature || receipt.key_fingerprint !== seal.keyFingerprint ||
      Date.now() >= Date.parse(seal.payload.expires_at)) {
    throw new Error("verified Founder decision required");
  }

  // Build the event only from the immutable snapshot that the verifier sealed.
  // Never reread caller-controlled payload/receipt properties after validation.
  const decision = seal.payload;
  return Object.freeze({
    event_id: "authorize:" + decision.proposal_id + ":" + seal.payloadDigest,
    type: "QUEST_AUTHORIZED",
    quest_id: decision.quest_id,
    proposal_id: decision.proposal_id,
    grant_id: seal.payloadDigest,
    actor: "founder",
    capabilities: decision.capabilities,
    outputs: decision.outputs,
    acceptance: decision.acceptance,
    expires_at: decision.expires_at,
    key_fingerprint: seal.keyFingerprint
  });
}
