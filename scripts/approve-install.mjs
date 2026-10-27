#!/usr/bin/env node
import { readBoundedRegularFile } from './bounded-file-reader.mjs';
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

function assertNoDuplicateJsonObjectKeys(source) {
  let index = 0;
  const skipWhitespace = () => {
    while (source[index] === ' ' || source[index] === '\t' || source[index] === '\r' || source[index] === '\n') index += 1;
  };
  const readStringToken = () => {
    const start = index;
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === '\\') { index += 2; continue; }
      index += 1;
      if (character === '"') return source.slice(start, index);
    }
    throw new Error('PROPOSAL_JSON_INVALID');
  };
  const parseValue = () => {
    skipWhitespace();
    if (source[index] === '{') {
      index += 1;
      skipWhitespace();
      if (source[index] === '}') { index += 1; return; }
      const keys = new Set();
      while (index < source.length) {
        skipWhitespace();
        const token = readStringToken();
        let key;
        try { key = JSON.parse(token); }
        catch { throw new Error('PROPOSAL_JSON_INVALID'); }
        if (keys.has(key)) throw new Error('PROPOSAL_DUPLICATE_JSON_KEY');
        keys.add(key);
        skipWhitespace();
        index += 1; // JSON.parse has already validated the colon.
        parseValue();
        skipWhitespace();
        if (source[index] === ',') { index += 1; continue; }
        if (source[index] === '}') { index += 1; return; }
        throw new Error('PROPOSAL_JSON_INVALID');
      }
      throw new Error('PROPOSAL_JSON_INVALID');
    }
    if (source[index] === '[') {
      index += 1;
      skipWhitespace();
      if (source[index] === ']') { index += 1; return; }
      while (index < source.length) {
        parseValue();
        skipWhitespace();
        if (source[index] === ',') { index += 1; continue; }
        if (source[index] === ']') { index += 1; return; }
        throw new Error('PROPOSAL_JSON_INVALID');
      }
      throw new Error('PROPOSAL_JSON_INVALID');
    }
    if (source[index] === '"') { readStringToken(); return; }
    const start = index;
    while (index < source.length &&
      source[index] !== ',' && source[index] !== ']' && source[index] !== '}' &&
      source[index] !== ' ' && source[index] !== '\t' && source[index] !== '\r' && source[index] !== '\n') {
      index += 1;
    }
    if (index === start) throw new Error('PROPOSAL_JSON_INVALID');
  };

  parseValue();
  skipWhitespace();
  if (index !== source.length) throw new Error('PROPOSAL_JSON_INVALID');
}

async function readProposal(path) {
  let text;
  try {
    text = await readBoundedRegularFile(resolve(path), MAX_PROPOSAL_BYTES, 'PROPOSAL');
  } catch (error) {
    throw new Error(error.code || error.message || 'PROPOSAL_READ_FAILED');
  }
  let decision;
  try { decision = JSON.parse(text); }
  catch { throw new Error('PROPOSAL_JSON_INVALID'); }
  assertNoDuplicateJsonObjectKeys(text);
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

  const keyText = await readBoundedRegularFile(resolve(privateKeyPath), MAX_PRIVATE_KEY_BYTES, 'FOUNDER_KEY', { requirePrivatePermissions: true, requireCurrentUserOwnership: true });
  let privateKey;
  try { privateKey = createPrivateKey(keyText); }
  catch { throw new Error('FOUNDER_PRIVATE_KEY_INVALID'); }
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('FOUNDER_PRIVATE_KEY_MUST_BE_ED25519');

  const publicKey = createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const fingerprint = publicKeyFingerprint(publicKeyPem);
  const expectedFingerprint = process.env.NGL_FOUNDER_KEY_FINGERPRINT;
  if (typeof expectedFingerprint !== 'string' || !FINGERPRINT.test(expectedFingerprint)) {
    throw new Error('FOUNDER_KEY_FINGERPRINT_REQUIRED');
  }
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
