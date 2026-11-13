import { isStrictTimestamp } from './timestamps.mjs';
import { projectResearchRecords } from './research-records.mjs';
import { validateRetainedCollaboratorResponse } from './collaborator-response.mjs';

const rows = value => Array.isArray(value) ? value : [];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const safeId = value => typeof value === 'string' && SAFE_ID.test(value) &&
  !['constructor', 'prototype', '__proto__'].includes(value);

function validActor(actor) {
  return actor && typeof actor.id === 'string' && actor.id.length > 0 &&
    actor.id.trim() === actor.id && ['founder', 'witness'].includes(actor.role);
}

function sameActor(left, right) {
  return left?.id === right?.id && left?.role === right?.role;
}

function actorSlotKey(actor, slotId) {
  return JSON.stringify([actor?.id, actor?.role, slotId]);
}

function eventTime(event) {
  if (!isStrictTimestamp(event?.at)) return null;
  const value = Date.parse(event.at);
  return Number.isFinite(value) ? value : null;
}

function uniqueEventCounts(events) {
  const counts = new Map();
  for (const event of rows(events)) {
    if (typeof event?.id === 'string' && event.id.length > 0) {
      counts.set(event.id, (counts.get(event.id) || 0) + 1);
    }
  }
  return counts;
}


export const FIELD_ITEM_SOURCE_TYPES = Object.freeze({
  provenance: Object.freeze(['publish']),
  scouting: Object.freeze(['discover']),
  observation: Object.freeze(['contribute', 'report']),
  learning: Object.freeze(['study', 'study-reviewed']),
  research: Object.freeze(['moonshot-proposed', 'experiment-reported']),
  adversarial: Object.freeze(['experiment-challenged']),
  collaboration: Object.freeze(['collaborator-response-recorded']),
  restoration: Object.freeze(['publish'])
});

export const FIELD_ITEM_DISCOVERY_LOCATIONS = Object.freeze(['relay', 'river', 'overlook', 'ruins']);


const DISCOVERY_LOCATION_IDS = new Set(FIELD_ITEM_DISCOVERY_LOCATIONS);
const boundedText = (value, max) => typeof value === 'string' &&
  value.trim().length > 0 && Array.from(value).length <= max;

// Source indexes are opaque, immutable projections bound to one world snapshot.
const SOURCE_INDEX_CONTEXT = new WeakMap();
const SOURCE_COLLECTION_KEYS = Object.freeze([
  'creations', 'discoveries', 'contributions', 'reports', 'methods'
]);

function readOnlyIdSet(values) {
  const ids = new Set(values);
  return Object.freeze({ has: value => ids.has(value) });
}

function sourceIndexForWorld(world, idsBySlot) {
  const sourceIdsBySlot = Object.freeze(Object.fromEntries(
    Object.entries(idsBySlot).map(([slotId, ids]) => [
      slotId, Object.freeze([...new Set(ids)].sort())
    ])
  ));
  const index = Object.freeze(Object.fromEntries(
    Object.entries(sourceIdsBySlot).map(([slotId, ids]) => [slotId, readOnlyIdSet(ids)])
  ));
  if (world && typeof world === 'object') {
    let context = {
      world, events: null, revision: undefined, eventCount: null,
      sourceCollections: [], sourceLengths: [], sourceIdsBySlot
    };
    try {
      const events = world.events;
      const sourceCollections = SOURCE_COLLECTION_KEYS.map(key => world[key]);
      context = {
        world,
        events,
        revision: world.revision,
        eventCount: Array.isArray(events) ? events.length : null,
        sourceCollections,
        sourceLengths: sourceCollections.map(value => Array.isArray(value) ? value.length : null),
        sourceIdsBySlot
      };
    } catch {}
    SOURCE_INDEX_CONTEXT.set(index, context);
  }
  return index;
}

