import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createHash, generateKeyPairSync, sign, webcrypto } from "node:crypto";
import { defineQuest } from "../src/quest/engine.js";
import { proposeGuildAction } from "../src/world/guild-hall.js";
import {
  makeDecisionPayload,
  decisionDigest,
  verifyFounderDecision,
  authorizationEvent,
  authorizationEventFromEnvelope,
  verifyAuthorizationEvent,
  createFounderAuthorizationVerifier
} from "../src/authority/decision.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" });
const audience = "ngl-alpha-1-test";
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
  audience,
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
    signature: sign("sha256", Buffer.from(canonical(value)), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")
  };
}
const signed = signedReceipt(payload);
const verify = (receipt = signed, value = payload, key = jwk, pin = fingerprint) =>
  verifyFounderDecision({
    signed: receipt,
    payload: value,
    public_key_jwk: key,
    expected_fingerprint: pin,
    expected_audience: audience
  });

test("audience-bound decisions use schema v2 and reject legacy v1 payloads", () => {
  assert.equal(payload.schema, "ngl.founder-decision.v2");
  const legacyPayload = { ...payload, schema: "ngl.founder-decision.v1" };
  const legacyReceipt = signedReceipt(legacyPayload);
  assert.deepEqual(verify(legacyReceipt, legacyPayload), {
    valid: false,
    reason: "DECISION_PAYLOAD_INVALID"
  });
});

test("browser WebCrypto P-256 signatures verify with the Founder decision wire format", async () => {
  const pair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  );
  const exported = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  const publicKeyJwk = { kty: exported.kty, crv: exported.crv, x: exported.x, y: exported.y };
  const spki = Buffer.from(await webcrypto.subtle.exportKey("spki", pair.publicKey));
  const browserFingerprint = createHash("sha256").update(spki).digest("hex");
  const value = makePayload();
  const signature = Buffer.from(await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    Buffer.from(canonical(value))
  ));
  assert.equal(signature.length, 64);
  const receipt = {
    payload_sha256: decisionDigest(value),
    key_fingerprint: browserFingerprint,
    signature: signature.toString("base64url")
  };
  assert.deepEqual(verifyFounderDecision({
    signed: receipt,
    payload: value,
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: browserFingerprint,
    expected_audience: audience
  }), { valid: true, reason: null });
});

test("DER-encoded P-256 signatures are rejected at the browser wire boundary", () => {
  const derSignature = sign("sha256", Buffer.from(canonical(payload)), privateKey);
  assert.notEqual(derSignature.length, 64);
  assert.deepEqual(verify({ ...signed, signature: derSignature.toString("base64url") }), {
    valid: false,
    reason: "SIGNATURE_INVALID"
  });
});

test("Founder signing page emits the verifier-compatible v2 envelope", async () => {
  const html = await readFile(new URL("../authority/index.html", import.meta.url), "utf8");
  assert.ok(html.includes("ngl.founder-decision.v2"));
  assert.ok(html.includes("exportKey('spki',publicKey)"));
  assert.ok(html.includes("signature.length!==64"));
  assert.ok(html.includes("schema:'ngl.agp.founder-decision-envelope.v2'"));
  assert.ok(html.includes("payload_sha256:digest,key_fingerprint:fingerprint,signature:b64url(signature)"));
});

test("browser-exported Founder decision envelopes verify and build canonical authorization events", () => {
  const trust = {
    public_key_jwk: jwk,
    expected_fingerprint: fingerprint,
    expected_audience: audience
  };
  const envelope = {
    schema: "ngl.agp.founder-decision-envelope.v2",
    payload,
    signed
  };
  const event = authorizationEventFromEnvelope({ envelope, ...trust });
  assert.equal(event.type, "QUEST_AUTHORIZED");
  assert.equal(event.proposal_id, payload.proposal_id);
  assert.equal(event.grant_id, signed.payload_sha256);
  assert.equal(verifyAuthorizationEvent(event, trust), true);
});

