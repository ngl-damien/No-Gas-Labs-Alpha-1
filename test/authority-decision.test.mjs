import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, sign, randomUUID } from "node:crypto";
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

function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  return JSON.stringify(v);
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
  const payload_sha256 = decisionDigest(payload);
  const sig = sign("sha256", Buffer.from(canonical(payload)), privateKey);
  return {
    payload_sha256,
    key_fingerprint: fingerprint,
    signature: Buffer.from(sig).toString("base64url"),
    nonce: newNonce(),
  };
}

const proposal = { event_id: "prop-1", type: "PROPOSAL", quest_id: "q-1" };
const quest = { quest_id: "q-1" };
const future = new Date(Date.now() + 3600_000).toISOString();

test("valid decision verifies", () => {
  const kp = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"], expires_at: future,
  });
  const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
  const v = verifyFounderDecision({
    signed, payload, public_key_jwk: kp.jwk, expected_fingerprint: kp.fingerprint,
  });
  assert.equal(v.valid, true);
});

test("caller-supplied verification.valid is ignored — authorizationEvent re-verifies", () => {
  const dir = path.join(tmpdir(), "ngl-auth-" + process.pid);
  mkdirSync(dir, { recursive: true });
  const kp = keyPair();
  const trustPath = path.join(dir, "founder.pub.json");
  writeFileSync(trustPath, JSON.stringify({
    status: "ENROLLED", enrolled: true, mode: "TEST_ONLY",
    public_key_jwk: kp.jwk, fingerprint: kp.fingerprint,
  }));
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"], expires_at: future,
  });
  // Attack: forged signed blob with wrong sig but attacker hopes valid:true is trusted
  const badSigned = {
    payload_sha256: decisionDigest(payload),
    key_fingerprint: kp.fingerprint,
    signature: Buffer.alloc(64).toString("base64url"),
    nonce: newNonce(),
  };
  assert.throws(
    () => authorizationEvent({
      signed: badSigned,
      payload,
      trustPath,
      // even if caller tried to pass verification: {valid:true} it is not a parameter anymore
    }),
    /FOUNDER_DECISION_INVALID/
  );
  rmSync(dir, { recursive: true, force: true });
});

test("expired fails closed", () => {
  const kp = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: [], outputs: [], acceptance: [], expires_at: new Date(Date.now() - 1000).toISOString(),
  });
  const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
  const v = verifyFounderDecision({
    signed, payload, public_key_jwk: kp.jwk, expected_fingerprint: kp.fingerprint,
  });
  assert.equal(v.valid, false);
  assert.equal(v.reason, "DECISION_EXPIRED");
});

test("wrong fingerprint fails KEY_NOT_ENROLLED", () => {
  const kp = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: [], outputs: [], acceptance: [], expires_at: future,
  });
  const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
  const v = verifyFounderDecision({
    signed, payload, public_key_jwk: kp.jwk, expected_fingerprint: "deadbeef",
  });
  assert.equal(v.valid, false);
  assert.equal(v.reason, "KEY_NOT_ENROLLED");
});

test("payload tamper fails digest mismatch", () => {
  const kp = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: ["a"], outputs: [], acceptance: [], expires_at: future,
  });
  const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
  const tampered = { ...payload, capabilities: ["root"] };
  const v = verifyFounderDecision({
    signed, payload: tampered, public_key_jwk: kp.jwk, expected_fingerprint: kp.fingerprint,
  });
  assert.equal(v.valid, false);
  assert.equal(v.reason, "PAYLOAD_DIGEST_MISMATCH");
});

test("nonce replay fails", () => {
  const kp = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: [], outputs: [], acceptance: [], expires_at: future,
  });
  const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
  const consumed = new Set([signed.nonce]);
  const v = verifyFounderDecision({
    signed, payload, public_key_jwk: kp.jwk, expected_fingerprint: kp.fingerprint, consumed_nonces: consumed,
  });
  assert.equal(v.valid, false);
  assert.equal(v.reason, "NONCE_REPLAY");
});

test("absent trust anchor fails closed", () => {
  const trust = loadTrustAnchor("/tmp/ngl-definitely-missing-founder-pub.json");
  assert.equal(trust.enrolled, false);
  assert.equal(trust.reason, "TRUST_ANCHOR_ABSENT");
});

test("NOT_ENROLLED sentinel fails closed", () => {
  const dir = path.join(tmpdir(), "ngl-auth-ne-" + process.pid);
  mkdirSync(dir, { recursive: true });
  const trustPath = path.join(dir, "founder.pub.json");
  writeFileSync(trustPath, JSON.stringify({ status: "NOT_ENROLLED", enrolled: false }));
  assert.equal(loadTrustAnchor(trustPath).enrolled, false);
  const kp = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: [], outputs: [], acceptance: [], expires_at: future,
  });
  const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
  assert.throws(
    () => authorizationEvent({ signed, payload, trustPath }),
    /FOUNDER_NOT_ENROLLED/
  );
  rmSync(dir, { recursive: true, force: true });
});

test("receipt chain links prevHash", () => {
  const a = linkReceipt({ prevHash: null, payload: { x: 1 }, signed: { s: 1 } });
  const b = linkReceipt({ prevHash: a.blockHash, payload: { x: 2 }, signed: { s: 2 } });
  assert.equal(b.prevHash, a.blockHash);
  assert.notEqual(a.blockHash, b.blockHash);
});

test("an enrolled trust anchor must bind its fingerprint to the exact public JWK", () => {
  const dir = path.join(tmpdir(), "ngl-auth-fingerprint-" + process.pid + "-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  try {
    const enrolled = keyPair();
    const attacker = keyPair();
    const trustPath = path.join(dir, "founder.pub.json");
    writeFileSync(trustPath, JSON.stringify({
      schema: "ngl.founder-trust-anchor.v1",
      status: "ENROLLED",
      enrolled: true,
      mode: "TEST_ONLY",
      public_key_jwk: attacker.jwk,
      // The receipt claims the enrolled key's pin while substituting another key.
      fingerprint: enrolled.fingerprint,
    }));
    const payload = makeDecisionPayload({
      proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"], expires_at: future,
    });
    const forgedWithPinnedLabel = signPayload(attacker.privateKey, payload, enrolled.fingerprint);

    const trust = loadTrustAnchor(trustPath);
    assert.equal(trust.enrolled, false);
    assert.equal(trust.reason, "FINGERPRINT_MISMATCH");
    assert.throws(
      () => authorizationEvent({ signed: forgedWithPinnedLabel, payload, trustPath }),
      /FOUNDER_NOT_ENROLLED:FINGERPRINT_MISMATCH/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("trust anchors reject private or non-canonical JWK fields", () => {
  const dir = path.join(tmpdir(), "ngl-auth-private-jwk-" + process.pid + "-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  try {
    const kp = keyPair();
    const trustPath = path.join(dir, "founder.pub.json");
    const privateJwk = kp.privateKey.export({ format: "jwk" });
    writeFileSync(trustPath, JSON.stringify({
      schema: "ngl.founder-trust-anchor.v1",
      status: "ENROLLED",
      enrolled: true,
      mode: "TEST_ONLY",
      public_key_jwk: privateJwk,
      fingerprint: kp.fingerprint,
    }));
    const trust = loadTrustAnchor(trustPath);
    assert.equal(trust.enrolled, false);
    assert.equal(trust.reason, "MALFORMED_TRUST_ANCHOR");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
