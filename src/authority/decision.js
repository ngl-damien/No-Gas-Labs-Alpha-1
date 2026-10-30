import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

const verificationSeals = new WeakMap();
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RESERVED_IDENTIFIERS = new Set(["constructor", "prototype"]);
// IDs are later used as keys in ordinary projection objects. Reject every
// inherited Object.prototype name, not only constructor/prototype, so a quest
// such as "toString" cannot resolve to an inherited method before it is created.
const isIdentifier = value => typeof value === "string" && IDENTIFIER.test(value) &&
  !RESERVED_IDENTIFIERS.has(value) && !Object.hasOwn(Object.prototype, value);
const FINGERPRINT = /^[a-f0-9]{64}$/;
const DECISION_SCHEMA = "ngl.founder-decision.v2";
const DECISION_KEYS = ["schema", "proposal_id", "quest_id", "audience", "capabilities", "outputs", "acceptance", "expires_at"];
const SIGNED_KEYS = ["payload_sha256", "key_fingerprint", "signature"];
const AUTHORIZATION_EVENT_KEYS = ["event_id", "type", "quest_id", "audience", "proposal_id", "grant_id", "actor", "capabilities", "outputs", "acceptance", "expires_at", "key_fingerprint", "signature"];

const CANONICAL_MAX_DEPTH = 64;
const CANONICAL_MAX_NODES = 10000;
const CANONICAL_MAX_BYTES = 1024 * 1024;
// A P-256 ECDSA signature is DER-encoded; two 33-byte INTEGERs plus
// the SEQUENCE header cannot exceed 72 bytes (96 unpadded base64url chars).
const P256_DER_SIGNATURE_MAX_BYTES = 72;
const P256_DER_SIGNATURE_MAX_BASE64URL_CHARS = 96;

function canonical(value, state = { active: new Set(), nodes: 0, bytes: 0 }, depth = 0) {
  state.nodes += 1;
  if (depth > CANONICAL_MAX_DEPTH || state.nodes > CANONICAL_MAX_NODES) {
    throw new TypeError("canonical input exceeds structural limits");
  }

  const account = encoded => {
    state.bytes += Buffer.byteLength(encoded);
    if (state.bytes > CANONICAL_MAX_BYTES) throw new TypeError("canonical input exceeds byte limit");
    return encoded;
  };

  if (value === null) return account("null");
  if (typeof value === "string") return account(JSON.stringify(value));
  if (typeof value === "boolean") return account(value ? "true" : "false");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical numbers must be finite");
    return account(JSON.stringify(value));
  }
  if (typeof value !== "object") {
    throw new TypeError("canonical input must contain only JSON data values");
  }
  if (state.active.has(value)) throw new TypeError("canonical input must not contain cycles");
  state.active.add(value);

  try {
    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > CANONICAL_MAX_NODES ||
          keys.length !== length + 1 || !keys.includes("length")) {
        throw new TypeError("canonical arrays must be dense and contain no extra properties");
      }
      // Count delimiters and separators too: the byte limit applies to the
      // complete canonical UTF-8 representation, not just its values.
      let encoded = account("[");
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) {
          throw new TypeError("canonical arrays must contain own enumerable data elements");
        }
        if (index > 0) encoded += account(",");
        encoded += canonical(descriptor.value, state, depth + 1);
      }
      return encoded + account("]");
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("canonical objects must be plain data objects");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > CANONICAL_MAX_NODES ||
        keys.some(key => typeof key !== "string" ||
          descriptors[key].enumerable !== true ||
          !Object.hasOwn(descriptors[key], "value"))) {
      throw new TypeError("canonical objects must contain only own enumerable data properties");
    }
    keys.sort();
    let encoded = account("{");
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (index > 0) encoded += account(",");
      encoded += account(JSON.stringify(key));
      encoded += account(":");
      encoded += canonical(descriptors[key].value, state, depth + 1);
    }
    return encoded + account("}");
  } finally {
    state.active.delete(value);
  }
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
  return payload.schema === DECISION_SCHEMA &&
    isIdentifier(payload.proposal_id) &&
    isIdentifier(payload.quest_id) &&
    isIdentifier(payload.audience) &&
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
    audience: raw.audience,
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
      typeof raw.signature !== "string" || raw.signature.length === 0 ||
      raw.signature.length > P256_DER_SIGNATURE_MAX_BASE64URL_CHARS) return null;
  const signatureBytes = Buffer.from(raw.signature, "base64url");
  if (signatureBytes.length < 8 || signatureBytes.length > P256_DER_SIGNATURE_MAX_BYTES ||
      signatureBytes.toString("base64url") !== raw.signature) return null;
  return Object.freeze({
    payload_sha256: raw.payload_sha256,
    key_fingerprint: raw.key_fingerprint,
    signature: raw.signature
  });
}