test("Founder envelope verification rejects tampering, extra fields, and accessors", () => {
  const trust = {
    public_key_jwk: jwk,
    expected_fingerprint: fingerprint,
    expected_audience: audience
  };
  const envelope = {
    schema: "ngl.agp.founder-decision-envelope.v2",
    payload,
    signed
  };
  assert.throws(
    () => authorizationEventFromEnvelope({
      envelope: { ...envelope, payload: { ...payload, outputs: ["substituted"] } },
      ...trust
    }),
    /FOUNDER_DECISION_PAYLOAD_DIGEST_MISMATCH/
  );
  assert.throws(
    () => authorizationEventFromEnvelope({ envelope: { ...envelope, extra: true }, ...trust }),
    /FOUNDER_ENVELOPE_INVALID/
  );

  let getterCalls = 0;
  const accessorEnvelope = { schema: envelope.schema, payload, signed };
  Object.defineProperty(accessorEnvelope, "signed", {
    enumerable: true,
    get() { getterCalls += 1; return signed; }
  });
  assert.throws(
    () => authorizationEventFromEnvelope({ envelope: accessorEnvelope, ...trust }),
    /FOUNDER_ENVELOPE_INVALID/
  );
  assert.equal(getterCalls, 0);
  assert.throws(
    () => authorizationEventFromEnvelope({ envelope, ...trust, verification: { valid: true } }),
    /FOUNDER_ENVELOPE_INVALID/
  );
});

test("verification requires a host-pinned audience and rejects mismatches", () => {
  assert.deepEqual(verifyFounderDecision({
    signed, payload, public_key_jwk: jwk, expected_fingerprint: fingerprint
  }), {
    valid: false,
    reason: "VERIFICATION_INPUT_INVALID"
  });
  assert.deepEqual(verifyFounderDecision({
    signed, payload, public_key_jwk: jwk, expected_fingerprint: fingerprint,
    expected_audience: "ngl-alpha-1-other"
  }), {
    valid: false,
    reason: "AUDIENCE_MISMATCH"
  });
});

test("mutating global Date.now cannot revive an expired decision", () => {
  const expiredPayload = makePayload({ expires_at: "1970-01-01T00:00:00.001Z" });
  const expiredSigned = signedReceipt(expiredPayload);
  const expiredEvent = {
    event_id: "authorize:" + expiredPayload.proposal_id + ":" + expiredSigned.payload_sha256,
    type: "QUEST_AUTHORIZED",
    quest_id: expiredPayload.quest_id,
    audience: expiredPayload.audience,
    proposal_id: expiredPayload.proposal_id,
    grant_id: expiredSigned.payload_sha256,
    actor: "founder",
    capabilities: expiredPayload.capabilities,
    outputs: expiredPayload.outputs,
    acceptance: expiredPayload.acceptance,
    expires_at: expiredPayload.expires_at,
    key_fingerprint: expiredSigned.key_fingerprint,
    signature: expiredSigned.signature
  };
  const trust = {
    public_key_jwk: jwk,
    expected_fingerprint: fingerprint,
    expected_audience: audience
  };
  const hostVerifier = createFounderAuthorizationVerifier(trust);
  const realNow = Date.now;
  try {
    Date.now = () => 0;
    assert.deepEqual(verify(expiredSigned, expiredPayload), {
      valid: false,
      reason: "DECISION_EXPIRED"
    });
    assert.equal(verifyAuthorizationEvent(expiredEvent, trust), false);
    assert.equal(hostVerifier(expiredEvent), false);
  } finally {
    Date.now = realNow;
  }
});

