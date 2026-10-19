import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { artifactReceipt, canonicalStringify } from './kernel.mjs';

const REVIEW_WINDOW_MS = 600000;
const MAX_EVALUATION_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const QUALIFICATION_PATH = 'docs/institution/qualification/REPORT.md';
const POLICY = Object.freeze({
  id: 'founder-gate:qualification-2026-10-18-ten-minute',
  reviewWindowMs: REVIEW_WINDOW_MS,
  basis: 'Founder user request: 10-minute qualification review window on 2026-10-18; applies to this qualification only. Other decisions must select their own explicit policy.',
});
const CHOICES = Object.freeze([
  { action: 'APPROVE', label: 'Authorize controlled external specialist review' },
  { action: 'DEFER', label: 'Require further hardening' },
  { action: 'REJECT', label: 'Reject the present qualification' },
]);
const CEREMONY = Object.freeze({
  title: 'Inaugural Founders Day', date: '2026-10-18', timezone: 'America/Chicago',
  location: 'Carter Lake, Iowa', status: 'PREPARED',
});
const EFFECT = 'Authorize controlled external specialist review of the present Alpha 1 qualification only; no deployment, publication, authority transfer, or automatic promotion.';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const copy = value => JSON.parse(canonicalStringify(value));
const equal = (left, right) => canonicalStringify(left) === canonicalStringify(right);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const boundedText = (value, limit) => typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= limit;

function exact(value, required, optional, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) fail(code, 'A plain object with the expected fields is required');
  const keys = Object.keys(value);
  if (required.some(key => !Object.hasOwn(value, key)) || keys.some(key => !required.includes(key) && !optional.includes(key)) || keys.some(key => !('value' in Object.getOwnPropertyDescriptor(value, key)))) fail(code, 'Unexpected, missing, or accessor fields');
}

function proposalShape(value) {
  const code = 'INVALID_PROPOSAL';
  exact(value, ['id', 'title', 'evaluation', 'risks', 'rollback', 'proposedEffect'], [], code);
  if (!identifier(value.id) || !boundedText(value.title, 1000) || !Array.isArray(value.risks) || value.risks.length > 50 || value.risks.some(risk => !boundedText(risk, 4000)) || !boundedText(value.rollback, 16384) || !boundedText(value.proposedEffect, 16384)) fail(code, 'A bounded proposal ID, title, risks, rollback, and proposed effect are required');
  exact(value.evaluation, ['bytes', 'receipt'], [], code);
  exact(value.evaluation.receipt, ['algorithm', 'digest', 'size'], [], code);
  if (typeof value.evaluation.bytes !== 'string' || !value.evaluation.bytes.length || Buffer.byteLength(value.evaluation.bytes, 'utf8') > MAX_EVALUATION_BYTES) fail(code, 'Evaluation must contain actual UTF-8 bytes up to 1 MiB');
  try {
    if (!equal(artifactReceipt(value.evaluation.bytes), value.evaluation.receipt)) fail(code, 'Evaluation receipt does not match the actual UTF-8 bytes');
    return copy(value);
  } catch (error) {
    if (error.code === code) throw error;
    fail(code, 'Proposal must contain only finite, plain JSON data');
  }
}

function actorShape(value, founderOnly = false) {
  const code = founderOnly ? 'FOUNDER_REQUIRED' : 'ACTOR_REQUIRED';
  exact(value, ['id', 'role'], ['name'], code);
  if (!identifier(value.id) || typeof value.role !== 'string' || (Object.hasOwn(value, 'name') && !boundedText(value.name, 160))) fail(code, 'A host-authenticated actor with an exact identity and role is required');
  const isFounder = value.id === 'damien' && value.role === 'founder';
  if (founderOnly ? !isFounder : !isFounder && !(value.id === 'local-evaluator' && value.role === 'executor') && value.role !== 'witness') fail(code, 'Only the host-authenticated Founder may authorize this operation');
  return { viewer: copy(value), core: { id: value.id, role: value.role }, isFounder };
}

function requestShape(value) {
  exact(value, ['expectedRevision', 'requestId', 'action'], [], 'INVALID_DECISION');
  if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1 || !identifier(value.requestId) || !['APPROVE', 'DEFER', 'REJECT'].includes(value.action)) fail('INVALID_DECISION', 'An explicit action, positive expected revision, and unique request ID are required');
  return copy(value);
}

function originalProposal(decision) {
  const { id, title, evaluation, risks, rollback, proposedEffect } = decision;
  return { id, title, evaluation, risks, rollback, proposedEffect };
}

/**
 * A bounded page service over the existing durable decision core. The host must
 * authenticate actors, require HTTPS readiness, and serialize all store writes.
 * Construction and status never activate a policy or start a review window.
 */
