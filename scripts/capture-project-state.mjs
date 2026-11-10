import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalStringify, artifactReceipt } from '../src/institution/kernel.mjs';
import { loadGitHubGateSnapshot, loadExactHeadChecks, projectGitHubGate } from '../game/github-decision-gate.mjs';
import { loadProjectStateSnapshot } from '../game/project-state-snapshot.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = 'ngl-damien/No-Gas-Labs-Alpha-1';
const COMMIT_SHA = /^[a-f0-9]{40}$/i;

const CHECKED_PULL_REQUEST_LIMIT = 3;
const MAX_CAPTURED_CHECK_ITEMS = 20;
const CHECK_RUN_STATUSES = new Set(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending']);
const CHECK_RUN_CONCLUSIONS = new Set([
  'success', 'failure', 'neutral', 'cancelled', 'timed_out',
  'action_required', 'stale', 'skipped', 'startup_failure'
]);
const COMMIT_STATUS_STATES = new Set(['success', 'failure', 'pending', 'error', 'unknown']);

function withReadOnlyGitHubToken(fetchImpl, token) {
  if (token === null || token === undefined || token === '') return fetchImpl;
  if (typeof token !== 'string' || token.length > 4096 || /[\\r\\n]/.test(token)) {
    throw new TypeError('Invalid build-time GitHub read token.');
  }
  return (url, options = {}) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return fetchImpl(url, options);
    }
    if (target.origin !== 'https://api.github.com' ||
        !target.pathname.startsWith('/repos/' + REPOSITORY + '/')) {
      return fetchImpl(url, options);
    }
    const headers = { ...(options.headers || {}) };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'authorization') delete headers[key];
    }
    headers.Authorization = 'Bearer ' + token;
    return fetchImpl(url, { ...options, headers });
  };
}

function unavailableCheckSource(error) {
  const message = typeof error === 'string' && error.trim()
    ? error.slice(0, 240)
    : 'Exact-head check source unavailable.';
  return { available: false, error: message, totalCount: 0, items: [] };
}
function unavailableCommitStatusSource(error) {
  const unavailable = unavailableCheckSource(error);
  return { ...unavailable, state: '' };
}

function compactCheckRuns(source) {
  if (source?.available !== true) return unavailableCheckSource(source?.error);
  const inventory = source.items;
  if (!inventory || !Array.isArray(inventory.items) ||
      !Number.isSafeInteger(inventory.totalCount) || inventory.totalCount < inventory.items.length) {
    return unavailableCheckSource('GitHub returned an invalid exact-head check-run inventory.');
  }
  const items = [];
  for (const run of inventory.items.slice(0, MAX_CAPTURED_CHECK_ITEMS)) {
    if (!Number.isSafeInteger(run?.id) || run.id < 1) {
      return unavailableCheckSource('GitHub returned a malformed exact-head check run.');
    }
    items.push({
      id: run.id,
      name: typeof run.name === 'string' && run.name.trim() ? run.name.slice(0, 120) : 'Unnamed check run',
      status: CHECK_RUN_STATUSES.has(run.status) ? run.status : 'unknown',
      conclusion: run.conclusion == null ? '' :
        CHECK_RUN_CONCLUSIONS.has(run.conclusion) ? run.conclusion : 'unknown'
    });
  }
  return { available: true, error: '', totalCount: inventory.totalCount, items };
}

function compactCommitStatus(source) {
  if (source?.available !== true) return unavailableCommitStatusSource(source?.error);
  const inventory = source.items;
  if (!inventory || !Array.isArray(inventory.statuses) ||
      !Number.isSafeInteger(inventory.totalCount) || inventory.totalCount < inventory.statuses.length ||
      !['success', 'failure', 'pending', 'error'].includes(inventory.state)) {
    return unavailableCommitStatusSource('GitHub returned an invalid exact-head commit-status inventory.');
  }
  const items = [];
  for (const status of inventory.statuses.slice(0, MAX_CAPTURED_CHECK_ITEMS)) {
    if (typeof status?.context !== 'string' || !status.context.trim()) {
      return unavailableCommitStatusSource('GitHub returned a malformed exact-head status context.');
    }
    items.push({
      context: status.context.slice(0, 120),
      state: COMMIT_STATUS_STATES.has(status.state) ? status.state : 'unknown',
      description: typeof status.description === 'string' ? status.description.slice(0, 180) : ''
    });
  }
  return {
    available: true,
    error: '',
    state: inventory.state,
    totalCount: inventory.totalCount,
    items
  };
}

function compactHeadChecks(result, sha, capturedAt) {
  const exactSha = sha.toLowerCase();
  if (typeof result?.sha !== 'string' || result.sha.toLowerCase() !== exactSha) {
    return {
      sha: exactSha,
      captureStatus: 'captured',
      capturedAt,
      checkRuns: unavailableCheckSource('Exact-head response SHA did not match the selected pull-request head.'),
      commitStatus: unavailableCommitStatusSource('Exact-head response SHA did not match the selected pull-request head.')
    };
  }
  return {
    sha: exactSha,
    captureStatus: 'captured',
    capturedAt,
    checkRuns: compactCheckRuns(result?.checkRuns),
    commitStatus: compactCommitStatus(result?.commitStatus)
  };
}

