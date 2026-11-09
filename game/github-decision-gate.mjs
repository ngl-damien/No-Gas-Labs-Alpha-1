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

function isCommitSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
}

async function loadExactHeadChecks(fetchImpl, sha, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (!isCommitSha(sha)) {
    const unavailable = { available: false, error: 'The pull request did not return a valid head commit SHA.' };
    return { sha: '', checkRuns: unavailable, commitStatus: unavailable };
  }
  const urls = [
    API + '/commits/' + sha + '/check-runs?per_page=100',
    API + '/commits/' + sha + '/status'
  ];
  const results = await Promise.allSettled(urls.map(url => readJson(fetchImpl, url, timeoutMs)));
  return {
    sha,
    checkRuns: sourceResult(results[0], value => {
      if (!Array.isArray(value?.check_runs)) throw new Error('Invalid exact-head check-run response.');
      return value.check_runs.slice(0, 100);
    }),
    commitStatus: sourceResult(results[1], value => {
      if (!Array.isArray(value?.statuses) ||
          !['success', 'failure', 'pending', 'error'].includes(value?.state)) {
        throw new Error('Invalid exact-head combined commit-status response.');
      }
      return { state: value.state, statuses: value.statuses.slice(0, 100) };
    })
  };
}

async function loadInvestigation(fetchImpl, kind, id, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (kind === 'pull') {
    const [record, files] = await Promise.all([
      readJson(fetchImpl, API + '/pulls/' + id, timeoutMs),
      readJson(fetchImpl, API + '/pulls/' + id + '/files?per_page=30', timeoutMs)
    ]);
    if (!Array.isArray(files)) throw new Error('Changed-file response was not a list.');
    const checks = await loadExactHeadChecks(fetchImpl, record?.head?.sha, timeoutMs);
    return { kind, record, files: files.slice(0, 30), checks };
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
function appendOptionalExternalLink(parent, url, label) {
  const safe = safeGitHubUrl(url, '');
  if (!safe) return false;
  const link = element('a', label);
  link.className = 'github-gate__choice';
  link.href = safe;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  parent.append(link);
  return true;
}

function renderExactHeadDecisionPath(container, checks) {
  const section = element('section');
  section.className = 'github-gate__decision-path';
  section.dataset.exactHeadChecks = 'true';
  section.append(element('h5', 'CHOOSE YOUR PATH · EXACT HEAD CHECKS'));

  const sha = isCommitSha(checks?.sha) ? checks.sha : '';
  if (sha) {
    appendExternalLink(section, 'https://github.com/' + REPOSITORY + '/commit/' + sha, 'Open exact head commit');
  }

  const checkSource = checks?.checkRuns || { available: false, error: 'Not loaded.' };
  const statusSource = checks?.commitStatus || { available: false, error: 'Not loaded.' };
  const runs = checkSource.available === true && Array.isArray(checkSource.items) ? checkSource.items : [];
  const commit = statusSource.available === true ? statusSource.items : null;
  const statuses = Array.isArray(commit?.statuses) ? commit.statuses : [];

  section.append(element('p', checkSource.available
    ? 'Check runs: ' + runs.length + ' returned for this exact commit.'
    : 'CHECK RUNS UNAVAILABLE · ' + boundedText(checkSource.error || 'No check-run response.', 240)));
  section.append(element('p', statusSource.available
    ? 'Combined commit status: ' + boundedText(commit.state, 24) + ' · ' + statuses.length + ' contexts.'
    : 'COMMIT STATUS UNAVAILABLE · ' + boundedText(statusSource.error || 'No commit-status response.', 240)));

  const failureConclusions = new Set(['failure', 'timed_out', 'action_required', 'startup_failure']);
  const failedRuns = runs.filter(run => run?.status === 'completed' && failureConclusions.has(run?.conclusion));
  const pendingRuns = runs.filter(run => run && run.status !== 'completed');
  const failedStatuses = statuses.filter(item => ['failure', 'error'].includes(item?.state));
  const pendingStatuses = statuses.filter(item => item?.state === 'pending');
  const failedCommit = ['failure', 'error'].includes(commit?.state);
  const pendingCommit = commit?.state === 'pending';
  const allRunsGreen = checkSource.available && runs.length > 0 &&
    runs.every(run => run?.status === 'completed' && run?.conclusion === 'success');
  const commitGreen = statusSource.available && commit?.state === 'success' &&
    statuses.every(item => item?.state === 'success');
  const blocked = failedRuns.length > 0 || failedStatuses.length > 0 || failedCommit;
  const waiting = pendingRuns.length > 0 || pendingStatuses.length > 0 || pendingCommit;
  const green = allRunsGreen && commitGreen;

  let decision;
  if (blocked) {
    section.dataset.decisionState = 'blocked';
    decision = 'BLOCKED — an exact-head failure is reported. Follow the failing check; an older green head cannot clear this one.';
  } else if (waiting) {
    section.dataset.decisionState = 'waiting';
    decision = 'WAIT — exact-head checks are still running. Do not transfer results from an earlier commit.';
  } else if (green) {
    section.dataset.decisionState = 'checks-success';
    decision = 'CHECKS REPORTED SUCCESS — this is CI evidence only. Independent review, integration, and Founder authority remain separate.';
  } else {
    section.dataset.decisionState = 'incomplete';
    decision = 'EVIDENCE INCOMPLETE — missing, unavailable, empty, or non-success check evidence is not a pass.';
  }
  const disposition = element('p', decision);
  disposition.className = 'github-gate__decision';
  section.append(disposition);

  for (const run of runs.slice(0, 20)) {
    const name = boundedText(run?.name || 'Unnamed check run', 120);
    const state = [boundedText(run?.status || 'unknown', 24), boundedText(run?.conclusion || '', 24)].filter(Boolean).join(' · ');
    const row = element('div');
    row.className = 'github-gate__check';
    row.append(element('p', name + ' · ' + state));
    appendOptionalExternalLink(row, run?.html_url, 'Follow check: ' + name);
    section.append(row);
  }
  for (const item of statuses.slice(0, 20)) {
    const name = boundedText(item?.context || 'Unnamed status context', 120);
    const row = element('div');
    row.className = 'github-gate__check';
    row.append(element('p', name + ' · ' + boundedText(item?.state || 'unknown', 24) +
      (item?.description ? ' · ' + boundedText(item.description, 180) : '')));
    appendOptionalExternalLink(row, item?.target_url, 'Follow status: ' + name);
    section.append(row);
  }
  container.append(section);
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
    renderExactHeadDecisionPath(container, result.checks);
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

export function shouldRenderGitHubDecisionGate(locationId) {
  return locationId === 'decision_chamber';
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
