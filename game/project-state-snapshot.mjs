const REPOSITORY = 'ngl-damien/No-Gas-Labs-Alpha-1';
const SNAPSHOT_URL = './project-state.json';
const MAX_ENVELOPE_BYTES = 256 * 1024;
const MAX_PAYLOAD_BYTES = 192 * 1024;
const MAX_RECORDS = 20;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/i;
const MAX_CHECK_ITEMS = 20;
const CHECK_RUN_STATUSES = new Set(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending', 'unknown']);
const CHECK_RUN_CONCLUSIONS = new Set([
  'success', 'failure', 'neutral', 'cancelled', 'timed_out',
  'action_required', 'stale', 'skipped', 'startup_failure', 'unknown'
]);
const COMMIT_STATUS_STATES = new Set(['success', 'failure', 'pending', 'error', 'unknown']);

const unavailable = reason => Object.freeze({ available: false, reason });

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}

function boundedText(value, maximum, { empty = false } = {}) {
  return typeof value === 'string' && Array.from(value).length <= maximum &&
    (empty || value.trim().length > 0);
}

function strictTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const canonical = parsed.toISOString();
  return canonical === value || canonical.replace(/\.000Z$/, 'Z') === value;
}

function safeGitHubUrl(value, pathPattern) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' &&
      !url.username && !url.password && !url.port && !url.search && !url.hash &&
      pathPattern.test(url.pathname);
  } catch {
    return false;
  }
}

function validSource(source) {
  return exactKeys(source, ['available', 'error']) &&
    typeof source.available === 'boolean' &&
    boundedText(source.error, 240, { empty: true }) &&
    (source.available ? source.error === '' : source.error.length > 0);
}

function validCheckRun(item) {
  return exactKeys(item, ['id', 'name', 'status', 'conclusion']) &&
    Number.isSafeInteger(item.id) && item.id > 0 &&
    boundedText(item.name, 120) &&
    CHECK_RUN_STATUSES.has(item.status) &&
    boundedText(item.conclusion, 24, { empty: true }) &&
    (item.conclusion === '' || CHECK_RUN_CONCLUSIONS.has(item.conclusion));
}

function validCheckRunSource(source) {
  if (!exactKeys(source, ['available', 'error', 'totalCount', 'items']) ||
      typeof source.available !== 'boolean' ||
      !boundedText(source.error, 240, { empty: true }) ||
      !Number.isSafeInteger(source.totalCount) || source.totalCount < 0 ||
      !Array.isArray(source.items) || source.items.length > MAX_CHECK_ITEMS ||
      !source.items.every(validCheckRun)) return false;
  return source.available
    ? source.error === '' && source.totalCount >= source.items.length
    : source.error.length > 0 && source.totalCount === 0 && source.items.length === 0;
}

function validCommitStatusItem(item) {
  return exactKeys(item, ['context', 'state', 'description']) &&
    boundedText(item.context, 120) &&
    COMMIT_STATUS_STATES.has(item.state) &&
    boundedText(item.description, 180, { empty: true });
}

function validCommitStatusSource(source) {
  if (!exactKeys(source, ['available', 'error', 'state', 'totalCount', 'items']) ||
      typeof source.available !== 'boolean' ||
      !boundedText(source.error, 240, { empty: true }) ||
      !boundedText(source.state, 24, { empty: true }) ||
      !Number.isSafeInteger(source.totalCount) || source.totalCount < 0 ||
      !Array.isArray(source.items) || source.items.length > MAX_CHECK_ITEMS ||
      !source.items.every(validCommitStatusItem)) return false;
  return source.available
    ? source.error === '' && ['success', 'failure', 'pending', 'error'].includes(source.state) &&
      source.totalCount >= source.items.length
    : source.error.length > 0 && source.state === '' && source.totalCount === 0 && source.items.length === 0;
}

