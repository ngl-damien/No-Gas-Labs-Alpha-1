import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { link, mkdir, open, rename, unlink, lstat } from 'node:fs/promises';
import { join, parse, resolve, sep } from 'node:path';
import { canonicalStringify, artifactReceipt } from './kernel.mjs';

const STORE_SCHEMA = 'ngl.decisions.store.v1';
const PROJECTION_SCHEMA = 'ngl.decisions.projection.v1';
const SNAPSHOT_SCHEMA = 'ngl.decisions.snapshot.v1';
const MAX_WINDOW_MS = 30 * 86400000;
const MAX_EVALUATION_BYTES = 1024 * 1024;
const MAX_STORE_BYTES = 64 * 1024 * 1024;
const SYSTEM = { id: 'decision-service', role: 'system' };
const digest = value => createHash('sha256').update(canonicalStringify(value)).digest('hex');
const clone = value => JSON.parse(canonicalStringify(value));
const equal = (a, b) => canonicalStringify(a) === canonicalStringify(b);
const genesis = digest({ schema: STORE_SCHEMA, founderId: 'damien', evaluatorId: 'local-evaluator' });
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const text = (value, limit) => typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= limit;
function exact(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) fail(code, 'Unexpected or missing fields');
}
function json(value, code) {
  try { return clone(value); } catch { fail(code, 'Only finite, plain, acyclic JSON values are accepted'); }
}
function actorShape(actor, code = 'ACTOR_REQUIRED') {
  const value = json(actor, code);
  exact(value, ['id', 'role'], code);
  if (!identifier(value.id)) fail(code, 'A host-authenticated identity is required');
  return value;
}
function founder(actor) {
  const value = actorShape(actor, 'FOUNDER_REQUIRED');
  if (value.id !== 'damien' || value.role !== 'founder') fail('FOUNDER_REQUIRED', 'Only the host-authenticated Founder can authorize this operation');
  return value;
}
function creator(actor) {
  const value = actorShape(actor, 'CREATOR_REQUIRED');
  if (!(value.id === 'damien' && value.role === 'founder') && !(value.id === 'local-evaluator' && value.role === 'executor')) fail('CREATOR_REQUIRED', 'A host-authenticated Founder or enrolled local evaluator is required');
  return value;
}
function viewer(actor) {
  const value = actorShape(actor);
  if (!(value.id === 'damien' && value.role === 'founder') && !(value.id === 'local-evaluator' && value.role === 'executor') && value.role !== 'witness') fail('ACTOR_REQUIRED', 'A host-authenticated Founder, evaluator or Witness is required');
  return value;
}
function policyShape(input) {
  const value = json(input, 'INVALID_POLICY');
  exact(value, ['id', 'reviewWindowMs', 'basis'], 'INVALID_POLICY');
  if (!identifier(value.id) || !Number.isSafeInteger(value.reviewWindowMs) || value.reviewWindowMs < 1 || value.reviewWindowMs > MAX_WINDOW_MS || !text(value.basis, 16384)) fail('INVALID_POLICY', 'An explicit policy ID, positive interval up to 30 days and actual deadline basis are required');
  return value;
}
function proposalShape(input) {
  const value = json(input, 'INVALID_PROPOSAL');
  exact(value, ['id', 'title', 'evaluation', 'risks', 'rollback', 'proposedEffect'], 'INVALID_PROPOSAL');
  if (!identifier(value.id) || !text(value.title, 1000) || !Array.isArray(value.risks) || value.risks.length > 50 || value.risks.some(risk => !text(risk, 4000)) || !text(value.rollback, 16384) || !text(value.proposedEffect, 16384)) fail('INVALID_PROPOSAL', 'A bounded title, explicit risks, rollback route and proposed effect are required');
  exact(value.evaluation, ['bytes', 'receipt'], 'INVALID_PROPOSAL');
  exact(value.evaluation.receipt, ['algorithm', 'digest', 'size'], 'INVALID_PROPOSAL');
  if (typeof value.evaluation.bytes !== 'string' || !value.evaluation.bytes.length || Buffer.byteLength(value.evaluation.bytes, 'utf8') > MAX_EVALUATION_BYTES || !equal(artifactReceipt(value.evaluation.bytes), value.evaluation.receipt)) fail('INVALID_PROPOSAL', 'The supplied SHA-256 receipt must match the actual UTF-8 evaluation bytes (maximum 1 MiB)');
  return value;
}
function decisionShape(input) {
  const value = json(input, 'INVALID_DECISION');
  exact(value, ['decisionId', 'expectedRevision', 'requestId', 'action'], 'INVALID_DECISION');
  if (!identifier(value.decisionId) || !identifier(value.requestId) || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1 || !['APPROVE', 'REJECT', 'DEFER'].includes(value.action)) fail('INVALID_DECISION', 'A decision ID, positive expected revision, unique request ID and explicit disposition are required');
  return value;
}
function validTime(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000; }
function initial() { return { schema: PROJECTION_SCHEMA, revision: 0, lastAtMs: null, policy: null, policies: [], decisions: [], requests: [], audit: [] }; }
function isOverdue(decision, atMs) { return decision.status === 'PENDING' && Date.parse(decision.expiresAt) <= atMs; }
function expire(decision, atMs) {
  decision.status = 'EXPIRED'; decision.revision += 1; decision.expiredAt = new Date(atMs).toISOString();
}
function policyInput(policy) { return { id: policy.id, reviewWindowMs: policy.reviewWindowMs, basis: policy.basis }; }
function originalProposal(decision) {
  return { id: decision.id, title: decision.title, evaluation: decision.evaluation, risks: decision.risks, rollback: decision.rollback, proposedEffect: decision.proposedEffect };
}

