import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

const verificationSeals = new WeakMap();
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const DECISION_KEYS = ["schema", "proposal_id", "quest_id", "capabilities", "outputs", "acceptance", "expires_at"];

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
      !/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function isScope(values) {
  return Array.isArray(values) && values.length > 0 && values.length <= 32 &&
    values.every(value => typeof value === "string" && value.length > 0 &&
      value.length <= 128 && value.trim() === value) &&
    new Set(values).size === values.length;
}

function isDecisionPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const keys = Object.keys(payload).sort();
  if (keys.length !== DECISION_KEYS.length ||
      keys.some((key, index) => key !== [...DECISION_KEYS].sort()[index])) return false;
  return payload.schema === "ngl.founder-decision.v1" &&
    typeof payload.proposal_id === "string" && IDENTIFIER.test(payload.proposal_id) &&
    typeof payload.quest_id === "string" && IDENTIFIER.test(payload.quest_id) &&
    isScope(payload.capabilities) && isScope(payload.outputs) && isScope(payload.acceptance) &&
    isCanonicalUtcTimestamp(payload.expires_at);
}

function rejected(reason) {
  return Object.freeze({ valid: false, reason });
}

export function makeDecisionPayload({ proposal, quest, capabilities, outputs, acceptance, expires_at }) {
  if (!proposal || typeof proposal.event_id !== "string" ||
      !IDENTIFIER.test(proposal.event_id) || proposal.type !== "PROPOSAL") {
    throw new Error("proposal required");
  }
  if (!quest || typeof quest.quest_id !== "string" ||
      !IDENTIFIER.test(quest.quest_id) || proposal.quest_id !== quest.quest_id) {
    throw new Error("quest binding mismatch");
  }
  if (![capabilities, outputs, acceptance].every(isScope)) {
    throw new Error("decision scope arrays must contain unique, bounded, non-empty strings");
  }
  if (!isCanonicalUtcTimestamp(expires_at)) {
    throw new Error("canonical UTC expiry required");
  }

  const payload = Object.freeze({
    schema: "ngl.founder-decision.v1",
    proposal_id: proposal.event_id,
    quest_id: quest.quest_id,
    capabilities: Object.freeze([...capabilities]),
    outputs: Object.freeze([...outputs]),
    acceptance: Object.freeze([...acceptance]),
    expires_at
  });
  if (!isDecisionPayload(payload)) throw new Error("decision payload invalid");
  return payload;
}

export function verifyFounderDecision({ signed, payload, public_key_jwk, expected_fingerprint, now = Date.now() }) {
  if (!isDecisionPayload(payload)) return rejected("DECISION_PAYLOAD_INVALID");

  const digest = decisionDigest(payload);
  if (!signed || typeof signed !== "object" || Array.isArray(signed) ||
      signed.payload_sha256 !== digest) return rejected("PAYLOAD_DIGEST_MISMATCH");
  if (typeof expected_fingerprint !== "string" || !FINGERPRINT.test(expected_fingerprint) ||
      signed.key_fingerprint !== expected_fingerprint) return rejected("KEY_NOT_ENROLLED");
  if (!Number.isFinite(now)) return rejected("VERIFICATION_TIME_INVALID");
  if (now >= Date.parse(payload.expires_at)) return rejected("DECISION_EXPIRED");

  try {
    const key = createPublicKey({ key: public_key_jwk, format: "jwk" });
    const actualFingerprint = createHash("sha256")
      .update(key.export({ type: "spki", format: "der" }))
      .digest("hex");
    if (actualFingerprint !== expected_fingerprint) return rejected("KEY_NOT_ENROLLED");
    if (typeof signed.signature !== "string" || !signed.signature) return rejected("SIGNATURE_INVALID");

    const valid = verifySignature(
      "sha256",
      Buffer.from(canonical(payload)),
      key,
      Buffer.from(signed.signature, "base64url")
    );
    if (!valid) return rejected("SIGNATURE_INVALID");

    const verification = Object.freeze({ valid: true, reason: null });
    verificationSeals.set(verification, {
      payloadDigest: digest,
      signature: signed.signature,
      keyFingerprint: signed.key_fingerprint
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
  if (!seal || verification.valid !== true || !isDecisionPayload(payload) ||
      !signed || typeof signed !== "object") {
    throw new Error("verified Founder decision required");
  }

  const digest = decisionDigest(payload);
  if (digest !== seal.payloadDigest || signed.payload_sha256 !== seal.payloadDigest ||
      signed.signature !== seal.signature || signed.key_fingerprint !== seal.keyFingerprint ||
      Date.now() >= Date.parse(payload.expires_at)) {
    throw new Error("verified Founder decision required");
  }

  return Object.freeze({
    event_id: "authorize:" + payload.proposal_id + ":" + signed.payload_sha256,
    type: "QUEST_AUTHORIZED",
    quest_id: payload.quest_id,
    proposal_id: payload.proposal_id,
    grant_id: signed.payload_sha256,
    actor: "founder",
    capabilities: payload.capabilities,
    outputs: payload.outputs,
    acceptance: payload.acceptance,
    expires_at: payload.expires_at,
    key_fingerprint: signed.key_fingerprint
  });
}
