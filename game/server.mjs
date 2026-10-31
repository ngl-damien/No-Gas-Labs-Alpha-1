import http from 'node:http';
import { constants as fsConstants } from 'node:fs';
import { lstat, readFile, mkdir, open } from 'node:fs/promises';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createWorld, applyAction, publicWorld, validateWorld } from './model.mjs';
import { applyEvent, replayKernel, artifactReceipt, canonicalStringify } from '../src/institution/kernel.mjs';
import { createServiceStore } from './service-store.mjs';
import { forgeCapabilities } from '../src/forge/runner.mjs';
import { openDecisions } from '../src/institution/decisions.mjs';
import { projectProjection } from '../src/institution/project-projection.mjs';
import { createLoginRateLimiter } from './login-rate-limit.mjs';
import { assertNoDuplicateJsonObjectKeys } from '../src/strict-json.mjs';
import { readInstitutionReport } from '../src/institution/report-reader.mjs';
import { isStrictTimestamp } from './timestamps.mjs';

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
  ...['client', 'quests', 'character-sheet', 'player-position', 'world-view', 'model', 'artifacts', 'launchpad', 'institution-view', 'contradiction-clerk', 'chronicle', 'research-records', 'timestamps'].map(name => [`/${name}.mjs`, [`${name}.mjs`, 'text/javascript; charset=utf-8']]),
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ...['cover_a', 'p3', 'p4', 'p5', 'p10', 'p13'].map(name => [`/assets/comic/${name}.jpg`, [`assets/comic/${name}.jpg`, 'image/jpeg']])
]);
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const exact = (value, fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) fail('INVALID_FIELDS', 'Unexpected request fields.');
};
const actionFields = {
  draft: ['type', 'kind', 'title', 'intent', 'html', 'requestId'], publish: ['type', 'draftId', 'expectedVersion', 'requestId'],
  repair: ['type', 'creationId', 'expectedVersion', 'intent', 'html', 'requestId'],
  contribute: ['type', 'creationId', 'version', 'text', 'requestId'], report: ['type', 'creationId', 'version', 'text', 'requestId'], study: ['type', 'creationId', 'version', 'question', 'attempt', 'nextCheck', 'requestId'], 'review-study': ['type', 'studyId', 'response', 'reflection', 'requestId'], discover: ['type', 'locationId', 'requestId'],
  'propose-moonshot': ['type', 'title', 'hypothesis', 'falsifier', 'evidenceNeeded', 'sourceCreationId', 'sourceVersion', 'requestId'],
  'report-experiment': ['type', 'moonshotId', 'procedure', 'observation', 'reportedOutcome', 'evidenceCreationId', 'evidenceVersion', 'requestId'],
  'challenge-experiment-report': ['type', 'reportId', 'challengeType', 'challengeText', 'evidenceCreationId', 'evidenceVersion', 'requestId']
};

