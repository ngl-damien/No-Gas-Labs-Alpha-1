import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  loadGitHubGateSnapshot,
  projectGitHubGate,
  renderGitHubDecisionGate,
  shouldRenderGitHubDecisionGate,
  parseGitHubBlobUrl,
  loadGitHubSourceFile,
  formatGitHubSourceCitation,
  parseGitHubSourceCitation,
  readLocalGitHubSourceCaptures,
  saveLocalGitHubSourceCapture,
  removeLocalGitHubSourceCapture,
  renderGitHubSourceReader
} from '../game/github-decision-gate.mjs';

const api = 'https://api.github.com/repos/ngl-damien/No-Gas-Labs-Alpha-1';
function response(value, ok = true, status = 200) {
  return { ok, status, async json() { return value; } };
}
function textResponse(value, ok = true, status = 200) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  return new Response(body, {
    status: ok ? status : (status === 200 ? 404 : status),
    headers: { 'content-length': String(Buffer.byteLength(body)) }
  });
}
function githubSourceFixture(bytes, commit = 'a'.repeat(40), path = 'game/quests.mjs', owner = 'ngl-damien', repo = 'No-Gas-Labs-Alpha-1') {
  const blobSha = createHash('sha1').update('blob ' + bytes.length + String.fromCharCode(0)).update(bytes).digest('hex');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const url = 'https://github.com/' + owner + '/' + repo + '/blob/' + commit + '/' + path;
  const apiUrl = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path + '?ref=' + commit;
  return {
    bytes, commit, path, blobSha, sha256, url, apiUrl,
    payload: { type: 'file', encoding: 'base64', size: bytes.length, sha: blobSha, path, content: bytes.toString('base64') }
  };
}
function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem(key) { assert.equal(key, 'ngl.source-observatory.local-captures.v1'); return value; },
    setItem(key, next) { assert.equal(key, 'ngl.source-observatory.local-captures.v1'); value = next; },
    get value() { return value; }
  };
}
function recordFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (route === undefined) return response({ message: 'not found' }, false, 404);
    return route;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}
