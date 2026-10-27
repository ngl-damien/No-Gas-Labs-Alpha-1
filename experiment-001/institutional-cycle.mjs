import { constants as fsConstants } from 'node:fs';
import { mkdir, readFile, rename, open, lstat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto';

const MAX_LEDGER_BYTES = 8 * 1024 * 1024;
const MAX_INPUT = 1_000_000;
const MAX_USES = 100;
const MAX_GRANT_MS = 7 * 24 * 60 * 60 * 1000;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
// Loaded before untrusted proposal handling; do not accept a caller-selected trust pin.
const TRUSTED_FOUNDER_KEY_FINGERPRINT = process.env.NGL_FOUNDER_KEY_FINGERPRINT ?? null;
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');

const MAX_CANONICAL_DEPTH = 100;

export function canonical(value) {
  const ancestors = new Set();
  function visit(current, depth = 0) {
    if (depth > MAX_CANONICAL_DEPTH) throw new Error('NON_CANONICAL_VALUE');
    if (current === null || typeof current === 'string' || typeof current === 'boolean' ||
        (typeof current === 'number' && Number.isFinite(current))) return JSON.stringify(current);
    if (typeof current !== 'object' || ancestors.has(current)) throw new Error('NON_CANONICAL_VALUE');

    const array = Array.isArray(current);
    const prototype = Object.getPrototypeOf(current);
    if ((!array && prototype !== Object.prototype && prototype !== null) ||
        Object.getOwnPropertySymbols(current).length) throw new Error('NON_CANONICAL_VALUE');

    const keys = Object.keys(current);
    const ownKeys = Reflect.ownKeys(current);
    if (array) {
      if (keys.length !== current.length ||
          keys.some((key, index) => key !== String(index)) ||
          ownKeys.length !== current.length + 1) throw new Error('NON_CANONICAL_VALUE');
    } else if (ownKeys.length !== keys.length) {
      throw new Error('NON_CANONICAL_VALUE');
    }

    const entries = keys.map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('NON_CANONICAL_VALUE');
      return [key, descriptor.value];
    });
    if (!array) entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);

    ancestors.add(current);
    const result = array
      ? '[' + entries.map(([, item]) => visit(item, depth + 1)).join(',') + ']'
      : '{' + entries.map(([key, item]) => JSON.stringify(key) + ':' + visit(item, depth + 1)).join(',') + '}';
    ancestors.delete(current);
    return result;
  }
  return visit(value);
}

const hash = value => hashBytes(Buffer.from(canonical(value)));
const initial = () => ({ version: 2, sequence: 0, previous: 'GENESIS', records: [], capabilities: {}, used: [], installationNonces: [] });

function square(n) { return n * n; }
function double(n) { return n * 2; }
function implementationFor(strategy) {
  if (strategy === 'square') return square;
  if (strategy === 'double') return double;
  return null;
}

// Stable strategy IDs are compatibility contracts. Change behavior by adding a new
// strategy version, not by changing the meaning of an existing ID.
const IMPLEMENTATION_IDENTITIES = Object.freeze({
  square: 'ngl-experiment-001:strategy:square:v1',
  double: 'ngl-experiment-001:strategy:double:v1'
});
// Hashes produced by the pre-versioned Function.toString() scheme. These constants
// let existing version-2 ledgers replay after this source changes.
const LEGACY_IMPLEMENTATION_HASHES = Object.freeze({
  square: 'a44644e2cb5f1e34cf0aac616d43631c4778a19585cb634128f9d4fbfe9d947d',
  double: '8bb1c5c30f449235d3934518681a3f5a4453b17efbff8d9aa01b1e09803ab436'
});
export function implementationHash(strategy) {
  if (!implementationFor(strategy)) throw new Error('UNKNOWN_STRATEGY');
  return hashBytes(Buffer.from(IMPLEMENTATION_IDENTITIES[strategy]));
}
export function legacyImplementationHash(strategy) {
  if (!implementationFor(strategy)) throw new Error('UNKNOWN_STRATEGY');
  return LEGACY_IMPLEMENTATION_HASHES[strategy];
}

