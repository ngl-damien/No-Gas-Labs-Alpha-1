import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  makeDecisionPayload,
  decisionDigest,
  verifyFounderDecision,
  authorizationEvent,
  createFounderAuthorizationVerifier,
  verifyAuthorizationEvent
} from "../src/authority/decision.js";
import { defineQuest, projectQuest, QUEST_STATUS, authorizeQuest } from "../src/quest/engine.js";
import { projectWorld } from "../src/world/project.js";
import { proposeGuildAction } from "../src/world/guild-hall.js";

const audience = "ngl-alpha-1-test";

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicKeyJwk = publicKey.export({ format: "jwk" });
  const expectedFingerprint = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const quest = defineQuest({
    quest_id: "quest-alpha",
    title: "Alpha",
    objective: "Build the bounded collaboration bridge",
    acceptance: ["packet-review"],
    capabilities: ["repository.write"]
  });
  const proposal = proposeGuildAction({
    quest_id: "quest-alpha",
    proposal_id: "proposal-alpha",
    actor: "guild",
    summary: "Build the bounded collaboration bridge",
    capability: "repository.write"
  });
  const payload = makeDecisionPayload({
    proposal,
    quest,
    capabilities: ["repository.write"],
    outputs: ["handoff-packet"],
    acceptance: ["packet-review"],
    expires_at: "2099-01-01T00:00:00.000Z",
    audience
  });
  const canonical = value => Array.isArray(value)
    ? "[" + value.map(canonical).join(",") + "]"
    : value && typeof value === "object"
      ? "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}"
      : JSON.stringify(value);
  const signed = {
    payload_sha256: decisionDigest(payload),
    key_fingerprint: expectedFingerprint,
    signature: sign("sha256", Buffer.from(canonical(payload)), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")
  };
  const verification = verifyFounderDecision({
    signed, payload, public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: audience
  });
  assert.equal(verification.valid, true);
  const event = authorizationEvent({ signed, payload, verification });
  return { event, quest, publicKeyJwk, expectedFingerprint };
}

test("persisted Founder authorization event survives JSON round-trip and authorizes the real quest projection", () => {
  const { event, quest, publicKeyJwk, expectedFingerprint } = fixture();
  assert.equal(typeof event.signature, "string");
  const persistedEvent = JSON.parse(JSON.stringify(event));
  const verifyAuthorization = createFounderAuthorizationVerifier({
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: audience,
  });
  assert.equal(verifyAuthorization(persistedEvent), true);
  const worldProjection = projectWorld([persistedEvent], undefined, { verifyAuthorization });
  assert.equal(worldProjection.history.length, 1);
  assert.equal(worldProjection.xp, 0, "authorization alone must not mint world progress");
  assert.deepEqual(worldProjection.inventory, {});
  assert.deepEqual(worldProjection.world, {});
  const projection = projectQuest(quest, [persistedEvent], { verifyAuthorization });
  assert.equal(projection.status, QUEST_STATUS.AUTHORIZED);
  assert.equal(projection.authorized, true);
  assert.deepEqual(projection.executions, []);
});

test("signed authorization cannot be replayed or relabeled for another audience", () => {
  const { event, quest, publicKeyJwk, expectedFingerprint } = fixture();
  const otherAudience = "ngl-alpha-1-other";
  assert.equal(verifyAuthorizationEvent(event, {
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: otherAudience
  }), false);
  const otherVerifier = createFounderAuthorizationVerifier({
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: otherAudience
  });
  assert.equal(otherVerifier(event), false);

  // Simulate an attacker rewriting the persisted event's audience to match the
  // receiving institution. The unchanged signature and digest must still fail.
  const relabeledEvent = { ...event, audience: otherAudience };
  assert.equal(otherVerifier(relabeledEvent), false);
  assert.equal(verifyAuthorizationEvent(relabeledEvent, {
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: otherAudience
  }), false);

  const questProjection = projectQuest(quest, [relabeledEvent], { verifyAuthorization: otherVerifier });
  assert.equal(questProjection.status, QUEST_STATUS.OPEN);
  assert.equal(questProjection.authorized, false);
  assert.deepEqual(questProjection.executions, []);

  const worldProjection = projectWorld([relabeledEvent], undefined, { verifyAuthorization: otherVerifier });
  assert.equal(worldProjection.history.length, 1, "rejected authorization remains in retained history");
  assert.equal(worldProjection.xp, 0, "rejected authorization cannot mint progress");
  assert.deepEqual(worldProjection.inventory, {});
  assert.deepEqual(worldProjection.world, {});
});

