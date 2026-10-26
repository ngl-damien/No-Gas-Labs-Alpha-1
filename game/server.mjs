import http from 'node:http';
import { readFile, mkdir, open } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createWorld, applyAction, publicWorld, validateWorld } from './model.mjs';
import { applyEvent, replayKernel, artifactReceipt, canonicalStringify } from '../src/institution/kernel.mjs';
import { createServiceStore } from './service-store.mjs';
import { forgeCapabilities } from '../src/forge/runner.mjs';
import { openDecisions } from '../src/institution/decisions.mjs';
import { projectProjection } from '../src/institution/project-projection.mjs';

const gameDir = dirname(fileURLToPath(import.meta.url));
const CONFIG = Object.freeze({ founderId: 'damien', actors: [
  { id: 'damien', roles: ['founder'], kind: 'human' },
  { id: 'local-forge', roles: ['executor'], kind: 'local-process' },
  { id: 'local-byte-verifier', roles: ['observer'], kind: 'local-process' }
] });
const MAX_BODY = 256 * 1024;
const COOKIE = 'ngl_session';
const SESSION_TTL = 24 * 60 * 60 * 1000;
const ARTIFACT_CSP = "default-src 'none'; sandbox allow-scripts allow-forms allow-downloads; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'self' about:";
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ...['client', 'quests', 'character-sheet', 'world-view', 'model', 'artifacts', 'launchpad', 'institution-view', 'dissent-docket'].map(name => [`/${name}.mjs`, [`${name}.mjs`, 'text/javascript; charset=utf-8']]),
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ...['cover_a', 'p3', 'p4', 'p5', 'p10', 'p13'].map(name => [`/assets/comic/${name}.jpg`, [`assets/comic/${name}.jpg`, 'image/jpeg']])
]);
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const exact = (value, fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) fail('INVALID_FIELDS', 'Unexpected request fields.');
};
const actionFields = {
  draft: ['type', 'kind', 'title', 'intent', 'html'], publish: ['type', 'draftId', 'expectedVersion'],
  repair: ['type', 'creationId', 'expectedVersion', 'intent', 'html'],
  contribute: ['type', 'creationId', 'version', 'text'], report: ['type', 'creationId', 'version', 'text'], discover: ['type', 'locationId']
};
const snapshots = world => world.creations.flatMap(creation => [...creation.versions, creation]);
const bytesMap = artifacts => new Map(Object.entries(artifacts).map(([hash, bytes]) => [hash, Buffer.from(bytes, 'base64')]));


