import { createHash, createPublicKey, verify as verifySignature, randomBytes } from "node:crypto";
import { readFileSync, existsSync, lstatSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TRUST_PATH = path.resolve(HERE, "../../docs/authority/founder.pub.json");
const consumedNonces = new Set();
const MAX_AUTHORIZATION_NONCES = 100_000;

function snapshotJsonData(value, limits = {}) {
  const maxDepth = limits.maxDepth ?? 32;
  const maxNodes = limits.maxNodes ?? 10_000;
  const active = new WeakSet();
  let nodes = 0;
  let bytes = 0;

  function visit(item, depth) {
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth) throw new Error("NON_CANONICAL_DECISION_DATA");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") {
      bytes += Buffer.byteLength(item, "utf8");
      if (bytes > 262_144) throw new Error("NON_CANONICAL_DECISION_DATA");
      return item;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item) || Object.is(item, -0)) throw new Error("NON_CANONICAL_DECISION_DATA");
      return item;
    }
    if (typeof item !== "object") throw new Error("NON_CANONICAL_DECISION_DATA");
    if (active.has(item)) throw new Error("NON_CANONICAL_DECISION_DATA");
    active.add(item);
    try {
      if (Array.isArray(item)) {
        const descriptors = Object.getOwnPropertyDescriptors(item);
        const keys = Reflect.ownKeys(descriptors).filter(key => key !== "length");
        const length = descriptors.length?.value;
        if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length) {
          throw new Error("NON_CANONICAL_DECISION_DATA");
        }
        const output = [];
        for (const key of keys) {
          if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) {
            throw new Error("NON_CANONICAL_DECISION_DATA");
          }
        }
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || descriptor.get || descriptor.set) {
            throw new Error("NON_CANONICAL_DECISION_DATA");
          }
          output.push(visit(descriptor.value, depth + 1));
        }
        return output;
      }

      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new Error("NON_CANONICAL_DECISION_DATA");
      const descriptors = Object.getOwnPropertyDescriptors(item);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.some(key => typeof key !== "string")) throw new Error("NON_CANONICAL_DECISION_DATA");
      const output = Object.create(null);
      for (const key of keys.sort()) {
        const descriptor = descriptors[key];
        if (!descriptor.enumerable || !("value" in descriptor) || descriptor.get || descriptor.set) {
          throw new Error("NON_CANONICAL_DECISION_DATA");
        }
        bytes += Buffer.byteLength(key, "utf8");
        if (bytes > 262_144) throw new Error("NON_CANONICAL_DECISION_DATA");
        output[key] = visit(descriptor.value, depth + 1);
      }
      return output;
    } finally {
      active.delete(item);
    }
  }

  return visit(value, 0);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export const decisionDigest = payload =>
  createHash("sha256").update(canonical(snapshotJsonData(payload))).digest("hex");

function publicKeyFingerprint(publicKeyJwk) {
  let jwk;
  try { jwk = snapshotJsonData(publicKeyJwk); }
  catch { return null; }
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" ||
      typeof jwk.x !== "string" || typeof jwk.y !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(jwk.x) || !/^[A-Za-z0-9_-]{43}$/.test(jwk.y)) return null;
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  if (x.length !== 32 || y.length !== 32 || x.toString("base64url") !== jwk.x || y.toString("base64url") !== jwk.y) return null;
  try { createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: "jwk" }); }
  catch { return null; }
  return createHash("sha256")
    .update(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }))
    .digest("hex");
}

/** Load a trust anchor for inspection. Authorization never accepts a caller-selected path. */
export function loadTrustAnchor(trustPath = DEFAULT_TRUST_PATH) {
  if (!existsSync(trustPath)) {
    return Object.freeze({ enrolled: false, reason: "TRUST_ANCHOR_ABSENT", path: trustPath });
  }
  let raw;
  try {
    const stat = lstatSync(trustPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16_384) {
      return Object.freeze({ enrolled: false, reason: "MALFORMED_TRUST_ANCHOR", path: trustPath });
    }
    raw = snapshotJsonData(JSON.parse(readFileSync(trustPath, "utf8")));
  } catch {
    return Object.freeze({ enrolled: false, reason: "MALFORMED_TRUST_ANCHOR", path: trustPath });
  }
  if (raw.schema !== "ngl.founder-trust-anchor.v1") {
    return Object.freeze({ enrolled: false, reason: "MALFORMED_TRUST_ANCHOR", path: trustPath });
  }
  if (raw.status === "NOT_ENROLLED" || raw.enrolled === false) {
    return Object.freeze({ enrolled: false, reason: "NOT_ENROLLED", path: trustPath });
  }
  if (raw.status !== "ENROLLED" || raw.enrolled !== true ||
      !["PRODUCTION", "TEST_ONLY"].includes(raw.mode) ||
      !raw.public_key_jwk || typeof raw.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(raw.fingerprint)) {
    return Object.freeze({ enrolled: false, reason: "MALFORMED_TRUST_ANCHOR", path: trustPath });
  }
  if (Object.hasOwn(raw.public_key_jwk, "d")) {
    return Object.freeze({ enrolled: false, reason: "PRIVATE_KEY_IN_TRUST_ANCHOR", path: trustPath });
  }
  const actualFingerprint = publicKeyFingerprint(raw.public_key_jwk);
  if (!actualFingerprint || actualFingerprint !== raw.fingerprint) {
    return Object.freeze({ enrolled: false, reason: "FINGERPRINT_MISMATCH", path: trustPath });
  }
  return Object.freeze({
    enrolled: true,
    mode: raw.mode,
    public_key_jwk: deepFreeze(raw.public_key_jwk),
    fingerprint: raw.fingerprint,
    path: trustPath,
  });
}

