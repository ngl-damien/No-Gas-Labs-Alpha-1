import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

// Canonical JSON is deliberately strict: missing/undefined/non-finite fields cannot be silently dropped.
function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return "{" + Object.keys(value).sort().map(key => {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("unsafe event key");
      return JSON.stringify(key) + ":" + canonical(value[key]);
    }).join(",") + "}";
  }
  throw new Error("non-canonical event value");
}

function publicKeyAndFingerprint(jwk) {
  const key = createPublicKey({ key: jwk, format: "jwk" });
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("P-256 key required");
  const fingerprint = createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
  return { key, fingerprint };
}

// This record is only authoritative if pinned OUTSIDE the untrusted event stream.
export function pinFounderKey(public_key_jwk) {
  const { fingerprint } = publicKeyAndFingerprint(public_key_jwk);
  return Object.freeze({ schema: "ngl.founder-key-pin.v1", fingerprint, public_key_jwk: structuredClone(public_key_jwk) });
}

// Sign the COMPLETE consequential event (including effects, receipts and event identity).
// expires_at is part of the signed bytes. The seal itself is excluded to avoid recursion.
export function founderSigningBytes(event, expires_at) {
  if (!event?.event_id || typeof event.event_id !== "string" || !Number.isFinite(Date.parse(expires_at))) throw new Error("event identity and expiry required");
  const { founder_seal, ...unsigned } = event;
  return Buffer.from(canonical({ domain: "ngl.founder-event.v1", expires_at, event: unsigned }));
}

export function verifyFounderEvent({ event, trust, now = Date.now() }) {
  try {
    if (trust?.schema !== "ngl.founder-key-pin.v1" || !event?.founder_seal || !Number.isFinite(now)) return false;
    const { key, fingerprint } = publicKeyAndFingerprint(trust.public_key_jwk);
    if (fingerprint !== trust.fingerprint || event.founder_seal.fingerprint !== fingerprint) return false;
    const { signature, expires_at } = event.founder_seal;
    if (typeof signature !== "string" || !/^[A-Za-z0-9_-]+$/.test(signature) || !Number.isFinite(Date.parse(expires_at)) || now >= Date.parse(expires_at)) return false;
    return verifySignature("sha256", founderSigningBytes(event, expires_at), key, Buffer.from(signature, "base64url"));
  } catch { return false; }
}
