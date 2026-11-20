const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const js = value => JSON.stringify(value).replace(/</g,'\\u003c');
const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; media-src data:; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const style = `:root{color-scheme:light;font-family:Georgia,serif;color:#233d3a;background:#faf3df}*{box-sizing:border-box}body{margin:0;padding:clamp(16px,5vw,42px);min-height:100vh}header{border-bottom:2px solid #233d3a;padding-bottom:17px;margin-bottom:23px}.eyebrow{font:700 11px system-ui;letter-spacing:2px;text-transform:uppercase;color:#97662f}h1{font-size:clamp(29px,6vw,48px);line-height:1.05;margin:9px 0 12px}p{line-height:1.6;max-width:65ch}.intent{color:#5e6c61}button,input,textarea{font:inherit}button{background:#245e57;color:#fff6df;border:1px solid #183e39;border-radius:4px;padding:11px 17px;cursor:pointer;box-shadow:2px 3px 0 #c9b899}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #d56635;outline-offset:3px}button:disabled{opacity:.45;cursor:default}input,textarea{width:100%;padding:12px;border:1px solid #acb4a2;background:#fffaf0;border-radius:4px;color:#233d3a}label{display:block;margin:18px 0 7px;font:600 12px system-ui;letter-spacing:1px}nav,.controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.note,footer{font:12px/1.6 system-ui;color:#677166}footer{border-top:1px solid #cabc9e;margin-top:30px;padding-top:15px}.card{background:#fffaf0;border:1px solid #c8b99a;border-radius:7px;padding:20px;margin:15px 0}.status{font:12px system-ui;color:#9b4b29;min-height:1.5em}a{color:#245e57}pre{white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;max-width:100%;max-height:60vh;min-height:4rem;background:#f0e8d4;border:1px solid #c8b99a;border-radius:6px;padding:12px;font:12px/1.5 ui-monospace,monospace}.source-archive__metadata{display:grid;grid-template-columns:minmax(8rem,1fr) minmax(0,2fr);gap:8px 12px}.source-archive__metadata dt{font:700 11px system-ui;color:#677166;text-transform:uppercase;letter-spacing:.05em}.source-archive__metadata dd{margin:0;min-width:0;overflow-wrap:anywhere}@media(max-width:480px){.source-archive__metadata{grid-template-columns:1fr;gap:4px}.source-archive__metadata dd{margin-bottom:8px}}`;
function documentFor(title,intent,body,script='') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${esc(title)}</title><style>${style}</style></head><body><header><div class="eyebrow">No_Gas_Labs™ · playable creation</div><h1>${esc(title)}</h1><p class="intent">${esc(intent)}</p></header>${body}<footer>An artifact retained in the No_Gas_Labs™ world. Interactions run inside this sandbox. No live AI, network requests, demand or real-world claims are implied.</footer>${script?`<script>${script}\n;document.documentElement.dataset.nglReady='true';</script>`:''}</body></html>`;
}


export const GITHUB_SOURCE_ARCHIVE_INTENT_PREFIX = 'NGL_GITHUB_SOURCE_ARCHIVE_V1';
export const GITHUB_SOURCE_ARCHIVE_CLIENT_REPORTED_LABEL = 'SOURCE ARCHIVE · CLIENT-REPORTED ORIGIN';
export const GITHUB_SOURCE_ARCHIVE_SERVER_RETRIEVED_LABEL = 'SERVER-RECHECKED GITHUB BYTES · CLAIMS UNVERIFIED';
const GITHUB_SOURCE_ARCHIVE_SCHEMA = 'ngl.github-source-archive.v1';
const GITHUB_SOURCE_ARCHIVE_MAX_BYTES = 64 * 1024;
const sourceArchiveTimestamp = value => typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;

function sourceArchiveBytesFromBase64(value) {
  if (typeof value !== 'string' || value.length > 90000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) ||
      typeof globalThis.atob !== 'function' || typeof globalThis.btoa !== 'function') {
    throw new TypeError('The saved source capture has an unsupported base64 representation.');
  }
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  let canonical = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    canonical += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  if (globalThis.btoa(canonical) !== value) {
    throw new TypeError('The saved source capture base64 is not canonical.');
  }
  return bytes;
}

function sourceArchiveHex(buffer) {
  return Array.from(new Uint8Array(buffer), value => value.toString(16).padStart(2, '0')).join('');
}

function sourceArchivePermalink(record) {
  let url;
  try { url = new URL(record.permalink); } catch {
    throw new TypeError('The saved source capture permalink is not a valid URL.');
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' ||
      url.port || url.username || url.password || url.search || url.hash) {
    throw new TypeError('The saved source capture must use a canonical public GitHub permalink.');
  }
  let segments;
  try { segments = url.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment)); } catch {
    throw new TypeError('The saved source capture permalink contains invalid URL encoding.');
  }
  const owner = segments[0] || '';
  const repo = segments[1] || '';
  const validOwner = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
  const validRepo = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
  if (segments.length < 5 || !validOwner.test(owner) || !validRepo.test(repo) ||
      segments[2] !== 'blob' || segments[3] !== record.commitSha) {
    throw new TypeError('The saved source capture permalink does not identify its repository and full commit SHA.');
  }
  const pathSegments = segments.slice(4);
  if (pathSegments.some(segment => !segment || segment === '.' || segment === '..' ||
      segment.includes('/') || Array.from(segment).some(character => {
        const code = character.charCodeAt(0);
        return code === 92 || code === 0 || code < 32 || code === 127;
      }))) {
    throw new TypeError('The saved source capture path contains an unsafe segment.');
  }
  const path = pathSegments.join('/');
  const canonical = 'https://github.com/' + owner + '/' + repo + '/blob/' + record.commitSha + '/' +
    pathSegments.map(segment => encodeURIComponent(segment)).join('/');
  if (record.repository !== owner + '/' + repo || record.path !== path ||
      record.permalink !== canonical || path.length > 240) {
    throw new TypeError('The saved source capture permalink does not match its retained path metadata.');
  }
}

/**
 * Build a sandboxed, publishable world artifact from a rechecked device-local
 * GitHub capture. Recomputed hashes bind the submitted bytes to editable local
 * metadata only; this does not authenticate the original fetch or source truth.
 */
/**
 * Build a sandboxed artifact from exact GitHub bytes. Server retrieval records
 * what the shared service fetched; device-local capture remains client-reported.
 * Neither mode establishes authorship or source truth.
 */
export async function buildGitHubSourceArchiveBody(record) {
  const validOwnerRepo = typeof record?.repository === 'string' &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(record.repository);
  const serverRechecked = record?.retrievalMode === 'server-rechecked';
  if (record?.retrievalMode !== undefined && !['client-reported', 'server-rechecked'].includes(record.retrievalMode)) {
    throw new TypeError('The Source Archive retrieval mode is unsupported.');
  }
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      record.schema !== 'ngl.github-source-capture.v1' ||
      record.integrityStatus !== 'hashes-match' || !validOwnerRepo ||
      typeof record.commitSha !== 'string' || !/^[a-f0-9]{40}$/.test(record.commitSha) ||
      typeof record.path !== 'string' || !record.path || record.path.length > 240 ||
      typeof record.permalink !== 'string' || record.permalink.length > 2000 ||
      typeof record.captureId !== 'string' || record.captureId.length > 2048 ||
      typeof record.gitBlobSha !== 'string' || !/^[a-f0-9]{40}$/.test(record.gitBlobSha) ||
      typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256) ||
      !Number.isSafeInteger(record.size) || record.size < 0 || record.size > GITHUB_SOURCE_ARCHIVE_MAX_BYTES ||
      typeof record.text !== 'string' || record.text.includes(String.fromCharCode(0)) ||
      !sourceArchiveTimestamp(record.fetchedAt) || !sourceArchiveTimestamp(record.capturedAt)) {
    throw new TypeError('A bounded public GitHub source capture is required for a Source Archive draft.');
  }
  sourceArchivePermalink(record);
  const expectedCaptureId = JSON.stringify([record.repository, record.commitSha, record.path, record.sha256]);
  if (record.captureId !== expectedCaptureId) throw new TypeError('The saved source capture identity does not match its repository, commit, path and SHA-256.');
  const bytes = sourceArchiveBytesFromBase64(record.bytesBase64);
  if (bytes.byteLength !== record.size) throw new TypeError('The saved source capture byte count does not match its retained metadata.');
  let decodedText;
  try { decodedText = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    throw new TypeError('The saved source capture is not valid UTF-8 text.');
  }
  if (decodedText !== record.text) throw new TypeError('The saved source capture text does not match its exact retained bytes.');
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable; the source capture cannot be rechecked for a world archive.');
  const header = new TextEncoder().encode('blob ' + bytes.byteLength + String.fromCharCode(0));
  const blobBytes = new Uint8Array(header.byteLength + bytes.byteLength);
  blobBytes.set(header, 0); blobBytes.set(bytes, header.byteLength);
  const [gitBlobDigest, sha256Digest] = await Promise.all([
    globalThis.crypto.subtle.digest('SHA-1', blobBytes),
    globalThis.crypto.subtle.digest('SHA-256', bytes)
  ]);
  const gitBlobSha = sourceArchiveHex(gitBlobDigest), sha256 = sourceArchiveHex(sha256Digest);
  if (gitBlobSha !== record.gitBlobSha || sha256 !== record.sha256) {
    throw new TypeError('The saved source capture bytes no longer match the stored Git blob SHA-1 and SHA-256 metadata.');
  }
  const retrievalMode = serverRechecked ? 'SERVER_RECHECKED' : 'CLIENT_REPORTED';
  const retrievalLabel = serverRechecked ? GITHUB_SOURCE_ARCHIVE_SERVER_RETRIEVED_LABEL : GITHUB_SOURCE_ARCHIVE_CLIENT_REPORTED_LABEL;
  const retrievalNote = serverRechecked
    ? 'The shared service fetched this exact commit-pinned file from api.github.com over HTTPS and verified the returned path, byte length, Git blob SHA-1, and SHA-256. This records a server-observed retrieval of these bytes at that time; it does not establish authorship, primary-source status, claim accuracy, source truth, independent verification, or authority.'
    : 'This object preserves a client-submitted copy. The permalink, original fetch, commit/path membership, authorship, source truth, independent verification and authority remain unverified. A publication receipt binds these artifact bytes only; neither receipt authenticates the original GitHub source.';
  const retrievalTimeLabel = serverRechecked ? 'Server retrieval time (service clock)' : 'Fetch time (device clock)';
  const archiveTimeLabel = serverRechecked ? 'Server archive preparation time (service clock)' : 'Local save time (device clock)';
  const byteCheckNote = serverRechecked
    ? 'Server byte check: the shared service independently retrieved the pinned file and recomputed Git blob SHA-1 and SHA-256 from the returned UTF-8 bytes before drafting.'
    : 'Device-local byte check: Git blob SHA-1 and SHA-256 were recomputed from the retained UTF-8 bytes and matched the saved metadata before this draft was created. Local storage and its metadata are editable.';
  const decodedStatus = serverRechecked
    ? 'Server retrieval receipt recorded. Authorship, claim accuracy, and source truth remain unverified.'
    : 'Source origin and truth remain unverified.';
  const payload = {
    schema: GITHUB_SOURCE_ARCHIVE_SCHEMA, retrievalMode, captureId: record.captureId,
    repository: record.repository, commitSha: record.commitSha, path: record.path,
    permalink: record.permalink, gitBlobSha, sha256, size: bytes.byteLength,
    fetchedAt: record.fetchedAt, capturedAt: record.capturedAt, bytesBase64: record.bytesBase64
  };
  const fileLabel = record.repository + '/' + record.path, payloadJSON = js(payload);
  const script = [
    '(function(){',
    "  const output=document.getElementById('ngl-source-archive-content');",
    "  const status=document.getElementById('ngl-source-archive-status');",
    '  try {',
    "    const payload=JSON.parse(document.getElementById('ngl-source-archive-data').textContent);",
    "    if(!payload||payload.schema!==" + JSON.stringify(GITHUB_SOURCE_ARCHIVE_SCHEMA) + "||typeof payload.bytesBase64!=='string') throw new Error('Unsupported archive payload');",
    '    const binary=atob(payload.bytesBase64), bytes=new Uint8Array(binary.length);',
    '    for(let index=0;index<binary.length;index+=1)bytes[index]=binary.charCodeAt(index);',
    "    if(bytes.byteLength!==payload.size)throw new Error('Retained byte count mismatch');",
    "    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);",
    "    if(text.includes(String.fromCharCode(0)))throw new Error('Binary NUL bytes are not supported');",
    '    output.textContent=text;',
    "    status.textContent='Decoded '+bytes.byteLength.toLocaleString()+' retained bytes. '+" + JSON.stringify(decodedStatus) + ";",
    '  } catch {',
    "    output.textContent='The retained source bytes could not be decoded in this viewer.';",
    "    status.textContent='Archive display failed. The retained artifact bytes were not modified.';",
    '  }',
    '})();'
  ].join('\n');
  return [
    '<article class="source-archive" data-ngl-source-archive="v1" data-source-capture-id="' + esc(record.captureId) + '">',
    '<p class="eyebrow">' + esc(retrievalLabel) + '</p><h2>' + esc(fileLabel) + '</h2>',
    '<dl class="source-archive__metadata">',
    '<dt>Repository</dt><dd>' + esc(record.repository) + '</dd>',
    '<dt>Path</dt><dd>' + esc(record.path) + '</dd>',
    '<dt>Full commit SHA</dt><dd><code>' + esc(record.commitSha) + '</code></dd>',
    '<dt>Commit-pinned permalink</dt><dd><code>' + esc(record.permalink) + '</code></dd>',
    '<dt>Git blob SHA-1</dt><dd><code>' + gitBlobSha + '</code></dd>',
    '<dt>SHA-256</dt><dd><code>' + sha256 + '</code></dd>',
    '<dt>Retained byte length</dt><dd>' + bytes.byteLength.toLocaleString() + ' bytes</dd>',
    '<dt>' + retrievalTimeLabel + '</dt><dd>' + esc(record.fetchedAt) + '</dd>',
    '<dt>' + archiveTimeLabel + '</dt><dd>' + esc(record.capturedAt) + '</dd>',
    '</dl><p class="note">' + esc(byteCheckNote) + '</p><p class="note">' + esc(retrievalNote) + '</p>',
    '<p class="note">Before publishing in shared mode, review the full captured text for credentials, personal data or material you do not want world participants to see. Shared publication makes the retained text readable in the world; private mode keeps it in this local save.</p>',
    '<pre id="ngl-source-archive-content" aria-label="Archived UTF-8 source text">The exact source bytes are embedded. This viewer requires JavaScript to decode them.</pre>',
    '<p id="ngl-source-archive-status" class="status" role="status">Retained ' + bytes.byteLength.toLocaleString() + ' bytes. No source truth verdict or authority is implied.</p>',
    '<script type="application/json" id="ngl-source-archive-data">' + payloadJSON + '</script><script>' + script + '</script></article>'
  ].join('');
}

export const GITHUB_SOURCE_ARCHIVE_PREDICATE_EVALUATOR = 'ngl.source-archive-predicate.v1';
const GITHUB_SOURCE_ARCHIVE_PAYLOAD_KEYS = Object.freeze([
  'bytesBase64', 'captureId', 'capturedAt', 'commitSha', 'fetchedAt',
  'gitBlobSha', 'path', 'permalink', 'repository', 'retrievalMode',
  'schema', 'sha256', 'size'
].sort());

function sourceArchivePayloadFromHtml(html) {
  const marker = '<script type="application/json" id="ngl-source-archive-data">';
  if (typeof html !== 'string' || html.length > 4 * 1024 * 1024 ||
      !html.includes('data-ngl-source-archive="v1"')) {
    throw Object.assign(new TypeError('The retained artifact is not a bounded Source Archive document.'), { code: 'SOURCE_ARCHIVE_UNVERIFIABLE' });
  }
  const start = html.indexOf(marker);
  if (start < 0 || html.indexOf(marker, start + marker.length) !== -1) {
    throw Object.assign(new TypeError('The Source Archive must contain exactly one embedded payload.'), { code: 'SOURCE_ARCHIVE_UNVERIFIABLE' });
  }
  const end = html.indexOf('</script>', start + marker.length);
  if (end < 0) throw Object.assign(new TypeError('The Source Archive payload is incomplete.'), { code: 'SOURCE_ARCHIVE_UNVERIFIABLE' });
  try { return JSON.parse(html.slice(start + marker.length, end)); }
  catch { throw Object.assign(new TypeError('The Source Archive payload is not valid JSON.'), { code: 'SOURCE_ARCHIVE_UNVERIFIABLE' }); }
}

/** Read receipt metadata only; this does not establish byte integrity or source truth. */
export function readGitHubSourceArchiveMetadata(html) {
  const payload = sourceArchivePayloadFromHtml(html);
  const keys = Object.keys(payload).sort();
  const validOwnerRepo = typeof payload.repository === 'string' &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(payload.repository);
  if (keys.length !== GITHUB_SOURCE_ARCHIVE_PAYLOAD_KEYS.length ||
      keys.some((key, index) => key !== GITHUB_SOURCE_ARCHIVE_PAYLOAD_KEYS[index]) ||
      payload.schema !== GITHUB_SOURCE_ARCHIVE_SCHEMA ||
      !['SERVER_RECHECKED', 'CLIENT_REPORTED'].includes(payload.retrievalMode) ||
      !validOwnerRepo ||
      typeof payload.commitSha !== 'string' || !/^[a-f0-9]{40}$/.test(payload.commitSha) ||
      typeof payload.path !== 'string' || !payload.path || payload.path.length > 240 ||
      typeof payload.permalink !== 'string' || payload.permalink.length > 2000 ||
      typeof payload.captureId !== 'string' || payload.captureId.length > 2048 ||
      typeof payload.gitBlobSha !== 'string' || !/^[a-f0-9]{40}$/.test(payload.gitBlobSha) ||
      typeof payload.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(payload.sha256) ||
      !Number.isSafeInteger(payload.size) || payload.size < 0 || payload.size > GITHUB_SOURCE_ARCHIVE_MAX_BYTES ||
      !sourceArchiveTimestamp(payload.fetchedAt) || !sourceArchiveTimestamp(payload.capturedAt) ||
      typeof payload.bytesBase64 !== 'string') {
    throw Object.assign(new TypeError('The embedded Source Archive receipt metadata is malformed.'), { code: 'SOURCE_ARCHIVE_UNVERIFIABLE' });
  }
  try { sourceArchivePermalink(payload); }
  catch { throw Object.assign(new TypeError('The embedded Source Archive permalink does not match its retained identity.'), { code: 'SOURCE_ARCHIVE_UNVERIFIABLE' }); }
  const expectedCaptureId = JSON.stringify([payload.repository, payload.commitSha, payload.path, payload.sha256]);
  if (payload.captureId !== expectedCaptureId) {
    throw Object.assign(new TypeError('The embedded Source Archive capture identity does not match its retained metadata.'), { code: 'SOURCE_ARCHIVE_UNVERIFIABLE' });
  }
  return Object.freeze({ ...payload });
}

async function readVerifiedServerSourceArchive(version) {
  if (!version || version.kind !== 'custom' ||
      typeof version.intent !== 'string' || !version.intent.startsWith(GITHUB_SOURCE_ARCHIVE_INTENT_PREFIX) ||
      typeof version.html !== 'string' ||
      !version.html.includes(GITHUB_SOURCE_ARCHIVE_SERVER_RETRIEVED_LABEL)) {
    throw Object.assign(new TypeError('A published server-rechecked Source Archive version is required.'), { code: 'SOURCE_ARCHIVE_NOT_RECHECKED' });
  }
  const metadata = readGitHubSourceArchiveMetadata(version.html);
  if (metadata.retrievalMode !== 'SERVER_RECHECKED') {
    throw Object.assign(new TypeError('Client-reported bytes are not eligible for server predicate evaluation.'), { code: 'SOURCE_ARCHIVE_NOT_RECHECKED' });
  }
  const bytes = sourceArchiveBytesFromBase64(metadata.bytesBase64);
  if (bytes.byteLength !== metadata.size) {
    throw Object.assign(new TypeError('The retained Source Archive byte count no longer matches its receipt.'), { code: 'SOURCE_ARCHIVE_UNVERIFIABLE' });
  }
  let decodedText;
  try { decodedText = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw Object.assign(new TypeError('The retained Source Archive bytes are not valid UTF-8 text.'), { code: 'SOURCE_ARCHIVE_UNVERIFIABLE' }); }
  if (decodedText.includes(String.fromCharCode(0)) || !globalThis.crypto?.subtle) {
    throw Object.assign(new TypeError('The retained Source Archive cannot be rechecked in this runtime.'), { code: 'SOURCE_ARCHIVE_UNVERIFIABLE' });
  }
  const header = new TextEncoder().encode('blob ' + bytes.byteLength + String.fromCharCode(0));
  const blobBytes = new Uint8Array(header.byteLength + bytes.byteLength);
  blobBytes.set(header, 0);
  blobBytes.set(bytes, header.byteLength);
  const [gitBlobDigest, sha256Digest] = await Promise.all([
    globalThis.crypto.subtle.digest('SHA-1', blobBytes),
    globalThis.crypto.subtle.digest('SHA-256', bytes)
  ]);
  if (sourceArchiveHex(gitBlobDigest) !== metadata.gitBlobSha ||
      sourceArchiveHex(sha256Digest) !== metadata.sha256) {
    throw Object.assign(new TypeError('The retained Source Archive bytes no longer match their Git blob SHA-1 and SHA-256 receipts.'), { code: 'SOURCE_ARCHIVE_UNVERIFIABLE' });
  }
  return Object.freeze({ metadata, text: decodedText });
}

/** MATCH/NO_MATCH is a byte predicate only, never a claim-truth or authority verdict. */
export async function evaluateGitHubSourceArchivePredicate(version, predicateKind, literal) {
  if (!['contains-literal', 'does-not-contain-literal'].includes(predicateKind)) {
    throw Object.assign(new TypeError('Only contains-literal and does-not-contain-literal predicates are supported.'), { code: 'UNSUPPORTED_PREDICATE' });
  }
  if (typeof literal !== 'string' || !literal.trim() || Array.from(literal.trim()).length > 256) {
    throw Object.assign(new TypeError('A non-empty literal of at most 256 characters is required.'), { code: 'INVALID_PREDICATE_LITERAL' });
  }
  const normalizedLiteral = literal.trim();
  const { metadata, text } = await readVerifiedServerSourceArchive(version);
  const contains = text.includes(normalizedLiteral);
  const matches = predicateKind === 'contains-literal' ? contains : !contains;
  return Object.freeze({
    predicateKind, literal: normalizedLiteral, outcome: matches ? 'MATCH' : 'NO_MATCH',
    sourceSha256: metadata.sha256, sourceSize: metadata.size,
    retrievalMode: metadata.retrievalMode, evaluator: GITHUB_SOURCE_ARCHIVE_PREDICATE_EVALUATOR
  });
}


const SATIRE_ISSUE_V1_SCHEMA = 'ngl.satire-issue.v1';
const SATIRE_ISSUE_V2_SCHEMA = 'ngl.satire-issue.v2';
const SATIRE_ISSUE_V1_KEYS = Object.freeze([
  'factualSubstrate', 'falsifier', 'headline', 'schema',
  'satiricalTreatment', 'sourceReferences', 'strongestCounterargument',
  'target', 'uncertainty'
].sort());
const SATIRE_ISSUE_V2_KEYS = Object.freeze([
  ...SATIRE_ISSUE_V1_KEYS, 'correctionNote', 'correctionOf'
].sort());
export const SATIRE_ISSUE_INTENT_PREFIX = 'NGL_SATIRE_ISSUE_V1';
export const SATIRE_ISSUE_FOLLOW_UP_INTENT_PREFIX = 'NGL_SATIRE_ISSUE_V2';
const satireIdentifier = value => typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) &&
  !['constructor', 'prototype', '__proto__'].includes(value);
const strictIssueTimestamp = value => typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;

function normalizeSatireIssue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('A structured satire issue is required.');
  }
  const schema = value.schema;
  const expectedKeys = schema === SATIRE_ISSUE_V1_SCHEMA ? SATIRE_ISSUE_V1_KEYS
    : schema === SATIRE_ISSUE_V2_SCHEMA ? SATIRE_ISSUE_V2_KEYS : null;
  const keys = Object.keys(value).sort();
  if (!expectedKeys || keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index])) {
    throw new TypeError('The satire issue must use the exact schema field set.');
  }
  const text = (field, maximum) => {
    if (typeof value[field] !== 'string') {
      throw new TypeError('The satire issue ' + field + ' field must be text.');
    }
    const normalized = value[field].trim();
    const length = Array.from(normalized).length;
    if (length < 1 || length > maximum) {
      throw new RangeError('The satire issue ' + field + ' field must contain 1–' + maximum + ' Unicode code points.');
    }
    return normalized;
  };
  if (!Array.isArray(value.sourceReferences) ||
      value.sourceReferences.length < 1 || value.sourceReferences.length > 5) {
    throw new RangeError('Add between one and five author-entered source references.');
  }
  const sourceReferences = value.sourceReferences.map((reference, index) => {
    if (typeof reference !== 'string') {
      throw new TypeError('Source reference ' + (index + 1) + ' must be text.');
    }
    const normalized = reference.trim();
    const length = Array.from(normalized).length;
    if (length < 1 || length > 500) {
      throw new RangeError('Each source reference must contain 1–500 Unicode code points.');
    }
    return normalized;
  });
  if (new Set(sourceReferences).size !== sourceReferences.length) {
    throw new TypeError('Duplicate source references must be resolved before publishing.');
  }
  let correctionOf;
  let correctionNote;
  if (schema === SATIRE_ISSUE_V2_SCHEMA) {
    const reference = value.correctionOf;
    const referenceKeys = reference && typeof reference === 'object' && !Array.isArray(reference)
      ? Object.keys(reference).sort() : [];
    if (referenceKeys.join(',') !== ['creationId', 'publicationEventId', 'version'].sort().join(',') ||
        !satireIdentifier(reference.creationId) ||
        !satireIdentifier(reference.publicationEventId) ||
        !Number.isSafeInteger(reference.version) || reference.version < 1) {
      throw new TypeError('A follow-up issue must bind one exact earlier creation, version and publication event.');
    }
    correctionOf = Object.freeze({
      creationId: reference.creationId,
      version: reference.version,
      publicationEventId: reference.publicationEventId
    });
    correctionNote = text('correctionNote', 1000);
  }
  return Object.freeze({
    schema,
    headline: text('headline', 140),
    target: text('target', 180),
    factualSubstrate: text('factualSubstrate', 2000),
    sourceReferences: Object.freeze(sourceReferences),
    satiricalTreatment: text('satiricalTreatment', 2000),
    strongestCounterargument: text('strongestCounterargument', 2000),
    uncertainty: text('uncertainty', 1500),
    falsifier: text('falsifier', 1500),
    ...(schema === SATIRE_ISSUE_V2_SCHEMA ? { correctionOf, correctionNote } : {})
  });
}

/**
 * Build an in-world satire issue from author-entered fields. Source references
 * are never fetched here; the visible assurance labels remain deliberately
 * unverified. The embedded JSON is inert metadata inside the artifact sandbox.
 */
export function buildSatireIssueBody(value) {
  const issue = normalizeSatireIssue(value);
  const references = issue.sourceReferences.map(reference => '<li>' + esc(reference) + '</li>').join('');
  const data = JSON.stringify(issue).replace(/</g, '\\u003c');
  const marker = issue.schema === SATIRE_ISSUE_V2_SCHEMA ? 'v2' : 'v1';
  const correction = issue.correctionOf
    ? `\n    <section class="card" data-ngl-correction-of="true">
      <h3>Correction lineage · author-entered</h3>
      <p>Prior creation ID: <code>${esc(issue.correctionOf.creationId)}</code></p>
      <p>Prior edition: <code>v${issue.correctionOf.version}</code></p>
      <p>Prior publication event ID: <code>${esc(issue.correctionOf.publicationEventId)}</code></p>
      <p>Follow-up note: ${esc(issue.correctionNote)}</p>
      <p>This link identifies an earlier retained edition; it does not adjudicate the dispute or establish truth.</p>
    </section>`
    : '';
  return `<article data-ngl-satire-issue="${marker}">
    <p class="eyebrow">IN-WORLD SATIRE · AUTHOR-ENTERED · NOT FACT-CHECKED</p>
    <h2>${esc(issue.headline)}</h2>
    <section class="card"><h3>Satirical target</h3><p>${esc(issue.target)}</p></section>
    <section class="card"><h3>Factual substrate · author-entered</h3><p>${esc(issue.factualSubstrate)}</p></section>
    <section class="card"><h3>Source references · author-entered, not retrieved</h3><ol>${references}</ol></section>
    <section class="card"><h3>Satirical treatment</h3><p>${esc(issue.satiricalTreatment)}</p></section>
    <section class="card"><h3>Strongest counterargument / dissent</h3><p>${esc(issue.strongestCounterargument)}</p></section>
    <section class="card"><h3>Uncertainty / missing evidence</h3><p>${esc(issue.uncertainty)}</p></section>
    <section class="card"><h3>Falsifier / correction trigger</h3><p>${esc(issue.falsifier)}</p></section>${correction}
    <aside class="card evidence-warning">
      <strong>Assurance boundary</strong>
      <p>Source retrieval: NOT_PERFORMED. Independent verification: NOT_PERFORMED. Model assertions: LEADS_ONLY. Execution: NOT_EXECUTED. External publication: NOT_PERFORMED.</p>
      <p>Publishing this artifact preserves an in-world version only. It does not certify facts, resolve dissent, grant authority, or publish outside No_Gas_Labs™. Corrections belong in a follow-up issue; this version remains preserved.</p>
    </aside>
    <script type="application/json" id="ngl-satire-issue-data">${data}</script>
  </article>`;
}

/** Parse the embedded issue payload. This alone does not bind it to visible rendering. */
export function readSatireIssueDocument(html) {
  if (typeof html !== 'string' ||
      !html.includes('Source retrieval: NOT_PERFORMED') ||
      !html.includes('Independent verification: NOT_PERFORMED') ||
      !html.includes('Model assertions: LEADS_ONLY') ||
      !html.includes('External publication: NOT_PERFORMED')) return null;
  const markers = [...html.matchAll(/data-ngl-satire-issue="v([12])"/g)];
  const metadataBlocks = [...html.matchAll(/<script type="application\/json" id="ngl-satire-issue-data">([\s\S]*?)<\/script>/gi)];
  if (markers.length !== 1 || metadataBlocks.length !== 1) return null;
  try {
    const issue = normalizeSatireIssue(JSON.parse(metadataBlocks[0][1]));
    const expectedMarker = issue.schema === SATIRE_ISSUE_V2_SCHEMA ? '2' : '1';
    return markers[0][1] === expectedMarker ? issue : null;
  } catch {
    return null;
  }
}

function satireIntentPrefix(issue) {
  return issue?.schema === SATIRE_ISSUE_V2_SCHEMA
    ? SATIRE_ISSUE_FOLLOW_UP_INTENT_PREFIX
    : issue?.schema === SATIRE_ISSUE_V1_SCHEMA ? SATIRE_ISSUE_INTENT_PREFIX : null;
}

/** Return an issue only when the retained custom document is the canonical rendering of its embedded payload. */
export function readSatireIssueArtifact(artifact) {
  if (!artifact || artifact.kind !== 'custom' ||
      typeof artifact.title !== 'string' ||
      typeof artifact.intent !== 'string') return null;
  const issue = readSatireIssueDocument(artifact.html);
  const expectedPrefix = satireIntentPrefix(issue);
  if (!issue || !expectedPrefix || !artifact.intent.startsWith(expectedPrefix)) return null;
  try {
    const expected = createArtifact({
      kind: 'custom',
      title: artifact.title,
      intent: artifact.intent,
      html: buildSatireIssueBody(issue)
    }).html;
    return artifact.html === expected ? issue : null;
  } catch {
    return null;
  }
}

const pushIndex = (map, key, value) => {
  const values = map.get(key) || [];
  values.push(value);
  map.set(key, values);
};

/** Build one bounded-history index so multiple correction links remain linear to inspect. */
export function indexSatireIssuePublications(world) {
  const creationsById = new Map();
  const versionsByKey = new Map();
  const publicationsByVersion = new Map();
  const eventsById = new Map();
  const eventPositions = new Map();
  const creations = Array.isArray(world?.creations) ? world.creations : [];
  const events = Array.isArray(world?.events) ? world.events : [];
  for (const creation of creations) {
    if (typeof creation?.id !== 'string') continue;
    pushIndex(creationsById, creation.id, creation);
    for (const version of [...(Array.isArray(creation.versions) ? creation.versions : []), creation]) {
      if (version?.id !== creation.id || !Number.isSafeInteger(version.version)) continue;
      pushIndex(versionsByKey, JSON.stringify([creation.id, version.version]), version);
    }
  }
  events.forEach((event, index) => {
    if (event && typeof event === 'object') {
      eventPositions.set(event, index);
      if (typeof event.id === 'string') pushIndex(eventsById, event.id, event);
      if (event.type === 'publish' && typeof event.creationId === 'string' && Number.isSafeInteger(event.version)) {
        pushIndex(publicationsByVersion, JSON.stringify([event.creationId, event.version]), event);
      }
    }
  });
  return { creationsById, versionsByKey, publicationsByVersion, eventsById, eventPositions };
}

/** Resolve a correction reference only to one canonical, earlier retained issue publication. */
export function findSatireIssuePublication(world, reference, index = indexSatireIssuePublications(world)) {
  if (!reference || !satireIdentifier(reference.creationId) ||
      !Number.isSafeInteger(reference.version) || reference.version < 1 ||
      (reference.publicationEventId !== undefined && !satireIdentifier(reference.publicationEventId))) return null;
  const key = JSON.stringify([reference.creationId, reference.version]);
  const creations = index.creationsById.get(reference.creationId) || [];
  const versions = index.versionsByKey.get(key) || [];
  const publications = index.publicationsByVersion.get(key) || [];
  if (creations.length !== 1 || versions.length !== 1 || publications.length !== 1) return null;
  const creation = creations[0];
  const version = versions[0];
  const event = publications[0];
  const eventIds = index.eventsById.get(event.id) || [];
  const eventIndex = index.eventPositions.get(event);
  if (eventIds.length !== 1 ||
      (reference.publicationEventId !== undefined && event.id !== reference.publicationEventId) ||
      event.creationId !== reference.creationId || event.version !== reference.version ||
      event.actor?.role !== 'founder' || typeof event.actor?.id !== 'string' || !event.actor.id ||
      !strictIssueTimestamp(event.at) || !strictIssueTimestamp(version.publishedAt) ||
      event.at !== version.publishedAt || !Number.isInteger(eventIndex) ||
      (version.kind !== undefined && version.kind !== creation.kind)) return null;
  const issue = readSatireIssueArtifact({
    kind: version.kind ?? creation.kind,
    title: version.title ?? creation.title,
    intent: version.intent ?? creation.intent,
    html: version.html
  });
  return issue ? Object.freeze({ creation, version, event, issue, eventIndex }) : null;
}

function comic(title,intent) {
  const configured=globalThis.NGL_ASSETS?.pages;
  const originals=[{src:'/assets/comic/cover_a.jpg',label:'Cover A'},...['3','4','5','10','13'].map(n=>({src:`/assets/comic/p${n}.jpg`,label:`Original page ${n}`}))];
  const pages=(Array.isArray(configured)&&configured.length?configured:originals).map((p,i)=>typeof p==='string'?{src:p,label:i===0?'Cover':`Recovered page ${i}`} : {src:p.src||p.url,label:p.label||p.title||`Page ${i+1}`});
  const body=`<p class="note">From Damien Featherstone’s recovered No_Gas_Labs comic pages. Browse the actual artwork; missing pages remain visibly unavailable.</p><div class="controls"><button id="previous">← Previous</button><span id="page-count" aria-live="polite"></span><button id="next">Next →</button><button id="zoom">Enlarge</button></div><figure style="margin:22px auto;max-width:760px"><img id="page" alt="" style="width:100%;height:auto;border:1px solid #c8b99a;border-radius:5px;background:#efe4c9"><figcaption id="caption" class="note"></figcaption><p id="missing" hidden>That recovered page is unavailable in this copy. The reader still works; use an exhibition export that includes the original images.</p></figure><details><summary>Reading the archive</summary><p>These pages are source artifacts, not proof of the claims a character makes. A publication here creates a versioned game building; its receipt verifies the document bytes.</p></details>`;
  return documentFor(title,intent,body,`const pages=${js(pages)};let index=0,large=false;const q=id=>document.getElementById(id);function render(){const p=pages[index];q('missing').hidden=true;q('page').src=p.src;q('page').alt=p.label+' · original No_Gas_Labs comic artwork';q('caption').textContent=p.label;q('page-count').textContent=(index+1)+' / '+pages.length;q('previous').disabled=index===0;q('next').disabled=index===pages.length-1}q('page').onerror=()=>{q('missing').hidden=false};q('previous').onclick=()=>{index--;render()};q('next').onclick=()=>{index++;render()};q('zoom').onclick=()=>{large=!large;q('page').parentElement.style.maxWidth=large?'1400px':'760px';q('zoom').textContent=large?'Fit page':'Enlarge'};render();`);
}
function loom(title,intent) {
  const body=`<p>Turn a string of marks into a small piece of music. Every Unicode character chooses its own pitch. Add your words, then listen.</p><label for="score">Your score</label><textarea id="score" rows="3">No_Gas_Labs 🐚 → ∞</textarea><div class="controls" style="margin-top:15px"><button id="play">▶ Play the loom</button><button id="stop">Stop</button><button id="save">↓ Save score</button></div><div id="threads" class="card" style="font-size:29px;letter-spacing:7px;overflow-wrap:anywhere;min-height:120px" aria-hidden="true"></div><p id="status" class="status" role="status">Sound begins only when you press Play.</p>`;
  return documentFor(title,intent,body,`let context,timers=[];const q=id=>document.getElementById(id);const chars=()=>Array.from(q('score').value).slice(0,120);function render(){q('threads').replaceChildren(...chars().map(c=>{const s=document.createElement('span');s.textContent=c;s.style.color=['#ba562e','#25665e','#9c822c'][c.codePointAt(0)%3];return s}))}function stop(){timers.forEach(clearTimeout);timers=[];if(context){context.close();context=null}q('status').textContent='The loom is quiet.'}q('score').oninput=render;q('play').onclick=async()=>{stop();const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio){q('status').textContent='Web Audio is unavailable in this browser.';return}context=new Audio();await context.resume();const notes=chars();q('status').textContent='Playing '+notes.length+' Unicode notes.';notes.forEach((c,i)=>{const o=context.createOscillator(),g=context.createGain(),t=context.currentTime+i*.19;o.type='sine';o.frequency.value=130.81*Math.pow(2,(c.codePointAt(0)%24)/12);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.15,t+.015);g.gain.exponentialRampToValueAtTime(.001,t+.3);o.connect(g);g.connect(context.destination);o.start(t);o.stop(t+.32);timers.push(setTimeout(()=>{const spans=q('threads').children;for(let n=0;n<spans.length;n++)spans[n].style.background=n===i?'#eed099':''},i*190))});timers.push(setTimeout(()=>{q('status').textContent='The last thread has sounded.'},notes.length*190+350))};q('stop').onclick=stop;q('save').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({schema:'ngl.unicode-score.v1',score:q('score').value,method:'codePoint modulo 24; 130.81 Hz equal temperament; 190ms spacing'},null,2)],{type:'application/json'}));a.download='unicode-loom-score.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};render();`);
}
function observatory(title,intent) {
  const body=`<p>A place to hold a falsifiable claim beside its source, possible counterexample, uncertainty and next test. This is a local notebook: it does not fetch URLs, inspect files, call a model or adjudicate claims. Notes remain local to this open artifact. Download a backup before leaving; reopen the published Observatory and restore that file to continue. Publishing the blank template does not publish later notes.</p><div id="observations" aria-live="polite"></div><section class="card" data-ngl-native-file-surface="source-observatory-v2"><label for="claim">Claim under test</label><textarea id="claim" maxlength="1000" rows="2" placeholder="State one specific, falsifiable claim." required></textarea><label for="source-kind">Source class · author-selected</label><select id="source-kind"><option value="unspecified">Not classified</option><option value="direct-observation">Direct observation</option><option value="primary-source">Primary source / document</option><option value="secondary-source">Secondary source / analysis</option><option value="tool-output">Tool output / execution receipt</option><option value="user-report">User-reported</option><option value="model-assertion">Model assertion (lead only; not evidence)</option></select><label for="source">Source / attribution</label><input id="source" maxlength="1000" placeholder="Document, author, URL, page or observation reference" required><label for="falsifier">Possible falsifier / counterexample</label><textarea id="falsifier" maxlength="1000" rows="2" placeholder="What observation would weaken or disprove the claim?"></textarea><label for="uncertainty">Unknowns / uncertainty</label><textarea id="uncertainty" maxlength="1000" rows="2" placeholder="What remains unresolved or disputed?"></textarea><label for="next-test">Next discriminating test</label><textarea id="next-test" maxlength="1000" rows="2" placeholder="What small, observable test could resolve part of this?"></textarea><p class="note">A model assertion is a lead only, never sufficient evidence. A receipt can identify bytes without establishing the truth of their contents. Blank fields remain explicitly unrecorded.</p><div class="controls" style="margin-top:18px"><button id="add-observation">+ Add observation</button><button id="download">↓ Download evidence notes</button></div><label id="backup-file-label" for="backup-file">Choose a downloaded notebook</label><input id="backup-file" type="file" accept="application/json,.json"><p id="native-file-note" class="note" hidden>Use the native notebook controls below this artifact to save or restore a file. Preview and append are available in the accessible review panel below.</p><div class="controls" style="margin-top:12px"><button id="preview-restore" type="button">Preview backup</button><button id="restore" type="button" disabled>Append previewed notes</button></div><div id="restore-preview" class="card" hidden aria-live="polite"></div><p class="note">Preview reads and validates the backup without changing notes. Review the proposed additions and explicitly append them. Restoration skips exact six-field duplicates. The v2 format has no per-note ID, so identical content is treated as the same local entry; this does not establish source identity or truth. Imported entries remain local notes, not canonical world events.</p><p id="status" class="status" role="status"></p></section>`;
  const script=`const q=id=>document.getElementById(id);
const MAX_OBSERVATIONS=100,MAX_FIELD_CHARACTERS=500;
const sourceKindLabels=Object.freeze({
  unspecified:'Not classified',
  'direct-observation':'Direct observation',
  'primary-source':'Primary source / document',
  'secondary-source':'Secondary source / analysis',
  'tool-output':'Tool output / execution receipt',
  'user-report':'User-reported',
  'model-assertion':'Model assertion (lead only; not evidence)'
});
const observations=[];
const restoredObservations=new WeakSet();
const MAX_IMPORT_BYTES=2*1024*1024;
let previewingBackup=false;
let pendingRestore=null,pendingRestoreToken=null,restorePreviewSequence=0;
let nativeBridgeReady=false;
let nativeImport=null;
let nativeExportInProgress=false;
const PARENT_ORIGIN=typeof window.__NGL_PARENT_ORIGIN==='string'&&window.__NGL_PARENT_ORIGIN?window.__NGL_PARENT_ORIGIN:'https://appassets.androidplatform.net';
const sourceObservationAvailable=window.__NGL_SOURCE_OBSERVATION_AVAILABLE===true;
window.addEventListener('message',event=>{
  if(event.source!==window.parent||event.origin!==PARENT_ORIGIN||!event.data||typeof event.data!=='object')return;
  const message=event.data;
  if(message.type==='ngl-native-file-bridge-ready'){
    nativeBridgeReady=true;
    q('download').hidden=true;
    q('backup-file').hidden=true;
    q('backup-file-label').hidden=true;
    q('native-file-note').hidden=false;
    q('preview-restore').hidden=true;
    q('restore').hidden=true;
    q('restore-preview').hidden=true;
  }else if(message.type==='ngl-native-file-preview-request'){
    if(!nativeBridgeReady||Object.keys(message).sort().join(',')!=='generation,type'||
       message.generation!==window.__NGL_PORTAL_GENERATION)return;
    return previewBackup({generation:message.generation});
  }else if(message.type==='ngl-native-file-append-request'){
    if(!nativeBridgeReady||Object.keys(message).sort().join(',')!=='generation,previewId,type'||
       message.generation!==window.__NGL_PORTAL_GENERATION||
       typeof message.previewId!=='string'||!/^[0-9]{1,12}$/.test(message.previewId))return;
    return appendPreviewedNotes({generation:message.generation,previewId:message.previewId});
  }else if(message.type==='ngl-native-file-export-request'){
    if(nativeBridgeReady)sendNativeBackup();
  }else if(message.type==='ngl-native-file-export-verified'){
    if(!nativeBridgeReady||typeof message.sha256!=='string'||!/^[a-f0-9]{64}$/.test(message.sha256))return;
    q('status').textContent='Notebook bytes passed SHA-256 verification ('+message.sha256+'). Choose a save location. Notes remain local; no canonical event or XP was created.';
  }else if(message.type==='ngl-native-file-export-error'){
    q('status').textContent=typeof message.message==='string'&&message.message?message.message:'The Android notebook export failed integrity verification. No file was saved.';
  }else if(message.type==='ngl-native-file-import-start'){
    if(!nativeBridgeReady)return;
    if(!Number.isSafeInteger(message.size)||message.size<1||message.size>MAX_IMPORT_BYTES){
      nativeImport=null;
      q('status').textContent='Native backup exceeds the 2 MiB notebook limit. Existing notes were left unchanged.';
      return;
    }
    if(typeof message.name!=='string'||message.name.length<1||message.name.length>128||
       typeof message.sha256!=='string'||!/^[a-f0-9]{64}$/.test(message.sha256)){
      nativeImport=null;
      q('status').textContent='Native backup metadata or SHA-256 receipt was invalid. Existing notes were left unchanged.';
      return;
    }
    nativeImport={name:message.name,size:message.size,sha256:message.sha256,parts:[],received:0};
  }else if(message.type==='ngl-native-file-import-chunk'){
    if(!nativeImport||!(message.bytes instanceof ArrayBuffer)||message.bytes.byteLength<1||message.bytes.byteLength>65536||nativeImport.received+message.bytes.byteLength>nativeImport.size){
      nativeImport=null;
      q('status').textContent='Native backup transfer was malformed. Existing notes were left unchanged.';
      return;
    }
    nativeImport.parts.push(message.bytes);
    nativeImport.received+=message.bytes.byteLength;
  }else if(message.type==='ngl-native-file-import-complete'){
    const transfer=nativeImport;
    nativeImport=null;
    if(!transfer||transfer.received!==transfer.size){
      q('status').textContent='Native backup transfer was incomplete. Existing notes were left unchanged.';
      return;
    }
    try{
      const file=new File(transfer.parts,transfer.name,{type:'application/json'});
      const selection=new DataTransfer();
      selection.items.add(file);
      q('backup-file').files=selection.files;
      q('backup-file').dispatchEvent(new Event('change',{bubbles:true}));
      window.parent.postMessage({type:'ngl-native-file-import-received',name:transfer.name,size:transfer.size,sha256:transfer.sha256},'*');
      q('status').textContent='Native backup received. Transfer SHA-256 was verified. Preview the local notes before appending; their contents remain unverified.';
    }catch{
      q('status').textContent='The native backup could not be attached to the notebook. Existing notes were left unchanged.';
    }
  }else if(message.type==='ngl-native-file-import-cancelled'){
    nativeImport=null;
    q('status').textContent='Native backup selection canceled. Existing notes were left unchanged.';
  }else if(message.type==='ngl-native-file-import-error'){
    nativeImport=null;
    q('status').textContent=typeof message.message==='string'&&message.message?message.message:'Native backup could not be read. Existing notes were left unchanged.';
  }
});
function exactKeys(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const actual=Object.keys(value).sort(),expected=[...keys].sort();
  return actual.length===expected.length&&actual.every((key,index)=>key===expected[index]);
}
function requiredBackupText(value){
  return typeof value==='string'&&value.length>0&&value.trim()===value&&bounded(value);
}
function optionalBackupText(value){
  if(value===null)return null;
  return requiredBackupText(value)?value:undefined;
}
function restoreBackup(value){
  if(!exactKeys(value,['schema','assurance','observations'])||value.schema!=='ngl.source-observatory.v2')return null;
  if(!exactKeys(value.assurance,['sourceRetrieval','independentVerification','modelAssertions','execution']))return null;
  if(value.assurance.sourceRetrieval!=='NOT_PERFORMED'||
     value.assurance.independentVerification!=='NOT_PERFORMED'||
     value.assurance.modelAssertions!=='LEADS_ONLY'||
     value.assurance.execution!=='NOT_EXECUTED')return null;
  if(!Array.isArray(value.observations)||value.observations.length<1||value.observations.length>MAX_OBSERVATIONS)return null;
  const restored=[];
  for(const item of value.observations){
    if(!exactKeys(item,['claim','source','sourceKind','falsifier','uncertainty','nextTest'])||
       !requiredBackupText(item.claim)||!requiredBackupText(item.source)||
       typeof item.sourceKind!=='string'||!Object.hasOwn(sourceKindLabels,item.sourceKind))return null;
    const falsifier=optionalBackupText(item.falsifier);
    const uncertainty=optionalBackupText(item.uncertainty);
    const nextTest=optionalBackupText(item.nextTest);
    if(falsifier===undefined||uncertainty===undefined||nextTest===undefined)return null;
    restored.push({claim:item.claim,source:item.source,sourceKind:item.sourceKind,falsifier,uncertainty,nextTest});
  }
  return restored;
}
function observationContentKey(item){
  return JSON.stringify([item.claim,item.source,item.sourceKind,item.falsifier,item.uncertainty,item.nextTest]);
}
function bounded(value){return typeof value==='string'&&Array.from(value).length<=MAX_FIELD_CHARACTERS}
function clearRestorePreview(message=''){
  pendingRestore=null;
  pendingRestoreToken=null;
  q('restore').disabled=true;
  q('restore-preview').hidden=true;
  q('restore-preview').replaceChildren();
  if(message)q('status').textContent=message;
}
function classifyImport(restored){
  const knownContent=new Set(observations.map(observationContentKey));
  const additions=[];
  for(const item of restored){
    const key=observationContentKey(item);
    if(knownContent.has(key))continue;
    knownContent.add(key);
    additions.push(item);
  }
  return {additions,duplicateCount:restored.length-additions.length};
}
function renderRestorePreview(additions,duplicateCount){
  const preview=q('restore-preview');
  const heading=document.createElement('h3');
  heading.textContent='Review local notebook import';
  const summary=document.createElement('p');
  const exceeds=observations.length+additions.length>MAX_OBSERVATIONS;
  summary.textContent=exceeds
    ?'Blocked: '+additions.length+' new note(s) plus '+observations.length+' existing would exceed the '+MAX_OBSERVATIONS+'-note limit. No notes will be appended.'
    :'Ready to append '+additions.length+' new note(s); skip '+duplicateCount+' exact-content duplicate(s). Current notebook: '+observations.length+'/'+MAX_OBSERVATIONS+'.';
  const disclosure=document.createElement('p');
  disclosure.className='note';
  disclosure.textContent='Preview only. Backup text and source classifications are user-supplied declarations; they are not independently verified and do not become canonical evidence.';
  const list=document.createElement('ol');
  for(const item of additions){
    const entry=document.createElement('li');
    entry.textContent=item.claim+' — '+sourceKindLabels[item.sourceKind]+' · source: '+item.source;
    list.append(entry);
  }
  if(!additions.length){
    const empty=document.createElement('p');
    empty.textContent='No new observations to append. The selected backup contains only exact six-field matches.';
    preview.replaceChildren(heading,summary,disclosure,empty);
  }else{
    preview.replaceChildren(heading,summary,disclosure,list);
  }
  preview.hidden=nativeBridgeReady;
  q('restore').disabled=exceeds||additions.length===0;
}
function render(){
  if(!observations.length){
    const empty=document.createElement('p');
    empty.className='note';
    empty.textContent='No observations recorded. The Observatory does not invent a starter claim or source.';
    q('observations').replaceChildren(empty);
    return;
  }
  q('observations').replaceChildren(...observations.map((item,index)=>{
    const card=document.createElement('article');card.className='card';
    const heading=document.createElement('h2');heading.textContent=(index+1)+'. '+item.claim;
    const restored=restoredObservations.has(item);
    const kind=document.createElement('p');kind.className='note';kind.textContent='Source class: '+sourceKindLabels[item.sourceKind]+' · '+(restored?'declared in backup; not independently verified':'selected in this artifact');
    const source=document.createElement('p');source.textContent='Source: '+item.source;
    const falsifier=document.createElement('p');falsifier.textContent='Possible falsifier: '+(item.falsifier||'Not recorded');
    const uncertainty=document.createElement('p');uncertainty.textContent='Unknown / uncertainty: '+(item.uncertainty||'Not recorded');
    const nextTest=document.createElement('p');nextTest.textContent='Next test: '+(item.nextTest||'Not recorded');
    const attribution=document.createElement('p');attribution.className='note';attribution.textContent=restored
      ?'Restored from a user-selected backup · original authorship not independently verified'
      :'Entered in this open artifact · not independently verified';
    card.append(heading,kind,source,falsifier,uncertainty,nextTest,attribution);
    if(item.sourceKind==='model-assertion'||item.sourceKind==='tool-output'){
      const warning=document.createElement('p');warning.className='status';
      warning.textContent=item.sourceKind==='model-assertion'
        ?'Model assertion: lead only, not evidence.'
        :'Tool output: attributed output, not independent verification or a truth verdict.';
      card.append(warning);
    }
    if(sourceObservationAvailable){
      const prepare=document.createElement('button');
      prepare.type='button';
      prepare.dataset.sourceObservationPrepare='true';
      prepare.textContent='Prepare shared Chronicle entry →';
      prepare.onclick=()=>{
        window.parent.postMessage({type:'ngl-source-observation-prepare',backup:buildBackup([item])},'*');
        q('status').textContent='Prepared for shared Chronicle review. Nothing has been shared; review and explicitly submit. The new event will be attributed to your current session.';
      };
      card.append(prepare);
    }
    return card;
  }));
}
q('add-observation').onclick=()=>{
  const claim=q('claim').value.trim(),source=q('source').value.trim();
  const falsifier=q('falsifier').value.trim(),uncertainty=q('uncertainty').value.trim(),nextTest=q('next-test').value.trim();
  const values=[claim,source,falsifier,uncertainty,nextTest];
  if(!claim||!source){q('status').textContent='A claim and its source or attribution are required. Other fields may remain blank.';return}
  if(values.some(value=>!bounded(value))){q('status').textContent='Each field is limited to 500 Unicode code points.';return}
  if(observations.length>=MAX_OBSERVATIONS){q('status').textContent='The local notebook holds at most 100 observations. Download it before starting another.';return}
  const sourceKind=q('source-kind').value;
  if(!Object.hasOwn(sourceKindLabels,sourceKind)){q('status').textContent='Choose a listed source class.';return}
  const previewInvalidated=Boolean(pendingRestore);
  if(previewInvalidated)clearRestorePreview();
  observations.push({
    claim,source,sourceKind,
    falsifier:falsifier||null,
    uncertainty:uncertainty||null,
    nextTest:nextTest||null
  });
  for(const id of ['claim','source','falsifier','uncertainty','next-test'])q(id).value='';
  q('source-kind').value='unspecified';
  q('status').textContent=previewInvalidated
    ?'Observation added to this open artifact. The previous backup preview was invalidated; preview again before appending. No source was fetched or independently verified.'
    :'Observation added to this open artifact. No source was fetched or independently verified.';
  render();
};
function buildBackup(selectedObservations=observations){
  return {
    schema:'ngl.source-observatory.v2',
    assurance:{
      sourceRetrieval:'NOT_PERFORMED',
      independentVerification:'NOT_PERFORMED',
      modelAssertions:'LEADS_ONLY',
      execution:'NOT_EXECUTED'
    },
    observations:selectedObservations.map(item=>({...item}))
  };
}
async function sendNativeBackup(){
  if(!nativeBridgeReady||nativeExportInProgress)return;
  nativeExportInProgress=true;
  try{
    const bytes=new TextEncoder().encode(JSON.stringify(buildBackup(),null,2));
    if(bytes.byteLength>MAX_IMPORT_BYTES)throw new Error('The notebook exceeds the native backup limit.');
    window.parent.postMessage({type:'ngl-native-file-export-start',name:'source-observatory.json',mime:'application/json',size:bytes.byteLength},'*');
    for(let offset=0;offset<bytes.byteLength;offset+=65536){
      const chunk=bytes.slice(offset,Math.min(offset+65536,bytes.byteLength)).buffer;
      window.parent.postMessage({type:'ngl-native-file-export-chunk',bytes:chunk},'*',[chunk]);
    }
    window.parent.postMessage({type:'ngl-native-file-export-complete'},'*');
    q('status').textContent='Notebook backup queued for SHA-256 verification before the Android save picker. Notes remain local; no canonical event or XP was created.';
  }catch{
    q('status').textContent='The native backup could not be prepared. Existing notes were left unchanged.';
  }finally{
    nativeExportInProgress=false;
  }
}
q('download').onclick=()=>{
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(buildBackup(),null,2)],{type:'application/json'}));
  a.download='source-observatory.json';a.click();
  q('status').textContent='Evidence notes downloaded. No source was retrieved, verified or adjudicated.';
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
q('backup-file').onchange=()=>{
  clearRestorePreview('Backup selection changed. Preview the selected file before appending.');
};
async function previewBackup({generation=null}={}){
  if(previewingBackup)return false;
  previewingBackup=true;
  pendingRestoreToken=null;
  q('preview-restore').disabled=true;
  q('restore').disabled=true;
  q('backup-file').disabled=true;
  clearRestorePreview();
  let parentResult={previewId:null,canAppend:false,duplicateCount:0,additions:[]};
  try{
    const file=q('backup-file').files?.[0];
    if(!file){q('status').textContent='Choose a previously downloaded Source Observatory JSON backup first.';return false;}
    if(!Number.isSafeInteger(file.size)||file.size<0||file.size>MAX_IMPORT_BYTES){
      q('status').textContent='Backup file must be no larger than 2 MiB. No notes were imported.';return false;
    }
    let raw;
    try{
      if(typeof file.text!=='function')throw new Error('File text reading is unavailable');
      raw=await file.text();
    }catch{
      q('status').textContent='The selected backup could not be read. Existing notes were left unchanged.';return false;
    }
    if(typeof raw!=='string'||new Blob([raw]).size>MAX_IMPORT_BYTES){
      q('status').textContent='Backup content exceeds 2 MiB. Existing notes were left unchanged.';return false;
    }
    let parsed;
    try{parsed=JSON.parse(raw)}catch{
      q('status').textContent='The selected file is not valid JSON. Existing notes were left unchanged.';return false;
    }
    const restored=restoreBackup(parsed);
    if(!restored){
      q('status').textContent='Backup schema or assurance is not supported. Existing notes were left unchanged.';return false;
    }
    pendingRestore=restored;
    const {additions,duplicateCount}=classifyImport(restored);
    renderRestorePreview(additions,duplicateCount);
    let canAppend=false;
    if(!additions.length){
      q('status').textContent='No new notes: all '+duplicateCount+' imported observation(s) exactly match existing six-field content. No append is needed; v2 has no per-note IDs, so identical content is treated as the same note.';
    }else if(observations.length+additions.length>MAX_OBSERVATIONS){
      q('status').textContent='Preview blocked: import would exceed the 100-observation limit. Existing notes were left unchanged.';
    }else{
      q('status').textContent='Preview ready: '+additions.length+' new note(s); skipped '+duplicateCount+' exact-content duplicate(s). Review the list, then append explicitly.';
      canAppend=true;
      pendingRestoreToken=String(++restorePreviewSequence);
    }
    parentResult={
      previewId:canAppend?pendingRestoreToken:null,
      canAppend,
      duplicateCount,
      additions:additions.map(item=>({...item}))
    };
    return true;
  }finally{
    previewingBackup=false;
    q('preview-restore').disabled=false;
    q('backup-file').disabled=false;
    if(nativeBridgeReady&&Number.isSafeInteger(generation)&&generation===window.__NGL_PORTAL_GENERATION){
      window.parent.postMessage({
        type:'ngl-native-file-preview-result',
        generation,
        ...parentResult,
        status:q('status').textContent.slice(0,500)
      },'*');
    }
  }
}
q('preview-restore').onclick=()=>previewBackup();
function appendPreviewedNotes({generation=null,previewId=null}={}){
  if(!pendingRestore||previewingBackup)return false;
  if(generation!==null&&(!nativeBridgeReady||generation!==window.__NGL_PORTAL_GENERATION||previewId!==pendingRestoreToken))return false;
  const responsePreviewId=pendingRestoreToken;
  const {additions,duplicateCount}=classifyImport(pendingRestore);
  let addedCount=0;
  if(!additions.length){
    clearRestorePreview('No new notes: the selected backup contains only exact six-field matches. No notes were appended.');
    q('backup-file').value='';
  }else if(observations.length+additions.length>MAX_OBSERVATIONS){
    clearRestorePreview('Append blocked: the notebook changed after preview and the import would exceed the 100-observation limit. Existing notes were left unchanged.');
  }else{
    additions.forEach(item=>restoredObservations.add(item));
    observations.push(...additions);
    addedCount=additions.length;
    q('backup-file').value='';
    clearRestorePreview();
    render();
    q('status').textContent='Added '+additions.length+' local observation(s); skipped '+duplicateCount+' exact-content duplicate(s). Source retrieval and independent verification remain NOT_PERFORMED; imported notes are not canonical events, evidence, XP or approval.';
  }
  if(generation!==null){
    window.parent.postMessage({
      type:'ngl-native-file-append-result',
      generation,
      previewId:responsePreviewId,
      addedCount,
      duplicateCount,
      status:q('status').textContent.slice(0,500)
    },'*');
  }
  return true;
}
q('restore').onclick=()=>appendPreviewedNotes();
render();`;
  return documentFor(title,intent,body,script);
}
function custom(title,intent,html) {
  if(html?.trim()) {
    const satireIntent = typeof intent === 'string' &&
      [SATIRE_ISSUE_INTENT_PREFIX, SATIRE_ISSUE_FOLLOW_UP_INTENT_PREFIX]
        .some(prefix => intent.startsWith(prefix));
    if(satireIntent) {
      const issue=readSatireIssueDocument(html);
      const expectedPrefix=satireIntentPrefix(issue);
      if(!issue||!expectedPrefix||!intent.startsWith(expectedPrefix)||html!==buildSatireIssueBody(issue)) {
        throw Object.assign(new Error('A Publication House issue must exactly match its canonical rendered body, schema and embedded metadata.'),{code:'INVALID_SATIRE_ISSUE',status:400});
      }
    }
    return documentFor(title,intent,`<section>${html}</section>`);
  }
  return documentFor(title,intent,`<p>This is a portable AI work request, ready to carry to a provider you choose. It does not contact or claim to run an AI.</p><label for="request">Your request</label><textarea id="request" rows="7">${esc(intent||'Explore a useful, falsifiable improvement to this institution. State assumptions, source evidence, uncertainty and a testable next step.')}</textarea><button id="download" style="margin-top:18px">↓ Carry this request</button><p id="status" class="status" role="status"></p>`,`document.getElementById('download').onclick=()=>{const request={schema:'ngl.portable-request.v1',title:${js(title)},request:document.getElementById('request').value,constraints:['No fabricated execution or citations','State uncertainty','Return a reviewable proposal; no authority to publish'],execution:'Not executed; portable request only'};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(request,null,2)],{type:'application/json'}));a.download='portable-ai-request.json';a.click();document.getElementById('status').textContent='Request prepared. No provider was contacted.';setTimeout(()=>URL.revokeObjectURL(a.href),1000)};`);
}

export function createArtifact({kind,title,intent='',html='',version=1}) {
  const maker={comic,loom,observatory,custom}[kind];
  if(!maker)throw Object.assign(new Error('Unknown creation recipe.'),{code:'INVALID_KIND',status:400});
  const output=maker(title,intent,html,version);
  return {html:output,checks:[{id:'document',label:'Complete playable HTML document',passed:output.startsWith('<!doctype html>')},{id:'sandbox-policy',label:'No network requests or form submission',passed:output.includes("connect-src 'none'")&&output.includes("form-action 'none'")},{id:'authored',label:'Authored recipe; no live AI claim',passed:true}]};
}
