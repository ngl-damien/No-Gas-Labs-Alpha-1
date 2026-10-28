import { createHash, createPublicKey, randomUUID, sign, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, chmod, open, rename, unlink, lstat } from 'node:fs/promises';
import { resolve, join, parse, sep } from 'node:path';
import { assertNoDuplicateJsonObjectKeys } from '../strict-json.mjs';

const MAX_JSON = 131072;
const MAX_STATE = 16 * 1024 * 1024;
const MAX_LOCK_METADATA = 4096;
const pending = new Set(['DISPATCHED', 'ACKNOWLEDGED']);
const statuses = new Set([...pending, 'RESPONDED', 'FAILED', 'EXPIRED', 'UNAVAILABLE']);
const queues = new Map();
const clone = value => JSON.parse(canonicalJSON(value));
function error(code, message) { return Object.assign(new Error(message), {code}); }
function requireValue(condition, code, message) { if (!condition) throw error(code, message); }
function token(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(value); }
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

/** Canonical UTF-8 JSON: lexicographic object keys, finite numbers, plain JSON only. */
export function canonicalJSON(value) {
  const seen = new Set();
  function encode(item, depth) {
    requireValue(depth <= 64, 'INVALID_INPUT', 'JSON nesting exceeds 64 levels');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number') { requireValue(Number.isFinite(item), 'INVALID_INPUT', 'JSON numbers must be finite'); return JSON.stringify(item); }
    requireValue(item && typeof item === 'object' && !seen.has(item), 'INVALID_INPUT', 'Expected acyclic plain JSON');
    seen.add(item);
    let result;
    if (Array.isArray(item)) {
      requireValue(Object.keys(item).length === item.length, 'INVALID_INPUT', 'Sparse or extended arrays are not JSON');
      result = `[${Array.from(item, child => encode(child, depth + 1)).join(',')}]`;
    } else {
      requireValue(Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null, 'INVALID_INPUT', 'Only plain JSON objects are accepted');
      requireValue(Object.getOwnPropertySymbols(item).length === 0, 'INVALID_INPUT', 'Symbol keys are not JSON');
      const keys = Object.keys(item).sort();
      requireValue(keys.every(key => Object.getOwnPropertyDescriptor(item,key)?.get === undefined && Object.getOwnPropertyDescriptor(item,key)?.set === undefined), 'INVALID_INPUT', 'JSON accessors are not accepted');
      result = `{${keys.map(key => `${JSON.stringify(key)}:${encode(item[key], depth + 1)}`).join(',')}}`;
    }
    seen.delete(item);
    return result;
  }
  return encode(value, 0);
}
export function payloadDigest(payload) { return createHash('sha256').update(canonicalJSON(payload), 'utf8').digest('hex'); }
export function signEnvelope(payload, privateKey) {
  const bytes = canonicalJSON(payload);
  return {payload:JSON.parse(bytes), signature:sign(null, Buffer.from(bytes), privateKey).toString('base64')};
}
function boundedJSON(value, label = 'Input', limit = MAX_JSON) {
  const encoded = canonicalJSON(value);
  requireValue(Buffer.byteLength(encoded) <= limit, 'INVALID_INPUT', `${label} exceeds ${limit} UTF-8 bytes`);
  return JSON.parse(encoded);
}
function normalizeProviders(providers) {
  requireValue(Array.isArray(providers) && providers.length <= 64, 'INVALID_PROVIDER', 'At most 64 enrolled providers are accepted');
  const seen = new Set();
  return providers.map(provider => {
    requireValue(provider && token(provider.id) && !seen.has(provider.id), 'INVALID_PROVIDER', 'Provider IDs must be unique safe identifiers'); seen.add(provider.id);
    requireValue(Array.isArray(provider.capabilities) && provider.capabilities.length <= 64 && provider.capabilities.every(token), 'INVALID_PROVIDER', 'Provider capabilities must be identifiers');
    let key;
    try { key = createPublicKey(provider.publicKey); } catch { throw error('INVALID_PROVIDER', 'An enrolled Ed25519 public key is required'); }
    requireValue(key.asymmetricKeyType === 'ed25519', 'INVALID_PROVIDER', 'Only Ed25519 keys are accepted');
    const publicKey = key.export({type:'spki',format:'pem'}).toString();
    return {id:provider.id, publicKey, fingerprint:payloadDigest(publicKey), capabilities:[...new Set(provider.capabilities)].sort(), available:provider.available !== false};
  }).sort((a,b) => a.id.localeCompare(b.id));
}
function packetFor(request, seat) {
  const payload = {schema:'ngl.courier.dispatch.v1', requestId:request.requestId, providerId:seat.providerId, capability:request.capability, nonce:request.nonce, input:request.input, issuedAt:request.issuedAt, expiresAt:request.expiresAt};
  return {schema:'ngl.courier.packet.v1', payload:clone(payload), digest:payloadDigest(payload)};
}
function aggregate(request) {
  const values = request.seats.map(seat => seat.status);
  if (!values.length || values.every(value => value === 'UNAVAILABLE')) return 'UNAVAILABLE';
  if (values.every(value => value === 'RESPONDED')) return 'RESPONDED';
  if (values.includes('DISPATCHED')) return 'DISPATCHED';
  if (values.includes('ACKNOWLEDGED')) return 'ACKNOWLEDGED';
  if (values.includes('FAILED')) return 'FAILED';
  if (values.includes('EXPIRED')) return 'EXPIRED';
  return 'FAILED'; // A partial set of responses never completes the Council request.
}
function receiptCheck(state, envelope, kind, expected) {
  requireValue(exactKeys(envelope,['payload','signature']) && typeof envelope.signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(envelope.signature), 'INVALID_SIGNATURE', 'Expected an Ed25519 signed envelope');
  const p = envelope.payload;
  const fields = ['schema','request','requestDigest','at', ...(kind === 'ack' ? ['accepted'] : ['output','dissent'])];
  requireValue(exactKeys(p, fields) && p.schema === `ngl.courier.${kind}.v1`, 'INVALID_RECEIPT', 'Receipt schema or fields are invalid');
  boundedJSON(p, 'Receipt', 524288);
  if(kind === 'reply') boundedJSON(p.output, 'Reply output');
  const request = state.requests.find(r => r.requestId === p.request?.requestId);
  const seat = request?.seats.find(s => s.providerId === p.request?.providerId);
  requireValue(request && seat, 'REQUEST_MISMATCH', 'Receipt does not address an existing request and seat');
  if(expected) requireValue(expected.request === request && expected.seat === seat, 'REQUEST_MISMATCH', 'Persisted receipt does not bind its enclosing request and seat');
  const packet = packetFor(request,seat);
  requireValue(canonicalJSON(p.request) === canonicalJSON(packet.payload) && p.requestDigest === packet.digest, 'REQUEST_MISMATCH', 'Receipt does not bind the exact dispatched bytes');
  const provider = state.providers.find(item => item.id === seat.providerId);
  requireValue(provider && provider.capabilities.includes(request.capability), 'UNAVAILABLE', 'Seat has no enrolled key for this capability');
  let valid = false;
  try { valid = verify(null, Buffer.from(canonicalJSON(p)), provider.publicKey, Buffer.from(envelope.signature,'base64')); } catch {}
  requireValue(valid, 'INVALID_SIGNATURE', 'Receipt signature does not match the enrolled provider key');
  requireValue(Number.isSafeInteger(p.at) && p.at >= request.issuedAt && p.at < request.expiresAt, 'INVALID_RECEIPT', 'Receipt timestamp is outside its request lifetime');
  if (kind === 'ack') requireValue(p.accepted === true, 'INVALID_RECEIPT', 'A positive acknowledgment must accept delivery');
  else requireValue(p.dissent === null || (typeof p.dissent === 'string' && p.dissent.length <= 16000), 'INVALID_RECEIPT', 'Dissent must be null or text');
  return {request, seat};
}
function validateState(state) {
  try {
    requireValue(exactKeys(state,['schema','revision','providers','requests','checksum']) && state.schema === 'ngl.courier.state.v1', 'CORRUPT_STATE', 'Unknown state schema');
    const {checksum,...body} = state;
    requireValue(checksum === payloadDigest(body), 'CORRUPT_STATE', 'Courier state checksum mismatch');
    requireValue(Number.isSafeInteger(state.revision) && state.revision >= 0 && Array.isArray(state.requests), 'CORRUPT_STATE', 'Invalid state shape');
    requireValue(canonicalJSON(normalizeProviders(state.providers)) === canonicalJSON(state.providers), 'CORRUPT_STATE', 'Enrollment data is malformed');
    const ids = new Set();
    for (const r of state.requests) {
      requireValue(exactKeys(r,['requestId','capability','input','nonce','issuedAt','expiresAt','seats','status']) && token(r.requestId) && token(r.capability) && token(r.nonce) && !ids.has(r.requestId), 'CORRUPT_STATE', 'Invalid or duplicate request'); ids.add(r.requestId);
      boundedJSON(r.input);
      requireValue(Number.isSafeInteger(r.issuedAt) && Number.isSafeInteger(r.expiresAt) && r.issuedAt < r.expiresAt && Array.isArray(r.seats) && r.seats.length <= 64, 'CORRUPT_STATE', 'Invalid request lifetime or seats');
      const seats = new Set();
      for (const s of r.seats) {
        requireValue(exactKeys(s,['providerId','status','reason','acknowledgment','response']) && token(s.providerId) && !seats.has(s.providerId) && statuses.has(s.status), 'CORRUPT_STATE', 'Invalid or duplicate seat'); seats.add(s.providerId);
        requireValue(s.reason === null || typeof s.reason === 'string', 'CORRUPT_STATE', 'Invalid failure detail');
        if (s.acknowledgment) receiptCheck(state,s.acknowledgment,'ack',{request:r,seat:s});
        if (s.response) { receiptCheck(state,s.response,'reply',{request:r,seat:s}); requireValue(s.acknowledgment && s.response.payload.at >= s.acknowledgment.payload.at, 'CORRUPT_STATE','Response lacks a prior acknowledgment'); }
        requireValue((s.status === 'RESPONDED') === Boolean(s.response), 'CORRUPT_STATE','Response status does not match its receipt');
        requireValue(s.status !== 'ACKNOWLEDGED' || Boolean(s.acknowledgment), 'CORRUPT_STATE','Ack status lacks its receipt');
        requireValue(s.status !== 'DISPATCHED' || !s.acknowledgment, 'CORRUPT_STATE','Dispatch status already has an ack');
      }
      requireValue(r.status === aggregate(r), 'CORRUPT_STATE', 'Aggregate request status mismatch');
    }
  } catch (cause) { if (cause.code === 'CORRUPT_STATE') throw cause; throw error('CORRUPT_STATE', `Invalid courier state: ${cause.message}`); }
  return state;
}
async function readState(path) {
  let file;
  try {
    // O_NONBLOCK prevents a hostile FIFO at courier.json from blocking startup
    // before fstat can establish that the opened object is a regular file.
    file = await open(path, constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const before = await file.stat();
    requireValue(before.isFile(), 'CORRUPT_STATE', 'Courier state must be a regular file');
    requireValue(before.size <= MAX_STATE, 'CORRUPT_STATE', 'Courier state exceeds size limit');

    // Do not trust a pre-read size check as a bound: a concurrently modified file
    // could grow after fstat. Read at most MAX_STATE + 1 bytes, then fail closed.
    const chunks = [];
    const buffer = Buffer.alloc(64 * 1024);
    let total = 0;
    while (true) {
      const length = Math.min(buffer.length, MAX_STATE + 1 - total);
      const { bytesRead } = await file.read(buffer, 0, length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      requireValue(total <= MAX_STATE, 'CORRUPT_STATE', 'Courier state exceeds size limit');
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }

    const after = await file.stat();
    let currentPath;
    try { currentPath = await lstat(path); }
    catch (pathError) {
      if (pathError.code === 'ENOENT') throw error('CORRUPT_STATE', 'Courier state path changed during read');
      throw pathError;
    }
    requireValue(currentPath.isFile() &&
      sameLockSnapshot(before, after) &&
      sameLockSnapshot(after, currentPath) &&
      total === after.size,
      'CORRUPT_STATE', 'Courier state changed during read');

    const bytes = Buffer.concat(chunks, total);
    const decoded = bytes.toString('utf8');
    requireValue(Buffer.from(decoded, 'utf8').equals(bytes),
      'CORRUPT_STATE', 'Courier state is not valid UTF-8');
    return validateState(JSON.parse(decoded));
  } catch (cause) {
    if (cause.code === 'ENOENT') return null;
    if (cause.code === 'CORRUPT_STATE') throw cause;
    throw error('CORRUPT_STATE', `Cannot read courier state: ${cause.message}`);
  } finally { await file?.close(); }
}
async function syncCourierDirectory(dir) {
  const directory = await open(dir, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
async function writeState(dir, state, syncDirectoryFn = syncCourierDirectory) {
  const {checksum:ignored,...body} = state;
  const encoded = canonicalJSON({...body,checksum:payloadDigest(body)});
  requireValue(Buffer.byteLength(encoded) <= MAX_STATE, 'STORAGE_LIMIT', 'Courier state exceeds its storage limit');
  const temporary = join(dir, `.courier-${randomUUID()}.tmp`);
  let file;
  let renamed = false;
  try {
    file = await open(temporary,'wx',0o600); await file.writeFile(encoded); await file.sync(); await file.close(); file=null;
    await rename(temporary,join(dir,'courier.json'));
    renamed = true;
    try { await syncDirectoryFn(dir); }
    catch (cause) {
      throw Object.assign(error('COMMIT_DURABILITY_UNCERTAIN',
        'Courier state replacement succeeded but directory durability could not be confirmed; discard this instance and reopen to validate retained state before further operations.'), { cause });
    }
  } finally {
    await file?.close().catch(() => {});
    // Once renamed, the target may already expose the new state. Never roll it back.
    if (!renamed) await unlink(temporary).catch(cause=>{if(cause.code!=='ENOENT')throw cause;});
  }
}
async function assertNoSymlinkPathComponents(path) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let stat;
    try { stat = await lstat(current); }
    catch (cause) { if (cause.code === 'ENOENT') continue; throw cause; }
    if (stat.isSymbolicLink()) {
      throw error('INVALID_INPUT', 'Courier storage paths may not contain symlink components');
    }
    if (!stat.isDirectory()) {
      throw error('INVALID_INPUT', 'Every courier storage path component must be a directory');
    }
  }
}
function sameLockSnapshot(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid &&
    a.mode === b.mode && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
function courierLockUnsafeReason(stat) {
  if (!stat.isFile()) return 'not-a-regular-file';
  if ((stat.mode & 0o077) !== 0) return 'permissions-too-broad';
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) return 'owner-mismatch';
  return null;
}

async function releaseOwnedLock(path, identity) {
  if (!identity) return false;
  let current;
  try { current = await lstat(path); }
  catch (cause) { if (cause.code === 'ENOENT') return false; throw cause; }
  if (current.isSymbolicLink() || !current.isFile() ||
      current.dev !== identity.dev || current.ino !== identity.ino) return false;
  // This identity check is best-effort: filesystems do not expose an atomic
  // compare-and-unlink primitive, so callers must not treat it as a full race-free lease.
  try { await unlink(path); }
  catch (cause) { if (cause.code === 'ENOENT') return false; throw cause; }
  return true;
}
async function acquireLock(path) {
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      const lock = await open(path, 'wx', 0o600);
      let identity;
      try {
        const opened = await lock.stat();
        identity = { dev: opened.dev, ino: opened.ino };
        await lock.writeFile(JSON.stringify({
          schema: 'ngl.courier-lock.v1',
          pid: process.pid,
          openedAt: new Date().toISOString()
        }));
        await lock.sync();
        await lock.close();
        return identity;
      } catch (cause) {
        await lock.close().catch(() => {});
        if (identity) await releaseOwnedLock(path, identity).catch(() => {});
        throw cause;
      }
    } catch (cause) {
      if (cause.code !== 'EEXIST') throw cause;
      let owner, identity, file;
      try {
        const before = await lstat(path);
        if (before.isSymbolicLink() || !before.isFile()) {
          throw error('UNSAFE_LOCK', 'Courier lock path must be a regular non-symlink file; preserve it and inspect offline.');
        }
        const beforeUnsafe = courierLockUnsafeReason(before);
        if (beforeUnsafe) {
          throw error('UNSAFE_LOCK', `Courier lock metadata file is unsafe (${beforeUnsafe}); preserve it and inspect offline.`);
        }
        requireValue(before.size <= MAX_LOCK_METADATA, 'CORRUPT_LOCK',
          `Courier lock metadata exceeds ${MAX_LOCK_METADATA} bytes; preserve the lock and inspect offline.`);
        file = await open(path, constants.O_RDONLY |
          (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        try {
          const opened = await file.stat();
          if (!opened.isFile()) {
            throw error('UNSAFE_LOCK', 'Courier lock changed to a non-regular file; preserve it and inspect offline.');
          }
          const openedUnsafe = courierLockUnsafeReason(opened);
          if (openedUnsafe) {
            throw error('UNSAFE_LOCK', `Courier lock metadata file is unsafe (${openedUnsafe}); preserve it and inspect offline.`);
          }
          if (!sameLockSnapshot(before, opened)) continue;
          requireValue(opened.size <= MAX_LOCK_METADATA, 'CORRUPT_LOCK',
            `Courier lock metadata exceeds ${MAX_LOCK_METADATA} bytes; preserve the lock and inspect offline.`);

          // Bound bytes consumed even if the lock grows after the initial stat.
          // O_NONBLOCK also prevents a path swapped to a FIFO from hanging open().
          const chunks = [];
          const buffer = Buffer.alloc(1024);
          let total = 0;
          while (true) {
            const length = Math.min(buffer.length, MAX_LOCK_METADATA + 1 - total);
            const { bytesRead } = await file.read(buffer, 0, length, null);
            if (bytesRead === 0) break;
            total += bytesRead;
            requireValue(total <= MAX_LOCK_METADATA, 'CORRUPT_LOCK',
              `Courier lock metadata exceeds ${MAX_LOCK_METADATA} bytes; preserve the lock and inspect offline.`);
            chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
          }
          const bytes = Buffer.concat(chunks, total);
          const afterHandle = await file.stat();
          let afterPath;
          try { afterPath = await lstat(path); }
          catch (readError) { if (readError.code === 'ENOENT') continue; throw readError; }
          if (afterPath.isSymbolicLink() || !afterPath.isFile()) {
            throw error('UNSAFE_LOCK', 'Courier lock path changed to a non-regular file; preserve it and inspect offline.');
          }
          if (!sameLockSnapshot(opened, afterHandle) ||
              !sameLockSnapshot(opened, afterPath) || total !== opened.size || bytes.length !== opened.size) continue;
          const decoded = bytes.toString('utf8');
          if (!Buffer.from(decoded, 'utf8').equals(bytes)) {
            throw error('CORRUPT_LOCK', 'Courier lock metadata is not valid UTF-8; preserve the lock and inspect offline.');
          }
          try {
            assertNoDuplicateJsonObjectKeys(decoded, { label: 'COURIER_LOCK', maxDepth: 8 });
          } catch (parseError) {
            if (parseError.message === 'COURIER_LOCK_DUPLICATE_JSON_KEY') {
              throw error('CORRUPT_LOCK',
                'Courier lock metadata contains duplicate JSON keys; preserve the lock and inspect offline.');
            }
            if (parseError.message === 'COURIER_LOCK_JSON_INVALID') {
              // A newly-created lock is visible before its small metadata write
              // necessarily finishes. Retry malformed snapshots with a bounded
              // delay, then classify a persistent malformed lock as corruption.
              await new Promise(resolve => setTimeout(resolve, 20));
              if (Date.now() >= deadline) {
                throw error('CORRUPT_LOCK',
                  'Courier lock metadata remained malformed through the acquisition timeout; preserve it and inspect offline.');
              }
              continue;
            }
            throw error('CORRUPT_LOCK',
              'Courier lock metadata exceeds parser limits or is malformed; preserve the lock and inspect offline.');
          }
          try { owner = JSON.parse(decoded); }
          catch {
            await new Promise(resolve => setTimeout(resolve, 20));
            if (Date.now() >= deadline) {
              throw error('CORRUPT_LOCK',
                'Courier lock metadata remained invalid JSON through the acquisition timeout; preserve it and inspect offline.');
            }
            continue;
          }
          identity = { dev: opened.dev, ino: opened.ino };
        } finally {
          await file.close();
          file = undefined;
        }
      } catch (readError) {
        if (readError.code === 'ENOENT') continue;
        if (readError.code === 'ELOOP') {
          throw error('UNSAFE_LOCK', 'Courier lock path became a symlink while opening; preserve it and inspect offline.');
        }
        throw readError;
      } finally {
        await file?.close().catch(() => {});
      }

      if (!owner || typeof owner !== 'object' || Array.isArray(owner)) {
        throw error('CORRUPT_LOCK', 'Courier lock metadata must be a JSON object; preserve the lock and inspect offline.');
      }
      const ownerKeys = Object.keys(owner).sort().join('\0');
      if (Object.hasOwn(owner, 'schema')) {
        requireValue(owner.schema === 'ngl.courier-lock.v1' &&
          ownerKeys === ['openedAt', 'pid', 'schema'].sort().join('\0') &&
          Number.isSafeInteger(owner.pid) && owner.pid > 0 &&
          typeof owner.openedAt === 'string' && Number.isFinite(Date.parse(owner.openedAt)),
          'CORRUPT_LOCK', 'Courier lock metadata schema or fields are invalid; preserve the lock and inspect offline.');
      } else {
        // Accept the historical pid-only lock used by pre-schema releases, but
        // never interpret arbitrary fields as owner metadata.
        requireValue(Number.isSafeInteger(owner.pid) && owner.pid > 0 &&
          Object.keys(owner).every(key => ['pid', 'openedAt'].includes(key)) &&
          (owner.openedAt === undefined || typeof owner.openedAt === 'string'),
          'CORRUPT_LOCK', 'Legacy courier lock metadata is invalid; preserve the lock and inspect offline.');
      }

      if (Number.isInteger(owner?.pid) && owner.pid > 0) {
        try {
          process.kill(owner.pid, 0);
        } catch (probeError) {
          if (probeError.code === 'ESRCH') {
            // The owner may have unlinked this inode and another process may
            // already own the same pathname. Only report stale if the exact
            // observed inode still occupies the path after the failed probe.
            let current;
            try { current = await lstat(path); }
            catch (pathError) { if (pathError.code === 'ENOENT') continue; throw pathError; }
            if (current.isSymbolicLink() || !current.isFile() ||
                current.dev !== identity?.dev || current.ino !== identity?.ino) continue;
            try { process.kill(owner.pid, 0); continue; }
            catch (recheckError) {
              if (recheckError.code === 'ESRCH') {
                throw error('STALE_LOCK','Courier lock belongs to a stopped process. Stop every courier process and explicitly remove .courier.lock before retrying.');
              }
            }
          }
        }
      }
      requireValue(Date.now()<deadline,'BUSY','Courier is locked by another process');
      await new Promise(resolve=>setTimeout(resolve,20));
    }
  }
}
async function serialize(dir, fn) {
  const previous=queues.get(dir) || Promise.resolve();
  const current=previous.catch(()=>{}).then(async()=>{
    const lock=join(dir,'.courier.lock');
    const identity=await acquireLock(lock);
    try { return await fn(); }
    finally {
      if (!(await releaseOwnedLock(lock, identity))) {
        throw error('LOCK_OWNERSHIP_LOST',
          'Courier lock path changed before release; the operation may have committed. Inspect durable state before retrying.');
      }
    }
  });
  queues.set(dir,current);
  try { return await current; } finally { if(queues.get(dir)===current)queues.delete(dir); }
}
function expire(state, time) {
  for(const r of state.requests) {
    if(time >= r.expiresAt) for(const s of r.seats) if(pending.has(s.status)) { s.status='EXPIRED'; s.reason='No complete signed response before expiry'; }
    r.status=aggregate(r);
  }
}

/** Durable file courier. It never calls a model provider or grants Founder authority. */
export async function createCourier({dataDir,providers,now=Date.now,syncDirectory:syncDirectoryFn=syncCourierDirectory}={}) {
  requireValue(typeof dataDir === 'string' && dataDir.length>0 && typeof now === 'function' && typeof syncDirectoryFn === 'function','INVALID_INPUT','A private courier dataDir, clock, and directory-sync function are required');
  const dir=resolve(dataDir), path=join(dir,'courier.json');
  await assertNoSymlinkPathComponents(dir);
  await mkdir(dir,{recursive:true,mode:0o700});
  await assertNoSymlinkPathComponents(dir);
  const directoryStat = await lstat(dir);
  requireValue(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(),'INVALID_INPUT','Courier dataDir must be a directory');
  await chmod(dir,0o700);
  const enrolled=providers === undefined ? undefined : normalizeProviders(providers);
  let uncertain = false;
  let leaseLost = false;
  await serialize(dir,async()=>{
    const stored=await readState(path);
    if(stored) {
      if(enrolled)requireValue(canonicalJSON(stored.providers)===canonicalJSON(enrolled),'IDENTITY_CONFLICT','Persisted provider enrollment differs; use a separate store for a new key registry');
    } else await writeState(dir,{schema:'ngl.courier.state.v1',revision:0,providers:enrolled || [],requests:[]},syncDirectoryFn);
  });
  function timeNow() { const time=now(); requireValue(Number.isSafeInteger(time),'INVALID_INPUT','Clock must return integer milliseconds');return time; }
  async function transaction(operation) {
    if (leaseLost) throw error('LOCK_OWNERSHIP_LOST',
      'A prior operation lost the courier lock; inspect durable state and reopen a fresh courier instance before retrying.');
    if (uncertain) throw error('COMMIT_DURABILITY_UNCERTAIN',
      'Courier state replacement may have committed without confirmed directory durability; reopen a fresh courier instance before further operations.');
    try {
      return await serialize(dir,async()=>{
        if (leaseLost) throw error('LOCK_OWNERSHIP_LOST',
          'A prior operation lost the courier lock; inspect durable state and reopen a fresh courier instance before retrying.');
        if (uncertain) throw error('COMMIT_DURABILITY_UNCERTAIN',
          'Courier state replacement may have committed without confirmed directory durability; reopen a fresh courier instance before further operations.');
        const state=await readState(path); requireValue(state,'CORRUPT_STATE','Courier state disappeared');
        const before=canonicalJSON(state); expire(state,timeNow());
        let result, failure;
        try { result=operation(state,timeNow()); } catch(cause) { failure=cause; }
        if(canonicalJSON(state)!==before) {
          state.revision++;
          try { await writeState(dir,state,syncDirectoryFn); }
          catch (cause) {
            if (cause.code === 'COMMIT_DURABILITY_UNCERTAIN') uncertain = true;
            throw cause;
          }
        }
        if(failure)throw failure;
        if(result?.schema === 'ngl.courier.snapshot.v1') result.revision=state.revision;
        return clone(result);
      });
    } catch (cause) {
      if (cause.code === 'LOCK_OWNERSHIP_LOST') leaseLost = true;
      throw cause;
    }
  }
  return {
    async dispatch(args={}) {
      // Capture detached JSON before joining the mutation queue.
      const input=boundedJSON(args.input), options={...args,input};
      if(args.providerIds !== undefined) options.providerIds=boundedJSON(args.providerIds, 'Provider IDs');
      return transaction((state,time)=>{
        const {capability}=options; requireValue(token(capability),'INVALID_INPUT','Capability must be an identifier');
        const requestId=options.requestId ?? randomUUID(); requireValue(token(requestId),'INVALID_INPUT','Request ID must be an identifier');
        let ids=options.providerIds ?? state.providers.filter(p=>p.capabilities.includes(capability)).map(p=>p.id);
        requireValue(Array.isArray(ids) && ids.length<=64 && ids.every(token) && new Set(ids).size===ids.length,'INVALID_INPUT','Provider IDs must be unique identifiers'); ids=[...ids].sort();
        const existing=state.requests.find(r=>r.requestId===requestId);
        if(existing) {
          requireValue(existing.capability===capability && canonicalJSON(existing.input)===canonicalJSON(input) && canonicalJSON(existing.seats.map(s=>s.providerId))===canonicalJSON(ids) && (options.nonce===undefined || options.nonce===existing.nonce) && (options.expiresAt===undefined || options.expiresAt===existing.expiresAt),'CONFLICT','Request ID already binds different dispatch bytes');
          return existing;
        }
        const nonce=options.nonce ?? randomUUID(), expiresAt=options.expiresAt ?? time+300000;
        requireValue(token(nonce) && Number.isSafeInteger(expiresAt) && expiresAt>time && expiresAt<=time+7*86400000,'INVALID_INPUT','Nonce and expiry must be valid; maximum lifetime is seven days');
        const request={requestId,capability,input,nonce,issuedAt:time,expiresAt,seats:ids.map(providerId=>{
          const provider=state.providers.find(p=>p.id===providerId);
          const available=provider?.available && provider.capabilities.includes(capability);
          return {providerId,status:available?'DISPATCHED':'UNAVAILABLE',reason:available?null:'Provider is unavailable or not enrolled for this capability',acknowledgment:null,response:null};
        }),status:'DISPATCHED'};
        request.status=aggregate(request);state.requests.push(request);return request;
      });
    },
    async acknowledge(envelope) { return importReceipt(boundedJSON(envelope,'Envelope',524288),'ack'); },
    async respond(envelope) { return importReceipt(boundedJSON(envelope,'Envelope',524288),'reply'); },
    async fail({requestId,providerId,reason}={}) {
      requireValue(typeof reason==='string' && reason.trim().length>0 && reason.length<=2000,'INVALID_INPUT','A bounded failure reason is required');
      return transaction(state=>{
        const request=state.requests.find(r=>r.requestId===requestId), seat=request?.seats.find(s=>s.providerId===providerId);
        requireValue(seat,'NOT_FOUND','Request seat was not found');
        if(seat.status==='FAILED' && seat.reason===reason)return request;
        requireValue(pending.has(seat.status),'CONFLICT','Terminal seats cannot be changed');
        seat.status='FAILED';seat.reason=reason;request.status=aggregate(request);return request;
      });
    },
    async snapshot() { return transaction(state=>({schema:'ngl.courier.snapshot.v1',revision:state.revision,providers:state.providers.map(({publicKey,...provider})=>provider),requests:state.requests,limitations:['Signatures authenticate enrolled keys; they do not prove human identity or factual truth.','Council responses do not grant Founder permissions.','No external provider is called by this file transport.']})); },
    async exportDispatch(requestId,providerId) { return transaction(state=>{
      const request=state.requests.find(r=>r.requestId===requestId),seat=request?.seats.find(s=>s.providerId===providerId);
      requireValue(seat,'NOT_FOUND','Request seat was not found');
      requireValue(pending.has(seat.status),'CONFLICT','Only pending delivery packets may be exported');
      return packetFor(request,seat);
    }); }
  };
  function importReceipt(envelope,kind) {
    return transaction((state,time)=>{
      const {request,seat}=receiptCheck(state,envelope,kind);
      const field=kind==='ack'?'acknowledgment':'response';
      if(seat[field]) { requireValue(canonicalJSON(seat[field])===canonicalJSON(envelope),'CONFLICT','Seat already contains a different signed receipt'); return request; }
      requireValue(seat.status!=='EXPIRED' && time<request.expiresAt,'EXPIRED','Request has expired');
      requireValue(envelope.payload.at<=time,'INVALID_RECEIPT','Receipt timestamp is in the future');
      requireValue(pending.has(seat.status),'CONFLICT','Terminal seats cannot accept new receipts');
      if(kind==='reply') requireValue(seat.acknowledgment && envelope.payload.at>=seat.acknowledgment.payload.at,'ACK_REQUIRED','A response requires a prior signed acknowledgment');
      seat[field]=envelope;seat.status=kind==='ack'?'ACKNOWLEDGED':'RESPONDED';request.status=aggregate(request);return request;
    });
  }
}
