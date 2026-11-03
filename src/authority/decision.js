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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TRUST_PATH = path.resolve(HERE, "../../docs/authority/founder.pub.json");

/** Load enrolled Founder trust anchor. Fails closed if missing or not enrolled. */
export function loadTrustAnchor(trustPath = DEFAULT_TRUST_PATH) {
  if (!existsSync(trustPath)) {
    return Object.freeze({ enrolled: false, reason: "TRUST_ANCHOR_ABSENT", path: trustPath });
  }
  const raw = JSON.parse(readFileSync(trustPath, "utf8"));
  if (!raw || raw.status === "NOT_ENROLLED" || raw.enrolled === false) {
    return Object.freeze({ enrolled: false, reason: "NOT_ENROLLED", path: trustPath, meta: raw });
  }
  if (!raw.public_key_jwk || !raw.fingerprint) {
    return Object.freeze({ enrolled: false, reason: "MALFORMED_TRUST_ANCHOR", path: trustPath });
  }
  if (raw.mode === "TEST_ONLY") {
    return Object.freeze({
      enrolled: true,
      mode: "TEST_ONLY",
      public_key_jwk: raw.public_key_jwk,
      fingerprint: raw.fingerprint,
      path: trustPath,
    });
  }
  return Object.freeze({
    enrolled: true,
    mode: raw.mode || "PRODUCTION",
    public_key_jwk: raw.public_key_jwk,
    fingerprint: raw.fingerprint,
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
  if (signed.payload_sha256 !== decisionDigest(payload))
    return Object.freeze({ valid: false, reason: "PAYLOAD_DIGEST_MISMATCH" });
  if (!expected_fingerprint || signed.key_fingerprint !== expected_fingerprint)
    return Object.freeze({ valid: false, reason: "KEY_NOT_ENROLLED" });
  if (now >= Date.parse(payload.expires_at))
    return Object.freeze({ valid: false, reason: "DECISION_EXPIRED" });
  if (signed.nonce) {
    if (typeof signed.nonce !== "string" || signed.nonce.length < 16)
      return Object.freeze({ valid: false, reason: "NONCE_INVALID" });
    if (consumed_nonces && consumed_nonces.has(signed.nonce))
      return Object.freeze({ valid: false, reason: "NONCE_REPLAY" });
  }
  try {
    const key = createPublicKey({ key: public_key_jwk, format: "jwk" });
    const ok = verifySignature(
      "sha256",
      Buffer.from(canonical(payload)),
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
