const $ = id => document.getElementById(id);
const choices = Object.freeze({ APPROVE: 'Authorize controlled external specialist review', DEFER: 'Require further hardening', REJECT: 'Reject the present qualification' });
let snapshot = null, connected = false, busy = false, epoch = 0, sequence = 0, appliedSequence = 0;
let serverClock = { at: 0, monotonic: 0 };
const text = value => typeof value === 'string' ? value : value == null ? 'Not supplied.' : JSON.stringify(value, null, 2);
const founder = () => connected && snapshot?.viewer?.role === 'founder';
const decision = () => snapshot?.decision;
const dispositionLabel = d => choices[d?.disposition?.action || d?.disposition] || text(d?.status);
const remaining = () => {
  const end = Date.parse(decision()?.expiresAt);
  return Number.isFinite(end) ? Math.max(0, end - (serverClock.at + performance.now() - serverClock.monotonic)) : null;
};
function clearPrivate() {
  $('private-evidence').hidden = true;
  for (const id of ['proposal-title', 'proposed-effect', 'rollback', 'evaluation-bytes', 'evaluation-receipt']) $(id).textContent = '';
  $('risk-list').replaceChildren();
}
function message(value) { $('gate-message').textContent = value; }
function displayClock() {
  const d = decision(), left = remaining();
  let time = '10:00', label = 'not started';
  if (d && left !== null) {
    const seconds = Math.ceil(left / 1000);
    time = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    label = d.status === 'PENDING' ? (left > 0 ? 'remaining · server window' : 'window elapsed · awaiting server state') : 'window closed';
  }
  $('countdown').replaceChildren(document.createTextNode(time));
  const caption = document.createElement('span'); caption.textContent = label; $('countdown').append(caption);
  $('countdown').setAttribute('aria-label', `${time}, ${label}`);
  $('decision-controls').disabled = busy || !founder() || snapshot?.ready !== true || d?.status !== 'PENDING' || left === null || left <= 0;
}
function render() {
  clearPrivate();
  const isFounder = founder(), d = decision(), proposal = isFounder ? (d || snapshot.proposal) : null;
  $('connection-state').textContent = connected ? (isFounder ? 'FOUNDER CONNECTED' : 'WITNESS VIEW') : 'PREPARED PREVIEW';
  $('viewer-label').textContent = connected ? `${isFounder ? 'FOUNDER' : 'WITNESS'} · ${snapshot.viewer?.name || 'Connected session'}` : 'PREPARED · NO ACTIVE SESSION';
  $('login-form').hidden = !connected || isFounder || snapshot?.ready !== true;
  $('logout-button').hidden = !isFounder;
  $('login-button').disabled = busy;
  $('logout-button').disabled = busy;
  $('activate-button').hidden = connected && (!isFounder || Boolean(d));
  $('activate-button').disabled = busy || !isFounder || snapshot?.ready !== true || Boolean(d);
  $('connection-note').textContent = !connected ? 'Prepared ceremony preview. A connected, configured server and an authenticated Founder are required to open the decision window. No clock is running in this preview.' : isFounder ? 'Authenticated Founder session. Reading this page does not start the clock. Activate the Gate when you are ready; the same window resumes after a refresh.' : 'Connected Witness view. Private evaluation bytes and decision controls are reserved for the authenticated Founder. The ceremony programme remains open to read.';
  let status = 'The prepared record is available below. A server connection is required to decide.';
  if (connected) {
    if (d && snapshot.ready !== true) status = `A retained ${d.status.toLowerCase()} review exists. This address cannot record its disposition; return to the configured HTTPS Gate. Its deadline is unchanged.`;
    else if (d) status = d.status === 'PENDING' ? 'The server decision window is open. Read the evidence and limits before recording one disposition.' : `Server disposition: ${dispositionLabel(d)}.`;
    else if (!isFounder) status = 'Authenticate to inspect the private qualification and, when the server is ready, activate the decision window.';
    else status = snapshot.ready ? 'The server is ready. Activation starts one ten-minute decision window; it cannot be reset by revisiting this page.' : `The Gate is blocked: ${snapshot.blockedReason || 'Server configuration is not ready.'}`;
  }
  $('gate-status').textContent = status;
  if (proposal) {
    $('private-evidence').hidden = false;
    $('proposal-title').textContent = text(proposal.title);
    $('proposed-effect').textContent = text(proposal.proposedEffect);
    for (const risk of Array.isArray(proposal.risks) ? proposal.risks : [proposal.risks || 'No risk statement supplied.']) { const li = document.createElement('li'); li.textContent = text(risk); $('risk-list').append(li); }
    $('rollback').textContent = text(proposal.rollback);
    $('evaluation-bytes').textContent = text(proposal.evaluation?.bytes);
    $('evaluation-receipt').textContent = text(proposal.evaluation?.receipt);
  }
  const recorded = connected && d && d.status !== 'PENDING' && d.disposition;
  $('ceremony-state').textContent = recorded ? 'DISPOSITION RECORDED' : 'CEREMONY PREPARED';
  $('record-summary').textContent = recorded ? `Server-recorded disposition: ${dispositionLabel(d)}.` : connected && d ? `The server reports a ${text(d.status).toLowerCase()} decision window. The commemorative programme remains prepared.` : 'This commemorative programme is prepared. No Founder disposition has been verified by this page.';
  displayClock();
}
async function request(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || data?.message || (typeof data?.error === 'string' ? data.error : `Server request failed (${response.status}).`));
  if (!data) throw new Error('The server returned no readable state.');
  return data;
}
async function refresh({ quiet = false } = {}) {
  if (globalThis.NGL_FOUNDER_GATE_PREVIEW === true || !/^https?:$/.test(location.protocol)) return;
  const ticket = ++sequence, startingEpoch = epoch;
  try {
    const data = await request('/api/founder-gate');
    if (startingEpoch !== epoch || ticket < appliedSequence) return;
    if (!data.viewer || !Number.isFinite(Date.parse(data.serverNow)) || !data.ceremony || !Array.isArray(data.choices)) throw new Error('The server did not return a valid Founder Gate state.');
    appliedSequence = ticket;
    const previousPrincipal = snapshot?.viewer && `${snapshot.viewer.id}:${snapshot.viewer.role}`;
    const nextPrincipal = `${data.viewer.id}:${data.viewer.role}`;
    if (previousPrincipal && previousPrincipal !== nextPrincipal) { epoch++; clearPrivate(); }
    snapshot = data; connected = true;
    serverClock = { at: Date.parse(data.serverNow), monotonic: performance.now() };
    render();
    if (!quiet) message('');
  } catch (error) {
    if (startingEpoch !== epoch || ticket < appliedSequence) return;
    appliedSequence = ticket; connected = false; snapshot = null; clearPrivate(); render();
    if (!quiet) message(`Preview mode: ${error.message}`);
  }
}
async function mutate(path, body, success) {
  if (busy || !connected) return;
  busy = true; epoch++; const operationEpoch = epoch;
  if (path === '/api/logout') { connected = false; snapshot = null; clearPrivate(); }
  render(); message('Waiting for the server…');
  try {
    await request(path, body);
    if (operationEpoch !== epoch) return;
    await refresh({ quiet: true });
    if (connected) message(success);
    else message('The request completed, but its resulting state could not be verified. Reconnect before acting again.');
  } catch (error) {
    if (operationEpoch !== epoch) return;
    await refresh({ quiet: true });
    message(error.message);
  } finally { busy = false; render(); }
}
$('login-form').addEventListener('submit', event => {
  event.preventDefault(); const key = $('founder-key').value; $('founder-key').value = '';
  if (key && connected && !busy) void mutate('/api/login', { key }, 'Founder authenticated. Read the review before activating the Gate.');
});
$('logout-button').addEventListener('click', () => { $('founder-key').value = ''; void mutate('/api/logout', {}, 'Logged out. Private Founder evidence has been cleared.'); });
$('activate-button').addEventListener('click', () => { if (founder() && snapshot.ready && !decision()) void mutate('/api/founder-gate/activate', {}, 'The server Gate state has been verified. The displayed window is authoritative.'); });
for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('click', () => {
  if ($('decision-controls').disabled || !Object.hasOwn(choices, button.dataset.action)) return;
  if (!globalThis.crypto?.randomUUID) { message('This browser requires a secure context to record a decision. Open the configured HTTPS service.'); return; }
  void mutate('/api/founder-gate/choose', { expectedRevision: decision().revision, requestId: crypto.randomUUID(), action: button.dataset.action }, 'The server response has been received. The verified disposition appears above.');
});
$('print-record').addEventListener('click', () => window.print());
$('download-record').addEventListener('click', () => {
  const d = connected ? decision() : null;
  const record = { schema: 'no-gas-labs/founders-day-commemorative-record/v1', generatedAt: new Date().toISOString(), source: connected ? 'connected-server-state' : 'unconnected-prepared-preview', serverObservedAt: connected ? snapshot.serverNow : null, ceremony: { title: 'Inaugural Founders Day · No_Gas_Labs', date: '2026-10-18', timezone: 'America/Chicago', location: { name: 'Carter Lake, Iowa', basis: 'Founder-designated observance location', attendanceAttested: false }, status: connected ? snapshot.ceremony.status : 'PREPARED', performanceAttested: false }, decision: d ? { id: d.id, title: d.title, status: d.status, revision: d.revision, createdAt: d.createdAt, expiresAt: d.expiresAt, disposition: d.disposition || null } : null, limits: ['Approval authorizes controlled external specialist review only.', 'No public launch or certification is authorized.', 'No ceremony performance, independent human witnesses, customer adoption or revenue is attested.'], historicalQualificationRun: { nodeTests: 318, pythonTests: 47, browserChecks: 8, currentExecution: false } };
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(record, null, 2)}\n`], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'no-gas-labs-founders-day-2026-10-18.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
render();
void refresh();
setInterval(() => { if (!busy) void refresh({ quiet: true }); }, 5000);
setInterval(displayClock, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy) void refresh({ quiet: true }); });
