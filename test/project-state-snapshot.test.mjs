import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectStateEnvelope, writeProjectStateSnapshot } from '../scripts/capture-project-state.mjs';
import { loadProjectStateSnapshot, renderProjectStateSnapshot } from '../game/project-state-snapshot.mjs';

const capturedAt = '2026-11-09T19:00:00.000Z';
const repo = 'https://api.github.com/repos/ngl-damien/No-Gas-Labs-Alpha-1';

function response(value) {
  return { ok: true, status: 200, async json() { return value; } };
}

function fixtureFetch({ failIssues = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === repo + '/pulls?state=open&per_page=20') {
      return response([{
        number: 429, title: '<script>not markup</script>', draft: true, state: 'open',
        head: { ref: 'game/snapshot' }, base: { ref: 'main' }, updated_at: capturedAt.replace('.000Z', 'Z'),
        html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/429',
        body: 'This body must never enter the snapshot.'
      }]);
    }
    if (url === repo + '/issues?state=open&per_page=20') {
      if (failIssues) throw new Error('fixture issue source unavailable');
      return response([{
        number: 12, title: 'Evidence remains bounded', state: 'open', updated_at: capturedAt,
        html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/issues/12'
      }]);
    }
    if (url === repo + '/actions/runs?per_page=20') {
      return response({ workflow_runs: [
        {
          id: 7001, name: 'Verify', status: 'completed', conclusion: 'success',
          head_branch: 'main', head_sha: 'a'.repeat(40), run_number: 7001,
          updated_at: capturedAt, html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/7001'
        },
        {
          id: 7002, name: 'Android Alpha-1', status: 'completed', conclusion: 'failure',
          head_branch: 'game/snapshot', head_sha: 'b'.repeat(40), run_number: 7002,
          updated_at: capturedAt, html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/7002'
        },
        {
          id: 7003, name: 'Browser Acceptance', status: 'in_progress', conclusion: null,
          head_branch: 'game/snapshot', head_sha: 'c'.repeat(40), run_number: 7003,
          updated_at: capturedAt, html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/7003'
        }
      ] });
    }
    throw new Error('Unexpected public API request: ' + url);
  };
  return { fetchImpl, calls };
}

async function makeEnvelope(options = {}) {
  const { fetchImpl, calls } = fixtureFetch(options);
  const envelope = await createProjectStateEnvelope({
    fetchImpl,
    now: () => new Date(capturedAt),
    build: { sha: 'd'.repeat(40), ref: 'refs/pull/429/merge', runId: '7004' }
  });
  return { envelope, calls };
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this._text = '';
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}

test('public snapshot capture uses only bounded unauthenticated GitHub GETs and a canonical RAE byte receipt', async () => {
  const { envelope, calls } = await makeEnvelope();
  const payload = JSON.parse(envelope.payload);
  assert.equal(envelope.schema, 'ngl.public-project-state-envelope.v1');
  assert.equal(payload.schema, 'ngl.public-project-state.v1');
  assert.equal(payload.repository, 'ngl-damien/No-Gas-Labs-Alpha-1');
  assert.equal(payload.capturedAt, capturedAt);
  assert.equal(payload.build.sha, 'd'.repeat(40));
  assert.equal(payload.pullRequests.length, 1);
  assert.equal(payload.issues.length, 1);
  assert.equal(payload.recentRuns.length, 3);
  assert.equal(payload.recentRuns[1].conclusion, 'failure');
  assert.equal(payload.recentRuns[2].status, 'in_progress');
  assert.equal(JSON.stringify(payload).includes('body must never'), false);
  assert.equal(JSON.stringify(payload).includes('<script>'), true, 'untrusted title remains data, not executable markup');
  assert.equal(envelope.receipt.algorithm, 'sha256');
  assert.equal(envelope.receipt.size, Buffer.byteLength(envelope.payload));
  assert.equal(envelope.receipt.digest, createHash('sha256').update(envelope.payload).digest('hex'));
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.cache, 'no-store');
    assert.equal(Object.keys(call.options.headers).some(key => key.toLowerCase() === 'authorization'), false);
  }
});