function validHeadChecks(value, headSha) {
  if (!exactKeys(value, ['sha', 'captureStatus', 'capturedAt', 'checkRuns', 'commitStatus']) ||
      typeof value.sha !== 'string' || !COMMIT_SHA.test(value.sha) ||
      value.sha.toLowerCase() !== headSha.toLowerCase() ||
      !['captured', 'not-captured'].includes(value.captureStatus) ||
      !(value.capturedAt === null || strictTimestamp(value.capturedAt)) ||
      !validCheckRunSource(value.checkRuns) ||
      !validCommitStatusSource(value.commitStatus)) return false;
  if (value.captureStatus === 'captured') return value.capturedAt !== null;
  return value.capturedAt === null &&
    value.checkRuns.available === false && value.commitStatus.available === false;
}

function validPullRequest(item) {
  return exactKeys(item, ['number', 'title', 'draft', 'state', 'head', 'base', 'headSha', 'baseSha', 'headChecks', 'updatedAt', 'url']) &&
    Number.isSafeInteger(item.number) && item.number > 0 &&
    boundedText(item.title, 180) && typeof item.draft === 'boolean' &&
    boundedText(item.state, 24) && boundedText(item.head, 100) &&
    boundedText(item.base, 100) &&
    typeof item.headSha === 'string' && COMMIT_SHA.test(item.headSha) &&
    typeof item.baseSha === 'string' && COMMIT_SHA.test(item.baseSha) &&
    validHeadChecks(item.headChecks, item.headSha) &&
    boundedText(item.updatedAt, 40, { empty: true }) &&
    (item.updatedAt === '' || strictTimestamp(item.updatedAt)) &&
    safeGitHubUrl(item.url, new RegExp('^/ngl-damien/No-Gas-Labs-Alpha-1/pull/' + item.number + '$'));
}
function validIssue(item) {
  return exactKeys(item, ['number', 'title', 'state', 'updatedAt', 'url']) &&
    Number.isSafeInteger(item.number) && item.number > 0 &&
    boundedText(item.title, 180) && boundedText(item.state, 24) &&
    boundedText(item.updatedAt, 40, { empty: true }) &&
    (item.updatedAt === '' || strictTimestamp(item.updatedAt)) &&
    safeGitHubUrl(item.url, new RegExp('^/ngl-damien/No-Gas-Labs-Alpha-1/issues/' + item.number + '$'));
}

function validRun(item) {
  return exactKeys(item, ['id', 'name', 'status', 'conclusion', 'branch', 'sha', 'runNumber', 'updatedAt', 'url']) &&
    Number.isSafeInteger(item.id) && item.id > 0 &&
    boundedText(item.name, 120) && boundedText(item.status, 24) &&
    boundedText(item.conclusion, 24, { empty: true }) &&
    boundedText(item.branch, 100) &&
    boundedText(item.sha, 40, { empty: true }) &&
    (item.sha === '' || COMMIT_SHA.test(item.sha)) &&
    (item.runNumber === null || (Number.isSafeInteger(item.runNumber) && item.runNumber > 0)) &&
    boundedText(item.updatedAt, 40, { empty: true }) &&
    (item.updatedAt === '' || strictTimestamp(item.updatedAt)) &&
    safeGitHubUrl(item.url, new RegExp('^/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/' + item.id + '$'));
}

