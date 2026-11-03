import { isStrictTimestamp } from './timestamps.mjs';

const rows = value => {
  try { return Array.isArray(value) ? value : []; } catch { return []; }
};
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const validTime = isStrictTimestamp;
const sameActor = (left, right) => left?.id === right?.id;

const RESEARCH_TYPES = new Set([
  'moonshot-proposed',
  'experiment-reported',
  'experiment-challenged'
]);

// Research projections consume event-shaped data that may have crossed a model,
// plugin, donor, or offline-sync boundary. Snapshot own data descriptors only:
// never invoke getters, custom iterators, or caller-controlled toJSON methods.
const MAX_EVENT_COUNT = 100_000;
const MAX_RETAINED_CREATIONS = 20_000;
const MAX_SNAPSHOT_DEPTH = 16;
const MAX_OBJECT_FIELDS = 256;
const MAX_ARRAY_ITEMS = 100_000;
const MAX_STRING_LENGTH = 100_000;

function snapshotData(value, ancestors = new WeakSet(), depth = 0) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'undefined') {
    return { value, safe: true };
  }
  if (typeof value === 'string') {
    return value.length <= MAX_STRING_LENGTH
      ? { value, safe: true }
      : { value: undefined, safe: false };
  }
  if (typeof value !== 'object' || depth > MAX_SNAPSHOT_DEPTH) {
    return { value: undefined, safe: false };
  }

  let isArray;
  let prototype;
  let descriptors;
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return { value: null, safe: false };
  }

  if (ancestors.has(value)) return { value: null, safe: false };
  if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    return { value: isArray ? [] : Object.create(null), safe: false };
  }

  ancestors.add(value);
  try {
    const keys = Reflect.ownKeys(descriptors);
    if (isArray) {
      const lengthDescriptor = descriptors.length;
      const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value')
        ? lengthDescriptor.value : null;
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_ARRAY_ITEMS) {
        return { value: [], safe: false };
      }

      const result = [];
      const allowedKeys = new Set(['length']);
      let safe = true;
      for (let index = 0; index < length; index++) {
        const key = String(index);
        allowedKeys.add(key);
        const descriptor = descriptors[key];
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
          result.push(null);
          safe = false;
          continue;
        }
        const child = snapshotData(descriptor.value, ancestors, depth + 1);
        result.push(child.value);
        if (!child.safe) safe = false;
      }
      for (const key of keys) {
        if (typeof key !== 'string' || !allowedKeys.has(key)) safe = false;
      }
      return { value: result, safe };
    }

    const result = Object.create(null);
    let safe = keys.length <= MAX_OBJECT_FIELDS;
    for (const key of keys.slice(0, MAX_OBJECT_FIELDS)) {
      if (typeof key !== 'string') {
        safe = false;
        continue;
      }
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        safe = false;
        continue;
      }
      const child = snapshotData(descriptor.value, ancestors, depth + 1);
      result[key] = child.value;
      if (!child.safe) safe = false;
    }
    return { value: result, safe };
  } finally {
    ancestors.delete(value);
  }
}

function snapshotArrayEntries(value, maxItems) {
  let isArray;
  let descriptors;
  try {
    isArray = Array.isArray(value);
    if (!isArray) return [];
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return [];
  }
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value')
    ? lengthDescriptor.value : null;
  if (!Number.isSafeInteger(length) || length < 0 || length > maxItems) return [];

  const ancestors = new WeakSet();
  ancestors.add(value);
  const entries = [];
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      entries.push({ value: null, safe: false });
      continue;
    }
    entries.push(snapshotData(descriptor.value, ancestors, 1));
  }
  return entries;
}