function notCapturedHeadChecks(sha) {
  const reason = 'Not captured: this bounded build snapshot includes exact-head checks for only the three most recently updated pull requests.';
  return {
    sha: sha.toLowerCase(),
    captureStatus: 'not-captured',
    capturedAt: null,
    checkRuns: unavailableCheckSource(reason),
    commitStatus: unavailableCommitStatusSource(reason)
  };
}

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
 * Capture a minimal public-only projection. An optional host-provided read token
 * authenticates only this repository's GitHub REST requests; it is never stored.
 * No cookie, private record, PR body, issue body, or workflow log is requested.
 */
export async function createProjectStateEnvelope({
  fetchImpl = globalThis.fetch,
  token = process.env.GITHUB_TOKEN || null,
  now = () => new Date(),
  build = {
    sha: process.env.GITHUB_SHA || null,
    ref: process.env.GITHUB_REF || null,
    runId: process.env.GITHUB_RUN_ID || null
  }
} = {}) {
  let projection;
  let capturedAt;
  const snapshotFetch = withReadOnlyGitHubToken(fetchImpl, token);
  try {
    const snapshot = await loadGitHubGateSnapshot({ fetchImpl: snapshotFetch });
    projection = projectGitHubGate(snapshot);
    const selected = projection.pullRequests.slice(0, CHECKED_PULL_REQUEST_LIMIT);
    const checkResults = await Promise.all(selected.map(async record => {
      try {
        return await loadExactHeadChecks(snapshotFetch, record.headSha);
      } catch (error) {
        const message = typeof error?.message === 'string' ? error.message.slice(0, 240) : 'Exact-head check capture failed.';
        const unavailable = { available: false, error: message };
        return { sha: record.headSha, checkRuns: unavailable, commitStatus: unavailable };
      }
    }));
    capturedAt = now().toISOString();
    projection = {
      ...projection,
      pullRequests: projection.pullRequests.map((record, index) => ({
        ...record,
        headChecks: index < selected.length
          ? compactHeadChecks(checkResults[index], record.headSha, capturedAt)
          : notCapturedHeadChecks(record.headSha)
      }))
    };
  } catch (error) {
    projection = unavailableProjection(error);
  }

  capturedAt ||= now().toISOString();
  const payload = {
    schema: 'ngl.public-project-state.v3',
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

async function reusableSnapshotForSameBuild(target, nextPayload) {
  // Gradle may invoke preBuild again for instrumentation after assembleDebug.
  // Reuse only a receipt-validated snapshot from this exact workflow build,
  // and only when the new API response would lose a previously available source or exact-head check source.
  if (!nextPayload.build.runId) return null;

  let existingText;
  try {
    existingText = await readFile(target, 'utf8');
  } catch {
    return null;
  }

  const existing = await loadProjectStateSnapshot({
    fetchImpl: async () => ({ ok: true, text: async () => existingText })
  });
  if (!existing.available) return null;

  const previousPayload = existing.payload;
  if (previousPayload.build.runId !== nextPayload.build.runId ||
      previousPayload.build.sha !== nextPayload.build.sha ||
      previousPayload.build.ref !== nextPayload.build.ref) return null;

  const sourceKeys = ['pullRequests', 'issues', 'workflows'];
  const previousAvailable = sourceKeys.filter(key => previousPayload.sources[key].available);
  const lostExactHeadCheckSource = previousPayload.pullRequests.some(previous => {
    const next = nextPayload.pullRequests.find(candidate =>
      candidate.number === previous.number && candidate.headSha === previous.headSha);
    if (!next) return false;
    return ['checkRuns', 'commitStatus'].some(key =>
      previous.headChecks?.[key]?.available === true && next.headChecks?.[key]?.available !== true);
  });
  if (previousAvailable.every(key => nextPayload.sources[key].available) && !lostExactHeadCheckSource) return null;

  return {
    envelope: JSON.parse(existingText),
    payload: previousPayload,
    receipt: existing.receipt
  };
}

export async function writeProjectStateSnapshot({ outPath, rootDir = ROOT, ...options } = {}) {
  const safeRoot = resolve(rootDir);
  const target = resolve(outPath || resolve(safeRoot, 'android/app/build/generated/project-state/project-state.json'));
  const rel = relative(safeRoot, target);
  if (!rel || rel === '..' || rel.startsWith('..' + sep)) {
    throw new Error('Project-state output must remain inside the repository.');
  }
  const envelope = await createProjectStateEnvelope(options);
  const nextPayload = JSON.parse(envelope.payload);
  const preserved = await reusableSnapshotForSameBuild(target, nextPayload);
  const selectedEnvelope = preserved?.envelope || envelope;

  if (!preserved) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(selectedEnvelope, null, 2) + '\n', { mode: 0o644 });
  }

  const payload = JSON.parse(selectedEnvelope.payload);
  return {
    outPath: target,
    receipt: selectedEnvelope.receipt,
    capturedAt: payload.capturedAt,
    sources: payload.sources,
    preservedExisting: Boolean(preserved)
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await writeProjectStateSnapshot({ outPath: outputPathFromArgs(process.argv.slice(2)) });
  process.stdout.write(JSON.stringify({
    outPath: relative(ROOT, result.outPath).split(sep).join('/'),
    receipt: result.receipt,
    capturedAt: result.capturedAt,
    sources: result.sources,
    preservedExisting: result.preservedExisting
  }) + '\n');
}