/** Deterministic replay validates authority and derives every projection, including expiry. */
function reduce(previous, event) {
  exact(event, ['type', 'actor', 'atMs', 'input'], 'DECISIONS_TAMPERED');
  if (!validTime(event.atMs) || (previous.lastAtMs !== null && event.atMs < previous.lastAtMs)) fail('CLOCK_REGRESSION', 'Server time cannot precede committed history');
  const state = clone(previous);
  const at = new Date(event.atMs).toISOString();
  let result;
  let detail;
  switch (event.type) {
    case 'policy-set': {
      founder(event.actor);
      const policy = policyShape(event.input);
      if (state.policies.some(item => item.id === policy.id)) fail('POLICY_ID_REUSED', 'A policy ID already identifies an immutable policy');
      state.policy = { ...policy, revision: state.policies.length + 1, setAt: at };
      state.policies.push(state.policy);
      result = clone(state.policy);
      detail = { policyId: policy.id, policyRevision: state.policy.revision };
      break;
    }
    case 'proposal-created': {
      creator(event.actor);
      const proposal = proposalShape(event.input);
      if (!state.policy) fail('POLICY_UNCONFIGURED', 'No Founder-authorized review interval is configured');
      if (state.decisions.some(item => item.id === proposal.id)) fail('DECISION_ID_REUSED', 'A decision ID already identifies an immutable proposal');
      if (!validTime(event.atMs + state.policy.reviewWindowMs)) fail('INVALID_CLOCK', 'Review deadline exceeds the supported server clock range');
      const decision = { ...proposal, status: 'PENDING', revision: 1, createdAt: at, createdBy: event.actor.id, expiresAt: new Date(event.atMs + state.policy.reviewWindowMs).toISOString(), expiredAt: null, policy: { id: state.policy.id, revision: state.policy.revision }, disposition: null };
      state.decisions.push(decision);
      result = clone(decision);
      detail = { decisionId: decision.id, evaluationDigest: decision.evaluation.receipt.digest };
      break;
    }
    case 'decision-attempted': {
      founder(event.actor);
      const input = decisionShape(event.input);
      if (state.requests.some(item => item.requestId === input.requestId)) fail('REQUEST_ID_REUSED', 'Committed history must not repeat a decision request');
      const decision = state.decisions.find(item => item.id === input.decisionId);
      if (!decision) fail('DECISION_NOT_FOUND', 'The scoped decision does not exist');
      if (isOverdue(decision, event.atMs)) expire(decision, event.atMs);
      let outcome;
      if (decision.status === 'EXPIRED') outcome = { ok: false, code: 'DECISION_EXPIRED', message: 'The Founder-authorized review window has expired' };
      else if (input.expectedRevision !== decision.revision) outcome = { ok: false, code: 'REVISION_MISMATCH', message: 'The decision revision changed; review the current disposition' };
      else if (decision.status !== 'PENDING') outcome = { ok: false, code: 'DECISION_TERMINAL', message: 'This decision already has a terminal disposition; a new proposal is required' };
      else {
        decision.status = { APPROVE: 'APPROVED', REJECT: 'REJECTED', DEFER: 'DEFERRED' }[input.action];
        decision.revision += 1;
        decision.disposition = { action: input.action, actorId: event.actor.id, requestId: input.requestId, decidedAt: at };
        outcome = { ok: true, result: clone(decision) };
      }
      state.requests.push({ requestId: input.requestId, actorId: event.actor.id, input, outcome });
      result = clone(outcome);
      detail = { decisionId: input.decisionId, requestId: input.requestId, action: input.action, expectedRevision: input.expectedRevision, outcome: outcome.ok ? { ok: true, status: decision.status, revision: decision.revision } : outcome };
      break;
    }
    case 'expiry-observed': {
      if (!equal(event.actor, SYSTEM)) fail('ACTOR_REQUIRED', 'Only the host clock observer records expiry');
      exact(event.input, ['decisionIds'], 'DECISIONS_TAMPERED');
      const overdue = state.decisions.filter(item => isOverdue(item, event.atMs));
      if (!overdue.length || !equal(event.input.decisionIds, overdue.map(item => item.id))) fail('DECISIONS_TAMPERED', 'Expiry observation must match all actually overdue pending decisions');
      for (const decision of overdue) expire(decision, event.atMs);
      detail = { decisionIds: overdue.map(item => item.id) };
      result = null;
      break;
    }
    default: fail('DECISIONS_TAMPERED', 'Unrecognized decision history event');
  }
  state.revision += 1;
  state.lastAtMs = event.atMs;
  state.audit.push({ revision: state.revision, type: event.type, actor: clone(event.actor), at, ...detail });
  return { state, result };
}