function validPayload(payload) {
  if (!exactKeys(payload, [
    'schema', 'repository', 'capturedAt', 'build', 'sources',
    'pullRequests', 'issues', 'recentRuns'
  ]) || payload.schema !== 'ngl.public-project-state.v3' ||
      payload.repository !== REPOSITORY || !strictTimestamp(payload.capturedAt)) return false;

  if (!exactKeys(payload.build, ['sha', 'ref', 'runId']) ||
      !(payload.build.sha === null || (typeof payload.build.sha === 'string' && COMMIT_SHA.test(payload.build.sha))) ||
      !(payload.build.ref === null || boundedText(payload.build.ref, 200)) ||
      !(payload.build.runId === null || (typeof payload.build.runId === 'string' && /^\d{1,32}$/.test(payload.build.runId)))) return false;

  if (!exactKeys(payload.sources, ['pullRequests', 'issues', 'workflows']) ||
      !validSource(payload.sources.pullRequests) ||
      !validSource(payload.sources.issues) ||
      !validSource(payload.sources.workflows)) return false;

  if (!Array.isArray(payload.pullRequests) || payload.pullRequests.length > MAX_RECORDS ||
      !payload.pullRequests.every(validPullRequest) ||
      !Array.isArray(payload.issues) || payload.issues.length > MAX_RECORDS ||
      !payload.issues.every(validIssue) ||
      !Array.isArray(payload.recentRuns) || payload.recentRuns.length > MAX_RECORDS ||
      !payload.recentRuns.every(validRun)) return false;

  if ((!payload.sources.pullRequests.available && payload.pullRequests.length !== 0) ||
      (!payload.sources.issues.available && payload.issues.length !== 0) ||
      (!payload.sources.workflows.available && payload.recentRuns.length !== 0)) return false;

  return true;
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Read only the local, build-bundled snapshot. This module never contacts GitHub.
 * The receipt identifies exact payload bytes; it does not establish factual truth.
 */
export async function loadProjectStateSnapshot({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') return unavailable('SNAPSHOT_FETCH_UNAVAILABLE');

  try {
    const response = await fetchImpl(SNAPSHOT_URL, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit'
    });
    if (!response || response.ok !== true || typeof response.text !== 'function') {
      return unavailable('SNAPSHOT_NOT_FOUND');
    }

    const envelopeText = await response.text();
    if (new TextEncoder().encode(envelopeText).byteLength > MAX_ENVELOPE_BYTES) {
      return unavailable('SNAPSHOT_ENVELOPE_TOO_LARGE');
    }

    let envelope;
    try { envelope = JSON.parse(envelopeText); }
    catch { return unavailable('SNAPSHOT_ENVELOPE_INVALID'); }

    if (!exactKeys(envelope, ['schema', 'payload', 'receipt']) ||
        envelope.schema !== 'ngl.public-project-state-envelope.v1' ||
        typeof envelope.payload !== 'string' ||
        !exactKeys(envelope.receipt, ['algorithm', 'digest', 'size']) ||
        envelope.receipt.algorithm !== 'sha256' ||
        typeof envelope.receipt.digest !== 'string' || !SHA256.test(envelope.receipt.digest) ||
        !Number.isSafeInteger(envelope.receipt.size) || envelope.receipt.size < 0) {
      return unavailable('SNAPSHOT_ENVELOPE_INVALID');
    }

    const payloadBytes = new TextEncoder().encode(envelope.payload);
    if (payloadBytes.byteLength > MAX_PAYLOAD_BYTES) return unavailable('SNAPSHOT_PAYLOAD_TOO_LARGE');
    if (payloadBytes.byteLength !== envelope.receipt.size) return unavailable('SNAPSHOT_RECEIPT_SIZE_MISMATCH');

    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof subtle.digest !== 'function') return unavailable('SNAPSHOT_CRYPTO_UNAVAILABLE');
    const digest = bytesToHex(await subtle.digest('SHA-256', payloadBytes));
    if (digest !== envelope.receipt.digest) return unavailable('SNAPSHOT_RECEIPT_MISMATCH');

    let payload;
    try { payload = JSON.parse(envelope.payload); }
    catch { return unavailable('SNAPSHOT_PAYLOAD_INVALID'); }
    if (!validPayload(payload)) return unavailable('SNAPSHOT_PAYLOAD_INVALID');

    return Object.freeze({
      available: true,
      payload: Object.freeze(payload),
      receipt: Object.freeze({ ...envelope.receipt })
    });
  } catch {
    return unavailable('SNAPSHOT_READ_FAILED');
  }
}

function element(tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = String(text);
  return result;
}

