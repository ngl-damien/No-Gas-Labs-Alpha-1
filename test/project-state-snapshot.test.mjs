import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectStateEnvelope, writeProjectStateSnapshot } from '../scripts/capture-project-state.mjs';
import { loadProjectStateSnapshot, renderProjectStateSnapshot, summarizeHeadChecks } from '../game/project-state-snapshot.mjs';

const capturedAt = '2026-11-09T19:00:00.000Z';
const repo = 'https://api.github.com/repos/ngl-damien/No-Gas-Labs-Alpha-1';

function response(value) {
  return { ok: true, status: 200, async json() { return value; } };
}

function fixtureFetch({ failIssues = false, failCheckRuns = false, failCommitStatus = false, prCount = 1 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === repo + '/pulls?state=open&per_page=20&sort=updated&direction=desc') {
      return response(Array.from({ length: prCount }, (_, index) => {
        const number = 429 + index;
        const sha = index === 0 ? 'a'.repeat(40) : String(index + 1).repeat(40);
        return {
          number,
          title: index === 0 ? '<script>not markup</script>' : 'Captured pull request ' + number,
          draft: true,
          state: 'open',
          head: { ref: 'game/snapshot-' + index, sha },
          base: { ref: 'main', sha: 'b'.repeat(40) },
          updated_at: capturedAt.replace('.000Z', 'Z'),
          html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/' + number,
          body: 'This body must never enter the snapshot.'
        };
      }));
    }
    if (url === repo + '/issues?state=open&per_page=20') {
      if (failIssues) throw new Error('fixture issue source unavailable');
      return response([{
        number: 12, title: 'Evidence remains bounded', state: 'open', updated_at: capturedAt,
        html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/issues/12'
      }]);
    }
    if (url.startsWith(repo + '/commits/') && url.endsWith('/check-runs?per_page=100')) {
      if (failCheckRuns) throw new Error('fixture exact-head check-run source unavailable');
      return response({
        total_count: 2,
        check_runs: [
          { id: 7101, name: 'Verify', status: 'completed', conclusion: 'success' },
          { id: 7102, name: 'Android Alpha-1', status: 'in_progress', conclusion: null }
        ]
      });
    }
    if (url.startsWith(repo + '/commits/') && url.endsWith('/status?per_page=100')) {
      if (failCommitStatus) throw new Error('fixture exact-head commit-status source unavailable');
      return response({
        state: 'pending',
        total_count: 1,
        statuses: [{ context: 'Android Alpha-1', state: 'pending', description: 'Waiting for emulator acceptance' }]
      });
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

function descendants(element) {
  return [element, ...(element.children || []).flatMap(descendants)];
}

test('public snapshot capture uses only bounded unauthenticated GitHub GETs and a canonical RAE byte receipt', async () => {
  const { envelope, calls } = await makeEnvelope();
  const payload = JSON.parse(envelope.payload);
  assert.equal(envelope.schema, 'ngl.public-project-state-envelope.v1');
  assert.equal(payload.schema, 'ngl.public-project-state.v3');
  assert.equal(payload.repository, 'ngl-damien/No-Gas-Labs-Alpha-1');
  assert.equal(payload.capturedAt, capturedAt);
  assert.equal(payload.build.sha, 'd'.repeat(40));
  assert.equal(payload.pullRequests.length, 1);
  assert.equal(payload.pullRequests[0].headSha, 'a'.repeat(40));
  assert.equal(payload.pullRequests[0].baseSha, 'b'.repeat(40));
  assert.equal(payload.pullRequests[0].headChecks.sha, 'a'.repeat(40));
  assert.equal(payload.pullRequests[0].headChecks.captureStatus, 'captured');
  assert.equal(payload.pullRequests[0].headChecks.capturedAt, capturedAt);
  assert.deepEqual(payload.pullRequests[0].headChecks.checkRuns.items.map(item => [item.name, item.status, item.conclusion]), [
    ['Verify', 'completed', 'success'],
    ['Android Alpha-1', 'in_progress', '']
  ]);
  assert.equal(payload.pullRequests[0].headChecks.commitStatus.state, 'pending');
  assert.equal(payload.pullRequests[0].headChecks.commitStatus.items[0].context, 'Android Alpha-1');
  assert.equal(payload.issues.length, 1);
  assert.equal(payload.recentRuns.length, 3);
  assert.equal(payload.recentRuns[1].conclusion, 'failure');
  assert.equal(payload.recentRuns[2].status, 'in_progress');
  assert.equal(JSON.stringify(payload).includes('body must never'), false);
  assert.equal(JSON.stringify(payload).includes('<script>'), true, 'untrusted title remains data, not executable markup');
  assert.equal(envelope.receipt.algorithm, 'sha256');
  assert.equal(envelope.receipt.size, Buffer.byteLength(envelope.payload));
  assert.equal(envelope.receipt.digest, createHash('sha256').update(envelope.payload).digest('hex'));
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.cache, 'no-store');
    assert.equal(Object.keys(call.options.headers).some(key => key.toLowerCase() === 'authorization'), false);
  }
});