function sameSourceIndexIds(left, right) {
  const slots = Object.keys(FIELD_ITEM_SOURCE_TYPES);
  if (!left || !right ||
      Object.keys(left).length !== slots.length ||
      Object.keys(right).length !== slots.length) return false;
  return slots.every(slotId => {
    const previous = left[slotId];
    const current = right[slotId];
    return Array.isArray(previous) && Array.isArray(current) &&
      previous.length === current.length &&
      previous.every((id, index) => id === current[index]);
  });
}

export function isValidFieldItemSourceEventIndex(index, world) {
  if (!index || typeof index !== 'object' || !world || typeof world !== 'object') return false;
  const context = SOURCE_INDEX_CONTEXT.get(index);
  if (!context || context.world !== world) return false;
  try {
    const events = world.events;
    const sourceCollections = SOURCE_COLLECTION_KEYS.map(key => world[key]);
    const sameSnapshotStructure = context.events === events &&
      context.revision === world.revision &&
      context.eventCount === (Array.isArray(events) ? events.length : null) &&
      context.sourceCollections.every((value, index) =>
        value === sourceCollections[index] &&
        context.sourceLengths[index] === (Array.isArray(value) ? value.length : null)
      );
    if (!sameSnapshotStructure) return false;

    // Array identity, length and revision do not detect in-place edits to event
    // or source-record objects. Recompute the domain-validated IDs and compare
    // the immutable slot sets before reusing this index.
    const currentIndex = projectValidFieldItemSourceEventIds(world);
    const currentContext = SOURCE_INDEX_CONTEXT.get(currentIndex);
    return currentContext?.world === world &&
      sameSourceIndexIds(context.sourceIdsBySlot, currentContext.sourceIdsBySlot);
  } catch {
    return false;
  }
}

function sourceJoinKey(entry, fields) {
  if (!validActor(entry?.actor) || !isStrictTimestamp(entry.at)) return null;
  const values = fields.map(field => entry[field]);
  if (!fields.every((field, index) => field === 'version'
    ? Number.isSafeInteger(values[index]) && values[index] > 0
    : boundedText(values[index], 2048) && values[index].trim() === values[index])) return null;
  return JSON.stringify([entry.actor.id, entry.actor.role, entry.at, ...values]);
}

function matchedSourceEvents(type, records, history, eventCounts, fields, predicate = () => true) {
  const eventGroups = new Map();
  for (const event of history) {
    if (event?.type !== type || !safeId(event.id) || eventCounts.get(event.id) !== 1) continue;
    const key = sourceJoinKey(event, fields);
    if (key === null) continue;
    const group = eventGroups.get(key) || [];
    group.push(event);
    eventGroups.set(key, group);
  }

  const source = rows(records);
  const recordIdCounts = new Map();
  for (const record of source) {
    if (typeof record?.id === 'string' && record.id.length > 0) {
      recordIdCounts.set(record.id, (recordIdCounts.get(record.id) || 0) + 1);
    }
  }
  const recordGroups = new Map();
  for (const record of source) {
    if (!validActor(record?.actor) || !boundedText(record?.id, 2048) ||
        record.id.trim() !== record.id) continue;
    const key = sourceJoinKey(record, fields);
    if (key === null) continue;
    const group = recordGroups.get(key) || [];
    group.push(record);
    recordGroups.set(key, group);
  }

  const matched = [];
  for (const [key, group] of recordGroups) {
    if (group.length !== 1) continue;
    const record = group[0];
    if (recordIdCounts.get(record.id) !== 1) continue;
    const candidates = eventGroups.get(key);
    if (!candidates || candidates.length !== 1) continue;
    let accepted = false;
    try { accepted = predicate(candidates[0], record) === true; } catch { accepted = false; }
    if (accepted) matched.push(candidates[0]);
  }
  return matched;
}

