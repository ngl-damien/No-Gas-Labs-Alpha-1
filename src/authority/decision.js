import { createHash, createPublicKey, verify as verifySignature, randomBytes, randomUUID } from "node:crypto";
import { constants as fsConstants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TRUST_PATH = path.resolve(HERE, "../../docs/authority/founder.pub.json");
const NONCE_LEDGER_SCHEMA = "ngl.founder-nonce-ledger.v1";
const MAX_NONCE_LEDGER_BYTES = 4 * 1024 * 1024;
const MAX_NONCE_COUNT = 100_000;

function snapshotJsonData(value, limits = {}) {
  const maxDepth = limits.maxDepth ?? 32;
  const maxNodes = limits.maxNodes ?? 10_000;
  const active = new WeakSet();
  let nodes = 0;
  let bytes = 0;

  function visit(item, depth) {
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth) throw new Error("NON_CANONICAL_DECISION_DATA");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") {
      bytes += Buffer.byteLength(item, "utf8");
      if (bytes > 262_144) throw new Error("NON_CANONICAL_DECISION_DATA");
      return item;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item) || Object.is(item, -0)) throw new Error("NON_CANONICAL_DECISION_DATA");
      return item;
    }
    if (typeof item !== "object") throw new Error("NON_CANONICAL_DECISION_DATA");
    if (active.has(item)) throw new Error("NON_CANONICAL_DECISION_DATA");
    active.add(item);
    try {
      if (Array.isArray(item)) {
        const descriptors = Object.getOwnPropertyDescriptors(item);
        const keys = Reflect.ownKeys(descriptors).filter(key => key !== "length");
        const length = descriptors.length?.value;
        if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length) {
          throw new Error("NON_CANONICAL_DECISION_DATA");
        }
        const output = [];
        for (const key of keys) {
          if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) {
            throw new Error("NON_CANONICAL_DECISION_DATA");
          }
        }
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || descriptor.get || descriptor.set) {
            throw new Error("NON_CANONICAL_DECISION_DATA");
          }
          output.push(visit(descriptor.value, depth + 1));
        }
        return output;
      }

      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new Error("NON_CANONICAL_DECISION_DATA");
      const descriptors = Object.getOwnPropertyDescriptors(item);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.some(key => typeof key !== "string")) throw new Error("NON_CANONICAL_DECISION_DATA");
      const output = Object.create(null);
      for (const key of keys.sort()) {
        const descriptor = descriptors[key];
        if (!descriptor.enumerable || !("value" in descriptor) || descriptor.get || descriptor.set) {
          throw new Error("NON_CANONICAL_DECISION_DATA");
        }
        bytes += Buffer.byteLength(key, "utf8");
        if (bytes > 262_144) throw new Error("NON_CANONICAL_DECISION_DATA");
        output[key] = visit(descriptor.value, depth + 1);
      }
      return output;
    } finally {
      active.delete(item);
    }
  }

  return visit(value, 0);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}


function assertNoSymlinkPathComponents(targetPath, code) {
  const absolute = path.resolve(targetPath);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = lstatSync(current); }
    catch { throw new Error(code); }
    if (stat.isSymbolicLink()) throw new Error(code);
  }
  return absolute;
}

function assertPrivateDirectory(directory, code) {
  let stat;
  try { stat = lstatSync(directory); }
  catch { throw new Error(code); }
  if (stat.isSymbolicLink() || !stat.isDirectory() ||
      (stat.mode & 0o777) !== 0o700 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    throw new Error(code);
  }
  return { dev: stat.dev, ino: stat.ino };
}

function assertPrivateDirectoryIdentity(directory, identity, code) {
  const current = assertPrivateDirectory(directory, code);
  if (current.dev !== identity.dev || current.ino !== identity.ino) throw new Error(code);
}

