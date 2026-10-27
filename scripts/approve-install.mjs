#!/usr/bin/env node
import { readBoundedRegularFile } from './bounded-file-reader.mjs';
import { assertNoDuplicateJsonObjectKeys } from '../src/strict-json.mjs';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { resolve } from 'node:path';
import {
  approvalPayload,
  proposalDigest,
  publicKeyFingerprint,
  validateInstallationProposal
} from '../experiment-001/institutional-cycle.mjs';

const MAX_PROPOSAL_BYTES = 1024 * 1024;
const MAX_PRIVATE_KEY_BYTES = 64 * 1024;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const MAX_PROPOSAL_JSON_DEPTH = 128;

async function readProposal(path) {
  let text;
  try {
    text = await readBoundedRegularFile(resolve(path), MAX_PROPOSAL_BYTES, 'PROPOSAL');
  } catch (error) {
    throw new Error(error.code || error.message || 'PROPOSAL_READ_FAILED');
  }
  // Run the bounded scanner before JSON.parse so excessive nesting is
  // rejected before the runtime builds a parsed object graph.
  assertNoDuplicateJsonObjectKeys(text, { label: 'PROPOSAL', maxDepth: MAX_PROPOSAL_JSON_DEPTH });
  let decision;
  try { decision = JSON.parse(text); }
  catch { throw new Error('PROPOSAL_JSON_INVALID'); }
  const validation = validateInstallationProposal(decision);
  if (!validation.valid) throw new Error(validation.reason);
  return decision;
}

function usage() {
  process.stderr.write([
    'Review proposal: node scripts/approve-install.mjs --inspect <proposal.json>',
    'Sign after review: NGL_FOUNDER_KEY_FINGERPRINT=<independently-provisioned-hex> node scripts/approve-install.mjs --confirm <full-proposal-digest> <proposal.json> <private-key.pem>',
    ''
  ].join('\n'));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === '--inspect') {
    const decision = await readProposal(args[1]);
    process.stdout.write(JSON.stringify({
      schema: 'ngl.founder-install-review.v1',
      proposalDigest: proposalDigest(decision),
      proposal: {
        id: decision.id,
        strategy: decision.strategy,
        executorKeyFingerprint: publicKeyFingerprint(decision.executorPublicKeyPem),
        nonce: decision.nonce,
        issuedAt: decision.issuedAt,
        expiresAt: decision.expiresAt,
        maxUses: decision.maxUses,
        proof: decision.proof
      },
      instruction: 'Review every field. Signing requires this exact full digest in a separate --confirm invocation.'
    }, null, 2) + '\n');
    return;
  }

  if (args.length !== 4 || args[0] !== '--confirm' || !FINGERPRINT.test(args[1])) {
    usage();
    process.exitCode = 2;
    return;
  }

  const [, confirmedDigest, proposalPath, privateKeyPath] = args;
  const decision = await readProposal(proposalPath);
  const digest = proposalDigest(decision);
  if (digest !== confirmedDigest) throw new Error('PROPOSAL_CONFIRMATION_MISMATCH');

  // Validate the independently provisioned trust pin before opening the secret key file.
  const expectedFingerprint = process.env.NGL_FOUNDER_KEY_FINGERPRINT;
  if (typeof expectedFingerprint !== 'string' || !FINGERPRINT.test(expectedFingerprint)) {
    throw new Error('FOUNDER_KEY_FINGERPRINT_REQUIRED');
  }

  const keyText = await readBoundedRegularFile(resolve(privateKeyPath), MAX_PRIVATE_KEY_BYTES, 'FOUNDER_KEY', { requirePrivatePermissions: true, requireCurrentUserOwnership: true });
  let privateKey;
  try { privateKey = createPrivateKey(keyText); }
  catch { throw new Error('FOUNDER_PRIVATE_KEY_INVALID'); }
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('FOUNDER_PRIVATE_KEY_MUST_BE_ED25519');

  const publicKey = createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const fingerprint = publicKeyFingerprint(publicKeyPem);
  if (fingerprint !== expectedFingerprint) throw new Error('FOUNDER_KEY_FINGERPRINT_MISMATCH');

  const signature = sign(null, Buffer.from(approvalPayload(decision), 'utf8'), privateKey).toString('base64url');
  const receipt = {
    schema: 'ngl.founder-install-approval.v1',
    proposalDigest: digest,
    keyFingerprint: fingerprint,
    signature
  };
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
  process.stderr.write(`Approval signature produced for proposal ${digest}. This proves key possession only; it does not identify the human operating this process.\n`);
}

main().catch(error => {
  process.stderr.write(`${error?.message || 'APPROVAL_FAILED'}\n`);
  process.exitCode = 1;
});