const actionKinds = new Set(['comic', 'loom', 'observatory', 'custom']);
const challengeTypes = new Set(['missing-evidence', 'methodology', 'contradiction', 'reproducibility', 'scope', 'other']);
const actionLocations = new Set(['relay', 'river', 'overlook', 'ruins']);
function preflightText(value, max, label, { required = false, empty = false, nullable = false } = {}) {
  if (value === undefined && !required) return;
  if (value === null && nullable) return;
  if (typeof value !== 'string' || (!empty && !value.trim())) fail('INVALID_INPUT', label + ' is required.');
  if (Array.from(value).length > max) fail('TOO_LARGE', label + ' exceeds ' + max + ' characters.', 413);
}
function preflightHtml(value) {
  if (value === undefined) return;
  if (typeof value !== 'string') fail('INVALID_INPUT', 'HTML must be text.');
  if (Buffer.byteLength(value) > 131072) fail('TOO_LARGE', 'Custom HTML exceeds 128 KiB.', 413);
}
function preflightAction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.type !== 'string' || !Object.hasOwn(actionFields, input.type)) fail('INVALID_ACTION', 'Unknown world action.');
  exact(input, actionFields[input.type]);
  if (input.requestId !== undefined && input.requestId !== null && (typeof input.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.requestId))) {
    fail('INVALID_REQUEST_ID', 'Request ID must be a bounded stable identifier.');
  }
  const requiredId = (value, label) => {
    if (typeof value !== 'string' || !value.trim()) fail('INVALID_INPUT', label + ' is required.');
  };
  switch (input.type) {
    case 'draft':
      if (!actionKinds.has(input.kind)) fail('INVALID_KIND', 'Choose a known recipe.');
      preflightText(input.title, 80, 'Title', { required: true });
      preflightText(input.intent ?? '', 2000, 'Intent', { required: true, empty: true });
      preflightHtml(input.html);
      break;
    case 'publish':
      requiredId(input.draftId, 'Draft ID');
      if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) fail('INVALID_VERSION', 'Expected version must be a non-negative integer.');
      break;
    case 'repair':
      requiredId(input.creationId, 'Creation ID');
      if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) fail('INVALID_VERSION', 'Expected version must be a positive integer.');
      if (input.intent !== undefined) preflightText(input.intent, 2000, 'Intent', { required: true, empty: true });
      preflightHtml(input.html);
      break;
    case 'contribute':
    case 'report':
      requiredId(input.creationId, 'Creation ID');
      if (!Number.isInteger(input.version) || input.version < 1) fail('INVALID_VERSION', 'Select a published version.');
      preflightText(input.text, input.type === 'report' ? 1000 : 500, input.type === 'report' ? 'Report' : 'Contribution', { required: true });
      break;
    case 'report-experiment': {
      requiredId(input.moonshotId, 'Moonshot ID');
      preflightText(input.procedure, 1000, 'Procedure', { required: true });
      preflightText(input.observation, 1000, 'Observation', { required: true });
      if (!['supports', 'contradicts', 'inconclusive', 'failed'].includes(input.reportedOutcome)) fail('INVALID_OUTCOME', 'Choose a bounded self-reported outcome.');
      const hasEvidenceId = input.evidenceCreationId !== undefined && input.evidenceCreationId !== null;
      const hasEvidenceVersion = input.evidenceVersion !== undefined && input.evidenceVersion !== null;
      if (hasEvidenceId !== hasEvidenceVersion) fail('INVALID_EVIDENCE', 'Choose both a retained evidence artifact and version, or neither.');
      if (hasEvidenceId) {
        requiredId(input.evidenceCreationId, 'Evidence artifact ID');
        if (!Number.isSafeInteger(input.evidenceVersion) || input.evidenceVersion < 1) fail('INVALID_EVIDENCE', 'Evidence version must be a positive integer.');
      }
      break;
    }
    case 'study': {
      requiredId(input.creationId, 'Study artifact ID');
      if (!Number.isSafeInteger(input.version) || input.version < 1) fail('INVALID_VERSION', 'Select a retained published version.');
      preflightText(input.question, 500, 'Study question', { required: true });
      preflightText(input.attempt, 1000, 'Your explanation', { required: true });
      preflightText(input.nextCheck, 500, 'Next check', { required: true });
      break;
    }
    case 'review-study': {
      requiredId(input.studyId, 'Study note ID');
      preflightText(input.response, 1000, 'Retrieval response', { required: true });
      preflightText(input.reflection, 1000, 'Reflection', { required: true });
      break;
    }
    case 'challenge-experiment-report': {
      requiredId(input.reportId, 'Experiment report ID');
      if (!challengeTypes.has(input.challengeType)) fail('INVALID_CHALLENGE_TYPE', 'Choose a bounded challenge category.');
      preflightText(input.challengeText, 1000, 'Challenge text', { required: true });
      const hasEvidenceId = input.evidenceCreationId !== undefined && input.evidenceCreationId !== null;
      const hasEvidenceVersion = input.evidenceVersion !== undefined && input.evidenceVersion !== null;
      if (hasEvidenceId !== hasEvidenceVersion) fail('INVALID_EVIDENCE', 'Choose both a retained challenge-evidence artifact and version, or neither.');
      if (hasEvidenceId) {
        requiredId(input.evidenceCreationId, 'Challenge evidence artifact ID');
        if (!Number.isSafeInteger(input.evidenceVersion) || input.evidenceVersion < 1) fail('INVALID_EVIDENCE', 'Challenge evidence version must be a positive integer.');
      }
      break;
    }
    case 'discover':
      if (!actionLocations.has(input.locationId)) fail('INVALID_LOCATION', 'That place is not on this map.');
      break;
    case 'propose-moonshot': {
      preflightText(input.title, 80, 'Moonshot title', { required: true });
      preflightText(input.hypothesis, 1000, 'Hypothesis', { required: true });
      preflightText(input.falsifier, 1000, 'Falsification condition', { required: true });
      preflightText(input.evidenceNeeded, 1000, 'Evidence needed', { required: true });
      const hasSourceId = input.sourceCreationId !== undefined && input.sourceCreationId !== null;
      const hasSourceVersion = input.sourceVersion !== undefined && input.sourceVersion !== null;
      if (hasSourceId !== hasSourceVersion) fail('INVALID_SOURCE', 'Choose both a source artifact and version, or neither.');
      if (hasSourceId) {
        requiredId(input.sourceCreationId, 'Source artifact ID');
        if (!Number.isSafeInteger(input.sourceVersion) || input.sourceVersion < 1) fail('INVALID_SOURCE', 'Source version must be a positive integer.');
      }
      break;
    }
  }
}
const snapshots = world => world.creations.flatMap(creation => [...creation.versions, creation]);
const bytesMap = artifacts => new Map(Object.entries(artifacts).map(([hash, bytes]) => [hash, Buffer.from(bytes, 'base64')]));


function preflightPresence(input) {
  exact(input, ['x', 'y', 'name']);
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.x > 1600 || input.y < 0 || input.y > 1000 ||
      (input.name !== undefined && (typeof input.name !== 'string' || Array.from(input.name).length > 80))) {
    fail('INVALID_PRESENCE', 'Presence must be within the world bounds.');
  }
}

