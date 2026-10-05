import { createHash } from "node:crypto";

export function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyReceipt(receipt, resolveArtifact) {
  if (!receipt || receipt.algorithm !== "sha256") return false;
  if (typeof receipt.digest !== "string" || !/^[a-f0-9]{64}$/.test(receipt.digest)) return false;
  if (!Number.isInteger(receipt.size) || receipt.size < 0) return false;
  if (typeof resolveArtifact !== "function") return false;

  const resolved = resolveArtifact(receipt);
  if (resolved == null) return false;
  const bytes = Buffer.isBuffer(resolved) ? resolved : Buffer.from(resolved);
  return bytes.byteLength === receipt.size && digestBytes(bytes) === receipt.digest;
}

export function makeReceipt(bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return Object.freeze({ algorithm:"sha256", digest:digestBytes(body), size:body.byteLength });
}