function sameFileSnapshot(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.uid === right.uid && left.mode === right.mode &&
    left.size === right.size && left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function syncDirectory(directory) {
  const descriptor = openSync(directory, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0));
  try { fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}

function loadHostTrustAnchor() {
  const trustPath = process.env.NGL_FOUNDER_TRUST_ANCHOR_PATH;
  if (!trustPath || !path.isAbsolute(trustPath)) {
    throw new Error("FOUNDER_TRUST_ROOT_UNCONFIGURED");
  }
  assertNoSymlinkPathComponents(trustPath, "FOUNDER_TRUST_ROOT_UNSAFE");
  assertPrivateDirectory(path.dirname(path.resolve(trustPath)), "FOUNDER_TRUST_ROOT_UNSAFE");
  let stat;
  try { stat = lstatSync(trustPath); }
  catch { throw new Error("FOUNDER_TRUST_ROOT_UNAVAILABLE"); }
  if (stat.isSymbolicLink() || !stat.isFile() ||
      (stat.mode & 0o777) !== 0o600 || stat.size > 16_384 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    throw new Error("FOUNDER_TRUST_ROOT_UNSAFE");
  }
  return loadTrustAnchor(trustPath);
}

function readNonceLedger(filePath) {
  let before;
  try { before = lstatSync(filePath); }
  catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error("FOUNDER_NONCE_LEDGER_UNAVAILABLE");
  }
  if (before.isSymbolicLink() || !before.isFile() ||
      (before.mode & 0o777) !== 0o600 ||
      (typeof process.getuid === "function" && before.uid !== process.getuid()) ||
      before.size > MAX_NONCE_LEDGER_BYTES) {
    throw new Error("FOUNDER_NONCE_LEDGER_UNSAFE");
  }
  let descriptor;
  try {
    descriptor = openSync(filePath, fsConstants.O_RDONLY |
      (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameFileSnapshot(before, opened)) {
      throw new Error("FOUNDER_NONCE_LEDGER_CHANGED");
    }
    const bytes = readFileSync(descriptor);
    const after = lstatSync(filePath);
    const afterDescriptor = fstatSync(descriptor);
    if (after.isSymbolicLink() || !after.isFile() ||
        !sameFileSnapshot(opened, after) ||
        !sameFileSnapshot(opened, afterDescriptor) ||
        bytes.length !== opened.size || bytes.length > MAX_NONCE_LEDGER_BYTES) {
      throw new Error("FOUNDER_NONCE_LEDGER_CHANGED");
    }
    const serialized = bytes.toString("utf8");
    if (!Buffer.from(serialized, "utf8").equals(bytes)) {
      throw new Error("FOUNDER_NONCE_LEDGER_TAMPERED");
    }
    let saved;
    try { saved = JSON.parse(serialized); }
    catch { throw new Error("FOUNDER_NONCE_LEDGER_TAMPERED"); }
    if (!saved || typeof saved !== "object" || Array.isArray(saved) ||
        Object.keys(saved).sort().join(",") !== "nonces,schema" ||
        saved.schema !== NONCE_LEDGER_SCHEMA ||
        !Array.isArray(saved.nonces) || saved.nonces.length > MAX_NONCE_COUNT ||
        saved.nonces.some(value => typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) ||
        new Set(saved.nonces).size !== saved.nonces.length ||
        canonical(saved) !== serialized) {
      throw new Error("FOUNDER_NONCE_LEDGER_TAMPERED");
    }
    return saved.nonces;
  } catch (error) {
    if (String(error?.message || "").startsWith("FOUNDER_NONCE_LEDGER_")) throw error;
    throw new Error("FOUNDER_NONCE_LEDGER_UNAVAILABLE");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function releaseNonceLock(lockPath, identity, directory) {
  let current;
  try { current = lstatSync(lockPath); }
  catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (current.isSymbolicLink() || !current.isFile() ||
      current.dev !== identity.dev || current.ino !== identity.ino) {
    throw new Error("FOUNDER_NONCE_LEDGER_LOCK_CHANGED");
  }
  unlinkSync(lockPath);
  syncDirectory(directory);
}

function consumeFounderNonce(nonce) {
  const configuredPath = process.env.NGL_FOUNDER_NONCE_LEDGER_PATH;
  if (!configuredPath || !path.isAbsolute(configuredPath)) {
    throw new Error("FOUNDER_NONCE_LEDGER_UNCONFIGURED");
  }
  if (typeof nonce !== "string" || !/^[a-f0-9]{32}$/.test(nonce)) {
    throw new Error("FOUNDER_NONCE_INVALID");
  }
  const ledgerPath = path.resolve(configuredPath);
  const directory = path.dirname(ledgerPath);
  const directoryIdentity = assertPrivateDirectory(directory, "FOUNDER_NONCE_LEDGER_UNSAFE");
  assertNoSymlinkPathComponents(directory, "FOUNDER_NONCE_LEDGER_UNSAFE");
  const lockPath = path.join(directory, ".founder-nonce.lock");
  if (ledgerPath === lockPath) throw new Error("FOUNDER_NONCE_LEDGER_PATH_INVALID");

  let lockDescriptor;
  let lockIdentity;
  let temporaryPath = null;
  let keepLock = false;
  try {
    try { lockDescriptor = openSync(lockPath, "wx", 0o600); }
    catch (error) {
      if (error.code === "EEXIST") throw new Error("FOUNDER_NONCE_LEDGER_LOCKED");
      throw new Error("FOUNDER_NONCE_LEDGER_UNAVAILABLE");
    }
    const lockStat = fstatSync(lockDescriptor);
    if (!lockStat.isFile() || (lockStat.mode & 0o777) !== 0o600 ||
        (typeof process.getuid === "function" && lockStat.uid !== process.getuid())) {
      throw new Error("FOUNDER_NONCE_LEDGER_UNSAFE");
    }
    lockIdentity = { dev: lockStat.dev, ino: lockStat.ino };
    writeFileSync(lockDescriptor, canonical({
      schema: "ngl.ledger-lock.v1",
      pid: process.pid,
      openedAt: new Date().toISOString(),
    }));
    fsyncSync(lockDescriptor);
    assertPrivateDirectoryIdentity(directory, directoryIdentity, "FOUNDER_NONCE_LEDGER_UNSAFE");
    try { syncDirectory(directory); }
    catch { keepLock = true; throw new Error("FOUNDER_NONCE_DURABILITY_UNCERTAIN"); }

    const nonces = readNonceLedger(ledgerPath);
    if (nonces.includes(nonce)) throw new Error("FOUNDER_NONCE_REPLAY");
    if (nonces.length >= MAX_NONCE_COUNT) throw new Error("FOUNDER_NONCE_LEDGER_FULL");
    const next = canonical({ schema: NONCE_LEDGER_SCHEMA, nonces: [...nonces, nonce] });
    if (Buffer.byteLength(next, "utf8") > MAX_NONCE_LEDGER_BYTES) {
      throw new Error("FOUNDER_NONCE_LEDGER_FULL");
    }

    temporaryPath = path.join(directory, ".founder-nonce-" + randomUUID() + ".tmp");
    let temporaryDescriptor;
    try {
      temporaryDescriptor = openSync(temporaryPath, "wx", 0o600);
      writeFileSync(temporaryDescriptor, next, "utf8");
      fsyncSync(temporaryDescriptor);
    } finally {
      if (temporaryDescriptor !== undefined) closeSync(temporaryDescriptor);
    }
    assertPrivateDirectoryIdentity(directory, directoryIdentity, "FOUNDER_NONCE_LEDGER_UNSAFE");
    renameSync(temporaryPath, ledgerPath);
    temporaryPath = null;
    try { syncDirectory(directory); }
    catch { keepLock = true; throw new Error("FOUNDER_NONCE_DURABILITY_UNCERTAIN"); }
    try {
      releaseNonceLock(lockPath, lockIdentity, directory);
      lockIdentity = null;
    } catch {
      keepLock = true;
      throw new Error("FOUNDER_NONCE_DURABILITY_UNCERTAIN");
    }
  } catch (error) {
    if (temporaryPath) {
      try { unlinkSync(temporaryPath); } catch {}
    }
    if (lockIdentity && !keepLock) {
      try { releaseNonceLock(lockPath, lockIdentity, directory); } catch {}
    }
    if (error?.message === "FOUNDER_NONCE_REPLAY") {
      throw new Error("FOUNDER_DECISION_INVALID:NONCE_REPLAY");
    }
    throw error;
  } finally {
    if (lockDescriptor !== undefined) closeSync(lockDescriptor);
  }
}

export const decisionDigest = payload =>
  createHash("sha256").update(canonical(snapshotJsonData(payload))).digest("hex");

function publicKeyFingerprint(publicKeyJwk) {
  let jwk;
  try { jwk = snapshotJsonData(publicKeyJwk); }
  catch { return null; }
  if (Object.keys(jwk).sort().join(",") !== "crv,kty,x,y" ||
      jwk.kty !== "EC" || jwk.crv !== "P-256" ||
      typeof jwk.x !== "string" || typeof jwk.y !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(jwk.x) || !/^[A-Za-z0-9_-]{43}$/.test(jwk.y)) return null;
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  if (x.length !== 32 || y.length !== 32 || x.toString("base64url") !== jwk.x || y.toString("base64url") !== jwk.y) return null;
  try { createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: "jwk" }); }
  catch { return null; }
  return createHash("sha256")
    .update(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }))
    .digest("hex");
}

