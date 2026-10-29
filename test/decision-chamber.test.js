import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { defineQuest } from "../src/quest/engine.js";
import { proposeGuildAction } from "../src/world/guild-hall.js";
import {
  makeDecisionPayload,
  decisionDigest,
  verifyFounderDecision,
  authorizationEvent
} from "../src/authority/decision.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" });
const fingerprint = createHash("sha256")
  .update(publicKey.export({ type: "spki", format: "der" }))
  .digest("hex");
const quest = defineQuest({
  quest_id: "q1",
  title: "Alpha",
  objective: "Build",
  acceptance: ["mesh"],
  capabilities: ["repository.write"]
});
const proposal = proposeGuildAction({
  quest_id: "q1",
  proposal_id: "p1",
  actor: "guild",
  summary: "Build Mesh",
  capability: "repository.write"
});
const makePayload = overrides => makeDecisionPayload({
  proposal,
  quest,
  capabilities: ["repository.write"],
  outputs: ["mesh"],
  acceptance: ["mesh"],
  expires_at: "2099-01-01T00:00:00.000Z",
  ...overrides
});
const payload = makePayload();
const canonical = value => Array.isArray(value)
  ? "[" + value.map(canonical).join(",") + "]"
  : value && typeof value === "object"
    ? "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}"
    : JSON.stringify(value);
function signedReceipt(value, key = privateKey, keyFingerprint = fingerprint) {
  return {
    payload_sha256: decisionDigest(value),
    key_fingerprint: keyFingerprint,
    signature: sign("sha256", Buffer.from(canonical(value)), key).toString("base64url")
  };
}
const signed = signedReceipt(payload);
const verify = (receipt = signed, value = payload, key = jwk, pin = fingerprint, now = 0) =>
  verifyFounderDecision({
    signed: receipt,
    payload: value,
    public_key_jwk: key,
    expected_fingerprint: pin,
    now
  });

test("the enrolled key authorizes the exact, unexpired decision", () => {
  const verification = verify();
  assert.deepEqual(verification, { valid: true, reason: null });
  assert.equal(authorizationEvent({ signed, payload, verification }).proposal_id, "p1");
});

test("changing capability after signature invalidates the ruling", () => {
  const changed = { ...payload, capabilities: ["repository.admin"] };
  assert.equal(verify(signed, changed).valid, false);
});

test("changing expected output after signature invalidates the ruling", () => {
  const changed = { ...payload, outputs: ["different-artifact"] };
  assert.equal(verify(signed, changed).valid, false);
});

test("an unenrolled fingerprint cannot exercise Founder authority", () => {
  assert.deepEqual(verify(signed, payload, jwk, "other"), {
    valid: false,
    reason: "KEY_NOT_ENROLLED"
  });
});

test("a supplied public key must actually match the enrolled fingerprint", () => {
  const attacker = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const attackerJwk = attacker.publicKey.export({ format: "jwk" });
  const attackerReceipt = signedReceipt(payload, attacker.privateKey, fingerprint);
  assert.deepEqual(verify(attackerReceipt, payload, attackerJwk, fingerprint), {
    valid: false,
    reason: "KEY_NOT_ENROLLED"
  });
});

test("an expired exact signature is not current authority", () => {
  assert.deepEqual(verify(signed, payload, jwk, fingerprint, Date.parse("2100-01-01T00:00:00.000Z")), {
    valid: false,
    reason: "DECISION_EXPIRED"
  });
});

test("non-canonical base64url signature encodings are rejected", () => {
  for (const suffix of ["!", "="]) {
    assert.deepEqual(verify({ ...signed, signature: signed.signature + suffix }), {
      valid: false,
      reason: "SIGNATURE_INVALID"
    });
  }
});

test("authorizationEvent rejects a caller-forged valid flag", () => {
  assert.throws(
    () => authorizationEvent({ signed, payload, verification: { valid: true } }),
    /verified Founder decision required/
  );
});

test("a verification result is bound to the exact payload and signed receipt", () => {
  const verification = verify();
  const changedPayload = { ...payload, outputs: ["different-artifact"] };
  const changedReceipt = { ...signed, signature: signed.signature + "x" };
  assert.throws(
    () => authorizationEvent({ signed, payload: changedPayload, verification }),
    /verified Founder decision required/
  );
  assert.throws(
    () => authorizationEvent({ signed: changedReceipt, payload, verification }),
    /verified Founder decision required/
  );
});

