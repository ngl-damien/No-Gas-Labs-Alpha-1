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
    API + '/pulls?state=open&per_page=' + LIMIT + '&sort=updated&direction=desc',
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

export const MAX_GITHUB_SOURCE_BYTES = 64 * 1024;
const MAX_GITHUB_SOURCE_RESPONSE_BYTES = 96 * 1024;
const GITHUB_SOURCE_PREVIEW_CHARACTERS = 12000;
const GITHUB_SOURCE_CITATION_MARKER = 'CLIENT_REPORTED_UNARCHIVED_V1';
const LEGACY_GITHUB_SOURCE_CITATION_MARKER = 'BROWSER_RETRIEVED_UNARCHIVED_V1';
const GITHUB_SOURCE_CITATION_MARKERS = new Set([
  GITHUB_SOURCE_CITATION_MARKER,
  LEGACY_GITHUB_SOURCE_CITATION_MARKER
]);
const GITHUB_SOURCE_CAPTURE_STORAGE_KEY = 'ngl.source-observatory.local-captures.v1';
const GITHUB_SOURCE_CAPTURE_ENVELOPE_SCHEMA = 'ngl.source-observatory.local-captures.v1';
const GITHUB_SOURCE_CAPTURE_RECORD_SCHEMA = 'ngl.github-source-capture.v1';
const MAX_GITHUB_SOURCE_CAPTURE_RECORDS = 4;
const MAX_GITHUB_SOURCE_CAPTURE_BYTES = 256 * 1024;
const GITHUB_SOURCE_HEADERS = Object.freeze({ Accept: 'application/json' });

export function parseGitHubBlobUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Paste a public GitHub file URL pinned to a 40-character commit SHA.');
  }
  const rawValue = value.trim();
  if (rawValue.split('/').some(segment => segment === '.' || segment === '..' || /%2e/i.test(segment))) {
    throw new Error('Literal or percent-encoded dot path segments are not accepted.');
  }
  let url;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error('The GitHub source URL is not a valid URL.');
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' ||
      url.port || url.username || url.password || url.search || url.hash) {
    throw new Error('Use a canonical HTTPS GitHub file URL without credentials, query, or line fragments.');
  }
  let segments;
  try {
    segments = url.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment));
  } catch {
    throw new Error('The GitHub source path contains invalid URL encoding.');
  }
  const owner = segments[0] || '';
  const repoName = segments[1] || '';
  const validOwner = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
  const validRepo = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
  if (segments.length < 5 || !validOwner.test(owner) || !validRepo.test(repoName) ||
      segments[2] !== 'blob' || !/^[a-f0-9]{40}$/i.test(segments[3])) {
    throw new Error('Use https://github.com/<owner>/<repo>/blob/<40-character-commit-sha>/<file-path>.');
  }
  const pathSegments = segments.slice(4);
  if (pathSegments.some(segment => !segment || segment === '.' || segment === '..' ||
      segment.includes('/') || Array.from(segment).some(character => {
        const code = character.charCodeAt(0);
        return code === 92 || code === 0 || code < 32 || code === 127;
      }))) {
    throw new Error('The GitHub source path contains an unsafe segment.');
  }
  const path = pathSegments.join('/');
  if (path.length > 240) {
    throw new Error('The GitHub source path is too long for a retained citation.');
  }
  const commitSha = segments[3].toLowerCase();
  const permalink = 'https://github.com/' + owner + '/' + repoName + '/blob/' + commitSha + '/' +
    pathSegments.map(segment => encodeURIComponent(segment)).join('/');
  return Object.freeze({
    owner,
    repo: repoName,
    commitSha,
    path,
    pathSegments: Object.freeze(pathSegments),
    permalink
  });
}


async function readBoundedGitHubResponseText(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error('A streaming response body is required to enforce the GitHub source size ceiling.');
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      const chunk = part.value instanceof Uint8Array ? part.value : new Uint8Array(part.value);
      total += chunk.byteLength;
      if (total > MAX_GITHUB_SOURCE_RESPONSE_BYTES) {
        try {
          const cancellation = reader.cancel();
          cancellation?.catch?.(() => {});
        } catch {}
        throw new Error('The GitHub source response exceeds the bounded response size.');
      }
      chunks.push(chunk);
    }
  } catch (error) {
    try {
      const cancellation = reader.cancel();
      cancellation?.catch?.(() => {});
    } catch {}
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('The GitHub source response was not valid UTF-8 JSON.');
  }
}

