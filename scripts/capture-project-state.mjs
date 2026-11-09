import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalStringify, artifactReceipt } from '../src/institution/kernel.mjs';
import { loadGitHubGateSnapshot, projectGitHubGate } from '../game/github-decision-gate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = 'ngl-damien/No-Gas-Labs-Alpha-1';
const COMMIT_SHA = /^[a-f0-9]{40}$/i;

function buildMetadata(value = {}) {
  const sha = typeof value.sha === 'string' && COMMIT_SHA.test(value.sha) ? value.sha : null;
  const ref = typeof value.ref === 'string' && value.ref.length > 0 && value.ref.length <= 200
    ? value.ref : null;
  const runId = typeof value.runId === 'string' && /^\d{1,32}$/.test(value.runId)
    ? value.runId : null;
  return { sha, ref, runId };
}

function unavailableProjection(error) {
  const message = typeof error?.message === 'string' && error.message.trim()
    ? error.message.slice(0, 240)
    : 'Public GitHub snapshot capture failed.';
  const source = { available: false, error: message };
  return {
    sources: {
      pullRequests: { ...source },
      issues: { ...source },
      workflows: { ...source }
    },
    pullRequests: [],
    issues: [],
    recentRuns: []
  };
}

/**
 * Capture a minimal public-only projection. No token, cookie, private record,
 * PR body, issue body, or workflow log is requested or stored.
 */
export async function createProjectStateEnvelope({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  build = {
    sha: process.env.GITHUB_SHA || null,
    ref: process.env.GITHUB_REF || null,
    runId: process.env.GITHUB_RUN_ID || null
  }
} = {}) {
  let projection;
  try {
    const snapshot = await loadGitHubGateSnapshot({ fetchImpl });
    projection = projectGitHubGate(snapshot);
  } catch (error) {
    projection = unavailableProjection(error);
  }

  const capturedAt = now().toISOString();
  const payload = {
    schema: 'ngl.public-project-state.v1',
    repository: REPOSITORY,
    capturedAt,
    build: buildMetadata(build),
    sources: projection.sources,
    pullRequests: projection.pullRequests,
    issues: projection.issues,
    recentRuns: projection.recentRuns || []
  };
  const payloadText = canonicalStringify(payload);
  return {
    schema: 'ngl.public-project-state-envelope.v1',
    payload: payloadText,
    receipt: artifactReceipt(payloadText)
  };
}

function outputPathFromArgs(args) {
  const index = args.indexOf('--out');
  const supplied = index >= 0 ? args[index + 1] : null;
  const target = resolve(ROOT, supplied || 'android/app/build/generated/project-state/project-state.json');
  const rel = relative(ROOT, target);
  if (!rel || rel === '..' || rel.startsWith('..' + sep)) {
    throw new Error('Project-state output must remain inside the repository.');
  }
  return target;
}

export async function writeProjectStateSnapshot({ outPath, ...options } = {}) {
  const target = resolve(outPath || resolve(ROOT, 'android/app/build/generated/project-state/project-state.json'));
  const rel = relative(ROOT, target);
  if (!rel || rel === '..' || rel.startsWith('..' + sep)) {
    throw new Error('Project-state output must remain inside the repository.');
  }
  const envelope = await createProjectStateEnvelope(options);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(envelope, null, 2) + '\n', { mode: 0o644 });
  const payload = JSON.parse(envelope.payload);
  return {
    outPath: target,
    receipt: envelope.receipt,
    capturedAt: payload.capturedAt,
    sources: payload.sources
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await writeProjectStateSnapshot({ outPath: outputPathFromArgs(process.argv.slice(2)) });
  process.stdout.write(JSON.stringify({
    outPath: relative(ROOT, result.outPath).split(sep).join('/'),
    receipt: result.receipt,
    capturedAt: result.capturedAt,
    sources: result.sources
  }) + '\n');
}