test("a decision verified before expiry cannot authorize after its expiry", () => {
  const expiringPayload = makePayload({ expires_at: "1970-01-01T00:00:00.001Z" });
  const expiringSigned = signedReceipt(expiringPayload);
  const verification = verify(expiringSigned, expiringPayload, jwk, fingerprint, 0);
  assert.equal(verification.valid, true);
  assert.throws(
    () => authorizationEvent({ signed: expiringSigned, payload: expiringPayload, verification }),
    /verified Founder decision required/
  );
});

test("verification rejects accessor-backed decision payloads and signed receipts", () => {
  const accessorPayload = { ...payload };
  Object.defineProperty(accessorPayload, "outputs", {
    configurable: true,
    enumerable: true,
    get() { return ["mesh"]; }
  });
  assert.deepEqual(verify(signed, accessorPayload), {
    valid: false,
    reason: "DECISION_PAYLOAD_INVALID"
  });

  const accessorReceipt = { ...signed };
  Object.defineProperty(accessorReceipt, "signature", {
    configurable: true,
    enumerable: true,
    get() { return signed.signature; }
  });
  assert.deepEqual(verify(accessorReceipt), {
    valid: false,
    reason: "SIGNATURE_INVALID"
  });
});

test("verification rejects extra receipt fields and inherited payload fields", () => {
  assert.deepEqual(verify({ ...signed, ignored: true }), {
    valid: false,
    reason: "SIGNATURE_INVALID"
  });
  const inheritedPayload = Object.assign(Object.create({ untrusted: true }), payload);
  assert.deepEqual(verify(signed, inheritedPayload), {
    valid: false,
    reason: "DECISION_PAYLOAD_INVALID"
  });
});

test("decision payloads require exact canonical UTC expiry timestamps", () => {
  for (const expires_at of [
    "2099-01-01",
    "2099-02-30T00:00:00.000Z",
    "2099-01-01T00:00:00Z",
    "01/01/2099",
    "2099-01-01T00:00:00.000+00:00"
  ]) {
    assert.throws(() => makePayload({ expires_at }), /canonical UTC expiry required/);
  }
});

test("decision scopes reject empty, duplicate, malformed and oversized values", () => {
  assert.throws(() => makePayload({ capabilities: [] }), /decision scope arrays/);
  assert.throws(() => makePayload({ outputs: ["mesh", "mesh"] }), /decision scope arrays/);
  assert.throws(() => makePayload({ acceptance: [""] }), /decision scope arrays/);
  assert.throws(() => makePayload({ capabilities: ["x".repeat(129)] }), /decision scope arrays/);
  assert.throws(() => makePayload({ outputs: Array.from({ length: 33 }, (_, i) => "output-" + i) }), /decision scope arrays/);
});

test("decision scopes reject sparse arrays and accessor-backed elements", () => {
  const sparse = new Array(1);
  assert.throws(() => makePayload({ capabilities: sparse }), /decision scope arrays/);

  const accessor = ["repository.write"];
  Object.defineProperty(accessor, "0", {
    configurable: true,
    enumerable: true,
    get() { return "repository.write"; }
  });
  assert.throws(() => makePayload({ outputs: accessor }), /decision scope arrays/);
});

test("verification independently rejects malformed expiry and scope even when signed", () => {
  const malformedExpiry = { ...payload, expires_at: "2099-01-01" };
  assert.deepEqual(verify(signedReceipt(malformedExpiry), malformedExpiry), {
    valid: false,
    reason: "DECISION_PAYLOAD_INVALID"
  });
  const malformedScope = { ...payload, outputs: ["mesh", "mesh"] };
  assert.deepEqual(verify(signedReceipt(malformedScope), malformedScope), {
    valid: false,
    reason: "DECISION_PAYLOAD_INVALID"
  });
});

test("payload scope arrays are frozen against post-construction mutation", () => {
  assert.equal(Object.isFrozen(payload.capabilities), true);
  assert.throws(() => payload.capabilities.push("repository.admin"), TypeError);
});
