import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { canonicalStringify } from "../institution/kernel.mjs";

const FINGERPRINT = /^[a-f0-9]{64}$/;
const ATTESTATION_SCHEMA = "ngl.observation-attestation.v1";
const ATTESTATION_KEYS = ["algorithm", "keyFingerprint", "schema", "signature"];

function ed25519PublicKey(publicKey) {
  if (publicKey == null) throw new Error("OBSERVATION_PUBLIC_KEY_REQUIRED");
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("OBSERVATION_KEY_MUST_BE_ED25519");
  return key;
}

function fingerprintKey(key) {
  return createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("hex");
}

export function observationKeyFingerprint(publicKey) {
  return fingerprintKey(ed25519PublicKey(publicKey));
}

/**
 * Build a fail-closed verifier from host-controlled trust configuration.
 * The private signing key must remain with the observer; it is never accepted here.
 * The signature binds the event, including its audience, except the attestation envelope.
 */
export function createObservationVerifier({ publicKey, expectedFingerprint, observerId, expectedAudience } = {}) {
  const key = ed25519PublicKey(publicKey);
  if (typeof expectedFingerprint !== "string" || !FINGERPRINT.test(expectedFingerprint)) {
    throw new Error("OBSERVATION_TRUST_FINGERPRINT_REQUIRED");
  }
  if (fingerprintKey(key) !== expectedFingerprint) {
    throw new Error("OBSERVATION_TRUST_FINGERPRINT_MISMATCH");
  }
  if (typeof observerId !== "string" || observerId.trim().length === 0) {
    throw new Error("OBSERVATION_IDENTITY_REQUIRED");
  }
  if (typeof expectedAudience !== "string" || expectedAudience.trim().length === 0) {
    throw new Error("OBSERVATION_AUDIENCE_REQUIRED");
  }

  return function verifyObservation(event) {
    if (!event || typeof event !== "object" || Array.isArray(event)) return false;
    if (event.observer_id !== observerId || event.audience !== expectedAudience) return false;

    const attestation = event.observation_attestation;
    if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) return false;
    if (Object.keys(attestation).sort().join(",") !== [...ATTESTATION_KEYS].sort().join(",")) return false;
    if (attestation.schema !== ATTESTATION_SCHEMA ||
        attestation.algorithm !== "Ed25519" ||
        attestation.keyFingerprint !== expectedFingerprint ||
        typeof attestation.signature !== "string") return false;

    let signature;
    let payload;
    try {
      signature = Buffer.from(attestation.signature, "base64url");
      if (signature.length !== 64 || signature.toString("base64url") !== attestation.signature) return false;
      const unsigned = structuredClone(event);
      delete unsigned.observation_attestation;
      payload = Buffer.from(canonicalStringify(unsigned), "utf8");
      return verifySignature(null, payload, key, signature);
    } catch {
      return false;
    }
  };
}
