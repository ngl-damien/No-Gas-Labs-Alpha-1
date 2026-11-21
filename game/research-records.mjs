import { isStrictTimestamp } from './timestamps.mjs';
import { GITHUB_SOURCE_ARCHIVE_PREDICATE_EVALUATOR, readGitHubSourceArchiveMetadata } from './artifacts.mjs';

const rows = value => {
  try { return Array.isArray(value) ? value : []; } catch { return []; }
};
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const validTime = isStrictTimestamp;
export const SOURCE_PREDICATE_PUBLIC_RETENTION_ACK_VERSION = 'ngl.source-predicate-public-retention.v1';
export const SOURCE_PREDICATE_PUBLIC_RETENTION_ACK_REQUIRED_AFTER = '2026-11-17T04:00:00.000Z';
export function hasSourcePredicatePublicRetentionAcknowledgement(event) {
  const version = event?.publicRetentionAcknowledgementVersion;
  if (version === SOURCE_PREDICATE_PUBLIC_RETENTION_ACK_VERSION) return true;
  if (version !== undefined) return false;
  // Preserve pre-enforcement event history without allowing new events to omit
  // the explicit notice version. New model actions always require the version.
  return validTime(event?.at) &&
    Date.parse(event.at) < Date.parse(SOURCE_PREDICATE_PUBLIC_RETENTION_ACK_REQUIRED_AFTER);
}
export function sameResearchActor(left, right) {
  return typeof left?.id === 'string' && left.id.length > 0 &&
    typeof right?.id === 'string' && right.id.length > 0 &&
    ['founder', 'witness'].includes(left.role) && left.role === right.role && left.id === right.id;
}

const RESEARCH_TYPES = new Set([
  'moonshot-proposed',
  'experiment-reported',
  'experiment-challenged',
  'experiment-challenge-responded',
  'source-archive-predicate-evaluated'
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

export function retainedEventHistoryPositions(eventsInput, {
  allowLocalPositions = true,
  revision,
  revisionPresent = false
} = {}) {
  const events = Array.isArray(eventsInput) ? eventsInput : [];
  let hasMetadata = false;
  const positions = [];
  for (let index = 0; index < events.length; index += 1) {
    let slot;
    try { slot = Object.getOwnPropertyDescriptor(events, String(index)); }
    catch { return Array.from({ length: events.length }, () => null); }
    if (!slot || !Object.hasOwn(slot, 'value')) {
      positions.push(undefined);
      continue;
    }
    const event = slot.value;
    if (!event || typeof event !== 'object') {
      positions.push(undefined);
      continue;
    }
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(event, 'historyPosition'); }
    catch {
      hasMetadata = true;
      positions.push(undefined);
      continue;
    }
    if (!descriptor) {
      positions.push(undefined);
      continue;
    }
    hasMetadata = true;
    positions.push(Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined);
  }
  if (hasMetadata) {
    let prior = 0;
    const valid = positions.length === events.length && positions.every(position => {
      if (!Number.isSafeInteger(position) || position <= prior ||
          (revisionPresent && (!Number.isSafeInteger(revision) || revision < position))) return false;
      prior = position;
      return true;
    });
    return valid ? positions : Array.from({ length: events.length }, () => null);
  }
  if (allowLocalPositions && (!revisionPresent ||
      (Number.isSafeInteger(revision) && revision >= 0 && revision === events.length))) {
    return Array.from({ length: events.length }, (_, index) => index + 1);
  }
  return Array.from({ length: events.length }, () => null);
}
export function retainedWorldEventHistoryPositions(world, eventsInput) {
  let revisionPresent = false;
  let revision;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(world ?? {}, 'revision');
    if (descriptor) {
      revisionPresent = true;
      if (Object.hasOwn(descriptor, 'value')) revision = descriptor.value;
    }
  } catch {
    revisionPresent = true;
  }
  const events = Array.isArray(eventsInput) ? eventsInput : [];
  const allowLocalPositions = !revisionPresent ||
    (Number.isSafeInteger(revision) && revision >= 0 && revision === events.length);
  return retainedEventHistoryPositions(events, { allowLocalPositions, revision, revisionPresent });
}