test('an unavailable source stays unavailable and is never represented as an empty queue', async () => {
  const { envelope } = await makeEnvelope({ failIssues: true });
  const payload = JSON.parse(envelope.payload);
  assert.equal(payload.sources.issues.available, false);
  assert.match(payload.sources.issues.error, /fixture issue source unavailable/);
  assert.deepEqual(payload.issues, []);
  assert.equal(payload.sources.pullRequests.available, true);
  assert.equal(payload.sources.workflows.available, true);
});

test('the bundled snapshot reader fetches only the local asset and verifies exact payload bytes', async () => {
  const { envelope } = await makeEnvelope();
  const calls = [];
  const result = await loadProjectStateSnapshot({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, async text() { return JSON.stringify(envelope); } };
    }
  });
  assert.equal(result.available, true);
  assert.equal(result.payload.pullRequests[0].number, 429);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, './project-state.json');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.cache, 'no-store');
});

test('tampered snapshot bytes fail closed instead of being rendered as current project state', async () => {
  const { envelope } = await makeEnvelope();
  const tamperedPayload = envelope.payload.replace('Evidence remains bounded', 'Evidence remains forged');
  assert.notEqual(tamperedPayload, envelope.payload, 'the tamper fixture must alter an existing payload value');
  const tampered = { ...envelope, payload: tamperedPayload };
  const result = await loadProjectStateSnapshot({
    fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify(tampered); } })
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'SNAPSHOT_RECEIPT_MISMATCH');
});

test('Synthesis Clerk snapshot rendering is read-only, explicit about staleness, and text-only', async () => {
  const { envelope } = await makeEnvelope();
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: tagName => new FakeElement(tagName) };
  try {
    const container = new FakeElement('div');
    const section = await renderProjectStateSnapshot(container, {
      fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify(envelope); } })
    });
    assert.equal(container.children.length, 1);
    assert.equal(section.dataset.projectStateSnapshot, 'true');
    assert.equal(section.dataset.projectStateStatus, 'receipt-verified');
    assert.equal(section.dataset.projectStateCapturedAt, capturedAt);
    assert.equal(section.dataset.projectStateBuildSha, 'd'.repeat(40));
    assert.match(section.textContent, /NOT LIVE/);
    assert.match(section.textContent, /OPEN PULL REQUESTS/);
    assert.match(section.textContent, /OPEN ISSUES/);
    assert.match(section.textContent, /RECENT WORKFLOW RUNS/);
    assert.match(section.textContent, /#429/);
    assert.match(section.textContent, /not independently verify claims/);
    assert.equal(section.children.some(child => child.tagName === 'script'), false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('a missing snapshot is visibly unavailable rather than an invented zero-state', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: tagName => new FakeElement(tagName) };
  try {
    const container = new FakeElement('div');
    const section = await renderProjectStateSnapshot(container, {
      fetchImpl: async () => ({ ok: false, status: 404, async text() { return ''; } })
    });
    assert.equal(section.dataset.projectStateStatus, 'unavailable');
    assert.match(section.textContent, /SNAPSHOT UNAVAILABLE/);
    assert.match(section.textContent, /No project queue is inferred/);
    assert.doesNotMatch(section.textContent, /No records returned by this successful source response/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('snapshot writer creates a bounded artifact under its explicit build root', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-project-state-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'generated', 'project-state.json');
  const { fetchImpl } = fixtureFetch();
  const result = await writeProjectStateSnapshot({
    rootDir: directory,
    outPath: path,
    fetchImpl,
    now: () => new Date(capturedAt),
    build: { sha: 'e'.repeat(40), ref: 'refs/heads/main', runId: '8001' }
  });
  const stored = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(result.receipt.digest, stored.receipt.digest);
  assert.equal(JSON.parse(stored.payload).build.sha, 'e'.repeat(40));
  await assert.rejects(writeProjectStateSnapshot({
    rootDir: directory,
    outPath: join(directory, '..', 'outside-project-state.json'),
    fetchImpl
  }), /inside the repository/);
});
