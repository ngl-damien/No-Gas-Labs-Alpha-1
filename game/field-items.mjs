import { isStrictTimestamp } from './timestamps.mjs';
import { projectResearchRecords, projectSourceObservationRecords, retainedWorldEventHistoryOptions } from './research-records.mjs';
import { validateRetainedCollaboratorResponse } from './collaborator-response.mjs';
import { projectSourceArchiveFailureObjects } from './world-view.mjs';

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
  adversarial: Object.freeze(['experiment-challenged', 'source-observation-challenged']),
  collaboration: Object.freeze(['collaborator-response-recorded']),
  restoration: Object.freeze(['publish']),
  recovery: Object.freeze(['publish'])
});

export const FIELD_ITEM_DISCOVERY_LOCATIONS = Object.freeze(['relay', 'river', 'overlook', 'ruins']);


const DISCOVERY_LOCATION_IDS = new Set(FIELD_ITEM_DISCOVERY_LOCATIONS);
const boundedText = (value, max) => typeof value === 'string' &&
  value.trim().length > 0 && Array.from(value).length <= max;

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
  const empty = Object.freeze({
    ...Object.fromEntries(Object.keys(FIELD_ITEM_SOURCE_TYPES).map(slotId => [slotId, new Set()])),
    recoveryLinks: Object.freeze([])
  });
  try {
    const history = rows(world?.events);
    const eventCounts = uniqueEventCounts(history);
    const positionByEvent = new Map(history.map((event, index) => [event, index]));
    const failureProjection = projectSourceArchiveFailureObjects(world, { includeRecoveryLinks: true });
    const projectedRecoveryLinks = failureProjection?.captureProjectionComplete === true &&
      Array.isArray(failureProjection.recoveryLinks) ? failureProjection.recoveryLinks : [];
    const { retainedByVersion, matchedPublicationIds } =
      retainedPublicationContext(world, history, eventCounts);
    // A recovery link must also pass the field-item publication matcher; the
    // two projections intentionally intersect rather than trusting either alone.
    const recoveryLinks = projectedRecoveryLinks.filter(link => matchedPublicationIds.has(link.publicationEventId));
    const recoveryIds = new Set(recoveryLinks.map(link => link.publicationEventId));
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

    const researchRecords = projectResearchRecords(history, rows(world?.creations), retainedWorldEventHistoryOptions(world, history));
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

    // Source Observatory validates this chain by retained append position, not wall-clock order.
    // Only linked, cross-actor, uniquely retained challenges become Forge sources.
    const sourceObservationChallenges = projectSourceObservationRecords(history, rows(world?.creations), retainedWorldEventHistoryOptions(world, history))
      .filter(record => record?.projectionStatus === 'linked')
      .flatMap(record => rows(record.challenges))
      .filter(challenge => safeId(challenge?.id));

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
    const restorationIds = new Set(methods.map(event => event.id).filter(id => !recoveryIds.has(id)));

    const idsBySlot = {
      provenance: new Set([...matchedPublicationIds].filter(id => !restorationIds.has(id) && !recoveryIds.has(id))),
      scouting: new Set(discoveries.map(event => event.id)),
      observation: new Set([...contributions, ...reports].map(event => event.id)),
      learning: new Set([...studies, ...studyReviews].map(event => event.id)),
      research: new Set([...proposals, ...experimentReports].map(record => record.id)),
      adversarial: new Set([
        ...experimentChallenges.map(record => record.id),
        ...sourceObservationChallenges.map(challenge => challenge.id)
      ]),
      collaboration: new Set(collaboratorResponses.map(event => event.id)),
      restoration: restorationIds,
      recovery: recoveryIds
    };
    return Object.freeze({ ...idsBySlot, recoveryLinks: Object.freeze(recoveryLinks) });
  } catch {
    return empty;
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
export function projectValidFieldItemForgeEvents(events, { validSourceEventIdsBySlot = null } = {}) {
  const history = rows(events);
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
    const allowedSourceIds = validSourceEventIdsBySlot?.[event.slotId];
    return Boolean(source && allowedSourceIds instanceof Set && allowedSourceIds.has(source.id) &&
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
export function projectFieldItemState(events, {
  slotIds = [],
  validForgeEventIds = new Set()
} = {}) {
  const history = rows(events);
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
  const validForgeIds = validForgeEventIds instanceof Set ? validForgeEventIds : new Set();
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

    if (event.type === 'field-item-transfer-declined') {
      const offer = safeId(event.offerId) ? offers.get(event.offerId) : null;
      const item = offer && items.get(offer.itemId);
      const offerAt = offer ? Date.parse(offer.at) : NaN;
      if (!offer || offer.status !== 'offered' || !item || !validActor(event.actor) ||
          at === null || !Number.isFinite(offerAt) || at < offerAt || at < item.lastAt ||
          event.actor.id !== offer.recipientId || event.actor.role !== offer.recipientRole ||
          activeOffersByItem.get(offer.itemId) !== offer.offerId) continue;
      offer.status = 'declined';
      offer.declineEventId = event.id;
      offer.declineEvent = event;
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


/** 
 * Reconstruct actor-scoped Armor Bearer handoffs from validated field-item state.
 * A complete chain is: retained Forge item -> bearer equips that exact item in
 * the current ownership period -> designated recipient accepts the exact offer
 * -> recipient equips that item. This is read-only and creates no XP, combat
 * power, events, or authority.
 */
export function projectArmorBearerChains(events, fieldItemState, actor) {
  const history = rows(events);
  if (!validActor(actor) ||
      !(fieldItemState?.items instanceof Map) ||
      !(fieldItemState?.offers instanceof Map) ||
      !Array.isArray(fieldItemState?.equipmentEvents)) return Object.freeze([]);

  // The reducer retains the original event objects. Object-identity positions
  // preserve append order and prevent timestamps alone from reordering a chain.
  const positionByEvent = new Map(history.map((event, index) => [event, index]));
  const acceptedOffers = [...fieldItemState.offers.values()].filter(offer =>
    offer?.status === 'accepted' &&
    offer?.event?.type === 'field-item-transfer-offered' &&
    offer?.transferEvent?.type === 'field-item-transferred' &&
    Number.isInteger(positionByEvent.get(offer.event)) &&
    Number.isInteger(positionByEvent.get(offer.transferEvent)) &&
    positionByEvent.get(offer.transferEvent) > positionByEvent.get(offer.event)
  );

  // A bearer may be the original creator or a later designated recipient.
  // Both paths must originate from an item already accepted by the reducer.
  const eligibleItems = [...fieldItemState.items.values()].filter(item =>
    item?.event?.type === 'field-item-forged' &&
    safeId(item.event.id) &&
    Number.isInteger(positionByEvent.get(item.event)) &&
    (sameActor(item.creator, actor) ||
      acceptedOffers.some(offer => offer.itemEventId === item.event.id &&
        sameActor({ id: offer.recipientId, role: offer.recipientRole }, actor)))
  );

  const chains = [];
  for (const item of eligibleItems) {
    const forgeEvent = item.event;
    const forgePosition = positionByEvent.get(forgeEvent);
    const currentOwner = validActor(item.owner)
      ? Object.freeze({ id: item.owner.id, role: item.owner.role }) : null;
    const bearerEquipmentEvents = fieldItemState.equipmentEvents
      .filter(event => event?.type === 'field-item-equipped' &&
        event.sourceEventId === forgeEvent.id &&
        sameActor(event.actor, actor) &&
        Number.isInteger(positionByEvent.get(event)) &&
        positionByEvent.get(event) > forgePosition)
      .sort((left, right) => positionByEvent.get(left) - positionByEvent.get(right));
    const bearerOffers = acceptedOffers
      .filter(offer => offer.itemId === item.itemId &&
        offer.itemEventId === forgeEvent.id &&
        offer.fromActorId === actor.id &&
        offer.fromActorRole === actor.role)
      .sort((left, right) =>
        positionByEvent.get(left.transferEvent) - positionByEvent.get(right.transferEvent));

    // An old equip belongs to an old ownership period. Each later handoff must
    // be preceded by a new equip after the most recent retained transfer into
    // this actor. The original creator's first period begins at the Forge event.
    const acquisitionPositionBefore = beforePosition => {
      let latestPosition = forgePosition;
      for (const offer of acceptedOffers) {
        if (offer.itemEventId !== forgeEvent.id ||
            !sameActor({ id: offer.recipientId, role: offer.recipientRole }, actor)) continue;
        const transferPosition = positionByEvent.get(offer.transferEvent);
        if (Number.isInteger(transferPosition) &&
            transferPosition < beforePosition &&
            transferPosition > latestPosition) {
          latestPosition = transferPosition;
        }
      }
      return latestPosition;
    };

    const itemChains = [];
    for (const offer of bearerOffers) {
      const offerPosition = positionByEvent.get(offer.event);
      const transferPosition = positionByEvent.get(offer.transferEvent);
      const acquisitionPosition = acquisitionPositionBefore(offerPosition);
      const bearerEquipment = bearerEquipmentEvents
        .filter(event => positionByEvent.get(event) > acquisitionPosition &&
          positionByEvent.get(event) < offerPosition)
        .at(-1) || null;
      const recipient = { id: offer.recipientId, role: offer.recipientRole };

      // Preserve the accepted transfer as world history, but do not let a
      // stale equip from a prior ownership period satisfy the bearer step.
      // Only the valid prefix contributes quest progress.
      if (!bearerEquipment) {
        itemChains.push({
          itemId: item.itemId,
          itemEventId: forgeEvent.id,
          slotId: item.slotId,
          bearer: Object.freeze({ id: actor.id, role: actor.role }),
          recipient: Object.freeze(recipient),
          progress: 1,
          target: 4,
          complete: false,
          evidenceEvents: Object.freeze([forgeEvent]),
          lastPosition: Math.max(acquisitionPosition, transferPosition),
          blockedReason: 'The transfer happened before this bearer equipped the item in the current ownership period. The accepted transfer remains in history but does not complete this sequence; the item must return to this bearer, who must equip it again before a later handoff.',
          currentOwner
        });
        continue;
      }

      // A recipient may return or pass the item onward before equipping it.
      // Preserve the original handoff, but report the current ownership blocker.
      const recipientEquipment = fieldItemState.equipmentEvents.find(event =>
        event?.type === 'field-item-equipped' &&
        event.sourceEventId === forgeEvent.id &&
        sameActor(event.actor, recipient) &&
        Number.isInteger(positionByEvent.get(event)) &&
        positionByEvent.get(event) > transferPosition
      ) || null;
      const evidenceEvents = [
        forgeEvent,
        bearerEquipment,
        offer.transferEvent,
        ...(recipientEquipment ? [recipientEquipment] : [])
      ];
      itemChains.push({
        itemId: item.itemId,
        itemEventId: forgeEvent.id,
        slotId: item.slotId,
        bearer: Object.freeze({ id: actor.id, role: actor.role }),
        recipient: Object.freeze(recipient),
        progress: evidenceEvents.length,
        target: 4,
        complete: evidenceEvents.length === 4,
        evidenceEvents: Object.freeze(evidenceEvents),
        lastPosition: positionByEvent.get(evidenceEvents.at(-1)),
        blockedReason: recipientEquipment ? null :
          sameActor(currentOwner, recipient)
            ? 'The designated recipient must equip the exact transferred item; the bearer cannot perform that step for them.'
            : 'The designated recipient has not equipped the exact item, and the item is no longer in their inventory. The handoff remains incomplete; return it to that recipient before they can equip it.',
        currentOwner
      });
    }

    // A returned item opens a new visible objective for its current owner even
    // when an earlier handoff for the same item remains complete in history.
    if (sameActor(currentOwner, actor)) {
      const currentAcquisitionPosition = acquisitionPositionBefore(history.length);
      const hasOutgoingOfferInCurrentPeriod = bearerOffers.some(offer =>
        positionByEvent.get(offer.event) > currentAcquisitionPosition
      );
      if (!hasOutgoingOfferInCurrentPeriod) {
        const latestEquipment = bearerEquipmentEvents
          .filter(event => positionByEvent.get(event) > currentAcquisitionPosition)
          .at(-1) || null;
        const evidenceEvents = [
          forgeEvent,
          ...(latestEquipment ? [latestEquipment] : [])
        ];
        itemChains.push({
          itemId: item.itemId,
          itemEventId: forgeEvent.id,
          slotId: item.slotId,
          bearer: Object.freeze({ id: actor.id, role: actor.role }),
          recipient: null,
          progress: evidenceEvents.length,
          target: 4,
          complete: false,
          evidenceEvents: Object.freeze(evidenceEvents),
          lastPosition: latestEquipment
            ? positionByEvent.get(latestEquipment) : currentAcquisitionPosition,
          blockedReason: null,
          currentOwner
        });
      }
    }

    chains.push(...itemChains);
  }

  return Object.freeze(chains
    .sort((left, right) =>
      right.progress - left.progress ||
      right.lastPosition - left.lastPosition ||
      left.itemEventId.localeCompare(right.itemEventId) ||
      left.itemId.localeCompare(right.itemId))
    .map(chain => Object.freeze(chain)));
}