test("public decision verifier rejects caller-controlled clock overrides", () => {
  assert.deepEqual(verifyFounderDecision({
    signed,
    payload,
    public_key_jwk: jwk,
    expected_fingerprint: fingerprint,
    expected_audience: audience,
    now: 0
  }), {
    valid: false,
    reason: "VERIFICATION_INPUT_INVALID"
  });
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
  const expiredPayload = makePayload({ expires_at: "1970-01-01T00:00:00.001Z" });
  const expiredSigned = signedReceipt(expiredPayload);
  assert.deepEqual(verify(expiredSigned, expiredPayload), {
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

test("a decision verified before expiry cannot authorize after its expiry", async () => {
  const expires_at = new Date(Date.now() + 1200).toISOString();
  const expiringPayload = makePayload({ expires_at });
  const expiringSigned = signedReceipt(expiringPayload);
  const verification = verify(expiringSigned, expiringPayload, jwk, fingerprint);
  assert.equal(verification.valid, true);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(expires_at) - Date.now() + 10)));
  assert.throws(
    () => authorizationEvent({ signed: expiringSigned, payload: expiringPayload, verification }),
    /verified Founder decision required/
  );
});

test("decision identifiers reject prototype-sensitive names", () => {
  assert.throws(
    () => makePayload({ proposal: { ...proposal, event_id: "constructor" } }),
    /proposal required/
  );

  const reservedQuest = { ...quest, quest_id: "prototype" };
  const reservedProposal = { ...proposal, quest_id: "prototype" };
  assert.throws(
    () => makePayload({ proposal: reservedProposal, quest: reservedQuest }),
    /quest binding mismatch/
  );

  const unsafePayload = { ...payload, quest_id: "constructor" };
  assert.deepEqual(verify(signedReceipt(unsafePayload), unsafePayload), {
    valid: false,
    reason: "DECISION_PAYLOAD_INVALID"
  });

  // Every inherited Object.prototype name is unsafe as a projection key,
  // including methods beyond constructor/prototype.
  for (const inheritedName of Object.getOwnPropertyNames(Object.prototype)) {
    assert.throws(
      () => makePayload({ proposal: { ...proposal, event_id: inheritedName } }),
      /proposal required/,
      "proposal IDs must reject inherited property name " + inheritedName
    );
    const inheritedQuest = { ...quest, quest_id: inheritedName };
    const inheritedProposal = { ...proposal, quest_id: inheritedName };
    assert.throws(
      () => makePayload({ proposal: inheritedProposal, quest: inheritedQuest }),
      /quest binding mismatch/,
      "quest IDs must reject inherited property name " + inheritedName
    );
  }
});

test("verification bounds canonical P-256 DER signature receipts", () => {
  // A valid P-256 DER signature is at most 72 bytes / 96 unpadded base64url chars.
  assert.ok(signed.signature.length <= 96);
  assert.ok(Buffer.from(signed.signature, "base64url").length <= 72);
  assert.equal(verify().valid, true);

  assert.deepEqual(verify({ ...signed, signature: "A".repeat(97) }), {
    valid: false,
    reason: "SIGNATURE_INVALID"
  });
});

test("decision creation rejects accessor-backed proposal and quest bindings", () => {
  const accessorProposal = { ...proposal };
  Object.defineProperty(accessorProposal, "event_id", {
    configurable: true,
    enumerable: true,
    get() { return proposal.event_id; }
  });
  assert.throws(() => makePayload({ proposal: accessorProposal }), /proposal required/);

  const accessorQuest = { ...quest };
  Object.defineProperty(accessorQuest, "quest_id", {
    configurable: true,
    enumerable: true,
    get() { return quest.quest_id; }
  });
  assert.throws(() => makePayload({ quest: accessorQuest }), /quest binding mismatch/);
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

test("authorizationEvent emits only the immutable snapshot sealed by verification", () => {
  const verification = verify();
  const payloadProxy = new Proxy(payload, {
    get(target, property, receiver) {
      if (property === "outputs") return ["repository.admin"];
      return Reflect.get(target, property, receiver);
    }
  });
  const signedProxy = new Proxy(signed, {
    get(target, property, receiver) {
      if (property === "key_fingerprint") return "0".repeat(64);
      return Reflect.get(target, property, receiver);
    }
  });

  const event = authorizationEvent({ signed: signedProxy, payload: payloadProxy, verification });
  assert.deepEqual(event.outputs, ["mesh"]);
  assert.equal(event.key_fingerprint, fingerprint);
  assert.equal(event.grant_id, signed.payload_sha256);
  assert.equal(Object.isFrozen(event.outputs), true);
  assert.throws(() => event.outputs.push("repository.admin"), TypeError);
});

test("authorizationEvent rejects accessor-backed replacement payloads", () => {
  const verification = verify();
  const accessorPayload = { ...payload };
  Object.defineProperty(accessorPayload, "outputs", {
    configurable: true,
    enumerable: true,
    get() { return ["repository.admin"]; }
  });
  assert.throws(
    () => authorizationEvent({ signed, payload: accessorPayload, verification }),
    /verified Founder decision required/
  );
});


test("decision scope cannot expand capabilities or weaken quest acceptance", () => {
  assert.throws(
    () => makePayload({ capabilities: ["repository.admin"] }),
    /decision capabilities must match proposal request/
  );
  assert.throws(
    () => makePayload({
      proposal: { ...proposal, capability: "repository.admin" },
      capabilities: ["repository.admin"]
    }),
    /decision capabilities exceed quest scope/
  );
  assert.throws(
    () => makePayload({ acceptance: ["mesh-optional"] }),
    /decision acceptance must preserve quest acceptance/
  );
  assert.throws(
    () => makePayload({ acceptance: ["mesh", "extra"] }),
    /decision acceptance must preserve quest acceptance/
  );
  assert.doesNotThrow(() => makePayload({
    capabilities: ["repository.write"],
    acceptance: ["mesh"]
  }));
});

test("decision scope reads only own data properties from the quest contract", () => {
  const accessorQuest = { ...quest };
  let getterRuns = 0;
  Object.defineProperty(accessorQuest, "capabilities", {
    configurable: true,
    enumerable: true,
    get() { getterRuns += 1; return ["repository.write"]; }
  });
  assert.throws(
    () => makePayload({ quest: accessorQuest }),
    /quest binding mismatch/
  );
  assert.equal(getterRuns, 0, "quest scope getters must not execute");
});


test("verification rejects accessor-backed public JWKs without executing getters", () => {
  const accessorJwk = { ...jwk };
  let getterRuns = 0;
  Object.defineProperty(accessorJwk, "x", {
    configurable: true,
    enumerable: true,
    get() { getterRuns += 1; return jwk.x; }
  });
  assert.deepEqual(verify(signed, payload, accessorJwk), {
    valid: false,
    reason: "SIGNATURE_INVALID"
  });
  assert.equal(getterRuns, 0);
});

test("verification accepts only canonical public P-256 JWK coordinates", () => {
  for (const invalidJwk of [
    { ...jwk, crv: "P-384" },
    { ...jwk, d: "private-key-material" },
    { ...jwk, x: "not-canonical-base64url" }
  ]) {
    assert.deepEqual(verify(signed, payload, invalidJwk), {
      valid: false,
      reason: "SIGNATURE_INVALID"
    });
  }
});


test("decision cannot silently expand the capability requested by its proposal", () => {
  const broaderQuest = defineQuest({
    quest_id: "q1",
    title: "Alpha",
    objective: "Build",
    acceptance: ["mesh"],
    capabilities: ["repository.write", "repository.admin"]
  });
  assert.throws(
    () => makePayload({ quest: broaderQuest, capabilities: ["repository.admin"] }),
    /decision capabilities must match proposal request/
  );
  assert.throws(
    () => makePayload({ capabilities: ["repository.write", "repository.admin"] }),
    /decision capabilities must match proposal request/
  );
});

test("proposal capability is snapshotted as an own data property", () => {
  const accessorProposal = { ...proposal };
  let getterRuns = 0;
  Object.defineProperty(accessorProposal, "capability", {
    configurable: true,
    enumerable: true,
    get() { getterRuns += 1; return "repository.write"; }
  });
  assert.throws(
    () => makePayload({ proposal: accessorProposal }),
    /proposal required/
  );
  assert.equal(getterRuns, 0);
});


test("public decision APIs reject accessor-backed call envelopes without running getters", () => {
  let getterCalls = 0;
  const decisionArgs = {
    proposal, quest,
    capabilities: ["repository.write"],
    outputs: ["mesh"],
    acceptance: ["mesh"],
    expires_at: "2099-01-01T00:00:00.000Z",
    audience
  };
  Object.defineProperty(decisionArgs, "proposal", {
    enumerable: true,
    get() { getterCalls += 1; return proposal; }
  });
  assert.throws(() => makeDecisionPayload(decisionArgs), /own data properties/);

  const verificationArgs = {
    signed, payload, public_key_jwk: jwk, expected_fingerprint: fingerprint, expected_audience: audience
  };
  Object.defineProperty(verificationArgs, "payload", {
    enumerable: true,
    get() { getterCalls += 1; return payload; }
  });
  assert.equal(verifyFounderDecision(verificationArgs).valid, false);

  const verification = verify();
  const eventArgs = { signed, payload, verification };
  Object.defineProperty(eventArgs, "signed", {
    enumerable: true,
    get() { getterCalls += 1; return signed; }
  });
  assert.throws(() => authorizationEvent(eventArgs), /verified Founder decision required/);

  const event = authorizationEvent({ signed, payload, verification });
  const trustOptions = { public_key_jwk: jwk, expected_fingerprint: fingerprint, expected_audience: audience };
  Object.defineProperty(trustOptions, "public_key_jwk", {
    enumerable: true,
    get() { getterCalls += 1; return jwk; }
  });
  assert.equal(verifyAuthorizationEvent(event, trustOptions), false);
  assert.throws(() => createFounderAuthorizationVerifier(trustOptions), /FOUNDER_TRUST_CONFIGURATION_INVALID/);
  assert.equal(getterCalls, 0, "call-envelope getters must not execute");
});


test("decisionDigest preserves canonical key ordering and rejects accessor-backed values without invoking them", () => {
  assert.equal(decisionDigest({ a: 1, b: [true, "x"] }), decisionDigest({ b: [true, "x"], a: 1 }));

  let getterCalls = 0;
  const accessorBacked = {};
  Object.defineProperty(accessorBacked, "payload", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "attacker-controlled";
    }
  });
  assert.throws(() => decisionDigest(accessorBacked), /own enumerable data properties/);
  assert.equal(getterCalls, 0);
});

test("decisionDigest rejects sparse arrays, cycles, non-finite numbers, and unbounded nesting", () => {
  const sparse = new Array(1);
  assert.throws(() => decisionDigest({ scope: sparse }), /dense/);

  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => decisionDigest(cyclic), /cycles/);

  assert.throws(() => decisionDigest({ amount: Number.POSITIVE_INFINITY }), /finite/);

  let nested = "leaf";
  for (let index = 0; index < 66; index += 1) nested = { next: nested };
  assert.throws(() => decisionDigest(nested), /structural limits/);
});


