import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  makeDecisionPayload,
  decisionDigest,
  FOUNDER_DECISION_SIGNATURE_SCHEMA,
  decisionSigningBytes,
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
  const envelope = {
    schema: FOUNDER_DECISION_SIGNATURE_SCHEMA,
    payload_sha256: decisionDigest(payload),
    key_fingerprint: fingerprint,
    nonce: newNonce(),
  };
  const sig = sign("sha256", decisionSigningBytes(envelope), privateKey);
  return { ...envelope, signature: Buffer.from(sig).toString("base64url") };
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
    schema: "ngl.founder-trust-anchor.v1", status: "ENROLLED", enrolled: true, mode: "TEST_ONLY",
    public_key_jwk: kp.jwk, fingerprint: kp.fingerprint,
  }));
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"], expires_at: future,
  });
  // Attack: forged signed blob with wrong sig but attacker hopes valid:true is trusted
  const badSigned = {
    schema: FOUNDER_DECISION_SIGNATURE_SCHEMA,
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

test("missing and malformed Founder nonces fail before authorization", () => {
  const dir = path.join(tmpdir(), "ngl-auth-nonce-" + process.pid);
  mkdirSync(dir, { recursive: true });
  const kp = keyPair();
  const trustPath = path.join(dir, "founder.pub.json");
  writeFileSync(trustPath, JSON.stringify({
    schema: "ngl.founder-trust-anchor.v1", status: "ENROLLED", enrolled: true, mode: "TEST_ONLY",
    public_key_jwk: kp.jwk, fingerprint: kp.fingerprint,
  }));
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"], expires_at: future,
  });
  const valid = signPayload(kp.privateKey, payload, kp.fingerprint);
  const malformed = [
    { label: "absent", signed: Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "nonce")) },
    { label: "empty", signed: { ...valid, nonce: "" } },
    { label: "31-character", signed: { ...valid, nonce: "a".repeat(31) } },
    { label: "uppercase", signed: { ...valid, nonce: "A".repeat(32) } },
    { label: "non-hex", signed: { ...valid, nonce: "g".repeat(32) } },
  ];
  const consumed = new Set();
  for (const item of malformed) {
    const verification = verifyFounderDecision({
      signed: item.signed,
      payload,
      public_key_jwk: kp.jwk,
      expected_fingerprint: kp.fingerprint,
      consumed_nonces: consumed,
    });
    assert.deepEqual(verification, { valid: false, reason: "NONCE_INVALID" }, item.label);
    assert.throws(
      () => authorizationEvent({ signed: item.signed, payload, trustPath, consumed_nonces: consumed }),
      /FOUNDER_DECISION_INVALID:NONCE_INVALID/,
      item.label,
    );
    assert.equal(consumed.size, 0, item.label + " must not mutate replay state");
  }
  rmSync(dir, { recursive: true, force: true });
});

test("changing a nonce after signing invalidates the captured signature before replay state mutation", () => {
  const dir = path.join(tmpdir(), "ngl-auth-nonce-substitution-" + process.pid);
  mkdirSync(dir, { recursive: true });
  try {
    const kp = keyPair();
    const trustPath = path.join(dir, "founder.pub.json");
    writeFileSync(trustPath, JSON.stringify({
      schema: "ngl.founder-trust-anchor.v1", status: "ENROLLED", enrolled: true, mode: "TEST_ONLY",
      public_key_jwk: kp.jwk, fingerprint: kp.fingerprint,
    }));
    const payload = makeDecisionPayload({
      proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"], expires_at: future,
    });
    const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
    const replacementNonce = signed.nonce === "a".repeat(32) ? "b".repeat(32) : "a".repeat(32);
    const substituted = { ...signed, nonce: replacementNonce };
    const consumed = new Set([signed.nonce]);

    assert.deepEqual(verifyFounderDecision({
      signed: substituted,
      payload,
      public_key_jwk: kp.jwk,
      expected_fingerprint: kp.fingerprint,
      consumed_nonces: consumed,
    }), { valid: false, reason: "SIGNATURE_INVALID" });
    assert.throws(
      () => authorizationEvent({ signed: substituted, payload, trustPath, consumed_nonces: consumed }),
      /FOUNDER_DECISION_INVALID:SIGNATURE_INVALID/
    );
    assert.deepEqual([...consumed], [signed.nonce],
      "a substituted nonce must not be accepted or added to replay state");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy payload-only signatures are rejected because their nonce is not signed", () => {
  const kp = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"], expires_at: future,
  });
  const legacy = {
    payload_sha256: decisionDigest(payload),
    key_fingerprint: kp.fingerprint,
    signature: sign("sha256", Buffer.from(canonical(payload)), kp.privateKey).toString("base64url"),
    nonce: newNonce(),
  };
  assert.deepEqual(verifyFounderDecision({
    signed: legacy,
    payload,
    public_key_jwk: kp.jwk,
    expected_fingerprint: kp.fingerprint,
  }), { valid: false, reason: "SIGNED_SCHEMA_INVALID" });
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

test("loadTrustAnchor rejects ambiguous or malformed enrolled trust state", () => {
  const dir = path.join(tmpdir(), "ngl-auth-anchor-shape-" + process.pid);
  mkdirSync(dir, { recursive: true });
  try {
    const kp = keyPair();
    const valid = {
      schema: "ngl.founder-trust-anchor.v1",
      status: "ENROLLED",
      enrolled: true,
      mode: "TEST_ONLY",
      public_key_jwk: kp.jwk,
      fingerprint: kp.fingerprint,
    };
    const malformed = [
      ["candidate status", { ...valid, status: "CANDIDATE" }, "TRUST_ANCHOR_STATE_INVALID"],
      ["missing enrollment flag", { ...valid, enrolled: undefined }, "TRUST_ANCHOR_STATE_INVALID"],
      ["missing schema", Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "schema")), "MALFORMED_TRUST_ANCHOR"],
      ["unknown mode", { ...valid, mode: "STAGING" }, "MALFORMED_TRUST_ANCHOR"],
      ["missing mode", { ...valid, mode: undefined }, "MALFORMED_TRUST_ANCHOR"],
      ["private key material", { ...valid, public_key_jwk: { ...kp.jwk, d: "A".repeat(43) } }, "MALFORMED_TRUST_ANCHOR"],
      ["unsupported curve", { ...valid, public_key_jwk: { ...kp.jwk, crv: "P-384" } }, "MALFORMED_TRUST_ANCHOR"],
      ["malformed coordinate", { ...valid, public_key_jwk: { ...kp.jwk, x: "!" } }, "MALFORMED_TRUST_ANCHOR"],
      ["fingerprint mismatch", { ...valid, fingerprint: "0".repeat(64) }, "MALFORMED_TRUST_ANCHOR"],
    ];
    for (const [index, [label, anchor, reason]] of malformed.entries()) {
      const trustPath = path.join(dir, `anchor-${index}.json`);
      writeFileSync(trustPath, JSON.stringify(anchor));
      const trust = loadTrustAnchor(trustPath);
      assert.equal(trust.enrolled, false, label);
      assert.equal(trust.reason, reason, label);
      assert.equal(Object.hasOwn(trust, "meta"), false, label + " must not return untrusted key material");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("receipt chain links prevHash", () => {
  const a = linkReceipt({ prevHash: null, payload: { x: 1 }, signed: { s: 1 } });
  const b = linkReceipt({ prevHash: a.blockHash, payload: { x: 2 }, signed: { s: 2 } });
  assert.equal(b.prevHash, a.blockHash);
  assert.notEqual(a.blockHash, b.blockHash);
});