const cases = Object.freeze([{ n: 2, out: 4 }, { n: 3, out: 9 }, { n: 5, out: 25 }, { n: -4, out: 16 }]);
function challengeWithHash(strategy, hashFor) {
  const implementation = implementationFor(strategy);
  const failed = cases.filter(testCase => !implementation || implementation(testCase.n) !== testCase.out).map(testCase => testCase.n);
  return { total: cases.length, passed: cases.length - failed.length, failed, implementationHash: implementation ? hashFor(strategy) : null };
}
export function challenge(strategy) { return challengeWithHash(strategy, implementationHash); }
function legacyChallenge(strategy) { return challengeWithHash(strategy, legacyImplementationHash); }
export function competition() {
  return ['double', 'square'].map(strategy => ({ strategy, result: challenge(strategy) }));
}

export function makeInstallationProposal({ id = 'square-v1', strategy = 'square', executorPublicKeyPem, nonce = randomUUID(), issuedAt = Date.now(), expiresAt = issuedAt + 60 * 60 * 1000, maxUses = 3 } = {}) {
  if (typeof executorPublicKeyPem !== 'string' || !executorPublicKeyPem.includes('BEGIN PUBLIC KEY')) throw new Error('EXECUTOR_PUBLIC_KEY_REQUIRED');
  const proof = challenge(strategy);
  return { kind: 'INSTALL', id, strategy, executorPublicKeyPem, proof, implementationHash: proof.implementationHash, nonce, issuedAt, expiresAt, maxUses };
}

export function publicKeyFingerprint(publicKeyPem) {
  let key;
  try { key = createPublicKey(publicKeyPem); }
  catch { throw new Error('TRUSTED_PUBLIC_KEY_INVALID'); }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('ED25519_PUBLIC_KEY_REQUIRED');
  return hashBytes(key.export({ type: 'spki', format: 'der' }));
}

export function approvalPayload(decision) {
  return canonical({ domain: 'NGL_FOUNDER_INSTALL_APPROVAL_V1', decision });
}
export function executionReceiptPayload(decision) {
  return canonical({ domain: 'NGL_CAPABILITY_REUSE_RECEIPT_V1', decision });
}
export function proposalDigest(decision) {
  return hashBytes(Buffer.from(approvalPayload(decision)));
}

