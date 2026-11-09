const REPOSITORY = 'ngl-damien/No-Gas-Labs-Alpha-1';
const SNAPSHOT_URL = './project-state.json';
const MAX_ENVELOPE_BYTES = 256 * 1024;
const MAX_PAYLOAD_BYTES = 192 * 1024;
const MAX_RECORDS = 20;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/i;

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

function validPullRequest(item) {
  return exactKeys(item, ['number', 'title', 'draft', 'state', 'head', 'base', 'updatedAt', 'url']) &&
    Number.isSafeInteger(item.number) && item.number > 0 &&
    boundedText(item.title, 180) && typeof item.draft === 'boolean' &&
    boundedText(item.state, 24) && boundedText(item.head, 100) &&
    boundedText(item.base, 100) && boundedText(item.updatedAt, 40, { empty: true }) &&
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
  ]) || payload.schema !== 'ngl.public-project-state.v1' ||
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

function appendSource(parent, key, heading, source, records, describe) {
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
    const visible = records.slice(0, 8);
    for (const record of visible) {
      const item = element('li');
      item.append(element('strong', describe.title(record)));
      item.append(element('small', describe.meta(record)));
      item.append(element('code', record.url));
      list.append(item);
    }
    group.append(list);
    if (records.length > visible.length) {
      group.append(element('p', 'Showing newest ' + visible.length + ' of ' + records.length + ' captured records.'));
    }
  }
  parent.append(group);
}

export async function renderProjectStateSnapshot(container, options = {}) {
  const section = element('section');
  section.className = 'field-card project-state-snapshot';
  section.dataset.projectStateSnapshot = 'true';
  section.dataset.projectStateStatus = 'loading';
  section.setAttribute('aria-label', 'Bundled public GitHub project-state snapshot');
  section.append(
    element('h3', 'PUBLIC PROJECT STATE · SNAPSHOT'),
    element('p', 'Synthesis Clerk reads a bounded public GitHub snapshot bundled with this build. It is not live and cannot change project or world state.')
  );
  const status = element('p', 'Checking the bundled snapshot receipt…');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  section.append(status);
  container.append(section);

  const result = await loadProjectStateSnapshot(options);
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
      meta: item => (item.draft ? 'DRAFT' : item.state.toUpperCase()) + ' · ' + item.head + ' → ' + item.base + ' · ' + item.updatedAt
    });
  appendSource(section, 'issues', 'OPEN ISSUES', payload.sources.issues, payload.issues, {
    title: item => '#' + item.number + ' · ' + item.title,
    meta: item => item.state.toUpperCase() + ' · ' + item.updatedAt
  });
  appendSource(section, 'workflows', 'RECENT WORKFLOW RUNS', payload.sources.workflows, payload.recentRuns, {
    title: item => item.name + ' · #' + (item.runNumber ?? item.id),
    meta: item => item.status.toUpperCase() + (item.conclusion ? ' · ' + item.conclusion.toUpperCase() : '') +
      ' · ' + item.branch + (item.sha ? ' · ' + item.sha.slice(0, 12) : '') + ' · ' + item.updatedAt
  });
  section.append(element('p', 'Read-only observation. A GitHub API response and its byte receipt are not independent verification or Founder disposition.'));
  return section;
}