function validateHistory(world) {
  const createdAt = Date.parse(world.createdAt), updatedAt = Date.parse(world.updatedAt);
  if (world.revision !== world.events.length || !isStrictTimestamp(world.createdAt) || !isStrictTimestamp(world.updatedAt) || !Number.isFinite(createdAt) || !Number.isFinite(updatedAt) || createdAt > updatedAt || (world.events.length && updatedAt !== Date.parse(world.events.at(-1).at)) || (!world.events.length && updatedAt !== createdAt)) throw new Error('World history integrity mismatch');
  const details = { draft: ['draftId'], repair: ['creationId', 'draftId', 'baseVersion'], publish: ['creationId', 'version', 'reward'], contribute: ['creationId', 'version'], report: ['creationId', 'version'], study: ['studyId', 'creationId', 'version', 'question', 'attempt', 'nextCheck'], 'study-reviewed': ['reviewId', 'studyId', 'creationId', 'version', 'response', 'reflection'], discover: ['locationId'], 'moonshot-proposed': ['moonshotId', 'title', 'hypothesis', 'falsifier', 'evidenceNeeded', 'sourceCreationId', 'sourceVersion'], 'experiment-reported': ['reportId', 'moonshotId', 'procedure', 'observation', 'reportedOutcome', 'evidenceCreationId', 'evidenceVersion'], 'experiment-challenged': ['challengeId', 'reportId', 'moonshotId', 'challengeType', 'challengeText'] };
  const notes = { contribute: [...world.contributions], report: [...world.reports], discover: [...world.discoveries] };
  const published = snapshots(world);
  const drafts = new Map(), requestIds = new Set(), reportIds = new Set(), experimentReports = new Map(), challengeIds = new Set(), studyIds = new Set(), studyById = new Map(), reviewIds = new Set(), reviewedStudyIds = new Set();
  const eventPositions = new Map(), publicationEventsByVersion = new Map(), proposalsByMoonshot = new Map(), publishedByVersion = new Map(), earliestDiscoveryAt = new Map();
  const historyKey = (...parts) => JSON.stringify(parts);
  const addHistory = (map, key, value) => { const list = map.get(key) || []; list.push(value); map.set(key, list); };
  for (let index = 0; index < world.events.length; index += 1) {
    const event = world.events[index];
    if (!event || typeof event !== 'object') continue;
    eventPositions.set(event, index);
    if (event.type === 'publish') addHistory(publicationEventsByVersion, historyKey(event.creationId, event.version), event);
    if (event.type === 'moonshot-proposed') addHistory(proposalsByMoonshot, event.moonshotId, { event, index });
  }
  for (const version of published) addHistory(publishedByVersion, historyKey(version.id, version.version), version);
  for (const discovery of world.discoveries) {
    const key = historyKey(discovery.locationId, discovery.actor?.id);
    const at = Date.parse(discovery.at);
    if (Number.isFinite(at) && (!earliestDiscoveryAt.has(key) || at < earliestDiscoveryAt.get(key))) earliestDiscoveryAt.set(key, at);
  }
  let previousAt = Date.parse(world.createdAt);
  for (const event of world.events) {
    if (!Object.hasOwn(details, event.type)) throw new Error('Unknown stored world history event');
    const optional = ['requestId', 'actionFingerprint', 'actionResult', ...(event.type === 'discover' ? ['repeat'] : []), ...(event.type === 'experiment-challenged' ? ['evidenceCreationId', 'evidenceVersion'] : [])];
    exact(event, ['id', 'type', 'actor', 'at', 'semantics', ...details[event.type], ...optional]);
    exact(event.actor, ['id', 'name', 'role']);
    const eventAt = Date.parse(event.at);
    if (!isStrictTimestamp(event.at) || !Number.isFinite(eventAt) || eventAt < previousAt || (event.actor.role === 'founder' && event.actor.id !== CONFIG.founderId) || (['draft', 'repair', 'publish'].includes(event.type) && (event.actor.role !== 'founder' || event.actor.id !== CONFIG.founderId))) throw new Error('Stored world history authority / time mismatch');
    previousAt = eventAt;
    if (event.type === 'study') {
      if (typeof event.studyId !== 'string' || !event.studyId || studyIds.has(event.studyId) ||
          typeof event.creationId !== 'string' || !event.creationId ||
          !Number.isSafeInteger(event.version) || event.version < 1 ||
          typeof event.question !== 'string' || !event.question.trim() || Array.from(event.question).length > 500 ||
          typeof event.attempt !== 'string' || !event.attempt.trim() || Array.from(event.attempt).length > 1000 ||
          typeof event.nextCheck !== 'string' || !event.nextCheck.trim() || Array.from(event.nextCheck).length > 500) {
        throw new Error('Stored Academy study note is malformed or repeated');
      }
      studyIds.add(event.studyId);
      studyById.set(event.studyId, event);
      const matches = published.filter(item => item.id === event.creationId && item.version === event.version && Date.parse(item.publishedAt) <= eventAt);
      if (matches.length !== 1) throw new Error('Stored Academy study note does not bind to one earlier retained published version');
    }
    if (event.type === 'study-reviewed') {
      if (typeof event.reviewId !== 'string' || !event.reviewId || reviewIds.has(event.reviewId) ||
          typeof event.studyId !== 'string' || !event.studyId || reviewedStudyIds.has(event.studyId) ||
          typeof event.creationId !== 'string' || !event.creationId ||
          !Number.isSafeInteger(event.version) || event.version < 1 ||
          typeof event.response !== 'string' || !event.response.trim() || Array.from(event.response).length > 1000 ||
          typeof event.reflection !== 'string' || !event.reflection.trim() || Array.from(event.reflection).length > 1000) {
        throw new Error('Stored Academy study review is malformed or repeated');
      }
      const source = studyById.get(event.studyId);
      if (!source || source.actor.id !== event.actor.id || source.actor.role !== event.actor.role ||
          source.creationId !== event.creationId || source.version !== event.version ||
          Date.parse(source.at) >= eventAt) throw new Error('Stored Academy study review must follow its author’s matching source note');
      if (!(publishedByVersion.get(historyKey(event.creationId, event.version)) || []).some(item => Date.parse(item.publishedAt) <= eventAt)) {
        throw new Error('Stored Academy study review does not bind to an earlier retained published version');
      }
      reviewIds.add(event.reviewId);
      reviewedStudyIds.add(event.studyId);
    }
    if (event.type === 'moonshot-proposed') {
      if (typeof event.moonshotId !== 'string' || !event.moonshotId ||
          typeof event.title !== 'string' || !event.title.trim() || Array.from(event.title).length > 80 ||
          typeof event.hypothesis !== 'string' || !event.hypothesis.trim() || Array.from(event.hypothesis).length > 1000 ||
          typeof event.falsifier !== 'string' || !event.falsifier.trim() || Array.from(event.falsifier).length > 1000 ||
          typeof event.evidenceNeeded !== 'string' || !event.evidenceNeeded.trim() || Array.from(event.evidenceNeeded).length > 1000) {
        throw new Error('Stored moonshot proposal is malformed');
      }
      if (!(event.sourceCreationId === null && event.sourceVersion === null)) {
        if (typeof event.sourceCreationId !== 'string' || !event.sourceCreationId.trim() ||
            !Number.isSafeInteger(event.sourceVersion) || event.sourceVersion < 1 ||
            !(publishedByVersion.get(historyKey(event.sourceCreationId, event.sourceVersion)) || []).some(p => Date.parse(p.publishedAt) <= Date.parse(event.at))) {
          throw new Error('Stored moonshot source reference is invalid');
        }
      }
    }
    if (event.type === 'experiment-reported') {
      if (typeof event.reportId !== 'string' || !event.reportId || reportIds.has(event.reportId) ||
          typeof event.moonshotId !== 'string' || !event.moonshotId ||
          typeof event.procedure !== 'string' || !event.procedure.trim() || Array.from(event.procedure).length > 1000 ||
          typeof event.observation !== 'string' || !event.observation.trim() || Array.from(event.observation).length > 1000 ||
          !['supports', 'contradicts', 'inconclusive', 'failed'].includes(event.reportedOutcome)) {
        throw new Error('Stored experiment report is malformed or repeated');
      }
      reportIds.add(event.reportId);
      experimentReports.set(event.reportId, event);
      if ((proposalsByMoonshot.get(event.moonshotId) || []).filter(proposal => proposal.index < eventPositions.get(event) && Date.parse(proposal.event.at) <= Date.parse(event.at)).length !== 1) {
        throw new Error('Stored experiment report does not bind to one earlier moonshot proposal');
      }
      const hasEvidenceId = typeof event.evidenceCreationId === 'string' && event.evidenceCreationId.length > 0;
      const hasEvidenceVersion = Number.isSafeInteger(event.evidenceVersion) && event.evidenceVersion > 0;
      if (hasEvidenceId !== hasEvidenceVersion ||
          (!hasEvidenceId && (event.evidenceCreationId !== null || event.evidenceVersion !== null)) ||
          (hasEvidenceId && !(publishedByVersion.get(historyKey(event.evidenceCreationId, event.evidenceVersion)) || []).some(p => Date.parse(p.publishedAt) <= Date.parse(event.at)))) {
        throw new Error('Stored experiment evidence reference is invalid');
      }
    }
    if (event.type === 'experiment-challenged') {
      const report = experimentReports.get(event.reportId);
      if (typeof event.challengeId !== 'string' || !event.challengeId || challengeIds.has(event.challengeId) ||
          typeof event.reportId !== 'string' || !event.reportId || typeof event.moonshotId !== 'string' || !event.moonshotId ||
          !challengeTypes.has(event.challengeType) || typeof event.challengeText !== 'string' || !event.challengeText.trim() || Array.from(event.challengeText).length > 1000 ||
          !report || report.moonshotId !== event.moonshotId || report.actor.id === event.actor.id || Date.parse(report.at) > Date.parse(event.at)) {
        throw new Error('Stored experiment challenge is malformed or does not target an earlier report from a different actor');
      }
      const hasEvidenceId = typeof event.evidenceCreationId === 'string' && event.evidenceCreationId.length > 0;
      const hasEvidenceVersion = Number.isSafeInteger(event.evidenceVersion) && event.evidenceVersion > 0;
      if (hasEvidenceId !== hasEvidenceVersion) throw new Error('Stored experiment challenge evidence reference is incomplete');
      if (!hasEvidenceId) {
        if (event.evidenceCreationId !== undefined && event.evidenceCreationId !== null) throw new Error('Stored unlinked challenge evidence must be null');
        if (event.evidenceVersion !== undefined && event.evidenceVersion !== null) throw new Error('Stored unlinked challenge evidence version must be null');
      } else {
        const source = world.creations.find(creation => creation.id === event.evidenceCreationId);
        const version = source && (source.version === event.evidenceVersion ? source : source.versions.find(item => item.version === event.evidenceVersion));
        if (!version || !isStrictTimestamp(version.publishedAt) || Date.parse(version.publishedAt) > Date.parse(event.at)) {
          throw new Error('Stored experiment challenge evidence version is not retained at the challenge time');
        }
      }
      challengeIds.add(event.challengeId);
    }
    if (event.repeat !== undefined && (event.type !== 'discover' || typeof event.repeat !== 'boolean')) throw new Error('Stored repeat-discovery marker is invalid');
    const receiptFields = ['requestId', 'actionFingerprint', 'actionResult'];
    const present = receiptFields.filter(key => Object.hasOwn(event, key));
    if (present.length && present.length !== receiptFields.length) throw new Error('Stored idempotency receipt is incomplete');
    if (present.length === receiptFields.length) {
      if (typeof event.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(event.requestId) || requestIds.has(event.requestId) || typeof event.actionFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(event.actionFingerprint)) throw new Error('Stored idempotency receipt is invalid or repeated');
      requestIds.add(event.requestId);
      const result = event.actionResult;
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Stored idempotency result is malformed');
      const resultKeys = Object.keys(result).sort().join(',');
      const expected = { draft: 'draftId', repair: 'draftId', publish: 'creationId,version', contribute: 'id', report: 'id', study: 'studyId', 'study-reviewed': 'reviewId', discover: 'discovered', 'moonshot-proposed': 'moonshotId', 'experiment-reported': 'reportId', 'experiment-challenged': 'challengeId' }[event.type];
      if (resultKeys !== expected) throw new Error('Stored idempotency result does not match event type');
      if ((event.type === 'draft' || event.type === 'repair') && result.draftId !== event.draftId) throw new Error('Stored idempotency draft result mismatch');
      if (event.type === 'publish' && (result.creationId !== event.creationId || result.version !== event.version)) throw new Error('Stored idempotency publication result mismatch');
      if (event.type === 'moonshot-proposed' && result.moonshotId !== event.moonshotId) throw new Error('Stored idempotency moonshot result mismatch');
      if (event.type === 'experiment-reported' && result.reportId !== event.reportId) throw new Error('Stored idempotency experiment report result mismatch');
      if (event.type === 'experiment-challenged' && result.challengeId !== event.challengeId) throw new Error('Stored idempotency experiment challenge result mismatch');
      if (event.type === 'study' && result.studyId !== event.studyId) throw new Error('Stored idempotency study result mismatch');
      if (event.type === 'study-reviewed' && result.reviewId !== event.reviewId) throw new Error('Stored idempotency study review result mismatch');
      if (event.type === 'contribute' || event.type === 'report') {
        const collection = event.type === 'report' ? world.reports : world.contributions;
        if (typeof result.id !== 'string' || !collection.some(note => note.id === result.id && note.creationId === event.creationId && note.version === event.version && note.at === event.at && canonicalStringify(note.actor) === canonicalStringify(event.actor))) throw new Error('Stored idempotency note result mismatch');
      }
      if (event.type === 'discover' && (typeof result.discovered !== 'boolean' || (event.repeat === true && result.discovered) || (event.repeat === true && !(earliestDiscoveryAt.has(historyKey(event.locationId, event.actor.id)) && earliestDiscoveryAt.get(historyKey(event.locationId, event.actor.id)) <= Date.parse(event.at))) || (event.repeat !== true && !result.discovered))) throw new Error('Stored idempotency discovery result mismatch');
    }
    if (event.type === 'draft' || event.type === 'repair') {
      if (typeof event.draftId !== 'string' || drafts.has(event.draftId)) throw new Error('Stored draft history mismatch');
      if (event.type === 'repair' && (!Number.isInteger(event.baseVersion) || !(publishedByVersion.get(historyKey(event.creationId, event.baseVersion)) || []).some(p => Date.parse(p.publishedAt) <= Date.parse(event.at)))) throw new Error('Stored repair version history mismatch');
      drafts.set(event.draftId, event);
    }
    if (event.type === 'publish' && !(publishedByVersion.get(historyKey(event.creationId, event.version)) || []).some(p => p.publishedAt === event.at)) throw new Error('Stored publication history mismatch');
    if (Object.hasOwn(notes, event.type)) {
      if (event.type === 'discover' && event.repeat === true) continue;
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
    const event = (publicationEventsByVersion.get(historyKey(publication.id, publication.version)) || [])[0];
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
const MAX_FOUNDER_KEY_FILE_BYTES = 1025; // 1024-byte key plus the generated trailing newline.

async function readFounderKeyFile(path) {
  // A pathname alone is not a trust anchor: reject symlinks and permissive
  // files, then verify the opened descriptor still names the inspected inode.
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error('Founder key must be a regular, non-symlink file');
  }
  if ((before.mode & 0o077) !== 0) {
    throw new Error('Founder key file permissions must exclude group and other access (0600)');
  }
  if (typeof process.getuid === 'function' && before.uid !== process.getuid()) {
    throw new Error('Founder key file must be owned by the current process user');
  }
  if (before.size > MAX_FOUNDER_KEY_FILE_BYTES) {
    throw new Error('Founder key file exceeds the 1025-byte limit');
  }

  let handle;
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);
    handle = await open(path, flags);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error('Founder key file changed while opening');
    }
    if ((opened.mode & 0o077) !== 0) {
      throw new Error('Founder key file permissions must exclude group and other access (0600)');
    }
    if (typeof process.getuid === 'function' && opened.uid !== process.getuid()) {
      throw new Error('Founder key file must be owned by the current process user');
    }
    if (opened.size > MAX_FOUNDER_KEY_FILE_BYTES) {
      throw new Error('Founder key file exceeds the 1025-byte limit');
    }
    if (opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) {
      throw new Error('Founder key file changed before reading');
    }

    // Never use readFile() on a persisted credential. Even if the path grows
    // after lstat(), this fixed buffer reads at most limit + 1 bytes.
    const buffer = Buffer.alloc(MAX_FOUNDER_KEY_FILE_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_FOUNDER_KEY_FILE_BYTES) {
      throw new Error('Founder key file exceeds the 1025-byte limit');
    }

    const after = await lstat(path);
    const afterHandle = await handle.stat();
    if (after.isSymbolicLink() || !after.isFile() || after.dev !== opened.dev || after.ino !== opened.ino) {
      throw new Error('Founder key file changed while reading');
    }
    const unchanged = stat => stat.size === opened.size &&
      stat.mtimeMs === opened.mtimeMs && stat.ctimeMs === opened.ctimeMs;
    if (!unchanged(after) || !unchanged(afterHandle) || total !== opened.size) {
      throw new Error('Founder key file changed while reading');
    }

    const keyBytes = buffer.subarray(0, total);
    const decodedKey = keyBytes.toString('utf8');
    if (!Buffer.from(decodedKey, 'utf8').equals(keyBytes)) {
      throw new Error('Founder key file is not valid UTF-8');
    }
    const key = decodedKey.trim();
    if (key.length < 32 || Buffer.byteLength(key) > 1024) {
      throw new Error('Invalid persisted Founder key');
    }
    return key;
  } finally {
    await handle?.close();
  }
}
async function getFounderKey(dataDir, provided) {
  if (provided !== undefined) {
    if (typeof provided !== 'string' || provided.length < 16 || Buffer.byteLength(provided) > 1024) throw new Error('Founder key must be 16–1024 bytes');
    return provided;
  }
  const path = join(dataDir, 'founder.key');
  try {
    return await readFounderKeyFile(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const key = randomBytes(32).toString('base64url');
  try {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(key + '\n'); await file.sync(); }
    finally { await file.close(); }

    // Sync the directory entry as well as file contents before startup succeeds.
    const directory = await open(dataDir, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0));
    try { await directory.sync(); } finally { await directory.close(); }
    return key;
  } catch (writeError) {
    if (writeError.code === 'EEXIST') return getFounderKey(dataDir);
    throw writeError;
  }
}