function retainedPublicationContext(world, history, eventCounts) {
  const versionsByReference = new Map();
  for (const creation of rows(world?.creations)) {
    if (!boundedText(creation?.id, 2048)) continue;
    for (const version of [...rows(creation.versions), creation]) {
      if (!version || !Number.isSafeInteger(version.version) || version.version < 1 ||
          !isStrictTimestamp(version.publishedAt) ||
          version.receipt?.algorithm !== 'sha256' ||
          typeof version.receipt.digest !== 'string' ||
          !/^[a-f0-9]{64}$/.test(version.receipt.digest) ||
          !Number.isSafeInteger(version.receipt.size) || version.receipt.size < 0) continue;
      const key = JSON.stringify([creation.id, version.version]);
      const group = versionsByReference.get(key) || [];
      group.push(version);
      versionsByReference.set(key, group);
    }
  }

  const publicationGroups = new Map();
  for (const event of history) {
    if (event?.type !== 'publish' || !safeId(event.id) || eventCounts.get(event.id) !== 1 ||
        !validActor(event.actor) || event.actor.role !== 'founder' ||
        !boundedText(event.creationId, 2048) ||
        !Number.isSafeInteger(event.version) || event.version < 1 ||
        !isStrictTimestamp(event.at)) continue;
    const key = JSON.stringify([event.creationId, event.version]);
    const versions = versionsByReference.get(key) || [];
    if (versions.length !== 1 || versions[0].publishedAt !== event.at) continue;
    const group = publicationGroups.get(key) || [];
    group.push(event);
    publicationGroups.set(key, group);
  }

  const retainedByVersion = new Map();
  const matchedPublicationIds = new Set();
  for (const [key, group] of publicationGroups) {
    const rewarded = group.filter(event => Number.isSafeInteger(event.reward) && event.reward === 100);
    const selected = rewarded.length === 1 ? rewarded
      : rewarded.length === 0 && group.length === 1 ? group : [];
    if (selected.length !== 1) continue;
    retainedByVersion.set(key, selected[0]);
    if (selected[0].reward === 100) matchedPublicationIds.add(selected[0].id);
  }
  return { retainedByVersion, matchedPublicationIds };
}

/**
 * One domain-validated source index shared by Character Sheet and Quest Board.
 * A source event must match its retained domain record (or its domain-specific
 * event chain); a type label alone is never enough to create inventory/progress.
 */