test("decisionDigest rejects hidden properties and enforces the byte budget", () => {
  // Pin the pre-existing wire representation so structural accounting does not
  // silently change the bytes that valid decisions sign.
  assert.equal(
    decisionDigest({ a: 1, b: [true, "x"] }),
    "63e8063d9dc6f0fd5a24b4706818a165fd57c3531b74466cf5dea62bff09b0b6"
  );

  const symbolBacked = { visible: true };
  symbolBacked[Symbol("hidden")] = "not represented by JSON keys";
  assert.throws(() => decisionDigest(symbolBacked), /own enumerable data properties/);

  const nonEnumerable = {};
  Object.defineProperty(nonEnumerable, "hidden", { value: "not represented by JSON keys" });
  assert.throws(() => decisionDigest(nonEnumerable), /own enumerable data properties/);

  assert.throws(
    () => decisionDigest({ text: "x".repeat(1024 * 1024) }),
    /byte limit/
  );

  // 9,999 values fit the node limit, and their value bytes alone fit the old
  // accounting. Delimiters and separators push the actual canonical bytes
  // over 1 MiB, so the complete representation must be rejected.
  const structuralBudgetAttack = Array.from({ length: 9999 }, () => "x".repeat(102));
  assert.throws(() => decisionDigest(structuralBudgetAttack), /byte limit/);

  // Exercise the object branch separately: the old counter included key/value
  // bytes but omitted each colon, comma, and the surrounding braces.
  const structuralObjectBudgetAttack = Object.fromEntries(
    Array.from({ length: 9999 }, (_, index) => [
      "k" + String(index).padStart(4, "0"),
      "x".repeat(95)
    ])
  );
  assert.throws(() => decisionDigest(structuralObjectBudgetAttack), /byte limit/);
});