function exactKeys(object, expected) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return false;
  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(object);
  const ownKeys = Reflect.ownKeys(object);
  if (keys.length !== expected.length || ownKeys.length !== keys.length) return false;
  for (const key of keys) {
    if (!expected.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return expected.every(key => Object.hasOwn(object, key));
}

export function validateInstallationProposal(decision, now = Date.now(), { allowLegacy = false } = {}) {
  const reject = reason => ({ valid: false, reason });
  if (!exactKeys(decision, ['kind', 'id', 'strategy', 'executorPublicKeyPem', 'proof', 'implementationHash', 'nonce', 'issuedAt', 'expiresAt', 'maxUses'])) return reject('INSTALL_SCHEMA_INVALID');
  if (decision.kind !== 'INSTALL' || typeof decision.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(decision.id)) return reject('INSTALL_ID_INVALID');
  if (!implementationFor(decision.strategy)) return reject('UNKNOWN_STRATEGY');
  let executorKey;
  try { executorKey = createPublicKey(decision.executorPublicKeyPem); }
  catch { return reject('EXECUTOR_PUBLIC_KEY_INVALID'); }
  if (executorKey.asymmetricKeyType !== 'ed25519') return reject('EXECUTOR_ED25519_PUBLIC_KEY_REQUIRED');
  if (typeof decision.nonce !== 'string' || !NONCE_PATTERN.test(decision.nonce)) return reject('INSTALL_NONCE_INVALID');
  if (!Number.isSafeInteger(decision.issuedAt) || !Number.isSafeInteger(decision.expiresAt) || decision.issuedAt > now || now >= decision.expiresAt || decision.expiresAt <= decision.issuedAt || decision.expiresAt - decision.issuedAt > MAX_GRANT_MS) return reject('INSTALL_TIME_INVALID');
  if (!Number.isSafeInteger(decision.maxUses) || decision.maxUses < 1 || decision.maxUses > MAX_USES) return reject('INSTALL_USE_BOUND_INVALID');
  const proof = challenge(decision.strategy);
  if (decision.implementationHash === proof.implementationHash && canonical(decision.proof) === canonical(proof) && proof.passed === proof.total) {
    return { valid: true, reason: null };
  }
  if (allowLegacy) {
    const legacyProof = legacyChallenge(decision.strategy);
    if (decision.implementationHash === legacyProof.implementationHash && canonical(decision.proof) === canonical(legacyProof) && legacyProof.passed === legacyProof.total) {
      return { valid: true, reason: null };
    }
  }
  return reject('INSTALL_PROOF_INVALID');
}

function verifyDetached(publicKey, payload, signature) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
  const bytes = Buffer.from(signature, 'base64url');
  if (bytes.length !== 64 || bytes.toString('base64url') !== signature) return false;
  try { return verifySignature(null, Buffer.from(payload), publicKey, bytes); }
  catch { return false; }
}
function verifyApproval(publicKey, decision, signature) {
  return verifyDetached(publicKey, approvalPayload(decision), signature);
}

function recordHash(record) {
  return hash({ sequence: record.sequence, previous: record.previous, timestamp: record.timestamp, decision: record.decision, signature: record.signature ?? null });
}

function apply(state, record, publicKey, { allowLegacy = false } = {}) {
  if (!record || !exactKeys(record, ['sequence', 'previous', 'timestamp', 'decision', 'signature', 'hash'])) throw new Error('RECORD_SCHEMA_INVALID');
  if (record.sequence !== state.sequence + 1 || record.previous !== state.previous) throw new Error('BROKEN_CHAIN');
  if (!Number.isSafeInteger(record.timestamp) || record.timestamp < 0) throw new Error('RECORD_TIME_INVALID');
  const priorTimestamp = state.records.at(-1)?.timestamp ?? 0;
  if (record.timestamp < priorTimestamp) throw new Error('RECORD_TIME_REGRESSION');
  if (record.hash !== recordHash(record)) throw new Error('BAD_RECORD_HASH');
  const decision = record.decision;
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) throw new Error('DECISION_INVALID');

  if (decision.kind === 'INSTALL') {
    if (!verifyApproval(publicKey, decision, record.signature)) throw new Error('UNAUTHORIZED');
    const validation = validateInstallationProposal(decision, record.timestamp, { allowLegacy });
    if (!validation.valid) throw new Error(validation.reason);
    if (Object.hasOwn(state.capabilities, decision.id)) throw new Error('ALREADY_INSTALLED');
    if (state.installationNonces.includes(decision.nonce)) throw new Error('INSTALL_NONCE_REUSED');
    state.capabilities[decision.id] = {
      id: decision.id,
      strategy: decision.strategy,
      proof: decision.proof,
      implementationHash: decision.implementationHash,
      installedAt: record.timestamp,
      issuedAt: decision.issuedAt,
      expiresAt: decision.expiresAt,
      maxUses: decision.maxUses,
      uses: 0,
      installationNonce: decision.nonce,
      executorPublicKeyPem: decision.executorPublicKeyPem
    };
    state.installationNonces.push(decision.nonce);
  } else if (decision.kind === 'REUSE') {
    if (!exactKeys(decision, ['kind', 'id', 'nonce', 'input', 'output'])) throw new Error('REUSE_SCHEMA_INVALID');
    if (!Object.hasOwn(state.capabilities, decision.id)) throw new Error('CAPABILITY_NOT_FOUND');
    const capability = state.capabilities[decision.id];
    let executorKey;
    try { executorKey = createPublicKey(capability.executorPublicKeyPem); }
    catch { throw new Error('EXECUTOR_PUBLIC_KEY_INVALID'); }
    if (!verifyDetached(executorKey, executionReceiptPayload(decision), record.signature)) throw new Error('REUSE_UNAUTHORIZED');
    if (record.timestamp < capability.issuedAt || record.timestamp >= capability.expiresAt) throw new Error('GRANT_EXPIRED');
    if (!NONCE_PATTERN.test(decision.nonce || '') || state.used.includes(decision.nonce)) throw new Error('REPLAY');
    if (capability.uses >= capability.maxUses) throw new Error('GRANT_USE_LIMIT_REACHED');
    if (capability.implementationHash !== implementationHash(capability.strategy) && capability.implementationHash !== legacyImplementationHash(capability.strategy)) throw new Error('IMPLEMENTATION_HASH_MISMATCH');
    if (!Number.isSafeInteger(decision.input) || Math.abs(decision.input) > MAX_INPUT) throw new Error('INPUT_OUT_OF_BOUNDS');
    const implementation = implementationFor(capability.strategy);
    const expected = implementation(decision.input);
    if (!Number.isSafeInteger(decision.output) || decision.output !== expected) throw new Error('OUTPUT_MISMATCH');
    state.used.push(decision.nonce);
    capability.uses += 1;
  } else {
    throw new Error('UNKNOWN_DECISION');
  }

  state.records.push(record);
  state.sequence = record.sequence;
  state.previous = record.hash;
  return state;
}

