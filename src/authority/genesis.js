import { createHash, createPublicKey } from "node:crypto";
import { verifyFounderDecision } from "./decision.js";

// Genesis is a human-approved trust anchor, not a biometric identity verdict.
// The enrollment record must be pinned outside untrusted event streams.
export function fingerprintPublicKey(public_key_jwk) {
  const key = createPublicKey({ key: public_key_jwk, format: "jwk" });
  return createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}

export function establishGenesis({ public_key_jwk, evidence_sha256, challenge, founder_declaration }) {
  if (!/^[a-f0-9]{64}$/.test(evidence_sha256 || "")) throw new Error("evidence digest required");
  if (typeof challenge !== "string" || !challenge.trim()) throw new Error("challenge required");
  if (founder_declaration !== "I accept the inaugural No_Gas_Labs Founder key") throw new Error("explicit Founder declaration required");
  const key_fingerprint = fingerprintPublicKey(public_key_jwk);
  return Object.freeze({
    schema: "ngl.founder-genesis.v1",
    key_fingerprint,
    public_key_jwk: structuredClone(public_key_jwk),
    evidence_sha256,
    challenge,
    status: "ENROLLED_BY_DECLARATION",
    note: "Video evidence supports the ceremony; it is not conclusive biometric identity proof."
  });
}

export function verifyEnrolledDecision({ genesis, signed, payload, now = Date.now() }) {
  if (genesis?.schema !== "ngl.founder-genesis.v1" || genesis.status !== "ENROLLED_BY_DECLARATION") {
    return Object.freeze({ valid: false, reason: "GENESIS_NOT_ENROLLED" });
  }
  if (fingerprintPublicKey(genesis.public_key_jwk) !== genesis.key_fingerprint) {
    return Object.freeze({ valid: false, reason: "GENESIS_KEY_MISMATCH" });
  }
  return verifyFounderDecision({
    signed, payload, public_key_jwk: genesis.public_key_jwk,
    expected_fingerprint: genesis.key_fingerprint, now
  });
}