function validateHistory(world) {
  if (world.revision !== world.events.length || world.createdAt > world.updatedAt || (world.events.length && world.updatedAt !== world.events.at(-1).at) || (!world.events.length && world.updatedAt !== world.createdAt)) throw new Error('World history integrity mismatch');
  const details = { draft: ['draftId'], repair: ['creationId', 'draftId', 'baseVersion'], publish: ['creationId', 'version', 'reward'], contribute: ['creationId', 'version'], report: ['creationId', 'version'], discover: ['locationId'] };
  const notes = { contribute: [...world.contributions], report: [...world.reports], discover: [...world.discoveries] };
  const published = snapshots(world);
  const drafts = new Map();
  let previousAt = world.createdAt;
  for (const event of world.events) {
    if (!Object.hasOwn(details, event.type)) throw new Error('Unknown stored world history event');
    exact(event, ['id', 'type', 'actor', 'at', 'semantics', ...details[event.type]]);
    exact(event.actor, ['id', 'name', 'role']);
    if (event.at < previousAt || (event.actor.role === 'founder' && event.actor.id !== CONFIG.founderId) || (['draft', 'repair', 'publish'].includes(event.type) && (event.actor.role !== 'founder' || event.actor.id !== CONFIG.founderId))) throw new Error('Stored world history authority / time mismatch');
    previousAt = event.at;
    if (event.type === 'draft' || event.type === 'repair') {
      if (typeof event.draftId !== 'string' || drafts.has(event.draftId)) throw new Error('Stored draft history mismatch');
      if (event.type === 'repair' && (!Number.isInteger(event.baseVersion) || !published.some(p => p.id === event.creationId && p.version === event.baseVersion && p.publishedAt <= event.at))) throw new Error('Stored repair version history mismatch');
      drafts.set(event.draftId, event);
    }
    if (event.type === 'publish' && !published.some(p => p.id === event.creationId && p.version === event.version && p.publishedAt === event.at)) throw new Error('Stored publication history mismatch');
    if (Object.hasOwn(notes, event.type)) {
      const index = notes[event.type].findIndex(note => note.at === event.at && canonicalStringify(note.actor) === canonicalStringify(event.actor) && (event.type === 'discover' ? note.locationId === event.locationId : note.creationId === event.creationId && note.version === event.version));
      if (index < 0) throw new Error('Stored contribution / discovery history mismatch');
      notes[event.type].splice(index, 1);
    }
  }
  for (const draft of world.drafts) {
    const event = drafts.get(draft.id);
    if (!event || event.at !== draft.createdAt || (event.type === 'repair' ? event.creationId !== draft.creationId || event.baseVersion !== draft.baseVersion : draft.creationId !== null || draft.baseVersion !== 0)) throw new Error('Stored private draft history mismatch');
  }
  if (Object.values(notes).some(entries => entries.length)) throw new Error('Orphan stored world history record');
  const revisions = published.filter(publication => publication.version > 1);
  if (revisions.length !== world.methods.length) throw new Error('Earned repair method history mismatch');
  for (const publication of revisions) {
    const matching = world.methods.filter(method => method.creationId === publication.id && method.version === publication.version);
    const event = world.events.find(event => event.type === 'publish' && event.creationId === publication.id && event.version === publication.version);
    if (matching.length !== 1) throw new Error('Duplicate or missing earned repair method');
    const method = matching[0]; exact(method, ['id', 'creationId', 'version', 'title', 'description', 'actor', 'at', 'semantics']);
    if (!event || method.at !== event.at || canonicalStringify(method.actor) !== canonicalStringify(event.actor) || method.title !== `Repair ${publication.title} · v${publication.version}` || method.description !== (publication.intent || 'Publish a checked revision while preserving the prior version and its exact bytes.') || method.semantics !== 'Earned game method: a retained, checked repair; no external truth or authority claim.') throw new Error('Earned repair method publication binding mismatch');
  }

}

