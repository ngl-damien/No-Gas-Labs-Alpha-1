import { isStrictTimestamp } from './timestamps.mjs';
import { projectChronicle } from './chronicle.mjs';
import { isDecisionDocketProjection, projectDecisionDocket } from './quests.mjs';

const WORLD_OBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_PROJECTED_EVENTS = 5000;
const MAX_VISIBLE_PER_LOCATION = 24;
const WORLD_EVENT_LOCATIONS = Object.freeze({
  draft: 'forge',
  repair: 'forge',
  publish: 'publication_house',
  contribute: 'town-square',
  report: 'evidence_archive',
  study: 'academy',
  'study-reviewed': 'academy',
  'moonshot-proposed': 'moonshot_field',
  'experiment-reported': 'moonshot_field',
  'experiment-challenged': 'evidence_archive',
  'collaborator-response-recorded': 'guild_hall',
  'guild-created': 'guild_hall',
  'guild-joined': 'guild_hall',
  'guild-left': 'guild_hall',
  'guild-disbanded': 'guild_hall',
  'message-posted': 'commons',
  'message-reported': 'commons',
  'message-moderated': 'commons',
  decision: 'decision_chamber',
  revocation: 'decision_chamber',
  revoke: 'decision_chamber',
  'policy-set': 'decision_chamber',
  'proposal-created': 'decision_chamber',
  'decision-attempted': 'decision_chamber',
  'expiry-observed': 'decision_chamber',
});
const KERNEL_EVENT_LOCATIONS = Object.freeze({
  claim: 'guild_hall',
  authorize: 'decision_chamber',
  execute: 'forge',
  observe: 'evidence_archive',
  adjudicate: 'decision_chamber',
  revoke: 'decision_chamber',
});
const RECORD_SLOTS = Object.freeze([108, 138, 168].flatMap(radius =>
  Array.from({ length: 16 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 16;
    return Object.freeze({
      dx: Math.round(Math.cos(angle) * radius),
      dy: Math.round(Math.sin(angle) * radius),
    });
  })
));

function ownDataValue(object, key) {
  if (!object || typeof object !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function safeArray(value) {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

function denseDataArray(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_PROJECTED_EVENTS) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1) return false;
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
    }
    return keys.every(key => key === 'length' ||
      (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < length));
  } catch {
    return false;
  }
}

/**
 * The public kernel snapshot is mappable only when its declared count, revision,
 * and delivered dense event array agree. A partial response is not an empty log.
 */