async function readBoundedGitHubJson(fetchImpl, url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.max(1, Math.floor(timeoutMs))
    : REQUEST_TIMEOUT_MS;
  const controller = typeof globalThis.AbortController === 'function'
    ? new globalThis.AbortController()
    : null;
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      controller?.abort();
      reject(new Error('GitHub source retrieval timed out after ' + duration + ' ms.'));
    }, duration);
  });
  const request = Promise.resolve().then(async () => {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: GITHUB_SOURCE_HEADERS,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      ...(controller ? { signal: controller.signal } : {})
    });
    if (!response || response.ok !== true) {
      const status = Number.isInteger(response?.status) ? response.status : 'unknown';
      throw new Error('GitHub returned HTTP ' + status + ' for the public source file.');
    }
    const declaredLength = response.headers?.get?.('content-length');
    if (declaredLength !== null && declaredLength !== undefined) {
      const length = Number(declaredLength);
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_GITHUB_SOURCE_RESPONSE_BYTES) {
        throw new Error('The GitHub source response exceeds the bounded response size.');
      }
    }
    if (typeof response.text !== 'function') {
      throw new Error('GitHub did not return a readable text response.');
    }
    const body = await readBoundedGitHubResponseText(response);
    try {
      return JSON.parse(body);
    } catch {
      throw new Error('GitHub returned invalid JSON for the source file.');
    }
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
  }
}

function decodeGitHubBase64(value) {
  if (typeof value !== 'string') {
    throw new Error('GitHub did not return base64 file content.');
  }
  const compact = value.replaceAll('\n', '').replaceAll('\r', '').replaceAll(' ', '').replaceAll('\t', '');
  if (compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new Error('GitHub returned malformed base64 file content.');
  }
  if (typeof globalThis.atob !== 'function') {
    throw new Error('This browser cannot decode the bounded GitHub source response.');
  }
  let binary;
  try {
    binary = globalThis.atob(compact);
  } catch {
    throw new Error('GitHub returned malformed base64 file content.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeGitHubBase64(bytes) {
  if (!(bytes instanceof Uint8Array) || typeof globalThis.btoa !== 'function') {
    throw new Error('This browser cannot encode a bounded local source capture.');
  }
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary);
}

function defaultGitHubSourceCaptureStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function readGitHubSourceCaptureEnvelope(storage) {
  if (!storage || typeof storage.getItem !== 'function') {
    throw new Error('Device-local browser storage is unavailable.');
  }
  let raw;
  try { raw = storage.getItem(GITHUB_SOURCE_CAPTURE_STORAGE_KEY); } catch {
    throw new Error('Device-local browser storage could not be read.');
  }
  if (raw === null || raw === undefined) {
    return { schema: GITHUB_SOURCE_CAPTURE_ENVELOPE_SCHEMA, records: [] };
  }
  if (typeof raw !== 'string' || raw.length > MAX_GITHUB_SOURCE_CAPTURE_BYTES * 2) {
    throw new Error('The local capture index exceeds its bounded storage size; existing bytes were not overwritten.');
  }
  let envelope;
  try { envelope = JSON.parse(raw); } catch {
    throw new Error('The local capture index is malformed; existing bytes were not overwritten.');
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      Object.keys(envelope).sort().join(',') !== 'records,schema' ||
      envelope.schema !== GITHUB_SOURCE_CAPTURE_ENVELOPE_SCHEMA ||
      !Array.isArray(envelope.records) ||
      envelope.records.length > MAX_GITHUB_SOURCE_CAPTURE_RECORDS) {
    throw new Error('The local capture index has an unsupported shape; existing bytes were not overwritten.');
  }
  return envelope;
}

function canonicalCaptureTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

async function verifyLocalGitHubSourceCapture(record) {
  const expectedKeys = 'bytesBase64,captureId,capturedAt,commitSha,fetchedAt,gitBlobSha,path,permalink,repository,schema,sha256,size';
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      Object.keys(record).sort().join(',') !== expectedKeys ||
      record.schema !== GITHUB_SOURCE_CAPTURE_RECORD_SCHEMA ||
      typeof record.repository !== 'string' || record.repository.length > 240 ||
      typeof record.commitSha !== 'string' || !/^[a-f0-9]{40}$/.test(record.commitSha) ||
      typeof record.path !== 'string' || !record.path || record.path.length > 1024 ||
      typeof record.permalink !== 'string' || record.permalink.length > 2000 ||
      typeof record.gitBlobSha !== 'string' || !/^[a-f0-9]{40}$/.test(record.gitBlobSha) ||
      typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256) ||
      !Number.isSafeInteger(record.size) || record.size < 0 || record.size > MAX_GITHUB_SOURCE_BYTES ||
      typeof record.bytesBase64 !== 'string' || record.bytesBase64.length > 90000 ||
      !canonicalCaptureTimestamp(record.fetchedAt) ||
      !canonicalCaptureTimestamp(record.capturedAt)) {
    throw new Error('The saved local capture has malformed metadata.');
  }
  const parsed = parseGitHubBlobUrl(record.permalink);
  if (parsed.permalink !== record.permalink ||
      parsed.owner + '/' + parsed.repo !== record.repository ||
      parsed.commitSha.toLowerCase() !== record.commitSha ||
      parsed.path !== record.path) {
    throw new Error('The saved local capture does not match its commit-pinned permalink.');
  }
  const expectedCaptureId = JSON.stringify([record.repository, record.commitSha, record.path, record.sha256]);
  if (record.captureId !== expectedCaptureId) {
    throw new Error('The saved local capture identity does not match its metadata.');
  }
  const bytes = decodeGitHubBase64(record.bytesBase64);
  if (bytes.byteLength !== record.size || encodeGitHubBase64(bytes) !== record.bytesBase64) {
    throw new Error('The saved local capture byte count or base64 encoding is inconsistent.');
  }
  const header = new TextEncoder().encode('blob ' + bytes.byteLength + String.fromCharCode(0));
  const blobBytes = new Uint8Array(header.byteLength + bytes.byteLength);
  blobBytes.set(header, 0);
  blobBytes.set(bytes, header.byteLength);
  const gitBlobSha = await digestHex('SHA-1', blobBytes);
  const sha256 = await digestHex('SHA-256', bytes);
  if (gitBlobSha !== record.gitBlobSha || sha256 !== record.sha256) {
    throw new Error('Saved local bytes do not match the stored Git blob SHA-1 and SHA-256 metadata.');
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    throw new Error('The saved local capture is not valid UTF-8 text.');
  }
  if (text.includes(String.fromCharCode(0))) {
    throw new Error('The saved local capture contains binary NUL bytes.');
  }
  return Object.freeze({ ...record, text, integrityStatus: 'hashes-match' });
}