test("persisted host verifier uses wall clock and rejects caller-controlled clock overrides", () => {
  const expiredPayload = makePayload({ expires_at: "1970-01-01T00:00:00.001Z" });
  const expiredSigned = signedReceipt(expiredPayload);
  const expiredEvent = Object.freeze({
    event_id: "authorize:" + expiredPayload.proposal_id + ":" + expiredSigned.payload_sha256,
    type: "QUEST_AUTHORIZED",
    quest_id: expiredPayload.quest_id,
    audience: expiredPayload.audience,
    proposal_id: expiredPayload.proposal_id,
    grant_id: expiredSigned.payload_sha256,
    actor: "founder",
    capabilities: expiredPayload.capabilities,
    outputs: expiredPayload.outputs,
    acceptance: expiredPayload.acceptance,
    expires_at: expiredPayload.expires_at,
    key_fingerprint: expiredSigned.key_fingerprint,
    signature: expiredSigned.signature
  });
  const options = {
    public_key_jwk: jwk,
    expected_fingerprint: fingerprint,
    expected_audience: audience
  };
  const hostVerifier = createFounderAuthorizationVerifier(options);
  assert.equal(hostVerifier(expiredEvent), false, "expired persisted decisions must fail at the host trust boundary");
  assert.equal(verifyAuthorizationEvent(expiredEvent, { ...options, now: 0 }), false,
    "the persisted-event API must not accept a caller-controlled clock");
});