async function readBoundedRegularFile(path) {
  // Refuse symlinks even on platforms where O_NOFOLLOW is unavailable. Compare
  // the path entry with the opened handle before and after reading to detect swaps.
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error('LEDGER_NOT_REGULAR_FILE');
  if (before.size > MAX_LEDGER_BYTES) throw new Error('LEDGER_TOO_LARGE');

  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);
  const handle = await open(path, flags);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('LEDGER_NOT_REGULAR_FILE');
    if (stat.dev !== before.dev || stat.ino !== before.ino) throw new Error('LEDGER_PATH_CHANGED');
    if (stat.size > MAX_LEDGER_BYTES) throw new Error('LEDGER_TOO_LARGE');
    const bytes = await handle.readFile();
    const after = await lstat(path);
    if (after.isSymbolicLink() || !after.isFile() ||
        after.dev !== stat.dev || after.ino !== stat.ino) throw new Error('LEDGER_PATH_CHANGED');
    if (bytes.length > MAX_LEDGER_BYTES) throw new Error('LEDGER_TOO_LARGE');
    return bytes;
  } finally { await handle.close(); }
}
async function readLedger(path, publicKey) {
  let bytes;
  try { bytes = await readBoundedRegularFile(path); }
  catch (error) { if (error.code === 'ENOENT') return initial(); throw error; }
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('LEDGER_JSON_INVALID'); }
  if (parsed?.version !== 2) throw new Error('LEDGER_VERSION_UNSUPPORTED');
  if (!Array.isArray(parsed.records) || parsed.records.length > 100000) throw new Error('LEDGER_RECORDS_INVALID');
  const replay = initial();
  for (const record of parsed.records) apply(replay, record, publicKey, { allowLegacy: true });
  if (canonical(replay) !== canonical(parsed)) throw new Error('LEDGER_MISMATCH');
  return replay;
}

function descendantOf(current, snapshot) {
  if (current.sequence < snapshot.sequence) throw new Error('LEDGER_ROLLBACK_DETECTED');
  if (snapshot.sequence === 0) return;
  const ancestor = current.records[snapshot.sequence - 1];
  if (!ancestor || ancestor.hash !== snapshot.previous) throw new Error('LEDGER_FORK_DETECTED');
}