test("tampered persisted decision fields cannot authorize a quest", () => {
  const { event, quest, publicKeyJwk, expectedFingerprint } = fixture();
  const verifyAuthorization = createFounderAuthorizationVerifier({
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: audience,
  });
  const tampered = { ...event, capabilities: ["repository.admin"] };
  assert.equal(verifyAuthorization(tampered), false);
  const projection = projectQuest(quest, [tampered], { verifyAuthorization });
  assert.equal(projection.status, QUEST_STATUS.OPEN);
  assert.equal(projection.authorized, false);
});

test("host verifier snapshots its configured public key and rejects a mismatched pin", () => {
  const { event, publicKeyJwk, expectedFingerprint } = fixture();
  const mutableJwk = { ...publicKeyJwk };
  const verifyAuthorization = createFounderAuthorizationVerifier({
    public_key_jwk: mutableJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: audience,
  });
  mutableJwk.x = "attacker-controlled-after-configuration";
  assert.equal(verifyAuthorization(event), true);
  assert.throws(() => createFounderAuthorizationVerifier({
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: "0".repeat(64),
    expected_audience: audience
  }), /FOUNDER_TRUST_FINGERPRINT_MISMATCH/);
});

test("host verifier refuses missing or malformed institution audience configuration", () => {
  const { publicKeyJwk, expectedFingerprint } = fixture();
  assert.throws(() => createFounderAuthorizationVerifier({
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint
  }), /FOUNDER_TRUST_CONFIGURATION_INVALID/);
  assert.throws(() => createFounderAuthorizationVerifier({
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: "x".repeat(129)
  }), /FOUNDER_TRUST_CONFIGURATION_INVALID/);
});

test("persisted authorization verifier rejects accessors without executing them", () => {
  const { event, publicKeyJwk, expectedFingerprint } = fixture();
  const verifyAuthorization = createFounderAuthorizationVerifier({
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: audience,
  });
  const hostile = { ...event };
  let getterCalls = 0;
  Object.defineProperty(hostile, "signature", {
    enumerable: true,
    configurable: true,
    get() { getterCalls += 1; return event.signature; }
  });
  assert.equal(verifyAuthorization(hostile), false);
  assert.equal(verifyAuthorizationEvent(hostile, {
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: audience,
  }), false);
  assert.equal(getterCalls, 0);
});

test("persisted authorization verifier rejects altered signatures", () => {
  const { event, publicKeyJwk, expectedFingerprint } = fixture();
  assert.equal(verifyAuthorizationEvent({ ...event, signature: event.signature + "x" }, {
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: audience
  }), false);
});


test("legacy self-asserted authorizeQuest output cannot pass the signed host verifier", () => {
  const { quest, publicKeyJwk, expectedFingerprint } = fixture();
  const verifyAuthorization = createFounderAuthorizationVerifier({
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: audience,
  });
  const forged = authorizeQuest({ quest, grant_id: "caller-invented-grant", actor: "founder" });
  assert.equal(verifyAuthorization(forged), false);
  const projection = projectQuest(quest, [forged], { verifyAuthorization });
  assert.equal(projection.status, QUEST_STATUS.OPEN);
  assert.equal(projection.authorized, false);
});

test("world and quest projections fail closed without a host authorization verifier", () => {
  const { quest } = fixture();
  const forged = authorizeQuest({
    quest,
    grant_id: "caller-invented-grant",
    actor: "founder"
  });

  const questProjection = projectQuest(quest, [forged]);
  assert.equal(questProjection.status, QUEST_STATUS.OPEN);
  assert.equal(questProjection.authorized, false);
  assert.deepEqual(questProjection.executions, []);

  const worldProjection = projectWorld([forged]);
  assert.equal(worldProjection.history.length, 1, "the rejected claim remains visible in history");
  assert.equal(worldProjection.xp, 0);
  assert.deepEqual(worldProjection.inventory, {});
  assert.deepEqual(worldProjection.world, {});
});
