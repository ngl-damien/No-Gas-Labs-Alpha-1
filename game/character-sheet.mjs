import { isStrictTimestamp } from './timestamps.mjs';
import { projectCommonsMessages } from './social.mjs';
import { isValidMoonshotProposal, projectSourceObservationRecords } from './research-records.mjs';
import { getLocationAction, getQuestTrail } from './quests.mjs';

const rows = value => Array.isArray(value) ? value : [];
const mine = (entries, viewer) => typeof viewer?.id === 'string' && viewer.id &&
  (viewer.role === 'founder' || viewer.role === 'witness')
  ? rows(entries).filter(entry => entry?.actor?.id === viewer.id && entry.actor.role === viewer.role)
  : [];

const LEVEL_SPAN = 300;
const XP_PER_PUBLICATION = 100;
const MAX_FIELD_SATCHEL_ITEMS = 100;
export const MAX_FIELD_INVENTORY_ITEMS = 100;
const MAX_FIELD_EQUIPMENT_CHOICES = 100;
export const FIELD_EQUIPMENT_SLOTS = Object.freeze([
  Object.freeze({id:'provenance',label:'Receipt Buckler',kinds:Object.freeze(['published-artifact']),sourceTypes:Object.freeze(['publish']),description:'A version-matched publication receipt. It identifies retained bytes, not truth.'}),
  Object.freeze({id:'scouting',label:'Surveyor’s Compass',kinds:Object.freeze(['guide-discovery']),sourceTypes:Object.freeze(['discover']),description:'An actor-attributed guide interaction; shared visits require server-checked walkable proximity, while private visits remain local. Neither verifies a claim.'}),
  Object.freeze({id:'observation',label:'Observer’s Lens',kinds:Object.freeze(['field-report','field-note']),sourceTypes:Object.freeze(['contribute','report']),description:'An attributed note or report attached to a retained published version.'}),
  Object.freeze({id:'learning',label:'Polymath Codex',kinds:Object.freeze(['retrieval-review','study-note']),sourceTypes:Object.freeze(['study','study-reviewed']),description:'Recorded study or retrieval practice; it is not a correctness or mastery certificate.'}),
  Object.freeze({id:'research',label:'Moonshot Compass',kinds:Object.freeze(['experiment-report','moonshot-proposal']),sourceTypes:Object.freeze(['moonshot-proposed','experiment-reported']),description:'A falsifiable proposal or retained attempt, including failure and inconclusive outcomes.'}),
  Object.freeze({id:'adversarial',label:'Contradiction Ward',kinds:Object.freeze(['experiment-challenge']),sourceTypes:Object.freeze(['experiment-challenged']),description:'A retained challenge to another actor’s report; dissent remains unadjudicated.'}),
  Object.freeze({id:'collaboration',label:'Relay Sigil',kinds:Object.freeze(['guild-folio']),sourceTypes:Object.freeze(['collaborator-response-recorded']),description:'A source-bound collaborator response preserved for human review, not approval.'}),
  Object.freeze({id:'restoration',label:'Repair Gloves',kinds:Object.freeze(['checked-repair']),sourceTypes:Object.freeze(['publish']),description:'A repair method linked to a checked publication sequence; it is not independent validation.'})
]);
const versionKey = (creationId, version) => JSON.stringify([creationId, version]);

function uniqueEvents(events) {
  const source = rows(events);
  const counts = new Map();
  for (const event of source) {
    if (typeof event?.id === 'string' && event.id.length > 0) {
      counts.set(event.id, (counts.get(event.id) || 0) + 1);
    }
  }
  return source.filter(event =>
    typeof event?.id === 'string' && event.id.length > 0 && counts.get(event.id) === 1
  );
}

function validRetainedVersion(version) {
  return version && Number.isSafeInteger(version.version) && version.version > 0 &&
    isStrictTimestamp(version.publishedAt) &&
    version.receipt?.algorithm === 'sha256' &&
    typeof version.receipt.digest === 'string' && /^[a-f0-9]{64}$/.test(version.receipt.digest) &&
    Number.isSafeInteger(version.receipt.size) && version.receipt.size >= 0;
}

// Index only actual retained versions. Duplicate creation/version identities are
// ambiguous and therefore cannot support a character reward.
function retainedVersionIndex(world) {
  const index = new Map();
  for (const creation of rows(world?.creations)) {
    if (!creation || typeof creation.id !== 'string' || !creation.id) continue;
    for (const version of [...rows(creation.versions), creation]) {
      if (!validRetainedVersion(version)) continue;
      const key = versionKey(creation.id, version.version);
      if (index.has(key)) index.set(key, null);
      else index.set(key, version);
    }
  }
  return index;
}

// A retained publication binds an event to one exact artifact version and
// timestamp. It establishes that a place was published, not that its contents
// are true or that it deserves game XP.
function retainedPublicationEvents(world) {
  const events = uniqueEvents(world?.events);
  const versions = retainedVersionIndex(world);
  const candidates = [];
  for (const event of events) {
    if (event.type !== 'publish' ||
        typeof event.actor?.id !== 'string' || !event.actor.id.trim() ||
        event.actor.id.trim() !== event.actor.id || event.actor.role !== 'founder' ||
        typeof event.creationId !== 'string' || !Number.isSafeInteger(event.version) ||
        event.version < 1 || !isStrictTimestamp(event.at)) continue;
    const key = versionKey(event.creationId, event.version);
    const version = versions.get(key);
    if (!version || version.publishedAt !== event.at) continue;
    candidates.push({ event, key });
  }
  const groups = new Map();
  for (const candidate of candidates) {
    const group = groups.get(candidate.key) || [];
    group.push(candidate);
    groups.set(candidate.key, group);
  }
  const retained = [];
  for (const group of groups.values()) {
    const rewarded = group.filter(candidate =>
      Number.isSafeInteger(candidate.event.reward) && candidate.event.reward === XP_PER_PUBLICATION
    );
    // Prefer one valid fixed-reward receipt over malformed reward claims for
    // the same exact version. If no valid reward exists, one unambiguous
    // publication still keeps the artifact inspectable without granting XP.
    const selected = rewarded.length === 1 ? rewarded
      : rewarded.length === 0 && group.length === 1 ? group
      : [];
    for (const candidate of selected) retained.push(candidate.event);
  }
  return retained;
}

