#!/usr/bin/env node
import { readBoundedRegularFile } from '../src/bounded-file-reader.mjs';
import { assertNoDuplicateJsonObjectKeys } from '../src/strict-json.mjs';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { resolve } from 'node:path';
import {
  approvalPayload,
  candidateTaskSpecificationPayload,
  proposalDigest,
  publicKeyFingerprint,
  validateInstallationProposal
} from '../experiment-001/institutional-cycle.mjs';
import {
  candidateTaskSpecificationDigest,
  validateCandidateTaskSpecification
} from '../experiment-001/candidate-program.mjs';

const MAX_PROPOSAL_BYTES = 1024 * 1024;
const MAX_TASK_SPEC_BYTES = 64 * 1024;
const MAX_PRIVATE_KEY_BYTES = 64 * 1024;
const MAX_PUBLIC_KEY_BYTES = 64 * 1024;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const MAX_PROPOSAL_JSON_DEPTH = 128;
const MAX_TASK_SPEC_JSON_DEPTH = 16;

async function readJsonDocument(path, maxBytes, label, maxDepth) {
  let text;
  try { text = await readBoundedRegularFile(resolve(path), maxBytes, label); }
  catch (error) { throw new Error(error.code || error.message || `${label}_READ_FAILED`); }
  assertNoDuplicateJsonObjectKeys(text, { label, maxDepth });
  try { return JSON.parse(text); }
  catch { throw new Error(`${label}_JSON_INVALID`); }
}

async function readProposal(path) {
  return readJsonDocument(path, MAX_PROPOSAL_BYTES, 'PROPOSAL', MAX_PROPOSAL_JSON_DEPTH);
}

async function readTaskSpecification(path) {
  const value = await readJsonDocument(path, MAX_TASK_SPEC_BYTES, 'TASK_SPEC', MAX_TASK_SPEC_JSON_DEPTH);
  try { return validateCandidateTaskSpecification(value); }
  catch { throw new Error('TASK_SPEC_INVALID'); }
}

function validateProposal(decision, founderPublicKey = null) {
  const validation = validateInstallationProposal(decision, Date.now(), { founderPublicKey });
  if (!validation.valid) throw new Error(validation.reason);
}

function requireFingerprint() {
  const expectedFingerprint = process.env.NGL_FOUNDER_KEY_FINGERPRINT;
  if (typeof expectedFingerprint !== 'string' || !FINGERPRINT.test(expectedFingerprint)) {
    throw new Error('FOUNDER_KEY_FINGERPRINT_REQUIRED');
  }
  return expectedFingerprint;
}