export function hasCompleteInstitutionKernelSnapshot(summary) {
  const kernel = ownDataValue(summary, 'kernel');
  const events = ownDataValue(kernel, 'events');
  const eventCount = ownDataValue(kernel, 'eventCount');
  const revision = ownDataValue(kernel, 'revision');
  const length = ownDataValue(events, 'length');
  return ownDataValue(summary, 'schema') === 'ngl.shared-institution-summary.v1' &&
    ownDataValue(kernel, 'schema') === 'ngl.institution.v1' &&
    safeArray(events) && denseDataArray(events) &&
    Number.isSafeInteger(eventCount) && eventCount === length &&
    Number.isSafeInteger(revision) && revision === eventCount;
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function locationFor(entry) {
  if (entry?.source === 'decision-docket') return 'decision_chamber';
  if (entry?.source === 'world') return WORLD_EVENT_LOCATIONS[entry.eventType] || null;
  if (entry?.source === 'kernel') return KERNEL_EVENT_LOCATIONS[entry.eventType] || null;
  return null;
}

// This is a navigation cue for review-worthy records, never a truth or authority verdict.
function markerToneFor(entry) {
  if (entry?.source === 'decision-docket' && ['REJECTED', 'DEFERRED', 'EXPIRED'].includes(entry.status)) return 'review';
  const type = entry?.eventType || '';
  const labels = (entry?.category || '') + ' ' + (entry?.title || '');
  const summary = (entry?.summary || '') + ' ' + (entry?.detail || '');
  if (/report|challenge|revoke|revocation/i.test(type) ||
      /DISSENT|FAILURE|CHALLENGE|REJECTED/i.test(labels) ||
      (type === 'observe' && /Local byte check:\s*failed/i.test(summary)) ||
      (type === 'adjudicate' && /Decision:\s*(?:reject|rejected|deny|denied)\b/i.test(summary)) ||
      (type === 'decision' && /\b(?:reject|rejected|deny|denied)\b/i.test(summary))) {
    return 'review';
  }
  return 'neutral';
}

function validChronicleEntry(entry, identityCounts) {
  if (!entry || typeof entry !== 'object' ||
      !['world', 'kernel', 'decision-docket'].includes(entry.source) ||
      typeof entry.id !== 'string' || identityCounts.get(entry.id) !== 1 ||
      !entry.id.startsWith(entry.source + ':')) return false;
  const eventId = entry.id.slice(entry.source.length + 1);
  const common = WORLD_OBJECT_ID.test(eventId) && !eventId.startsWith('unidentified-') &&
    typeof entry.eventType === 'string' && entry.eventType !== 'unknown' &&
    isStrictTimestamp(entry.at) &&
    typeof entry.actor === 'string' && Boolean(entry.actor.trim()) && entry.actor !== 'unknown actor' &&
    typeof entry.title === 'string' && Boolean(entry.title.trim()) &&
    typeof entry.category === 'string' && Boolean(entry.category.trim()) &&
    typeof entry.summary === 'string';
  if (!common) return false;
  if (entry.source === 'decision-docket') {
    return entry.eventType === 'decision-docket-record' && entry.decisionId === eventId &&
      ['PENDING', 'APPROVED', 'REJECTED', 'DEFERRED', 'EXPIRED'].includes(entry.status) &&
      Number.isSafeInteger(entry.revision) && entry.revision >= 1 &&
      Number.isSafeInteger(entry.docketRevision) && entry.docketRevision >= entry.revision &&
      typeof entry.docketHead === 'string' && /^[a-f0-9]{64}$/.test(entry.docketHead) &&
      isStrictTimestamp(entry.expiresAt) &&
      (entry.expiredAt === null || isStrictTimestamp(entry.expiredAt));
  }
  return true;
}

/**
 * Convert retained chronicle entries into read-only institutional map objects.
 * The chronicle remains the source of truth for labels and warnings. This
 * projection never appends events, grants authority, adjudicates claims, or
 * awards progression. Older/overflow records remain directly inspectable.
 */
export function projectInstitutionRecordWorldObjects({
  world = {},
  institutionSummary = null,
  collaboratorResponseObjects = null,
  decisionDocketProjection = null,
  places = [],
  reservedPoints = [],
  isWalkable = () => false,
  buildings = [],
} = {}) {
  const kernelPresent = Boolean(ownDataValue(institutionSummary, 'kernel'));
  const kernelComplete = hasCompleteInstitutionKernelSnapshot(institutionSummary);
  const kernel = kernelComplete ? ownDataValue(institutionSummary, 'kernel') : null;
  const chronicle = projectChronicle({ world, kernel, collaboratorResponseObjects });
  const decisionDocket = isDecisionDocketProjection(decisionDocketProjection)
    ? decisionDocketProjection
    : projectDecisionDocket(null);
  const decisionEntries = decisionDocket.available ? decisionDocket.decisions.map(decision => {
    const disposition = decision.disposition ? Object.freeze({
      action: decision.disposition.action,
      actorId: decision.disposition.actorId,
      decidedAt: decision.disposition.decidedAt,
    }) : null;
    const dispositionText = disposition
      ? `Recorded disposition: ${disposition.action} by ${disposition.actorId} at ${disposition.decidedAt}.`
      : 'No disposition is recorded.';
    const warning = decision.status === 'APPROVED'
      ? 'APPROVED records a Founder disposition only; it does not prove the proposed effect was executed.'
      : decision.status === 'REJECTED'
        ? 'REJECTED is a retained disposition, not a truth verdict; the proposal remains inspectable.'
        : decision.status === 'DEFERRED'
          ? 'DEFERRED is terminal in this decision service; it does not extend the review window.'
          : decision.status === 'EXPIRED'
            ? 'EXPIRED records a deadline outcome; it does not grant or renew authority.'
            : 'PENDING awaits a human-gated disposition; no execution or approval is implied.';
    return {
      id: `decision-docket:${decision.id}`,
      source: 'decision-docket',
      eventType: 'decision-docket-record',
      at: decision.createdAt,
      actor: decision.createdBy,
      title: decision.title,
      category: 'DECISION CHAMBER · HUMAN GATE',
      summary: `${decision.status} · proposal revision ${decision.revision} · docket revision ${decisionDocket.revision} · review deadline ${decision.expiresAt}`,
      detail: `Separate durable Decision Chamber docket record; not a world event. ${dispositionText} A recorded disposition or expiry is not proof of downstream execution or truth.`,
      warning,
      decisionId: decision.id,
      status: decision.status,
      revision: decision.revision,
      docketRevision: decisionDocket.revision,
      docketHead: decisionDocket.head,
      expiresAt: decision.expiresAt,
      expiredAt: decision.expiredAt,
      disposition,
    };
  }) : [];
  const entries = [...decisionEntries, ...chronicle.entries];
  const identityCounts = new Map();
  for (const entry of entries) {
    if (typeof entry?.id === 'string') identityCounts.set(entry.id, (identityCounts.get(entry.id) || 0) + 1);
  }

  const placeById = new Map(places.filter(place =>
    typeof place?.id === 'string' && Number.isFinite(place.x) && Number.isFinite(place.y)
  ).map(place => [place.id, place]));
  const reserved = (Array.isArray(reservedPoints) ? reservedPoints : [])
    .filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y))
    .map(point => ({ x: point.x, y: point.y }));
  const occupiedByLocation = new Map();
  const recordsByLocation = new Map();
  const objects = [];
  let rejected = 0;
  let unmapped = 0;
  let overflow = 0;

  for (const entry of entries.slice(0, MAX_PROJECTED_EVENTS)) {
    const locationId = locationFor(entry);
    if (!locationId) {
      unmapped += 1;
      continue;
    }
    const place = placeById.get(locationId);
    if (!place) {
      unmapped += 1;
      continue;
    }
    if (!validChronicleEntry(entry, identityCounts)) {
      rejected += 1;
      continue;
    }

    const locationCount = recordsByLocation.get(locationId) || 0;
    recordsByLocation.set(locationId, locationCount + 1);
    let position = { x: null, y: null, mapVisible: false };
    if (locationCount < MAX_VISIBLE_PER_LOCATION && typeof isWalkable === 'function') {
      const occupied = occupiedByLocation.get(locationId) || [];
      const start = stableHash(entry.id) % RECORD_SLOTS.length;
      for (let probe = 0; probe < RECORD_SLOTS.length; probe += 1) {
        const slot = RECORD_SLOTS[(start + probe) % RECORD_SLOTS.length];
        const x = place.x + slot.dx;
        const y = place.y + slot.dy;
        if (!isWalkable(x, y, buildings) || !isWalkable(x, y + 18, buildings)) continue;
        if (reserved.some(point => Math.hypot(point.x - x, point.y - y) < 28)) continue;
        if (occupied.some(point => Math.hypot(point.x - x, point.y - y) < 30)) continue;
        position = { x, y, mapVisible: true };
        occupied.push({ x, y });
        occupiedByLocation.set(locationId, occupied);
        break;
      }
    }
    if (!position.mapVisible) overflow += 1;

    const eventId = entry.source === 'decision-docket' ? null : entry.id.slice(entry.source.length + 1);
    objects.push(Object.freeze({
      id: 'institution-record:' + entry.id,
      entryId: entry.id,
      eventId,
      decisionId: entry.decisionId,
      decisionStatus: entry.status,
      decisionRevision: entry.revision,
      docketRevision: entry.docketRevision,
      docketHead: entry.docketHead,
      expiresAt: entry.expiresAt,
      expiredAt: entry.expiredAt,
      disposition: entry.disposition,
      source: entry.source,
      eventType: entry.eventType,
      at: entry.at,
      actor: entry.actor,
      title: entry.title,
      category: entry.category,
      summary: entry.summary,
      detail: entry.detail,
      warning: entry.warning,
      markerTone: markerToneFor(entry),
      creationId: entry.creationId,
      version: entry.version,
      targetTitle: entry.targetTitle,
      targetAvailable: entry.targetAvailable,
      locationId,
      locationName: place.name,
      ...position,
    }));
  }

  return Object.freeze({
    objects: Object.freeze(objects),
    malformed: chronicle.malformed,
    decisionDocketAvailable: decisionDocket.available,
    decisionDocketReason: decisionDocket.reason,
    decisionDocketRevision: decisionDocket.available ? decisionDocket.revision : null,
    decisionDocketHead: decisionDocket.available ? decisionDocket.head : null,
    decisionDocketCount: decisionDocket.available ? decisionDocket.decisionCount : null,
    decisionDocketOmittedCount: decisionDocket.available ? decisionDocket.omittedDecisionCount : 0,
    kernelPresent,
    kernelComplete,
    rejected,
    unmapped,
    overflow,
    truncated: Math.max(0, entries.length - MAX_PROJECTED_EVENTS),
  });
}