async function syncDirectory(directory) {
  const parent = await open(directory, 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}

async function atomicWrite(file, bytes, directory, syncDirectoryFn = syncDirectory) {
  const pending = join(directory, `.decisions-${randomUUID()}.tmp`);
  let handle;
  let renamed = false;
  try {
    handle = await open(pending, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close(); handle = undefined;
    await rename(pending, file);
    renamed = true;
    try {
      await syncDirectoryFn(directory);
    } catch (cause) {
      throw Object.assign(new Error(
        'Decision replacement succeeded but directory durability could not be confirmed; close and reopen to validate the retained envelope before reading or writing again.'
      ), { code: 'COMMIT_DURABILITY_UNCERTAIN', status: 503, cause });
    }
  } finally {
    await handle?.close().catch(() => {});
    // The temporary name no longer exists after rename. Never roll back a target
    // whose replacement may already be visible after a failed directory sync.
    if (!renamed) await unlink(pending).catch(error => { if (error.code !== 'ENOENT') throw error; });
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
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink()) fail('INVALID_CONFIG', 'Decision storage paths may not contain symlink components');
    if (!stat.isDirectory()) fail('INVALID_CONFIG', 'Every decision storage path component must be a directory');
  }
}

async function assertPrivateDecisionDirectory(path, expectedIdentity) {
  await assertNoSymlinkPathComponents(path);
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('INVALID_CONFIG', 'The decision directory must be an actual directory, not a symbolic link');
  if ((stat.mode & 0o077) !== 0) fail('INVALID_CONFIG', 'Decision directory permissions must exclude group and other access (0700)');
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail('INVALID_CONFIG', 'Decision directory must be owned by the current process user');
  if (expectedIdentity && (stat.dev !== expectedIdentity.dev || stat.ino !== expectedIdentity.ino)) fail('INVALID_CONFIG', 'Decision directory changed while acquiring its writer lease');
  return { dev: stat.dev, ino: stat.ino };
}

async function readBoundedDecisionStore(path) {
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile()) fail('DECISIONS_TAMPERED', 'Persisted decisions must be a regular, non-symlink file');
  if ((before.mode & 0o077) !== 0) fail('DECISIONS_TAMPERED', 'Persisted decision permissions must exclude group and other access (0600)');
  if (typeof process.getuid === 'function' && before.uid !== process.getuid()) fail('DECISIONS_TAMPERED', 'Persisted decision file must be owned by the current process user');
  if (before.size > MAX_STORE_BYTES) fail('DECISIONS_TAMPERED', 'Persisted decisions exceed the 64 MiB limit');

  let handle;
  try {
    try {
      handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
    } catch (error) {
      if (error.code === 'ELOOP' || error.code === 'ENOENT') fail('DECISIONS_TAMPERED', 'Persisted decision file changed while opening');
      throw error;
    }
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) fail('DECISIONS_TAMPERED', 'Persisted decision file changed while opening');
    if ((opened.mode & 0o077) !== 0) fail('DECISIONS_TAMPERED', 'Persisted decision permissions must exclude group and other access (0600)');
    if (typeof process.getuid === 'function' && opened.uid !== process.getuid()) fail('DECISIONS_TAMPERED', 'Persisted decision file must be owned by the current process user');
    if (opened.size > MAX_STORE_BYTES) fail('DECISIONS_TAMPERED', 'Persisted decisions exceed the 64 MiB limit');
    if (opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) fail('DECISIONS_TAMPERED', 'Persisted decision file changed before reading');

    const chunks = [];
    let total = 0;
    let position = 0;
    while (total <= MAX_STORE_BYTES) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_STORE_BYTES + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
      position += bytesRead;
      if (total > MAX_STORE_BYTES) fail('DECISIONS_TAMPERED', 'Persisted decisions exceed the 64 MiB limit');
    }

    let after;
    try { after = await lstat(path); }
    catch (error) { if (error.code === 'ENOENT') fail('DECISIONS_TAMPERED', 'Persisted decision file disappeared during reading'); throw error; }
    const afterHandle = await handle.stat();
    if (after.isSymbolicLink() || !after.isFile() || after.dev !== opened.dev || after.ino !== opened.ino) fail('DECISIONS_TAMPERED', 'Persisted decision path changed during reading');
    const unchanged = stat => stat.size === opened.size && stat.mtimeMs === opened.mtimeMs && stat.ctimeMs === opened.ctimeMs;
    if (!unchanged(after) || !unchanged(afterHandle) || total !== opened.size) fail('DECISIONS_TAMPERED', 'Persisted decision file changed during reading');
    const bytes = Buffer.concat(chunks, total);
    const decoded = bytes.toString('utf8');
    if (!Buffer.from(decoded, 'utf8').equals(bytes)) fail('DECISIONS_TAMPERED', 'Persisted decisions are not valid UTF-8');
    return decoded;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function unlinkOwnedDecisionLock(path, identity) {
  if (!identity) return false;
  let current;
  try { current = await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) return false;
  await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  return true;
}

