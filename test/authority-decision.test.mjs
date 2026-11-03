import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  makeDecisionPayload,
  decisionDigest,
  verifyFounderDecision,
  authorizationEvent,
  loadTrustAnchor,
  linkReceipt,
  newNonce,
} from "../src/authority/decision.js";

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }))
    .digest("hex");
  return { publicKey, privateKey, jwk, fingerprint };
}

function signPayload(privateKey, payload, fingerprint) {
  return {
    payload_sha256: decisionDigest(payload),
    key_fingerprint: fingerprint,
    signature: sign("sha256", Buffer.from(canonical(payload)), privateKey).toString("base64url"),
    nonce: newNonce(),
  };
}

const proposal = { event_id: "prop-1", type: "PROPOSAL", quest_id: "q-1" };
const quest = { quest_id: "q-1" };
const future = new Date(Date.now() + 3_600_000).toISOString();

test("valid decision verifies cryptographically against the matching P-256 key", () => {
  const kp = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"], expires_at: future,
  });
  const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
  const result = verifyFounderDecision({
    signed, payload, public_key_jwk: kp.jwk, expected_fingerprint: kp.fingerprint,
  });
  assert.equal(result.valid, true);
});

test("wrong fingerprint or a mismatched public key cannot verify", () => {
  const kp = keyPair();
  const other = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"], expires_at: future,
  });
  const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
  assert.equal(verifyFounderDecision({
    signed, payload, public_key_jwk: kp.jwk, expected_fingerprint: other.fingerprint,
  }).reason, "KEY_NOT_ENROLLED");
  assert.equal(verifyFounderDecision({
    signed, payload, public_key_jwk: other.jwk, expected_fingerprint: kp.fingerprint,
  }).reason, "KEY_NOT_ENROLLED");
});

test("payload tampering fails digest verification", () => {
  const kp = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"], expires_at: future,
  });
  const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
  const tampered = { ...payload, capabilities: ["root"] };
  assert.equal(verifyFounderDecision({
    signed, payload: tampered, public_key_jwk: kp.jwk, expected_fingerprint: kp.fingerprint,
  }).reason, "PAYLOAD_DIGEST_MISMATCH");
});

test("expired decisions fail closed", () => {
  const kp = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"],
    expires_at: new Date(Date.now() - 1_000).toISOString(),
  });
  const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
  assert.equal(verifyFounderDecision({
    signed, payload, public_key_jwk: kp.jwk, expected_fingerprint: kp.fingerprint,
  }).reason, "DECISION_EXPIRED");
});

test("nonce replay is rejected by the low-level verifier when a consumed set is supplied", () => {
  const kp = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"], expires_at: future,
  });
  const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
  assert.equal(verifyFounderDecision({
    signed, payload, public_key_jwk: kp.jwk, expected_fingerprint: kp.fingerprint,
    consumed_nonces: new Set([signed.nonce]),
  }).reason, "NONCE_REPLAY");
});

