import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { makeReceipt } from "../src/evidence/content-addressed.js";
import { canonicalStringify } from "../src/institution/kernel.mjs";
import { projectWorld } from "../src/world/project.js";
import { createObservationVerifier, observationKeyFingerprint } from "../src/world/observation-attestation.js";

const artifact = Buffer.from("externally observed artifact bytes");
const event = {
  event_id: "signed-observation-1",
  event_type: "SYSTEM_EVENT",
  subject: "forge-gate",
  grant_id: "g1",
  observer_id: "external-observer-1",
  admission: "ACCEPTED",
  authority: "AUTHORIZED",
  execution: "EXECUTED",
  evidence: "OBSERVED",
  observation_verification: "VERIFIED",
  outcome: "SUCCEEDED",
  receipts: [makeReceipt(artifact)],
  world_effect: { xp: 25, inventory: { verified_shard: 1 } }
};

function keyPair() {
  return generateKeyPairSync("ed25519");
}
function publicPem(pair) {
  return pair.publicKey.export({ type: "spki", format: "pem" });
}
function attest(unsignedEvent, pair, fingerprint) {
  const signature = sign(null, Buffer.from(canonicalStringify(unsignedEvent), "utf8"), pair.privateKey).toString("base64url");
  return {
    ...unsignedEvent,
    observation_attestation: {
      schema: "ngl.observation-attestation.v1",
      algorithm: "Ed25519",
      keyFingerprint: fingerprint,
      signature
    }
  };
}
function project(signedEvent, verifyObservation, verifyAuthorization) {
  return projectWorld([signedEvent], undefined, { resolveArtifact: () => artifact, verifyObservation, verifyAuthorization });
}
const verifyAuthorization = event => event?.grant_id === "g1" && event?.authority === "AUTHORIZED";

test("pinned Ed25519 observer signature permits the exact signed event to project", () => {
  const pair = keyPair();
  const publicKey = publicPem(pair);
  const fingerprint = observationKeyFingerprint(publicKey);
  const verifyObservation = createObservationVerifier({ publicKey, expectedFingerprint: fingerprint, observerId: "external-observer-1" });
  const signed = attest(event, pair, fingerprint);
  assert.equal(verifyObservation(signed), true);
  const state = project(signed, verifyObservation, verifyAuthorization);
  assert.equal(state.xp, 25);
  assert.equal(state.inventory.verified_shard, 1);
  assert.equal(projectWorld([signed], undefined, { resolveArtifact: () => artifact, verifyObservation }).xp, 0,
    "a valid observer signature cannot replace a separate authorization verifier");
});

test("changing a consequence after signing invalidates the observation attestation", () => {
  const pair = keyPair();
  const publicKey = publicPem(pair);
  const fingerprint = observationKeyFingerprint(publicKey);
  const verifyObservation = createObservationVerifier({ publicKey, expectedFingerprint: fingerprint, observerId: "external-observer-1" });
  const signed = attest(event, pair, fingerprint);
  const tampered = { ...signed, world_effect: { ...signed.world_effect, xp: 999999 } };
  assert.equal(verifyObservation(tampered), false);
  assert.equal(project(tampered, verifyObservation, verifyAuthorization).xp, 0);
});

test("missing, malformed, wrong-key and wrong-observer attestations fail closed", () => {
  const trusted = keyPair();
  const untrusted = keyPair();
  const publicKey = publicPem(trusted);
  const fingerprint = observationKeyFingerprint(publicKey);
  const verifyObservation = createObservationVerifier({ publicKey, expectedFingerprint: fingerprint, observerId: "external-observer-1" });

  assert.equal(verifyObservation(event), false);
  const wrongObserver = { ...event, observer_id: "spoofed-observer" };
  assert.equal(verifyObservation(attest(wrongObserver, trusted, fingerprint)), false);
  assert.equal(verifyObservation(attest(event, untrusted, fingerprint)), false);

  const malformed = attest(event, trusted, fingerprint);
  malformed.observation_attestation.signature = "A";
  assert.equal(verifyObservation(malformed), false);
});

test("verifier startup rejects a public key that does not match the host-pinned fingerprint", () => {
  const trusted = keyPair();
  const other = keyPair();
  assert.throws(
    () => createObservationVerifier({
      publicKey: publicPem(trusted),
      expectedFingerprint: observationKeyFingerprint(publicPem(other)),
      observerId: "external-observer-1"
    }),
    /OBSERVATION_TRUST_FINGERPRINT_MISMATCH/
  );
});

test("verifier startup requires an explicit observer identity", () => {
  const pair = keyPair();
  const publicKey = publicPem(pair);
  assert.throws(
    () => createObservationVerifier({
      publicKey,
      expectedFingerprint: observationKeyFingerprint(publicKey)
    }),
    /OBSERVATION_IDENTITY_REQUIRED/
  );
});


test("attestation envelope rejects extra metadata and algorithm downgrade", () => {
  const pair = keyPair();
  const publicKey = publicPem(pair);
  const fingerprint = observationKeyFingerprint(publicKey);
  const verifyObservation = createObservationVerifier({ publicKey, expectedFingerprint: fingerprint, observerId: "external-observer-1" });
  const signed = attest(event, pair, fingerprint);
  assert.equal(verifyObservation({ ...signed, observation_attestation: { ...signed.observation_attestation, extra: "not-signed-schema" } }), false);
  assert.equal(verifyObservation({ ...signed, observation_attestation: { ...signed.observation_attestation, algorithm: "RSA" } }), false);
});