function countBy(events, field, predicate = () => true) {
  const counts = new Map();
  for (const event of events) {
    const value = event?.[field];
    if (!predicate(value, event)) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function eventIdentityIsUnique(event, eventIdCounts) {
  return hasText(event?.id) && eventIdCounts.get(event.id) === 1;
}

function validMoonshotProposalData(event) {
  return event?.type === 'moonshot-proposed' &&
    hasText(event.moonshotId) && validTime(event.at) &&
    hasText(event.title) && Array.from(event.title).length <= 80 &&
    hasText(event.hypothesis) && Array.from(event.hypothesis).length <= 1000 &&
    hasText(event.falsifier) && Array.from(event.falsifier).length <= 1000 &&
    hasText(event.evidenceNeeded) && Array.from(event.evidenceNeeded).length <= 1000 &&
    hasText(event.actor?.id) && ['founder', 'witness'].includes(event.actor.role);
}

export function isValidMoonshotProposal(event) {
  const snapshot = snapshotData(event);
  return snapshot.safe && validMoonshotProposalData(snapshot.value);
}

function validReport(event) {
  const snapshot = snapshotData(event);
  const record = snapshot.value;
  return snapshot.safe && record?.type === 'experiment-reported' &&
    hasText(record.reportId) && hasText(record.moonshotId) &&
    validTime(record.at) && hasText(record.procedure) &&
    hasText(record.observation) &&
    ['supports', 'contradicts', 'inconclusive', 'failed'].includes(record.reportedOutcome) &&
    hasText(record.actor?.id) && ['founder', 'witness'].includes(record.actor.role);
}

/**
 * Read-only projection for the Evidence Archive.
 *
 * Links are exposed only when their identifiers are unique and the referenced
 * record precedes the referring event in append-only history. This is display
 * logic, not adjudication: invalid or ambiguous records remain visible, but
 * their context is not guessed.
 */
export function projectResearchRecords(input, retainedCreations = []) {
  const eventEntries = snapshotArrayEntries(input, MAX_EVENT_COUNT);
  const events = eventEntries.map(entry => entry.value);
  const unsafeEvents = new WeakSet();
  eventEntries.forEach(entry => {
    if (!entry.safe && entry.value && typeof entry.value === 'object') unsafeEvents.add(entry.value);
  });

  const creationEntries = snapshotArrayEntries(retainedCreations, MAX_RETAINED_CREATIONS);
  const creations = creationEntries.map(entry => entry.value);
  const unsafeCreations = new WeakSet();
  creationEntries.forEach(entry => {
    if (!entry.safe && entry.value && typeof entry.value === 'object') unsafeCreations.add(entry.value);
  });

  const eventIdCounts = countBy(events, 'id', value => hasText(value));
  const proposalCounts = countBy(events.filter(event => event?.type === 'moonshot-proposed'), 'moonshotId', value => hasText(value));
  const reportCounts = countBy(events.filter(event => event?.type === 'experiment-reported'), 'reportId', value => hasText(value));
  const challengeCounts = countBy(events.filter(event => event?.type === 'experiment-challenged'), 'challengeId', value => hasText(value));

  // Cross-check event history against the actual retained version objects. A publish
  // event by itself is not enough to activate a link: its exact version must exist
  // once, its timestamp must agree, and the publication must be Founder-attributed.
  const retainedVersionsByReference = new Map();
  for (const creation of creations) {
    if (!creation || typeof creation !== 'object') continue;
    const creationSafe = !unsafeCreations.has(creation);
    for (const version of [...rows(creation.versions), creation]) {
      if (!version || typeof version !== 'object' ||
          !hasText(version.id) || !Number.isSafeInteger(version.version) || version.version < 1) continue;
      const key = JSON.stringify([version.id, version.version]);
      if (!retainedVersionsByReference.has(key)) retainedVersionsByReference.set(key, []);
      retainedVersionsByReference.get(key).push({ version, safe: creationSafe });
    }
  }

  const publicationsByReference = new Map();
  events.forEach((event, index) => {
    if (event?.type !== 'publish' || !hasText(event.creationId) ||
        !Number.isSafeInteger(event.version) || event.version < 1) return;
    const key = JSON.stringify([event.creationId, event.version]);
    if (!publicationsByReference.has(key)) publicationsByReference.set(key, []);
    publicationsByReference.get(key).push({ event, index, safe: !unsafeEvents.has(event) });
  });

  const artifactStatusFor = (event, index, idField, versionField) => {
    if (unsafeEvents.has(event)) return 'invalid';
    const creationId = event?.[idField];
    const version = event?.[versionField];
    const hasCreationId = hasText(creationId);
    const hasVersion = version !== undefined && version !== null;
    if (!hasCreationId && !hasVersion) return 'not-provided';
    if (!hasCreationId || !Number.isSafeInteger(version) || version < 1) return 'invalid';

    const key = JSON.stringify([creationId, version]);
    const candidates = publicationsByReference.get(key) || [];
    if (!candidates.length) return 'unavailable';
    if (candidates.length !== 1 || !eventIdentityIsUnique(candidates[0].event, eventIdCounts)) return 'ambiguous';
    const candidate = candidates[0];
    if (!candidate.safe || unsafeEvents.has(candidate.event)) return 'invalid';
    if (candidate.index >= index) return 'not-earlier';
    if (!validTime(candidate.event.at) || !validTime(event.at) ||
        Date.parse(candidate.event.at) > Date.parse(event.at)) return 'timestamp-conflict';

    const retained = retainedVersionsByReference.get(key) || [];
    if (!retained.length) return 'unavailable';
    if (retained.length !== 1) return 'ambiguous';
    if (!retained[0].safe) return 'invalid';
    const retainedVersion = retained[0].version;
    if (!hasText(candidate.event.actor?.id) || candidate.event.actor.role !== 'founder') return 'invalid';
    if (!validTime(retainedVersion.publishedAt) ||
        Date.parse(retainedVersion.publishedAt) !== Date.parse(candidate.event.at)) return 'timestamp-conflict';
    return 'linked';
  };

  const proposalByMoonshot = new Map();
  events.forEach((event, index) => {
    if (unsafeEvents.has(event) || !isValidMoonshotProposal(event) ||
        !eventIdentityIsUnique(event, eventIdCounts) || proposalCounts.get(event.moonshotId) !== 1) return;
    proposalByMoonshot.set(event.moonshotId, { event, index });
  });

  const reportById = new Map();
  events.forEach((event, index) => {
    if (unsafeEvents.has(event) || !validReport(event) ||
        !eventIdentityIsUnique(event, eventIdCounts) || reportCounts.get(event.reportId) !== 1) return;
    const proposal = proposalByMoonshot.get(event.moonshotId);
    if (!proposal || proposal.index >= index || Date.parse(proposal.event.at) > Date.parse(event.at)) return;
    reportById.set(event.reportId, { event, index });
  });

  return events
    .map((event, index) => {
      if (!RESEARCH_TYPES.has(event?.type)) return null;
      const recordSafe = !unsafeEvents.has(event);
      const eventIdUnique = eventIdentityIsUnique(event, eventIdCounts);
      let proposal = null;
      let proposalStatus = 'not-applicable';

      if (!recordSafe) {
        proposalStatus = 'ambiguous';
      } else if (event.type === 'moonshot-proposed') {
        proposalStatus = eventIdUnique && isValidMoonshotProposal(event) && proposalCounts.get(event.moonshotId) === 1
          ? 'unique'
          : 'ambiguous';
      } else if (!eventIdUnique) {
        proposalStatus = 'ambiguous';
      } else if (!hasText(event.moonshotId)) {
        proposalStatus = 'missing';
      } else if (proposalCounts.get(event.moonshotId) > 1) {
        proposalStatus = 'ambiguous';
      } else {
        const candidate = proposalByMoonshot.get(event.moonshotId);
        if (!candidate) proposalStatus = 'missing';
        else if (candidate.index >= index) proposalStatus = 'not-earlier';
        else if (!validTime(event.at) || Date.parse(candidate.event.at) > Date.parse(event.at)) proposalStatus = 'timestamp-conflict';
        else {
          proposal = candidate.event;
          proposalStatus = 'linked';
        }
      }

      let targetReport = null;
      let targetReportStatus = 'not-applicable';
      if (event.type === 'experiment-challenged') {
        if (!recordSafe || !eventIdUnique || !hasText(event.challengeId) || challengeCounts.get(event.challengeId) !== 1) targetReportStatus = 'ambiguous';
        else if (!hasText(event.actor?.id) || !['founder', 'witness'].includes(event.actor.role) ||
            !['missing-evidence', 'methodology', 'contradiction', 'reproducibility', 'scope', 'other'].includes(event.challengeType) ||
            !hasText(event.challengeText) || Array.from(event.challengeText).length > 1000) targetReportStatus = 'invalid-challenge';
        else if (!hasText(event.reportId)) targetReportStatus = 'missing';
        else if (reportCounts.get(event.reportId) > 1) targetReportStatus = 'ambiguous';
        else {
          const candidate = reportById.get(event.reportId);
          if (!candidate) targetReportStatus = 'unavailable';
          else if (candidate.index >= index) targetReportStatus = 'not-earlier';
          else if (candidate.event.moonshotId !== event.moonshotId) targetReportStatus = 'mismatch';
          else if (sameActor(candidate.event.actor, event.actor)) targetReportStatus = 'same-actor';
          else if (!validTime(event.at) || Date.parse(candidate.event.at) > Date.parse(event.at)) targetReportStatus = 'timestamp-conflict';
          else {
            targetReport = candidate.event;
            targetReportStatus = 'linked';
          }
        }
      }

      return Object.freeze({
        ...event,
        _projection: Object.freeze({
          index,
          eventIdUnique,
          recordSafe,
          proposal,
          proposalStatus,
          sourceStatus: event.type === 'moonshot-proposed' ? artifactStatusFor(event, index, 'sourceCreationId', 'sourceVersion') : 'not-applicable',
          evidenceStatus: event.type === 'experiment-reported' || event.type === 'experiment-challenged'
            ? artifactStatusFor(event, index, 'evidenceCreationId', 'evidenceVersion')
            : 'not-applicable',
          targetReport,
          targetReportStatus
        })
      });
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = validTime(left.at) ? Date.parse(left.at) : Number.NEGATIVE_INFINITY;
      const rightTime = validTime(right.at) ? Date.parse(right.at) : Number.NEGATIVE_INFINITY;
      return rightTime - leftTime || right._projection.index - left._projection.index;
    });
}


// A Source Observatory export is an author-entered notebook, not a verified
// source package. Keep its schema strict so imports cannot silently smuggle
// execution, verification, or approval fields into the shared world.
export const SOURCE_OBSERVATION_SOURCE_KINDS = Object.freeze([
  'unspecified',
  'direct-observation',
  'primary-source',
  'secondary-source',
  'tool-output',
  'user-report',
  'model-assertion'
]);
const sourceObservationSourceKinds = new Set(SOURCE_OBSERVATION_SOURCE_KINDS);
const sourceObservationChallengeTypes = new Set(['missing-evidence','methodology','contradiction','reproducibility','scope','other']);
const sourceObservationExportKeys = ['assurance', 'observations', 'schema'];
const sourceObservationAssuranceKeys = ['execution', 'independentVerification', 'modelAssertions', 'sourceRetrieval'];
const sourceObservationNoteKeys = ['claim', 'falsifier', 'nextTest', 'source', 'sourceKind', 'uncertainty'];
const sourceObservationExactKeys = (value, keys) =>
  value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const sourceObservationRequiredText = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > 500) {
    throw new TypeError(label + ' must be 1–500 characters.');
  }
  return value.trim();
};
const sourceObservationOptionalText = (value, label) => {
  if (value === null) return null;
  if (typeof value !== 'string' || Array.from(value.trim()).length > 500) {
    throw new TypeError(label + ' must be null or at most 500 characters.');
  }
  return value.trim() || null;
};