/** Load a trust anchor for inspection. Authorization never accepts a caller-selected path. */
export function loadTrustAnchor(trustPath = DEFAULT_TRUST_PATH) {
  if (!existsSync(trustPath)) {
    return Object.freeze({ enrolled: false, reason: "TRUST_ANCHOR_ABSENT", path: trustPath });
  }
  let raw;
  try {
    const stat = lstatSync(trustPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16_384) {
      return Object.freeze({ enrolled: false, reason: "MALFORMED_TRUST_ANCHOR", path: trustPath });
    }
    raw = snapshotJsonData(JSON.parse(readFileSync(trustPath, "utf8")));
  } catch {
    return Object.freeze({ enrolled: false, reason: "MALFORMED_TRUST_ANCHOR", path: trustPath });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      raw.schema !== "ngl.founder-trust-anchor.v1") {
    return Object.freeze({ enrolled: false, reason: "MALFORMED_TRUST_ANCHOR", path: trustPath });
  }
  if (raw.status === "NOT_ENROLLED" && raw.enrolled === false &&
      raw.mode === null && raw.public_key_jwk === null && raw.fingerprint === null) {
    return Object.freeze({ enrolled: false, reason: "NOT_ENROLLED", path: trustPath });
  }
  if (raw.status !== "ENROLLED" || raw.enrolled !== true ||
      !["PRODUCTION", "TEST_ONLY"].includes(raw.mode) ||
      !raw.public_key_jwk || typeof raw.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(raw.fingerprint)) {
    return Object.freeze({ enrolled: false, reason: "MALFORMED_TRUST_ANCHOR", path: trustPath });
  }
  if (Object.hasOwn(raw.public_key_jwk, "d")) {
    return Object.freeze({ enrolled: false, reason: "PRIVATE_KEY_IN_TRUST_ANCHOR", path: trustPath });
  }
  const actualFingerprint = publicKeyFingerprint(raw.public_key_jwk);
  if (!actualFingerprint) {
    return Object.freeze({ enrolled: false, reason: "MALFORMED_TRUST_ANCHOR", path: trustPath });
  }
  if (actualFingerprint !== raw.fingerprint) {
    return Object.freeze({ enrolled: false, reason: "FINGERPRINT_MISMATCH", path: trustPath });
  }
  return Object.freeze({
    enrolled: true,
    mode: raw.mode,
    public_key_jwk: deepFreeze(raw.public_key_jwk),
    fingerprint: raw.fingerprint,
    path: trustPath,
  });
}

