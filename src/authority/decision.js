import { createHash, createPublicKey, verify as verifySignature, randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  return JSON.stringify(v);
}

export const decisionDigest = (payload) =>
  createHash("sha256").update(canonical(payload)).digest("hex");

export const FOUNDER_DECISION_SIGNATURE_SCHEMA = "ngl.founder-decision-signature.v1";

/**
 * Canonical bytes signed by the Founder device. The nonce is bound to the
 * payload digest and enrolled key fingerprint; replacing it invalidates the
 * signature instead of creating a fresh replay token.
 */
export function decisionSigningBytes({ payload_sha256, key_fingerprint, nonce } = {}) {
  if (typeof payload_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(payload_sha256) ||
      typeof key_fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(key_fingerprint) ||
      typeof nonce !== "string" || !/^[a-f0-9]{32}$/.test(nonce)) {
    throw new Error("SIGNED_SHAPE_INVALID");
  }
  return Buffer.from(canonical({
    schema: FOUNDER_DECISION_SIGNATURE_SCHEMA,
    payload_sha256,
    key_fingerprint,
    nonce,
  }));
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TRUST_PATH = path.resolve(HERE, "../../docs/authority/founder.pub.json");

/** Canonical trust-anchor schema shared with the enrollment candidate builder. */
const FOUNDER_TRUST_ANCHOR_SCHEMA = "ngl.founder-trust-anchor.v1";

function isCanonicalP256Coordinate(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value;
}

function invalidTrustAnchor(trustPath, reason = "MALFORMED_TRUST_ANCHOR") {
  return Object.freeze({ enrolled: false, reason, path: trustPath });
}

/**
 * Load an enrolled Founder trust anchor.
 *
 * Enrollment is opt-in and schema-bound: unknown states, modes, key shapes,
 * private JWK material, and mismatched fingerprints never become authority.
 * The trust file is a configured trust root; this validation does not prove
 * the real-world identity of whoever provisioned it.
 */
export function loadTrustAnchor(trustPath = DEFAULT_TRUST_PATH) {
  if (!existsSync(trustPath)) {
    return Object.freeze({ enrolled: false, reason: "TRUST_ANCHOR_ABSENT", path: trustPath });
  }

  const raw = JSON.parse(readFileSync(trustPath, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return invalidTrustAnchor(trustPath);
  }

  if (raw.status === "NOT_ENROLLED" || raw.enrolled === false) {
    return Object.freeze({ enrolled: false, reason: "NOT_ENROLLED", path: trustPath });
  }
  if (raw.status !== "ENROLLED" || raw.enrolled !== true) {
    return invalidTrustAnchor(trustPath, "TRUST_ANCHOR_STATE_INVALID");
  }

  if (raw.schema !== FOUNDER_TRUST_ANCHOR_SCHEMA ||
      !["PRODUCTION", "TEST_ONLY"].includes(raw.mode)) {
    return invalidTrustAnchor(trustPath);
  }

  const jwk = raw.public_key_jwk;
  const expectedJwkKeys = ["crv", "kty", "x", "y"];
  if (!jwk || typeof jwk !== "object" || Array.isArray(jwk) ||
      Object.keys(jwk).sort().join("\\0") !== expectedJwkKeys.join("\\0") ||
      jwk.kty !== "EC" || jwk.crv !== "P-256" ||
      !isCanonicalP256Coordinate(jwk.x) || !isCanonicalP256Coordinate(jwk.y) ||
      typeof raw.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(raw.fingerprint)) {
    return invalidTrustAnchor(trustPath);
  }

  let key;
  try {
    key = createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    return invalidTrustAnchor(trustPath);
  }
  if (key.asymmetricKeyType !== "ec") {
    return invalidTrustAnchor(trustPath);
  }

  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }))
    .digest("hex");
  if (raw.fingerprint !== fingerprint) {
    return invalidTrustAnchor(trustPath);
  }

  const publicKeyJwk = Object.freeze({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });
  return Object.freeze({
    enrolled: true,
    mode: raw.mode,
    public_key_jwk: publicKeyJwk,
    fingerprint,
    path: trustPath,
  });
}

export function makeDecisionPayload({ proposal, quest, capabilities, outputs, acceptance, expires_at }) {
  if (!proposal?.event_id || proposal.type !== "PROPOSAL") throw new Error("proposal required");
  if (!quest?.quest_id || proposal.quest_id !== quest.quest_id) throw new Error("quest binding mismatch");
  if (![capabilities, outputs, acceptance].every(Array.isArray)) throw new Error("decision scope arrays required");
  if (!expires_at || !Number.isFinite(Date.parse(expires_at))) throw new Error("valid expiry required");
  return Object.freeze({
    schema: "ngl.founder-decision.v1",
    proposal_id: proposal.event_id,
    quest_id: quest.quest_id,
    capabilities: [...capabilities],
    outputs: [...outputs],
    acceptance: [...acceptance],
    expires_at,
  });
}