export function projectValidFieldItemSourceEventIds(world) {
  const empty = () => sourceIndexForWorld(world, Object.fromEntries(
    Object.keys(FIELD_ITEM_SOURCE_TYPES).map(slotId => [slotId, []])
  ));
  try {
    const history = rows(world?.events);
    const eventCounts = uniqueEventCounts(history);
    const positionByEvent = new Map(history.map((event, index) => [event, index]));
    const { retainedByVersion, matchedPublicationIds } =
      retainedPublicationContext(world, history, eventCounts);
    const hasEarlierPublication = (event, position) => {
      const publication = retainedByVersion.get(JSON.stringify([event?.creationId, event?.version]));
      const publicationPosition = publication ? positionByEvent.get(publication) : -1;
      return Boolean(publication && Number.isInteger(publicationPosition) &&
        Number.isInteger(position) && publicationPosition < position &&
        isStrictTimestamp(publication.at) && isStrictTimestamp(event.at) &&
        Date.parse(publication.at) <= Date.parse(event.at));
    };

    const discoveries = matchedSourceEvents(
      'discover', world?.discoveries, history, eventCounts, ['locationId'],
      event => event.repeat !== true && DISCOVERY_LOCATION_IDS.has(event.locationId)
    );
    const contributions = matchedSourceEvents(
      'contribute', world?.contributions, history, eventCounts, ['creationId', 'version'],
      event => hasEarlierPublication(event, positionByEvent.get(event))
    );
    const reports = matchedSourceEvents(
      'report', world?.reports, history, eventCounts, ['creationId', 'version'],
      event => hasEarlierPublication(event, positionByEvent.get(event))
    );

    const studyIdCounts = new Map();
    for (const event of history) if (event?.type === 'study' && typeof event.studyId === 'string') {
      studyIdCounts.set(event.studyId, (studyIdCounts.get(event.studyId) || 0) + 1);
    }
    const studies = history.filter((event, index) =>
      event?.type === 'study' && safeId(event.id) && eventCounts.get(event.id) === 1 &&
      safeId(event.studyId) && studyIdCounts.get(event.studyId) === 1 &&
      validActor(event.actor) && boundedText(event.creationId, 2048) &&
      Number.isSafeInteger(event.version) && event.version > 0 &&
      boundedText(event.question, 500) && boundedText(event.attempt, 1000) &&
      boundedText(event.nextCheck, 500) && isStrictTimestamp(event.at) &&
      hasEarlierPublication(event, index)
    );
    const studyById = new Map(studies.map(event => [event.studyId, event]));
    const reviewIdCounts = new Map();
    const reviewedStudyCounts = new Map();
    for (const event of history) if (event?.type === 'study-reviewed') {
      if (typeof event.reviewId === 'string') reviewIdCounts.set(event.reviewId, (reviewIdCounts.get(event.reviewId) || 0) + 1);
      if (typeof event.studyId === 'string') reviewedStudyCounts.set(event.studyId, (reviewedStudyCounts.get(event.studyId) || 0) + 1);
    }
    const studyReviews = history.filter((event, index) => {
      const source = studyById.get(event?.studyId);
      const sourcePosition = source ? positionByEvent.get(source) : -1;
      return event?.type === 'study-reviewed' && safeId(event.id) &&
        eventCounts.get(event.id) === 1 && safeId(event.reviewId) &&
        reviewIdCounts.get(event.reviewId) === 1 && safeId(event.studyId) &&
        reviewedStudyCounts.get(event.studyId) === 1 && source &&
        sameActor(source.actor, event.actor) &&
        source.creationId === event.creationId && source.version === event.version &&
        Number.isInteger(sourcePosition) && sourcePosition < index &&
        isStrictTimestamp(source.at) && isStrictTimestamp(event.at) &&
        Date.parse(source.at) < Date.parse(event.at) &&
        boundedText(event.response, 1000) && boundedText(event.reflection, 1000) &&
        hasEarlierPublication(event, index);
    });

    const researchRecords = projectResearchRecords(history, rows(world?.creations));
    const proposals = [];
    const experimentReports = [];
    const experimentChallenges = [];
    for (const record of researchRecords) {
      const projection = record?._projection;
      if (!projection?.recordSafe || projection.eventIdUnique !== true || !safeId(record.id)) continue;
      if (record.type === 'moonshot-proposed' && projection.proposalStatus === 'unique' &&
          ['not-provided', 'linked'].includes(projection.sourceStatus)) {
        proposals.push(record);
      } else if (record.type === 'experiment-reported' && projection.proposalStatus === 'linked' &&
          ['not-provided', 'linked'].includes(projection.evidenceStatus)) {
        experimentReports.push(record);
      } else if (record.type === 'experiment-challenged' &&
          projection.proposalStatus === 'linked' && projection.targetReportStatus === 'linked' &&
          ['not-provided', 'linked'].includes(projection.evidenceStatus)) {
        experimentChallenges.push(record);
      }
    }

    const collaboratorResponses = history.filter(event => {
      if (event?.type !== 'collaborator-response-recorded' || !safeId(event.id) ||
          eventCounts.get(event.id) !== 1 || !validActor(event.actor) ||
          !isStrictTimestamp(event.at)) return false;
      const retained = validateRetainedCollaboratorResponse(world, event.id, event.actor);
      return retained.eventId === event.id &&
        ['valid-for-human-review', 'rejected'].includes(retained.status);
    });

    const repairsByVersion = new Map();
    for (const event of history) {
      if (event?.type !== 'repair' || !safeId(event.id) || eventCounts.get(event.id) !== 1 ||
          !validActor(event.actor) || !boundedText(event.creationId, 2048) ||
          !Number.isSafeInteger(event.baseVersion) || event.baseVersion < 1 ||
          !boundedText(event.draftId, 2048) || !isStrictTimestamp(event.at)) continue;
      const key = JSON.stringify([event.actor.id, event.actor.role, event.creationId, event.baseVersion]);
      const group = repairsByVersion.get(key) || [];
      group.push(event);
      repairsByVersion.set(key, group);
    }
    const hasUniquePriorRepair = event => {
      const publicationPosition = positionByEvent.get(event);
      const key = JSON.stringify([event.actor.id, event.actor.role, event.creationId, event.version - 1]);
      const prior = (repairsByVersion.get(key) || []).filter(repair => {
        const repairPosition = positionByEvent.get(repair);
        return Number.isInteger(repairPosition) && Number.isInteger(publicationPosition) &&
          repairPosition < publicationPosition && Date.parse(repair.at) <= Date.parse(event.at);
      });
      return prior.length === 1;
    };
    const methods = matchedSourceEvents(
      'publish', world?.methods, history, eventCounts, ['creationId', 'version'],
      event => event.version > 1 && matchedPublicationIds.has(event.id) && hasUniquePriorRepair(event)
    );
    const restorationIds = new Set(methods.map(event => event.id));

    const idsBySlot = {
      provenance: new Set([...matchedPublicationIds].filter(id => !restorationIds.has(id))),
      scouting: new Set(discoveries.map(event => event.id)),
      observation: new Set([...contributions, ...reports].map(event => event.id)),
      learning: new Set([...studies, ...studyReviews].map(event => event.id)),
      research: new Set([...proposals, ...experimentReports].map(record => record.id)),
      adversarial: new Set(experimentChallenges.map(record => record.id)),
      collaboration: new Set(collaboratorResponses.map(event => event.id)),
      restoration: restorationIds
    };
    return sourceIndexForWorld(world, idsBySlot);
  } catch {
    return empty();
  }
}