async function validatePayload(raw) {
  exact(raw, ['world', 'institutionalEvents', 'artifacts', 'publicationBindings']);
  const world = await validateWorld(raw.world);
  validateHistory(world);
  if (!Array.isArray(raw.institutionalEvents) || !Array.isArray(raw.publicationBindings) || !raw.artifacts || typeof raw.artifacts !== 'object' || Array.isArray(raw.artifacts)) throw new Error('Corrupt institutional store');
  for (const [hash, bytes] of Object.entries(raw.artifacts)) {
    if (!/^[a-f0-9]{64}$/.test(hash) || typeof bytes !== 'string' || Buffer.from(bytes, 'base64').toString('base64') !== bytes || artifactReceipt(Buffer.from(bytes, 'base64')).digest !== hash) throw new Error('Artifact blob integrity mismatch');
  }
  const artifacts = bytesMap(raw.artifacts);
  const kernel = replayKernel(raw.institutionalEvents, CONFIG, { artifacts });
  const all = snapshots(world);
  if (all.length !== raw.publicationBindings.length || Object.values(kernel.works).length !== all.length || kernel.events.length !== all.length * 5) throw new Error('Publication institutional history mismatch');
  const bindings = new Set();
  for (const publication of all) {
    const key = `${publication.id}:${publication.version}`;
    const matches = raw.publicationBindings.filter(b => b.creationId === publication.id && b.version === publication.version);
    if (matches.length !== 1 || bindings.has(key)) throw new Error('Duplicate or missing publication binding');
    bindings.add(key);
    const binding = matches[0]; exact(binding, ['creationId', 'version', 'digest', 'size', 'workId']);
    const work = kernel.works[binding.workId];
    const bytes = artifacts.get(binding.digest);
    if (!work || work.stage !== 'accepted' || work.action !== 'preserve-artifact-bytes' || work.subject.id !== publication.id || work.subject.version !== publication.version || work.outputs.length !== 1 || canonicalStringify(work.outputs[0]) !== canonicalStringify(publication.receipt) || publication.receipt.digest !== binding.digest || publication.receipt.size !== binding.size || !bytes || !bytes.equals(Buffer.from(publication.html, 'utf8'))) throw new Error('Publication receipt / version binding mismatch');
    const history = kernel.events.filter(event => event.workId === work.id);
    if (history.map(event => event.type).join(',') !== 'claim,authorize,execute,observe,adjudicate') throw new Error('Publication stage history mismatch');
    const gameEvents = world.events.filter(event => event.type === 'publish' && event.creationId === publication.id && event.version === publication.version);
    if (gameEvents.length !== 1 || gameEvents[0].actor.id !== CONFIG.founderId || gameEvents[0].actor.role !== 'founder' || gameEvents[0].reward !== 100) throw new Error('Publication game history binding mismatch');
  }
  return { world, institutionalEvents: structuredClone(raw.institutionalEvents), artifacts: structuredClone(raw.artifacts), publicationBindings: structuredClone(raw.publicationBindings) };
}
function publicationCandidate(payload, world, result) {
  const creation = world.creations.find(item => item.id === result.creationId);
  const artifacts = { ...payload.artifacts, [creation.receipt.digest]: Buffer.from(creation.html, 'utf8').toString('base64') };
  const available = bytesMap(artifacts);
  let kernel = replayKernel(payload.institutionalEvents, CONFIG, { artifacts: available });
  const workId = `publication-${randomUUID()}`, grantId = `grant-${randomUUID()}`, executionId = `preserve-${randomUUID()}`;
  const subject = { id: creation.id, version: creation.version }, outputs = [artifactReceipt(Buffer.from(creation.html, 'utf8'))];
  const at = new Date(Math.max(Date.now(), Date.parse(kernel.events.at(-1)?.at || 0))).toISOString();
  const append = (type, actor, fields) => {
    const event = { id: `institution-${randomUUID()}`, type, actor, at, expectedRevision: kernel.revision, workId, ...fields };
    kernel = applyEvent(kernel, event, { artifacts: available }); return event;
  };
  append('claim', 'local-forge', { subject, action: 'preserve-artifact-bytes' });
  append('authorize', 'damien', { grantId, executorId: 'local-forge', observerId: 'local-byte-verifier', scope: { subjectId: subject.id, subjectVersion: subject.version, action: 'preserve-artifact-bytes' } });
  append('execute', 'local-forge', { grantId, executionId, subject, outputs });
  const observed = append('observe', 'local-byte-verifier', { grantId, executionId, subject, outputs, passed: true, checks: [{ id: 'exact-local-bytes', passed: true, detail: 'This service recomputed the preserved UTF-8 SHA-256 receipt under a distinct configured local verifier identity. This is local byte verification, not an independent human review or usefulness judgment.' }] });
  append('adjudicate', 'damien', { grantId, executionId, subject, outputs, observationId: observed.id, decision: 'accept' });
  return { world, artifacts, institutionalEvents: kernel.events, publicationBindings: [...payload.publicationBindings, { creationId: creation.id, version: creation.version, digest: creation.receipt.digest, size: creation.receipt.size, workId }] };
}
async function getFounderKey(dataDir, provided) {
  if (provided !== undefined) {
    if (typeof provided !== 'string' || provided.length < 16 || Buffer.byteLength(provided) > 1024) throw new Error('Founder key must be 16–1024 bytes');
    return provided;
  }
  const path = join(dataDir, 'founder.key');
  try { const key = (await readFile(path, 'utf8')).trim(); if (key.length < 32 || key.length > 1024) throw new Error('Invalid persisted Founder key'); return key; }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const key = randomBytes(32).toString('base64url');
    try { const file = await open(path, 'wx', 0o600); try { await file.writeFile(key + '\n'); await file.sync(); } finally { await file.close(); } return key; }
    catch (writeError) { if (writeError.code === 'EEXIST') return getFounderKey(dataDir); throw writeError; }
  }
}