/**
 * Cryptographic verification only. Never accepts caller-supplied valid:true.
 */
export function verifyFounderDecision({
  signed,
  payload,
  public_key_jwk,
  expected_fingerprint,
  now = Date.now(),
  consumed_nonces = null,
}) {
  if (!signed || typeof signed !== "object")
    return Object.freeze({ valid: false, reason: "SIGNED_OBJECT_REQUIRED" });
  if (!payload || typeof payload !== "object")
    return Object.freeze({ valid: false, reason: "PAYLOAD_REQUIRED" });
  if (signed.schema !== FOUNDER_DECISION_SIGNATURE_SCHEMA)
    return Object.freeze({ valid: false, reason: "SIGNED_SCHEMA_INVALID" });
  if (signed.payload_sha256 !== decisionDigest(payload))
    return Object.freeze({ valid: false, reason: "PAYLOAD_DIGEST_MISMATCH" });
  if (!expected_fingerprint || signed.key_fingerprint !== expected_fingerprint)
    return Object.freeze({ valid: false, reason: "KEY_NOT_ENROLLED" });
  if (now >= Date.parse(payload.expires_at))
    return Object.freeze({ valid: false, reason: "DECISION_EXPIRED" });
  // Founder decisions require the same 128-bit lowercase-hex nonce
  // format emitted by newNonce(); omission must never bypass replay checks.
  if (typeof signed.nonce !== "string" || !/^[a-f0-9]{32}$/.test(signed.nonce))
    return Object.freeze({ valid: false, reason: "NONCE_INVALID" });
  if (consumed_nonces && consumed_nonces.has(signed.nonce))
    return Object.freeze({ valid: false, reason: "NONCE_REPLAY" });
  try {
    const key = createPublicKey({ key: public_key_jwk, format: "jwk" });
    const ok = verifySignature(
      "sha256",
      decisionSigningBytes(signed),
      key,
      Buffer.from(signed.signature, "base64url")
    );
    return Object.freeze({ valid: ok, reason: ok ? null : "SIGNATURE_INVALID" });
  } catch {
    return Object.freeze({ valid: false, reason: "SIGNATURE_INVALID" });
  }
}

/**
 * ONLY entry that authorizes. Re-runs verifyFounderDecision in-process.
 * Caller-supplied verification objects are ignored.
 */
export function authorizationEvent({ signed, payload, trustPath = DEFAULT_TRUST_PATH, now = Date.now(), consumed_nonces = null }) {
  const trust = loadTrustAnchor(trustPath);
  if (!trust.enrolled) {
    throw new Error(`FOUNDER_NOT_ENROLLED:${trust.reason}`);
  }
  const verification = verifyFounderDecision({
    signed,
    payload,
    public_key_jwk: trust.public_key_jwk,
    expected_fingerprint: trust.fingerprint,
    now,
    consumed_nonces,
  });
  if (!verification.valid) {
    throw new Error(`FOUNDER_DECISION_INVALID:${verification.reason}`);
  }
  if (consumed_nonces && signed.nonce) consumed_nonces.add(signed.nonce);
  return Object.freeze({
    event_id: `authorize:${payload.proposal_id}:${signed.payload_sha256}`,
    type: "QUEST_AUTHORIZED",
    quest_id: payload.quest_id,
    proposal_id: payload.proposal_id,
    grant_id: signed.payload_sha256,
    actor: "founder",
    capabilities: payload.capabilities,
    outputs: payload.outputs,
    acceptance: payload.acceptance,
    expires_at: payload.expires_at,
    key_fingerprint: signed.key_fingerprint,
    trust_mode: trust.mode,
    verification_reason: null,
    // Explicit: verification was produced here, not accepted from caller
    verified_in_process: true,
  });
}

/** Append-only receipt link for decision chain. */
export function linkReceipt({ prevHash, payload, signed, now = Date.now() }) {
  const prev = prevHash || "0".repeat(64);
  const receiptHash = decisionDigest({ payload, signed, prev });
  const blockHash = createHash("sha256")
    .update(prev + receiptHash + String(now))
    .digest("hex");
  return Object.freeze({ prevHash: prev, receiptHash, blockHash, at: now });
}

export function newNonce() {
  return randomBytes(16).toString("hex");
}