function exactHeadCheckProjection(headChecks) {
  if (headChecks.captureStatus === 'not-captured') {
    return {
      status: 'not-captured',
      summary: 'EXACT-HEAD CHECKS NOT CAPTURED · this bounded snapshot includes checks for only the three most recently updated pull requests.'
    };
  }
  const runsSource = headChecks.checkRuns;
  const statusSource = headChecks.commitStatus;
  if (!runsSource.available && !statusSource.available) {
    return { status: 'unavailable', summary: 'EXACT-HEAD CHECKS UNAVAILABLE · both GitHub check sources were unavailable at capture time.' };
  }
  const runs = runsSource.available ? runsSource.items : [];
  const statuses = statusSource.available ? statusSource.items : [];
  const failedRuns = runs.filter(run => run.status === 'completed' &&
    ['failure', 'timed_out', 'action_required', 'startup_failure'].includes(run.conclusion));
  const failedStatuses = statuses.filter(item => ['failure', 'error'].includes(item.state));
  const failedCommit = statusSource.available && ['failure', 'error'].includes(statusSource.state);
  const pendingRuns = runs.filter(run => run.status !== 'completed');
  const pendingStatuses = statuses.filter(item => item.state === 'pending');
  const pendingCommit = statusSource.available && statusSource.state === 'pending';
  if (failedRuns.length || failedStatuses.length || failedCommit) {
    return {
      status: 'failure-reported',
      summary: 'EXACT-HEAD CHECKS · FAILURE REPORTED · GitHub reported at least one failed check or status.'
    };
  }
  if (pendingRuns.length || pendingStatuses.length || pendingCommit) {
    return {
      status: 'waiting',
      summary: 'EXACT-HEAD CHECKS · WAITING · GitHub reported checks or status contexts still pending.'
    };
  }
  const completeRuns = runsSource.available && runs.length > 0 && runsSource.totalCount === runs.length &&
    runs.every(run => run.status === 'completed' && run.conclusion === 'success');
  const completeStatuses = statusSource.available && statusSource.state === 'success' &&
    statusSource.totalCount === statuses.length && statuses.every(item => item.state === 'success');
  if (completeRuns && completeStatuses) {
    return {
      status: 'checks-reported-success',
      summary: 'EXACT-HEAD CHECKS · CHECKS REPORTED SUCCESS · complete captured inventories report success; this is CI output, not approval.'
    };
  }
  return {
    status: 'incomplete',
    summary: 'EXACT-HEAD CHECKS · INCOMPLETE · missing, partial, empty, or non-success inventory is not a pass.'
  };
}

export function summarizeHeadChecks(headChecks) {
  if (!headChecks || typeof headChecks !== 'object') {
    return { status: 'unavailable', summary: 'EXACT-HEAD CHECKS UNAVAILABLE · no check record was supplied.' };
  }
  return exactHeadCheckProjection(headChecks);
}

function renderHeadChecks(headChecks) {
  const projection = exactHeadCheckProjection(headChecks);
  const details = element('details');
  details.className = 'project-state-snapshot__head-checks';
  details.dataset.projectStateHeadChecks = projection.status;
  details.append(element('summary', projection.summary));
  details.append(element('p', 'HEAD SHA · ' + headChecks.sha));
  if (headChecks.capturedAt) details.append(element('p', 'CHECK CAPTURED · ' + headChecks.capturedAt));
  else details.append(element('p', 'CHECK CAPTURE NOT PERFORMED FOR THIS RECORD.'));
  const runs = headChecks.checkRuns;
  details.append(element('p', runs.available
    ? 'CHECK RUNS · ' + runs.items.length + '/' + runs.totalCount + ' returned for this exact head.'
    : 'CHECK RUNS UNAVAILABLE · ' + runs.error));
  for (const run of runs.items) {
    details.append(element('p', run.name + ' · ' + run.status +
      (run.conclusion ? ' · ' + run.conclusion : '')));
  }
  if (runs.available && runs.totalCount > runs.items.length) {
    details.append(element('p', 'CHECK RUN INVENTORY TRUNCATED · additional runs were not captured.'));
  }
  const status = headChecks.commitStatus;
  details.append(element('p', status.available
    ? 'COMMIT STATUS · ' + status.state + ' · ' + status.items.length + '/' + status.totalCount + ' contexts.'
    : 'COMMIT STATUS UNAVAILABLE · ' + status.error));
  for (const item of status.items) {
    details.append(element('p', item.context + ' · ' + item.state +
      (item.description ? ' · ' + item.description : '')));
  }
  if (status.available && status.totalCount > status.items.length) {
    details.append(element('p', 'COMMIT STATUS INVENTORY TRUNCATED · additional contexts were not captured.'));
  }
  details.append(element('p', 'GitHub-reported, build-time observations for this exact head only. This is not a required-check policy, independent verification, approval, or Founder authority.'));
  return details;
}

