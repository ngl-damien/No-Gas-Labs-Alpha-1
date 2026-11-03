import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { defineQuest } from "../src/quest/engine.js";
import { proposeGuildAction } from "../src/world/guild-hall.js";
import {
  makeDecisionPayload,
  decisionDigest,
  verifyFounderDecision,
  authorizationEvent,
  newNonce,
} from "../src/authority/decision.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" });
const fingerprint = createHash("sha256")
  .update(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }))
  .digest("hex");
const quest = defineQuest({
  quest_id: "q1", title: "Alpha", objective: "Build", acceptance: ["mesh"], capabilities: ["repository.write"],
});
const proposal = proposeGuildAction({
  quest_id: "q1", proposal_id: "p1", actor: "guild", summary: "Build Mesh", capability: "repository.write",
});
const payload = makeDecisionPayload({
  proposal, quest, capabilities: ["repository.write"], outputs: ["mesh"], acceptance: ["mesh"],
  expires_at: "2099-01-01T00:00:00.000Z",
});
const canonical = value => Array.isArray(value)
  ? "[" + value.map(canonical).join(",") + "]"
  : value && typeof value === "object"
    ? "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}"
    : JSON.stringify(value);
const signed = {
  payload_sha256: decisionDigest(payload),
  key_fingerprint: fingerprint,
  signature: sign("sha256", Buffer.from(canonical(payload)), privateKey).toString("base64url"),
  nonce: newNonce(),
};

test("cryptographic verification succeeds, but authorization remains closed until the Founder trust anchor is enrolled", () => {
  const verification = verifyFounderDecision({
    signed, payload, public_key_jwk: jwk, expected_fingerprint: fingerprint,
  });
  assert.equal(verification.valid, true);
  assert.throws(() => authorizationEvent({ signed, payload }), /FOUNDER_NOT_ENROLLED/);
});

test("changing capability after signature invalidates ruling", () => {
  const changed = { ...payload, capabilities: ["repository.admin"] };
  assert.equal(verifyFounderDecision({
    signed, payload: changed, public_key_jwk: jwk, expected_fingerprint: fingerprint,
  }).valid, false);
});

test("changing expected output after signature invalidates ruling", () => {
  const changed = { ...payload, outputs: ["different-artifact"] };
  assert.equal(verifyFounderDecision({
    signed, payload: changed, public_key_jwk: jwk, expected_fingerprint: fingerprint,
  }).valid, false);
});

test("unenrolled key cannot exercise Founder authority", () => {
  assert.deepEqual(verifyFounderDecision({
    signed, payload, public_key_jwk: jwk, expected_fingerprint: "0".repeat(64),
  }), { valid: false, reason: "KEY_NOT_ENROLLED" });
});

test("expired exact signature is still not current authority", () => {
  assert.deepEqual(verifyFounderDecision({
    signed, payload, public_key_jwk: jwk, expected_fingerprint: fingerprint,
    now: Date.parse("2100-01-01"),
  }), { valid: false, reason: "DECISION_EXPIRED" });
});