// A publication is an XP receipt only when the exact fixed reward is present.
// Invalid reward metadata does not erase a retained artifact from the world.
// XP requires one unambiguous retained publication whose own event carries
// the fixed game reward. Malformed reward claims do not suppress a separate,
// valid receipt for the same retained version.
function matchedPublications(world) {
  const events = uniqueEvents(world?.events);
  const versions = retainedVersionIndex(world);
  const candidates = [];
  for (const event of events) {
    if (event.type !== 'publish' ||
        typeof event.actor?.id !== 'string' || !event.actor.id.trim() ||
        event.actor.id.trim() !== event.actor.id || event.actor.role !== 'founder' ||
        !Number.isSafeInteger(event.reward) || event.reward !== XP_PER_PUBLICATION ||
        typeof event.creationId !== 'string' || !Number.isSafeInteger(event.version) ||
        event.version < 1 || !isStrictTimestamp(event.at)) continue;
    const key = versionKey(event.creationId, event.version);
    const version = versions.get(key);
    if (!version || version.publishedAt !== event.at) continue;
    candidates.push({ event, key });
  }
  const counts = new Map();
  for (const candidate of candidates) counts.set(candidate.key, (counts.get(candidate.key) || 0) + 1);
  return candidates.filter(candidate => counts.get(candidate.key) === 1).map(candidate => candidate.event);
}


function validActivityActor(actor) {
  return actor && typeof actor.id === 'string' && actor.id.length > 0 &&
    actor.id.trim() === actor.id && ['founder', 'witness'].includes(actor.role);
}

function sameFieldActor(left,right) {
  return left?.id === right?.id && left?.role === right?.role;
}

function projectFieldItemState(events) {
  const items = new Map(), itemsByEvent = new Map(), offers = new Map(), activeOffersByItem = new Map();
  const equippedByActorSlot = new Map();
  const actorSlotKey = (actor, slotId) => JSON.stringify([actor?.id, actor?.role, slotId]);
  for (const event of rows(events)) {
    if (event?.type === 'field-item-forged') {
      const slot = FIELD_EQUIPMENT_SLOTS.find(candidate => candidate.id === event.slotId);
      if (!validActivityActor(event.actor) || !slot || typeof event.id !== 'string' ||
          typeof event.itemId !== 'string' || !event.itemId || items.has(event.itemId) ||
          itemsByEvent.has(event.id)) continue;
      const item = {
        itemId: event.itemId, event, slotId: slot.id,
        creator: { id: event.actor.id, role: event.actor.role },
        owner: { id: event.actor.id, role: event.actor.role }
      };
      items.set(event.itemId, item);
      itemsByEvent.set(event.id, item);
      continue;
    }
    if (event?.type === 'field-item-equipped') {
      const item = itemsByEvent.get(event.sourceEventId);
      if (item && item.slotId === event.slotId && sameFieldActor(item.owner, event.actor)) {
        equippedByActorSlot.set(actorSlotKey(event.actor, event.slotId), event.sourceEventId);
      }
      continue;
    }
    if (event?.type === 'field-item-unequipped') {
      if (validActivityActor(event.actor) && FIELD_EQUIPMENT_SLOTS.some(slot => slot.id === event.slotId)) {
        equippedByActorSlot.delete(actorSlotKey(event.actor, event.slotId));
      }
      continue;
    }
    if (event?.type === 'field-item-transfer-offered') {
      const item = items.get(event.itemId);
      const recipient = { id: event.recipientId, role: event.recipientRole };
      if (!item || item.event.id !== event.itemEventId || !validActivityActor(event.actor) ||
          !validActivityActor(recipient) || sameFieldActor(item.owner, recipient) ||
          !sameFieldActor(item.owner, event.actor) || typeof event.offerId !== 'string' ||
          !event.offerId || offers.has(event.offerId) || activeOffersByItem.has(event.itemId) ||
          equippedByActorSlot.get(actorSlotKey(item.owner, item.slotId)) === item.event.id) continue;
      const offer = {
        offerId: event.offerId, itemId: item.itemId, itemEventId: item.event.id,
        fromActorId: event.actor.id, fromActorRole: event.actor.role,
        recipientId: recipient.id, recipientRole: recipient.role,
        at: event.at, eventId: event.id, status: 'offered'
      };
      offers.set(offer.offerId, offer);
      activeOffersByItem.set(item.itemId, offer.offerId);
      continue;
    }
    if (event?.type === 'field-item-transfer-cancelled') {
      const offer = offers.get(event.offerId);
      const item = offer && items.get(offer.itemId);
      if (!offer || offer.status !== 'offered' || !item ||
          !sameFieldActor(item.owner, event.actor) ||
          !sameFieldActor({ id: offer.fromActorId, role: offer.fromActorRole }, event.actor) ||
          activeOffersByItem.get(offer.itemId) !== offer.offerId) continue;
      offer.status = 'cancelled';
      offer.cancelEventId = event.id;
      activeOffersByItem.delete(offer.itemId);
      continue;
    }
    if (event?.type === 'field-item-transferred') {
      const offer = offers.get(event.offerId);
      const item = offer && items.get(offer.itemId);
      if (!offer || offer.status !== 'offered' || !item ||
          event.itemId !== offer.itemId || event.itemEventId !== offer.itemEventId ||
          event.fromActorId !== offer.fromActorId || event.fromActorRole !== offer.fromActorRole ||
          event.actor?.id !== offer.recipientId || event.actor?.role !== offer.recipientRole ||
          !sameFieldActor(item.owner, { id: offer.fromActorId, role: offer.fromActorRole }) ||
          activeOffersByItem.get(offer.itemId) !== offer.offerId ||
          equippedByActorSlot.get(actorSlotKey(item.owner, item.slotId)) === item.event.id) continue;
      item.owner = { id: event.actor.id, role: event.actor.role };
      offer.status = 'accepted';
      offer.transferEventId = event.id;
      activeOffersByItem.delete(offer.itemId);
    }
  }
  return { items, offers, activeOffersByItem };
}

