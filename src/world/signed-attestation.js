import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { canonicalStringify } from "../institution/kernel.mjs";

const PROFILES = Object.freeze({
  observation: Object.freeze({
    field: "observation_attestation",
    identityField: "observer_id",
    schema: "ngl.observation-attestation.v1"
  }),
  authorization: Object.freeze({
    field: "authorization_attestation",
    identityField: "authorizer_id",
    schema: "ngl.authorization-attestation.v1"
  }),
  adjudication: Object.freeze({
    field: "adjudication_attestation",
    identityField: "adjudicator_id",
    schema: "ngl.adjudication-attestation.v1"
  })
});
const ENVELOPE_FIELDS = Object.freeze(Object.values(PROFILES).map(profile => profile.field));
const FINGERPRINT = /^[a-f0-9]{64}$/;
const ENVELOPE_KEYS = Object.freeze(["algorithm", "keyFingerprint", "schema", "signature"]);

function assertPlainData(value, ancestors = new Set(), depth = 0) {
  if (depth > 100) throw new Error("signed event exceeds maximum nesting depth");
  if (value === null || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") throw new Error("signed event contains a non-JSON value");
  if (ancestors.has(value)) throw new Error("signed event contains a cycle");
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new Error("signed event must contain plain JSON data");
  }
  const keys = Object.keys(value);
  if (Reflect.ownKeys(value).length !== keys.length + (array ? 1 : 0)) {
    throw new Error("signed event contains hidden or symbolic properties");
  }
  if (array && keys.length !== value.length) throw new Error("signed event contains a sparse or decorated array");
  ancestors.add(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (array && key !== String(index)) throw new Error("signed event contains a decorated array");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
      throw new Error("signed event contains an accessor or hidden field");
    }
    assertPlainData(descriptor.value, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

function publicKeyObject(publicKey) {
  if (publicKey === undefined || publicKey === null || publicKey === "") {
    throw new Error("WORLD_TRUST_PUBLIC_KEY_REQUIRED");
  }
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("WORLD_TRUST_KEY_MUST_BE_ED25519");
  return key;
}

function fingerprint(key) {
  return createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("hex");
}

export function worldTrustKeyFingerprint(publicKey) {
  return fingerprint(publicKeyObject(publicKey));
}

/**
 * Canonical bytes all trust roles sign. Attestation envelopes are excluded so
 * independently controlled observer, authorizer, and adjudicator keys can
 * attest to the same event without circular signatures.
 */
export function canonicalAttestationPayload(event) {
  assertPlainData(event);
  // Validate canonical encoding before cloning; the kernel rejects lossy values.
  canonicalStringify(event);
  const unsigned = structuredClone(event);
  for (const field of ENVELOPE_FIELDS) delete unsigned[field];
  return Buffer.from(canonicalStringify(unsigned), "utf8");
}

/**
 * Create one fail-closed verifier from host-controlled key pinning and identity.
 * The incoming event can supply neither its own trust pin nor its own verifier.
 */
export function createSignedEventVerifier({
  role, publicKey, expectedFingerprint, expectedIdentity
} = {}) {
  const profile = PROFILES[role];
  if (!profile) throw new Error("WORLD_TRUST_ROLE_INVALID");
  const key = publicKeyObject(publicKey);
  if (typeof expectedFingerprint !== "string" || !FINGERPRINT.test(expectedFingerprint)) {
    throw new Error("WORLD_TRUST_FINGERPRINT_REQUIRED");
  }
  if (fingerprint(key) !== expectedFingerprint) throw new Error("WORLD_TRUST_FINGERPRINT_MISMATCH");
  if (typeof expectedIdentity !== "string" || !expectedIdentity.trim() ||
      expectedIdentity !== expectedIdentity.trim() || expectedIdentity.length > 128) {
    throw new Error("WORLD_TRUST_IDENTITY_REQUIRED");
  }

  return function verifySignedEvent(event) {
    try {
      assertPlainData(event);
      if (!event || typeof event !== "object" || Array.isArray(event) ||
          event[profile.identityField] !== expectedIdentity) return false;
      const envelope = event[profile.field];
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return false;
      const keys = Reflect.ownKeys(envelope);
      if (keys.length !== ENVELOPE_KEYS.length ||
          keys.slice().sort().join(",") !== ENVELOPE_KEYS.slice().sort().join(",")) return false;
      for (const field of ENVELOPE_KEYS) {
        const descriptor = Object.getOwnPropertyDescriptor(envelope, field);
        if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) return false;
      }
      if (envelope.schema !== profile.schema ||
          envelope.algorithm !== "Ed25519" ||
          envelope.keyFingerprint !== expectedFingerprint ||
          typeof envelope.signature !== "string") return false;
      const signature = Buffer.from(envelope.signature, "base64url");
      if (signature.length !== 64 || signature.toString("base64url") !== envelope.signature) return false;
      return verifySignature(null, canonicalAttestationPayload(event), key, signature);
    } catch {
      return false;
    }
  };
}

/**
 * Build all three verifier callbacks. Each role must have its own Ed25519 key
 * fingerprint and identity. Missing or reused trust roots are configuration errors.
 */
export function createWorldTrust({ observation, authorization, adjudication } = {}) {
  const configs = { observation, authorization, adjudication };
  const entries = Object.entries(configs);
  const verifiers = {};
  const fingerprints = [];
  const identities = [];

  for (const [role, config] of entries) {
    if (!config || typeof config !== "object") throw new Error("WORLD_TRUST_ROOTS_NOT_CONFIGURED");
    const verifier = createSignedEventVerifier({ role, ...config });
    verifiers[role] = verifier;
    fingerprints.push(config.expectedFingerprint);
    identities.push(config.expectedIdentity);
  }
  if (new Set(fingerprints).size !== entries.length || new Set(identities).size !== entries.length) {
    throw new Error("WORLD_TRUST_ROOTS_MUST_BE_DISTINCT");
  }

  return Object.freeze({
    verifyObservation: verifiers.observation,
    verifyAuthorization: verifiers.authorization,
    verifyAdjudication: verifiers.adjudication
  });
}

export function createWorldTrustFromEnv(env = process.env) {
  const config = {
    observation: {
      publicKey: env.NGL_OBSERVER_PUBLIC_KEY_PEM,
      expectedFingerprint: env.NGL_OBSERVER_KEY_SHA256,
      expectedIdentity: env.NGL_OBSERVER_ID
    },
    authorization: {
      publicKey: env.NGL_AUTHORIZER_PUBLIC_KEY_PEM,
      expectedFingerprint: env.NGL_AUTHORIZER_KEY_SHA256,
      expectedIdentity: env.NGL_AUTHORIZER_ID
    },
    adjudication: {
      publicKey: env.NGL_ADJUDICATOR_PUBLIC_KEY_PEM,
      expectedFingerprint: env.NGL_ADJUDICATOR_KEY_SHA256,
      expectedIdentity: env.NGL_ADJUDICATOR_ID
    }
  };
  const required = [
    "NGL_OBSERVER_PUBLIC_KEY_PEM", "NGL_OBSERVER_KEY_SHA256", "NGL_OBSERVER_ID",
    "NGL_AUTHORIZER_PUBLIC_KEY_PEM", "NGL_AUTHORIZER_KEY_SHA256", "NGL_AUTHORIZER_ID",
    "NGL_ADJUDICATOR_PUBLIC_KEY_PEM", "NGL_ADJUDICATOR_KEY_SHA256", "NGL_ADJUDICATOR_ID"
  ];
  if (required.some(name => typeof env[name] !== "string" || !env[name].trim())) {
    throw new Error("WORLD_TRUST_ROOTS_NOT_CONFIGURED");
  }
  return createWorldTrust(config);
}
