import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalStringify } from "../src/institution/kernel.mjs";
import {
  canonicalAttestationPayload,
  createSignedEventVerifier,
  createWorldTrust,
  createWorldTrustFromEnv,
  worldTrustKeyFingerprint
} from "../src/world/signed-attestation.js";

const profile = {
  observation: { field: "observation_attestation", identityField: "observer_id", schema: "ngl.observation-attestation.v1" },
  authorization: { field: "authorization_attestation", identityField: "authorizer_id", schema: "ngl.authorization-attestation.v1" },
  adjudication: { field: "adjudication_attestation", identityField: "adjudicator_id", schema: "ngl.adjudication-attestation.v1" }
};

function key() {
  const pair = generateKeyPairSync("ed25519");
  return { ...pair, fingerprint: worldTrustKeyFingerprint(pair.publicKey) };
}

function setup(audience = "ngl-alpha1:world-1") {
  const observer = key(), authorizer = key(), adjudicator = key();
  const identities = { observation: "observer-A", authorization: "authorizer-A", adjudication: "adjudicator-A" };
  const config = {
    observation: { publicKey: observer.publicKey, expectedFingerprint: observer.fingerprint, expectedIdentity: identities.observation, expectedAudience: audience },
    authorization: { publicKey: authorizer.publicKey, expectedFingerprint: authorizer.fingerprint, expectedIdentity: identities.authorization, expectedAudience: audience },
    adjudication: { publicKey: adjudicator.publicKey, expectedFingerprint: adjudicator.fingerprint, expectedIdentity: identities.adjudication, expectedAudience: audience }
  };
  const event = {
    event_id: "event-1", audience, event_type: "EXECUTION_ADJUDICATION", subject: "forge-gate",
    admission: "ACCEPTED", authority: "AUTHORIZED", execution: "EXECUTED",
    evidence: "OBSERVED", observation_verification: "VERIFIED", outcome: "SUCCEEDED",
    grant_id: "grant-1", world_effect: { xp: 25, inventory: { shard: 1 } },
    observer_id: identities.observation, authorizer_id: identities.authorization,
    adjudicator_id: identities.adjudication
  };
  const pairs = { observation: observer, authorization: authorizer, adjudication: adjudicator };
  for (const role of Object.keys(profile)) {
    const payload = canonicalAttestationPayload(event);
    const signature = sign(null, payload, pairs[role].privateKey).toString("base64url");
    const spec = profile[role];
    event[spec.field] = {
      schema: spec.schema, algorithm: "Ed25519",
      keyFingerprint: pairs[role].fingerprint, signature
    };
  }
  return { config, event, observer, authorizer, adjudicator, identities };
}

test("three distinct host-pinned roles verify signatures over one common event payload", () => {
  const { config, event } = setup();
  const trust = createWorldTrust(config);
  assert.equal(trust.verifyObservation(event), true);
  assert.equal(trust.verifyAuthorization(event), true);
  assert.equal(trust.verifyAdjudication(event), true);
});

test("a valid signature cannot be replayed into a different configured audience", () => {
  const { config, event } = setup("institution-A");
  const verifierForOtherInstitution = createSignedEventVerifier({
    ...config.observation,
    expectedAudience: "institution-B"
  });
  assert.equal(createSignedEventVerifier(config.observation)(event), true);
  assert.equal(verifierForOtherInstitution(event), false);
});

test("changing a signed consequence invalidates every role attestation", () => {
  const { config, event } = setup();
  const trust = createWorldTrust(config);
  const changed = structuredClone(event);
  changed.world_effect.xp = 2500;
  assert.equal(trust.verifyObservation(changed), false);
  assert.equal(trust.verifyAuthorization(changed), false);
  assert.equal(trust.verifyAdjudication(changed), false);
});

test("a signature for one role cannot satisfy another role", () => {
  const { config, event } = setup();
  const verifier = createSignedEventVerifier({ role: "authorization", ...config.authorization });
  const forged = structuredClone(event);
  forged.authorization_attestation = structuredClone(forged.observation_attestation);
  assert.equal(verifier(forged), false);
});

test("wrong identity, key pin, schema, or non-canonical signature fails closed", () => {
  const { config, event } = setup();
  const trust = createWorldTrust(config);
  const wrongIdentity = structuredClone(event);
  wrongIdentity.observer_id = "model-claimed-observer";
  assert.equal(trust.verifyObservation(wrongIdentity), false);
  const wrongSchema = structuredClone(event);
  wrongSchema.observation_attestation.schema = "ngl.observation-attestation.v999";
  assert.equal(trust.verifyObservation(wrongSchema), false);
  const malformed = structuredClone(event);
  malformed.observation_attestation.signature += "=";
  assert.equal(trust.verifyObservation(malformed), false);
  assert.throws(() => createSignedEventVerifier({
    role: "observation", ...config.observation,
    expectedFingerprint: "0".repeat(64)
  }), /FINGERPRINT_MISMATCH/);
});