// Reject redirected ancestors before recursive creation can write a Founder key
// through a symlink. This is a best-effort path walk, not an atomic openat boundary.
async function assertNoSymlinkPathComponents(path) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let stat;
    try { stat = await lstat(current); }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error('Founder data directory path may not contain symbolic link components');
    }
    if (!stat.isDirectory()) {
      throw new Error('Founder data directory path components must be directories');
    }
  }
}

async function assertPrivateDataDirectory(dataDir) {
  // Recheck after mkdir and again after key loading so a visible ancestor swap
  // fails before credential access and cannot be mistaken for a private path.
  await assertNoSymlinkPathComponents(dataDir);
  const directory = await lstat(dataDir);
  if (directory.isSymbolicLink() || !directory.isDirectory()) {
    throw new Error('Founder data directory must be a regular, non-symlink directory');
  }
  const mode = directory.mode & 0o777;
  if ((mode & 0o700) !== 0o700) {
    throw new Error('Founder data directory owner permissions must include read, write and execute (0700)');
  }
  if ((mode & 0o077) !== 0) {
    throw new Error('Founder data directory permissions must exclude group and other access (0700)');
  }
  if (typeof process.getuid === 'function' && directory.uid !== process.getuid()) {
    throw new Error('Founder data directory must be owned by the current process user');
  }
  return { dev: directory.dev, ino: directory.ino, uid: directory.uid, mode };
}