export function createFounderGate(options = {}) {
  exact(options, ['decisions', 'proposal'], ['now'], 'INVALID_CONFIG');
  const { decisions, proposal, now = Date.now } = options;
  if (!decisions || ['snapshot', 'setPolicy', 'create', 'decide'].some(method => typeof decisions[method] !== 'function') || typeof now !== 'function') fail('INVALID_CONFIG', 'An existing decision core and server clock function are required');
  const configured = proposalShape(proposal);
  function clock() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000) fail('INVALID_CLOCK', 'Server time must be integer epoch milliseconds');
    return new Date(value).toISOString();
  }
  function verifyDecision(state, decision, privateView) {
    if (!decision) return;
    if (Date.parse(decision.expiresAt) - Date.parse(decision.createdAt) !== REVIEW_WINDOW_MS) fail('GATE_CONFLICT', 'The existing qualification decision did not capture the authorized ten-minute window');
    if (privateView) {
      const captured = state.policies.find(policy => policy.id === decision.policy.id && policy.revision === decision.policy.revision);
      if (!captured || captured.reviewWindowMs !== REVIEW_WINDOW_MS || !equal(originalProposal(decision), configured)) fail('GATE_CONFLICT', 'The existing qualification decision has different evidence, scope, or captured policy');
    }
  }
  async function current(actor) {
    const state = await decisions.snapshot(actor.core);
    const decision = state.decisions.find(item => item.id === configured.id) ?? null;
    verifyDecision(state, decision, actor.isFounder);
    return { state, decision };
  }
  return {
    async status(actor, metadata = {}) {
      const trusted = actorShape(actor);
      exact(metadata, [], ['ready', 'blockedReason'], 'INVALID_CONFIG');
      const { ready = false, blockedReason = null } = metadata;
      if (typeof ready !== 'boolean' || (blockedReason !== null && !boundedText(blockedReason, 1000))) fail('INVALID_CONFIG', 'Readiness must be boolean and blocked reason must be bounded text or null');
      const serverNow = clock();
      const { decision } = await current(trusted);
      return copy({
        schema: 'ngl.founder-gate-page.v1', serverNow, reviewWindowMs: REVIEW_WINDOW_MS,
        viewer: trusted.viewer, ready, blockedReason, decision,
        proposal: trusted.isFounder ? configured : { id: configured.id, title: configured.title },
        choices: CHOICES, ceremony: CEREMONY,
      });
    },
    async activate(actor) {
      const trusted = actorShape(actor, true);
      const { state, decision } = await current(trusted);
      if (decision) return decision;
      const historical = state.policies.find(item => item.id === POLICY.id);
      if (historical && (!equal({ id: historical.id, reviewWindowMs: historical.reviewWindowMs, basis: historical.basis }, POLICY) || state.policy?.id !== POLICY.id || state.policy?.revision !== historical.revision)) fail('GATE_CONFLICT', 'The qualification policy conflicts with a historical or currently selected policy');
      await decisions.setPolicy(trusted.core, POLICY);
      const selected = await decisions.snapshot(trusted.core);
      if (selected.policy?.id !== POLICY.id || selected.policy?.reviewWindowMs !== REVIEW_WINDOW_MS || selected.policy?.basis !== POLICY.basis) fail('GATE_CONFLICT', 'The qualification policy is not the selected policy; no proposal was created');
      const created = await decisions.create(trusted.core, configured);
      verifyDecision(selected, created, true);
      return created;
    },
    async choose(actor, input) {
      const trusted = actorShape(actor, true);
      const request = requestShape(input);
      const { decision } = await current(trusted);
      if (!decision) fail('DECISION_NOT_FOUND', 'Activate the prepared qualification proposal before choosing a disposition');
      return decisions.decide(trusted.core, { decisionId: configured.id, ...request });
    },
  };
}

async function boundedUtf8(file, limit) {
  let handle;
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > limit) fail('INVALID_PROPOSAL', 'Qualification files must be bounded regular files');
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > limit) fail('INVALID_PROPOSAL', 'Qualification files must be bounded regular files');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) fail('INVALID_PROPOSAL', 'Qualification file exceeds its byte limit');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length));
  } catch (error) {
    if (error.code === 'INVALID_PROPOSAL') throw error;
    fail('INVALID_PROPOSAL', 'Cannot read an exact bounded UTF-8 qualification file');
  } finally { await handle?.close(); }
}

/** Load only the repository's fixed offline qualification files, without activation. */
export async function loadQualificationProposal(options = {}) {
  exact(options, ['root'], [], 'INVALID_CONFIG');
  if (!boundedText(options.root, 4096) || options.root.includes('\0')) fail('INVALID_CONFIG', 'An explicit repository root is required');
  const root = await realpath(options.root);
  let directory = root;
  for (const component of ['docs', 'institution', 'qualification']) {
    directory = join(directory, component);
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('INVALID_PROPOSAL', 'Qualification directories must remain inside the repository');
  }
  const manifestBytes = await boundedUtf8(join(directory, 'FOUNDER-DECISION-PROPOSAL.json'), MAX_MANIFEST_BYTES);
  let manifest;
  try { manifest = JSON.parse(manifestBytes); }
  catch { fail('INVALID_PROPOSAL', 'Qualification manifest must be valid JSON'); }
  exact(manifest, ['schema', 'status', 'decisionId', 'operationalURL', 'reviewDeadline', 'clockStarted', 'evaluation', 'choices', 'risks', 'rollback', 'authority'], [], 'INVALID_PROPOSAL');
  exact(manifest.evaluation, ['path', 'receipt'], [], 'INVALID_PROPOSAL');
  if (manifest.schema !== 'ngl.qualification-proposal.v1' || manifest.status !== 'UNACTIVATED_OFFLINE_PROPOSAL' || manifest.operationalURL !== null || manifest.reviewDeadline !== null || manifest.clockStarted !== false || manifest.evaluation.path !== QUALIFICATION_PATH || !Array.isArray(manifest.choices) || !equal(manifest.choices, ['AUTHORIZE CONTROLLED EXTERNAL SPECIALIST REVIEW', 'REQUIRE FURTHER HARDENING', 'REJECT THE PRESENT QUALIFICATION']) || !boundedText(manifest.authority, 16384)) fail('INVALID_PROPOSAL', 'Qualification manifest must describe the fixed unactivated review-only proposal');
  const bytes = await boundedUtf8(join(directory, 'REPORT.md'), MAX_EVALUATION_BYTES);
  return proposalShape({
    id: manifest.decisionId, title: 'Founders Day · Alpha 1 qualification',
    evaluation: { bytes, receipt: manifest.evaluation.receipt }, risks: manifest.risks,
    rollback: manifest.rollback, proposedEffect: EFFECT,
  });
}