/**
 * Read the bounded device-local capture list. Hash matches are consistency checks
 * against editable local metadata; they do not authenticate the original fetch,
 * authorship, source truth, independent verification, or shared-world archival.
 */
export async function readLocalGitHubSourceCaptures(storage = defaultGitHubSourceCaptureStorage()) {
  if (!storage || typeof storage.getItem !== 'function') {
    return { available: false, records: [], reason: 'LOCAL_STORAGE_UNAVAILABLE' };
  }
  let envelope;
  try { envelope = readGitHubSourceCaptureEnvelope(storage); } catch (error) {
    return { available: false, records: [], reason: boundedText(error?.message || 'Local capture index unavailable.', 240) };
  }
  if (envelope.records.length && !globalThis.crypto?.subtle) {
    return { available: false, records: [], reason: 'WEB_CRYPTO_UNAVAILABLE' };
  }
  const counts = new Map();
  for (const record of envelope.records) {
    if (typeof record?.captureId === 'string') counts.set(record.captureId, (counts.get(record.captureId) || 0) + 1);
  }
  const records = [];
  for (const record of envelope.records) {
    if (typeof record?.captureId === 'string' && counts.get(record.captureId) > 1) {
      records.push({
        captureId: record.captureId,
        repository: typeof record.repository === 'string' ? boundedText(record.repository, 240) : 'Unknown repository',
        path: typeof record.path === 'string' ? boundedText(record.path, 1024) : 'Unknown path',
        size: Number.isSafeInteger(record.size) && record.size >= 0 ? record.size : null,
        integrityStatus: 'corrupt',
        reason: 'Duplicate capture identity in the local index.'
      });
      continue;
    }
    try {
      records.push(await verifyLocalGitHubSourceCapture(record));
    } catch (error) {
      records.push({
        captureId: typeof record?.captureId === 'string' ? boundedText(record.captureId, 2048) : null,
        repository: typeof record?.repository === 'string' ? boundedText(record.repository, 240) : 'Unknown repository',
        path: typeof record?.path === 'string' ? boundedText(record.path, 1024) : 'Unknown path',
        size: Number.isSafeInteger(record?.size) && record.size >= 0 ? record.size : null,
        integrityStatus: 'corrupt',
        reason: boundedText(error?.message || 'Local capture integrity check failed.', 240)
      });
    }
  }
  return { available: true, records };
}

/**
 * Persist one exact source capture locally. This never writes a world event,
 * uploads bytes, awards XP, or changes source/evidence status.
 */