/** One safe-ID and source-eligibility contract shared by inventory and quests. */
export function isSafeFieldItemReferenceId(value) {
  return safeId(value);
}

/**
 * Return only forge events whose source is one earlier, unique, actor-matched
 * retained event that also passes the shared domain-specific source projection.
 * Missing source-validation sets fail closed. This is a read-only projection.
 */
export function projectValidFieldItemForgeEvents(world, { validSourceEventIdsBySlot = null } = {}) {
  const sourceIndex = isValidFieldItemSourceEventIndex(validSourceEventIdsBySlot, world)
    ? validSourceEventIdsBySlot
    : projectValidFieldItemSourceEventIds(world);
  const history = rows(world?.events);
  const eventCounts = uniqueEventCounts(history);
  const itemIdCounts = new Map();
  const sourceCounts = new Map();
  const sourceById = new Map();
  const positionByEvent = new Map();

  for (let index = 0; index < history.length; index += 1) {
    const event = history[index];
    positionByEvent.set(event, index);
    if (isSafeFieldItemReferenceId(event?.id) && eventCounts.get(event.id) === 1) {
      sourceById.set(event.id, event);
    }
    if (event?.type !== 'field-item-forged') continue;
    if (typeof event.itemId === 'string') {
      itemIdCounts.set(event.itemId, (itemIdCounts.get(event.itemId) || 0) + 1);
    }
    const sourceKey = JSON.stringify([event.actor?.id, event.actor?.role, event.sourceEventId]);
    sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) || 0) + 1);
  }

  return history.filter((event, index) => {
    if (event?.type !== 'field-item-forged' ||
        !isSafeFieldItemReferenceId(event.id) || eventCounts.get(event.id) !== 1 ||
        !isSafeFieldItemReferenceId(event.itemId) || itemIdCounts.get(event.itemId) !== 1 ||
        !isSafeFieldItemReferenceId(event.sourceEventId) ||
        !Object.hasOwn(FIELD_ITEM_SOURCE_TYPES, event.slotId) ||
        sourceCounts.get(JSON.stringify([event.actor?.id, event.actor?.role, event.sourceEventId])) !== 1 ||
        !validActor(event.actor) || !isStrictTimestamp(event.at)) return false;

    const source = sourceById.get(event.sourceEventId);
    const sourcePosition = source ? positionByEvent.get(source) : -1;
    const allowedSourceIds = sourceIndex?.[event.slotId];
    return Boolean(source && allowedSourceIds && typeof allowedSourceIds.has === 'function' &&
      allowedSourceIds.has(source.id) &&
      FIELD_ITEM_SOURCE_TYPES[event.slotId].includes(source.type) &&
      sameActor(source.actor, event.actor) &&
      Number.isInteger(sourcePosition) && sourcePosition < index &&
      isStrictTimestamp(source.at) &&
      Date.parse(source.at) <= Date.parse(event.at));
  });
}