test("verification configuration refuses private key material", () => {
  const pair = generateKeyPairSync("ed25519");
  assert.throws(() => worldTrustKeyFingerprint(pair.privateKey), /PUBLIC_KEY_ONLY/);
  const pem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  assert.throws(() => worldTrustKeyFingerprint(pem), /PUBLIC_KEY_ONLY/);
});

test("world trust refuses missing or reused role roots", () => {
  const { config } = setup();
  assert.throws(() => createWorldTrust({ observation: config.observation }), /ROOTS_NOT_CONFIGURED/);
  assert.throws(() => createWorldTrust({
    observation: config.observation,
    authorization: { ...config.authorization, publicKey: config.observation.publicKey,
      expectedFingerprint: config.observation.expectedFingerprint },
    adjudication: config.adjudication
  }), /ROOTS_MUST_BE_DISTINCT/);
  assert.throws(() => createWorldTrust({
    ...config,
    authorization: { ...config.authorization, expectedAudience: "another-institution" }
  }), /ROOTS_AUDIENCE_MISMATCH/);
  assert.throws(() => createWorldTrustFromEnv({}), /ROOTS_NOT_CONFIGURED/);
});

test("environment loader pins all three roles to one explicit audience", () => {
  const { config, event, observer, authorizer, adjudicator } = setup("alpha1:world-B");
  const env = {
    NGL_OBSERVER_PUBLIC_KEY_PEM: observer.publicKey.export({ type: "spki", format: "pem" }),
    NGL_OBSERVER_KEY_SHA256: observer.fingerprint,
    NGL_OBSERVER_ID: config.observation.expectedIdentity,
    NGL_AUTHORIZER_PUBLIC_KEY_PEM: authorizer.publicKey.export({ type: "spki", format: "pem" }),
    NGL_AUTHORIZER_KEY_SHA256: authorizer.fingerprint,
    NGL_AUTHORIZER_ID: config.authorization.expectedIdentity,
    NGL_ADJUDICATOR_PUBLIC_KEY_PEM: adjudicator.publicKey.export({ type: "spki", format: "pem" }),
    NGL_ADJUDICATOR_KEY_SHA256: adjudicator.fingerprint,
    NGL_ADJUDICATOR_ID: config.adjudication.expectedIdentity,
    NGL_WORLD_TRUST_AUDIENCE: "alpha1:world-A"
  };
  const wrongWorld = createWorldTrustFromEnv(env);
  assert.equal(wrongWorld.verifyObservation(event), false);
  assert.equal(wrongWorld.verifyAuthorization(event), false);
  assert.equal(wrongWorld.verifyAdjudication(event), false);

  const correctWorld = createWorldTrustFromEnv({
    ...env,
    NGL_WORLD_TRUST_AUDIENCE: "alpha1:world-B"
  });
  assert.equal(correctWorld.verifyObservation(event), true);
  assert.equal(correctWorld.verifyAuthorization(event), true);
  assert.equal(correctWorld.verifyAdjudication(event), true);
});

test("canonical attestation payload ignores all three signature envelopes", () => {
  const { event } = setup();
  const before = canonicalAttestationPayload(event);
  const changedEnvelope = structuredClone(event);
  changedEnvelope.observation_attestation.signature = "A".repeat(86);
  changedEnvelope.authorization_attestation.signature = "B".repeat(86);
  changedEnvelope.adjudication_attestation.signature = "C".repeat(86);
  assert.deepEqual(canonicalAttestationPayload(changedEnvelope), before);
  assert.equal(canonicalStringify(JSON.parse(before.toString("utf8"))).length > 0, true);
});

test("hidden properties and accessors cannot be signed", () => {
  const hidden = { event_id: "hidden" };
  Object.defineProperty(hidden, "secret", { value: "not canonical", enumerable: false });
  assert.throws(() => canonicalAttestationPayload(hidden), /hidden or symbolic/);
  const accessor = {};
  Object.defineProperty(accessor, "event_id", { enumerable: true, get() { throw new Error("getter ran"); } });
  assert.throws(() => canonicalAttestationPayload(accessor), /accessor or hidden/);
});