async function loadPinnedFounderPublicKey(path) {
  const expectedFingerprint = requireFingerprint();
  const keyText = await readBoundedRegularFile(resolve(path), MAX_PUBLIC_KEY_BYTES, 'FOUNDER_PUBLIC_KEY');
  let publicKey;
  try { publicKey = createPublicKey(keyText); }
  catch { throw new Error('FOUNDER_PUBLIC_KEY_INVALID'); }
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('FOUNDER_PUBLIC_KEY_MUST_BE_ED25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const fingerprint = publicKeyFingerprint(publicKeyPem);
  if (fingerprint !== expectedFingerprint) throw new Error('FOUNDER_KEY_FINGERPRINT_MISMATCH');
  return { publicKey, fingerprint };
}

async function loadPinnedFounderPrivateKey(path) {
  const expectedFingerprint = requireFingerprint();
  const keyText = await readBoundedRegularFile(resolve(path), MAX_PRIVATE_KEY_BYTES, 'FOUNDER_KEY', {
    requirePrivatePermissions: true,
    requireCurrentUserOwnership: true
  });
  let privateKey;
  try { privateKey = createPrivateKey(keyText); }
  catch { throw new Error('FOUNDER_PRIVATE_KEY_INVALID'); }
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('FOUNDER_PRIVATE_KEY_MUST_BE_ED25519');
  const publicKey = createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const fingerprint = publicKeyFingerprint(publicKeyPem);
  if (fingerprint !== expectedFingerprint) throw new Error('FOUNDER_KEY_FINGERPRINT_MISMATCH');
  return { privateKey, publicKey, fingerprint };
}

function usage() {
  process.stderr.write([
    'Inspect INSTALL proposal: node scripts/approve-install.mjs --inspect <proposal.json> [founder-public-key.pem for candidate-program-v5]',
    'Sign INSTALL after review: NGL_FOUNDER_KEY_FINGERPRINT=<independently-provisioned-hex> node scripts/approve-install.mjs --confirm <full-proposal-digest> <proposal.json> <private-key.pem>',
    'Inspect candidate task: node scripts/approve-install.mjs --inspect-task-spec <task-spec.json>',
    'Sign candidate task after review: NGL_FOUNDER_KEY_FINGERPRINT=<independently-provisioned-hex> node scripts/approve-install.mjs --confirm-task-spec <full-task-spec-digest> <task-spec.json> <private-key.pem>',
    ''
  ].join('\\n'));
}

async function inspectProposal(args) {
  const decision = await readProposal(args[1]);
  let founderPublicKey = null;
  let verifiedFingerprint = null;
  if (decision?.strategy === 'candidate-program-v5') {
    if (args.length !== 3) throw new Error('FOUNDER_PUBLIC_KEY_PATH_REQUIRED');
    const trusted = await loadPinnedFounderPublicKey(args[2]);
    founderPublicKey = trusted.publicKey;
    verifiedFingerprint = trusted.fingerprint;
  } else if (args.length !== 2) {
    usage();
    process.exitCode = 2;
    return;
  }
  validateProposal(decision, founderPublicKey);
  const proposal = {
    id: decision.id,
    strategy: decision.strategy,
    executorKeyFingerprint: publicKeyFingerprint(decision.executorPublicKeyPem),
    nonce: decision.nonce,
    issuedAt: decision.issuedAt,
    expiresAt: decision.expiresAt,
    maxUses: decision.maxUses,
    proof: decision.proof
  };
  // A digest binds candidate code, but a human cannot meaningfully review what
  // they are authorizing unless the exact normalized program and hash are shown.
  if (decision.program !== undefined) {
    proposal.program = decision.program;
    proposal.implementationHash = decision.implementationHash;
  }
  if (decision.strategy === 'candidate-program-v5') {
    proposal.taskSpecification = decision.taskSpecification;
    proposal.taskSpecificationDigest = candidateTaskSpecificationDigest(decision.taskSpecification);
    proposal.taskSpecificationSignature = decision.taskSpecificationSignature;
    proposal.taskSpecificationVerifiedAgainstFingerprint = verifiedFingerprint;
  }
  process.stdout.write(JSON.stringify({
    schema: 'ngl.founder-install-review.v1',
    proposalDigest: proposalDigest(decision),
    proposal,
    instruction: 'Review the complete candidate program, implementation hash, proof, and every other field. Signing requires this exact full digest in a separate --confirm invocation.'
  }, null, 2) + '\\n');
}

async function inspectTaskSpecification(path) {
  const specification = await readTaskSpecification(path);
  const digest = candidateTaskSpecificationDigest(specification);
  process.stdout.write(JSON.stringify({
    schema: 'ngl.founder-candidate-task-specification-review.v1',
    taskSpecificationDigest: digest,
    taskSpecification: specification,
    instruction: 'Review the normalized task and full digest. Signing requires this exact digest in a separate --confirm-task-spec invocation.'
  }, null, 2) + '\\n');
}

async function confirmInstall(confirmedDigest, proposalPath, privateKeyPath) {
  const decision = await readProposal(proposalPath);
  const digest = proposalDigest(decision);
  if (digest !== confirmedDigest) throw new Error('PROPOSAL_CONFIRMATION_MISMATCH');
  if (decision?.strategy !== 'candidate-program-v5') validateProposal(decision);
  const trusted = await loadPinnedFounderPrivateKey(privateKeyPath);
  if (decision?.strategy === 'candidate-program-v5') validateProposal(decision, trusted.publicKey);
  const signature = sign(null, Buffer.from(approvalPayload(decision), 'utf8'), trusted.privateKey).toString('base64url');
  const receipt = {
    schema: 'ngl.founder-install-approval.v1',
    proposalDigest: digest,
    keyFingerprint: trusted.fingerprint,
    signature
  };
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\\n');
  process.stderr.write(`Approval signature produced for proposal ${digest}. This proves key possession only; it does not identify the human operating this process.\\n`);
}

async function confirmTaskSpecification(confirmedDigest, specificationPath, privateKeyPath) {
  const specification = await readTaskSpecification(specificationPath);
  const digest = candidateTaskSpecificationDigest(specification);
  if (digest !== confirmedDigest) throw new Error('TASK_SPEC_CONFIRMATION_MISMATCH');
  const trusted = await loadPinnedFounderPrivateKey(privateKeyPath);
  const signature = sign(null, Buffer.from(candidateTaskSpecificationPayload(specification), 'utf8'), trusted.privateKey).toString('base64url');
  const receipt = {
    schema: 'ngl.founder-candidate-task-specification-signature.v1',
    taskSpecificationDigest: digest,
    taskSpecificationId: specification.id,
    keyFingerprint: trusted.fingerprint,
    signature
  };
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\\n');
  process.stderr.write(`Task-specification signature produced for ${specification.id}. This proves key possession only; it is not an INSTALL approval and does not identify the human operating this process.\\n`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === '--inspect-task-spec') {
    await inspectTaskSpecification(args[1]);
    return;
  }
  if (args.length === 4 && args[0] === '--confirm-task-spec' && FINGERPRINT.test(args[1])) {
    await confirmTaskSpecification(args[1], args[2], args[3]);
    return;
  }
  if ((args.length === 2 || args.length === 3) && args[0] === '--inspect') {
    await inspectProposal(args);
    return;
  }
  if (args.length === 4 && args[0] === '--confirm' && FINGERPRINT.test(args[1])) {
    await confirmInstall(args[1], args[2], args[3]);
    return;
  }
  usage();
  process.exitCode = 2;
}

main().catch(error => {
  process.stderr.write(`${error?.message || 'APPROVAL_FAILED'}\\n`);
  process.exitCode = 1;
});
