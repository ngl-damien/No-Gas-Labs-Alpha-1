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
        headSha: isCommitSha(item.head?.sha) ? item.head.sha.toLowerCase() : null,
        baseSha: isCommitSha(item.base?.sha) ? item.base.sha.toLowerCase() : null,
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
    recentRuns: runs,
    failedRuns: runs.filter(run => run.status === 'completed' && run.conclusion === 'failure'),
    runningRuns: runs.filter(run => run.status !== 'completed')
  };
}

function isCommitSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
}

export async function loadExactHeadChecks(fetchImpl, sha, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (!isCommitSha(sha)) {
    const unavailable = { available: false, error: 'The pull request did not return a valid head commit SHA.' };
    return { sha: '', checkRuns: unavailable, commitStatus: unavailable };
  }
  const urls = [
    API + '/commits/' + sha + '/check-runs?per_page=100',
    API + '/commits/' + sha + '/status?per_page=100'
  ];
  const results = await Promise.allSettled(urls.map(url => readJson(fetchImpl, url, timeoutMs)));
  return {
    sha,
    checkRuns: sourceResult(results[0], value => {
      if (!Array.isArray(value?.check_runs) ||
          !Number.isSafeInteger(value?.total_count) ||
          value.total_count < 0 ||
          value.total_count < value.check_runs.length) {
        throw new Error('Invalid exact-head check-run inventory.');
      }
      return {
        items: value.check_runs.slice(0, 100),
        totalCount: value.total_count
      };
    }),
    commitStatus: sourceResult(results[1], value => {
      if (!Array.isArray(value?.statuses) ||
          !['success', 'failure', 'pending', 'error'].includes(value?.state) ||
          !Number.isSafeInteger(value?.total_count) ||
          value.total_count < 0 ||
          value.total_count < value.statuses.length) {
        throw new Error('Invalid exact-head combined commit-status inventory.');
      }
      return {
        state: value.state,
        statuses: value.statuses.slice(0, 100),
        totalCount: value.total_count
      };
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
function appendGateChoice(parent, label, choice, onClick) {
  const button = element('button', label);
  button.type = 'button';
  button.className = 'github-gate__choice github-gate__choice--action';
  button.dataset.gateChoice = choice;
  button.addEventListener('click', onClick);
  parent.append(button);
  return button;
}

function renderExactHeadDecisionPath(container, checks, actions = {}) {
  const section = element('section');
  section.className = 'github-gate__decision-path';
  section.dataset.exactHeadChecks = 'true';
  section.append(element('h5', 'CHOOSE YOUR PATH · EXACT HEAD CHECKS'));
  if (actions.headChanged === true) {
    const changed = element('p', 'HEAD CHANGED — the refreshed pull request points to a different commit. Earlier check results are discarded; only this new head is shown below.');
    changed.className = 'github-gate__head-changed';
    section.append(changed);
  }
  const sha = isCommitSha(checks?.sha) ? checks.sha : '';
  if (sha) appendExternalLink(section, 'https://github.com/' + REPOSITORY + '/commit/' + sha, 'Open exact head commit');
  if (sha) section.append(element('p', 'HEAD SHA · ' + sha));
  const checkSource = checks?.checkRuns || { available: false, error: 'Not loaded.' };
  const statusSource = checks?.commitStatus || { available: false, error: 'Not loaded.' };
  const runPayload = checkSource.available === true ? checkSource.items : null;
  const runs = Array.isArray(runPayload?.items) ? runPayload.items : [];
  const runTotal = Number.isSafeInteger(runPayload?.totalCount) ? runPayload.totalCount : runs.length;
  const runInventoryComplete = runTotal === runs.length;
  const commit = statusSource.available === true ? statusSource.items : null;
  const statuses = Array.isArray(commit?.statuses) ? commit.statuses : [];
  const statusTotal = Number.isSafeInteger(commit?.totalCount) ? commit.totalCount : statuses.length;
  const statusInventoryComplete = statusTotal === statuses.length;
  section.append(element('p', checkSource.available
    ? 'Check runs: ' + runs.length + '/' + runTotal + ' returned for this exact commit.'
    : 'CHECK RUNS UNAVAILABLE · ' + boundedText(checkSource.error || 'No check-run response.', 240)));
  section.append(element('p', statusSource.available
    ? 'Combined commit status: ' + boundedText(commit.state, 24) + ' · ' + statuses.length + '/' + statusTotal + ' contexts.'
    : 'COMMIT STATUS UNAVAILABLE · ' + boundedText(statusSource.error || 'No commit-status response.', 240)));
  const failureConclusions = new Set(['failure', 'timed_out', 'action_required', 'startup_failure']);
  const failedRuns = runs.filter(run => run?.status === 'completed' && failureConclusions.has(run?.conclusion));
  const pendingRuns = runs.filter(run => run && run.status !== 'completed');
  const failedStatuses = statuses.filter(item => ['failure', 'error'].includes(item?.state));
  const pendingStatuses = statuses.filter(item => item?.state === 'pending');
  const failedCommit = ['failure', 'error'].includes(commit?.state);
  const pendingCommit = commit?.state === 'pending';
  const allRunsGreen = checkSource.available && runs.length > 0 && runInventoryComplete &&
    runs.every(run => run?.status === 'completed' && run?.conclusion === 'success');
  const commitGreen = statusSource.available && commit?.state === 'success' && statusInventoryComplete &&
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
  const nextStep = blocked
    ? 'NEXT: inspect the failing check, repair the branch, then recheck the pull request’s current head. A later green result on another commit cannot clear this failure.'
    : waiting
      ? 'NEXT: let the running checks finish, then recheck the pull request’s current head.'
      : green
        ? 'NEXT: inspect the changed paths and obtain independent review. CI success is not approval, integration, or Founder authority.'
        : 'NEXT: restore the missing source or complete the check inventory, then retry. Missing evidence is not a pass.';
  const guidance = element('p', nextStep);
  guidance.className = 'github-gate__next-step';
  section.append(guidance);
  if (typeof actions.onRecheck === 'function') {
    const label = blocked ? 'Recheck after repair' : waiting ? 'Recheck running checks' : green ? 'Recheck before review' : 'Retry missing evidence';
    appendGateChoice(section, label, 'recheck-current-head', () => actions.onRecheck());
  }
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

function renderInvestigation(container, result, actions = {}) {
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
    renderExactHeadDecisionPath(container, result.checks, {
      headChanged: result.headChanged === true,
      onRecheck: actions.onRecheck
    });
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
  if (typeof actions.onBack === 'function') {
    appendGateChoice(container, 'Back to the three doors', 'back-to-doors', () => actions.onBack());
  }
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

  async function inspect(kind, id, previousHeadSha = '') {
    const current = ++detailGeneration;
    const previousSha = isCommitSha(previousHeadSha) ? previousHeadSha : '';
    detail.replaceChildren(element('p', previousSha
      ? 'Rechecking the pull request record and its current exact head…'
      : 'Fetching the exact GitHub record and its related evidence…'));
    detail.dataset.investigationComplete = 'false';
    try {
      const result = await loadInvestigation(fetchImpl, kind, id, timeoutMs);
      if (current !== detailGeneration) return;
      result.headChanged = kind === 'pull' && previousSha !== '' && result.checks?.sha !== previousSha;
      renderInvestigation(detail, result, {
        onRecheck: kind === 'pull'
          ? () => inspect(kind, id, result.checks?.sha || previousSha)
          : null,
        onBack: () => {
          detail.replaceChildren(element('p', 'Choose another record from the three doors above.'));
          detail.dataset.investigationComplete = 'false';
          doorsList.scrollIntoView?.({ block: 'start' });
        }
      });
    } catch (error) {
      if (current !== detailGeneration) return;
      detail.replaceChildren(element('p', 'Investigation unavailable: ' + boundedText(error?.message || 'GitHub request failed.', 240)));
      detail.dataset.investigationComplete = 'false';
      appendGateChoice(detail, 'Back to the three doors', 'back-to-doors', () => {
        detail.replaceChildren(element('p', 'Choose another record from the three doors above.'));
        doorsList.scrollIntoView?.({ block: 'start' });
      });
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