export async function saveLocalGitHubSourceCapture(result, storage = defaultGitHubSourceCaptureStorage()) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new Error('Device-local browser storage is unavailable; the source bytes were not saved.');
  }
  if (!result || typeof result !== 'object' || typeof result.bytesBase64 !== 'string') {
    throw new Error('The current source preview does not contain exact bytes to save.');
  }
  const commitSha = String(result.commitSha || '').toLowerCase();
  const gitBlobSha = String(result.gitBlobSha || '').toLowerCase();
  const sha256 = String(result.sha256 || '').toLowerCase();
  const record = {
    schema: GITHUB_SOURCE_CAPTURE_RECORD_SCHEMA,
    captureId: JSON.stringify([result.repository, commitSha, result.path, sha256]),
    repository: result.repository,
    commitSha,
    path: result.path,
    permalink: result.permalink,
    gitBlobSha,
    sha256,
    size: result.size,
    bytesBase64: result.bytesBase64,
    fetchedAt: result.fetchedAt,
    capturedAt: new Date().toISOString()
  };
  const verified = await verifyLocalGitHubSourceCapture(record);
  if (result.text !== verified.text) {
    throw new Error('The current source preview text does not match the exact bytes being saved.');
  }
  const envelope = readGitHubSourceCaptureEnvelope(storage);
  const matching = envelope.records.filter(candidate => candidate?.captureId === record.captureId);
  if (matching.length > 1) {
    throw new Error('The local capture index contains duplicate identities; remove the ambiguous entries before saving.');
  }
  if (matching.length === 1) {
    const existing = await verifyLocalGitHubSourceCapture(matching[0]);
    return { status: 'already-saved', record: existing };
  }
  const usedBytes = envelope.records.reduce((sum, candidate) =>
    sum + (Number.isSafeInteger(candidate?.size) && candidate.size >= 0 && candidate.size <= MAX_GITHUB_SOURCE_BYTES
      ? candidate.size : MAX_GITHUB_SOURCE_BYTES), 0);
  if (envelope.records.length >= MAX_GITHUB_SOURCE_CAPTURE_RECORDS ||
      usedBytes + record.size > MAX_GITHUB_SOURCE_CAPTURE_BYTES) {
    throw new Error('The local capture store is full; remove a saved capture before adding another.');
  }
  const next = { schema: GITHUB_SOURCE_CAPTURE_ENVELOPE_SCHEMA, records: [...envelope.records, record] };
  try {
    storage.setItem(GITHUB_SOURCE_CAPTURE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    throw new Error('Browser storage refused the local capture; no shared-world state changed.');
  }
  return { status: 'saved', record: verified };
}

/** Remove one explicitly selected device-local capture; no world event is written. */
export function removeLocalGitHubSourceCapture(captureId, storage = defaultGitHubSourceCaptureStorage()) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' ||
      typeof captureId !== 'string' || !captureId) {
    throw new Error('A valid local capture identity and writable browser storage are required.');
  }
  const envelope = readGitHubSourceCaptureEnvelope(storage);
  const nextRecords = envelope.records.filter(record => record?.captureId !== captureId);
  if (nextRecords.length === envelope.records.length) return false;
  try {
    storage.setItem(GITHUB_SOURCE_CAPTURE_STORAGE_KEY, JSON.stringify({
      schema: GITHUB_SOURCE_CAPTURE_ENVELOPE_SCHEMA,
      records: nextRecords
    }));
  } catch {
    throw new Error('Browser storage refused the removal; no shared-world state changed.');
  }
  return true;
}