test("browser signing page rejects identifiers rejected by the server verifier", async () => {
  const html = await readFile(new URL("../authority/index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "signing page must contain its inline script");
  const end = script.indexOf("function openDb()");
  assert.notEqual(end, -1, "signer validation helpers must precede storage initialization");

  const browser = {};
  runInNewContext(script.slice(0, end), browser);
  assert.equal(browser.isIdentifier("quest-alpha"), true);
  for (const reserved of ["constructor", "prototype", "toString", "__proto__"]) {
    assert.equal(browser.isIdentifier(reserved), false, `${reserved} must be rejected by the browser signer`);
  }
});

test("browser signer enforces a bounded, explicit local lease", async () => {
  const html = await readFile(new URL("../authority/index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "signing page must contain its inline script");
  const end = script.indexOf("function openDb()");
  assert.notEqual(end, -1, "signer validation helpers must precede storage initialization");

  const browser = {};
  runInNewContext(script.slice(0, end), browser);
  const now = Date.parse("2026-10-30T12:00:00.000Z");
  const valid = {
    schema: "ngl.agp.authority-lease.v1",
    subject: "Damien Featherstone",
    key_fingerprint: "a".repeat(64),
    issued_at: "2026-10-30T11:59:00.000Z",
    expires_at: "2026-10-30T12:59:00.000Z",
    max_duration_seconds: 3600,
    renewal: "EXPLICIT_ONLY",
    auto_renew: false
  };
  assert.equal(browser.isActiveLease(valid, valid.key_fingerprint, now), true);
  assert.equal(browser.isActiveLease({ ...valid, expires_at: "2026-10-30T13:00:00.000Z" }, valid.key_fingerprint, now), false,
    "lease duration must not exceed one hour");
  assert.equal(browser.isActiveLease({ ...valid, issued_at: "2026-10-30T12:01:00.000Z" }, valid.key_fingerprint, now), false,
    "future-issued leases must fail closed");
  assert.equal(browser.isActiveLease({ ...valid, expires_at: "2026-10-30T11:59:59.000Z" }, valid.key_fingerprint, now), false,
    "expired leases must fail closed");
  assert.equal(browser.isActiveLease({ ...valid, auto_renew: true }, valid.key_fingerprint, now), false,
    "automatic renewal must be rejected");
  assert.equal(browser.isActiveLease({ ...valid, extra: true }, valid.key_fingerprint, now), false,
    "unknown lease fields must be rejected");
  assert.equal(browser.isActiveLease(valid, "b".repeat(64), now), false,
    "the lease must remain bound to the current public-key fingerprint");
  assert.match(script, /if\(!isActiveLease\(l,fingerprint,now\)\)/,
    "signing must revalidate the lease at click time");
  assert.match(script, /active=has&&isActiveLease\(l,fingerprint,Date\.now\(\)\)/,
    "the UI must use the same lease predicate");
});