/**
 * One append-order reducer for field-item ownership, transfer offers and equipment.
 * Malformed imported histories remain visible to Chronicle, but cannot change an
 * actor's inventory or quest progress.
 */
export function projectFieldItemState(world, {
  slotIds = [],
  validSourceEventIdsBySlot = null
} = {}) {
  const history = rows(world?.events);
  const eventCounts = uniqueEventCounts(history);
  const itemIdCounts = new Map();
  const offerIdCounts = new Map();
  const transferCounts = new Map();
  for (const event of history) {
    if (event?.type === 'field-item-forged' && typeof event.itemId === 'string') {
      itemIdCounts.set(event.itemId, (itemIdCounts.get(event.itemId) || 0) + 1);
    }
    if (event?.type === 'field-item-transfer-offered' && typeof event.offerId === 'string') {
      offerIdCounts.set(event.offerId, (offerIdCounts.get(event.offerId) || 0) + 1);
    }
    if (event?.type === 'field-item-transferred' && typeof event.offerId === 'string') {
      transferCounts.set(event.offerId, (transferCounts.get(event.offerId) || 0) + 1);
    }
  }

  const allowedSlots = new Set(rows(slotIds));
  const validForgeIds = new Set(projectValidFieldItemForgeEvents(world, {
    validSourceEventIdsBySlot
  }).map(event => event.id));
  const items = new Map();
  const itemsByEvent = new Map();
  const offers = new Map();
  const activeOffersByItem = new Map();
  const equippedByActorSlot = new Map();
  const equipmentEvents = [];

  for (const event of history) {
    if (!safeId(event?.id) || eventCounts.get(event.id) !== 1) continue;
    const at = eventTime(event);

    if (event.type === 'field-item-forged') {
      if (!validActor(event.actor) || at === null ||
          !allowedSlots.has(event.slotId) || !safeId(event.itemId) ||
          itemIdCounts.get(event.itemId) !== 1 || !safeId(event.sourceEventId) ||
          !validForgeIds.has(event.id) ||
          items.has(event.itemId) || itemsByEvent.has(event.id)) continue;
      const item = {
        itemId: event.itemId,
        event,
        slotId: event.slotId,
        creator: { id: event.actor.id, role: event.actor.role },
        owner: { id: event.actor.id, role: event.actor.role },
        lastAt: at
      };
      items.set(item.itemId, item);
      itemsByEvent.set(event.id, item);
      continue;
    }

    if (event.type === 'field-item-equipped') {
      const item = safeId(event.sourceEventId) ? itemsByEvent.get(event.sourceEventId) : null;
      const key = actorSlotKey(event.actor, event.slotId);
      const previousItem = itemsByEvent.get(equippedByActorSlot.get(key));
      if (!item || !validActor(event.actor) || at === null ||
          !allowedSlots.has(event.slotId) || item.slotId !== event.slotId ||
          !sameActor(item.owner, event.actor) || activeOffersByItem.has(item.itemId) ||
          at < item.lastAt || (previousItem && previousItem !== item && at < previousItem.lastAt)) continue;
      if (previousItem && previousItem !== item) previousItem.lastAt = at;
      equippedByActorSlot.set(key, item.event.id);
      item.lastAt = at;
      equipmentEvents.push(event);
      continue;
    }

    if (event.type === 'field-item-unequipped') {
      const key = actorSlotKey(event.actor, event.slotId);
      const currentEventId = equippedByActorSlot.get(key);
      const item = itemsByEvent.get(currentEventId);
      if (!validActor(event.actor) || at === null || !allowedSlots.has(event.slotId) ||
          !item || !sameActor(item.owner, event.actor) || at < item.lastAt) continue;
      equippedByActorSlot.delete(key);
      item.lastAt = at;
      continue;
    }

    if (event.type === 'field-item-transfer-offered') {
      const item = items.get(event.itemId);
      const recipient = { id: event.recipientId, role: event.recipientRole };
      if (!item || at === null || at < item.lastAt ||
          !validActor(event.actor) || !validActor(recipient) ||
          !safeId(event.offerId) || offerIdCounts.get(event.offerId) !== 1 ||
          event.itemEventId !== item.event.id || !sameActor(item.owner, event.actor) ||
          sameActor(item.owner, recipient) || offers.has(event.offerId) ||
          activeOffersByItem.has(item.itemId) ||
          equippedByActorSlot.get(actorSlotKey(item.owner, item.slotId)) === item.event.id) continue;
      const offer = {
        offerId: event.offerId,
        itemId: item.itemId,
        itemEventId: item.event.id,
        fromActorId: event.actor.id,
        fromActorRole: event.actor.role,
        recipientId: recipient.id,
        recipientRole: recipient.role,
        at: event.at,
        eventId: event.id,
        event,
        status: 'offered'
      };
      offers.set(offer.offerId, offer);
      activeOffersByItem.set(item.itemId, offer.offerId);
      item.lastAt = at;
      continue;
    }

    if (event.type === 'field-item-transfer-cancelled') {
      const offer = safeId(event.offerId) ? offers.get(event.offerId) : null;
      const item = offer && items.get(offer.itemId);
      const offerAt = offer ? Date.parse(offer.at) : NaN;
      if (!offer || offer.status !== 'offered' || !item || !validActor(event.actor) ||
          at === null || !Number.isFinite(offerAt) || at < offerAt || at < item.lastAt ||
          !sameActor(item.owner, event.actor) ||
          !sameActor({ id: offer.fromActorId, role: offer.fromActorRole }, event.actor) ||
          activeOffersByItem.get(offer.itemId) !== offer.offerId) continue;
      offer.status = 'cancelled';
      offer.cancelEventId = event.id;
      offer.cancelEvent = event;
      activeOffersByItem.delete(offer.itemId);
      item.lastAt = at;
      continue;
    }

    if (event.type === 'field-item-transferred') {
      const offer = safeId(event.offerId) ? offers.get(event.offerId) : null;
      const item = offer && items.get(offer.itemId);
      const offerAt = offer ? Date.parse(offer.at) : NaN;
      if (!offer || offer.status !== 'offered' || !item ||
          transferCounts.get(offer.offerId) !== 1 || !validActor(event.actor) ||
          at === null || !Number.isFinite(offerAt) || at < offerAt || at < item.lastAt ||
          event.itemId !== offer.itemId || event.itemEventId !== offer.itemEventId ||
          event.fromActorId !== offer.fromActorId || event.fromActorRole !== offer.fromActorRole ||
          event.actor.id !== offer.recipientId || event.actor.role !== offer.recipientRole ||
          !sameActor(item.owner, { id: offer.fromActorId, role: offer.fromActorRole }) ||
          activeOffersByItem.get(offer.itemId) !== offer.offerId ||
          equippedByActorSlot.get(actorSlotKey(item.owner, item.slotId)) === item.event.id) continue;
      item.owner = { id: event.actor.id, role: event.actor.role };
      item.lastAt = at;
      offer.status = 'accepted';
      offer.transferEventId = event.id;
      offer.transferEvent = event;
      activeOffersByItem.delete(offer.itemId);
    }
  }

  return { items, offers, activeOffersByItem, equippedByActorSlot, equipmentEvents };
}