async function digestHex(algorithm, bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is unavailable; source byte identity cannot be checked.');
  }
  const digest = await globalThis.crypto.subtle.digest(algorithm, bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

export async function loadGitHubSourceFile(value, {
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('This browser does not provide fetch; public GitHub source retrieval is unavailable.');
  }
  const source = parseGitHubBlobUrl(value);
  const encodedPath = source.pathSegments.map(segment => encodeURIComponent(segment)).join('/');
  const apiUrl = 'https://api.github.com/repos/' + encodeURIComponent(source.owner) + '/' +
    encodeURIComponent(source.repo) + '/contents/' + encodedPath + '?ref=' + source.commitSha;
  const record = await readBoundedGitHubJson(fetchImpl, apiUrl, timeoutMs);
  if (!record || record.type !== 'file' || record.encoding !== 'base64' ||
      record.path !== source.path || !Number.isSafeInteger(record.size) ||
      record.size < 0 || record.size > MAX_GITHUB_SOURCE_BYTES ||
      typeof record.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(record.sha)) {
    throw new Error('GitHub returned an unsupported, oversized, or unexpected file record.');
  }
  const bytes = decodeGitHubBase64(record.content);
  if (bytes.byteLength !== record.size) {
    throw new Error('The returned byte count does not match GitHub file metadata.');
  }
  const header = new TextEncoder().encode('blob ' + bytes.byteLength + String.fromCharCode(0));
  const blobBytes = new Uint8Array(header.byteLength + bytes.byteLength);
  blobBytes.set(header, 0);
  blobBytes.set(bytes, header.byteLength);
  const computedGitBlobSha = await digestHex('SHA-1', blobBytes);
  if (computedGitBlobSha !== record.sha.toLowerCase()) {
    throw new Error('The returned bytes do not match GitHub’s reported Git blob SHA-1.');
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('The GitHub file is not valid UTF-8 text; binary files are not previewed.');
  }
  if (text.includes(String.fromCharCode(0))) {
    throw new Error('The GitHub file contains binary NUL bytes and is not previewed.');
  }
  const sha256 = await digestHex('SHA-256', bytes);
  return Object.freeze({
    repository: source.owner + '/' + source.repo,
    commitSha: source.commitSha,
    path: source.path,
    permalink: source.permalink,
    gitBlobSha: computedGitBlobSha,
    sha256,
    size: bytes.byteLength,
    bytesBase64: encodeGitHubBase64(bytes),
    text,
    fetchedAt: new Date().toISOString()
  });
}

export function formatGitHubSourceCitation(result) {
  if (!result || typeof result.permalink !== 'string' ||
      typeof result.commitSha !== 'string' || !/^[a-f0-9]{40}$/i.test(result.commitSha) ||
      typeof result.gitBlobSha !== 'string' || !/^[a-f0-9]{40}$/i.test(result.gitBlobSha) ||
      typeof result.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(result.sha256) ||
      !Number.isSafeInteger(result.size) || result.size < 0 || result.size > MAX_GITHUB_SOURCE_BYTES) {
    throw new Error('The GitHub source receipt is incomplete.');
  }
  const parsed = parseGitHubBlobUrl(result.permalink);
  if (parsed.owner + '/' + parsed.repo !== result.repository ||
      parsed.commitSha !== result.commitSha.toLowerCase() || parsed.path !== result.path) {
    throw new Error('The GitHub source receipt does not match its immutable permalink.');
  }
  const citation = GITHUB_SOURCE_CITATION_MARKER + ' | ' + parsed.permalink +
    ' | git-blob-sha1=' + result.gitBlobSha.toLowerCase() +
    ' | sha256=' + result.sha256.toLowerCase() +
    ' | bytes=' + result.size;
  if (Array.from(citation).length > 500) {
    throw new Error('The exact citation is too long for the Source Observation field; use a shorter file path.');
  }
  return citation;
}

/**
 * Validate the bounded citation shape only. A client can supply or fabricate
 * these fields; parsing does not prove that a browser fetch occurred or
 * authenticate the reported hashes. Accept the old marker for retained notes.
 */
export function parseGitHubSourceCitation(value) {
  if (typeof value !== 'string' || Array.from(value).length > 500) return null;
  const parts = value.split(' | ');
  if (parts.length !== 5 || !GITHUB_SOURCE_CITATION_MARKERS.has(parts[0])) return null;
  const [, permalink, blobField, digestField, sizeField] = parts;
  const blobMatch = /^git-blob-sha1=([a-f0-9]{40})$/i.exec(blobField);
  const digestMatch = /^sha256=([a-f0-9]{64})$/i.exec(digestField);
  const sizeMatch = /^bytes=(0|[1-9]\d*)$/.exec(sizeField);
  if (!blobMatch || !digestMatch || !sizeMatch) return null;
  const size = Number(sizeMatch[1]);
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_GITHUB_SOURCE_BYTES) return null;
  try {
    const parsed = parseGitHubBlobUrl(permalink);
    if (parsed.permalink !== permalink) return null;
    return Object.freeze({
      repository: parsed.owner + '/' + parsed.repo,
      commitSha: parsed.commitSha,
      path: parsed.path,
      permalink,
      gitBlobSha: blobMatch[1].toLowerCase(),
      sha256: digestMatch[1].toLowerCase(),
      size
    });
  } catch {
    return null;
  }
}