test('exact-head checks are captured only for the three newest PRs and remain bound to each SHA', async () => {
  const { envelope, calls } = await makeEnvelope({ prCount: 6 });
  const payload = JSON.parse(envelope.payload);
  assert.equal(payload.pullRequests.length, 6);
  assert.deepEqual(payload.pullRequests.slice(0, 3).map(item => item.headChecks.captureStatus),
    ['captured', 'captured', 'captured']);
  assert.deepEqual(payload.pullRequests.slice(3).map(item => item.headChecks.captureStatus),
    ['not-captured', 'not-captured', 'not-captured']);
  assert.ok(payload.pullRequests.every(item => item.headChecks.sha === item.headSha));
  assert.equal(calls.length, 9, 'three base reads plus two exact-head reads for each of three PRs');
  const result = await loadProjectStateSnapshot({
    fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify(envelope); } })
  });
  assert.equal(result.available, true);
  assert.equal(summarizeHeadChecks(payload.pullRequests[0].headChecks).status, 'waiting');
  assert.equal(summarizeHeadChecks(payload.pullRequests[5].headChecks).status, 'not-captured');
});

test('unavailable exact-head check sources remain explicit and never become a pass', async () => {
  const { envelope } = await makeEnvelope({ failCheckRuns: true, failCommitStatus: true });
  const payload = JSON.parse(envelope.payload);
  const checks = payload.pullRequests[0].headChecks;
  assert.equal(checks.captureStatus, 'captured');
  assert.equal(checks.checkRuns.available, false);
  assert.equal(checks.commitStatus.available, false);
  assert.equal(summarizeHeadChecks(checks).status, 'unavailable');
  const result = await loadProjectStateSnapshot({
    fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify(envelope); } })
  });
  assert.equal(result.available, true, 'check-source failure must not erase the otherwise valid project snapshot');
});

test('exact-head summary distinguishes complete success from failure, partial, and empty inventories', () => {
  const successful = {
    sha: 'a'.repeat(40),
    captureStatus: 'captured',
    capturedAt,
    checkRuns: {
      available: true,
      error: '',
      totalCount: 1,
      items: [{ id: 7201, name: 'Verify', status: 'completed', conclusion: 'success' }]
    },
    commitStatus: {
      available: true,
      error: '',
      state: 'success',
      totalCount: 1,
      items: [{ context: 'Verify', state: 'success', description: '' }]
    }
  };
  assert.equal(summarizeHeadChecks(successful).status, 'checks-reported-success');

  const failed = {
    ...successful,
    checkRuns: {
      ...successful.checkRuns,
      items: [{ ...successful.checkRuns.items[0], conclusion: 'failure' }]
    }
  };
  assert.equal(summarizeHeadChecks(failed).status, 'failure-reported');

  const truncated = {
    ...successful,
    checkRuns: { ...successful.checkRuns, totalCount: 2 }
  };
  assert.equal(summarizeHeadChecks(truncated).status, 'incomplete');

  const empty = {
    ...successful,
    checkRuns: { ...successful.checkRuns, totalCount: 0, items: [] },
    commitStatus: { ...successful.commitStatus, totalCount: 0, items: [] }
  };
  assert.equal(summarizeHeadChecks(empty).status, 'incomplete');

  const partial = {
    ...successful,
    checkRuns: {
      available: false,
      error: 'check-run source unavailable',
      totalCount: 0,
      items: []
    }
  };
  assert.equal(summarizeHeadChecks(partial).status, 'incomplete');
});