/** Local HTTP host. Authority comes only from its ephemeral authenticated sessions. */
export async function createGameServer({ dataDir = resolve(gameDir, '../.runtime'), founderKey = process.env.NGL_FOUNDER_KEY, institutionReport = null, loginRateLimit = undefined, decisionSyncDirectory = undefined } = {}) {
  const loginLimiter = createLoginRateLimiter(loginRateLimit);
  await assertNoSymlinkPathComponents(dataDir);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const dataDirectory = await assertPrivateDataDirectory(dataDir);
  const key = await getFounderKey(dataDir, founderKey);
  const dataDirectoryAfterKeyRead = await assertPrivateDataDirectory(dataDir);
  if (dataDirectory.dev !== dataDirectoryAfterKeyRead.dev ||
      dataDirectory.ino !== dataDirectoryAfterKeyRead.ino ||
      dataDirectory.uid !== dataDirectoryAfterKeyRead.uid ||
      dataDirectory.mode !== dataDirectoryAfterKeyRead.mode) {
    throw new Error('Founder data directory changed during startup');
  }
  const forge = forgeCapabilities();
  const store = await createServiceStore({ dataDir, initial: { world: createWorld(), institutionalEvents: [], artifacts: {}, publicationBindings: [] }, validate: validatePayload });
  let decisions,projects;
  try {
    projects = projectProjection(institutionReport);
    const decisionOptions = { directory: join(dataDir, 'decisions') };
    if (decisionSyncDirectory !== undefined) decisionOptions.syncDirectory = decisionSyncDirectory;
    decisions = await openDecisions(decisionOptions);
  } catch (error) { await store.close(); throw error; }
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
  const tokenDigest = token => createHash('sha256').update(token).digest('hex');
  const witness = (token = randomBytes(32).toString('base64url')) => ({ id: `witness-${tokenDigest(token)}`, name: 'Witness', role: 'witness' });
  const presenceIdFor = token => `presence-${tokenDigest(token)}`;
  const validSessionToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
  const sessionCookie = (token, request, actor) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${actor.role === 'witness' ? `; Max-Age=${Math.floor(SESSION_TTL / 1000)}` : ''}${request.socket.encrypted ? '; Secure' : ''}`;
  function expireSession(token, session) {
    presence.delete(session.token); session.actor = witness(session.token); session.lastSeen = Date.now();
    for (const stream of [...streams]) if (stream.session === session) { sendEvent(stream, 'world', dto(session)); stream.response.end(); }
    broadcastPresence();
    if (token) sessions.delete(token);
  }
  function sessionFor(request, response) {
    const token = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const tokenIsValid = validSessionToken(token);
    let session = tokenIsValid ? sessions.get(token) : null, expired = false;
    if (session && Date.now() - session.lastSeen > SESSION_TTL) { expireSession(token, session); session = null; expired = true; }
    if (!session) {
      // Reap expired sessions before applying capacity pressure. Expiration is
      // request-driven, so an unrelated unauthenticated request must not evict
      // a still-live Founder session merely because the map reached its bound.
      if (sessions.size >= 512) {
        const now = Date.now();
        for (const [existingToken, existing] of sessions) {
          if (now - existing.lastSeen > SESSION_TTL) expireSession(existingToken, existing);
        }
      }
      if (sessions.size >= 512) {
        // Do not evict a still-live session to admit an unauthenticated request.
        // Expired sessions were reaped above; if all remaining slots are live,
        // reject new sessions rather than disconnecting existing users.
        fail('SESSION_LIMIT', 'Session capacity reached; retry after an existing session expires.', 429);
      }
      // A surviving opaque cookie can restore only its pseudonymous Witness identity
      // after process restart. Founder authority is never reconstructed from a cookie.
      const id = tokenIsValid && !expired ? token : randomBytes(32).toString('base64url');
      const actor = witness(id);
      session = { token: id, presenceId: presenceIdFor(id), actor, lastSeen: Date.now() }; sessions.set(id, session);
      response.setHeader('Set-Cookie', sessionCookie(id, request, actor));
    }
    session.lastSeen = Date.now(); return session;
  }
  // Founder login is authenticated before it consumes a session slot. A stale or
  // missing cookie gets a transient Witness-shaped predecessor that is never stored.
  function sessionForFounderLogin(request) {
    const token = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const tokenIsValid = validSessionToken(token);
    let session = tokenIsValid ? sessions.get(token) : null;
    if (session && Date.now() - session.lastSeen > SESSION_TTL) {
      expireSession(token, session);
      session = null;
    }
    if (session) {
      session.lastSeen = Date.now();
      return session;
    }
    const id = tokenIsValid ? token : randomBytes(32).toString('base64url');
    return { token: id, presenceId: presenceIdFor(id), actor: witness(id), lastSeen: Date.now() };
  }
  // Founder-only endpoints must not create a Witness session as a side effect
  // of a denied request. Look up an existing authenticated session instead.
  function existingFounderSession(request) {
    const token = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!validSessionToken(token)) fail('FORBIDDEN', 'An authenticated Founder session is required.', 403);
    const session = sessions.get(token);
    if (!session) fail('FORBIDDEN', 'Founder session is missing or expired; log in again.', 403);
    if (Date.now() - session.lastSeen > SESSION_TTL) {
      expireSession(token, session);
      fail('FORBIDDEN', 'Founder session expired; log in again.', 403);
    }
    if (session.actor.role !== 'founder' || session.actor.id !== 'damien') {
      fail('FORBIDDEN', 'An authenticated Founder session is required.', 403);
    }
    session.lastSeen = Date.now();
    return session;
  }
  function makeRoomForFounderLogin(previous) {
    // Rotation replaces an existing session, so it already has room.
    if (sessions.has(previous.token) || sessions.size < 512) return;
    const now = Date.now();
    for (const [existingToken, existing] of sessions) {
      if (now - existing.lastSeen > SESSION_TTL) expireSession(existingToken, existing);
    }
    if (sessions.size < 512) return;
    // Only a successful key check reaches this point. It may reclaim the oldest
    // Witness slot; unauthenticated session creation never evicts a live session.
    let oldestWitnessToken = null;
    let oldestWitness = null;
    for (const [existingToken, existing] of sessions) {
      if (existing.actor.role !== 'witness') continue;
      if (!oldestWitness || existing.lastSeen < oldestWitness.lastSeen) {
        oldestWitnessToken = existingToken;
        oldestWitness = existing;
      }
    }
    if (!oldestWitness) fail('SESSION_LIMIT', 'Founder session capacity reached; retry after an existing session expires.', 429);
    expireSession(oldestWitnessToken, oldestWitness);
  }
  function rotate(request, response, previous, actor) {
    expireSession(previous.token, previous);
    const token = randomBytes(32).toString('base64url');
    const resolvedActor = actor.role === 'witness' ? witness(token) : actor;
    const session = { token, presenceId: presenceIdFor(token), actor: resolvedActor, lastSeen: Date.now() }; sessions.set(token, session);
    response.setHeader('Set-Cookie', sessionCookie(token, request, resolvedActor));
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
    const bytes = Buffer.concat(chunks);
    let value;
    try {
      const text = bytes.toString('utf8');
      // Buffer's UTF-8 decoder replaces malformed sequences. Round-trip the
      // bytes so malformed input cannot silently become a different request.
      if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('INVALID_UTF8');
      assertNoDuplicateJsonObjectKeys(text, { label: 'REQUEST', maxDepth: 128 });
      value = JSON.parse(text);
    } catch {
      fail('INVALID_JSON', 'Malformed JSON body.');
    }
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
      let session;
      if (request.method === 'GET') {
        const artifactPrefix = '/api/artifacts/';
        const artifactCandidate = path.startsWith(artifactPrefix) ? path.slice(artifactPrefix.length) : '';
        const artifactId = /^creation-[a-zA-Z0-9-]+$/.test(artifactCandidate) ? artifactCandidate : null;
        const knownRoute = ['/api/projects', '/api/decisions', '/api/state', '/api/export', '/api/institution', '/api/events'].includes(path) || artifactId !== null;
        if (!knownRoute) fail('NOT_FOUND', 'Not found.', 404);

        // These reads expose only public data and do not need an actor. Do not
        // mint sessions for catalog, capability-summary, or retained artifact reads.
        if (path === '/api/projects') return json(response, 200, projects);
        if (path === '/api/institution') return json(response, 200, institution());
        if (artifactId !== null) {
          const creation = store.value.world.creations.find(item => item.id === artifactId);
          const versionText = url.searchParams.get('version');
          if (versionText !== null && !/^[1-9]\d*$/.test(versionText)) fail('INVALID_VERSION', 'Invalid artifact version.');
          const version = versionText === null ? creation?.version : Number(versionText);
          const artifact = creation && (creation.version === version ? creation : creation.versions.find(item => item.version === version));
          if (!artifact) fail('NOT_FOUND', 'Published artifact not found.', 404);
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': ARTIFACT_CSP, 'x-artifact-sha256': artifact.receipt.digest });
          response.end(artifact.html);
          return;
        }

        // Check stream capacity before sessionFor can allocate a new cookie/session.
        if (path === '/api/events' && streams.size >= 128) {
          fail('STREAM_LIMIT', 'Too many active streams.', 429);
        }
        session = sessionFor(request, response);
        if (path === '/api/decisions') return json(response, 200, await decisions.snapshot({ id: session.actor.id, role: session.actor.role }));
        if (path === '/api/state' || path === '/api/export') return json(response, 200, dto(session));
        if (path === '/api/events') {
          response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
          response.flushHeaders();
          const stream = { response, session };
          streams.add(stream);
          sendEvent(stream, 'world', dto(session));
          const heartbeat = setInterval(() => { if (!response.destroyed) response.write(': keepalive\n\n'); }, 20000);
          heartbeat.unref();
          response.on('close', () => {
            clearInterval(heartbeat);
            streams.delete(stream);
            if (![...streams].some(other => other.session === session) && presence.delete(session.token)) broadcastPresence();
          });
          return;
        }
        fail('NOT_FOUND', 'Not found.', 404);
      }
      if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
      // Resolve the route before reading a body or allocating a session. An
      // unsupported endpoint must not consume capacity or mint a cookie.
      if (!['/api/login', '/api/logout', '/api/presence', '/api/action', '/api/launch',
        '/api/decisions/policy', '/api/decisions/proposals', '/api/decisions/choose'].includes(path)) {
        fail('NOT_FOUND', 'Not found.', 404);
      }
      // Reject cross-origin or malformed writes before allocating a session.
      // A failed request must not consume session capacity or set a new cookie.
      sameOrigin(request);
      const input = await body(request);
      if (path === '/api/login') {
        exact(input, ['key', 'name']);
        const loginAddress = request.socket.remoteAddress || 'unknown';
        loginLimiter.assertAllowed(loginAddress);
        if (typeof input.key !== 'string' || Buffer.byteLength(input.key) > 1024) {
          loginLimiter.failure(loginAddress);
          fail('UNAUTHENTICATED', 'Founder key did not match.', 401);
        }
        const candidate = Buffer.from(input.key), expected = Buffer.from(key);
        if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
          loginLimiter.failure(loginAddress);
          fail('UNAUTHENTICATED', 'Founder key did not match.', 401);
        }
        if (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim() || Array.from(input.name).length > 80)) fail('INVALID_NAME', 'Name must be 1–80 characters.');
        loginLimiter.success(loginAddress);
        const previous = sessionForFounderLogin(request);
        makeRoomForFounderLogin(previous);
        session = rotate(request, response, previous, { id: 'damien', name: input.name?.trim() || store.value.world.founderName, role: 'founder' });
        return json(response, 200, dto(session));
      }
      // Validate action shape before allocating a session. Draft, publish, and repair
      // are Founder-only, so denied attempts must not mint a Witness session either.
      if (path === '/api/action') preflightAction(input);
      if (path === '/api/presence') preflightPresence(input);
      if (path === '/api/logout') exact(input, []);
      const founderOnlyAction = path === '/api/action' && ['draft', 'publish', 'repair'].includes(input.type);
      const founderOnlyRoute = path === '/api/launch' || founderOnlyAction || ['/api/decisions/policy','/api/decisions/proposals','/api/decisions/choose'].includes(path);
      session = founderOnlyRoute ? existingFounderSession(request) : sessionFor(request, response);
      if(['/api/decisions/policy','/api/decisions/proposals','/api/decisions/choose'].includes(path)){
        if(session.actor.role!=='founder'||session.actor.id!=='damien')fail('FORBIDDEN','Only the authenticated Founder can operate the decision Gate.',403);
        return await enqueue(async()=>{if(session.actor.role!=='founder'||session.actor.id!=='damien')fail('FORBIDDEN','Founder session is no longer authorized.',403);try {
            const method = path.endsWith('/policy') ? 'setPolicy' : path.endsWith('/proposals') ? 'create' : 'decide';
            return json(response, 200, await decisions[method]({ id: session.actor.id, role: session.actor.role }, input));
          } catch (error) {
            if (error.code) {
              error.status = /FORBIDDEN|FOUNDER_REQUIRED|CREATOR_REQUIRED/.test(error.code) ? 403
                : /EXPIRED|REPLAY|REVISION|CONFLICT/.test(error.code) ? 409
                : /PERSISTENCE|UNCERTAIN/.test(error.code) ? 503
                : 400;
            }
            throw error;
          }});
      }
      if (path === '/api/logout') { session = rotate(request, response, session, witness()); return json(response, 200, dto(session)); }
      if (path === '/api/presence') {
        if ([...streams].some(stream => stream.session === session)) { presence.set(session.token, { id: session.presenceId, name: input.name?.trim() || session.actor.name, role: session.actor.role, x: input.x, y: input.y }); broadcastPresence(); }
        return json(response, 200, { presence: livePresence() });
      }
      if (path === '/api/action') {
        const { requestId: suppliedRequestId, ...action } = input;
        const requestId = suppliedRequestId ?? randomUUID();
        if (typeof requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)) fail('INVALID_REQUEST_ID', 'Request ID must be a bounded stable identifier.');
        return await enqueue(async () => {
          // Re-check after waiting: a logout may have demoted this live session.
          const actor = { ...session.actor };
          const actionFingerprint = artifactReceipt(canonicalStringify({ actor: { id: actor.id, role: actor.role }, action })).digest;
          const previous = store.value.world.events.find(event => event.requestId === requestId);
          if (previous) {
            if (previous.actionFingerprint !== actionFingerprint || previous.actor.id !== actor.id || previous.actor.role !== actor.role) fail('IDEMPOTENCY_CONFLICT', 'This request ID is already bound to a different actor or action.', 409);
            return json(response, 200, { ...dto(session), result: previous.actionResult, requestId, idempotentReplay: true });
          }
          const outcome = await applyAction(store.value.world, action, actor, { requestId, actionFingerprint });
          const candidate = input.type === 'publish' ? publicationCandidate(store.value, outcome.world, outcome.result) : { ...store.value, world: outcome.world };
          try { await store.commit(candidate); } catch (error) { if (error.code?.startsWith('INVALID') || error.code === 'STALE_SUBJECT' || error.code === 'SERVICE_STALE_REVISION' || error.code === 'COMMIT_DURABILITY_UNCERTAIN') throw error; fail('PERSISTENCE_FAILED', 'State could not be saved; no action was adopted.', 503); }
          kernel = replayKernel(store.value.institutionalEvents, CONFIG, { artifacts: bytesMap(store.value.artifacts) }); broadcastWorld(); return json(response, 200, { ...dto(session), result: outcome.result, requestId, idempotentReplay: false });
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
      if (!response.headersSent) {
        if (Number.isSafeInteger(error.retryAfterSeconds)) response.setHeader('Retry-After', String(error.retryAfterSeconds));
        json(response, error.status || (error.code === 'ENOENT' ? 404 : 500), { error: { code: error.status ? error.code : error.code === 'ENOENT' ? 'NOT_FOUND' : 'INTERNAL_ERROR', message: error.status ? error.message : error.code === 'ENOENT' ? 'Not found.' : 'The request could not be completed.' } });
      } else response.end();
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
      try {
        let stopped = Promise.resolve();
        if (server.listening) {
          stopped = new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
        }
        // Stop accepting new work first, then terminate active HTTP connections
        // before awaiting the close callback. Awaiting first can deadlock on a
        // client that never finishes its request body or a long-lived response.
        server.closeAllConnections();
        await stopped;
      } finally {
        try { await decisions.close(); }
        finally { await store.close(); }
      }
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
    const institutionReport = process.env.NGL_INSTITUTION_REPORT ? await readInstitutionReport(resolve(process.env.NGL_INSTITUTION_REPORT)) : null;
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