export function renderGitHubSourceReader(container, {
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  onUseSource,
  onArchiveCapture,
  storage = defaultGitHubSourceCaptureStorage()
} = {}) {
  const section = element('details');
  section.id = 'github-source-reader';
  section.className = 'github-source-reader';
  section.dataset.githubSourceReader = 'true';
  const summary = element('summary', 'Retrieve a public GitHub source file');
  summary.dataset.githubSourceReaderToggle = 'true';
  const content = element('div');
  content.className = 'github-source-reader__content';
  const intro = element('p', 'Public, read-only reader for files in any public GitHub repository. Paste a file URL pinned to a full 40-character commit SHA. UTF-8 text only, at most 64 KiB. ' +
    'No credentials or cookies are sent. The browser preview checks returned bytes against GitHub’s reported blob SHA-1 and computes SHA-256; saving a copy remains device-local and editable. On Android, this is the app’s appassets WebView origin, separate from Chrome’s browser profile. ' +
    'When a Founder submits a saved capture in shared mode, the service receives only the immutable permalink and expected Git blob SHA-1, SHA-256 and byte length. The service re-fetches that commit-pinned file from api.github.com, checks the returned path and bytes against those expectations, and builds the private Source Archive from its own response. Offline pending actions therefore contain metadata, not source bytes. Private mode keeps a client-reported local archive. Only later explicit publication makes the draft a world object. Server retrieval records bytes received at that time; it does not establish authorship, primary-source status, claim accuracy, independent verification or truth.');
  intro.className = 'github-source-reader__intro';
  const input = element('input');
  input.id = 'github-source-url';
  input.type = 'url';
  input.maxLength = 600;
  input.placeholder = 'https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/blob/<commit-sha>/game/quests.mjs';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Commit-pinned public GitHub file URL');
  input.dataset.githubSourceUrl = 'true';
  const fetchButton = element('button', 'Retrieve source bytes');
  fetchButton.id = 'github-source-fetch';
  fetchButton.type = 'button';
  fetchButton.className = 'secondary-button';
  fetchButton.dataset.githubSourceFetch = 'true';
  const saveButton = element('button', 'Save exact bytes locally');
  saveButton.id = 'github-source-save';
  saveButton.type = 'button';
  saveButton.className = 'secondary-button';
  saveButton.disabled = true;
  saveButton.dataset.githubSourceSave = 'true';
  const useButton = element('button', 'Use citation in observation');
  useButton.id = 'github-source-use';
  useButton.type = 'button';
  useButton.className = 'secondary-button';
  useButton.disabled = true;
  useButton.dataset.githubSourceUse = 'true';
  const actions = element('div');
  actions.className = 'github-source-reader__actions';
  actions.append(fetchButton, saveButton, useButton);
  const status = element('p', 'No source has been retrieved.');
  status.id = 'github-source-status';
  status.className = 'github-source-reader__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.dataset.githubSourceStatus = 'true';
  const preview = element('pre');
  preview.id = 'github-source-preview';
  preview.className = 'github-source-reader__preview';
  preview.setAttribute('aria-label', 'Retrieved or saved source preview');
  preview.dataset.githubSourcePreview = 'true';
  const savedDetails = element('details');
  savedDetails.className = 'github-source-captures';
  savedDetails.dataset.githubSourceCaptureList = 'true';
  savedDetails.append(element('summary', 'Saved local captures in this app/browser profile'));
  const savedList = element('div');
  savedList.dataset.githubSourceCaptures = 'true';
  savedList.dataset.githubSourceCapturesReady = 'false';
  savedDetails.append(savedList);
  content.append(intro, input, actions, status, preview, savedDetails);

  function renderSavedCaptures(state) {
    savedList.replaceChildren();
    if (!state.available) {
      savedList.append(element('p', 'Device-local capture storage unavailable: ' + String(state.reason || 'unknown') + '. No capture was loaded or saved.'));
      return;
    }
    if (!state.records.length) {
      savedList.append(element('p', 'No local captures are saved on this device yet.'));
      return;
    }
    for (const record of state.records) {
      const card = element('article');
      card.className = 'github-source-capture-card';
      card.dataset.githubSourceCaptureCard = 'true';
      if (record.captureId) card.dataset.captureId = record.captureId;
      card.append(element('h4', String(record.repository || 'Unknown repository') + '/' + String(record.path || 'Unknown path')));
      if (record.integrityStatus === 'hashes-match') {
        card.append(element('p', String(record.size) + ' bytes · commit ' + String(record.commitSha).slice(0, 12) +
          ' · local capture time ' + String(record.capturedAt) + ' (device clock)'));
        card.append(element('p', 'Stored bytes match the saved Git blob SHA-1 and SHA-256 metadata after a local recheck. This app/browser origin and profile storage is editable and remains device-local when saved or previewed. A shared Source Archive submission sends only the pinned permalink and expected digests/size; the service re-fetches and compares the public GitHub bytes before creating a private draft. Private mode remains client-reported. Publication exposes the retained text, not a truth verdict, authorship claim, primary-source status or independent verification.'));
        const previewSaved = element('button', 'Preview saved bytes');
        previewSaved.type = 'button';
        previewSaved.className = 'secondary-button';
        previewSaved.dataset.previewSourceCapture = record.captureId;
        previewSaved.addEventListener('click', () => {
          if (typeof record.text !== 'string') {
            status.textContent = 'Saved bytes are unavailable for preview; no network request was made.';
            return;
          }
          preview.textContent = record.text.slice(0, GITHUB_SOURCE_PREVIEW_CHARACTERS) +
            (record.text.length > GITHUB_SOURCE_PREVIEW_CHARACTERS
              ? '\n\n[Preview truncated; integrity checks cover all ' + record.size + ' bytes.]'
              : '');
          preview.dataset.savedCaptureId = record.captureId;
          status.textContent = 'Showing the rechecked device-local copy; no network request was made. Local hash checks establish consistency with editable metadata only, not original retrieval, authorship, source truth, or independent verification.';
        });
        card.append(previewSaved);
        const useSaved = element('button', 'Use saved capture in observation');
        useSaved.type = 'button';
        useSaved.className = 'secondary-button';
        useSaved.dataset.useSourceCapture = record.captureId;
        useSaved.disabled = typeof onUseSource !== 'function';
        useSaved.addEventListener('click', () => {
          if (typeof onUseSource !== 'function') return;
          try {
            const citation = formatGitHubSourceCitation(record);
            onUseSource(citation, record);
            status.textContent = 'Loaded a device-local capture; no network request was made. The Source Observation note receives only client-reported citation metadata. A separate shared Source Archive action sends only the pinned reference and expected digests/size so the service can re-fetch the bytes; private mode remains client-reported. Explicit publication is still required, and retrieval does not establish source truth.';
          } catch (error) {
            status.textContent = 'Saved capture could not be used: ' + boundedText(error?.message || 'Unknown error.', 240);
          }
        });
        card.append(useSaved);
        if (typeof onArchiveCapture === 'function') {
          const archiveButton = element('button', 'Create private world draft');
          archiveButton.type = 'button';
          archiveButton.className = 'secondary-button';
          archiveButton.dataset.archiveSourceCapture = record.captureId;
          archiveButton.addEventListener('click', async () => {
            if (typeof onArchiveCapture !== 'function') return;
            archiveButton.disabled = true;
            status.textContent = 'Local byte checks passed. Preparing a metadata-only Source Archive request; the shared service will re-fetch the pinned GitHub file before creating its private draft…';
            try {
              await onArchiveCapture(record);
              status.textContent = 'A private Source Archive draft was created in the current world. Shared mode stores bytes re-fetched and checked by the service; private mode keeps a client-reported local copy. Review the exact bytes and explicitly publish it from the Making Bench; this action alone creates no public world object, XP, truth verdict or authority.';
            } catch (error) {
              const retryableSharedFailure =
                (Number.isInteger(error?.status) && error.status >= 500) ||
                error?.message === 'The shared world is unreachable. Your role has not changed. Reconnect to continue.' ||
                error?.message === 'The shared service did not return a readable response.';
              status.textContent = retryableSharedFailure
                ? 'The shared service did not confirm this draft. The Relay preserved the exact action and request ID on this device. Tap this same button again after reconnecting; it will retry or reconcile the same action. The outcome may be unknown until then. No publication, XP, truth verdict or authority is implied.'
                : 'Source Archive draft was not created: ' + boundedText(error?.message || 'Unknown error.', 240);
            } finally {
              archiveButton.disabled = false;
            }
          });
          card.append(archiveButton);
        }
      } else {
        card.append(element('p', 'Corrupt local capture: ' + String(record.reason || 'integrity check unavailable') + '. It is not available for use.'));
      }
      if (record.captureId) {
        const remove = element('button', 'Remove local capture');
        remove.type = 'button';
        remove.className = 'secondary-button';
        remove.dataset.removeSourceCapture = record.captureId;
        remove.addEventListener('click', async () => {
          remove.disabled = true;
          try {
            const removed = removeLocalGitHubSourceCapture(record.captureId, storage);
            const previewCleared = preview.dataset.savedCaptureId === record.captureId;
            if (previewCleared) {
              preview.textContent = '';
              delete preview.dataset.savedCaptureId;
            }
            await refreshSavedCaptures();
            status.textContent = removed
              ? 'Device-local capture removed.' + (previewCleared ? ' Its saved-byte preview was cleared.' : '') + ' No shared-world event or XP changed. A separately published Source Archive world object is not removed by this local action.'
              : 'That local capture was not present.' + (previewCleared ? ' Its stale preview was cleared.' : '') + ' No shared-world state changed.';
          } catch (error) {
            status.textContent = 'Local capture was not removed: ' + boundedText(error?.message || 'Unknown error.', 240);
          } finally {
            remove.disabled = false;
          }
        });
        card.append(remove);
      }
      savedList.append(card);
    }
    savedDetails.open = true;
  }

  let savedCaptureRefreshGeneration = 0;
  async function refreshSavedCaptures() {
    const generation = ++savedCaptureRefreshGeneration;
    savedList.dataset.githubSourceCapturesReady = 'false';
    try {
      const state = await readLocalGitHubSourceCaptures(storage);
      if (generation !== savedCaptureRefreshGeneration) return;
      renderSavedCaptures(state);
    } catch (error) {
      if (generation !== savedCaptureRefreshGeneration) return;
      savedList.replaceChildren(element('p', 'Local capture list unavailable: ' + boundedText(error?.message || 'Unknown error.', 240)));
    } finally {
      if (generation === savedCaptureRefreshGeneration) {
        savedList.dataset.githubSourceCapturesReady = 'true';
      }
    }
  }

  void refreshSavedCaptures();
  section.append(summary, content);
  container.append(section);

  let generation = 0;
  let current = null;
  input.addEventListener('input', () => {
    generation += 1;
    current = null;
    fetchButton.disabled = false;
    useButton.disabled = true;
    saveButton.disabled = true;
    preview.textContent = '';
    delete preview.dataset.savedCaptureId;
    status.textContent = 'Source URL changed. Retrieve it again before using a citation or saving a local capture.';
  });
  fetchButton.addEventListener('click', async () => {
    const requestGeneration = ++generation;
    current = null;
    fetchButton.disabled = true;
    useButton.disabled = true;
    saveButton.disabled = true;
    preview.textContent = '';
    status.textContent = 'Retrieving public GitHub bytes…';
    try {
      const result = await loadGitHubSourceFile(input.value, { fetchImpl, timeoutMs });
      if (requestGeneration !== generation) return;
      const citation = formatGitHubSourceCitation(result);
      current = { result, citation };
      delete preview.dataset.savedCaptureId;
      preview.textContent = result.text.slice(0, GITHUB_SOURCE_PREVIEW_CHARACTERS) +
        (result.text.length > GITHUB_SOURCE_PREVIEW_CHARACTERS
          ? '\n\n[Preview truncated; SHA-256 covers all ' + result.size + ' bytes.]'
          : '');
      status.textContent = 'Retrieved ' + result.size + ' bytes. Git blob SHA-1 matched GitHub’s reported blob ID; SHA-256 ' +
        result.sha256 + '; not yet saved locally or archived by the shared world; source truth is not verified and no XP is awarded.';
      saveButton.disabled = !storage;
      useButton.disabled = typeof onUseSource !== 'function';
    } catch (error) {
      if (requestGeneration === generation) {
        status.textContent = 'Source retrieval unavailable: ' + boundedText(error?.message || 'GitHub request failed.', 240);
      }
    } finally {
      if (requestGeneration === generation) fetchButton.disabled = false;
    }
  });
  saveButton.addEventListener('click', async () => {
    if (!current) return;
    saveButton.disabled = true;
    try {
      const saved = await saveLocalGitHubSourceCapture(current.result, storage);
      status.textContent = saved.status === 'saved'
        ? 'Saved exact bytes in this app/browser origin and profile on this device. They are not shared or synced by saving or previewing. A shared Source Archive submission sends only the pinned reference and expected digests/size so the service can re-fetch; private mode remains client-reported. Only later explicit publication makes it a world object. Local storage can be edited; hash checks are consistency only, not original fetch, source truth, authorship or independent verification.'
        : 'This exact source capture is already saved in this app/browser origin and profile on this device. It is not shared or synced by NGL to the shared world or other profiles/devices; hashes check consistency only, not source truth.';
      await refreshSavedCaptures();
    } catch (error) {
      status.textContent = 'Local capture not saved: ' + boundedText(error?.message || 'Unknown storage error.', 240);
    } finally {
      saveButton.disabled = !current || !storage;
    }
  });
  useButton.addEventListener('click', () => {
    if (!current || typeof onUseSource !== 'function') return;
    try {
      onUseSource(current.citation, current.result);
      status.textContent = 'Citation added to the note. Review it and explicitly submit; this browser fetch did not create a world event.';
    } catch (error) {
      status.textContent = 'Citation could not be added: ' + boundedText(error?.message || 'The note field is unavailable.', 240);
    }
  });
  return section;
}

