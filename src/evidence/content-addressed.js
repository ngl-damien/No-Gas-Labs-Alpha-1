import { createHash } from "node:crypto";

const RECEIPT_FIELDS = ["algorithm", "digest", "size"];

export function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function snapshotReceipt(receipt) {
  try {
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return null;
    const prototype = Object.getPrototypeOf(receipt);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const descriptors = Object.getOwnPropertyDescriptors(receipt);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== RECEIPT_FIELDS.length ||
        keys.some(key => typeof key !== "string" || !RECEIPT_FIELDS.includes(key))) {
      return null;
    }

    for (const field of RECEIPT_FIELDS) {
      const descriptor = descriptors[field];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) {
        return null;
      }
    }

    const snapshot = Object.freeze({
      algorithm: descriptors.algorithm.value,
      digest: descriptors.digest.value,
      size: descriptors.size.value
    });
    if (snapshot.algorithm !== "sha256" ||
        typeof snapshot.digest !== "string" ||
        !/^[a-f0-9]{64}$/.test(snapshot.digest) ||
        !Number.isSafeInteger(snapshot.size) ||
        snapshot.size < 0) {
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

/**
 * Verify retained bytes against a detached receipt snapshot.
 * The resolver receives a frozen copy; it must return Buffer or Uint8Array bytes.
 */
export function verifyReceipt(receipt, resolveArtifact) {
  const expected = snapshotReceipt(receipt);
  if (!expected || typeof resolveArtifact !== "function") return false;

  try {
    const resolved = resolveArtifact(expected);
    if (!Buffer.isBuffer(resolved) && !(resolved instanceof Uint8Array)) return false;
    const bytes = Buffer.from(resolved);
    return bytes.byteLength === expected.size && digestBytes(bytes) === expected.digest;
  } catch {
    return false;
  }
}

export function makeReceipt(bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return Object.freeze({ algorithm:"sha256", digest:digestBytes(body), size:body.byteLength });
}