async function syncDirectory(directory) {
  const handle = await open(directory, fsConstants.O_RDONLY);
  try { await handle.sync(); }
  finally { await handle.close(); }
}

export async function openInstitution(directory, trustedPublicKeyPem) {
  if (typeof trustedPublicKeyPem !== 'string' || !trustedPublicKeyPem.includes('BEGIN PUBLIC KEY')) throw new Error('TRUSTED_PUBLIC_KEY_REQUIRED');
  const expectedFingerprint = TRUSTED_FOUNDER_KEY_FINGERPRINT;
  if (typeof expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(expectedFingerprint)) throw new Error('FOUNDER_KEY_FINGERPRINT_REQUIRED');
  let publicKey;
  try { publicKey = createPublicKey(trustedPublicKeyPem); }
  catch { throw new Error('TRUSTED_PUBLIC_KEY_INVALID'); }
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('ED25519_PUBLIC_KEY_REQUIRED');
  const actualFingerprint = hashBytes(publicKey.export({ type: 'spki', format: 'der' }));
  if (actualFingerprint !== expectedFingerprint) throw new Error('FOUNDER_KEY_FINGERPRINT_MISMATCH');

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const dirStat = await lstat(directory);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) throw new Error('INSTITUTION_DIRECTORY_UNSAFE');
  if ((dirStat.mode & 0o022) !== 0) throw new Error('INSTITUTION_DIRECTORY_PERMISSIONS_TOO_BROAD');
  const ledgerPath = join(directory, 'institution.json');
  const lockPath = join(directory, 'institution.json.lock');
  let state = await readLedger(ledgerPath, publicKey);
  let durabilityUncertain = false;

  return {
    snapshot: () => {
      if (durabilityUncertain) throw new Error('COMMIT_DURABILITY_UNCERTAIN');
      return structuredClone(state);
    },
    async commit(decision, signature = null) {
      if (durabilityUncertain) throw new Error('COMMIT_DURABILITY_UNCERTAIN');
      // Validate the caller's original value before structuredClone can discard
      // hidden properties or normalize an accessor-backed decision.
      canonical(decision);
      let lockHandle;
      let lockIdentity;
      let tempPath;
      try {
        lockHandle = await open(lockPath, 'wx', 0o600);
        const lockStat = await lockHandle.stat();
        lockIdentity = { dev: lockStat.dev, ino: lockStat.ino };
        await lockHandle.close();
        lockHandle = null;
      } catch (error) {
        if (error.code === 'EEXIST') throw new Error('LEDGER_LOCKED');
        throw error;
      }

      try {
        const current = await readLedger(ledgerPath, publicKey);
        descendantOf(current, state);
        const next = structuredClone(current);
        const record = {
          sequence: next.sequence + 1,
          previous: next.previous,
          timestamp: Date.now(),
          decision: structuredClone(decision),
          signature
        };
        record.hash = recordHash(record);
        apply(next, record, publicKey);

        tempPath = ledgerPath + '.tmp-' + randomUUID();
        const temp = await open(tempPath, 'wx', 0o600);
        try { await temp.writeFile(canonical(next)); await temp.sync(); }
        finally { await temp.close(); }
        await rename(tempPath, ledgerPath);
        tempPath = null;
        try { await syncDirectory(directory); }
        catch {
          // The rename is visible, but durability is unknown. Do not promote the
          // in-memory snapshot or permit another commit until a fresh validated reopen.
          durabilityUncertain = true;
          throw new Error('COMMIT_DURABILITY_UNCERTAIN');
        }
        state = next;
        return structuredClone(record);
      } finally {
        if (tempPath) { try { await unlink(tempPath); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
        if (lockHandle) await lockHandle.close();
        if (lockIdentity) {
          try {
            const currentLock = await lstat(lockPath);
            if (currentLock.isFile() && currentLock.dev === lockIdentity.dev && currentLock.ino === lockIdentity.ino) await unlink(lockPath);
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      }
    }
  };
}