test('a check inventory for another commit cannot be attached to a PR lead', async () => {
  const { envelope } = await makeEnvelope();
  const payload = JSON.parse(envelope.payload);
  payload.pullRequests[0].headChecks.sha = 'c'.repeat(40);
  envelope.payload = JSON.stringify(payload);
  envelope.receipt = {
    algorithm: 'sha256',
    digest: createHash('sha256').update(envelope.payload).digest('hex'),
    size: Buffer.byteLength(envelope.payload)
  };
  const result = await loadProjectStateSnapshot({
    fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify(envelope); } })
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'SNAPSHOT_PAYLOAD_INVALID');
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

test('a PR snapshot without valid exact head and base SHAs fails closed', async () => {
  const { envelope } = await makeEnvelope();
  const payload = JSON.parse(envelope.payload);
  payload.pullRequests[0].headSha = 'not-a-commit';
  envelope.payload = JSON.stringify(payload);
  envelope.receipt = {
    algorithm: 'sha256',
    digest: createHash('sha256').update(envelope.payload).digest('hex'),
    size: Buffer.byteLength(envelope.payload)
  };
  const result = await loadProjectStateSnapshot({
    fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify(envelope); } })
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'SNAPSHOT_PAYLOAD_INVALID');

  const previousDocument = globalThis.document;
  globalThis.document = { createElement: tagName => new FakeElement(tagName) };
  try {
    const container = new FakeElement('div');
    const section = await renderProjectStateSnapshot(container, {
      fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify(envelope); } }),
      onRecordLead: () => assert.fail('an invalid exact-head record must never become a research lead')
    });
    assert.equal(section.dataset.projectStateStatus, 'unavailable');
    assert.equal(descendants(section).filter(item => item.dataset.projectStateRecordLead).length, 0);
    assert.match(section.textContent, /No project queue is inferred/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('tampered snapshot bytes fail closed instead of being rendered as current project state', async () => {
  const { envelope } = await makeEnvelope();
  const tamperedPayload = envelope.payload.replace('Evidence remains bounded', 'Evidence remains corrupt');
  assert.notEqual(tamperedPayload, envelope.payload, 'the tamper fixture must alter an existing payload value');
  assert.equal(Buffer.byteLength(tamperedPayload), Buffer.byteLength(envelope.payload),
    'the tamper fixture must preserve the receipt size so digest verification is exercised');
  const tampered = { ...envelope, payload: tamperedPayload };
  const result = await loadProjectStateSnapshot({
    fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify(tampered); } })
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'SNAPSHOT_RECEIPT_MISMATCH');
});