test("trust-anchor loader validates the enrolled public key fingerprint", () => {
  const dir = path.join(tmpdir(), "ngl-auth-anchor-" + process.pid);
  mkdirSync(dir, { recursive: true });
  try {
    const kp = keyPair();
    const trustPath = path.join(dir, "founder.pub.json");
    writeFileSync(trustPath, JSON.stringify({
      schema: "ngl.founder-trust-anchor.v1",
      status: "ENROLLED",
      enrolled: true,
      mode: "PRODUCTION",
      public_key_jwk: kp.jwk,
      fingerprint: kp.fingerprint,
    }));
    const trust = loadTrustAnchor(trustPath);
    assert.equal(trust.enrolled, true);
    assert.equal(trust.mode, "PRODUCTION");
    assert.equal(trust.fingerprint, kp.fingerprint);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("trust-anchor loader rejects a fingerprint that does not match its JWK", () => {
  const dir = path.join(tmpdir(), "ngl-auth-mismatch-" + process.pid);
  mkdirSync(dir, { recursive: true });
  try {
    const kp = keyPair();
    const trustPath = path.join(dir, "founder.pub.json");
    writeFileSync(trustPath, JSON.stringify({
      schema: "ngl.founder-trust-anchor.v1",
      status: "ENROLLED",
      enrolled: true,
      mode: "PRODUCTION",
      public_key_jwk: kp.jwk,
      fingerprint: "0".repeat(64),
    }));
    const trust = loadTrustAnchor(trustPath);
    assert.equal(trust.enrolled, false);
    assert.equal(trust.reason, "FINGERPRINT_MISMATCH");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a self-pinned attacker cannot choose the trust path, clock, nonce set or verification result", () => {
  const dir = path.join(tmpdir(), "ngl-auth-self-pin-" + process.pid);
  mkdirSync(dir, { recursive: true });
  try {
    const attacker = keyPair();
    const trustPath = path.join(dir, "attacker.pub.json");
    writeFileSync(trustPath, JSON.stringify({
      schema: "ngl.founder-trust-anchor.v1",
      status: "ENROLLED",
      enrolled: true,
      mode: "PRODUCTION",
      public_key_jwk: attacker.jwk,
      fingerprint: attacker.fingerprint,
    }));
    assert.equal(loadTrustAnchor(trustPath).enrolled, true);
    const payload = makeDecisionPayload({
      proposal, quest, capabilities: ["root"], outputs: ["attacker-output"], acceptance: ["accept"], expires_at: future,
    });
    const signed = signPayload(attacker.privateKey, payload, attacker.fingerprint);
    assert.throws(() => authorizationEvent({
      signed,
      payload,
      trustPath,
      now: 0,
      consumed_nonces: new Set(),
      verification: { valid: true },
    }), /FOUNDER_AUTHORIZATION_INPUT_INVALID/);
    assert.throws(() => authorizationEvent({ signed, payload }), /FOUNDER_NOT_ENROLLED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("NOT_ENROLLED sentinel fails closed", () => {
  const dir = path.join(tmpdir(), "ngl-auth-ne-" + process.pid);
  mkdirSync(dir, { recursive: true });
  try {
    const trustPath = path.join(dir, "founder.pub.json");
    writeFileSync(trustPath, JSON.stringify({
      schema: "ngl.founder-trust-anchor.v1",
      status: "NOT_ENROLLED",
      enrolled: false,
      mode: null,
      public_key_jwk: null,
      fingerprint: null,
    }));
    assert.equal(loadTrustAnchor(trustPath).enrolled, false);
    assert.equal(loadTrustAnchor(trustPath).reason, "NOT_ENROLLED");
    assert.throws(() => authorizationEvent({
      signed: { payload_sha256: "0".repeat(64), key_fingerprint: "0".repeat(64), signature: "AAAA", nonce: newNonce() },
      payload: { schema: "ngl.founder-decision.v1" },
    }), /FOUNDER_NOT_ENROLLED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("accessor-bearing data is rejected without invoking getters", () => {
  let invoked = false;
  const value = {};
  Object.defineProperty(value, "secret", {
    enumerable: true,
    get() { invoked = true; return "not-json-data"; },
  });
  assert.throws(() => decisionDigest(value), /NON_CANONICAL_DECISION_DATA/);
  assert.equal(invoked, false);
  const input = {};
  Object.defineProperty(input, "signed", {
    enumerable: true,
    get() { invoked = true; return {}; },
  });
  Object.defineProperty(input, "payload", { enumerable: true, value: {} });
  assert.throws(() => authorizationEvent(input), /FOUNDER_AUTHORIZATION_INPUT_INVALID/);
  assert.equal(invoked, false);
});

test("cyclic payloads fail closed before canonical serialization", () => {
  const payload = {};
  payload.self = payload;
  assert.throws(() => decisionDigest(payload), /NON_CANONICAL_DECISION_DATA/);
});

test("receipt chain links previous block hashes deterministically", () => {
  const first = linkReceipt({ prevHash: null, payload: { x: 1 }, signed: { s: 1 } });
  const second = linkReceipt({ prevHash: first.blockHash, payload: { x: 2 }, signed: { s: 2 } });
  assert.equal(second.prevHash, first.blockHash);
  assert.notEqual(first.blockHash, second.blockHash);
});