/** Local HTTP host. Authority comes only from its ephemeral authenticated sessions. */
export async function createGameServer({ dataDir = resolve(gameDir, '../.runtime'), founderKey = process.env.NGL_FOUNDER_KEY, institutionReport = null } = {}) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const key = await getFounderKey(dataDir, founderKey);
  const forge = forgeCapabilities();
  const store = await createServiceStore({ dataDir, initial: { world: createWorld(), institutionalEvents: [], artifacts: {}, publicationBindings: [] }, validate: validatePayload });
  let decisions,projects;
  try{projects=projectProjection(institutionReport);decisions=await openDecisions({directory:join(dataDir,'decisions')});}catch(error){await store.close();throw error;}
  let kernel = replayKernel(store.value.institutionalEvents, CONFIG, { artifacts: bytesMap(store.value.artifacts) });
  let closing = false, serial = Promise.resolve();
  const sessions = new Map(), streams = new Set(), presence = new Map();
  const enqueue = operation => { const result = serial.then(operation); serial = result.catch(() => {}); return result; };
  function institution() {
    return {
      schema: 'ngl.shared-institution-summary.v1',
      kernel: { schema: kernel.schema, revision: kernel.revision, eventCount: kernel.events.length, actors: CONFIG.actors, accepted: Object.values(kernel.works).filter(work => work.stage === 'accepted').map(work => ({ workId: work.id, subject: work.subject, action: work.action, stage: work.stage, outputs: work.outputs, executorId: 'local-forge', observerId: work.observedBy, adjudicatedBy: 'damien' })), events: kernel.events },
      capabilities: { externalProviders: { configured: false, detail: 'No authenticated external AI providers are configured by this service.' }, courier: { available: true, configured: false, detail: 'Signed file courier is available through the CLI; this server does not dispatch external providers.' }, forge: { available: true, transport: 'local-cli', ...forge, detail: 'Bounded local-process Forge CLI is available; no shell commands are accepted by HTTP.' } },
      limitations: ['The executor and byte verifier are distinct local process identities in one service, not independent humans or independent AI providers.', 'Accepted preservation verifies exact published bytes; it does not establish usefulness, truth, demand, revenue or public deployment.']
    };
  }
  const livePresence = () => [...presence.values()];
  const dto = session => ({ world: publicWorld(store.value.world, session.actor), viewer: { ...session.actor, presenceId: session.presenceId }, presence: livePresence(), mode: 'shared', institution: institution() });
  const sendEvent = (stream, type, value) => { if (!stream.response.destroyed && !stream.response.writableEnded) stream.response.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`); };
  const broadcastPresence = () => { const list = livePresence(); for (const stream of streams) sendEvent(stream, 'presence', list); };
  const broadcastWorld = () => { for (const stream of streams) sendEvent(stream, 'world', dto(stream.session)); };
  const witness = () => ({ id: `witness-${randomUUID()}`, name: 'Witness', role: 'witness' });
  function expireSession(token, session) {
    presence.delete(session.token); session.actor = witness(); session.lastSeen = Date.now();
    for (const stream of [...streams]) if (stream.session === session) { sendEvent(stream, 'world', dto(session)); stream.response.end(); }
    broadcastPresence();
    if (token) sessions.delete(token);
  }
  function sessionFor(request, response) {
    const token = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    let session = token && sessions.get(token);
    if (session && Date.now() - session.lastSeen > SESSION_TTL) { expireSession(token, session); session = null; }
    if (!session) {
      if (sessions.size >= 512) { const oldest = sessions.entries().next().value; expireSession(...oldest); }
      const id = randomBytes(32).toString('base64url'); session = { token: id, presenceId: `presence-${randomUUID()}`, actor: witness(), lastSeen: Date.now() }; sessions.set(id, session);
      response.setHeader('Set-Cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict${request.socket.encrypted ? '; Secure' : ''}`);
    }
    session.lastSeen = Date.now(); return session;
  }
  function rotate(request, response, previous, actor) {
    expireSession(previous.token, previous);
    const token = randomBytes(32).toString('base64url'); const session = { token, presenceId: `presence-${randomUUID()}`, actor, lastSeen: Date.now() }; sessions.set(token, session);
    response.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${request.socket.encrypted ? '; Secure' : ''}`);
    return session;
  }
  function json(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
  function sameOrigin(request) {
    const origin = request.headers.origin;
    if (request.headers['sec-fetch-site'] === 'cross-site') fail('CROSS_ORIGIN', 'Cross-origin writes are rejected.', 403);
    if (origin) {
      let parsed; try { parsed = new URL(origin); } catch { fail('CROSS_ORIGIN', 'Invalid request origin.', 403); }
      const expected = `${request.socket.encrypted ? 'https' : 'http'}://${request.headers.host}`;
      if (parsed.origin !== expected || origin !== parsed.origin) fail('CROSS_ORIGIN', 'Cross-origin writes are rejected.', 403);
    }
  }
  async function body(request) {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) fail('CONTENT_TYPE', 'Use application/json.', 415);
    if (Number(request.headers['content-length']) > MAX_BODY) fail('TOO_LARGE', 'JSON body exceeds 256 KiB.', 413);
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) fail('TOO_LARGE', 'JSON body exceeds 256 KiB.', 413); chunks.push(chunk); }
    let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('INVALID_JSON', 'Malformed JSON body.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_JSON', 'Request body must be an object.');
    return value;
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    try {
      if (closing) return json(response, 503, { error: { code: 'CLOSING', message: 'Server is closing.' } });
      const url = new URL(request.url, 'http://local.invalid'), path = url.pathname;
      if (request.method === 'GET' && STATIC.has(path)) {
        const [file, type] = STATIC.get(path);
        if (type === 'image/jpeg') response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        const content = await readFile(join(gameDir, file));
        response.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'" }); response.end(content); return;
      }
      if (!path.startsWith('/api/')) return json(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
      let session = sessionFor(request, response);
      if (request.method === 'GET') {
        if(path==='/api/projects')return json(response,200,projects);
        if(path==='/api/decisions')return json(response,200,await decisions.snapshot({id:session.actor.id,role:session.actor.role}));
        if (path === '/api/state' || path === '/api/export') return json(response, 200, dto(session));
        if (path === '/api/institution') return json(response, 200, institution());
        if (path === '/api/events') {
          if (streams.size >= 128) fail('STREAM_LIMIT', 'Too many active streams.', 429);
          response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' }); response.flushHeaders();
          const stream = { response, session }; streams.add(stream); sendEvent(stream, 'world', dto(session));
          const heartbeat = setInterval(() => { if (!response.destroyed) response.write(': keepalive\n\n'); }, 20000); heartbeat.unref();
          response.on('close', () => { clearInterval(heartbeat); streams.delete(stream); if (![...streams].some(other => other.session === session) && presence.delete(session.token)) broadcastPresence(); }); return;
        }
        const match = /^\/api\/artifacts\/(creation-[a-zA-Z0-9-]+)$/.exec(path);
        if (match) {
          const creation = store.value.world.creations.find(item => item.id === match[1]);
          const versionText = url.searchParams.get('version');
          if (versionText !== null && !/^[1-9]\d*$/.test(versionText)) fail('INVALID_VERSION', 'Invalid artifact version.');
          const version = versionText === null ? creation?.version : Number(versionText);
          const artifact = creation && (creation.version === version ? creation : creation.versions.find(item => item.version === version));
          if (!artifact) fail('NOT_FOUND', 'Published artifact not found.', 404);
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': ARTIFACT_CSP, 'x-artifact-sha256': artifact.receipt.digest }); response.end(artifact.html); return;
        }
        fail('NOT_FOUND', 'Not found.', 404);
      }
      if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
      sameOrigin(request); const input = await body(request);
      if(['/api/decisions/policy','/api/decisions/proposals','/api/decisions/choose'].includes(path)){
        if(session.actor.role!=='founder'||session.actor.id!=='damien')fail('FORBIDDEN','Only the authenticated Founder can operate the decision Gate.',403);
        return await enqueue(async()=>{if(session.actor.role!=='founder'||session.actor.id!=='damien')fail('FORBIDDEN','Founder session is no longer authorized.',403);try{const method=path.endsWith('/policy')?'setPolicy':path.endsWith('/proposals')?'create':'decide';return json(response,200,await decisions[method]({id:session.actor.id,role:session.actor.role},input));}catch(error){if(error.code)error.status=/FORBIDDEN|FOUNDER_REQUIRED|CREATOR_REQUIRED/.test(error.code)?403:/EXPIRED|REPLAY|REVISION|CONFLICT/.test(error.code)?409:400;throw error;}});
      }
      if (path === '/api/login') {
        exact(input, ['key', 'name']);
        if (typeof input.key !== 'string' || Buffer.byteLength(input.key) > 1024) fail('UNAUTHENTICATED', 'Founder key did not match.', 401);
        const candidate = Buffer.from(input.key), expected = Buffer.from(key);
        if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) fail('UNAUTHENTICATED', 'Founder key did not match.', 401);
        if (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim() || Array.from(input.name).length > 80)) fail('INVALID_NAME', 'Name must be 1–80 characters.');
        session = rotate(request, response, session, { id: 'damien', name: input.name?.trim() || store.value.world.founderName, role: 'founder' }); return json(response, 200, dto(session));
      }
      if (path === '/api/logout') { exact(input, []); session = rotate(request, response, session, witness()); return json(response, 200, dto(session)); }
      if (path === '/api/presence') {
        exact(input, ['x', 'y', 'name']);
        if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.x > 1600 || input.y < 0 || input.y > 1000 || (input.name !== undefined && (typeof input.name !== 'string' || Array.from(input.name).length > 80))) fail('INVALID_PRESENCE', 'Presence must be within the world bounds.');
        if ([...streams].some(stream => stream.session === session)) { presence.set(session.token, { id: session.presenceId, name: input.name?.trim() || session.actor.name, role: session.actor.role, x: input.x, y: input.y }); broadcastPresence(); }
        return json(response, 200, { presence: livePresence() });
      }
      if (path === '/api/action') {
        if (typeof input.type !== 'string' || !Object.hasOwn(actionFields, input.type)) fail('INVALID_ACTION', 'Unknown world action.'); exact(input, actionFields[input.type]);
        return await enqueue(async () => {
          // Re-check after waiting: a logout may have demoted this live session.
          const outcome = await applyAction(store.value.world, input, { ...session.actor });
          const candidate = input.type === 'publish' ? publicationCandidate(store.value, outcome.world, outcome.result) : { ...store.value, world: outcome.world };
          try { await store.commit(candidate); } catch (error) { if (error.code?.startsWith('INVALID') || error.code === 'STALE_SUBJECT') throw error; fail('PERSISTENCE_FAILED', 'State could not be saved; no action was adopted.', 503); }
          kernel = replayKernel(store.value.institutionalEvents, CONFIG, { artifacts: bytesMap(store.value.artifacts) }); broadcastWorld(); return json(response, 200, { ...dto(session), result: outcome.result });
        });
      }
      if (path === '/api/launch') {
        exact(input, ['title', 'tagline']); if (session.actor.role !== 'founder') fail('FORBIDDEN', 'Only an authenticated Founder can rehearse a shared launch.', 403);
        if ((input.title !== undefined && (typeof input.title !== 'string' || Array.from(input.title).length > 100)) || (input.tagline !== undefined && (typeof input.tagline !== 'string' || Array.from(input.tagline).length > 300))) fail('INVALID_LAUNCH', 'Launch title or tagline exceeds its bound.');
        const { rehearseLaunch } = await import('./launchpad.mjs');
        const report = await rehearseLaunch(store.value.world, { ...input, loadAsset: async assetPath => { const entry = STATIC.get(assetPath); if (!entry || !assetPath.startsWith('/assets/comic/')) throw new Error('Unknown exhibit asset'); return `data:image/jpeg;base64,${(await readFile(join(gameDir, entry[0]))).toString('base64')}`; } });
        return json(response, 200, report);
      }
      fail('NOT_FOUND', 'Not found.', 404);
    } catch (error) {
      if (!response.headersSent) json(response, error.status || (error.code === 'ENOENT' ? 404 : 500), { error: { code: error.status ? error.code : error.code === 'ENOENT' ? 'NOT_FOUND' : 'INTERNAL_ERROR', message: error.status ? error.message : error.code === 'ENOENT' ? 'Not found.' : 'The request could not be completed.' } });
      else response.end();
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  let closePromise;
  server.closeGame = () => {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      for (const stream of streams) stream.response.end();
      await serial;
      try { if (server.listening) await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())); }
      finally{server.closeAllConnections();try{await decisions.close();}finally{await store.close();}}
    })();
    return closePromise;
  };
  return server;
}


if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let server;
  try {
    const port = Number(process.env.PORT || 4173), host = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535');
    const institutionReport=process.env.NGL_INSTITUTION_REPORT?JSON.parse(await readFile(resolve(process.env.NGL_INSTITUTION_REPORT),'utf8')):null;
    server = await createGameServer({ dataDir: process.env.NGL_DATA_DIR ? resolve(process.env.NGL_DATA_DIR) : undefined,institutionReport });
    await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, host, resolveListen); });
    const address = server.address();
    console.log(`No_Gas_Labs local world listening on ${host}:${address.port}. Founder credentials remain in the private runtime directory or configured environment.`);
    let stopping = false;
    const shutdown = async () => { if (stopping) return; stopping = true; await server.closeGame(); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  } catch (error) {
    if (server) await server.closeGame().catch(() => {});
    console.error(error.code === 'SERVICE_LOCKED' ? error.message : 'Local world startup failed. Check the port, runtime directory, and private key configuration.');
    process.exitCode = 1;
  }
}