test('Synthesis Clerk snapshot rendering is read-only by default, explicit about staleness, and text-safe', async () => {
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
    assert.equal(section.dataset.projectStateReceiptDigest, envelope.receipt.digest);
    assert.equal(descendants(section).filter(item => item.dataset.projectStateRecordLead).length, 0,
      'the component exposes no lead action unless the caller explicitly supplies one');
    assert.match(section.textContent, /NOT LIVE/);
    assert.match(section.textContent, /OPEN PULL REQUESTS/);
    assert.match(section.textContent, /OPEN ISSUES/);
    assert.match(section.textContent, /RECENT WORKFLOW RUNS/);
    assert.match(section.textContent, /#429/);
    assert.match(section.textContent, /not independently verify claims/);
    assert.match(section.textContent, /EXACT-HEAD CHECKS/);
    assert.match(section.textContent, /GitHub-reported, build-time observations/);
    assert.equal(descendants(section).filter(item => item.dataset.projectStateHeadChecks).length, 1);
    assert.equal(section.children.some(child => child.tagName === 'script'), false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('snapshot record handoff is explicit and carries the exact capture and receipt into the caller', async () => {
  const { envelope } = await makeEnvelope();
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: tagName => new FakeElement(tagName) };
  try {
    const container = new FakeElement('div');
    const calls = [];
    const section = await renderProjectStateSnapshot(container, {
      fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify(envelope); } }),
      onRecordLead: lead => calls.push(lead)
    });
    const buttons = descendants(section).filter(item => item.dataset.projectStateRecordLead);
    assert.equal(buttons.length, 5);
    assert.equal(descendants(section).filter(item => item.dataset.projectStateExpand).length, 0,
      'a source group with eight or fewer records does not need an expansion control');
    assert.equal(calls.length, 0, 'rendering a snapshot must not create or prepare a retained event');
    assert.equal(section.dataset.projectStateReceiptDigest, envelope.receipt.digest);
    assert.equal(section.dataset.projectStateReceiptSize, String(envelope.receipt.size));
    assert.match(section.textContent, /nothing is retained until you explicitly submit/i);

    const pullRequestButton = buttons.find(item => item.dataset.projectStateRecordLead === 'pullRequests');
    assert.ok(pullRequestButton);
    assert.equal(pullRequestButton.type, 'button');
    assert.equal(pullRequestButton.className, 'list-button');
    assert.equal(pullRequestButton.dataset.projectStateRecordUrl,
      'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/429');
    assert.equal(pullRequestButton.dataset.projectStateRecordHeadSha, 'a'.repeat(40));
    assert.equal(pullRequestButton.dataset.projectStateRecordBaseSha, 'b'.repeat(40));
    assert.equal(pullRequestButton.dataset.projectStateRecordHeadUrl,
      'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/commit/' + 'a'.repeat(40));
    assert.equal(pullRequestButton.dataset.projectStateRecordCheckSha, 'a'.repeat(40));
    assert.equal(pullRequestButton.dataset.projectStateRecordCheckStatus, 'waiting');
    assert.equal(pullRequestButton.dataset.projectStateRecordCheckCapturedAt, capturedAt);
    assert.match(pullRequestButton.dataset.projectStateRecordCheckSummary, /WAITING/);
    assert.equal(pullRequestButton.attributes['aria-label'],
      'Prepare a research lead from #429 · <script>not markup</script>');

    pullRequestButton.onclick();
    assert.equal(calls.length, 1, 'only an explicit record selection invokes the handoff');
    assert.equal(calls[0].sourceKey, 'pullRequests');
    assert.equal(calls[0].record.number, 429);
    assert.equal(calls[0].record.headSha, 'a'.repeat(40));
    assert.equal(calls[0].record.baseSha, 'b'.repeat(40));
    assert.equal(calls[0].record.url, pullRequestButton.dataset.projectStateRecordUrl);
    assert.equal(calls[0].capturedAt, capturedAt);
    assert.deepEqual(calls[0].receipt, envelope.receipt);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('Synthesis Clerk snapshot explicitly reveals all captured records without creating a lead', async () => {
  const { envelope } = await makeEnvelope();
  const payload = JSON.parse(envelope.payload);
  const template = payload.pullRequests[0];
  payload.pullRequests = Array.from({ length: 10 }, (_, index) => ({
    ...template,
    number: 500 + index,
    title: 'Captured pull request ' + (index + 1),
    url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/' + (500 + index)
  }));
  envelope.payload = JSON.stringify(payload);
  envelope.receipt = {
    algorithm: 'sha256',
    digest: createHash('sha256').update(envelope.payload).digest('hex'),
    size: Buffer.byteLength(envelope.payload)
  };

  const previousDocument = globalThis.document;
  globalThis.document = { createElement: tagName => new FakeElement(tagName) };
  try {
    const container = new FakeElement('div');
    const calls = [];
    const section = await renderProjectStateSnapshot(container, {
      fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify(envelope); } }),
      onRecordLead: lead => calls.push(lead)
    });
    assert.equal(section.dataset.projectStateStatus, 'receipt-verified');

    const group = descendants(section).find(item => item.dataset.projectStateSource === 'pullRequests');
    assert.ok(group);
    const list = group.children.find(item => item.tagName === 'ul');
    assert.ok(list);
    assert.equal(list.children.length, 10);
    assert.deepEqual(list.children.map(item => item.hidden),
      [false, false, false, false, false, false, false, false, true, true]);

    const summary = group.children.find(item => item.dataset.projectStateVisibleCount === 'pullRequests');
    const toggle = group.children.find(item => item.dataset.projectStateExpand === 'pullRequests');
    assert.ok(summary);
    assert.ok(toggle);
    assert.equal(toggle.type, 'button');
    assert.equal(toggle.attributes['aria-controls'], list.id);
    assert.equal(toggle.attributes['aria-expanded'], 'false');
    assert.equal(toggle.textContent, 'Show all 10 captured records');
    assert.match(summary.textContent, /Showing newest 8 of 10 captured records/);
    assert.equal(calls.length, 0, 'revealing more records is not a research handoff');

    toggle.onclick();
    assert.deepEqual(list.children.map(item => item.hidden),
      [false, false, false, false, false, false, false, false, false, false]);
    assert.equal(toggle.attributes['aria-expanded'], 'true');
    assert.equal(toggle.textContent, 'Show newest 8 only');
    assert.equal(summary.textContent, 'Showing all 10 captured records.');

    const tenthLead = descendants(list.children[9]).find(item => item.dataset.projectStateRecordLead === 'pullRequests');
    assert.ok(tenthLead, 'the tenth captured record becomes actionable only after expansion');
    assert.equal(tenthLead.dataset.projectStateRecordUrl,
      'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/509');
    assert.equal(calls.length, 0);
    tenthLead.onclick();
    assert.equal(calls.length, 1, 'only explicit selection invokes the lead handoff');
    assert.equal(calls[0].record.number, 509);
    assert.equal(calls[0].receipt.digest, envelope.receipt.digest);

    toggle.onclick();
    assert.deepEqual(list.children.map(item => item.hidden),
      [false, false, false, false, false, false, false, false, true, true]);
    assert.equal(toggle.attributes['aria-expanded'], 'false');
    assert.equal(toggle.textContent, 'Show all 10 captured records');
    assert.equal(calls.length, 1, 'collapsing the list does not create another handoff');
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
    let leadCalls = 0;
    const section = await renderProjectStateSnapshot(container, {
      fetchImpl: async () => ({ ok: false, status: 404, async text() { return ''; } }),
      onRecordLead: () => { leadCalls += 1; }
    });
    assert.equal(section.dataset.projectStateStatus, 'unavailable');
    assert.equal(descendants(section).filter(item => item.dataset.projectStateRecordLead).length, 0);
    assert.equal(leadCalls, 0);
    assert.match(section.textContent, /SNAPSHOT UNAVAILABLE/);
    assert.match(section.textContent, /No project queue is inferred/);
    assert.doesNotMatch(section.textContent, /No records returned by this successful source response/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('same-run snapshot capture preserves a receipt-valid snapshot when a later API response loses sources', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-project-state-preserve-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'generated', 'project-state.json');
  const build = { sha: 'e'.repeat(40), ref: 'refs/pull/431/merge', runId: '9001' };
  const firstFetch = fixtureFetch().fetchImpl;
  const first = await writeProjectStateSnapshot({
    rootDir: directory, outPath: path, fetchImpl: firstFetch,
    now: () => new Date(capturedAt), build
  });
  const original = await readFile(path, 'utf8');

  const degraded = await writeProjectStateSnapshot({
    rootDir: directory, outPath: path,
    fetchImpl: async () => ({ ok: false, status: 403 }),
    now: () => new Date('2026-11-09T19:05:00.000Z'), build
  });

  assert.equal(degraded.preservedExisting, true);
  assert.equal(degraded.receipt.digest, first.receipt.digest);
  assert.equal(degraded.capturedAt, capturedAt);
  assert.deepEqual(degraded.sources, first.sources);
  assert.equal(await readFile(path, 'utf8'), original,
    'a later same-run rate-limit response must not overwrite the better captured bytes');
});

test('same-run snapshot capture preserves exact-head checks when later check endpoints become unavailable', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-project-state-check-preserve-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'generated', 'project-state.json');
  const build = { sha: '9'.repeat(40), ref: 'refs/pull/447/merge', runId: '9010' };
  const first = await writeProjectStateSnapshot({
    rootDir: directory, outPath: path, fetchImpl: fixtureFetch().fetchImpl,
    now: () => new Date(capturedAt), build
  });
  const original = await readFile(path, 'utf8');
  const degraded = await writeProjectStateSnapshot({
    rootDir: directory, outPath: path,
    fetchImpl: fixtureFetch({ failCheckRuns: true, failCommitStatus: true }).fetchImpl,
    now: () => new Date('2026-11-09T19:05:00.000Z'), build
  });
  assert.equal(degraded.preservedExisting, true);
  assert.equal(degraded.receipt.digest, first.receipt.digest);
  assert.equal(await readFile(path, 'utf8'), original);
});