export function retainedWorldEventHistoryOptions(world, eventsInput) {
  let revisionPresent = false;
  let revision;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(world ?? {}, 'revision');
    if (descriptor) {
      revisionPresent = true;
      if (Object.hasOwn(descriptor, 'value')) revision = descriptor.value;
    }
  } catch {
    revisionPresent = true;
  }
  const positions = retainedWorldEventHistoryPositions(world, eventsInput);
  return Object.freeze({
    allowLocalPositions: positions.length === (Array.isArray(eventsInput) ? eventsInput.length : 0) &&
      positions.every((position, index) => position === index + 1),
    revision,
    revisionPresent
  });
}

/**
 * Response-only global positions may be imported as canonical history only
 * when they describe the complete stream exactly (1..revision). Actor-filtered
 * snapshots retain gaps and must never be promoted to canonical world state.
 */
export function stripCompleteResponseHistoryPositions(world) {
  let events;
  let revision;
  try {
    const source = world ?? {};
    const eventsDescriptor = Object.getOwnPropertyDescriptor(source, 'events');
    if (!eventsDescriptor) return { status: 'absent', world };
    if (!Object.hasOwn(eventsDescriptor, 'value') || !Array.isArray(eventsDescriptor.value)) {
      return { status: 'invalid', world };
    }
    events = eventsDescriptor.value;
    const revisionDescriptor = Object.getOwnPropertyDescriptor(source, 'revision');
    if (revisionDescriptor && Object.hasOwn(revisionDescriptor, 'value')) revision = revisionDescriptor.value;
  } catch {
    return { status: 'invalid', world };
  }

  let hasMetadata = false;
  for (let index = 0; index < events.length; index += 1) {
    let slot;
    try { slot = Object.getOwnPropertyDescriptor(events, String(index)); }
    catch { return { status: 'invalid', world }; }
    if (!slot || !Object.hasOwn(slot, 'value')) continue;
    const event = slot.value;
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(event, 'historyPosition'); }
    catch { return { status: 'invalid', world }; }
    if (descriptor) hasMetadata = true;
  }
  if (!hasMetadata) return { status: 'absent', world };

  const positions = retainedWorldEventHistoryPositions(world, events);
  if (!Number.isSafeInteger(revision) || revision !== events.length ||
      positions.length !== events.length ||
      positions.some((position, index) => position !== index + 1)) return { status: 'invalid', world };

  const canonicalEvents = [];
  for (let index = 0; index < events.length; index += 1) {
    let slot;
    try { slot = Object.getOwnPropertyDescriptor(events, String(index)); }
    catch { return { status: 'invalid', world }; }
    if (!slot || !Object.hasOwn(slot, 'value')) return { status: 'invalid', world };
    const event = slot.value;
    if (!event || typeof event !== 'object' || Array.isArray(event)) return { status: 'invalid', world };
    let copy;
    try { copy = { ...event }; }
    catch { return { status: 'invalid', world }; }
    delete copy.historyPosition;
    canonicalEvents.push(copy);
  }
  let canonicalWorld;
  try { canonicalWorld = { ...world, events: canonicalEvents }; }
  catch { return { status: 'invalid', world }; }
  return { status: 'stripped', world: canonicalWorld };
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
export function projectResearchRecords(input, retainedCreations = [], {
  allowLocalPositions = true,
  revision,
  revisionPresent = false
} = {}) {
  const eventEntries = snapshotArrayEntries(input, MAX_EVENT_COUNT);
  const events = eventEntries.map(entry => entry.value);
  const historyPositions = retainedEventHistoryPositions(events, { allowLocalPositions, revision, revisionPresent });
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
  const responseCounts = countBy(events.filter(event => event?.type === 'experiment-challenge-responded'), 'responseId', value => hasText(value));
  const responseChallengeCounts = countBy(events.filter(event => event?.type === 'experiment-challenge-responded'), 'challengeId', value => hasText(value));
  const predicateCounts = countBy(events.filter(event => event?.type === 'source-archive-predicate-evaluated'), 'predicateId', value => hasText(value));

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
    // Retained event position establishes sequence; timestamps remain strict metadata.
    // A clock regression must not invalidate a source appended before this record.
    if (!validTime(candidate.event.at) || !validTime(event.at)) return 'timestamp-conflict';

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

  const predicateStatusFor = (event, index) => {
    if (event?.type !== 'source-archive-predicate-evaluated') return 'not-applicable';
    if (unsafeEvents.has(event)) return 'invalid';
    if (!eventIdentityIsUnique(event, eventIdCounts) || !hasText(event.predicateId) ||
        predicateCounts.get(event.predicateId) !== 1) return 'ambiguous';
    if (!validTime(event.at) || !hasSourcePredicatePublicRetentionAcknowledgement(event) || !hasText(event.actor?.id) ||
        !['founder', 'witness'].includes(event.actor.role) ||
        !hasText(event.creationId) || !Number.isSafeInteger(event.version) || event.version < 1 ||
        !['contains-literal', 'does-not-contain-literal'].includes(event.predicateKind) ||
        !hasText(event.literal) || event.literal !== event.literal.trim() ||
        Array.from(event.literal).length > 256 || !['MATCH', 'NO_MATCH'].includes(event.outcome) ||
        !/^[a-f0-9]{64}$/.test(event.sourceSha256 || '') ||
        !Number.isSafeInteger(event.sourceSize) || event.sourceSize < 0 || event.sourceSize > 64 * 1024 ||
        event.retrievalMode !== 'SERVER_RECHECKED' ||
        event.evaluator !== GITHUB_SOURCE_ARCHIVE_PREDICATE_EVALUATOR ||
        event.observedBy !== 'shared-game-server' || event.executionContext !== 'shared-server' ||
        event.sourceTruth !== 'NOT_ASSESSED' || event.independentVerification !== 'NOT_PERFORMED' ||
        event.modelAssertions !== 'LEADS_ONLY') return 'invalid';
    const artifactStatus = artifactStatusFor(event, index, 'creationId', 'version');
    if (artifactStatus !== 'linked') return artifactStatus;
    const retained = retainedVersionsByReference.get(JSON.stringify([event.creationId, event.version])) || [];
    if (retained.length !== 1 || !retained[0].safe) return retained.length > 1 ? 'ambiguous' : 'unavailable';
    let metadata;
    try { metadata = readGitHubSourceArchiveMetadata(retained[0].version.html); } catch { return 'invalid'; }
    if (metadata.retrievalMode !== 'SERVER_RECHECKED') return 'invalid';
    if (metadata.sha256 !== event.sourceSha256 || metadata.size !== event.sourceSize) return 'mismatch';
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
    if (!proposal || proposal.index >= index) return;
    reportById.set(event.reportId, { event, index });
  });
  const challengeById = new Map();
  events.forEach((event, index) => {
    if (unsafeEvents.has(event) || event?.type !== 'experiment-challenged' ||
        !eventIdentityIsUnique(event, eventIdCounts) || !hasText(event.challengeId) ||
        challengeCounts.get(event.challengeId) !== 1 || !hasText(event.reportId)) return;
    const report = reportById.get(event.reportId);
    if (!report || report.index >= index || report.event.moonshotId !== event.moonshotId ||
        sameResearchActor(report.event.actor, event.actor) || !validTime(event.at)) return;
    challengeById.set(event.challengeId, { event, index, report });
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
      } else if (event.type === 'source-archive-predicate-evaluated') {
        proposalStatus = 'not-applicable';
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
        else if (!validTime(event.at)) proposalStatus = 'timestamp-conflict';
        else {
          proposal = candidate.event;
          proposalStatus = 'linked';
        }
      }

      let targetReport = null;
      let targetReportStatus = 'not-applicable';
      let targetChallenge = null;
      let targetChallengeStatus = 'not-applicable';
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
          else if (sameResearchActor(candidate.event.actor, event.actor)) targetReportStatus = 'same-actor';
          else if (!validTime(event.at)) targetReportStatus = 'timestamp-conflict';
          else {
            targetReport = candidate.event;
            targetReportStatus = 'linked';
          }
        }
      } else if (event.type === 'experiment-challenge-responded') {
        if (!recordSafe || !eventIdUnique || !hasText(event.responseId) ||
            responseCounts.get(event.responseId) !== 1 || !hasText(event.challengeId) ||
            responseChallengeCounts.get(event.challengeId) !== 1) targetChallengeStatus = 'ambiguous';
        else if (!hasText(event.reportId)) targetChallengeStatus = 'missing';
        else if (challengeCounts.get(event.challengeId) !== 1) targetChallengeStatus = 'ambiguous';
        else {
          const candidate = challengeById.get(event.challengeId);
          if (!candidate) targetChallengeStatus = 'unavailable';
          else if (candidate.index >= index) targetChallengeStatus = 'not-earlier';
          else if (candidate.event.reportId !== event.reportId ||
              candidate.event.moonshotId !== event.moonshotId) targetChallengeStatus = 'mismatch';
          else if (!candidate.report || candidate.report.index >= candidate.index) targetChallengeStatus = 'not-earlier';
          else if (!sameResearchActor(candidate.report.event.actor, event.actor)) targetChallengeStatus = 'wrong-author';
          else if (!validTime(event.at)) targetChallengeStatus = 'timestamp-conflict';
          else if (!hasText(event.responseText) || Array.from(event.responseText).length > 1000) targetChallengeStatus = 'invalid-response';
          else {
            targetReport = candidate.report.event;
            targetReportStatus = 'linked';
            targetChallenge = candidate.event;
            targetChallengeStatus = 'linked';
          }
        }
      }

      return Object.freeze({
        ...event,
        historyPosition: historyPositions[index],
        _projection: Object.freeze({
          index,
          historyPosition: historyPositions[index],
          eventIdUnique,
          recordSafe,
          reportIdUnique: event.type === 'experiment-reported'
            ? (hasText(event.reportId) ? reportCounts.get(event.reportId) === 1 : null)
            : null,
          proposal,
          proposalStatus,
          sourceStatus: event.type === 'moonshot-proposed' ? artifactStatusFor(event, index, 'sourceCreationId', 'sourceVersion') : event.type === 'source-archive-predicate-evaluated' ? artifactStatusFor(event, index, 'creationId', 'version') : 'not-applicable',
          predicateStatus: predicateStatusFor(event, index),
          evidenceStatus: event.type === 'experiment-reported' || event.type === 'experiment-challenged'
            ? artifactStatusFor(event, index, 'evidenceCreationId', 'evidenceVersion')
            : 'not-applicable',
          targetReport,
          targetReportStatus,
          targetChallenge,
          targetChallengeStatus
        })
      });
    })
    .filter(Boolean)
    // Keep the Archive newest-first, but order by retained event position rather than clocks.
    .sort((left, right) => right._projection.index - left._projection.index);
}