class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.textContent = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
}
function withDocument(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = { createElement: tag => new FakeElement(tag) };
  return Promise.resolve().then(run).finally(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
}
function walk(node) {
  return [node, ...(node.children || []).flatMap(walk)];
}
function textOf(node) {
  return walk(node).map(item => item.textContent || '').join('\n');
}

test('GitHub snapshot separates live pull requests, issues, failures, and running workflows', async () => {
  const fetchImpl = recordFetch({
    [api + '/pulls?state=open&per_page=20&sort=updated&direction=desc']: response([
      { number: 417, title: 'Clerk', draft: true, state: 'open', head: { ref: 'npc', sha: 'a'.repeat(40) }, base: { ref: 'main', sha: 'b'.repeat(40) }, html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/417' }
    ]),
    [api + '/issues?state=open&per_page=20']: response([
      { number: 310, title: 'Authority boundary', state: 'open', html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/issues/310' },
      { number: 417, title: 'PR duplicate', pull_request: {}, state: 'open' }
    ]),
    [api + '/actions/runs?per_page=20']: response({ workflow_runs: [
      { id: 900, name: 'Android', status: 'completed', conclusion: 'failure', run_number: 8, head_branch: 'main', head_sha: 'a'.repeat(40) },
      { id: 901, name: 'Browser', status: 'in_progress', conclusion: null, run_number: 9 },
      { id: 902, name: 'Verify', status: 'completed', conclusion: 'success', run_number: 10 }
    ] })
  });
  const snapshot = await loadGitHubGateSnapshot({ fetchImpl });
  const projection = projectGitHubGate(snapshot);
  assert.equal(projection.pullRequests.length, 1);
  assert.equal(projection.pullRequests[0].headSha, 'a'.repeat(40));
  assert.equal(projection.pullRequests[0].baseSha, 'b'.repeat(40));
  assert.equal(projection.issues.length, 1);
  assert.equal(projection.issues[0].number, 310);
  assert.deepEqual(projection.failedRuns.map(run => run.id), [900]);
  assert.deepEqual(projection.runningRuns.map(run => run.id), [901]);
  assert.deepEqual(projection.recentRuns.map(run => run.id), [900, 901, 902]);
  assert.equal(fetchImpl.calls.length, 3);
  assert.ok(fetchImpl.calls.every(call => call.options.cache === 'no-store'));
});

test('failed or malformed source remains unavailable instead of becoming an empty queue', async () => {
  const fetchImpl = recordFetch({
    [api + '/pulls?state=open&per_page=20&sort=updated&direction=desc']: response({ unexpected: true }),
    [api + '/issues?state=open&per_page=20']: new Error('offline'),
    [api + '/actions/runs?per_page=20']: response({ workflow_runs: [] })
  });
  const snapshot = await loadGitHubGateSnapshot({ fetchImpl });
  const projection = projectGitHubGate(snapshot);
  assert.equal(projection.sources.pullRequests.available, false);
  assert.equal(projection.sources.issues.available, false);
  assert.equal(projection.sources.workflows.available, true);
  assert.equal(projection.failedRuns.length, 0);
  assert.equal(projection.runningRuns.length, 0);
});

test('investigation fetches the exact PR detail and changed paths without interpreting body text as markup', async () => withDocument(async () => {
  const fetchImpl = recordFetch({
    [api + '/pulls?state=open&per_page=20&sort=updated&direction=desc']: response([
      { number: 12, title: '<img src=x onerror=alert(1)>', draft: false, state: 'open', head: { ref: 'feature' }, base: { ref: 'main' } }
    ]),
    [api + '/issues?state=open&per_page=20']: response([]),
    [api + '/actions/runs?per_page=20']: response({ workflow_runs: [] }),
    [api + '/pulls/12']: response({
      number: 12, title: 'Exact PR', body: '<script>not executable</script>',
      state: 'open', draft: true, base: { ref: 'main' }, head: { ref: 'feature' },
      html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/12'
    }),
    [api + '/pulls/12/files?per_page=30']: response([{ filename: 'game/client.mjs' }])
  });
  const root = new FakeElement('div');
  await renderGitHubDecisionGate(root, { fetchImpl });
  const action = walk(root).find(node => node.dataset?.investigateKind === 'pull');
  assert.ok(action);
  await action.listeners.click();
  const output = textOf(root);
  assert.match(output, /Exact PR/);
  assert.match(output, /game\/client\.mjs/);
  assert.match(output, /script>not executable/);
  assert.match(output, /EVIDENCE INCOMPLETE/);
  assert.equal(walk(root).some(node => node.tagName === 'script'), false);
  assert.equal(fetchImpl.calls.length, 5);
  assert.equal(fetchImpl.calls.some(call => call.url.includes('/commits/')), false,
    'a missing head SHA must not trigger an unbound check lookup');
}));

test('workflow investigation fetches run jobs and preserves each job conclusion', async () => withDocument(async () => {
  const fetchImpl = recordFetch({
    [api + '/pulls?state=open&per_page=20&sort=updated&direction=desc']: response([]),
    [api + '/issues?state=open&per_page=20']: response([]),
    [api + '/actions/runs?per_page=20']: response({ workflow_runs: [
      { id: 55, name: 'Android', status: 'completed', conclusion: 'failure', run_number: 4, head_branch: 'feature' }
    ] }),
    [api + '/actions/runs/55']: response({
      id: 55, name: 'Android', status: 'completed', conclusion: 'failure',
      html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/55'
    }),
    [api + '/actions/runs/55/jobs?per_page=50']: response({ jobs: [
      { name: 'Emulator', status: 'completed', conclusion: 'failure' },
      { name: 'Assemble', status: 'completed', conclusion: 'success' }
    ] })
  });
  const root = new FakeElement('div');
  await renderGitHubDecisionGate(root, { fetchImpl });
  const action = walk(root).find(node => node.dataset?.investigateKind === 'workflow');
  assert.ok(action);
  await action.listeners.click();
  assert.match(textOf(root), /Emulator · completed · failure/);
  assert.match(textOf(root), /Assemble · completed · success/);
}));

test('a hung GitHub request is bounded, aborted when supported, and leaves refresh retryable', async () => withDocument(async () => {
  const pullsUrl = api + '/pulls?state=open&per_page=20&sort=updated&direction=desc';
  const issuesUrl = api + '/issues?state=open&per_page=20';
  const workflowsUrl = api + '/actions/runs?per_page=20';
  let pullAttempts = 0;
  let firstSignal = null;
  const fetchImpl = async (url, options) => {
    if (url === pullsUrl) {
      pullAttempts += 1;
      if (pullAttempts === 1) {
        firstSignal = options.signal;
        // Deliberately ignore AbortSignal: the deadline must still release the UI.
        return new Promise(() => {});
      }
      return response([]);
    }
    if (url === issuesUrl) return response([]);
    if (url === workflowsUrl) return response({ workflow_runs: [] });
    throw new Error('Unexpected GitHub URL: ' + url);
  };
  const root = new FakeElement('div');
  await renderGitHubDecisionGate(root, { fetchImpl, timeoutMs: 20 });
  const refresh = walk(root).find(node => node.textContent === 'Refresh live state');
  assert.ok(refresh);
  assert.equal(firstSignal?.aborted, true);
  assert.equal(refresh.disabled, false);
  assert.ok(textOf(root).includes('2/3 GitHub sources available'));

  refresh.listeners.click();
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(pullAttempts, 2);
  assert.equal(refresh.disabled, false);
  assert.ok(textOf(root).includes('3/3 GitHub sources available'));
}));


test('the live GitHub decision gate is scoped to Founder Gate and survives an in-place decision refresh', async () => {
  for (const locationId of ['decision_chamber']) {
    assert.equal(shouldRenderGitHubDecisionGate(locationId), true);
  }
  for (const locationId of [null, undefined, 'town-square', 'guild_hall', 'source_observatory', 'moonshot_field']) {
    assert.equal(shouldRenderGitHubDecisionGate(locationId), false);
  }

  const client = await (await import('node:fs/promises')).readFile(
    new URL('../game/client.mjs', import.meta.url),
    'utf8'
  );
  assert.match(client, /if \(shouldRenderGitHubDecisionGate\(locationId\)\) \{\s*await renderGitHubDecisionGate\(content\);\s*\}/);
  assert.ok(client.includes('await openInstitution(locationId);'),
    'a decision refresh must keep the player at the same institutional location');
  const openInstitutionStart = client.indexOf('async function openInstitution(');
  const privateStart = client.indexOf("if (mode !== 'shared')", openInstitutionStart);
  const privateEnd = client.indexOf('const requestGeneration', privateStart);
  const privateBranch = client.slice(privateStart, privateEnd);
  assert.ok(openInstitutionStart >= 0 && privateStart > openInstitutionStart && privateEnd > privateStart);
  assert.match(privateBranch, /shouldRenderGitHubDecisionGate\(locationId\)/,
    'the private/offline Founder Gate must remain enterable without a shared service');
  assert.match(privateBranch, /await renderGitHubDecisionGate\(content\)/,
    'private mode must render the read-only public Gate and show unavailable sources instead of hiding the location');
  assert.match(privateBranch, /unavailable sources remain unavailable/,
    'offline repository state must not be inferred from local game progress or stale data');
});


test('PR investigation branches on check runs and commit status for the exact head SHA', async () => withDocument(async () => {
  const sha = 'b'.repeat(40);
  const runUrl = 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/700';
  const fetchImpl = recordFetch({
    [api + '/pulls?state=open&per_page=20&sort=updated&direction=desc']: response([
      { number: 88, title: 'Combat Yard integration', draft: true, state: 'open',
        head: { ref: 'feature', sha }, base: { ref: 'main' } }
    ]),
    [api + '/issues?state=open&per_page=20']: response([]),
    [api + '/actions/runs?per_page=20']: response({ workflow_runs: [] }),
    [api + '/pulls/88']: response({
      number: 88, title: 'Combat Yard integration', body: 'Proposed change.',
      state: 'open', draft: true, base: { ref: 'main' },
      head: { ref: 'feature', sha },
      html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/88'
    }),
    [api + '/pulls/88/files?per_page=30']: response([{ filename: 'game/combat.mjs' }]),
    [api + '/commits/' + sha + '/check-runs?per_page=100']: response({ total_count: 2, check_runs: [
      { name: 'Android Alpha-1', status: 'completed', conclusion: 'failure', html_url: runUrl },
      { name: '<img src=x onerror=alert(1)>', status: 'completed', conclusion: 'success',
        html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/701' }
    ] }),
    [api + '/commits/' + sha + '/status?per_page=100']: response({
      state: 'failure', total_count: 1,
      statuses: [{ context: 'Android Alpha-1', state: 'failure', description: 'Emulator journey failed.', target_url: runUrl }]
    })
  });
  const root = new FakeElement('div');
  await renderGitHubDecisionGate(root, { fetchImpl });
  const action = walk(root).find(node => node.dataset?.investigateKind === 'pull');
  assert.ok(action);
  await action.listeners.click();

  const output = textOf(root);
  assert.match(output, /CHOOSE YOUR PATH/);
  assert.match(output, /BLOCKED/);
  assert.match(output, /Android Alpha-1/);
  assert.match(output, new RegExp(sha));
  assert.match(output, /does not merge, write, approve, deploy, or change repository state/);
  assert.equal(walk(root).some(node => node.tagName === 'img'), false);
  assert.ok(fetchImpl.calls.some(call => call.url === api + '/commits/' + sha + '/check-runs?per_page=100'));
  assert.ok(fetchImpl.calls.some(call => call.url === api + '/commits/' + sha + '/status?per_page=100'));
  const follow = walk(root).find(node => node.textContent === 'Follow check: Android Alpha-1');
  assert.equal(follow?.href, runUrl);
  const exactHead = walk(root).find(node => node.textContent === 'Open exact head commit');
  assert.equal(exactHead?.href, 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/commit/' + sha);
}));

test('exact-head decision path waits on pending checks and does not treat a parent result as current', async () => withDocument(async () => {
  const sha = 'c'.repeat(40);
  const fetchImpl = recordFetch({
    [api + '/pulls?state=open&per_page=20&sort=updated&direction=desc']: response([
      { number: 89, title: 'Pending feature', draft: true, state: 'open',
        head: { ref: 'pending', sha }, base: { ref: 'main' } }
    ]),
    [api + '/issues?state=open&per_page=20']: response([]),
    [api + '/actions/runs?per_page=20']: response({ workflow_runs: [] }),
    [api + '/pulls/89']: response({
      number: 89, title: 'Pending feature', head: { ref: 'pending', sha },
      html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/89'
    }),
    [api + '/pulls/89/files?per_page=30']: response([]),
    [api + '/commits/' + sha + '/check-runs?per_page=100']: response({ total_count: 1, check_runs: [
      { name: 'Android Alpha-1', status: 'in_progress', conclusion: null,
        html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/702' }
    ] }),
    [api + '/commits/' + sha + '/status?per_page=100']: response({
      state: 'pending', total_count: 1,
      statuses: [{ context: 'Android Alpha-1', state: 'pending', description: 'Emulator journey running.' }]
    })
  });
  const root = new FakeElement('div');
  await renderGitHubDecisionGate(root, { fetchImpl });
  const action = walk(root).find(node => node.dataset?.investigateKind === 'pull');
  await action.listeners.click();
  assert.match(textOf(root), /WAIT — exact-head checks are still running/);
  assert.match(textOf(root), /Follow check: Android Alpha-1/);
}));

test('partial exact-head check availability remains incomplete instead of becoming a pass', async () => withDocument(async () => {
  const sha = 'd'.repeat(40);
  const fetchImpl = recordFetch({
    [api + '/pulls?state=open&per_page=20&sort=updated&direction=desc']: response([
      { number: 90, title: 'Partial checks', draft: true, state: 'open',
        head: { ref: 'partial', sha }, base: { ref: 'main' } }
    ]),
    [api + '/issues?state=open&per_page=20']: response([]),
    [api + '/actions/runs?per_page=20']: response({ workflow_runs: [] }),
    [api + '/pulls/90']: response({
      number: 90, title: 'Partial checks', head: { ref: 'partial', sha },
      html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/90'
    }),
    [api + '/pulls/90/files?per_page=30']: response([]),
    [api + '/commits/' + sha + '/check-runs?per_page=100']: new Error('rate limit'),
    [api + '/commits/' + sha + '/status?per_page=100']: response({
      state: 'success', total_count: 1,
      statuses: [{ context: 'One status context', state: 'success' }]
    })
  });
  const root = new FakeElement('div');
  await renderGitHubDecisionGate(root, { fetchImpl });
  const action = walk(root).find(node => node.dataset?.investigateKind === 'pull');
  await action.listeners.click();
  const output = textOf(root);
  assert.match(output, /EVIDENCE INCOMPLETE/);
  assert.match(output, /CHECK RUNS UNAVAILABLE/);
  assert.doesNotMatch(output, /CHECKS REPORTED SUCCESS/);
}));


test('truncated exact-head check inventories cannot be presented as a complete green result', async () => withDocument(async () => {
  const sha = 'e'.repeat(40);
  const checks = Array.from({ length: 100 }, (_, index) => ({
    name: 'Check ' + index, status: 'completed', conclusion: 'success'
  }));
  const fetchImpl = recordFetch({
    [api + '/pulls?state=open&per_page=20&sort=updated&direction=desc']: response([
      { number: 91, title: 'Many checks', draft: true, state: 'open',
        head: { ref: 'many-checks', sha }, base: { ref: 'main' } }
    ]),
    [api + '/issues?state=open&per_page=20']: response([]),
    [api + '/actions/runs?per_page=20']: response({ workflow_runs: [] }),
    [api + '/pulls/91']: response({
      number: 91, title: 'Many checks', head: { ref: 'many-checks', sha },
      html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/91'
    }),
    [api + '/pulls/91/files?per_page=30']: response([]),
    [api + '/commits/' + sha + '/check-runs?per_page=100']: response({
      total_count: 101, check_runs: checks
    }),
    [api + '/commits/' + sha + '/status?per_page=100']: response({
      state: 'success', total_count: 1,
      statuses: [{ context: 'One context', state: 'success' }]
    })
  });
  const root = new FakeElement('div');
  await renderGitHubDecisionGate(root, { fetchImpl });
  const action = walk(root).find(node => node.dataset?.investigateKind === 'pull');
  await action.listeners.click();
  const output = textOf(root);
  assert.match(output, /100\/101 returned/);
  assert.match(output, /EVIDENCE INCOMPLETE/);
  assert.doesNotMatch(output, /CHECKS REPORTED SUCCESS/);
}));


test('exact-head green path still separates CI success from review and Founder authority', async () => withDocument(async () => {
  const sha = 'f'.repeat(40);
  const fetchImpl = recordFetch({
    [api + '/pulls?state=open&per_page=20&sort=updated&direction=desc']: response([
      { number: 92, title: 'Green feature', draft: true, state: 'open',
        head: { ref: 'green', sha }, base: { ref: 'main' } }
    ]),
    [api + '/issues?state=open&per_page=20']: response([]),
    [api + '/actions/runs?per_page=20']: response({ workflow_runs: [] }),
    [api + '/pulls/92']: response({
      number: 92, title: 'Green feature', head: { ref: 'green', sha },
      html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/92'
    }),
    [api + '/pulls/92/files?per_page=30']: response([]),
    [api + '/commits/' + sha + '/check-runs?per_page=100']: response({
      total_count: 2,
      check_runs: [
        { name: 'Verify', status: 'completed', conclusion: 'success' },
        { name: 'Browser Acceptance', status: 'completed', conclusion: 'success' }
      ]
    }),
    [api + '/commits/' + sha + '/status?per_page=100']: response({
      state: 'success', total_count: 1,
      statuses: [{ context: 'Combined', state: 'success' }]
    })
  });
  const root = new FakeElement('div');
  await renderGitHubDecisionGate(root, { fetchImpl });
  const action = walk(root).find(node => node.dataset?.investigateKind === 'pull');
  await action.listeners.click();
  const output = textOf(root);
  assert.match(output, /CHECKS REPORTED SUCCESS/);
  assert.match(output, /Independent review, integration, and Founder authority remain separate/);
}));


test('malformed exact-head inventory totals remain unavailable and can never produce a green path', async () => withDocument(async () => {
  const sha = '9'.repeat(40);
  const goodRuns = [{ name: 'Verify', status: 'completed', conclusion: 'success' }];
  const goodStatuses = [{ context: 'Combined', state: 'success' }];
  const validRuns = { total_count: 1, check_runs: goodRuns };
  const validStatus = { state: 'success', total_count: 1, statuses: goodStatuses };
  const cases = [
    { name: 'missing check-run total_count', checkRuns: { check_runs: goodRuns }, commitStatus: validStatus },
    { name: 'negative check-run total_count', checkRuns: { total_count: -1, check_runs: goodRuns }, commitStatus: validStatus },
    { name: 'check-run total_count smaller than returned items', checkRuns: { total_count: 0, check_runs: goodRuns }, commitStatus: validStatus },
    { name: 'missing status total_count', checkRuns: validRuns, commitStatus: { state: 'success', statuses: goodStatuses } },
    { name: 'negative status total_count', checkRuns: validRuns, commitStatus: { state: 'success', total_count: -1, statuses: goodStatuses } },
    { name: 'status total_count smaller than returned items', checkRuns: validRuns, commitStatus: { state: 'success', total_count: 0, statuses: goodStatuses } }
  ];
  for (const item of cases) {
    const fetchImpl = recordFetch({
      [api + '/pulls?state=open&per_page=20&sort=updated&direction=desc']: response([
        { number: 93, title: 'Malformed inventory', draft: true, state: 'open',
          head: { ref: 'malformed', sha }, base: { ref: 'main' } }
      ]),
      [api + '/issues?state=open&per_page=20']: response([]),
      [api + '/actions/runs?per_page=20']: response({ workflow_runs: [] }),
      [api + '/pulls/93']: response({
        number: 93, title: 'Malformed inventory', head: { ref: 'malformed', sha },
        html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/93'
      }),
      [api + '/pulls/93/files?per_page=30']: response([]),
      [api + '/commits/' + sha + '/check-runs?per_page=100']: response(item.checkRuns),
      [api + '/commits/' + sha + '/status?per_page=100']: response(item.commitStatus)
    });
    const root = new FakeElement('div');
    await renderGitHubDecisionGate(root, { fetchImpl });
    const action = walk(root).find(node => node.dataset?.investigateKind === 'pull');
    await action.listeners.click();
    const output = textOf(root);
    assert.match(output, /EVIDENCE INCOMPLETE/, item.name);
    assert.doesNotMatch(output, /CHECKS REPORTED SUCCESS/, item.name);
  }
}));

test('rechecking a pull request fetches its new head and offers real read-only path choices', async () => withDocument(async () => {
  const oldSha = 'a'.repeat(40);
  const newSha = 'b'.repeat(40);
  const calls = [];
  let detailCalls = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === api + '/pulls?state=open&per_page=20&sort=updated&direction=desc') return response([
      { number: 94, title: 'Head-changing feature', draft: true, state: 'open',
        head: { ref: 'head-changing', sha: oldSha }, base: { ref: 'main' } }
    ]);
    if (url === api + '/issues?state=open&per_page=20') return response([]);
    if (url === api + '/actions/runs?per_page=20') return response({ workflow_runs: [] });
    if (url === api + '/pulls/94') {
      detailCalls += 1;
      const sha = detailCalls === 1 ? oldSha : newSha;
      return response({
        number: 94, title: 'Head-changing feature', body: 'Read-only fixture.',
        state: 'open', draft: true, base: { ref: 'main', sha: 'c'.repeat(40) },
        head: { ref: 'head-changing', sha },
        html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/94'
      });
    }
    if (url === api + '/pulls/94/files?per_page=30') return response([{ filename: 'game/client.mjs' }]);
    if (url === api + '/commits/' + oldSha + '/check-runs?per_page=100') return response({
      total_count: 1,
      check_runs: [{ name: 'Android Alpha-1', status: 'completed', conclusion: 'failure',
        html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/94' }]
    });
    if (url === api + '/commits/' + oldSha + '/status?per_page=100') return response({
      state: 'failure', total_count: 1,
      statuses: [{ context: 'Android Alpha-1', state: 'failure' }]
    });
    if (url === api + '/commits/' + newSha + '/check-runs?per_page=100') return response({
      total_count: 1,
      check_runs: [{ name: 'Browser Acceptance', status: 'in_progress', conclusion: null,
        html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/95' }]
    });
    if (url === api + '/commits/' + newSha + '/status?per_page=100') return response({
      state: 'pending', total_count: 1,
      statuses: [{ context: 'Browser Acceptance', state: 'pending' }]
    });
    throw new Error('Unexpected GitHub URL: ' + url);
  };
  const root = new FakeElement('div');
  await renderGitHubDecisionGate(root, { fetchImpl });
  const investigate = walk(root).find(node => node.dataset?.investigateKind === 'pull');
  await investigate.listeners.click();
  let path = walk(root).find(node => node.dataset?.exactHeadChecks === 'true');
  assert.equal(path.dataset.decisionState, 'blocked');
  const recheck = walk(root).find(node => node.dataset?.gateChoice === 'recheck-current-head');
  assert.equal(recheck?.textContent, 'Recheck after repair');
  await recheck.listeners.click();
  path = walk(root).find(node => node.dataset?.exactHeadChecks === 'true');
  assert.equal(path.dataset.decisionState, 'waiting');
  assert.match(textOf(path), /HEAD CHANGED/);
  assert.match(textOf(path), new RegExp(newSha));
  assert.equal(detailCalls, 2);
  assert.ok(calls.some(call => call.url === api + '/commits/' + oldSha + '/check-runs?per_page=100'));
  assert.ok(calls.some(call => call.url === api + '/commits/' + newSha + '/check-runs?per_page=100'));
  assert.ok(calls.every(call => call.options.method === 'GET' && !('body' in call.options)),
    'every Gate branch must remain read-only');
  const back = walk(root).find(node => node.dataset?.gateChoice === 'back-to-doors');
  assert.ok(back);
  await back.listeners.click();
  assert.match(textOf(root), /Choose another record from the three doors above/);
  assert.ok(walk(root).some(node => node.dataset?.investigateKind === 'pull'),
    'the original doors remain available after returning');
}));

test('commit-pinned GitHub source URLs reject mutable refs, other repositories, and unsafe locations', () => {
  const commit = 'a'.repeat(40);
  const url = 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/blob/' + commit + '/game/quests.mjs';
  const parsed = parseGitHubBlobUrl(url);
  assert.equal(parsed.commitSha, commit);
  assert.equal(parsed.path, 'game/quests.mjs');
  assert.equal(parsed.permalink, url);
  const donor = parseGitHubBlobUrl('https://github.com/example-org/research-notes/blob/' + commit + '/docs/source.md');
  assert.equal(donor.owner, 'example-org');
  assert.equal(donor.repo, 'research-notes');
  assert.equal(donor.path, 'docs/source.md');
  for (const invalid of [
    'http://github.com/ngl-damien/No-Gas-Labs-Alpha-1/blob/' + commit + '/game/quests.mjs',
    'https://evil.example/ngl-damien/No-Gas-Labs-Alpha-1/blob/' + commit + '/game/quests.mjs',
    'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/blob/main/game/quests.mjs',
    url + '?plain=1',
    url + '#L10',
    'https://user:pass@github.com/ngl-damien/No-Gas-Labs-Alpha-1/blob/' + commit + '/game/quests.mjs',
    'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/blob/' + commit + '/game/%2e%2e/secret.txt',
    'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/blob/' + commit + '/game%2fsecret.txt'
  ]) {
    assert.throws(() => parseGitHubBlobUrl(invalid));
  }
});

test('GitHub source retrieval is commit-pinned, bounded, credential-free, and byte-checked', async () => {
  const fixture = githubSourceFixture(Buffer.from('// source fixture\nexport const answer = 42;\n', 'utf8'));
  const fetchImpl = recordFetch({ [fixture.apiUrl]: textResponse(fixture.payload) });
  const result = await loadGitHubSourceFile(fixture.url, { fetchImpl });
  assert.equal(result.text, fixture.bytes.toString('utf8'));
  assert.equal(result.size, fixture.bytes.length);
  assert.equal(result.commitSha, fixture.commit);
  assert.equal(result.path, fixture.path);
  assert.equal(result.gitBlobSha, fixture.blobSha);
  assert.equal(result.sha256, fixture.sha256);
  assert.equal(result.permalink, fixture.url);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, fixture.apiUrl);
  assert.equal(fetchImpl.calls[0].options.method, 'GET');
  assert.equal(fetchImpl.calls[0].options.credentials, 'omit');
  assert.equal(fetchImpl.calls[0].options.cache, 'no-store');
  assert.equal(fetchImpl.calls[0].options.redirect, 'error');
  assert.equal(fetchImpl.calls[0].options.headers.Authorization, undefined);
  assert.equal(fetchImpl.calls[0].options.headers.Cookie, undefined);
  assert.equal(formatGitHubSourceCitation(result),
    'CLIENT_REPORTED_UNARCHIVED_V1 | ' + fixture.url +
    ' | git-blob-sha1=' + fixture.blobSha + ' | sha256=' + fixture.sha256 +
    ' | bytes=' + fixture.bytes.length);

  const donorFixture = githubSourceFixture(
    Buffer.from('donor source fixture\\n', 'utf8'),
    'd'.repeat(40),
    'docs/source.md',
    'example-org',
    'research-notes'
  );
  const donorFetch = recordFetch({ [donorFixture.apiUrl]: textResponse(donorFixture.payload) });
  const donorResult = await loadGitHubSourceFile(donorFixture.url, { fetchImpl: donorFetch });
  assert.equal(donorResult.repository, 'example-org/research-notes');
  assert.equal(donorResult.path, 'docs/source.md');
  assert.equal(donorFetch.calls[0].url, donorFixture.apiUrl);
});

test('GitHub source retrieval rejects oversized, malformed, hash-mismatched, and binary content', async () => {
  const fixture = githubSourceFixture(Buffer.from('bounded source\n', 'utf8'));
  const oversized = { ...fixture.payload, size: 64 * 1024 + 1 };
  const wrongHash = { ...fixture.payload, sha: '0'.repeat(40) };
  const malformedBase64 = { ...fixture.payload, content: '!!!=' };
  const binary = githubSourceFixture(Buffer.from([0xff, 0xfe, 0x00]));
  const cases = [
    [oversized, /oversized|bounded/i],
    [wrongHash, /Git blob SHA-1/i],
    [malformedBase64, /base64/i],
    [binary.payload, /UTF-8|NUL/i]
  ];
  for (const [payload, message] of cases) {
    const selected = payload === binary.payload ? binary : fixture;
    const fetchImpl = recordFetch({ [selected.apiUrl]: textResponse(payload) });
    await assert.rejects(() => loadGitHubSourceFile(selected.url, { fetchImpl }), message);
  }
  const tooLargeBody = 'x'.repeat(96 * 1024 + 1);
  await assert.rejects(() => loadGitHubSourceFile(fixture.url, {
    fetchImpl: recordFetch({ [fixture.apiUrl]: textResponse(tooLargeBody) })
  }), /response exceeds/i);
  await assert.rejects(() => loadGitHubSourceFile(fixture.url, {
    fetchImpl: async () => new Response(tooLargeBody, { status: 200 })
  }), /response exceeds/i);
});

test('commit-pinned unarchived source citations parse only as exact bounded byte receipts', () => {
  const fixture = githubSourceFixture(Buffer.from('source citation fixture', 'utf8'));
  const citation = formatGitHubSourceCitation({
    repository: 'ngl-damien/No-Gas-Labs-Alpha-1',
    commitSha: fixture.commit,
    path: fixture.path,
    permalink: fixture.url,
    gitBlobSha: fixture.blobSha,
    sha256: fixture.sha256,
    size: fixture.bytes.length
  });
  assert.deepEqual(parseGitHubSourceCitation(citation), {
    repository: 'ngl-damien/No-Gas-Labs-Alpha-1',
    commitSha: fixture.commit,
    path: fixture.path,
    permalink: fixture.url,
    gitBlobSha: fixture.blobSha,
    sha256: fixture.sha256,
    size: fixture.bytes.length
  });
  // Historical notes retain the original marker. Parsing is shape validation
  // only and does not attest that a browser fetch actually occurred.
  const legacyCitation = citation.replace('CLIENT_REPORTED_UNARCHIVED_V1', 'BROWSER_RETRIEVED_UNARCHIVED_V1');
  assert.deepEqual(parseGitHubSourceCitation(legacyCitation), parseGitHubSourceCitation(citation));
  const invalid = [
    citation + ' | extra=1',
    citation.replace('CLIENT_REPORTED_UNARCHIVED_V1', 'MODEL_ASSERTION'),
    citation.replace(fixture.url, 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/blob/main/game/quests.mjs'),
    citation.replace('git-blob-sha1=' + fixture.blobSha, 'git-blob-sha1=short'),
    citation.replace('sha256=' + fixture.sha256, 'sha256=short'),
    citation.replace('bytes=' + fixture.bytes.length, 'bytes=65537'),
    citation.replace(fixture.url, 'javascript:alert(1)')
  ];
  for (const value of invalid) assert.equal(parseGitHubSourceCitation(value), null);
});

test('GitHub source retrieval fails closed before network access for unsafe URLs and on timeout', async () => {
  const commit = 'b'.repeat(40);
  const url = 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/blob/' + commit + '/game/quests.mjs';
  const unused = recordFetch({});
  await assert.rejects(() => loadGitHubSourceFile('https://example.com/file', { fetchImpl: unused }));
  assert.equal(unused.calls.length, 0);
  await assert.rejects(() => loadGitHubSourceFile(url, {
    fetchImpl: () => new Promise(() => {}),
    timeoutMs: 5
  }), /timed out/i);
});

test('Source Observatory GitHub reader waits for explicit citation use and invalidates stale previews', async () => {
  const fixture = githubSourceFixture(Buffer.from('// source reader fixture\nexport const inspected = true;\n', 'utf8'), 'c'.repeat(40));
  const fetchImpl = recordFetch({ [fixture.apiUrl]: textResponse(fixture.payload) });
  const storage = memoryStorage();
  let used = null;
  await withDocument(async () => {
    const root = new FakeElement('div');
    const section = renderGitHubSourceReader(root, {
      fetchImpl,
      storage,
      onUseSource(citation, result) { used = { citation, result }; }
    });
    assert.equal(root.children[0], section);
    const nodes = walk(section);
    const input = nodes.find(node => node.id === 'github-source-url');
    const fetchButton = nodes.find(node => node.id === 'github-source-fetch');
    const saveButton = nodes.find(node => node.id === 'github-source-save');
    const useButton = nodes.find(node => node.id === 'github-source-use');
    const status = nodes.find(node => node.id === 'github-source-status');
    const intro = nodes.find(node => node.className === 'github-source-reader__intro');
    assert.ok(intro, 'the reader must disclose its storage scope');
    assert.match(intro.textContent, /app\/browser origin and profile/i);
    assert.match(intro.textContent, /appassets WebView origin/i);
    assert.doesNotMatch(intro.textContent, /separate Android app|another browser profile/i);
    const preview = nodes.find(node => node.id === 'github-source-preview');
    assert.ok(input && fetchButton && saveButton && useButton && status && preview);
    assert.equal(fetchImpl.calls.length, 0, 'opening the reader must not fetch automatically');
    assert.equal(useButton.disabled, true);
    input.value = fixture.url;
    await fetchButton.listeners.click();
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(useButton.disabled, false);
    assert.match(status.textContent, /Git blob SHA-1 matched/i);
    assert.match(status.textContent, /not yet saved locally/i);
    assert.match(preview.textContent, /source reader fixture/);
    assert.equal(used, null, 'retrieval alone must not populate or submit a note');
    assert.equal(saveButton.disabled, false);
    await saveButton.listeners.click();
    assert.match(status.textContent, /not shared or synced/i);
    assert.match(status.textContent, /app\/browser origin and profile/i);
    assert.doesNotMatch(status.textContent, /separate Android app|another browser profile/i);
    assert.ok(storage.value, 'exact source bytes must be stored in device-local storage');
    const savedState = await readLocalGitHubSourceCaptures(storage);
    assert.equal(savedState.available, true);
    assert.equal(savedState.records.length, 1);
    assert.equal(savedState.records[0].integrityStatus, 'hashes-match');
    assert.equal(savedState.records[0].text, fixture.bytes.toString('utf8'));

    // A fresh reader instance can reopen the same bytes without a network request.
    const offlineRoot = new FakeElement('div');
    let offlineUsed = null;
    const offlineReader = renderGitHubSourceReader(offlineRoot, {
      fetchImpl: async () => { throw new Error('offline saved-capture reuse attempted a network request'); },
      storage,
      onUseSource(citation, result) { offlineUsed = { citation, result }; }
    });
    const savedCaptureList = walk(offlineReader).find(node => node.dataset?.githubSourceCaptures === 'true');
    assert.ok(savedCaptureList, 'the new reader must expose its local capture list');
    for (let attempt = 0; attempt < 200 && savedCaptureList.dataset.githubSourceCapturesReady !== 'true'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(savedCaptureList.dataset.githubSourceCapturesReady, 'true',
      'the new reader must finish rechecking saved bytes before the capture list is inspected');
    const offlinePreview = walk(offlineReader).find(node => node.dataset?.previewSourceCapture) || null;
    assert.ok(offlinePreview, 'a saved capture must be previewable from a new reader instance');
    const offlinePreviewText = walk(offlineReader).find(node => node.id === 'github-source-preview');
    const offlineStatus = walk(offlineReader).find(node => node.id === 'github-source-status');
    offlinePreview.listeners.click();
    assert.equal(offlinePreviewText.textContent, fixture.bytes.toString('utf8'),
      'the offline preview must show the exact rechecked saved text');
    assert.equal(offlinePreviewText.dataset.savedCaptureId, savedState.records[0].captureId);
    assert.match(offlineStatus.textContent, /no network request was made/i);
    assert.equal(offlineUsed, null, 'previewing saved bytes must not populate or submit a note');
    assert.equal(fetchImpl.calls.length, 1, 'previewing saved bytes must not refetch the source');

    const rehydratedUse = walk(offlineReader).find(node => node.dataset?.useSourceCapture) || null;
    assert.ok(rehydratedUse, 'the saved capture must expose a separate explicit citation-use action');
    rehydratedUse.listeners.click();
    assert.equal(offlineUsed.citation, formatGitHubSourceCitation(offlineUsed.result));
    assert.equal(offlineUsed.result.text, savedState.records[0].text);
    assert.equal(fetchImpl.calls.length, 1, 'offline reuse must not refetch the source');
    assert.equal(used, null, 'saving and reopening do not populate the current note automatically');
    const offlineRemove = walk(offlineReader).find(node => node.dataset?.removeSourceCapture) || null;
    assert.ok(offlineRemove, 'a saved capture must expose an explicit local removal action');
    assert.equal(offlineRemove.dataset.removeSourceCapture, offlineUsed.result.captureId);
    await offlineRemove.listeners.click();
    assert.equal(offlinePreviewText.textContent, '', 'removing the currently previewed capture must clear its stale bytes from the UI');
    assert.equal(offlinePreviewText.dataset.savedCaptureId, undefined, 'removal must clear the preview identity marker');
    assert.match(offlineStatus.textContent, /preview was cleared/i);
    assert.equal((await readLocalGitHubSourceCaptures(storage)).records.length, 0);
    useButton.listeners.click();
    assert.equal(used.citation, formatGitHubSourceCitation(used.result));
    assert.equal(used.result.sha256, fixture.sha256);
    assert.equal(used.result.bytesBase64.length > 0, true);
    assert.match(status.textContent, /did not create a world event/i);
    input.value = 'https://example.com/changed';
    input.listeners.input();
    assert.equal(useButton.disabled, true);
    assert.equal(saveButton.disabled, true);
    assert.equal(preview.textContent, '');
  });
});


test('local source captures are bounded, byte-rechecked, removable, and never overwrite a corrupt index', async () => {
  assert.equal((await readLocalGitHubSourceCaptures(null)).available, false);
  const storage = memoryStorage();
  const captures = [];
  for (let index = 0; index < 4; index += 1) {
    const commit = String(index + 1).repeat(40);
    const path = 'game/capture-' + index + '.mjs';
    const fixture = githubSourceFixture(Buffer.from('capture-' + index, 'utf8'), commit, path);
    const fetched = await loadGitHubSourceFile(fixture.url, {
      fetchImpl: recordFetch({ [fixture.apiUrl]: textResponse(fixture.payload) })
    });
    captures.push(fetched);
    const saved = await saveLocalGitHubSourceCapture(fetched, storage);
    assert.equal(saved.status, 'saved');
  }
  const beforeFifth = storage.value;
  const fifth = githubSourceFixture(Buffer.from('capture-4', 'utf8'), '5'.repeat(40), 'game/capture-4.mjs');
  const fifthFetched = await loadGitHubSourceFile(fifth.url, {
    fetchImpl: recordFetch({ [fifth.apiUrl]: textResponse(fifth.payload) })
  });
  await assert.rejects(() => saveLocalGitHubSourceCapture(fifthFetched, storage), /store is full/i);
  assert.equal(storage.value, beforeFifth, 'capacity rejection must not evict or overwrite existing captures');

  const duplicate = await saveLocalGitHubSourceCapture(captures[0], storage);
  assert.equal(duplicate.status, 'already-saved');
  assert.equal(storage.value, beforeFifth, 'duplicate save is idempotent');

  const envelope = JSON.parse(storage.value);
  envelope.records[0].bytesBase64 = 'Y2hhbmdlZA==';
  storage.setItem('ngl.source-observatory.local-captures.v1', JSON.stringify(envelope));
  const corrupted = await readLocalGitHubSourceCaptures(storage);
  assert.equal(corrupted.available, true);
  assert.equal(corrupted.records[0].integrityStatus, 'corrupt');
  assert.match(corrupted.records[0].reason, /byte|SHA-1|SHA-256/i);
  const preservedCorruption = storage.value;
  await assert.rejects(() => saveLocalGitHubSourceCapture(captures[0], storage), /match|inconsistent|malformed/i);
  assert.equal(storage.value, preservedCorruption, 'a corrupt existing capture is not silently replaced');
});
