import { createHash } from "node:crypto";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function makeEvidence(bytes, mediaType = "application/octet-stream") {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return Object.freeze({
    algorithm: "sha256",
    digest: sha256(body),
    size: body.byteLength,
    media_type: mediaType
  });
}

export function verifyEvidence(evidence, bytes) {
  if (!evidence || evidence.algorithm !== "sha256") return false;
  if (typeof evidence.digest !== "string" || !/^[a-f0-9]{64}$/.test(evidence.digest)) return false;
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? "");
  return body.byteLength === evidence.size && sha256(body) === evidence.digest;
}