export function parseSourceObservatoryExport(input) {
  let parsed = input;
  if (typeof input === 'string') {
    try { parsed = JSON.parse(input); }
    catch { throw new TypeError('The selected file is not valid JSON.'); }
  }
  const snapshot = snapshotData(parsed);
  const value = snapshot.value;
  if (!snapshot.safe || !sourceObservationExactKeys(value, sourceObservationExportKeys) ||
      value.schema !== 'ngl.source-observatory.v2') {
    throw new TypeError('Choose an exact ngl.source-observatory.v2 export.');
  }
  const assurance = value.assurance;
  if (!sourceObservationExactKeys(assurance, sourceObservationAssuranceKeys) ||
      assurance.sourceRetrieval !== 'NOT_PERFORMED' ||
      assurance.independentVerification !== 'NOT_PERFORMED' ||
      assurance.modelAssertions !== 'LEADS_ONLY' ||
      assurance.execution !== 'NOT_EXECUTED') {
    throw new TypeError('The export assurance block is missing or has been altered.');
  }
  const rows = snapshotArrayEntries(value.observations, 100);
  if (rows.length < 1 || rows.length > 100 || rows.some(row => !row.safe)) {
    throw new TypeError('An export must contain 1–100 bounded observations.');
  }
  const observations = rows.map((entry, index) => {
    const row = entry.value;
    if (!sourceObservationExactKeys(row, sourceObservationNoteKeys)) {
      throw new TypeError('Observation ' + (index + 1) + ' has an unsupported shape.');
    }
    if (!sourceObservationSourceKinds.has(row.sourceKind)) {
      throw new TypeError('Observation ' + (index + 1) + ' has an unknown source class.');
    }
    return Object.freeze({
      claim: sourceObservationRequiredText(row.claim, 'Claim'),
      sourceKind: row.sourceKind,
      source: sourceObservationRequiredText(row.source, 'Source/attribution'),
      falsifier: sourceObservationOptionalText(row.falsifier, 'Falsifier'),
      uncertainty: sourceObservationOptionalText(row.uncertainty, 'Uncertainty'),
      nextTest: sourceObservationOptionalText(row.nextTest, 'Next test')
    });
  });
  return Object.freeze({
    schema: value.schema,
    assurance: Object.freeze({
      sourceRetrieval: assurance.sourceRetrieval,
      independentVerification: assurance.independentVerification,
      modelAssertions: assurance.modelAssertions,
      execution: assurance.execution
    }),
    observations: Object.freeze(observations)
  });
}