test('same-run snapshot capture replaces an unavailable snapshot when sources recover', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-project-state-recover-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'generated', 'project-state.json');
  const build = { sha: 'f'.repeat(40), ref: 'refs/pull/431/merge', runId: '9002' };

  const unavailable = await writeProjectStateSnapshot({
    rootDir: directory, outPath: path,
    fetchImpl: async () => ({ ok: false, status: 403 }),
    now: () => new Date('2026-11-09T18:55:00.000Z'), build
  });
  assert.equal(unavailable.preservedExisting, false);
  assert.equal(Object.values(unavailable.sources).some(source => source.available), false);

  const recovered = await writeProjectStateSnapshot({
    rootDir: directory, outPath: path, fetchImpl: fixtureFetch().fetchImpl,
    now: () => new Date(capturedAt), build
  });
  assert.equal(recovered.preservedExisting, false);
  assert.equal(recovered.capturedAt, capturedAt);
  assert.equal(Object.values(recovered.sources).every(source => source.available), true);
  const stored = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(JSON.parse(stored.payload).capturedAt, capturedAt);
});

test('snapshot preservation never carries data across workflow run identities', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-project-state-run-boundary-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'generated', 'project-state.json');
  const first = await writeProjectStateSnapshot({
    rootDir: directory, outPath: path, fetchImpl: fixtureFetch().fetchImpl,
    now: () => new Date(capturedAt),
    build: { sha: 'a'.repeat(40), ref: 'refs/pull/431/merge', runId: '9003' }
  });
  assert.equal(Object.values(first.sources).every(source => source.available), true);

  const nextRun = await writeProjectStateSnapshot({
    rootDir: directory, outPath: path,
    fetchImpl: async () => ({ ok: false, status: 403 }),
    now: () => new Date('2026-11-09T19:10:00.000Z'),
    build: { sha: 'a'.repeat(40), ref: 'refs/pull/431/merge', runId: '9004' }
  });
  assert.equal(nextRun.preservedExisting, false);
  assert.equal(nextRun.capturedAt, '2026-11-09T19:10:00.000Z');
  assert.equal(Object.values(nextRun.sources).some(source => source.available), false);
  const stored = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(JSON.parse(stored.payload).build.runId, '9004');
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