/**
 * Durable local dispositions. The host MUST authenticate the actor argument;
 * this API does not authenticate an object copied from a network payload.
 * APPROVE records a decision only and never invokes an effect or promotes code.
 */
export async function openDecisions({ directory, now = Date.now, syncDirectory: syncDirectoryFn = syncDirectory } = {}) {
  if (typeof directory !== 'string' || !directory || typeof now !== 'function' || typeof syncDirectoryFn !== 'function') fail('INVALID_CONFIG', 'A private decision directory, server clock function, and directory-sync function are required');
  const location = resolve(directory);
  // Reject pre-existing symlink ancestors before recursive mkdir can create anything through them.
  await assertNoSymlinkPathComponents(location);
  await mkdir(location, { recursive: true, mode: 0o700 });
  const directoryIdentity = await assertPrivateDecisionDirectory(location);
  const lockPath = join(location, '.decisions.lock');
  const lockTemporaryPath = join(location, `.decisions-lock-${randomUUID()}.tmp`);
  let lease;
  let leaseIdentity;
  let lockPublished = false;
  try {
    lease = await open(lockTemporaryPath, 'wx', 0o600);
    const lockStat = await lease.stat();
    leaseIdentity = { dev: lockStat.dev, ino: lockStat.ino };
    await lease.writeFile(canonicalStringify({ schema: 'ngl.decisions-lock.v1', pid: process.pid, openedAt: new Date().toISOString() }));
    await lease.sync();
    await assertPrivateDecisionDirectory(location, directoryIdentity);
    try {
      await link(lockTemporaryPath, lockPath);
      lockPublished = true;
    } catch (error) {
      if (error.code === 'EEXIST') {
        fail('DECISIONS_LOCKED', 'Another writer owns this directory; stale locks require explicit offline recovery');
      }
      throw error;
    }
    await unlink(lockTemporaryPath);
  } catch (error) {
    await lease?.close().catch(() => {});
    await unlink(lockTemporaryPath).catch(() => {});
    if (lockPublished) await unlinkOwnedDecisionLock(lockPath, leaseIdentity).catch(() => {});
    throw error;
  }
  let released = false;
  async function release() {
    if (released) return;
    released = true;
    await lease.close();
    await unlinkOwnedDecisionLock(lockPath, leaseIdentity);
  }
  try {
    await assertPrivateDecisionDirectory(location, directoryIdentity);
    const file = join(location, 'decisions.json');
    let state = initial();
    let records = [];
    let raw;
    try { raw = await readBoundedDecisionStore(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (raw !== undefined) {
      try {
        const saved = JSON.parse(raw);
        if (canonicalStringify(saved) !== raw) fail('DECISIONS_TAMPERED', 'Decision envelope is not canonical JSON');
        exact(saved, ['schema', 'payload', 'digest'], 'DECISIONS_TAMPERED');
        exact(saved.payload, ['records', 'projection'], 'DECISIONS_TAMPERED');
        if (saved.schema !== STORE_SCHEMA || !Array.isArray(saved.payload.records) || saved.digest !== digest(saved.payload)) fail('DECISIONS_TAMPERED', 'Decision envelope integrity check failed');
        let previousHash = genesis;
        for (let index = 0; index < saved.payload.records.length; index += 1) {
          const record = saved.payload.records[index];
          exact(record, ['index', 'previousHash', 'event', 'hash'], 'DECISIONS_TAMPERED');
          if (record.index !== index || record.previousHash !== previousHash || record.hash !== digest({ index, previousHash, event: record.event })) fail('DECISIONS_TAMPERED', 'Decision history hash chain is invalid');
          state = reduce(state, record.event).state;
          previousHash = record.hash;
        }
        if (!equal(saved.payload.projection, state)) fail('DECISIONS_TAMPERED', 'Saved decision projection disagrees with deterministic history replay');
        records = clone(saved.payload.records);
      } catch (error) { fail('DECISIONS_TAMPERED', `Cannot validate saved decision history: ${error.code ?? 'INVALID_JSON'}`); }
    } else {
      const payload = { records, projection: state };
      await atomicWrite(file, canonicalStringify({ schema: STORE_SCHEMA, payload, digest: digest(payload) }), location, syncDirectoryFn);
    }

    let queue = Promise.resolve();
    let closing = false;
    let closed = false;
    let closePromise;
    let uncertain = false;
    let uncertaintyCode = null;
    function assertCertain() {
      if (!uncertain) return;
      if (uncertaintyCode === 'COMMIT_DURABILITY_UNCERTAIN') {
        throw Object.assign(new Error(
          'Decision replacement succeeded but directory durability could not be confirmed; close and reopen to validate the retained envelope before reading or writing again.'
        ), { code: 'COMMIT_DURABILITY_UNCERTAIN', status: 503 });
      }
      fail('DECISIONS_UNCERTAIN', 'A persistence failure fenced this writer; close and inspect durable storage before recovery');
    }
    function clock() {
      const atMs = now();
      if (!validTime(atMs)) fail('INVALID_CLOCK', 'The server clock must return valid integer epoch milliseconds');
      if (state.lastAtMs !== null && atMs < state.lastAtMs) fail('CLOCK_REGRESSION', 'Server clock precedes committed decision history');
      return atMs;
    }
    function enqueue(operation) {
      if (closing || closed) return Promise.reject(Object.assign(new Error('Decision writer is closed'), { code: 'DECISIONS_CLOSED' }));
      const running = queue.then(async () => {
        assertCertain();
        return operation();
      });
      queue = running.catch(() => {});
      return running;
    }
    async function commit(event) {
      const candidate = reduce(state, event);
      const index = records.length;
      const previousHash = records.at(-1)?.hash ?? genesis;
      const record = { index, previousHash, event, hash: digest({ index, previousHash, event }) };
      const nextRecords = [...records, record];
      const payload = { records: nextRecords, projection: candidate.state };
      const serialized = canonicalStringify({ schema: STORE_SCHEMA, payload, digest: digest(payload) });
      if (Buffer.byteLength(serialized, 'utf8') > MAX_STORE_BYTES) fail('DECISIONS_CAPACITY', 'Decision envelope exceeds 64 MiB; archive through an explicit continuity procedure');
      try { await atomicWrite(file, serialized, location, syncDirectoryFn); }
      catch (error) {
        uncertain = true;
        if (error.code === 'COMMIT_DURABILITY_UNCERTAIN') {
          uncertaintyCode = 'COMMIT_DURABILITY_UNCERTAIN';
          throw error;
        }
        uncertaintyCode = 'DECISIONS_UNCERTAIN';
        fail('DECISION_PERSISTENCE_FAILED', 'No successful disposition is returned after a persistence failure; writer is fenced until recovery');
      }
      state = candidate.state;
      records = nextRecords;
      return clone(candidate.result);
    }
    function prepare(operation) { try { return operation(); } catch (error) { return Promise.reject(error); } }
    function replayResult(outcome) {
      if (!outcome.ok) fail(outcome.code, outcome.message);
      return clone(outcome.result);
    }
    function publicDecision(decision) {
      const { id, title, status, revision, createdAt, createdBy, expiresAt, expiredAt, policy, disposition } = decision;
      return { id, title, status, revision, createdAt, createdBy, expiresAt, expiredAt, policy, disposition };
    }
    return {
      setPolicy(actor, input) {
        return prepare(() => {
          const trustedActor = founder(actor);
          const policy = policyShape(input);
          return enqueue(async () => {
            const existing = state.policies.find(item => item.id === policy.id);
            if (existing) {
              if (!equal(policyInput(existing), policy)) fail('POLICY_ID_REUSED', 'This policy ID already binds different policy contents');
              return clone(existing);
            }
            return commit({ type: 'policy-set', actor: trustedActor, atMs: clock(), input: policy });
          });
        });
      },
      create(actor, input) {
        return prepare(() => {
          const trustedActor = creator(actor);
          const proposal = proposalShape(input);
          return enqueue(async () => {
            const existing = state.decisions.find(item => item.id === proposal.id);
            if (existing) {
              if (!equal(originalProposal(existing), proposal)) fail('DECISION_ID_REUSED', 'This decision ID already binds different proposal contents');
              return clone(existing);
            }
            return commit({ type: 'proposal-created', actor: trustedActor, atMs: clock(), input: proposal });
          });
        });
      },
      decide(actor, input) {
        return prepare(() => {
          const trustedActor = founder(actor);
          const request = decisionShape(input);
          return enqueue(async () => {
            const existing = state.requests.find(item => item.requestId === request.requestId);
            if (existing) {
              if (existing.actorId !== trustedActor.id || !equal(existing.input, request)) fail('REQUEST_ID_REUSED', 'A request ID cannot be rebound to another decision, action, actor or revision');
              return replayResult(existing.outcome);
            }
            const outcome = await commit({ type: 'decision-attempted', actor: trustedActor, atMs: clock(), input: request });
            return replayResult(outcome);
          });
        });
      },
      summary() {
        // A deliberately read-only, public projection for the world map. It
        // exposes aggregate status counts only: no titles, evaluation bytes,
        // risks, rollback text, policy basis, or audit details.
        if (uncertain || closing || closed) {
          return clone({ schema: 'ngl.decisions.summary.v1', available: false });
        }
        const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0, DEFERRED: 0, EXPIRED: 0 };
        for (const decision of state.decisions) {
          if (!Object.hasOwn(counts, decision.status)) {
            return clone({ schema: 'ngl.decisions.summary.v1', available: false });
          }
          counts[decision.status] += 1;
        }
        return clone({
          schema: 'ngl.decisions.summary.v1',
          available: true,
          revision: state.revision,
          decisionCount: state.decisions.length,
          counts,
        });
      },
      snapshot(actor) {
        return prepare(() => {
          const trustedActor = viewer(actor);
          return enqueue(async () => {
            const atMs = clock();
            const decisionIds = state.decisions.filter(item => isOverdue(item, atMs)).map(item => item.id);
            if (decisionIds.length) await commit({ type: 'expiry-observed', actor: SYSTEM, atMs, input: { decisionIds } });
            const isFounder = trustedActor.id === 'damien' && trustedActor.role === 'founder';
            const policy = state.policy && (isFounder ? state.policy : { id: state.policy.id, reviewWindowMs: state.policy.reviewWindowMs, revision: state.policy.revision, setAt: state.policy.setAt });
            const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0, DEFERRED: 0, EXPIRED: 0 };
            for (const decision of state.decisions) counts[decision.status] += 1;
            return clone({ schema: SNAPSHOT_SCHEMA, revision: state.revision, head: records.at(-1)?.hash ?? genesis, policy, decisions: isFounder ? state.decisions : state.decisions.map(publicDecision), counts, ...(isFounder ? { policies: state.policies, audit: state.audit } : {}) });
          });
        });
      },
      close() {
        if (!closePromise) {
          closing = true;
          closePromise = (async () => { await queue; await release(); closed = true; })();
        }
        return closePromise;
      },
    };
  } catch (error) {
    await release();
    throw error;
  }
}
