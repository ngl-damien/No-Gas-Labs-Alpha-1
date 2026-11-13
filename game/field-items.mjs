import { isStrictTimestamp } from './timestamps.mjs';

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

/** One safe-ID and source-eligibility contract shared by inventory and quests. */
export function isSafeFieldItemReferenceId(value) {
  return safeId(value);
}

/**
 * Return only forge events whose source is one earlier, unique, actor-matched
 * retained event in the slot contract. This is a read-only projection.
 */
export function projectValidFieldItemForgeEvents(events) {
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
    return Boolean(source &&
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