// This normalized-note identity is not a receipt for the exported file and
// does not prove that its contents originated from the selected artifact.
export function sourceObservationRequestMaterial({
  actorId, actorRole, creationId, version, claim, sourceKind, source,
  falsifier = null, uncertainty = null, nextTest = null
}) {
  const required = (value, label) => {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(label + ' is required.');
    return value.trim();
  };
  const optional = (value, label) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') throw new TypeError(label + ' must be text or null.');
    return value.trim() || null;
  };
  if (!['founder', 'witness'].includes(actorRole)) throw new TypeError('Actor role must be Founder or Witness.');
  if (!Number.isSafeInteger(version) || version < 1) throw new TypeError('Version must be a positive integer.');
  if (!sourceObservationSourceKinds.has(sourceKind)) throw new TypeError('Unknown source class.');
  return JSON.stringify({
    protocol: 'ngl.source-observation-id.v1',
    actorId: required(actorId, 'Actor ID'),
    actorRole: required(actorRole, 'Actor role'),
    creationId: required(creationId, 'Creation ID'),
    version,
    claim: sourceObservationRequiredText(claim, 'Claim'),
    sourceKind,
    source: sourceObservationRequiredText(source, 'Source/attribution'),
    falsifier: optional(falsifier, 'Falsifier'),
    uncertainty: optional(uncertainty, 'Uncertainty'),
    nextTest: optional(nextTest, 'Next test')
  });
}