function appendSource(parent, key, heading, source, records, describe, { onRecordLead, payload, receipt } = {}) {
  const group = element('section');
  group.className = 'project-state-snapshot__group';
  group.dataset.projectStateSource = key;
  group.dataset.projectStateSourceStatus = source.available ? 'available' : 'unavailable';
  group.append(element('h4', heading));

  if (!source.available) {
    const note = element('p', 'UNAVAILABLE · ' + source.error);
    note.className = 'empty-note';
    group.append(note);
  } else if (records.length === 0) {
    group.append(element('p', 'No records returned by this successful source response.'));
  } else {
    const list = element('ul');
    const initialVisibleCount = 8;
    list.id = 'project-state-snapshot-' + key + '-records';
    const items = [];
    for (const [index, record] of records.entries()) {
      const item = element('li');
      item.hidden = index >= initialVisibleCount;
      item.append(element('strong', describe.title(record)));
      item.append(element('small', describe.meta(record)));
      if (key === 'pullRequests') item.append(renderHeadChecks(record.headChecks));
      item.append(element('code', record.url));
      if (typeof onRecordLead === 'function') {
        const lead = element('button', 'Prepare research lead →');
        lead.type = 'button';
        lead.className = 'list-button';
        lead.dataset.projectStateRecordLead = key;
        lead.dataset.projectStateRecordUrl = record.url;
        if (key === 'pullRequests') {
          const checkProjection = exactHeadCheckProjection(record.headChecks);
          lead.dataset.projectStateRecordHeadSha = record.headSha;
          lead.dataset.projectStateRecordBaseSha = record.baseSha;
          lead.dataset.projectStateRecordHeadUrl = 'https://github.com/' + REPOSITORY + '/commit/' + record.headSha;
          lead.dataset.projectStateRecordCheckSha = record.headChecks.sha;
          lead.dataset.projectStateRecordCheckStatus = checkProjection.status;
          lead.dataset.projectStateRecordCheckCapturedAt = record.headChecks.capturedAt || '';
          lead.dataset.projectStateRecordCheckSummary = checkProjection.summary;
        }
        lead.setAttribute('aria-label', 'Prepare a research lead from ' + describe.title(record));
        lead.onclick = () => onRecordLead({
          sourceKey: key,
          record,
          capturedAt: payload.capturedAt,
          receipt
        });
        item.append(lead);
      }
      list.append(item);
      items.push(item);
    }
    group.append(list);
    if (records.length > initialVisibleCount) {
      let expanded = false;
      const summary = element('p', 'Showing newest ' + initialVisibleCount + ' of ' + records.length + ' captured records.');
      summary.dataset.projectStateVisibleCount = key;
      const toggle = element('button', 'Show all ' + records.length + ' captured records');
      toggle.type = 'button';
      toggle.className = 'list-button';
      toggle.dataset.projectStateExpand = key;
      toggle.setAttribute('aria-controls', list.id);
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Show all ' + records.length + ' captured records in ' + heading.toLowerCase());
      toggle.onclick = () => {
        expanded = !expanded;
        items.forEach((item, index) => {
          item.hidden = !expanded && index >= initialVisibleCount;
        });
        summary.textContent = expanded
          ? 'Showing all ' + records.length + ' captured records.'
          : 'Showing newest ' + initialVisibleCount + ' of ' + records.length + ' captured records.';
        toggle.textContent = expanded
          ? 'Show newest ' + initialVisibleCount + ' only'
          : 'Show all ' + records.length + ' captured records';
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', expanded
          ? 'Show newest ' + initialVisibleCount + ' captured records in ' + heading.toLowerCase()
          : 'Show all ' + records.length + ' captured records in ' + heading.toLowerCase());
      };
      group.append(summary, toggle);
    }
  }
  parent.append(group);
}