function validActivityField(field, value) {
  if (field === 'version') return Number.isSafeInteger(value) && value > 0;
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

// Join a projected record to one unique retained event using the fields the
// writer records identically. If either side is ambiguous, the activity does
// not count. This is a read-only projection, not a new canonical receipt.
function matchedActivityRecords(type, records, allEvents, fields, viewer, predicate = () => true) {
  const eventGroups = new Map();
  for (const event of rows(allEvents)) {
    if (event?.type !== type) continue;
    const key = activityJoinKey(event, fields);
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
    if (typeof record?.id !== 'string' || !record.id || record.id.trim() !== record.id ||
        record.actor?.id !== viewer?.id || record.actor?.role !== viewer?.role) continue;
    const key = activityJoinKey(record, fields);
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
    if (accepted) matched.push(record);
  }
  return matched;
}

function activityJoinKey(entry, fields) {
  if (!validActivityActor(entry?.actor) || !isStrictTimestamp(entry.at)) return null;
  const values = fields.map(field => entry[field]);
  if (!fields.every((field, index) => validActivityField(field, values[index]))) return null;
  return JSON.stringify([entry.actor.id, entry.actor.role, entry.at, ...values]);
}

export function projectCharacter(world, viewer) {
  const allEvents = uniqueEvents(world?.events);
  // Resolve append positions once. Repeated indexOf scans made challenge and
  // study-review projections quadratic as the retained world grew.
  const positionByEvent = new Map(allEvents.map((event, index) => [event, index]));
  const events = mine(allEvents, viewer);
  const proposalCounts = new Map();
  const reportCounts = new Map();
  for (const event of allEvents) {
    if (event?.type === 'moonshot-proposed' && typeof event.moonshotId === 'string') {
      proposalCounts.set(event.moonshotId, (proposalCounts.get(event.moonshotId) || 0) + 1);
    }
    if (event?.type === 'experiment-reported' && typeof event.reportId === 'string') {
      reportCounts.set(event.reportId, (reportCounts.get(event.reportId) || 0) + 1);
    }
  }
  const proposalPositions = new Map();
  const validMoonshotProposalIds = new Set();
  allEvents.forEach((event, index) => {
    if (isValidMoonshotProposal(event) && proposalCounts.get(event.moonshotId) === 1) {
      proposalPositions.set(event.moonshotId, index);
      validMoonshotProposalIds.add(event.id);
    }
  });
  const proposalIds = new Set(proposalPositions.keys());
  const validExperimentReports = allEvents.filter(event => {
    const proposalIndex = proposalPositions.get(event?.moonshotId);
    const proposal = Number.isInteger(proposalIndex) ? allEvents[proposalIndex] : null;
    return event.type === 'experiment-reported' &&
      typeof event.reportId === 'string' && reportCounts.get(event.reportId) === 1 &&
      proposalIds.has(event.moonshotId) && Number.isInteger(proposalIndex) &&
      (positionByEvent.get(event) ?? -1) > proposalIndex && isStrictTimestamp(event.at) &&
      isStrictTimestamp(proposal.at) && Date.parse(proposal.at) <= Date.parse(event.at) &&
      typeof event.actor?.id === 'string' && event.actor.id.trim() &&
      ['founder', 'witness'].includes(event.actor.role) &&
      typeof event.procedure === 'string' && event.procedure.trim() &&
      typeof event.observation === 'string' && event.observation.trim() &&
      ['supports', 'contradicts', 'inconclusive', 'failed'].includes(event.reportedOutcome);
  });
  const experimentReports = mine(validExperimentReports, viewer);
  const challengeCounts = new Map();
  for (const event of allEvents) {
    if (event?.type === 'experiment-challenged' && typeof event.challengeId === 'string') {
      challengeCounts.set(event.challengeId, (challengeCounts.get(event.challengeId) || 0) + 1);
    }
  }
  const reportById = new Map(validExperimentReports.map(event => [event.reportId, event]));
  const retainedVersions = retainedVersionIndex(world);
  const retainedPublications = retainedPublicationEvents(world);
  const retainedPublicationByVersion = new Map(retainedPublications.map(event => [
    versionKey(event.creationId, event.version), event
  ]));
  const retainedPublicationIds = new Set(retainedPublications.map(event => event.id));
  const retainedPublishedVersionKeys = new Set(retainedPublications.map(event =>
    versionKey(event.creationId, event.version)
  ));
  const canonicalPublications = matchedPublications(world);
  const hasEarlierPublication = event => {
    const publication = retainedPublicationByVersion.get(versionKey(event.creationId, event.version));
    const publicationPosition = publication ? (positionByEvent.get(publication) ?? -1) : -1;
    const activityPosition = positionByEvent.get(event) ?? -1;
    return publicationPosition >= 0 && activityPosition > publicationPosition &&
      isStrictTimestamp(publication.at) && isStrictTimestamp(event.at) &&
      Date.parse(publication.at) <= Date.parse(event.at);
  };
  const matchedDiscoveries = matchedActivityRecords(
    'discover', world?.discoveries, allEvents, ['locationId'], viewer,
    event => event.repeat !== true && getLocationAction(event.locationId, world, viewer) !== null
  );
  const matchedContributions = matchedActivityRecords(
    'contribute', world?.contributions, allEvents, ['creationId', 'version'], viewer,
    hasEarlierPublication
  );
  const matchedReports = matchedActivityRecords(
    'report', world?.reports, allEvents, ['creationId', 'version'], viewer,
    hasEarlierPublication
  );
  const repairEventsByVersion = new Map();
  for (const event of allEvents) {
    if (event?.type !== 'repair' || typeof event.actor?.id !== 'string' ||
        !['founder', 'witness'].includes(event.actor.role) ||
        typeof event.creationId !== 'string' || !Number.isSafeInteger(event.baseVersion) ||
        event.baseVersion < 1 || typeof event.draftId !== 'string' || !event.draftId ||
        !isStrictTimestamp(event.at)) continue;
    const key = JSON.stringify([event.actor.id, event.actor.role, event.creationId, event.baseVersion]);
    const list = repairEventsByVersion.get(key) || [];
    list.push(event);
    repairEventsByVersion.set(key, list);
  }
  const hasUniquePriorRepair = event => {
    const key = JSON.stringify([event.actor.id, event.actor.role, event.creationId, event.version - 1]);
    const publicationPosition = positionByEvent.get(event) ?? -1;
    const prior = (repairEventsByVersion.get(key) || []).filter(repair => {
      const repairPosition = positionByEvent.get(repair) ?? -1;
      return repairPosition >= 0 && publicationPosition > repairPosition &&
        Date.parse(repair.at) <= Date.parse(event.at);
    });
    return prior.length === 1;
  };
  const matchedMethods = matchedActivityRecords(
    'publish', world?.methods, allEvents, ['creationId', 'version'], viewer,
    event => event.version > 1 && retainedPublicationIds.has(event.id) && hasUniquePriorRepair(event)
  );
  const experimentChallenges = events.filter(event => {
    const report = reportById.get(event?.reportId);
    const reportPosition = report ? (positionByEvent.get(report) ?? -1) : -1;
    const challengePosition = positionByEvent.get(event) ?? -1;
    if (event.type !== 'experiment-challenged' ||
        typeof event.challengeId !== 'string' || challengeCounts.get(event.challengeId) !== 1 ||
        typeof event.reportId !== 'string' || !report ||
        typeof event.moonshotId !== 'string' || report.moonshotId !== event.moonshotId ||
        report.actor?.id === event.actor?.id ||
        !['founder', 'witness'].includes(report.actor?.role) ||
        !['missing-evidence', 'methodology', 'contradiction', 'reproducibility', 'scope', 'other'].includes(event.challengeType) ||
        typeof event.challengeText !== 'string' || !event.challengeText.trim() ||
        Array.from(event.challengeText).length > 1000 ||
        reportPosition < 0 || challengePosition <= reportPosition ||
        !isStrictTimestamp(event.at) || !isStrictTimestamp(report.at) ||
        Date.parse(report.at) > Date.parse(event.at)) return false;

    const hasEvidenceId = typeof event.evidenceCreationId === 'string' && event.evidenceCreationId.length > 0;
    const hasEvidenceVersion = Number.isSafeInteger(event.evidenceVersion) && event.evidenceVersion > 0;
    if (hasEvidenceId !== hasEvidenceVersion) return false;
    if (!hasEvidenceId && (
      (event.evidenceCreationId !== undefined && event.evidenceCreationId !== null) ||
      (event.evidenceVersion !== undefined && event.evidenceVersion !== null)
    )) return false;
    if (hasEvidenceId) {
      const evidenceKey = versionKey(event.evidenceCreationId, event.evidenceVersion);
      const version = retainedVersions.get(evidenceKey);
      if (!version || !retainedPublishedVersionKeys.has(evidenceKey) ||
          !isStrictTimestamp(version.publishedAt) || Date.parse(version.publishedAt) > Date.parse(event.at)) return false;
    }
    return true;
  });
  const studyIdCounts = new Map();
  for (const event of allEvents) if (event?.type === 'study' && typeof event.studyId === 'string') studyIdCounts.set(event.studyId, (studyIdCounts.get(event.studyId) || 0) + 1);
  const publishedStudyVersions = retainedPublishedVersionKeys;
  const studyEvents = events.filter(event => {
    if (event.type !== 'study' || typeof event.studyId !== 'string' || studyIdCounts.get(event.studyId) !== 1 ||
        typeof event.creationId !== 'string' || !Number.isSafeInteger(event.version) || event.version < 1 ||
        typeof event.question !== 'string' || !event.question.trim() || Array.from(event.question).length > 500 ||
        typeof event.attempt !== 'string' || !event.attempt.trim() || Array.from(event.attempt).length > 1000 ||
        typeof event.nextCheck !== 'string' || !event.nextCheck.trim() || Array.from(event.nextCheck).length > 500 ||
        !isStrictTimestamp(event.at)) return false;
    const key = versionKey(event.creationId, event.version), version = retainedVersions.get(key);
    return Boolean(version && publishedStudyVersions.has(key) && isStrictTimestamp(version.publishedAt) && Date.parse(version.publishedAt) <= Date.parse(event.at));
  });
  const reviewIdCounts = new Map(), reviewedStudyCounts = new Map();
  for (const event of allEvents) if (event?.type === 'study-reviewed') {
    if (typeof event.reviewId === 'string') reviewIdCounts.set(event.reviewId, (reviewIdCounts.get(event.reviewId) || 0) + 1);
    if (typeof event.studyId === 'string') reviewedStudyCounts.set(event.studyId, (reviewedStudyCounts.get(event.studyId) || 0) + 1);
  }
  const studyById = new Map(studyEvents.map(event => [event.studyId, event]));
  const studyReviews = events.filter(event => {
    const source = studyById.get(event?.studyId);
    const sourceIndex = source ? (positionByEvent.get(source) ?? -1) : -1;
    const reviewIndex = positionByEvent.get(event) ?? -1;
    if (event.type !== 'study-reviewed' || typeof event.reviewId !== 'string' || reviewIdCounts.get(event.reviewId) !== 1 ||
        typeof event.studyId !== 'string' || reviewedStudyCounts.get(event.studyId) !== 1 || !source ||
        source.actor?.id !== event.actor?.id || source.actor?.role !== event.actor?.role ||
        source.creationId !== event.creationId || source.version !== event.version ||
        sourceIndex < 0 || reviewIndex <= sourceIndex ||
        !isStrictTimestamp(event.at) || !isStrictTimestamp(source.at) ||
        Date.parse(source.at) >= Date.parse(event.at) ||
        typeof event.response !== 'string' || !event.response.trim() || Array.from(event.response).length > 1000 ||
        typeof event.reflection !== 'string' || !event.reflection.trim() || Array.from(event.reflection).length > 1000) return false;
    const version = retainedVersions.get(versionKey(event.creationId, event.version));
    return Boolean(version && publishedStudyVersions.has(versionKey(event.creationId, event.version)) &&
      isStrictTimestamp(version.publishedAt) && Date.parse(version.publishedAt) <= Date.parse(event.at));
  });
  const studyReviewById = new Map(studyReviews.map(event => [event.studyId, event]));
  const studyCardEntries = studyEvents
    .map(event => ({ event, position: positionByEvent.get(event) }))
    .filter(entry => Number.isInteger(entry.position))
    .sort((left, right) => right.position - left.position ||
      left.event.id.localeCompare(right.event.id));
  const studyCardTotal = studyCardEntries.length;
  const studyCardOmittedCount = Math.max(0, studyCardTotal - 100);
  const rawActorStudyEventCount = rows(world?.events).filter(event =>
    event?.type === 'study' && event?.actor?.id === viewer?.id &&
    event?.actor?.role === viewer?.role
  ).length;
  const studyCardUnavailableCount = Math.max(0, rawActorStudyEventCount - studyCardTotal);
  const studyCards = Object.freeze(studyCardEntries.slice(0, 100).map(({ event }) => {
    const sourceVersion = retainedVersions.get(versionKey(event.creationId, event.version));
    const review = studyReviewById.get(event.studyId);
    return Object.freeze({
      id: 'study-card:' + event.studyId,
      studyId: event.studyId,
      sourceEventId: event.id,
      creationId: event.creationId,
      version: event.version,
      title: typeof sourceVersion?.title === 'string' && sourceVersion.title.trim()
        ? sourceVersion.title : event.creationId,
      question: event.question,
      attempt: event.attempt,
      nextCheck: event.nextCheck,
      at: event.at,
      reviewStatus: review ? 'reflection-recorded' : 'attempt-recorded',
      reviewEventId: review?.id || null,
      status: 'recorded practice · not mastery, evidence, or XP',
      action: Object.freeze({
        type: 'creation', creationId: event.creationId, version: event.version
      })
    });
  }));
  const publications = mine(canonicalPublications, viewer);
  const earned = publications.length * XP_PER_PUBLICATION;
  const xp = Number.isSafeInteger(earned) ? earned : 0;
  const earnedWorld = canonicalPublications.length * XP_PER_PUBLICATION;
  const worldXp = Number.isSafeInteger(earnedWorld) ? earnedWorld : 0;
  const level = 1 + Math.floor(xp / LEVEL_SPAN);

  const allSourceObservationRecords = projectSourceObservationRecords(world?.events, world?.creations)
    .filter(record => record.projectionStatus === 'linked');
  const sourceObservationRecords = allSourceObservationRecords
    .filter(record => record.actor?.id === viewer?.id && record.actor?.role === viewer?.role);
  const sourceObservationChallenges = allSourceObservationRecords.flatMap(record => record.challenges || [])
    .filter(challenge => challenge.actor?.id === viewer?.id && challenge.actor?.role === viewer?.role);
  const sourceObservationResponses = sourceObservationRecords.flatMap(record =>
    (record.challenges || []).flatMap(challenge => challenge.responses || [])
  ).filter(response => response.actor?.id === viewer?.id && response.actor?.role === viewer?.role);
  const commonsMessages = projectCommonsMessages(world, viewer);

  // The satchel is a bounded, actor-scoped projection of retained Commons
  // submissions. It points back to TownSquare but never creates XP, evidence,
  // approval, authority, or a canonical event.
  const satchelEntries = commonsMessages
    .map(event => ({ event, position: positionByEvent.get(event) }))
    .filter(entry => Number.isInteger(entry.position))
    .sort((left, right) => right.position - left.position ||
      left.event.id.localeCompare(right.event.id));
  const fieldSatchelTotal = satchelEntries.length;
  const fieldSatchelOmittedCount = Math.max(0, fieldSatchelTotal - MAX_FIELD_SATCHEL_ITEMS);
  const fieldSatchel = Object.freeze(
    satchelEntries.slice(0, MAX_FIELD_SATCHEL_ITEMS).map(({ event }) => Object.freeze({
      id: 'commons-message:' + event.id,
      eventId: event.id,
      messageId: event.messageId,
      kind: 'commons-message',
      title: 'Commons message',
      at: event.at,
      status: 'retained conversation · not evidence or authority',
      summary: event.text,
      actorId: event.actor.id,
      actorRole: event.actor.role,
      locationId: 'town-square',
      action: Object.freeze({ type: 'location', id: 'town-square' })
    }))
  );

  const questTrail = getQuestTrail(world, viewer);
  const completedQuestObjectives = questTrail
    .filter(item => item.complete === true && Number.isSafeInteger(item.progress) &&
      Number.isSafeInteger(item.target) && item.progress >= item.target).length;
  const collaboratorResponseObjective = questTrail.find(item =>
    item.id === viewer?.role + '-guild-response'
  );
  const collaboratorResponseCount = Array.isArray(collaboratorResponseObjective?.evidenceIds)
    ? collaboratorResponseObjective.evidenceIds.length : 0;
  const councilCoverageObjective = questTrail.find(item =>
    item.id === viewer?.role + '-guild-council-coverage'
  );
  const councilRoleCount = Array.isArray(councilCoverageObjective?.evidenceIds)
    ? councilCoverageObjective.evidenceIds.length : 0;
  const synthesisObjective = questTrail.find(item =>
    item.id === viewer?.role + '-multi-source-synthesis'
  );
  const synthesisAttemptCount = Array.isArray(synthesisObjective?.evidenceIds)
    ? synthesisObjective.evidenceIds.length : 0;


  const fieldItemEventForRecord=(type,record,fields)=>{
    const matches=allEvents.filter(candidate=>candidate?.type===type&&
      candidate.actor?.id===record?.actor?.id&&candidate.actor?.role===record?.actor?.role&&
      candidate.at===record?.at&&fields.every(field=>candidate[field]===record[field]));
    return matches.length===1?matches[0]:null;
  };
  const discoverySourceEvents=matchedDiscoveries.map(record=>fieldItemEventForRecord('discover',record,['locationId'])).filter(Boolean);
  const contributionSourceEvents=matchedContributions.map(record=>fieldItemEventForRecord('contribute',record,['creationId','version'])).filter(Boolean);
  const reportSourceEvents=matchedReports.map(record=>fieldItemEventForRecord('report',record,['creationId','version'])).filter(Boolean);
  const proposalSourceEvents=events.filter(event=>validMoonshotProposalIds.has(event.id));
  const collaborationResponseIds=new Set(Array.isArray(collaboratorResponseObjective?.evidenceIds)?collaboratorResponseObjective.evidenceIds:[]);
  const collaborationSourceEvents=events.filter(event=>event.type==='collaborator-response-recorded'&&collaborationResponseIds.has(event.id));
  const restorationSourceIds=new Set(matchedMethods.map(record=>
    publications.find(event=>event.creationId===record.creationId&&event.version===record.version&&event.at===record.at)?.id
  ).filter(Boolean));
  const restorationSourceEvents=publications.filter(event=>restorationSourceIds.has(event.id));
  const sourceEventsByType={
    // Every retained publication version has its own immutable event and receipt.
    // Checked-repair publications belong to Restoration rather than two slots.
    publish:publications.filter(event=>!restorationSourceIds.has(event.id)),
    discover:discoverySourceEvents,
    contribute:contributionSourceEvents,
    report:reportSourceEvents,
    study:studyEvents,
    'study-reviewed':studyReviews,
    'moonshot-proposed':proposalSourceEvents,
    'experiment-reported':experimentReports,
    'experiment-challenged':experimentChallenges,
    'collaborator-response-recorded':collaborationSourceEvents
  };
  const fieldItemKindByType={
    publish:'published-artifact',discover:'guide-discovery',contribute:'field-note',report:'field-report',
    study:'study-note','study-reviewed':'retrieval-review','moonshot-proposed':'moonshot-proposal',
    'experiment-reported':'experiment-report','experiment-challenged':'experiment-challenge',
    'collaborator-response-recorded':'guild-folio'
  };
  const sourceReferenceForEvent=event=>{
    const candidates=[
      [event?.creationId,event?.version],
      [event?.sourceCreationId,event?.sourceVersion],
      [event?.evidenceCreationId,event?.evidenceVersion]
    ];
    const candidate=candidates.find(([id,version])=>
      typeof id==='string'&&id.trim()&&Number.isSafeInteger(version)&&version>0);
    if(!candidate)return {creationId:null,version:null};
    const [creationId,version]=candidate;
    const key=versionKey(creationId,version);
    const retained=retainedVersions.get(key);
    const publication=retainedPublicationByVersion.get(key);
    const eventPosition=positionByEvent.get(event);
    const publicationPosition=publication?positionByEvent.get(publication):-1;
    const isSelfPublication=event.type==='publish'&&publication?.id===event.id;
    if(!retained||!retainedPublishedVersionKeys.has(key)||!publication||
      !Number.isInteger(eventPosition)||!Number.isInteger(publicationPosition)||
      (!isSelfPublication&&publicationPosition>=eventPosition)||
      !isStrictTimestamp(event.at)||!isStrictTimestamp(publication.at)||
      Date.parse(publication.at)>Date.parse(event.at))
      return {creationId:null,version:null};
    return {creationId,version};
  };
  const creationTitleForEvent=event=>{
    const reference=sourceReferenceForEvent(event);
    const version=reference.creationId&&reference.version
      ?retainedVersions.get(versionKey(reference.creationId,reference.version)):null;
    const creation=reference.creationId
      ?rows(world?.creations).find(item=>item?.id===reference.creationId):null;
    return typeof version?.title==='string'&&version.title.trim()?version.title:
      typeof creation?.title==='string'&&creation.title.trim()?creation.title:
      reference.creationId||event.creationId||event.sourceCreationId||event.evidenceCreationId||'retained activity';
  };
  const sourceItemForEvent=(event,slot)=>{
    const kind=slot.id==='restoration'?'checked-repair':fieldItemKindByType[event.type];
    const reference=sourceReferenceForEvent(event);
    const sourceCreationId=reference.creationId;
    const sourceVersion=reference.version;
    const version=sourceCreationId&&sourceVersion?retainedVersions.get(versionKey(sourceCreationId,sourceVersion)):null;
    const title=event.type==='publish'?'Publication · '+creationTitleForEvent(event)+' · v'+event.version:
      event.type==='discover'?'Discovery · '+String(event.locationId):
      event.type==='contribute'?'Field note · '+creationTitleForEvent(event):
      event.type==='report'?'Report · '+creationTitleForEvent(event):
      event.type==='study'?'Study note · '+creationTitleForEvent(event):
      event.type==='study-reviewed'?'Retrieval review · '+creationTitleForEvent(event):
      event.type==='moonshot-proposed'?'Moonshot proposal · '+String(event.title||event.moonshotId):
      event.type==='experiment-reported'?'Experiment report · '+String(event.reportId):
      event.type==='experiment-challenged'?'Experiment challenge · '+String(event.challengeType):
      event.type==='collaborator-response-recorded'?'Collaborator attempt · '+String(event.role):
      'Retained activity';
    const action=event.type==='discover'?Object.freeze({type:'location',id:event.locationId}):
      sourceCreationId&&sourceVersion?Object.freeze({type:'creation',id:sourceCreationId,version:sourceVersion}):
      event.type==='collaborator-response-recorded'?Object.freeze({type:'location',id:'guild_hall'}):null;
    return Object.freeze({
      eventId:event.id,kind,title,at:event.at,sourceCreationId,sourceVersion,
      receipt:version?.receipt&&typeof version.receipt.digest==='string'
        ?Object.freeze({digest:version.receipt.digest,size:version.receipt.size}):null,
      action
    });
  };
  const fieldItemSourceEntries=FIELD_EQUIPMENT_SLOTS.map(slot=>{
    const sourceEvents=slot.id==='restoration'?restorationSourceEvents:
      slot.sourceTypes.flatMap(type=>sourceEventsByType[type]||[]);
    const seen=new Set();
    const entries=sourceEvents.filter(event=>event&&typeof event.id==='string'&&
      !seen.has(event.id)&&(seen.add(event.id),true))
      .map(event=>({event,position:positionByEvent.get(event),item:sourceItemForEvent(event,slot)}))
      .filter(entry=>Number.isInteger(entry.position)&&entry.item.kind&&slot.kinds.includes(entry.item.kind))
      .sort((left,right)=>right.position-left.position||left.item.eventId.localeCompare(right.item.eventId));
    return [slot.id,entries];
  });
  const sourceUseCounts=new Map();
  for(const [,entries] of fieldItemSourceEntries)for(const entry of entries)
    sourceUseCounts.set(entry.item.eventId,(sourceUseCounts.get(entry.item.eventId)||0)+1);
  const eligibleFieldItemSources=fieldItemSourceEntries.map(([slotId,entries])=>[
    slotId,entries.filter(entry=>sourceUseCounts.get(entry.item.eventId)===1)
  ]);
  const fieldItemSourceOmittedCounts=Object.freeze(Object.fromEntries(eligibleFieldItemSources.map(([slotId,entries])=>[
    slotId,Math.max(0,entries.length-MAX_FIELD_EQUIPMENT_CHOICES)
  ])));
  const fieldItemSources=Object.freeze(Object.fromEntries(eligibleFieldItemSources.map(([slotId,entries])=>[
    slotId,Object.freeze(entries.slice(0,MAX_FIELD_EQUIPMENT_CHOICES).map(entry=>entry.item))
  ])));
  const eventById=new Map(allEvents.map(event=>[event.id,event]));
  const forgedItemCounts=new Map(),forgedSourceCounts=new Map();
  for(const event of allEvents)if(event?.type==='field-item-forged'){
    if(typeof event.itemId==='string')forgedItemCounts.set(event.itemId,(forgedItemCounts.get(event.itemId)||0)+1);
    if(typeof event.sourceEventId==='string'){
      const key=JSON.stringify([event.actor?.id,event.actor?.role,event.sourceEventId]);
      forgedSourceCounts.set(key,(forgedSourceCounts.get(key)||0)+1);
    }
  }
  const fieldItemState=projectFieldItemState(allEvents);
  const fieldItemById=new Map(),fieldInventoryEntries=[];
  for(const state of fieldItemState.items.values()){
    const event=state.event;
    const slot=FIELD_EQUIPMENT_SLOTS.find(candidate=>candidate.id===state.slotId);
    const source=eventById.get(event.sourceEventId);
    const sourceItem=slot&&source?sourceItemForEvent(source,slot):null;
    const position=positionByEvent.get(event),sourcePosition=source?positionByEvent.get(source):-1;
    const sourceKey=JSON.stringify([state.creator.id,state.creator.role,event.sourceEventId]);
    if(typeof event.itemId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(event.itemId)||
      forgedItemCounts.get(event.itemId)!==1||typeof event.sourceEventId!=='string'||
      forgedSourceCounts.get(sourceKey)!==1||!slot||!source||!sourceItem||
      !Number.isInteger(position)||!Number.isInteger(sourcePosition)||sourcePosition>=position||
      source.actor?.id!==state.creator.id||source.actor?.role!==state.creator.role||
      !slot.sourceTypes.includes(source.type)||!isStrictTimestamp(event.at)||!isStrictTimestamp(source.at)||
      Date.parse(source.at)>Date.parse(event.at))continue;
    const activeOfferId=fieldItemState.activeOffersByItem.get(event.itemId);
    const activeOffer=activeOfferId?fieldItemState.offers.get(activeOfferId):null;
    const transferred=!sameFieldActor(state.owner,state.creator);
    const item=Object.freeze({
      id:event.itemId,itemId:event.itemId,eventId:event.id,kind:'forged-field-item',
      slotId:slot.id,slotLabel:slot.label,title:slot.label,at:event.at,forgedAt:event.at,
      status:transferred?'player-owned · transferred':'player-owned · source-bound',
      summary:'Original forge and source provenance remain immutable; retained accepted-transfer events determine current ownership. This game item grants no XP, combat statistics or authority.',
      ownerId:state.owner.id,ownerRole:state.owner.role,
      creatorId:state.creator.id,creatorRole:state.creator.role,
      sourceEventId:source.id,sourceKind:sourceItem.kind,
      sourceCreationId:sourceItem.sourceCreationId??null,
      sourceVersion:sourceItem.sourceVersion??null,receipt:sourceItem.receipt??null,
      action:sourceItem.action??null,
      transferOffer:activeOffer?Object.freeze({...activeOffer}):null
    });
    fieldItemById.set(event.itemId,item);
    if(sameFieldActor(state.owner,viewer))fieldInventoryEntries.push({position,item});
  }
  const fieldItemTransferOffers=Object.freeze([...fieldItemState.offers.values()]
    .filter(offer=>offer.status==='offered'&&
      (sameFieldActor({id:offer.fromActorId,role:offer.fromActorRole},viewer)||
       (offer.recipientId===viewer.id&&offer.recipientRole===viewer.role)))
    .map(offer=>Object.freeze({...offer,item:fieldItemById.get(offer.itemId)||null})));
  const forgedItems=[...fieldItemById.values()].filter(item=>item.creatorId===viewer.id&&item.creatorRole===viewer.role);
  const forgedItemCount=forgedItems.length;
  const forgedSourceEventIds=Object.freeze(forgedItems.map(item=>item.sourceEventId));
  const fieldItemHistoryEventIds=Object.freeze([...fieldItemById.values()].map(item=>item.eventId));
  const fieldItemTransferEventIds=Object.freeze([...fieldItemState.offers.values()].flatMap(offer=>
    [offer.eventId,offer.cancelEventId,offer.transferEventId].filter(value=>typeof value==='string')));
  fieldInventoryEntries.sort((left,right)=>right.position-left.position||left.item.itemId.localeCompare(right.item.itemId));
  const fieldInventoryTotal=fieldInventoryEntries.length;
  const fieldInventoryOmittedCount=Math.max(0,fieldInventoryTotal-MAX_FIELD_INVENTORY_ITEMS);
  const fieldInventory=Object.freeze(fieldInventoryEntries.slice(0,MAX_FIELD_INVENTORY_ITEMS).map(entry=>entry.item));
  const latestSelectionBySlot=new Map();
  for(const event of events){
    if(!['field-item-equipped','field-item-unequipped'].includes(event?.type)||
      !FIELD_EQUIPMENT_SLOTS.some(slot=>slot.id===event.slotId)||!isStrictTimestamp(event.at))continue;
    const position=positionByEvent.get(event);
    if(!Number.isInteger(position))continue;
    const previous=latestSelectionBySlot.get(event.slotId);
    if(!previous||position>previous.position)latestSelectionBySlot.set(event.slotId,{event,position});
  }
  const equipment=Object.freeze(FIELD_EQUIPMENT_SLOTS.map(slot=>{
    const choices=fieldInventoryEntries.filter(entry=>entry.item.slotId===slot.id)
      .sort((left,right)=>right.position-left.position||left.item.eventId.localeCompare(right.item.eventId));
    const selection=latestSelectionBySlot.get(slot.id)||null;
    const selected=selection?.event.type==='field-item-equipped'
      ?choices.find(entry=>entry.item.eventId===selection.event.sourceEventId&&entry.position<selection.position)?.item||null:null;
    return Object.freeze({
      id:slot.id,label:slot.label,description:slot.description,
      mode:selected?'pinned':'unequipped',status:selected?'record-backed':'empty',
      source:selected,choices:Object.freeze(choices.slice(0,MAX_FIELD_EQUIPMENT_CHOICES).map(entry=>entry.item)),
      choicesOmittedCount:Math.max(0,choices.length-MAX_FIELD_EQUIPMENT_CHOICES)
    });
  }));

  const skills = [
    {
      id: 'maker',
      label: 'Maker',
      count: publications.length,
      record: 'version-matched published versions',
      basis: 'Unique Founder publication events matched to retained artifact versions and timestamps.'
    },
    {
      id: 'explorer',
      label: 'Explorer',
      count: matchedDiscoveries.length,
      record: 'guide discoveries',
      basis: 'Actor-attributed guide interactions; shared visits require server-checked walkable proximity, while private visits remain local and self-attested.'
    },
    {
      id: 'observer',
      label: 'Observer',
      count: matchedContributions.length,
      record: 'field notes',
      basis: 'Attributed notes attached to a published version.'
    },
    {
      id: 'speaker',
      label: 'Speaker',
      count: commonsMessages.length,
      record: 'retained Commons messages',
      basis: 'Unique actor-attributed TownSquare posts. Conversation is not evidence, truth, approval, authority, mastery, or XP.'
    },
    {
      id: 'scholar',
      label: 'Scholar',
      count: studyEvents.length,
      record: 'source-bound study notes',
      basis: 'Unique study notes matched to a retained published version, a question, an explanation and a next check; this counts recorded practice, not mastery.'
    },
    {
      id: 'source-recorder',
      label: 'Source Recorder',
      count: sourceObservationRecords.length,
      record: 'actor-attributed falsifiable source notes',
      basis: 'Unique notes linked to one earlier retained Source Observatory publication. This counts recording practice, not truth, verification, mastery or XP.'
    },
    {
      id: 'retriever',
      label: 'Retriever',
      count: studyReviews.length,
      record: 'retained retrieval reviews of earlier study notes',
      basis: 'Unique later reviews bound to the same actor and exact source version; this counts practice, not recall accuracy or mastery.'
    },
    {
      id: 'challenger',
      label: 'Challenger',
      count: matchedReports.length + sourceObservationChallenges.length,
      record: 'reports and challenges to another actor’s source observations',
      basis: 'Attributed version-bound reports plus unique, earlier challenges to another actor’s retained source notes; this counts dissenting practice, not correctness or adjudication.'
    },
    {
      id: 'source-responder',
      label: 'Source Responder',
      count: sourceObservationResponses.length,
      record: 'append-only author responses to retained challenges',
      basis: 'Responses are counted only when the original note author answers one uniquely linked earlier challenge. This counts accountable response practice, not truth, adjudication, approval, or XP.'
    },
    {
      id: 'collaborator',
      label: 'Collaborator',
      count: collaboratorResponseCount,
      record: 'bounded collaborator-response attempts',
      basis: 'Unique actor-attributed responses to bounded Guild Hall role packets, including rejected attempts. Rejected responses remain preserved attempts, not endorsements; structure/scope validation is not provider identity, truth, independent observation, execution, mastery, approval, XP or authority.'
    },
    {
      id: 'council',
      label: 'Council',
      count: councilRoleCount,
      record: 'distinct Guild Hall role attempts',
      basis: 'One actor-scoped retained response attempt per bounded Guild Hall role. Rejected attempts remain preserved attempts, not endorsements; role coverage is not consensus, independent humans, source truth, independent observation, approval, authority, mastery or XP.'
    },
    {
      id: 'synthesis',
      label: 'Synthesis',
      count: synthesisAttemptCount,
      record: 'multi-source Synthesis Clerk attempts',
      basis: 'Actor-attributed responses that cite one retained Moonshot proposal and at least one linked experiment report or challenge. Counts a preserved attempt, not correctness, consensus, truth, independent evidence, execution, mastery, approval, XP or authority.'
    },
    {
      id: 'researcher',
      label: 'Researcher',
      count: events.filter(event => validMoonshotProposalIds.has(event.id)).length,
      record: 'retained falsifiable proposals',
      basis: 'Attributed proposals with a hypothesis, falsifier and evidence requirement; this counts research activity, not a validated discovery or experiment result.'
    },
    {
      id: 'experimenter',
      label: 'Experimenter',
      count: experimentReports.length,
      record: 'retained experiment reports',
      basis: 'Attributed attempt notes and reported outcomes; not proof of execution, independent observation, or a validated result.'
    },
    {
      id: 'adversary',
      label: 'Adversary',
      count: experimentChallenges.length,
      record: 'retained challenges to another actor’s experiment reports',
      basis: 'Unique challenges bound to another actor’s earlier valid report. This counts adversarial participation, not correctness or adjudication.'
    },
    {
      id: 'questkeeper',
      label: 'Questkeeper',
      count: completedQuestObjectives,
      record: 'completed evidence-backed quest objectives',
      basis: 'The same source-linked quest trail shown in the world HUD. Completion records matched activity or artifact linkage, not truth, mastery, correctness, or approval.'
    },
    {
      id: 'restorer',
      label: 'Restorer',
      count: matchedMethods.length,
      record: 'checked repairs',
      basis: 'Methods recorded when a checked repair is published.'
    }
  ].map(skill => Object.freeze(skill));
  skills.push(Object.freeze({
    id:'forger',label:'Forger',count:forgedItemCount,
    record:'unique items originally forged by this actor',
    basis:'Creator attribution remains after accepted transfers; this skill counts demonstrated forging, not current inventory or ownership.'
  }));
  skills.push(Object.freeze({
    id:'armor-bearer',label:'Armor Bearer',count:equipment.filter(slot=>slot.source).length,
    record:'currently equipped actor-owned field items',
    basis:'Each equipped slot points to one earlier forged item currently owned by this actor. Transfers require an unequipped item; loadout grants no XP, combat statistics, truth or authority.'
  }));

  const publishedVersionKeys = retainedPublishedVersionKeys;
  const inventory = rows(world?.creations)
    .filter(creation => creation && typeof creation.id === 'string' &&
      Number.isSafeInteger(creation.version) && creation.version > 0 &&
      publishedVersionKeys.has(versionKey(creation.id, creation.version)))
    .map(creation => Object.freeze({
      id: creation.id,
      title: typeof creation.title === 'string' && creation.title ? creation.title : 'Untitled place',
      kind: typeof creation.kind === 'string' ? creation.kind : 'unknown',
      version: creation.version,
      receipt: creation.receipt && typeof creation.receipt.digest === 'string'
        ? Object.freeze({ digest: creation.receipt.digest, size: creation.receipt.size })
        : null
    }));

  const recentActivity = events
    .filter(event => isStrictTimestamp(event.at))
    .slice()
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) ||
      String(a.id).localeCompare(String(b.id)))
    .slice(0, 6)
    .map(event => Object.freeze({
      type: typeof event.type === 'string' ? event.type : 'unknown',
      at: event.at,
      creationId: typeof event.creationId === 'string' ? event.creationId
        : typeof event.sourceCreationId === 'string' ? event.sourceCreationId : null,
      version: Number.isInteger(event.version) ? event.version
        : Number.isInteger(event.sourceVersion) ? event.sourceVersion : null,
      locationId: typeof event.locationId === 'string' ? event.locationId : null
    }));

  return Object.freeze({
    level,
    xp,
    worldXp,
    levelStartXp: (level - 1) * LEVEL_SPAN,
    nextLevelXp: level * LEVEL_SPAN,
    xpIntoLevel: xp - (level - 1) * LEVEL_SPAN,
    xpPerLevel: LEVEL_SPAN,
    skills: Object.freeze(skills),
    equipment,
    fieldInventory,
    fieldInventoryTotal,
    fieldInventoryOmittedCount,
    fieldItemSources,
    fieldItemSourceOmittedCounts,
    fieldItemTransferOffers,
    fieldItemHistoryEventIds,
    fieldItemTransferEventIds,
    forgedSourceEventIds,
    studyCards,
    studyCardTotal,
    studyCardOmittedCount,
    studyCardUnavailableCount,
    inventory: Object.freeze(inventory),
    fieldSatchel,
    fieldSatchelTotal,
    fieldSatchelOmittedCount,
    recentActivity: Object.freeze(recentActivity)
  });
}