function snapshotPublicKeyJwk(value) {
  const raw = snapshotDataObject(value, ["kty", "crv", "x", "y"]);
  if (!raw || raw.kty !== "EC" || raw.crv !== "P-256") return null;
  for (const coordinate of [raw.x, raw.y]) {
    if (typeof coordinate !== "string") return null;
    const bytes = Buffer.from(coordinate, "base64url");
    if (bytes.length !== 32 || bytes.toString("base64url") !== coordinate) return null;
  }
  // This verifier's declared scheme is ECDSA P-256 with SHA-256. Requiring
  // exactly the four public JWK fields prevents accessors, private-key fields,
  // and algorithm/curve ambiguity from crossing the crypto boundary.
  return Object.freeze({ kty: "EC", crv: "P-256", x: raw.x, y: raw.y });
}

function snapshotCallArguments(value, requiredKeys, optionalKeys = []) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    if (keys.some(key => typeof key !== "string" || !allowed.has(key)) ||
        requiredKeys.some(key => !Object.hasOwn(descriptors, key))) return null;

    const snapshot = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function makeDecisionPayload(input) {
  const args = snapshotCallArguments(input, ["proposal", "quest", "capabilities", "outputs", "acceptance", "expires_at", "audience"]);
  if (!args) throw new Error("decision arguments must be own data properties");
  const { proposal, quest, capabilities, outputs, acceptance, expires_at, audience } = args;
  if (!isIdentifier(audience)) throw new Error("decision audience required");
  const proposalFields = snapshotSelectedDataFields(proposal, ["event_id", "type", "quest_id", "capability"]);
  if (!proposalFields || !isIdentifier(proposalFields.event_id) ||
      proposalFields.type !== "PROPOSAL" || !isIdentifier(proposalFields.capability)) {
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
  if (capabilityScope.length !== 1 || capabilityScope[0] !== proposalFields.capability) {
    throw new Error("decision capabilities must match proposal request");
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
    schema: DECISION_SCHEMA,
    proposal_id: proposalFields.event_id,
    quest_id: questFields.quest_id,
    audience,
    capabilities: capabilityScope,
    outputs: outputScope,
    acceptance: acceptanceScope,
    expires_at
  });
  if (!isDecisionPayload(payload)) throw new Error("decision payload invalid");
  return payload;
}

export function verifyFounderDecision(input) {
  const args = snapshotCallArguments(input, ["signed", "payload", "public_key_jwk", "expected_fingerprint", "expected_audience"], ["now"]);
  if (!args) return rejected("VERIFICATION_INPUT_INVALID");
  const { signed, payload, public_key_jwk, expected_fingerprint, expected_audience } = args;
  const now = args.now === undefined ? Date.now() : args.now;
  const decision = snapshotDecisionPayload(payload);
  if (!decision || !isDecisionPayload(decision)) return rejected("DECISION_PAYLOAD_INVALID");
  if (!isIdentifier(expected_audience) || decision.audience !== expected_audience) return rejected("AUDIENCE_MISMATCH");

  const digest = decisionDigest(decision);
  if (!signed || typeof signed !== "object" || Array.isArray(signed)) return rejected("PAYLOAD_DIGEST_MISMATCH");
  const receipt = snapshotSignedReceipt(signed);
  if (!receipt) return rejected("SIGNATURE_INVALID");
  if (receipt.payload_sha256 !== digest) return rejected("PAYLOAD_DIGEST_MISMATCH");
  if (typeof expected_fingerprint !== "string" || !FINGERPRINT.test(expected_fingerprint) ||
      receipt.key_fingerprint !== expected_fingerprint) return rejected("KEY_NOT_ENROLLED");
  if (!Number.isFinite(now)) return rejected("VERIFICATION_TIME_INVALID");
  if (now >= Date.parse(decision.expires_at)) return rejected("DECISION_EXPIRED");

  const publicKeyJwk = snapshotPublicKeyJwk(public_key_jwk);
  if (!publicKeyJwk) return rejected("SIGNATURE_INVALID");

  try {
    const key = createPublicKey({ key: publicKeyJwk, format: "jwk" });
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

export function authorizationEvent(input) {
  const args = snapshotCallArguments(input, ["signed", "payload", "verification"]);
  if (!args) throw new Error("verified Founder decision required");
  const { signed, payload, verification } = args;
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
    audience: decision.audience,
    proposal_id: decision.proposal_id,
    grant_id: seal.payloadDigest,
    actor: "founder",
    capabilities: decision.capabilities,
    outputs: decision.outputs,
    acceptance: decision.acceptance,
    expires_at: decision.expires_at,
    key_fingerprint: seal.keyFingerprint,
    signature: seal.signature
  });
}