export async function renderProjectStateSnapshot(container, options = {}) {
  const { fetchImpl, onRecordLead } = options;
  const section = element('section');
  section.className = 'field-card project-state-snapshot';
  section.dataset.projectStateSnapshot = 'true';
  section.dataset.projectStateStatus = 'loading';
  section.setAttribute('aria-label', 'Bundled public GitHub project-state snapshot');
  section.append(
    element('h3', 'PUBLIC PROJECT STATE · SNAPSHOT'),
    element('p', 'Synthesis Clerk reads a bounded public GitHub snapshot bundled with this build. Reading is read-only; you may prepare a record as a research lead, but nothing is retained until you explicitly submit it in the Source Observatory.')
  );
  const status = element('p', 'Checking the bundled snapshot receipt…');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  section.append(status);
  container.append(section);

  const result = await loadProjectStateSnapshot({ fetchImpl });
  if (!result.available) {
    section.dataset.projectStateStatus = 'unavailable';
    status.textContent = 'SNAPSHOT UNAVAILABLE · ' + result.reason;
    section.append(element('p', 'No project queue is inferred from an unavailable snapshot. No XP, evidence, approval, authority, or world event is created.'));
    return section;
  }

  const { payload, receipt } = result;
  section.dataset.projectStateStatus = 'receipt-verified';
  section.dataset.projectStateCapturedAt = payload.capturedAt;
  section.dataset.projectStateBuildSha = payload.build.sha || '';
  section.dataset.projectStateReceiptDigest = receipt.digest;
  section.dataset.projectStateReceiptSize = String(receipt.size);
  status.textContent = 'SHA-256 RECEIPT MATCHED · NOT LIVE';
  section.append(element('p', 'Captured ' + payload.capturedAt));
  section.append(element('p', 'APK source commit: ' + (payload.build.sha || 'not supplied') +
    ' · ref: ' + (payload.build.ref || 'not supplied') +
    ' · run: ' + (payload.build.runId || 'not supplied')));
  section.append(element('p', 'Receipt: sha256 ' + receipt.digest.slice(0, 16) + '… · ' + receipt.size +
    ' bytes. This identifies payload bytes only; it does not independently verify claims, execution, or truth.'));

  const counts = Object.values(payload.sources).filter(source => source.available).length;
  section.append(element('p', counts + '/3 public GitHub sources available at capture time.'));
  appendSource(section, 'pullRequests', 'OPEN PULL REQUESTS', payload.sources.pullRequests,
    payload.pullRequests, {
      title: item => '#' + item.number + ' · ' + item.title,
      meta: item => (item.draft ? 'DRAFT' : item.state.toUpperCase()) + ' · ' + item.head + ' → ' + item.base +
        ' · HEAD ' + item.headSha.slice(0, 12) + ' · BASE ' + item.baseSha.slice(0, 12) + ' · ' + item.updatedAt
    }, { onRecordLead, payload, receipt });
  appendSource(section, 'issues', 'OPEN ISSUES', payload.sources.issues, payload.issues, {
    title: item => '#' + item.number + ' · ' + item.title,
    meta: item => item.state.toUpperCase() + ' · ' + item.updatedAt
  }, { onRecordLead, payload, receipt });
  appendSource(section, 'workflows', 'RECENT WORKFLOW RUNS', payload.sources.workflows, payload.recentRuns, {
    title: item => item.name + ' · #' + (item.runNumber ?? item.id),
    meta: item => item.status.toUpperCase() + (item.conclusion ? ' · ' + item.conclusion.toUpperCase() : '') +
      ' · ' + item.branch + (item.sha ? ' · ' + item.sha.slice(0, 12) : '') + ' · ' + item.updatedAt
  }, { onRecordLead, payload, receipt });
  section.append(element('p', 'Selecting a record only prepares a lead. Exact-head check details are GitHub-reported build-time observations and may be incomplete or stale; they are not a required-check verdict. An explicitly submitted Source Observatory note is actor-attributed activity, not source retrieval, independent verification, a truth verdict, XP, approval, or Founder disposition.'));
  return section;
}
));
}

