#!/usr/bin/env node
import { constants as fsConstants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
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

async function readBoundedRegularFile(path, maxBytes, label, requirePrivatePermissions = false) {
  const flags = fsConstants.O_RDONLY |
    (fsConstants.O_NOFOLLOW ?? 0) |
    (fsConstants.O_NONBLOCK ?? 0);
  const handle = await open(path, flags);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`${label}_NOT_REGULAR_FILE`);
    if (stat.size > maxBytes) throw new Error(`${label}_FILE_TOO_LARGE`);
    if (requirePrivatePermissions && process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      throw new Error('FOUNDER_KEY_PERMISSIONS_TOO_BROAD');
    }
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes) throw new Error(`${label}_FILE_TOO_LARGE`);
    return bytes.toString('utf8');
  } finally {
    await handle.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    process.stderr.write('Usage: NGL_FOUNDER_KEY_FINGERPRINT=<sha256-spki-hex> node scripts/approve-install.mjs <proposal.json> <private-key.pem>\n');
    process.exitCode = 2;
    return;
  }

  const [proposalPath, privateKeyPath] = args;
  let decision;
  try {
    const proposalText = await readBoundedRegularFile(resolve(proposalPath), MAX_PROPOSAL_BYTES, 'PROPOSAL');
    decision = JSON.parse(proposalText);
  } catch (error) {
    throw new Error(error instanceof SyntaxError ? 'PROPOSAL_JSON_INVALID' : (error.code || error.message || 'PROPOSAL_READ_FAILED'));
  }

  const validation = validateInstallationProposal(decision);
  if (!validation.valid) throw new Error(validation.reason);

  const keyText = await readBoundedRegularFile(resolve(privateKeyPath), MAX_PRIVATE_KEY_BYTES, 'FOUNDER_KEY', true);
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

  const payload = Buffer.from(approvalPayload(decision), 'utf8');
  const signature = sign(null, payload, privateKey).toString('base64url');
  const receipt = {
    schema: 'ngl.founder-install-approval.v1',
    proposalDigest: proposalDigest(decision),
    keyFingerprint: fingerprint,
    signature
  };
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
  process.stderr.write(`Approval signature produced for proposal ${receipt.proposalDigest}. This proves key possession only; it does not identify the human operating this process.\n`);
}

main().catch(error => {
  process.stderr.write(`${error?.message || 'APPROVAL_FAILED'}\n`);
  process.exitCode = 1;
});