export function verifyAuthorizationEvent(event, options = {}) {
  const args = snapshotCallArguments(options, ["public_key_jwk", "expected_fingerprint", "expected_audience"], ["now"]);
  if (!args) return false;
  const { public_key_jwk, expected_fingerprint, expected_audience } = args;
  const now = args.now === undefined ? Date.now() : args.now;
  // The persisted event is an untrusted boundary. Snapshot exact own data fields
  // before reading anything; accessors, inherited fields, and extras fail closed.
  const raw = snapshotDataObject(event, AUTHORIZATION_EVENT_KEYS);
  if (!raw || raw.type !== "QUEST_AUTHORIZED" || raw.actor !== "founder" ||
      typeof raw.event_id !== "string" || typeof raw.proposal_id !== "string" ||
      typeof raw.quest_id !== "string" || !isIdentifier(raw.audience) || typeof raw.grant_id !== "string" ||
      !/^[a-f0-9]{64}$/.test(raw.grant_id) ||
      typeof raw.key_fingerprint !== "string" || !FINGERPRINT.test(raw.key_fingerprint) ||
      raw.event_id !== "authorize:" + raw.proposal_id + ":" + raw.grant_id) return false;

  const payload = {
    schema: DECISION_SCHEMA,
    proposal_id: raw.proposal_id,
    quest_id: raw.quest_id,
    audience: raw.audience,
    capabilities: raw.capabilities,
    outputs: raw.outputs,
    acceptance: raw.acceptance,
    expires_at: raw.expires_at
  };
  const signed = {
    payload_sha256: raw.grant_id,
    key_fingerprint: raw.key_fingerprint,
    signature: raw.signature
  };
  return verifyFounderDecision({ signed, payload, public_key_jwk, expected_fingerprint, expected_audience, now }).valid === true;
}

export function createFounderAuthorizationVerifier(options = {}) {
  const args = snapshotCallArguments(options, ["public_key_jwk", "expected_fingerprint", "expected_audience"]);
  if (!args) throw new Error("FOUNDER_TRUST_CONFIGURATION_INVALID");
  const { public_key_jwk, expected_fingerprint, expected_audience } = args;
  const publicKeyJwk = snapshotPublicKeyJwk(public_key_jwk);
  if (!publicKeyJwk || typeof expected_fingerprint !== "string" || !FINGERPRINT.test(expected_fingerprint) || !isIdentifier(expected_audience)) {
    throw new Error("FOUNDER_TRUST_CONFIGURATION_INVALID");
  }
  let actualFingerprint;
  try {
    const key = createPublicKey({ key: publicKeyJwk, format: "jwk" });
    actualFingerprint = createHash("sha256")
      .update(key.export({ type: "spki", format: "der" }))
      .digest("hex");
  } catch {
    throw new Error("FOUNDER_TRUST_CONFIGURATION_INVALID");
  }
  if (actualFingerprint !== expected_fingerprint) throw new Error("FOUNDER_TRUST_FINGERPRINT_MISMATCH");

  // Close over a detached, immutable public-key snapshot and pin. The host must
  // obtain expected_fingerprint from trusted startup configuration, not a request.
  return event => verifyAuthorizationEvent(event, {
    public_key_jwk: publicKeyJwk,
    expected_fingerprint,
    expected_audience
  });
}