/**
 * Group linked Source Archive literal predicates into actor-scoped operator contrasts.
 *
 * A complete pair is one unique contains-literal and one unique
 * does-not-contain-literal against the same retained creation/version/SHA-256
 * and the same exact literal, with opposite MATCH/NO_MATCH outcomes.
 * Repeating an identical predicate, changing the literal, actor, or source
 * version cannot complete the objective. These byte outcomes are not claim
 * verdicts or source-truth findings.
 */
/**
 * Group linked Source Archive literal predicates into actor-scoped operator contrasts.
 *
 * Supplying actorInput returns only that actor's groups. Omitting it returns
 * separate groups for every valid actor, without ever combining their events.
 * A complete pair uses both operators, one exact literal, one retained source
 * version, and opposite outcomes. These byte outcomes are not claim verdicts.
 */
export function projectSourceArchivePredicateContrasts(input, actorInput) {
  const allActors = actorInput === undefined;
  const actorSnapshot = allActors ? { value: null, safe: true } : snapshotData(actorInput);
  const viewer = actorSnapshot.value;
  if (!actorSnapshot.safe || (!allActors &&
      (!hasText(viewer?.id) || !['founder', 'witness'].includes(viewer?.role)))) {
    return Object.freeze([]);
  }

  const entries = snapshotArrayEntries(input, MAX_EVENT_COUNT);
  const orderedRecords = entries
    .filter(entry => entry.safe)
    .map(entry => entry.value)
    .filter(record =>
      record?.type === 'source-archive-predicate-evaluated' &&
      record?._projection?.recordSafe === true &&
      record?._projection?.eventIdUnique === true &&
      record?._projection?.predicateStatus === 'linked' &&
      Number.isSafeInteger(record?._projection?.index) &&
      record._projection.index >= 0 &&
      hasText(record.id) &&
      hasText(record.predicateId) &&
      hasText(record.actor?.id) &&
      ['founder', 'witness'].includes(record.actor.role) &&
      (allActors || sameResearchActor(record.actor, viewer)) &&
      hasText(record.creationId) &&
      Number.isSafeInteger(record.version) && record.version > 0 &&
      /^[a-f0-9]{64}$/.test(record.sourceSha256 || '') &&
      record.retrievalMode === 'SERVER_RECHECKED' &&
      ['contains-literal', 'does-not-contain-literal'].includes(record.predicateKind) &&
      hasText(record.literal) && record.literal === record.literal.trim() &&
      ['MATCH', 'NO_MATCH'].includes(record.outcome)
    )
    .sort((left, right) =>
      left._projection.index - right._projection.index ||
      left.id.localeCompare(right.id)
    );

  const predicateBuckets = new Map();
  for (const record of orderedRecords) {
    const actorKey = JSON.stringify([record.actor.id, record.actor.role]);
    const predicateKey = JSON.stringify([
      actorKey, record.creationId, record.version, record.sourceSha256,
      record.predicateKind, record.literal
    ]);
    let bucket = predicateBuckets.get(predicateKey);
    if (!bucket) {
      bucket = {
        actorId: record.actor.id,
        actorRole: record.actor.role,
        creationId: record.creationId,
        version: record.version,
        sourceSha256: record.sourceSha256,
        literal: record.literal,
        predicateKind: record.predicateKind,
        records: []
      };
      predicateBuckets.set(predicateKey, bucket);
    }
    bucket.records.push(record);
  }

  const groups = new Map();
  for (const bucket of predicateBuckets.values()) {
    const contrastKey = JSON.stringify([
      bucket.actorId, bucket.actorRole, bucket.creationId,
      bucket.version, bucket.sourceSha256, bucket.literal
    ]);
    let group = groups.get(contrastKey);
    if (!group) {
      group = {
        actorId: bucket.actorId,
        actorRole: bucket.actorRole,
        creationId: bucket.creationId,
        version: bucket.version,
        sourceSha256: bucket.sourceSha256,
        literal: bucket.literal,
        contains: null,
        doesNotContain: null
      };
      groups.set(contrastKey, group);
    }

    const outcomes = new Set(bucket.records.map(record => record.outcome));
    const operator = Object.freeze({
      predicateKind: bucket.predicateKind,
      record: bucket.records[0],
      records: Object.freeze(bucket.records),
      conflicted: outcomes.size !== 1
    });
    if (bucket.predicateKind === 'contains-literal') group.contains = operator;
    else group.doesNotContain = operator;
  }

  return Object.freeze([...groups.values()].map(group => {
    const operators = [group.contains, group.doesNotContain].filter(Boolean);
    const available = operators
      .filter(operator => !operator.conflicted)
      .map(operator => operator.record)
      .sort((left, right) => left._projection.index - right._projection.index);
    const conflictEvents = operators
      .filter(operator => operator.conflicted)
      .flatMap(operator => operator.records)
      .sort((left, right) => left._projection.index - right._projection.index);
    const complete = Boolean(
      available.length === 2 &&
      available[0].outcome !== available[1].outcome
    );
    // A contradictory duplicate invalidates its operator bucket. Same-outcome
    // repeats remain one objective input; every original event stays in history.
    const evidenceEvents = complete ? available : available.slice(0, 1);
    const evidenceIds = Object.freeze(evidenceEvents.map(record => record.id));
    const allEvents = operators.flatMap(operator => operator.records);
    const firstIndex = Math.min(...allEvents.map(record => record._projection.index));
    return Object.freeze({
      actorId: group.actorId,
      actorRole: group.actorRole,
      creationId: group.creationId,
      version: group.version,
      sourceSha256: group.sourceSha256,
      literal: group.literal,
      containsEventId: group.contains?.record.id ?? null,
      doesNotContainEventId: group.doesNotContain?.record.id ?? null,
      conflictedPredicateKinds: Object.freeze(
        operators.filter(operator => operator.conflicted).map(operator => operator.predicateKind)
      ),
      conflictEventIds: Object.freeze(conflictEvents.map(record => record.id)),
      conflictEvents: Object.freeze(conflictEvents),
      matchEventId: evidenceEvents.find(record => record.outcome === 'MATCH')?.id ?? null,
      noMatchEventId: evidenceEvents.find(record => record.outcome === 'NO_MATCH')?.id ?? null,
      progress: evidenceIds.length,
      complete,
      evidenceIds,
      evidenceEvents: Object.freeze(evidenceEvents),
      firstIndex
    });
  }).sort((left, right) =>
    left.firstIndex - right.firstIndex ||
    left.actorRole.localeCompare(right.actorRole) ||
    left.actorId.localeCompare(right.actorId) ||
    left.creationId.localeCompare(right.creationId) ||
    left.version - right.version ||
    left.literal.localeCompare(right.literal)
  ));
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

export function projectSourceObservationRecords(eventsInput, creationsInput, {
  allowLocalPositions = true,
  revision,
  revisionPresent = false
} = {}) {
  const eventEntries = snapshotArrayEntries(eventsInput, MAX_EVENT_COUNT);
  const creationEntries = snapshotArrayEntries(creationsInput, MAX_RETAINED_CREATIONS);
  const events = eventEntries.map(entry => entry.value);
  const creations = creationEntries.map(entry => entry.value);
  const historyPositions = retainedEventHistoryPositions(events, { allowLocalPositions, revision, revisionPresent });
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
  const sourceObservationResponseEvents = events.filter(event => event?.type === 'source-observation-challenge-responded');
  const responseIdCounts = countBy(sourceObservationResponseEvents, 'responseId', hasText);
  const challengesByObservation = new Map();
  events.forEach((event, index) => {
    if (event?.type !== 'source-observation-challenged' || !hasText(event.observationId)) return;
    const rowsForObservation = challengesByObservation.get(event.observationId) || [];
    rowsForObservation.push({ event, index });
    challengesByObservation.set(event.observationId, rowsForObservation);
  });
  const responsesByChallenge = new Map();
  events.forEach((event, index) => {
    if (event?.type !== 'source-observation-challenge-responded' || !hasText(event.challengeId)) return;
    const rowsForChallenge = responsesByChallenge.get(event.challengeId) || [];
    rowsForChallenge.push({ event, index });
    responsesByChallenge.set(event.challengeId, rowsForChallenge);
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
       publicationRows[0].event.at !== target.version.publishedAt)) {
      projectionStatus = 'unavailable';
      projectionReason = 'The source publication does not precede this note in retained history or its timestamp does not match the retained version.';
    }
    // The retained event index is the canonical sequence. Strict timestamps remain metadata;
    // a wall-clock regression must not hide later appended dissent or an author response.
    const challenges = (challengesByObservation.get(event.observationId) || []).filter(({ event: challenge, index: challengeIndex }) =>
      projectionStatus === 'linked' && !unsafeEvents.has(challenge) && typeof challenge.id === 'string' && challenge.id && eventIdCounts.get(challenge.id) === 1 &&
      typeof challenge.challengeId === 'string' && challengeIdCounts.get(challenge.challengeId) === 1 &&
      typeof challenge.actor?.id === 'string' && challenge.actor.id && ['founder', 'witness'].includes(challenge.actor.role) &&
      !sameResearchActor(challenge.actor, event.actor) && challenge.creationId === event.creationId && challenge.version === event.version &&
      sourceObservationChallengeTypes.has(challenge.challengeType) && typeof challenge.challengeText === 'string' &&
      challenge.challengeText.trim() && Array.from(challenge.challengeText).length <= 1000 &&
      isStrictTimestamp(challenge.at) && challengeIndex > index
    ).map(({ event: challenge, index: challengeIndex }) => {
      const responseRows = responsesByChallenge.get(challenge.challengeId) || [];
      const responses = responseRows.filter(({ event: response, index: responseIndex }) =>
        !unsafeEvents.has(response) && typeof response.id === 'string' && eventIdCounts.get(response.id) === 1 &&
        typeof response.responseId === 'string' && responseIdCounts.get(response.responseId) === 1 &&
        response.challengeId === challenge.challengeId && response.observationId === event.observationId &&
        response.creationId === event.creationId && response.version === event.version &&
        response.actor?.id === event.actor?.id && response.actor?.role === event.actor?.role &&
        typeof response.responseText === 'string' && response.responseText.trim() &&
        Array.from(response.responseText).length <= 1000 && isStrictTimestamp(response.at) &&
        responseIndex > challengeIndex
      ).map(({ event: response, index: responseIndex }) => Object.freeze({
        id: response.id, type: response.type, historyPosition: historyPositions[responseIndex], responseId: response.responseId,
        challengeId: response.challengeId, observationId: response.observationId,
        creationId: response.creationId, version: response.version,
        responseText: response.responseText, actor: response.actor, at: response.at
      }));
      const responseStatus = responseRows.length === 0 ? 'unanswered' :
        responseRows.length === 1 && responses.length === 1 ? 'answered' : 'ambiguous';
      return Object.freeze({
        id: challenge.id, historyPosition: historyPositions[challengeIndex], challengeId: challenge.challengeId, observationId: challenge.observationId,
        creationId: challenge.creationId, version: challenge.version, challengeType: challenge.challengeType,
        challengeText: challenge.challengeText, actor: challenge.actor, at: challenge.at,
        responseStatus, responses: Object.freeze(responses)
      });
    });
    const warning = event.sourceKind === 'model-assertion'
      ? 'Model assertions are leads only, not evidence.'
      : event.sourceKind === 'tool-output'
        ? 'Tool output is attributed output, not independent verification.'
        : 'This is an author-entered note, not an independently verified claim.';
    records.push(Object.freeze({
      id: event.id,
      historyPosition: historyPositions[index],
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
  // Preserve this event stream's retained append position; wall-clock timestamps are not its ordering authority.
  return Object.freeze(records.sort((a, b) => b.historyPosition - a.historyPosition));
}
