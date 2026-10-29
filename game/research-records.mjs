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
