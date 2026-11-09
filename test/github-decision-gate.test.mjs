import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadGitHubGateSnapshot,
  projectGitHubGate,
  renderGitHubDecisionGate
} from '../game/github-decision-gate.mjs';

const api = 'https://api.github.com/repos/ngl-damien/No-Gas-Labs-Alpha-1';
function response(value, ok = true, status = 200) {
  return { ok, status, async json() { return value; } };
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
    [api + '/pulls?state=open&per_page=20']: response([
      { number: 417, title: 'Clerk', draft: true, state: 'open', head: { ref: 'npc' }, base: { ref: 'main' }, html_url: 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/417' }
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
  assert.equal(projection.issues.length, 1);
  assert.equal(projection.issues[0].number, 310);
  assert.deepEqual(projection.failedRuns.map(run => run.id), [900]);
  assert.deepEqual(projection.runningRuns.map(run => run.id), [901]);
  assert.equal(fetchImpl.calls.length, 3);
  assert.ok(fetchImpl.calls.every(call => call.options.cache === 'no-store'));
});

test('failed or malformed source remains unavailable instead of becoming an empty queue', async () => {
  const fetchImpl = recordFetch({
    [api + '/pulls?state=open&per_page=20']: response({ unexpected: true }),
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
    [api + '/pulls?state=open&per_page=20']: response([
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
  assert.equal(walk(root).some(node => node.tagName === 'script'), false);
  assert.equal(fetchImpl.calls.length, 5);
}));

test('workflow investigation fetches run jobs and preserves each job conclusion', async () => withDocument(async () => {
  const fetchImpl = recordFetch({
    [api + '/pulls?state=open&per_page=20']: response([]),
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
  const pullsUrl = api + '/pulls?state=open&per_page=20';
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
  assert.match(textOf(root), /2\\/3 GitHub sources available/);

  refresh.listeners.click();
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(pullAttempts, 2);
  assert.equal(refresh.disabled, false);
  assert.match(textOf(root), /3\\/3 GitHub sources available/);
}));