export function projectSourceObservationRecords(eventsInput, creationsInput) {
  const eventEntries = snapshotArrayEntries(eventsInput, MAX_EVENT_COUNT);
  const creationEntries = snapshotArrayEntries(creationsInput, MAX_RETAINED_CREATIONS);
  const events = eventEntries.map(entry => entry.value);
  const creations = creationEntries.map(entry => entry.value);
  const unsafeEvents = new WeakSet();
  const unsafeCreations = new WeakSet();
  eventEntries.forEach(entry => {
    if (!entry.safe && entry.value && typeof entry.value === 'object') unsafeEvents.add(entry.value);
  });
  creationEntries.forEach(entry => {
    if (!entry.safe && entry.value && typeof entry.value === 'object') unsafeCreations.add(entry.value);
  });
  const eventIdCounts = countBy(events, 'id', hasText);
  const observationEvents = events.filter(event => event?.type === 'source-observation-recorded');
  const observationIdCounts = countBy(observationEvents, 'observationId', hasText);
  const sourceObservationChallengeEvents = events.filter(event => event?.type === 'source-observation-challenged');
  const challengeIdCounts = countBy(sourceObservationChallengeEvents, 'challengeId', hasText);
  const challengesByObservation = new Map();
  events.forEach((event, index) => {
    if (event?.type !== 'source-observation-challenged' || !hasText(event.observationId)) return;
    const rowsForObservation = challengesByObservation.get(event.observationId) || [];
    rowsForObservation.push({ event, index });
    challengesByObservation.set(event.observationId, rowsForObservation);
  });
  const versions = new Map();
  for (const creation of creations) {
    if (!creation || unsafeCreations.has(creation) || typeof creation.id !== 'string' || !creation.id) continue;
    for (const version of [...rows(creation.versions), creation]) {
      if (!version || !Number.isSafeInteger(version.version) || version.version < 1 ||
          (version.kind ?? creation.kind) !== 'observatory') continue;
      const key = JSON.stringify([creation.id, version.version]);
      if (versions.has(key)) versions.set(key, null);
      else versions.set(key, { creation, version });
    }
  }
  const publications = new Map();
  events.forEach((event, index) => {
    if (unsafeEvents.has(event) || event?.type !== 'publish' || !hasText(event.creationId) ||
        !Number.isSafeInteger(event.version) || event.version < 1) return;
    const key = JSON.stringify([event.creationId, event.version]);
    const rowsForVersion = publications.get(key) || [];
    rowsForVersion.push({ event, index });
    publications.set(key, rowsForVersion);
  });
  const records = [];
  events.forEach((event, index) => {
    if (event?.type !== 'source-observation-recorded') return;
    const digest = typeof event.observationId === 'string' &&
      event.observationId.startsWith('source-observation-')
      ? event.observationId.slice('source-observation-'.length) : '';
    const optionalText = value => value === null ||
      (typeof value === 'string' && value.trim() && Array.from(value).length <= 500);
    const validShape = !unsafeEvents.has(event) &&
      typeof event.id === 'string' && event.id &&
      typeof event.actor?.id === 'string' && event.actor.id &&
      ['founder', 'witness'].includes(event.actor.role) &&
      isStrictTimestamp(event.at) &&
      typeof event.creationId === 'string' && event.creationId &&
      Number.isSafeInteger(event.version) && event.version > 0 &&
      typeof event.claim === 'string' && event.claim.trim() && Array.from(event.claim).length <= 500 &&
      sourceObservationSourceKinds.has(event.sourceKind) &&
      typeof event.source === 'string' && event.source.trim() && Array.from(event.source).length <= 500 &&
      optionalText(event.falsifier) && optionalText(event.uncertainty) && optionalText(event.nextTest) &&
      event.originSchema === 'ngl.source-observatory.v2' &&
      event.bindingMode === 'USER_SELECTED' &&
      event.sourceRetrieval === 'NOT_PERFORMED' &&
      event.independentVerification === 'NOT_PERFORMED' &&
      event.modelAssertions === 'LEADS_ONLY' &&
      event.execution === 'NOT_EXECUTED' &&
      /^[a-f0-9]{64}$/.test(digest) &&
      event.normalizedRecordDigest === digest &&
      (event.requestId === undefined || event.requestId === event.observationId) &&
      (event.actionResult === undefined ||
        (sourceObservationExactKeys(event.actionResult, ['duplicate', 'observationId']) &&
          event.actionResult.duplicate === false && event.actionResult.observationId === event.observationId));
    let projectionStatus = 'linked';
    let projectionReason = null;
    if (!validShape) {
      projectionStatus = 'malformed';
      projectionReason = 'The retained note does not match the bounded Source Observatory record schema.';
    } else if (eventIdCounts.get(event.id) !== 1 || observationIdCounts.get(event.observationId) !== 1) {
      projectionStatus = 'ambiguous';
      projectionReason = 'The event or normalized note identity is repeated.';
    }
    const key = JSON.stringify([event.creationId, event.version]);
    const target = versions.get(key);
    const publicationRows = publications.get(key) || [];
    if (projectionStatus === 'linked' && target === undefined) {
      projectionStatus = 'unavailable';
      projectionReason = 'The selected Source Observatory version is not retained.';
    } else if (projectionStatus === 'linked' && target === null) {
      projectionStatus = 'ambiguous';
      projectionReason = 'The selected Source Observatory version has duplicate retained identities.';
    } else if (projectionStatus === 'linked' && publicationRows.length !== 1) {
      projectionStatus = publicationRows.length ? 'ambiguous' : 'unavailable';
      projectionReason = 'The selected version does not have one unique retained publication event.';
    } else if (projectionStatus === 'linked' &&
      (publicationRows[0].index >= index || unsafeEvents.has(publicationRows[0].event) || publicationRows[0].event.actor?.role !== 'founder' ||
       !isStrictTimestamp(target.version.publishedAt) ||
       publicationRows[0].event.at !== target.version.publishedAt ||
       Date.parse(event.at) < Date.parse(publicationRows[0].event.at))) {
      projectionStatus = 'unavailable';
      projectionReason = 'The source publication does not precede this note with a matching retained timestamp.';
    }
    const challenges = (challengesByObservation.get(event.observationId) || []).filter(({ event: challenge, index: challengeIndex }) =>
      !unsafeEvents.has(challenge) && typeof challenge.id === 'string' && challenge.id && eventIdCounts.get(challenge.id) === 1 &&
      typeof challenge.challengeId === 'string' && challengeIdCounts.get(challenge.challengeId) === 1 &&
      typeof challenge.actor?.id === 'string' && challenge.actor.id && ['founder', 'witness'].includes(challenge.actor.role) &&
      challenge.actor.id !== event.actor?.id && challenge.creationId === event.creationId && challenge.version === event.version &&
      sourceObservationChallengeTypes.has(challenge.challengeType) && typeof challenge.challengeText === 'string' &&
      challenge.challengeText.trim() && Array.from(challenge.challengeText).length <= 1000 &&
      isStrictTimestamp(challenge.at) && challengeIndex > index && Date.parse(event.at) <= Date.parse(challenge.at)
    ).map(({ event: challenge }) => Object.freeze({
      id: challenge.id, challengeId: challenge.challengeId, observationId: challenge.observationId,
      creationId: challenge.creationId, version: challenge.version, challengeType: challenge.challengeType,
      challengeText: challenge.challengeText, actor: challenge.actor, at: challenge.at
    }));
    const warning = event.sourceKind === 'model-assertion'
      ? 'Model assertions are leads only, not evidence.'
      : event.sourceKind === 'tool-output'
        ? 'Tool output is attributed output, not independent verification.'
        : 'This is an author-entered note, not an independently verified claim.';
    records.push(Object.freeze({
      id: event.id,
      observationId: event.observationId,
      creationId: event.creationId,
      version: event.version,
      claim: event.claim,
      sourceKind: event.sourceKind,
      source: event.source,
      falsifier: event.falsifier,
      uncertainty: event.uncertainty,
      nextTest: event.nextTest,
      actor: event.actor,
      at: event.at,
      originSchema: event.originSchema,
      bindingMode: event.bindingMode,
      sourceRetrieval: event.sourceRetrieval,
      independentVerification: event.independentVerification,
      modelAssertions: event.modelAssertions,
      execution: event.execution,
      normalizedRecordDigest: event.normalizedRecordDigest,
      challenges: Object.freeze(challenges),
      targetTitle: target?.version?.title || target?.creation?.title || null,
      projectionStatus,
      projectionReason,
      warning
    }));
  });
  return Object.freeze(records.sort((a, b) => String(b.at).localeCompare(String(a.at))));
}
