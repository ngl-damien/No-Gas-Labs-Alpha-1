const REPOSITORY = 'ngl-damien/No-Gas-Labs-Alpha-1';
const API = 'https://api.github.com/repos/' + REPOSITORY;
const API_HEADERS = Object.freeze({
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
});
const LIMIT = 20;
const REQUEST_TIMEOUT_MS = 10000;

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function boundedText(value, limit = 2400) {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}
function safeGitHubUrl(value, fallback) {
  try {
    const url = new URL(value || fallback);
    return url.protocol === 'https:' && url.hostname === 'github.com' ? url.href : fallback;
  } catch {
    return fallback;
  }
}
async function readJson(fetchImpl, url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.max(1, Math.floor(timeoutMs))
    : REQUEST_TIMEOUT_MS;
  const controller = typeof globalThis.AbortController === 'function'
    ? new globalThis.AbortController()
    : null;
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new Error('GitHub request timed out after ' + duration + ' ms.'));
      controller?.abort();
    }, duration);
  });
  const request = Promise.resolve().then(async () => {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: API_HEADERS,
      cache: 'no-store',
      credentials: 'omit',
      ...(controller ? { signal: controller.signal } : {})
    });
    if (!response || response.ok !== true) {
      const status = Number.isInteger(response?.status) ? response.status : 'unknown';
      throw new Error('GitHub returned HTTP ' + status + ' for ' + url.replace(API, 'repository API'));
    }
    return response.json();
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
  }
}
function sourceResult(result, transform) {
  if (result.status !== 'fulfilled') {
    return { available: false, error: boundedText(result.reason?.message || 'Source unavailable.', 240) };
  }
  try {
    return { available: true, items: transform(result.value) };
  } catch {
    return { available: false, error: 'GitHub returned an unexpected response shape.' };
  }
}

export async function loadGitHubGateSnapshot({ fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('This browser does not provide fetch; live GitHub state is unavailable.');
  }
  const urls = [
    API + '/pulls?state=open&per_page=' + LIMIT,
    API + '/issues?state=open&per_page=' + LIMIT,
    API + '/actions/runs?per_page=' + LIMIT
  ];
  const results = await Promise.allSettled(urls.map(url => readJson(fetchImpl, url, timeoutMs)));
  return {
    fetchedAt: new Date().toISOString(),
    sources: {
      pullRequests: sourceResult(results[0], value => {
        if (!Array.isArray(value)) throw new Error('Invalid pull request list.');
        return value;
      }),
      issues: sourceResult(results[1], value => {
        if (!Array.isArray(value)) throw new Error('Invalid issue list.');
        return value;
      }),
      workflows: sourceResult(results[2], value => {
        if (!Array.isArray(value?.workflow_runs)) throw new Error('Invalid workflow list.');
        return value.workflow_runs;
      })
    }
  };
}

export function projectGitHubGate(snapshot) {
  const sources = snapshot?.sources || {};
  const pullSource = sources.pullRequests || { available: false, error: 'Not loaded.' };
  const issueSource = sources.issues || { available: false, error: 'Not loaded.' };
  const workflowSource = sources.workflows || { available: false, error: 'Not loaded.' };
  const pullRequests = pullSource.available === true && Array.isArray(pullSource.items)
    ? pullSource.items.filter(item => Number.isSafeInteger(item?.number) && item.number > 0)
      .slice(0, LIMIT).map(item => ({
        number: item.number,
        title: boundedText(item.title || 'Untitled pull request', 180),
        draft: item.draft === true,
        state: boundedText(item.state || 'unknown', 24),
        head: boundedText(item.head?.ref || 'unknown branch', 100),
        base: boundedText(item.base?.ref || 'unknown base', 100),
        updatedAt: boundedText(item.updated_at || '', 40),
        url: safeGitHubUrl(item.html_url, 'https://github.com/' + REPOSITORY + '/pull/' + item.number)
      })) : [];
  const issues = issueSource.available === true && Array.isArray(issueSource.items)
    ? issueSource.items.filter(item => !item?.pull_request && Number.isSafeInteger(item?.number) && item.number > 0)
      .slice(0, LIMIT).map(item => ({
        number: item.number,
        title: boundedText(item.title || 'Untitled issue', 180),
        state: boundedText(item.state || 'unknown', 24),
        updatedAt: boundedText(item.updated_at || '', 40),
        url: safeGitHubUrl(item.html_url, 'https://github.com/' + REPOSITORY + '/issues/' + item.number)
      })) : [];
  const runs = workflowSource.available === true && Array.isArray(workflowSource.items)
    ? workflowSource.items.filter(item => Number.isSafeInteger(item?.id) && item.id > 0).slice(0, LIMIT)
      .map(item => ({
        id: item.id,
        name: boundedText(item.name || 'Workflow run', 120),
        status: boundedText(item.status || 'unknown', 24),
        conclusion: boundedText(item.conclusion || '', 24),
        branch: boundedText(item.head_branch || 'unknown branch', 100),
        sha: boundedText(item.head_sha || '', 40),
        runNumber: Number.isSafeInteger(item.run_number) ? item.run_number : null,
        updatedAt: boundedText(item.updated_at || '', 40),
        url: safeGitHubUrl(item.html_url, 'https://github.com/' + REPOSITORY + '/actions/runs/' + item.id)
      })) : [];
  return {
    fetchedAt: boundedText(snapshot?.fetchedAt || '', 40),
    sources: {
      pullRequests: { available: pullSource.available === true, error: boundedText(pullSource.error || '', 240) },
      issues: { available: issueSource.available === true, error: boundedText(issueSource.error || '', 240) },
      workflows: { available: workflowSource.available === true, error: boundedText(workflowSource.error || '', 240) }
    },
    pullRequests,
    issues,
    failedRuns: runs.filter(run => run.status === 'completed' && run.conclusion === 'failure'),
    runningRuns: runs.filter(run => run.status !== 'completed')
  };
}

