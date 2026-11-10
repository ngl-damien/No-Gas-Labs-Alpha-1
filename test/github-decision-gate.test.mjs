import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadGitHubGateSnapshot,
  projectGitHubGate,
  renderGitHubDecisionGate,
  shouldRenderGitHubDecisionGate
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