export function makeDecisionPayload(input) {
  const args = snapshotJsonData(input);
  const { proposal, quest, capabilities, outputs, acceptance, expires_at } = args;
  if (!proposal?.event_id || proposal.type !== "PROPOSAL") throw new Error("proposal required");
  if (!quest?.quest_id || proposal.quest_id !== quest.quest_id) throw new Error("quest binding mismatch");
  if (![capabilities, outputs, acceptance].every(value =>
    Array.isArray(value) && value.every(item => typeof item === "string" && item.length > 0))) {
    throw new Error("decision scope arrays required");
  }
  if (!expires_at || !Number.isFinite(Date.parse(expires_at))) throw new Error("valid expiry required");
  return deepFreeze({
    schema: "ngl.founder-decision.v1",
    proposal_id: proposal.event_id,
    quest_id: quest.quest_id,
    capabilities: [...capabilities],
    outputs: [...outputs],
    acceptance: [...acceptance],
    expires_at,
  });
}

/** Cryptographic verification only. A valid result is not authority to create an event. */
export function verifyFounderDecision({
  signed,
  payload,
  public_key_jwk,
  expected_fingerprint,
  now = Date.now(),
  consumed_nonces = null,
}) {
  let safeSigned, safePayload, safePublicKey;
  try {
    safeSigned = snapshotJsonData(signed);
    safePayload = snapshotJsonData(payload);
    safePublicKey = snapshotJsonData(public_key_jwk);
  } catch {
    return Object.freeze({ valid: false, reason: "NON_CANONICAL_INPUT" });
  }
  if (!safeSigned || typeof safeSigned !== "object" || Array.isArray(safeSigned)) {
    return Object.freeze({ valid: false, reason: "SIGNED_OBJECT_REQUIRED" });
  }
  if (!safePayload || typeof safePayload !== "object" || Array.isArray(safePayload)) {
    return Object.freeze({ valid: false, reason: "PAYLOAD_REQUIRED" });
  }
  if (Object.keys(safeSigned).sort().join(",") !== "key_fingerprint,nonce,payload_sha256,signature") {
    return Object.freeze({ valid: false, reason: "SIGNED_SHAPE_INVALID" });
  }
  if (Object.keys(safePayload).sort().join(",") !== "acceptance,capabilities,expires_at,outputs,proposal_id,quest_id,schema") {
    return Object.freeze({ valid: false, reason: "PAYLOAD_SHAPE_INVALID" });
  }
  if (safePayload.schema !== "ngl.founder-decision.v1" ||
      typeof safePayload.expires_at !== "string" ||
      typeof safePayload.proposal_id !== "string" || !safePayload.proposal_id ||
      typeof safePayload.quest_id !== "string" || !safePayload.quest_id ||
      ![safePayload.capabilities, safePayload.outputs, safePayload.acceptance].every(value =>
        Array.isArray(value) && value.every(item => typeof item === "string" && item.length > 0))) {
    return Object.freeze({ valid: false, reason: "PAYLOAD_INVALID" });
  }
  if (typeof safeSigned.payload_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(safeSigned.payload_sha256) ||
      safeSigned.payload_sha256 !== decisionDigest(safePayload)) {
    return Object.freeze({ valid: false, reason: "PAYLOAD_DIGEST_MISMATCH" });
  }
  if (Object.hasOwn(safePublicKey || {}, "d") ||
      typeof expected_fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(expected_fingerprint) ||
      safeSigned.key_fingerprint !== expected_fingerprint ||
      publicKeyFingerprint(safePublicKey) !== expected_fingerprint) {
    return Object.freeze({ valid: false, reason: "KEY_NOT_ENROLLED" });
  }
  if (!Number.isFinite(now)) return Object.freeze({ valid: false, reason: "CLOCK_INVALID" });
  const expiry = Date.parse(safePayload.expires_at);
  if (!Number.isFinite(expiry) || now >= expiry) {
    return Object.freeze({ valid: false, reason: "DECISION_EXPIRED" });
  }
  if (typeof safeSigned.nonce !== "string" || !/^[a-f0-9]{32}$/.test(safeSigned.nonce)) {
    return Object.freeze({ valid: false, reason: "NONCE_INVALID" });
  }
  if (consumed_nonces && typeof consumed_nonces.has === "function" && consumed_nonces.has(safeSigned.nonce)) {
    return Object.freeze({ valid: false, reason: "NONCE_REPLAY" });
  }
  if (typeof safeSigned.signature !== "string" || !/^[A-Za-z0-9_-]+$/.test(safeSigned.signature) ||
      safeSigned.signature.length > 256) {
    return Object.freeze({ valid: false, reason: "SIGNATURE_INVALID" });
  }
  const signature = Buffer.from(safeSigned.signature, "base64url");
  if (signature.length < 8 || signature.length > 80 || signature.toString("base64url") !== safeSigned.signature) {
    return Object.freeze({ valid: false, reason: "SIGNATURE_INVALID" });
  }
  try {
    const key = createPublicKey({ key: { ...safePublicKey }, format: "jwk" });
    const valid = verifySignature("sha256", Buffer.from(canonical(safePayload)), key, signature);
    return Object.freeze({ valid, reason: valid ? null : "SIGNATURE_INVALID" });
  } catch {
    return Object.freeze({ valid: false, reason: "SIGNATURE_INVALID" });
  }
}

function exactAuthorizationInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("FOUNDER_AUTHORIZATION_INPUT_INVALID");
  }
  let descriptors;
  try {
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("invalid prototype");
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch { throw new Error("FOUNDER_AUTHORIZATION_INPUT_INVALID"); }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 2 || !keys.includes("signed") || !keys.includes("payload")) {
    throw new Error("FOUNDER_AUTHORIZATION_INPUT_INVALID");
  }
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !("value" in descriptor) || descriptor.get || descriptor.set) {
      throw new Error("FOUNDER_AUTHORIZATION_INPUT_INVALID");
    }
  }
  try {
    return {
      signed: snapshotJsonData(descriptors.signed.value),
      payload: snapshotJsonData(descriptors.payload.value),
    };
  } catch {
    throw new Error("FOUNDER_AUTHORIZATION_INPUT_INVALID");
  }
}

/**
 * The only authority-producing entry point. Trust and replay paths come only from
 * host environment configuration; a durable single-writer nonce ledger fails closed
 * on contention or uncertain durability. A stale lock requires offline recovery.
 */
export function authorizationEvent(input) {
  const { signed, payload } = exactAuthorizationInput(input);
  const trust = loadHostTrustAnchor();
  if (!trust.enrolled) throw new Error("FOUNDER_NOT_ENROLLED:" + trust.reason);
  if (trust.mode !== "PRODUCTION") throw new Error("FOUNDER_TRUST_MODE_INVALID");
  const verification = verifyFounderDecision({
    signed,
    payload,
    public_key_jwk: trust.public_key_jwk,
    expected_fingerprint: trust.fingerprint,
    now: Date.now(),
  });
  if (!verification.valid) throw new Error("FOUNDER_DECISION_INVALID:" + verification.reason);
  consumeFounderNonce(signed.nonce);
  return deepFreeze({
    event_id: "authorize:" + payload.proposal_id + ":" + signed.payload_sha256,
    type: "QUEST_AUTHORIZED",
    quest_id: payload.quest_id,
    proposal_id: payload.proposal_id,
    grant_id: signed.payload_sha256,
    actor: "founder",
    capabilities: payload.capabilities,
    outputs: payload.outputs,
    acceptance: payload.acceptance,
    expires_at: payload.expires_at,
    key_fingerprint: signed.key_fingerprint,
    trust_mode: trust.mode,
    verification_reason: null,
    verified_in_process: true,
  });
}

/** Append-only receipt link for decision chain. */
export function linkReceipt(input) {
  const args = snapshotJsonData(input);
  const { prevHash, payload, signed, now = Date.now() } = args;
  const safePayload = snapshotJsonData(payload);
  const safeSigned = snapshotJsonData(signed);
  const prev = prevHash || "0".repeat(64);
  if (typeof prev !== "string" || !/^[a-f0-9]{64}$/.test(prev) || !Number.isFinite(now)) {
    throw new Error("INVALID_RECEIPT_LINK");
  }
  const receiptHash = decisionDigest({ payload: safePayload, signed: safeSigned, prev });
  const blockHash = createHash("sha256").update(prev + receiptHash + String(now)).digest("hex");
  return Object.freeze({ prevHash: prev, receiptHash, blockHash, at: now });
}

export function newNonce() {
  return randomBytes(16).toString("hex");
}