async function loadInvestigation(fetchImpl, kind, id, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (kind === 'pull') {
    const [record, files] = await Promise.all([
      readJson(fetchImpl, API + '/pulls/' + id, timeoutMs),
      readJson(fetchImpl, API + '/pulls/' + id + '/files?per_page=30', timeoutMs)
    ]);
    if (!Array.isArray(files)) throw new Error('Changed-file response was not a list.');
    return { kind, record, files: files.slice(0, 30) };
  }
  if (kind === 'issue') {
    return { kind, record: await readJson(fetchImpl, API + '/issues/' + id, timeoutMs), files: [] };
  }
  if (kind === 'workflow') {
    const [record, jobs] = await Promise.all([
      readJson(fetchImpl, API + '/actions/runs/' + id, timeoutMs),
      readJson(fetchImpl, API + '/actions/runs/' + id + '/jobs?per_page=50', timeoutMs)
    ]);
    if (!Array.isArray(jobs?.jobs)) throw new Error('Workflow job response was not a list.');
    return { kind, record, jobs: jobs.jobs.slice(0, 50) };
  }
  throw new Error('Unknown investigation type.');
}

function appendExternalLink(parent, url, label) {
  const link = element('a', label);
  link.href = safeGitHubUrl(url, 'https://github.com/' + REPOSITORY);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  parent.append(link);
}
function renderInvestigation(container, result) {
  container.replaceChildren();
  const record = result.record || {};
  const heading = element('h4', result.kind === 'pull' ? 'PULL REQUEST #' + record.number
    : result.kind === 'issue' ? 'ISSUE #' + record.number : 'WORKFLOW RUN #' + record.id);
  container.append(heading);
  container.append(element('p', boundedText(record.title || record.name || 'Untitled record', 180)));
  const metadata = result.kind === 'workflow'
    ? [record.status, record.conclusion || 'not concluded', record.head_branch, record.head_sha].filter(Boolean).join(' · ')
    : [record.state, record.draft === true ? 'DRAFT' : '', record.base?.ref ? 'base ' + record.base.ref : '', record.head?.ref ? 'head ' + record.head.ref : ''].filter(Boolean).join(' · ');
  if (metadata) container.append(element('p', boundedText(metadata, 240)));
  if (result.kind === 'pull') {
    const body = boundedText(record.body || 'No pull-request description was supplied.', 2400);
    container.append(element('p', body));
    container.append(element('h5', 'CHANGED PATHS'));
    if (!result.files.length) container.append(element('p', 'No changed paths were returned.'));
    for (const file of result.files) container.append(element('code', boundedText(file.filename || 'unknown path', 180)));
  } else if (result.kind === 'issue') {
    container.append(element('p', boundedText(record.body || 'No issue description was supplied.', 2400)));
    if (Array.isArray(record.labels) && record.labels.length) {
      container.append(element('p', 'Labels: ' + record.labels.map(label => boundedText(label?.name || '', 60)).filter(Boolean).join(' · ')));
    }
  } else {
    container.append(element('p', boundedText(record.display_title || record.name || '', 180)));
    container.append(element('h5', 'JOBS'));
    for (const job of result.jobs) {
      const state = [job.name, job.status, job.conclusion].filter(Boolean).join(' · ');
      container.append(element('p', boundedText(state, 220)));
    }
    if (!result.jobs.length) container.append(element('p', 'No workflow jobs were returned.'));
  }
  appendExternalLink(container, record.html_url, 'Open exact record on GitHub');
  container.dataset.investigationComplete = 'true';
}