export function makeDecisionPayload(input) {
  const args = snapshotJsonData(input);
  const { proposal, quest, capabilities, outputs, acceptance, expires_at } = args;
  if (!proposal?.event_id || proposal.type !== "PROPOSAL") throw new Error("proposal required");
  if (!quest?.quest_id || proposal.quest_id !== quest.quest_id) throw new Error("quest binding mismatch");
  if (![capabilities, outputs, acceptance].every(value =>
    Array.isArray(value) && value.every(item => typeof item === "string" && item.length > 0))) {
    throw new Error("decision scope arrays required");
  }
  if (!expires_at || !Number.isFinite(Date.parse(expires_at))) throw new Error("valid expiry required");
  return deepFreeze({
    schema: "ngl.founder-decision.v1",
    proposal_id: proposal.event_id,
    quest_id: quest.quest_id,
    capabilities: [...capabilities],
    outputs: [...outputs],
    acceptance: [...acceptance],
    expires_at,
  });
}

/** Cryptographic verification only. A valid result is not authority to create an event. */
export function verifyFounderDecision({
  signed,
  payload,
  public_key_jwk,
  expected_fingerprint,
  now = Date.now(),
  consumed_nonces = null,
}) {
  let safeSigned, safePayload, safePublicKey;
  try {
    safeSigned = snapshotJsonData(signed);
    safePayload = snapshotJsonData(payload);
    safePublicKey = snapshotJsonData(public_key_jwk);
  } catch {
    return Object.freeze({ valid: false, reason: "NON_CANONICAL_INPUT" });
  }
  if (!safeSigned || typeof safeSigned !== "object" || Array.isArray(safeSigned)) {
    return Object.freeze({ valid: false, reason: "SIGNED_OBJECT_REQUIRED" });
  }
  if (!safePayload || typeof safePayload !== "object" || Array.isArray(safePayload)) {
    return Object.freeze({ valid: false, reason: "PAYLOAD_REQUIRED" });
  }
  if (Object.keys(safeSigned).sort().join(",") !== "key_fingerprint,nonce,payload_sha256,signature") {
    return Object.freeze({ valid: false, reason: "SIGNED_SHAPE_INVALID" });
  }
  if (Object.keys(safePayload).sort().join(",") !== "acceptance,capabilities,expires_at,outputs,proposal_id,quest_id,schema") {
    return Object.freeze({ valid: false, reason: "PAYLOAD_SHAPE_INVALID" });
  }
  if (safePayload.schema !== "ngl.founder-decision.v1" ||
      typeof safePayload.proposal_id !== "string" || !safePayload.proposal_id ||
      typeof safePayload.quest_id !== "string" || !safePayload.quest_id ||
      ![safePayload.capabilities, safePayload.outputs, safePayload.acceptance].every(value =>
        Array.isArray(value) && value.every(item => typeof item === "string" && item.length > 0))) {
    return Object.freeze({ valid: false, reason: "PAYLOAD_INVALID" });
  }
  if (typeof safeSigned.payload_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(safeSigned.payload_sha256) ||
      safeSigned.payload_sha256 !== decisionDigest(safePayload)) {
    return Object.freeze({ valid: false, reason: "PAYLOAD_DIGEST_MISMATCH" });
  }
  if (typeof expected_fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(expected_fingerprint) ||
      safeSigned.key_fingerprint !== expected_fingerprint ||
      publicKeyFingerprint(safePublicKey) !== expected_fingerprint) {
    return Object.freeze({ valid: false, reason: "KEY_NOT_ENROLLED" });
  }
  if (!Number.isFinite(now)) return Object.freeze({ valid: false, reason: "CLOCK_INVALID" });
  const expiry = Date.parse(safePayload.expires_at);
  if (!Number.isFinite(expiry) || now >= expiry) {
    return Object.freeze({ valid: false, reason: "DECISION_EXPIRED" });
  }
  if (typeof safeSigned.nonce !== "string" || safeSigned.nonce.length < 16 || safeSigned.nonce.length > 256) {
    return Object.freeze({ valid: false, reason: "NONCE_INVALID" });
  }
  if (consumed_nonces && typeof consumed_nonces.has === "function" && consumed_nonces.has(safeSigned.nonce)) {
    return Object.freeze({ valid: false, reason: "NONCE_REPLAY" });
  }
  if (typeof safeSigned.signature !== "string" || !/^[A-Za-z0-9_-]+$/.test(safeSigned.signature) ||
      safeSigned.signature.length > 256) {
    return Object.freeze({ valid: false, reason: "SIGNATURE_INVALID" });
  }
  const signature = Buffer.from(safeSigned.signature, "base64url");
  if (signature.length < 8 || signature.length > 80 || signature.toString("base64url") !== safeSigned.signature) {
    return Object.freeze({ valid: false, reason: "SIGNATURE_INVALID" });
  }
  try {
    const key = createPublicKey({ key: { ...safePublicKey }, format: "jwk" });
    const valid = verifySignature("sha256", Buffer.from(canonical(safePayload)), key, signature);
    return Object.freeze({ valid, reason: valid ? null : "SIGNATURE_INVALID" });
  } catch {
    return Object.freeze({ valid: false, reason: "SIGNATURE_INVALID" });
  }
}

function exactAuthorizationInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("FOUNDER_AUTHORIZATION_INPUT_INVALID");
  }
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(input); }
  catch { throw new Error("FOUNDER_AUTHORIZATION_INPUT_INVALID"); }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 2 || !keys.includes("signed") || !keys.includes("payload")) {
    throw new Error("FOUNDER_AUTHORIZATION_INPUT_INVALID");
  }
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !("value" in descriptor) || descriptor.get || descriptor.set) {
      throw new Error("FOUNDER_AUTHORIZATION_INPUT_INVALID");
    }
  }
  try {
    return {
      signed: snapshotJsonData(descriptors.signed.value),
      payload: snapshotJsonData(descriptors.payload.value),
    };
  } catch {
    throw new Error("FOUNDER_AUTHORIZATION_INPUT_INVALID");
  }
}

/**
 * The only authority-producing entry point. It always loads the repository trust
 * anchor, uses process time and a private in-process replay set, and accepts no
 * caller-supplied trust path, clock, nonce ledger, or verification result.
 */
export function authorizationEvent(input) {
  const { signed, payload } = exactAuthorizationInput(input);
  const trust = loadTrustAnchor();
  if (!trust.enrolled) throw new Error("FOUNDER_NOT_ENROLLED:" + trust.reason);
  if (trust.mode !== "PRODUCTION") throw new Error("FOUNDER_TRUST_MODE_INVALID");
  if (consumedNonces.size >= MAX_AUTHORIZATION_NONCES) throw new Error("FOUNDER_NONCE_LEDGER_FULL");
  const verification = verifyFounderDecision({
    signed,
    payload,
    public_key_jwk: trust.public_key_jwk,
    expected_fingerprint: trust.fingerprint,
    now: Date.now(),
    consumed_nonces: consumedNonces,
  });
  if (!verification.valid) throw new Error("FOUNDER_DECISION_INVALID:" + verification.reason);
  consumedNonces.add(signed.nonce);
  return deepFreeze({
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
    key_fingerprint: signed.key_fingerprint,
    trust_mode: trust.mode,
    verification_reason: null,
    verified_in_process: true,
  });
}

/** Append-only receipt link for decision chain. */
export function linkReceipt({ prevHash, payload, signed, now = Date.now() }) {
  const safePayload = snapshotJsonData(payload);
  const safeSigned = snapshotJsonData(signed);
  const prev = prevHash || "0".repeat(64);
  if (typeof prev !== "string" || !/^[a-f0-9]{64}$/.test(prev) || !Number.isFinite(now)) {
    throw new Error("INVALID_RECEIPT_LINK");
  }
  const receiptHash = decisionDigest({ payload: safePayload, signed: safeSigned, prev });
  const blockHash = createHash("sha256").update(prev + receiptHash + String(now)).digest("hex");
  return Object.freeze({ prevHash: prev, receiptHash, blockHash, at: now });
}

export function newNonce() {
  return randomBytes(16).toString("hex");
}