export async function renderGitHubDecisionGate(container, { fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const section = element('section');
  section.className = 'github-gate';
  section.dataset.githubDecisionGate = 'true';
  const header = element('div');
  header.className = 'github-gate__header';
  const eyebrow = element('p', 'LIVE REPOSITORY · PUBLIC GITHUB DATA');
  eyebrow.className = 'eyebrow';
  header.append(eyebrow, element('h3', 'The Neo Fight Gate'));
  const intro = element('p', 'Three doors. Current pull requests, open issues, and workflow failures. Choose a door to fetch the exact record and inspect its evidence trail.');
  intro.className = 'github-gate__intro';
  const scene = element('div');
  scene.className = 'github-gate__scene';
  scene.setAttribute('role', 'img');
  scene.setAttribute('aria-label', 'An animated institutional gate opening onto live GitHub repository records');
  const arch = element('div');
  arch.className = 'github-gate__arch';
  arch.append(element('span', 'NO_GAS_LABS'), element('strong', 'FOUNDER GATE'), element('small', 'EVIDENCE BEFORE DISPOSITION'));
  const doors = element('div');
  doors.className = 'github-gate__doors';
  doors.append(element('span'), element('span'));
  arch.append(doors);
  scene.append(arch);
  const toolbar = element('div');
  toolbar.className = 'github-gate__toolbar';
  const status = element('p', 'Connecting to the public GitHub API…');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const refresh = element('button', 'Refresh live state');
  refresh.type = 'button';
  refresh.className = 'secondary-button';
  toolbar.append(status, refresh);
  const doorsList = element('div');
  doorsList.className = 'github-gate__records';
  const detail = element('section');
  detail.className = 'github-gate__detail';
  detail.setAttribute('aria-live', 'polite');
  section.append(header, intro, scene, toolbar, doorsList, detail);
  container.append(section);
  let generation = 0;
  let detailGeneration = 0;

  async function inspect(kind, id) {
    const current = ++detailGeneration;
    detail.replaceChildren(element('p', 'Fetching the exact GitHub record and its related evidence…'));
    try {
      const result = await loadInvestigation(fetchImpl, kind, id, timeoutMs);
      if (current !== detailGeneration) return;
      renderInvestigation(detail, result);
    } catch (error) {
      if (current !== detailGeneration) return;
      detail.replaceChildren(element('p', 'Investigation unavailable: ' + boundedText(error?.message || 'GitHub request failed.', 240)));
    }
  }

  async function refreshState() {
    const current = ++generation;
    detailGeneration += 1;
    detail.replaceChildren();
    doorsList.replaceChildren();
    status.textContent = 'Fetching current public repository state…';
    refresh.disabled = true;
    try {
      const snapshot = await loadGitHubGateSnapshot({ fetchImpl, timeoutMs });
      if (current !== generation) return;
      const projection = projectGitHubGate(snapshot);
      const available = Object.values(projection.sources).filter(source => source.available).length;
      status.textContent = available + '/3 GitHub sources available · fetched ' + projection.fetchedAt;
      renderCollection(doorsList, 'OPEN PULL REQUESTS', 'pull', projection.pullRequests, projection.sources.pullRequests);
      renderCollection(doorsList, 'OPEN ISSUES', 'issue', projection.issues, projection.sources.issues);
      renderCollection(doorsList, 'FAILED WORKFLOWS', 'workflow', projection.failedRuns, projection.sources.workflows);
      renderCollection(doorsList, 'RUNNING WORKFLOWS', 'workflow', projection.runningRuns, projection.sources.workflows);
      const note = element('p', 'Read-only connection. This gate fetches public GitHub records; it does not merge, write, approve, deploy, or change repository state. A missing source is shown as unavailable, never as an empty queue.');
      note.className = 'github-gate__boundary';
      doorsList.append(note);
    } catch (error) {
      status.textContent = 'GitHub connection failed: ' + boundedText(error?.message || 'unknown error', 240);
    } finally {
      if (current === generation) refresh.disabled = false;
    }
  }

  function renderCollection(parent, heading, kind, records, source) {
    const group = element('section');
    group.className = 'github-gate__group';
    group.append(element('h4', heading));
    if (!source.available) {
      const unavailable = element('p', 'UNAVAILABLE · ' + (source.error || 'No source response.'));
      unavailable.className = 'github-gate__unavailable';
      group.append(unavailable);
    } else if (!records.length) {
      group.append(element('p', 'No records returned by this successful source response.'));
    } else {
      for (const record of records) {
        const card = element('article');
        card.className = 'github-gate__record';
        card.dataset.recordNumber = String(record.number ?? record.id);
        card.append(element('strong', record.title || record.name));
        let meta = '';
        if (kind === 'pull') meta = (record.draft ? 'DRAFT' : 'OPEN') + ' · ' + record.head + ' → ' + record.base;
        else if (kind === 'issue') meta = 'ISSUE #' + record.number + ' · ' + record.state;
        else meta = 'RUN #' + (record.runNumber ?? record.id) + ' · ' + record.status + (record.conclusion ? ' · ' + record.conclusion : '');
        card.append(element('small', boundedText(meta, 220)));
        const action = element('button', 'Investigate');
        action.type = 'button';
        action.className = 'github-gate__investigate';
        action.dataset.investigateKind = kind;
        action.dataset.investigateId = String(kind === 'workflow' ? record.id : record.number);
        action.addEventListener('click', () => inspect(kind, kind === 'workflow' ? record.id : record.number));
        card.append(action);
        group.append(card);
      }
    }
    parent.append(group);
  }

  refresh.addEventListener('click', () => { void refreshState(); });
  await refreshState();
  return section;
}
