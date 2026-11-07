import { isStrictTimestamp } from './timestamps.mjs';
import { isValidMoonshotProposal, projectResearchRecords, projectSourceObservationRecords, sameResearchActor } from './research-records.mjs';
import { COLLABORATOR_ROLES, projectCollaboratorPackets } from './collaborator-contracts.mjs';
import { projectCommonsMessages, projectPlayerGuilds, projectGuildFieldSatchel } from './social.mjs';
const rows = value => Array.isArray(value) ? value : [];
const mine = (entries, viewer) => typeof viewer?.id === 'string' && viewer.id && ['founder', 'witness'].includes(viewer.role)
  ? rows(entries).filter(entry => entry?.actor?.id === viewer.id && entry.actor.role === viewer.role)
  : [];

/** Find one unambiguous review that follows and remains bound to this exact study note. */
export function findStudyReview(note, events) {
  const identifier = value => typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) &&
    !['constructor', 'prototype', '__proto__'].includes(value);
  if (!identifier(note?.id) || !identifier(note?.studyId) || !identifier(note?.creationId) ||
      !Number.isSafeInteger(note?.version) || note.version < 1 ||
      !isStrictTimestamp(note?.at) ||
      !identifier(note?.actor?.id) || !['founder', 'witness'].includes(note.actor.role)) return null;

  const history = rows(events);
  const sourceMatches = history.filter(event => event?.type === 'study' && event.studyId === note.studyId);
  if (sourceMatches.length !== 1) return null;
  const source = sourceMatches[0];
  if (source.id !== note.id || source.creationId !== note.creationId ||
      source.version !== note.version || source.at !== note.at ||
      source.actor?.id !== note.actor.id || source.actor?.role !== note.actor.role) return null;
  const sourceIndex = history.indexOf(source);
  if (sourceIndex < 0) return null;
  const positionByEvent = new Map(history.map((event, index) => [event, index]));

  const reviews = history.filter(event => event?.type === 'study-reviewed');
  const counts = { id: new Map(), reviewId: new Map(), studyId: new Map() };
  for (const event of history) {
    if (typeof event?.id === 'string') counts.id.set(event.id, (counts.id.get(event.id) || 0) + 1);
    if (event?.type === 'study-reviewed') {
      for (const field of ['reviewId', 'studyId']) {
        const value = event[field];
        if (typeof value === 'string') counts[field].set(value, (counts[field].get(value) || 0) + 1);
      }
    }
  }
  const unique = (field, value) => counts[field].get(value) === 1;
  const candidates = reviews.filter(event =>
    identifier(event?.id) && unique('id', event.id) && positionByEvent.get(event) > sourceIndex &&
    identifier(event?.reviewId) && unique('reviewId', event.reviewId) &&
    event.studyId === note.studyId && unique('studyId', note.studyId) &&
    event.creationId === note.creationId && event.version === note.version &&
    event.actor?.id === note.actor.id && event.actor?.role === note.actor.role &&
    isStrictTimestamp(event.at) && Date.parse(event.at) > Date.parse(note.at) &&
    typeof event.response === 'string' && event.response.trim() &&
    Array.from(event.response).length <= 1000 &&
    typeof event.reflection === 'string' && event.reflection.trim() &&
    Array.from(event.reflection).length <= 1000
  );
  return candidates.length === 1 ? candidates[0] : null;
}
/** Detect a retained review attempt even when it cannot safely satisfy the note. */
export function hasStudyReviewRecord(note, events) {
  return typeof note?.studyId === 'string' && note.studyId.length > 0 &&
    rows(events).some(event => event?.type === 'study-reviewed' && event.studyId === note.studyId);
}


export function getQuest(world, viewer) {
  if (typeof viewer?.id !== 'string' || !viewer.id || !['founder', 'witness'].includes(viewer.role)) return {
    id: 'quest-unavailable', title: 'Quest unavailable',
    copy: 'Quest progress is unavailable until a valid Founder or Witness character is selected.',
    button: 'Explore the world →', action: 'places'
  };
  const creations = rows(world?.creations);
  const discoveries = mine(world?.discoveries, viewer);
  const notes = mine(world?.contributions, viewer);
  const reports = mine(world?.reports, viewer);
  const role = viewer.role;

  if (role === 'witness') {
    if (discoveries.length === 0) return {
      id: 'witness-discover', title: 'Witness Quest 1 · Find your bearings',
      copy: 'Visit a guide and discover a place. Shared visits require a server-checked walkable path and proximity; private visits are local self-attestations. Neither is GPS evidence or proof of a claim.',
      button: 'Explore the world →', action: 'places'
    };
    if (creations.length === 0 && discoveries.length < 4) return {
      id: 'witness-map', title: 'Witness Quest 2 · Map the grounds',
      copy: `You have recorded ${discoveries.length} of four guide locations. Shared visits are checked against a walkable server position; private visits remain local. Neither is GPS evidence or proof of a claim.`,
      button: 'Discover another guide →', action: 'places'
    };
    if (creations.length === 0) return {
      id: 'witness-await-work', title: 'The grounds are mapped. Work has not arrived yet.',
      copy: 'All four guide locations are recorded, but no creation is published in this world yet. Return when a Founder places actual work here.',
      button: 'Revisit the grounds →', action: 'places'
    };
    if (notes.length === 0) return {
      id: 'witness-note', title: 'Witness Quest 3 · Leave a useful trace',
      copy: 'Open a creation, select the version you actually inspected, and leave a specific observation. Your note is attributed to you.',
      button: 'Find a place to witness →', action: 'places'
    };
    if (reports.length === 0) return {
      id: 'witness-report', title: 'Witness Quest 4 · Test the claim',
      copy: 'Inspect a published version and report one ambiguity, failure, or question worth testing. Disagreement belongs in the record.',
      button: 'Inspect the work →', action: 'places'
    };
    return {
      id: 'witness-return', title: 'Witness Quest · Keep the record alive',
      copy: 'You have explored and contributed. Compare a published version with an earlier one, and add another note only when you have something useful to say.',
      button: 'Visit the creations →', action: 'places'
    };
  }

  if (creations.length === 0) return {
    id: 'founder-create', title: 'Founder Quest 1 · Make your first place',
    copy: 'Reach the Making Bench and create one real artifact: a comic, a melody, a question, or your own HTML. Your first creation becomes a place in the world.',
    button: 'Begin at the Making Bench →', action: 'workbench'
  };
  if (discoveries.length === 0) return {
    id: 'founder-discover', title: 'Founder Quest 2 · Walk the institution',
    copy: 'Discover a guide, then return to inspect your creation as a player—not only as its maker. Shared visits require server-checked walkable proximity; private visits remain local.',
    button: 'Explore the world →', action: 'places'
  };
  if (notes.length === 0) return {
    id: 'founder-note', title: 'Founder Quest 3 · Leave a field note',
    copy: 'Open a published place and add a concrete observation about what works, what is missing, or what deserves a repair.',
    button: 'Visit your creation →', action: 'places'
  };
  if (creations.length === 1) return {
    id: 'founder-create-second', title: 'Founder Quest 4 · Grow beyond one place',
    copy: 'Your first place has a trace. Make a second artifact that connects to it, and keep the first version available for comparison.',
    button: 'Make the next place →', action: 'workbench'
  };
  return {
    id: 'founder-connect', title: 'Founder Quest · Grow the Common Ground',
    copy: `You have made ${creations.length} places. Visit one, preserve its earlier version, and build something that connects it to another idea.`,
    button: 'Explore your places →', action: 'places'
  };
}


/**
 * Keep the main quest invitation attached to the next unfinished evidence-backed
 * objective once the introductory journey is complete. This is a read-only view
 * of the trail: opening an objective never records progress or awards XP.
 */
export function getActiveQuest(world, viewer, trail = null) {
  const introductory = getQuest(world, viewer);
  if (!['founder-connect', 'witness-return'].includes(introductory.id)) return introductory;

  const objectives = Array.isArray(trail) ? trail : getQuestTrail(world, viewer);
  const next = objectives.find(item => !item.complete);
  if (!next) {
    // An empty/missing objective list is not evidence that the objective set was completed.
    if (objectives.length === 0) return introductory;
    return Object.freeze({
    id: `${viewer.role}-current-trail-recorded`,
    title: 'Current quest trail · all objectives recorded',
    copy: 'Every currently defined objective has a matching retained record. This is a gameplay checkpoint—not approval, truth verification, mastery, or proof of external execution. Inspect the retained trail, then choose a new research question when ready.',
    button: 'Inspect retained quest trail →',
    action: 'trail'
    });
  }

  const copy = next.blockedReason || next.interpretation ||
    `Progress ${next.progress}/${next.target}. Only retained, attributable activity advances this objective; it does not certify the underlying claim.`;
  return Object.freeze({
    id: next.id,
    title: next.title,
    copy,
    button: next.action ? 'Go do this →' : 'View quest trail →',
    action: 'trail',
    nextAction: next.action
  });
}


const GUIDE_LOCATIONS = new Set(['relay', 'river', 'overlook', 'ruins']);
const inspect = (creation, label, explanation) => creation && typeof creation.id === 'string'
  ? { type: 'inspect', creationId: creation.id, label, explanation }
  : null;
const hasEarlierVersion = creation => Boolean(creation && Number.isInteger(creation.version) && creation.version > 1 && rows(creation.versions).some(version => Number.isInteger(version?.version) && version.version < creation.version));

/**
 * Choose the next real activity for a guide location without mutating world state.
 * Witnesses can inspect published work but can never be routed into Founder-only drafting.
 */
export function getLocationAction(locationId, world, viewer) {
  if (!GUIDE_LOCATIONS.has(locationId)) return null;
  if (typeof viewer?.id !== 'string' || !viewer.id || !['founder', 'witness'].includes(viewer.role)) return null;
  const creations = rows(world?.creations).filter(creation =>
    creation && typeof creation.id === 'string' && creation.id.length > 0
  );
  const oldest = creations[0] || null;
  const newest = creations.at(-1) || null;
  const comic = creations.find(creation => creation.kind === 'comic') || null;
  const observatory = creations.find(creation => creation.kind === 'observatory') || null;
  const founder = viewer?.role === 'founder';

  if (!founder) {
    if (!creations.length) return {
      type: 'places',
      label: 'Explore another guide →',
      explanation: 'No published creation is available to inspect yet. Your discovery is recorded, but it does not create work or grant publishing authority.'
    };
    const target = locationId === 'river' ? observatory || newest
      : locationId === 'overlook' ? oldest
      : locationId === 'ruins' ? comic || oldest
      : newest;
    const labels = {
      relay: 'Inspect published work to carry a useful response →',
      river: 'Inspect a published receipt →',
      overlook: hasEarlierVersion(oldest) ? 'Compare a retained version →' : 'Inspect the first version →',
      ruins: 'Read a published artifact →'
    };
    const explanations = {
      relay: 'Open an existing creation and leave a specific, attributed contribution or version-bound report. This guide does not execute an external request.',
      river: 'Inspect the actual bytes and receipt. The receipt identifies content; it does not establish that the content is true.',
      overlook: hasEarlierVersion(oldest)
        ? 'Open the earliest published place and compare its retained versions before proposing a repair.'
        : 'This place has no retained earlier version yet. Inspect the first published version and leave a note if useful; do not assume a comparison exists.',
      ruins: 'Open a real published artifact. If it is a comic, read the recovered pages; do not infer unseen pages.'
    };
    return inspect(target, labels[locationId], explanations[locationId]) || {
      type: 'places', label: 'Explore another guide →',
      explanation: 'No published creation is available to inspect yet.'
    };
  }

  if (locationId === 'relay') return {
    type: 'workbench', recipe: 'custom',
    label: 'Draft a portable request →',
    explanation: 'Prepare a bounded request with context, evidence, uncertainty and a testable next step. Drafting does not send it to a provider.'
  };
  if (locationId === 'river') {
    if (observatory) return inspect(observatory, 'Inspect your source observatory →',
      'Reuse the existing observatory rather than creating a duplicate. Compare its source notes and uncertainty.');
    return {
      type: 'workbench', recipe: 'observatory',
      label: 'Build a source observatory →',
      explanation: 'Put one claim beside a source and a question that could change your mind. The local artifact does not fetch or verify the source.'
    };
  }
  if (locationId === 'overlook') {
    if (oldest) return hasEarlierVersion(oldest)
      ? inspect(oldest, 'Inspect retained versions →',
        'Open the earliest published place. Review its actual versions and field notes before deciding whether a repair is warranted.')
      : inspect(oldest, 'Inspect the first version →',
        'This place has no retained earlier version yet. Inspect what exists; a checked repair can create a real comparison point.');
    return {
      type: 'workbench', recipe: 'custom',
      label: 'Make a first place to preserve →',
      explanation: 'There is nothing to repair yet. Publish one real artifact first; the Long View can then lead back to its retained history.'
    };
  }
  if (comic) return inspect(comic, 'Read the published comic →',
    'Open the existing comic instead of creating a duplicate. Inspect the pages actually present before making a claim about them.');
  return {
    type: 'workbench', recipe: 'comic',
    label: 'Give the recovered comic a home →',
    explanation: 'Create a playable home for the recovered pages. Missing pages remain labelled unavailable; no missing content is invented.'
  };
}


// Read-only objective trail. A milestone advances only when a retained event can
// be matched unambiguously to the corresponding world record and, for publications,
// to the exact retained artifact version. Event IDs must be unique across the whole
// history; a reused ID cannot support two different claims.
const trailRows = value => Array.isArray(value) ? value : [];
const trailUnique = values => [...new Set(values.filter(value => typeof value === 'string' && value.length > 0))];

function uniqueEventIds(events) {
  const counts = new Map();
  for (const event of trailRows(events)) {
    if (typeof event?.id !== 'string' || event.id.length === 0) continue;
    counts.set(event.id, (counts.get(event.id) || 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count === 1).map(([id]) => id));
}

function matchingTrailRecords(type, records, events, fields, actorId, actorRole) {
  const validIds = uniqueEventIds(events);
  const owned = trailRows(records).filter(record => record?.actor?.id === actorId && record.actor.role === actorRole);
  const candidates = trailRows(events).filter(event =>
    event?.type === type && event?.actor?.id === actorId && event?.actor?.role === actorRole && validIds.has(event.id)
  );
  const key = entry => JSON.stringify([entry?.actor?.id, entry?.actor?.role, entry?.at, ...fields.map(field => entry?.[field])]);
  const recordCounts = new Map(), eventCounts = new Map(), eventByFingerprint = new Map();
  for (const record of owned) {
    const fingerprint = key(record);
    recordCounts.set(fingerprint, (recordCounts.get(fingerprint) || 0) + 1);
  }
  for (const event of candidates) {
    const fingerprint = key(event);
    eventCounts.set(fingerprint, (eventCounts.get(fingerprint) || 0) + 1);
    if (!eventByFingerprint.has(fingerprint)) eventByFingerprint.set(fingerprint, event);
  }
  // Resolve the one-to-one join from indexes instead of rescanning every candidate
  // for each record. Duplicate fingerprints remain deliberately unusable.
  return owned.flatMap(record => {
    const fingerprint = key(record);
    return recordCounts.get(fingerprint) === 1 && eventCounts.get(fingerprint) === 1
      ? [{ record, event: eventByFingerprint.get(fingerprint) }] : [];
  });
}

function retainedPublicationEvents(world, actorId = null, actorRole = null) {
  const events = trailRows(world?.events);
  const validIds = uniqueEventIds(events);
  const creations = trailRows(world?.creations);
  const versions = creations.flatMap(creation => [...trailRows(creation?.versions), creation]);
  const versionCounts = new Map();
  const versionKey = (id, version, publishedAt) => JSON.stringify([id, version, publishedAt]);
  for (const version of versions) {
    const key = versionKey(version?.id, version?.version, version?.publishedAt);
    versionCounts.set(key, (versionCounts.get(key) || 0) + 1);
  }
  return events.filter(event => {
    if (event?.type !== 'publish' || typeof event.id !== 'string' || !validIds.has(event.id) ||
        typeof event.creationId !== 'string' || !Number.isSafeInteger(event.version) || event.version < 1 ||
        !isStrictTimestamp(event.at) || typeof event.actor?.id !== 'string' || event.actor?.role !== 'founder' ||
        ((actorId !== null && event.actor.id !== actorId) || (actorRole !== null && event.actor.role !== actorRole))) return false;
    return versionCounts.get(versionKey(event.creationId, event.version, event.at)) === 1;
  });
}

function referencesEarlierRetainedPublication(match, hasUniqueEarlierPublication, eventPositionByReference) {
  const event = match?.event;
  if (!event || typeof event.creationId !== 'string' || !Number.isSafeInteger(event.version) ||
      event.version < 1 || !isStrictTimestamp(event.at)) return false;
  return hasUniqueEarlierPublication(
    event.creationId, event.version, event.at, eventPositionByReference.get(event)
  );
}

function distinctCreationEvents(events) {
  const byCreation = new Map();
  for (const event of events) {
    if (typeof event.creationId === 'string' && event.creationId.length > 0 &&
        typeof event.id === 'string' && event.id.length > 0 && !byCreation.has(event.creationId)) {
      byCreation.set(event.creationId, event);
    }
  }
  return [...byCreation.values()];
}

const RESEARCH_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const safeResearchId = value => typeof value === 'string' &&
  RESEARCH_ID.test(value) && !['constructor', 'prototype', '__proto__'].includes(value);

// Keep the quest's source eligibility aligned with the Forge equipment contract.
// The parity test in game-quests.test.mjs compares this map with FIELD_EQUIPMENT_SLOTS.
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

function projectFieldForgeEvents(events, actorId, actorRole, eventPositionByReference) {
  const history = trailRows(events);
  const validIds = uniqueEventIds(history);
  const sourceById = new Map(history
    .filter(event => validIds.has(event?.id))
    .map(event => [event.id, event]));
  const itemIdCounts = new Map();
  const sourceCounts = new Map();
  for (const event of history) {
    if (event?.type !== 'field-item-forged') continue;
    if (typeof event.itemId === 'string') {
      itemIdCounts.set(event.itemId, (itemIdCounts.get(event.itemId) || 0) + 1);
    }
    const sourceKey = JSON.stringify([event.actor?.id, event.actor?.role, event.sourceEventId]);
    sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) || 0) + 1);
  }
  return history.filter(event => {
    if (event?.type !== 'field-item-forged' || !safeResearchId(event.id) || !validIds.has(event.id) ||
        !safeResearchId(event.itemId) || itemIdCounts.get(event.itemId) !== 1 ||
        !safeResearchId(event.sourceEventId) ||
        !Object.hasOwn(FIELD_ITEM_SOURCE_TYPES, event.slotId) ||
        sourceCounts.get(JSON.stringify([event.actor?.id, event.actor?.role, event.sourceEventId])) !== 1 ||
        event.actor?.id !== actorId || event.actor?.role !== actorRole || !isStrictTimestamp(event.at)) return false;
    const source = sourceById.get(event.sourceEventId);
    const sourcePosition = source ? eventPositionByReference.get(source) ?? -1 : -1;
    const forgePosition = eventPositionByReference.get(event) ?? -1;
    const sourceTypes = FIELD_ITEM_SOURCE_TYPES[event.slotId];
    return Boolean(source && sourceTypes.includes(source.type) &&
      source.actor?.id === actorId && source.actor?.role === actorRole &&
      isStrictTimestamp(source.at) && sourcePosition >= 0 && forgePosition > sourcePosition &&
      Date.parse(source.at) <= Date.parse(event.at));
  });
}

function projectFieldEquipmentEvents(events, actorId, actorRole, eventPositionByReference, fieldForgeEvents) {
  const history = trailRows(events);
  const validIds = uniqueEventIds(history);
  const forgedById = new Map(fieldForgeEvents.map(event => [event.id, event]));
  const activeBySlot = new Map();
  const equipmentEvents = [];

  // Replay this actor's reversible slot selections. A quest records the first
  // valid equip action even if a later retained unequip removes the loadout.
  for (const event of history) {
    if (event?.type === 'field-item-equipped') {
      if (!safeResearchId(event.id) || !validIds.has(event.id) ||
          !safeResearchId(event.sourceEventId) ||
          !Object.hasOwn(FIELD_ITEM_SOURCE_TYPES, event.slotId) ||
          event.actor?.id !== actorId || event.actor?.role !== actorRole ||
          !isStrictTimestamp(event.at)) continue;
      const source = forgedById.get(event.sourceEventId);
      const sourcePosition = source ? eventPositionByReference.get(source) ?? -1 : -1;
      const position = eventPositionByReference.get(event) ?? -1;
      if (!source || source.slotId !== event.slotId || sourcePosition < 0 ||
          position <= sourcePosition || !isStrictTimestamp(source.at) ||
          Date.parse(source.at) > Date.parse(event.at)) continue;
      if (activeBySlot.get(event.slotId)?.sourceEventId === event.sourceEventId) continue;
      activeBySlot.set(event.slotId, { sourceEventId: event.sourceEventId, position, at: event.at });
      equipmentEvents.push(event);
    } else if (event?.type === 'field-item-unequipped') {
      if (!safeResearchId(event.id) || !validIds.has(event.id) ||
          !Object.hasOwn(FIELD_ITEM_SOURCE_TYPES, event.slotId) ||
          event.actor?.id !== actorId || event.actor?.role !== actorRole ||
          !isStrictTimestamp(event.at)) continue;
      const active = activeBySlot.get(event.slotId);
      const position = eventPositionByReference.get(event) ?? -1;
      if (active && position > active.position && Date.parse(active.at) <= Date.parse(event.at)) {
        activeBySlot.delete(event.slotId);
      }
    }
  }
  return equipmentEvents;
}

function researchObjectAction(proposal) {
  const moonshotId = proposal?.moonshotId;
  if (!safeResearchId(moonshotId)) return null;
  return { type: 'research-object', id: 'moonshot-object:' + moonshotId, moonshotId };
}

function researchActivityAction(event, activityId) {
  if (!safeResearchId(event?.id) || !safeResearchId(event?.moonshotId) ||
      !safeResearchId(activityId)) return null;
  return {
    type: 'research-activity',
    id: 'research-activity:' + event.id,
    moonshotId: event.moonshotId,
    activityId,
  };
}

function trailMilestone(id, title, target, evidenceIds, evidenceEvents = [], action = null, blockedReason = null, interpretation = null) {
  const evidence = trailUnique(evidenceIds);
  const allowed = new Set(evidence);
  const seen = new Set();
  const details = [];
  for (const event of trailRows(evidenceEvents)) {
    if (!allowed.has(event?.id) || seen.has(event.id)) continue;
    seen.add(event.id);
    details.push(Object.freeze({
      id: event.id,
      type: event.type,
      at: typeof event.at === 'string' ? event.at : null,
      actorId: typeof event.actor?.id === 'string' ? event.actor.id : null,
      creationId: typeof event.creationId === 'string' ? event.creationId
        : typeof event.sourceCreationId === 'string' ? event.sourceCreationId
        : typeof event.evidenceCreationId === 'string' ? event.evidenceCreationId : null,
      version: Number.isInteger(event.version) ? event.version
        : Number.isInteger(event.sourceVersion) ? event.sourceVersion
        : Number.isSafeInteger(event.evidenceVersion) ? event.evidenceVersion : null,
      locationId: typeof event.locationId === 'string' ? event.locationId : null,
      ...(event.type === 'collaborator-response-recorded' ? {
        collaboratorRole: typeof event.role === 'string' ? event.role : null,
        responseId: typeof event.responseId === 'string' ? event.responseId : null,
        validator: typeof event.validator === 'string' ? event.validator : null,
        validationStatus: typeof event.validationStatus === 'string' ? event.validationStatus : null,
        validationReason: typeof event.validationReason === 'string' ? event.validationReason : null,
        sourceEventIds: Object.freeze(Array.isArray(event.sourceEventIds) ? [...event.sourceEventIds] : [])
      } : {}),
      ...(event.type === 'field-item-forged' ? {
        itemId: typeof event.itemId === 'string' ? event.itemId : null,
        slotId: typeof event.slotId === 'string' ? event.slotId : null,
        sourceEventId: typeof event.sourceEventId === 'string' ? event.sourceEventId : null
      } : {}),
      ...(event.type === 'field-item-equipped' ? {
        slotId: typeof event.slotId === 'string' ? event.slotId : null,
        sourceEventId: typeof event.sourceEventId === 'string' ? event.sourceEventId : null
      } : {})
    }));
  }
  const complete = evidence.length >= target;
  const nextAction = !complete && action && typeof action === 'object'
    ? Object.freeze({ ...action }) : null;
  return Object.freeze({
    id, title, target, progress: Math.min(target, evidence.length),
    complete,
    evidenceIds: Object.freeze(evidence),
    evidence: Object.freeze(details),
    action: nextAction,
    blockedReason: !complete && !nextAction && typeof blockedReason === 'string' ? blockedReason : null,
    ...(typeof interpretation === 'string' ? { interpretation } : {}),
  });
}

const PLAYER_GUILD_MEMBERSHIP_EVENT_TYPES = new Set([
  'guild-created', 'guild-joined', 'guild-left', 'guild-disbanded'
]);

/** Resolve reversible actor/session membership only from a unique retained guild history. */
function currentPlayerGuildMembership(world, viewer, events) {
  const guildEvents = trailRows(events).filter(event =>
    PLAYER_GUILD_MEMBERSHIP_EVENT_TYPES.has(event?.type)
  );
  const validIds = uniqueEventIds(events);
  const validIdentifier = value => typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) &&
    !['constructor', 'prototype', '__proto__'].includes(value);
  if (guildEvents.some(event =>
    !validIdentifier(event?.id) || !validIds.has(event.id) || !isStrictTimestamp(event?.at)
  )) return { available: false, event: null };

  try {
    const name = typeof viewer?.name === 'string' && viewer.name.trim() &&
      Array.from(viewer.name).length <= 80 ? viewer.name : 'Player';
    const projection = projectPlayerGuilds(world, {
      id: viewer.id, role: viewer.role, name
    });
    if (!projection.viewerGuildId) return { available: true, event: null, projection };
    const event = [...guildEvents].reverse().find(candidate =>
      (candidate.type === 'guild-created' || candidate.type === 'guild-joined') &&
      candidate.guildId === projection.viewerGuildId &&
      candidate.actor?.id === viewer.id && candidate.actor?.role === viewer.role
    );
    return event ? { available: true, event, projection } : { available: false, event: null, projection };
  } catch {
    return { available: false, event: null };
  }
}

/** Return only unambiguous accepted handoffs for the actor; offers and refusals are not progress. */
function guildLeadershipHandoffEvents(world, events, actorId, actorRole, eventPositionByReference) {
  try {
    // The canonical guild projection validates the full offer/cancel/decline/accept
    // state machine before a quest can consume any one of its events.
    projectPlayerGuilds(world);
  } catch {
    return { available: false, events: [] };
  }
  const validIds = uniqueEventIds(events);
  const offers = new Map();
  const offerCounts = new Map();
  const cancellationCounts = new Map();
  const declineCounts = new Map();
  const transferCounts = new Map();
  for (const event of events) {
    const offerId = event?.offerId;
    if (typeof offerId !== 'string') continue;
    if (event.type === 'guild-leadership-transfer-offered') {
      offerCounts.set(offerId, (offerCounts.get(offerId) || 0) + 1);
      if (!offers.has(offerId)) offers.set(offerId, event);
    } else if (event.type === 'guild-leadership-transfer-cancelled') {
      cancellationCounts.set(offerId, (cancellationCounts.get(offerId) || 0) + 1);
    } else if (event.type === 'guild-leadership-transfer-declined') {
      declineCounts.set(offerId, (declineCounts.get(offerId) || 0) + 1);
    } else if (event.type === 'guild-leadership-transferred') {
      transferCounts.set(offerId, (transferCounts.get(offerId) || 0) + 1);
    }
  }
  const accepted = events.filter(event => {
    if (event?.type !== 'guild-leadership-transferred' ||
        typeof event.id !== 'string' || !validIds.has(event.id) ||
        !isStrictTimestamp(event.at) ||
        event.actor?.id !== actorId || event.actor?.role !== actorRole) return false;
    const offer = offers.get(event.offerId);
    const offerPosition = offer ? eventPositionByReference.get(offer) : -1;
    const transferPosition = eventPositionByReference.get(event);
    return offerCounts.get(event.offerId) === 1 &&
      transferCounts.get(event.offerId) === 1 &&
      (cancellationCounts.get(event.offerId) || 0) === 0 &&
      (declineCounts.get(event.offerId) || 0) === 0 &&
      offer?.guildId === event.guildId &&
      offer?.recipientId === event.actor.id &&
      offer?.recipientRole === event.actor.role &&
      offer?.actor?.id === event.fromLeaderId &&
      offer?.actor?.role === event.fromLeaderRole &&
      Number.isInteger(offerPosition) && Number.isInteger(transferPosition) &&
      offerPosition < transferPosition && isStrictTimestamp(offer.at) &&
      Date.parse(offer.at) <= Date.parse(event.at);
  });
  return { available: true, events: accepted };
}

/**
 * Project a shared Guild Hall research loop from retained actor events.
 * This is participation bookkeeping only: it never adjudicates a claim,
 * certifies source retrieval, awards XP, or infers distinct human participants.
 */
function projectGuildDissentCircuit(world, viewer, events, membership, sourceObservationRecords, nextSourceObservationTarget) {
  const id = viewer.role + '-guild-dissent-circuit';
  const title = 'Complete a Guild Dissent Circuit';
  const guildHall = { type: 'location', id: 'guild_hall' };
  const evidenceArchive = { type: 'location', id: 'evidence_archive' };
  const interpretationFor = guildName => [
    'Shared objective for ' + guildName + ': one linked Source Observation from each of two current guild actor identities, then a later challenge by a different current member, then the original author response.',
    'Membership is evaluated at each event position in the append-only history and its timestamp; actor IDs are not proof of distinct humans.',
    'Source retrieval and independent verification remain NOT_PERFORMED; model assertions remain LEADS_ONLY. Completion records participation only; it does not establish truth, consensus, evidence certification, approval, mastery or authority, and grants no XP.',
    'Rejected, unanswered and contradictory events remain in history. Leaving or disbanding changes the current-roster projection but never deletes retained events.'
  ].join(' ');

  if (!membership?.available) {
    return trailMilestone(
      id, title, 4, [], [], null,
      'Guild history is ambiguous or invalid; shared progress is withheld until the roster can be reconstructed.',
      interpretationFor('the current guild')
    );
  }
  if (!membership.event) {
    return trailMilestone(
      id, title, 4, [], [], guildHall, null,
      interpretationFor('a guild you have not joined yet') + ' Join or found a guild at Guild Hall to begin.'
    );
  }

  const guild = membership.projection?.guilds?.find(candidate =>
    candidate.id === membership.event.guildId
  );
  if (!guild || !Array.isArray(guild.members)) {
    return trailMilestone(
      id, title, 4, [], [], null,
      'The current guild roster is unavailable or ambiguous; no shared progress is projected.',
      interpretationFor('the unresolved guild')
    );
  }

  const actorKey = actor => actor && typeof actor.id === 'string' &&
    ['founder', 'witness'].includes(actor.role)
    ? JSON.stringify([actor.id, actor.role]) : null;
  const membersByActor = new Map();
  for (const member of guild.members) {
    const key = actorKey(member);
    if (key && isStrictTimestamp(member.joinedAt)) membersByActor.set(key, member);
  }
  if (!membersByActor.has(actorKey(viewer))) {
    return trailMilestone(
      id, title, 4, [], [], null,
      'The current actor is not present in the projected guild roster; no shared progress is awarded.',
      interpretationFor(guild.name || 'the current guild')
    );
  }

  const validIds = uniqueEventIds(events);
  const eventById = new Map();
  const eventPositionById = new Map();
  trailRows(events).forEach((event, index) => {
    if (!validIds.has(event?.id)) return;
    eventById.set(event.id, event);
    eventPositionById.set(event.id, index);
  });

  // Append-only position is the causal order. A regressing or backdated
  // timestamp must not make work recorded before membership count for the guild.
  const memberJoinPositionByActor = new Map();
  for (const [eventId, event] of eventById) {
    if (!['guild-created', 'guild-joined'].includes(event?.type) || event.guildId !== guild.id) continue;
    const key = actorKey(event.actor);
    const member = membersByActor.get(key);
    if (member && event.at === member.joinedAt) {
      memberJoinPositionByActor.set(key, eventPositionById.get(eventId));
    }
  }

  const observations = trailRows(sourceObservationRecords)
    .filter(record => {
      if (record?.projectionStatus !== 'linked' || !safeResearchId(record.id) ||
          !eventById.has(record.id) || eventById.get(record.id)?.type !== 'source-observation-recorded') return false;
      const key = actorKey(record.actor);
      const member = membersByActor.get(key);
      const joinPosition = memberJoinPositionByActor.get(key);
      const position = eventPositionById.get(record.id);
      return Boolean(member && Number.isInteger(joinPosition) &&
        isStrictTimestamp(record.at) &&
        Date.parse(record.at) >= Date.parse(member.joinedAt) &&
        Number.isInteger(position) && position > joinPosition);
    })
    .sort((left, right) =>
      eventPositionById.get(left.id) - eventPositionById.get(right.id)
    );

  // One observation per actor identity; repeated notes from one member cannot
  // stand in for the second guild member's contribution.
  const selectedObservations = [];
  const selectedActors = new Set();
  for (const record of observations) {
    const key = actorKey(record.actor);
    if (!key || selectedActors.has(key)) continue;
    selectedActors.add(key);
    selectedObservations.push(record);
    if (selectedObservations.length === 2) break;
  }

  const evidenceEvents = selectedObservations
    .map(record => eventById.get(record.id))
    .filter(Boolean);
  const creationAction = record => safeResearchId(record?.creationId) &&
    Number.isSafeInteger(record?.version) && record.version > 0
    ? { type: 'creation', id: record.creationId, version: record.version }
    : evidenceArchive;
  let nextAction = membersByActor.size < 2 ? guildHall : evidenceArchive;

  if (selectedObservations.length < 2) {
    if (membersByActor.size >= 2 && nextSourceObservationTarget) {
      nextAction = creationAction(nextSourceObservationTarget);
    }
    return trailMilestone(
      id, title, 4, evidenceEvents.map(event => event.id), evidenceEvents,
      nextAction, null, interpretationFor(guild.name || 'the current guild')
    );
  }

  const latestObservationPosition = Math.max(...selectedObservations.map(record =>
    eventPositionById.get(record.id)
  ));
  const latestObservationAt = Math.max(...selectedObservations.map(record =>
    Date.parse(record.at)
  ));
  const challengeRows = selectedObservations.flatMap(record =>
    trailRows(record.challenges).map(challenge => ({ record, challenge }))
  ).filter(({ record, challenge }) => {
    const key = actorKey(challenge?.actor);
    const member = key ? membersByActor.get(key) : null;
    const joinPosition = key ? memberJoinPositionByActor.get(key) : null;
    const position = eventPositionById.get(challenge?.id);
    return Boolean(member && Number.isInteger(joinPosition) &&
      key !== actorKey(record.actor) &&
      safeResearchId(challenge.id) && eventById.has(challenge.id) &&
      Number.isInteger(position) && position > latestObservationPosition && position > joinPosition &&
      isStrictTimestamp(challenge.at) && Date.parse(challenge.at) >= Date.parse(member.joinedAt) &&
      Date.parse(challenge.at) >= latestObservationAt);
  }).map(({ record, challenge }) => {
    const challengePosition = eventPositionById.get(challenge.id);
    const response = challenge.responseStatus === 'answered' &&
      Array.isArray(challenge.responses) && challenge.responses.length === 1
      ? challenge.responses[0] : null;
    const responseKey = actorKey(response?.actor);
    const responseMember = responseKey ? membersByActor.get(responseKey) : null;
    const responseJoinPosition = responseKey ? memberJoinPositionByActor.get(responseKey) : null;
    const responsePosition = eventPositionById.get(response?.id);
    const responseEvent = response && responseKey === actorKey(record.actor) &&
      responseMember && Number.isInteger(responseJoinPosition) &&
      safeResearchId(response.id) && eventById.has(response.id) &&
      Number.isInteger(responsePosition) && responsePosition > challengePosition &&
      responsePosition > responseJoinPosition &&
      isStrictTimestamp(response.at) && Date.parse(response.at) >= Date.parse(responseMember.joinedAt)
      ? eventById.get(response.id) : null;
    return {
      record,
      challenge,
      challengeEvent: eventById.get(challenge.id),
      challengePosition,
      responseEvent
    };
  }).sort((left, right) => left.challengePosition - right.challengePosition);

  // Prefer the earliest completed challenge/response pair. If every retained
  // challenge is unanswered or ambiguous, the first one remains the next task.
  const selectedChallenge = challengeRows.find(row => row.responseEvent) || challengeRows[0] || null;
  if (!selectedChallenge) {
    nextAction = creationAction(selectedObservations[0]);
  } else {
    evidenceEvents.push(selectedChallenge.challengeEvent);
    if (selectedChallenge.responseEvent) evidenceEvents.push(selectedChallenge.responseEvent);
    else nextAction = creationAction(selectedChallenge.record);
  }

  return trailMilestone(
    id, title, 4, evidenceEvents.map(event => event.id), evidenceEvents,
    nextAction, null, interpretationFor(guild.name || 'the current guild')
  );
}

export function getQuestTrail(world, viewer) {
  const actorId = typeof viewer?.id === 'string' && viewer.id ? viewer.id : null;
  const actorRole = viewer?.role;
  if (!actorId || !['founder', 'witness'].includes(actorRole)) return Object.freeze([]);
  const events = trailRows(world?.events);
  const publications = retainedPublicationEvents(world);
  const myPublications = retainedPublicationEvents(world, actorId, actorRole);
  // Index the append-only event positions and exact retained versions once. The
  // Academy must not count a backdated publication that appears after its study
  // note, and repeated references to one version remain ambiguous.
  const eventPositionByReference = new Map(events.map((event, index) => [event, index]));
  const publicationCandidatesByVersion = new Map();
  for (const publication of publications) {
    const key = JSON.stringify([publication.creationId, publication.version]);
    if (!publicationCandidatesByVersion.has(key)) publicationCandidatesByVersion.set(key, []);
    publicationCandidatesByVersion.get(key).push({
      index: eventPositionByReference.get(publication),
      at: Date.parse(publication.at),
    });
  }
  const hasUniqueEarlierPublication = (creationId, version, at, eventPosition) => {
    if (!isStrictTimestamp(at) || !Number.isInteger(eventPosition)) return false;
    const atMs = Date.parse(at);
    const candidates = publicationCandidatesByVersion.get(JSON.stringify([creationId, version])) || [];
    let timestampMatches = 0;
    let earlierMatches = 0;
    for (const candidate of candidates) {
      if (!Number.isFinite(candidate.at) || candidate.at > atMs) continue;
      timestampMatches += 1;
      if (Number.isInteger(candidate.index) && candidate.index < eventPosition) earlierMatches += 1;
      if (timestampMatches > 1) return false;
    }
    return timestampMatches === 1 && earlierMatches === 1;
  };
  const creationById = new Map(trailRows(world?.creations)
    .filter(creation => creation && typeof creation.id === 'string')
    .map(creation => [creation.id, creation]));
  // Challenge evidence must resolve to one retained version, not whichever
  // duplicate version happens to appear first in a creation's array.
  const retainedVersionsByCreationAndVersion = new Map();
  const minimumPriorVersionByCreation = new Map();
  for (const creation of trailRows(world?.creations)) {
    if (!creation || typeof creation.id !== 'string') continue;
    const priorVersions = trailRows(creation.versions);
    for (const version of priorVersions) {
      if (!Number.isSafeInteger(version?.version) || version.version < 1) continue;
      const currentMinimum = minimumPriorVersionByCreation.get(creation.id);
      if (!Number.isInteger(currentMinimum) || version.version < currentMinimum) {
        minimumPriorVersionByCreation.set(creation.id, version.version);
      }
    }
    for (const version of [...priorVersions, creation]) {
      if (!Number.isSafeInteger(version?.version) || version.version < 1) continue;
      const key = JSON.stringify([creation.id, version.version]);
      const matches = retainedVersionsByCreationAndVersion.get(key) || [];
      matches.push(version);
      retainedVersionsByCreationAndVersion.set(key, matches);
    }
  }
  const observatoryPublications = distinctCreationEvents(myPublications.filter(event =>
    creationById.get(event.creationId)?.kind === 'observatory'
  ));
  const latestObservatoryPublication = [...myPublications].reverse().find(event =>
    creationById.get(event.creationId)?.kind === 'observatory'
  ) || null;
  const publishedObservatoryVersions = publications.filter(event =>
    creationById.get(event.creationId)?.kind === 'observatory'
  );
  const hasPublishedObservatory = publishedObservatoryVersions.length > 0;
  const nextSourceObservationTarget = publishedObservatoryVersions.at(-1) || null;
  const allSourceObservationRecords = projectSourceObservationRecords(events, world?.creations)
    .filter(record => record.projectionStatus === 'linked');
  const sourceObservationRecords = allSourceObservationRecords
    .filter(record => record.actor?.id === actorId && record.actor?.role === actorRole);
  const sourceObservationChallenges = allSourceObservationRecords.flatMap(record => record.challenges || [])
    .filter(challenge => challenge.actor?.id === actorId && challenge.actor?.role === actorRole);
  const nextSourceObservationChallengeTarget = sourceObservationChallenges.length ? null :
    allSourceObservationRecords.find(record => !sameResearchActor(record.actor, viewer) &&
      !record.challenges.some(challenge => sameResearchActor(challenge.actor, viewer))) || null;
  const sourceObservationResponses = sourceObservationRecords.flatMap(record =>
    (record.challenges || []).flatMap(challenge => challenge.responses || [])
  ).filter(response => response.actor?.id === actorId && response.actor?.role === actorRole);
  const nextSourceObservationResponseTarget = sourceObservationRecords.flatMap(record =>
    (record.challenges || []).filter(challenge => challenge.responseStatus === 'unanswered')
      .map(challenge => ({ record, challenge }))
  )[0] || null;
  const observatoryPublicationKeys = new Set(publishedObservatoryVersions.map(event =>
    JSON.stringify([event.creationId, event.version])
  ));
  const firstPlaceEvents = distinctCreationEvents(myPublications.filter(event => event.version === 1));
  const availablePlaceEvents = distinctCreationEvents(publications.filter(event => event.version === 1));
  const discoveries = matchingTrailRecords('discover', world?.discoveries, events, ['locationId'], actorId, actorRole);
  const commonsMessages = projectCommonsMessages(world, { id: actorId, role: actorRole });
  const firstCommonsMessage = commonsMessages[0] || null;
  const guildMembership = currentPlayerGuildMembership(world, viewer, events);
  const guildLeadershipHandoffs = guildLeadershipHandoffEvents(
    world, events, actorId, actorRole, eventPositionByReference
  );
  const guildDissentCircuit = projectGuildDissentCircuit(
    world, viewer, events, guildMembership, allSourceObservationRecords, nextSourceObservationTarget
  );
  const locations = new Map();
  for (const match of discoveries) {
    if (GUIDE_LOCATIONS.has(match.record.locationId) && !locations.has(match.record.locationId)) {
      locations.set(match.record.locationId, match.event);
    }
  }
  const notes = matchingTrailRecords('contribute', world?.contributions, events, ['creationId', 'version'], actorId, actorRole)
    .filter(match => referencesEarlierRetainedPublication(match, hasUniqueEarlierPublication, eventPositionByReference));
  const reports = matchingTrailRecords('report', world?.reports, events, ['creationId', 'version'], actorId, actorRole)
    .filter(match => referencesEarlierRetainedPublication(match, hasUniqueEarlierPublication, eventPositionByReference));
  const uniqueMoonshotEventIds = uniqueEventIds(events);
  const fieldForgeEvents = projectFieldForgeEvents(events, actorId, actorRole, eventPositionByReference);
  const firstFieldForgeEvent = fieldForgeEvents[0] || null;
  const fieldEquipmentEvents = projectFieldEquipmentEvents(
    events, actorId, actorRole, eventPositionByReference, fieldForgeEvents
  );
  const firstFieldEquipmentEvent = fieldEquipmentEvents[0] || null;
  const transferOfferCounts=new Map(),transferCancelCounts=new Map(),transferCounts=new Map(),transferOffersById=new Map();
  for(const event of events){
    if(event?.type==='field-item-transfer-offered'&&typeof event.offerId==='string'){
      transferOfferCounts.set(event.offerId,(transferOfferCounts.get(event.offerId)||0)+1);
      if(!transferOffersById.has(event.offerId))transferOffersById.set(event.offerId,event);
    }else if(event?.type==='field-item-transfer-cancelled'&&typeof event.offerId==='string'){
      transferCancelCounts.set(event.offerId,(transferCancelCounts.get(event.offerId)||0)+1);
    }else if(event?.type==='field-item-transferred'&&typeof event.offerId==='string'){
      transferCounts.set(event.offerId,(transferCounts.get(event.offerId)||0)+1);
    }
  }
  const fieldItemTransferEvents=events.filter(transfer=>{
    if(transfer?.type!=='field-item-transferred'||typeof transfer.id!=='string'||
      !uniqueMoonshotEventIds.has(transfer.id)||!isStrictTimestamp(transfer.at))return false;
    const offer=transferOffersById.get(transfer.offerId);
    const forge=events.find(event=>event?.type==='field-item-forged'&&event.id===offer?.itemEventId);
    const offerPosition=offer?eventPositionByReference.get(offer):-1;
    const forgePosition=forge?eventPositionByReference.get(forge):-1;
    const transferPosition=eventPositionByReference.get(transfer);
    const senderMatches=offer?.actor?.id===actorId&&offer?.actor?.role===actorRole;
    const recipientMatches=transfer.actor?.id===actorId&&transfer.actor?.role===actorRole;
    return transferOfferCounts.get(transfer.offerId)===1&&transferCounts.get(transfer.offerId)===1&&
      (transferCancelCounts.get(transfer.offerId)||0)===0&&offer&&forge&&
      Number.isInteger(forgePosition)&&Number.isInteger(offerPosition)&&Number.isInteger(transferPosition)&&
      forgePosition<offerPosition&&offerPosition<transferPosition&&isStrictTimestamp(offer.at)&&
      offer.itemId===forge.itemId&&offer.itemEventId===forge.id&&
      transfer.itemId===offer.itemId&&transfer.itemEventId===offer.itemEventId&&
      offer.recipientId===transfer.actor?.id&&offer.recipientRole===transfer.actor?.role&&
      transfer.fromActorId===offer.actor?.id&&transfer.fromActorRole===offer.actor?.role&&
      (senderMatches||recipientMatches);
  });
  const studyIdCounts = new Map();
  for (const event of events) if (event?.type === 'study' && typeof event.studyId === 'string') studyIdCounts.set(event.studyId, (studyIdCounts.get(event.studyId) || 0) + 1);
  const allStudyEvents = events.filter(event => {
    if (event?.type !== 'study' || typeof event.id !== 'string' || !uniqueMoonshotEventIds.has(event.id) ||
        typeof event.studyId !== 'string' || studyIdCounts.get(event.studyId) !== 1 ||
        typeof event.actor?.id !== 'string' || !['founder', 'witness'].includes(event.actor?.role) ||
        typeof event.creationId !== 'string' || !Number.isSafeInteger(event.version) || event.version < 1 ||
        !isStrictTimestamp(event.at) ||
        typeof event.question !== 'string' || !event.question.trim() || Array.from(event.question).length > 500 ||
        typeof event.attempt !== 'string' || !event.attempt.trim() || Array.from(event.attempt).length > 1000 ||
        typeof event.nextCheck !== 'string' || !event.nextCheck.trim() || Array.from(event.nextCheck).length > 500) return false;
    return hasUniqueEarlierPublication(event.creationId, event.version, event.at, eventPositionByReference.get(event));
  });
  const studies = allStudyEvents.filter(event => event.actor.id === actorId && event.actor.role === actorRole);
  const reviewIdCounts = new Map(), reviewedStudyCounts = new Map();
  for (const event of events) if (event?.type === 'study-reviewed') {
    if (typeof event.reviewId === 'string') reviewIdCounts.set(event.reviewId, (reviewIdCounts.get(event.reviewId) || 0) + 1);
    if (typeof event.studyId === 'string') reviewedStudyCounts.set(event.studyId, (reviewedStudyCounts.get(event.studyId) || 0) + 1);
  }
  const studyById = new Map(allStudyEvents.map(event => [event.studyId, event]));
  const allStudyReviews = events.filter(event => {
    const source = studyById.get(event?.studyId);
    const sourceIndex = source ? eventPositionByReference.get(source) ?? -1 : -1;
    const reviewIndex = eventPositionByReference.get(event) ?? -1;
    if (event?.type !== 'study-reviewed' || typeof event.id !== 'string' || !uniqueMoonshotEventIds.has(event.id) ||
        typeof event.reviewId !== 'string' || reviewIdCounts.get(event.reviewId) !== 1 ||
        typeof event.studyId !== 'string' || reviewedStudyCounts.get(event.studyId) !== 1 || !source ||
        event.actor?.id !== source.actor.id || event.actor?.role !== source.actor.role ||
        event.creationId !== source.creationId || event.version !== source.version ||
        sourceIndex < 0 || reviewIndex <= sourceIndex ||
        !isStrictTimestamp(event.at) || !isStrictTimestamp(source.at) ||
        Date.parse(source.at) >= Date.parse(event.at) ||
        typeof event.response !== 'string' || !event.response.trim() || Array.from(event.response).length > 1000 ||
        typeof event.reflection !== 'string' || !event.reflection.trim() || Array.from(event.reflection).length > 1000) return false;
    return hasUniqueEarlierPublication(event.creationId, event.version, event.at, reviewIndex);
  });
  const studyReviews = allStudyReviews.filter(event => event.actor.id === actorId && event.actor.role === actorRole);
  const hasStudyReview = studyReviews.length > 0;
  const hasStudyTarget = publications.length > 0;
  const collaboratorResponseIdCounts = new Map();
  const collaboratorRoleIds = new Set(COLLABORATOR_ROLES.map(role => role.id));
  for (const event of events) if (event?.type === 'collaborator-response-recorded' && typeof event.responseId === 'string')
    collaboratorResponseIdCounts.set(event.responseId, (collaboratorResponseIdCounts.get(event.responseId) || 0) + 1);
  const collaboratorResponses = events.filter(event => event?.type === 'collaborator-response-recorded' &&
    typeof event.id === 'string' && uniqueMoonshotEventIds.has(event.id) &&
    typeof event.responseId === 'string' && collaboratorResponseIdCounts.get(event.responseId) === 1 &&
    collaboratorRoleIds.has(event.role) &&
    ['valid-for-human-review', 'rejected'].includes(event.validationStatus) &&
    event.validator === 'ngl.collaborator-response.v1' &&
    event.actor?.id === actorId && event.actor?.role === actorRole);
  // Reuse the full-history research linker before crediting a synthesis attempt.
  // A later duplicate Moonshot ID or an unlinked report/challenge makes the
  // original packet ambiguous, even if its copied response labels look valid.
  const projectedResearchByEventId = new Map(projectResearchRecords(events, rows(world?.creations))
    .filter(record => record?._projection?.recordSafe && record._projection.eventIdUnique)
    .map(record => [record.id, record]));
  const synthesisResponses = collaboratorResponses.filter(event => {
    const sourceIds = Array.isArray(event.sourceEventIds) ? event.sourceEventIds : [];
    if (event.role !== 'synthesizer' || sourceIds.length < 2 || sourceIds.length > 7 ||
        sourceIds.some(id => typeof id !== 'string' || !id.trim()) ||
        new Set(sourceIds).size !== sourceIds.length || !isStrictTimestamp(event.at)) return false;
    const sources = sourceIds.map(id => projectedResearchByEventId.get(id));
    if (sources.some(source => !source)) return false;
    const responseIndex = eventPositionByReference.get(event) ?? -1;
    const proposalSources = sources.filter(source =>
      source.type === 'moonshot-proposed' && source._projection.proposalStatus === 'unique'
    );
    const activitySources = sources.filter(source =>
      (source.type === 'experiment-reported' && source._projection.proposalStatus === 'linked') ||
      (source.type === 'experiment-challenged' &&
        source._projection.proposalStatus === 'linked' &&
        source._projection.targetReportStatus === 'linked')
    );
    return responseIndex >= 0 && proposalSources.length === 1 && activitySources.length >= 1 &&
      sources.every(source => source.moonshotId === event.moonshotId &&
        Number.isInteger(source._projection.index) &&
        source._projection.index < responseIndex &&
        Date.parse(source.at) < Date.parse(event.at));
  });
  const hasCollaboratorResponse = collaboratorResponses.length > 0;
  const collaboratorResponsesByRole = new Map();
  for (const event of collaboratorResponses) {
    if (!collaboratorResponsesByRole.has(event.role)) collaboratorResponsesByRole.set(event.role, event);
  }
  const collaboratorRoleEvidence = [...collaboratorResponsesByRole.values()];
  const collaboratorPackets = projectCollaboratorPackets(world);
  const nextCollaboratorPacket = collaboratorPackets.find(packet =>
    packet?.available === true && !collaboratorResponsesByRole.has(packet.id)
  ) || null;
  const synthesisPacket = collaboratorPackets.find(packet => packet?.id === 'synthesizer') || null;
  const synthesisResponseForPacket = Boolean(synthesisPacket?.moonshotId &&
    synthesisResponses.some(event => event.moonshotId === synthesisPacket.moonshotId));
  const nextSynthesisPacket = synthesisPacket?.available === true &&
    Array.isArray(synthesisPacket.inputRefs) && synthesisPacket.inputRefs.length >= 2 &&
    !synthesisResponseForPacket ? synthesisPacket : null;
  const synthesisBlockedReason = synthesisResponses.length ? null
    : !synthesisPacket?.available
      ? synthesisPacket?.reason ||
        'The Synthesis Clerk requires a retained Moonshot proposal plus at least one linked experiment report or challenge; a proposal alone is not a synthesis corpus.'
      : !nextSynthesisPacket
        ? 'No bounded multi-source Synthesis Clerk packet is currently available.'
        : null;
  const moonshotProposals = events.filter(event =>
    isValidMoonshotProposal(event) && typeof event.id === 'string' &&
    uniqueMoonshotEventIds.has(event.id) && event.actor?.id === actorId && event.actor?.role === actorRole
  );
  const moonshotIdCounts = new Map();
  const reportIdCounts = new Map();
  for (const event of events) {
    if (event?.type === 'moonshot-proposed' && typeof event.moonshotId === 'string') moonshotIdCounts.set(event.moonshotId, (moonshotIdCounts.get(event.moonshotId) || 0) + 1);
    if (event?.type === 'experiment-reported' && typeof event.reportId === 'string') reportIdCounts.set(event.reportId, (reportIdCounts.get(event.reportId) || 0) + 1);
  }
  const proposalPositionById = new Map();
  trailRows(events).forEach((event, index) => {
    if (isValidMoonshotProposal(event) && moonshotIdCounts.get(event.moonshotId) === 1 &&
        uniqueMoonshotEventIds.has(event.id)) {
      proposalPositionById.set(event.moonshotId, index);
    }
  });
  const validMoonshotIds = new Set(proposalPositionById.keys());
  const hasAnyMoonshotProposal = validMoonshotIds.size >= 1;
  const allExperimentReports = events.filter(event => {
    const eventPosition = eventPositionByReference.get(event);
    const proposalPosition = proposalPositionById.get(event?.moonshotId);
    return event?.type === 'experiment-reported' && typeof event.id === 'string' &&
      uniqueMoonshotEventIds.has(event.id) && typeof event.reportId === 'string' &&
      reportIdCounts.get(event.reportId) === 1 && validMoonshotIds.has(event.moonshotId) &&
      Number.isInteger(eventPosition) && proposalPosition < eventPosition &&
      isStrictTimestamp(event.at) &&
      Date.parse(events[proposalPosition]?.at) <= Date.parse(event.at) &&
      typeof event.actor?.id === 'string' && ['founder', 'witness'].includes(event.actor?.role) &&
      typeof event.procedure === 'string' && event.procedure.trim() &&
      typeof event.observation === 'string' && event.observation.trim() &&
      ['supports', 'contradicts', 'inconclusive', 'failed'].includes(event.reportedOutcome);
  });
  const experimentReports = allExperimentReports.filter(event =>
    event.actor?.id === actorId && event.actor?.role === actorRole
  );
  // A separate objective requires a report to reference one unambiguous,
  // retained publication that existed earlier in the append-only event history.
  // This proves artifact linkage only; it does not verify the reported procedure,
  // observation, outcome, or truth of the hypothesis.
  const experimentEvidenceReports = experimentReports.filter(event => {
    if (typeof event.evidenceCreationId !== 'string' || !event.evidenceCreationId ||
        !Number.isSafeInteger(event.evidenceVersion) || event.evidenceVersion < 1) return false;
    return hasUniqueEarlierPublication(
      event.evidenceCreationId, event.evidenceVersion, event.at, eventPositionByReference.get(event)
    );
  });
  const challengeIdCounts = new Map();
  for (const event of events) {
    if (event?.type === 'experiment-challenged' && typeof event.challengeId === 'string') {
      challengeIdCounts.set(event.challengeId, (challengeIdCounts.get(event.challengeId) || 0) + 1);
    }
  }
  const reportById = new Map(allExperimentReports.map(event => [event.reportId, event]));
  const validChallengeEvidence = event => {
    const hasEvidenceId = typeof event.evidenceCreationId === 'string' && event.evidenceCreationId.length > 0;
    const hasEvidenceVersion = Number.isSafeInteger(event.evidenceVersion) && event.evidenceVersion > 0;
    if (hasEvidenceId !== hasEvidenceVersion) return false;
    if (!hasEvidenceId) return (
      (event.evidenceCreationId === undefined || event.evidenceCreationId === null) &&
      (event.evidenceVersion === undefined || event.evidenceVersion === null)
    );
    const creation = creationById.get(event.evidenceCreationId);
    const versions = retainedVersionsByCreationAndVersion.get(
      JSON.stringify([event.evidenceCreationId, event.evidenceVersion])
    ) || [];
    const version = versions.length === 1 ? versions[0] : null;
    const eventPosition = eventPositionByReference.get(event);
    return Boolean(creation && version && version.id === creation.id &&
      isStrictTimestamp(version.publishedAt) && isStrictTimestamp(event.at) &&
      Date.parse(version.publishedAt) <= Date.parse(event.at) &&
      hasUniqueEarlierPublication(event.evidenceCreationId, event.evidenceVersion, event.at, eventPosition));
  };
  const experimentChallenges = events.filter(event => {
    const report = reportById.get(event?.reportId);
    const reportPosition = report ? (eventPositionByReference.get(report) ?? -1) : -1;
    const challengePosition = eventPositionByReference.get(event) ?? -1;
    return event?.type === 'experiment-challenged' && typeof event.id === 'string' &&
      uniqueMoonshotEventIds.has(event.id) &&
      typeof event.challengeId === 'string' && challengeIdCounts.get(event.challengeId) === 1 &&
      typeof event.reportId === 'string' && Boolean(report) &&
      !sameResearchActor(report.actor, viewer) && report.moonshotId === event.moonshotId &&
      event.actor?.id === actorId && event.actor?.role === actorRole &&
      ['missing-evidence', 'methodology', 'contradiction', 'reproducibility', 'scope', 'other'].includes(event.challengeType) &&
      typeof event.challengeText === 'string' && Boolean(event.challengeText.trim()) &&
      Array.from(event.challengeText).length <= 1000 &&
      reportPosition >= 0 && challengePosition > reportPosition &&
      isStrictTimestamp(event.at) &&
      isStrictTimestamp(report.at) && Date.parse(report.at) <= Date.parse(event.at) &&
      validChallengeEvidence(event);
  });
  // A current guild narrows adversarial review to work retained by its current members.
  // The satchel is the same read-only projection shown in Guild Hall; it grants no
  // evidence status, XP, approval, ownership, or authority.
  const guildFieldSatchel = guildMembership.available && guildMembership.event
    ? projectGuildFieldSatchel(world, {
      id: actorId,
      role: actorRole,
      name: typeof viewer?.name === 'string' && viewer.name.trim() &&
        Array.from(viewer.name).length <= 80 ? viewer.name.trim() : 'Player'
    })
    : null;
  const guildFieldSatchelMatches = Boolean(
    guildMembership.event && guildFieldSatchel?.available &&
    guildFieldSatchel.guild?.id === guildMembership.event.guildId
  );
  const guildChallengeScopeActive = Boolean(guildMembership.event && guildFieldSatchelMatches);
  const guildChallengeScopeBlocked = !guildMembership.available ||
    Boolean(guildMembership.event && !guildFieldSatchelMatches);
  const guildFieldItems = guildFieldSatchelMatches ? guildFieldSatchel.items : [];
  const guildReportEventIds = new Set(guildFieldItems
    .filter(item => item.kind === 'experiment-report').map(item => item.eventId));
  const guildChallengeEventIds = new Set(guildFieldItems
    .filter(item => item.kind === 'experiment-challenge').map(item => item.eventId));
  const guildExperimentReports = allExperimentReports.filter(event => guildReportEventIds.has(event.id));
  const guildExperimentReportIds = new Set(guildExperimentReports.map(event => event.reportId));
  const guildExperimentChallenges = experimentChallenges.filter(event =>
    guildChallengeEventIds.has(event.id) && guildExperimentReportIds.has(event.reportId)
  );
  const researchReports = reports.filter(match =>
    creationById.get(match.record.creationId)?.kind === 'observatory' &&
    observatoryPublicationKeys.has(JSON.stringify([match.record.creationId, match.record.version]))
  );
  const earlierVersionRepairs = myPublications.filter(event => {
    if (event.version <= 1) return false;
    const minimumPriorVersion = minimumPriorVersionByCreation.get(event.creationId);
    return Number.isInteger(minimumPriorVersion) && minimumPriorVersion < event.version;
  });

  const guideOrder = ['relay', 'river', 'overlook', 'ruins'];
  const nextGuide = guideOrder.find(id => !locations.has(id)) || null;
  const creations = trailRows(world?.creations).filter(creation =>
    creation && typeof creation.id === 'string' && creation.id.length > 0 &&
    Number.isInteger(creation.version) && creation.version >= 1
  );
  const firstCreation = creations[0] || null;
  const latestCreation = creations.at(-1) || null;
  const hasFirstPlace = firstPlaceEvents.length >= 1;
  const hasWalked = locations.size >= 1;
  const hasNote = notes.length >= 1;
  const hasSecondPlace = firstPlaceEvents.length >= 2;
  const hasPreservedVersion = earlierVersionRepairs.length >= 1;
  const hasObservatory = observatoryPublications.length >= 1;
  const hasResearchReport = researchReports.length >= 1;
  const hasMoonshotProposal = moonshotProposals.length >= 1;
  const hasExperimentReport = experimentReports.length >= 1;
  const hasExperimentEvidence = experimentEvidenceReports.length >= 1;
  const challengeCandidates = guildChallengeScopeBlocked ? []
    : guildChallengeScopeActive ? guildExperimentReports : allExperimentReports;
  const challengeEvidence = guildChallengeScopeBlocked ? []
    : guildChallengeScopeActive ? guildExperimentChallenges : experimentChallenges;
  const challengeTargetReport = challengeCandidates.slice().reverse()
    .find(event => !sameResearchActor(event.actor, viewer)) || null;
  const hasChallengeTarget = Boolean(challengeTargetReport);
  const hasExperimentChallenge = challengeEvidence.length >= 1;
  const challengeQuestTitle = guildChallengeScopeActive
    ? 'Challenge a guild member’s experiment report'
    : 'Challenge another actor’s experiment report';
  const challengeBlockedReason = guildChallengeScopeBlocked
    ? 'Guild membership or retained work history is ambiguous; inspect the Guild Hall history before counting a challenge.'
    : !hasChallengeTarget
      ? guildChallengeScopeActive
        ? 'Another current guild member must retain a valid experiment report before you can challenge it.'
        : 'Another actor must retain a valid experiment report before you can challenge it.'
      : null;
  const challengeInterpretation = guildChallengeScopeActive
    ? 'Guild-scoped challenge: the target report and challenger are current members. A challenge preserves attributed dissent; it does not establish truth, independent reproduction, adjudication, approval, XP or authority.'
    : 'A challenge preserves attributed dissent against another actor’s self-reported attempt. It does not establish truth, independent reproduction, adjudication, approval, XP or authority.';
  const hasStudy = studies.length >= 1;
  const linkedExperimentReportIds = new Set(experimentEvidenceReports.map(event => event.id));
  const unlinkedExperimentReport = [...experimentReports].reverse()
    .find(event => !linkedExperimentReportIds.has(event.id)) || null;
  // Event append order is authoritative for target selection; supplied timestamps can be backdated.
  const nextAttemptProposal = events.slice().reverse().find(event =>
    isValidMoonshotProposal(event) && validMoonshotIds.has(event.moonshotId)
  ) || null;

  if (viewer?.role === 'founder') {
    const locationEvents = [...locations.values()];
    return Object.freeze([
      trailMilestone(
        'founder-first-place', 'Publish a first place', 1,
        firstPlaceEvents.map(event => event.id), firstPlaceEvents,
        !hasFirstPlace ? { type: 'workbench', recipe: 'comic' } : null
      ),
      trailMilestone(
        'founder-walk-institution', 'Discover a guide', 1,
        locationEvents.map(event => event.id), locationEvents,
        hasFirstPlace && !hasWalked && nextGuide ? { type: 'location', id: nextGuide } : null,
        !hasFirstPlace ? 'Publish your first place before taking this step.' : null
      ),
      trailMilestone(
        'founder-field-note', 'Leave a field note', 1,
        notes.map(match => match.event.id), notes.map(match => match.event),
        hasFirstPlace && hasWalked && !hasNote && latestCreation
          ? { type: 'creation', id: latestCreation.id, version: latestCreation.version } : null,
        !hasFirstPlace ? 'Publish your first place first.' :
          !hasWalked ? 'Discover a guide before leaving a field note.' :
          !latestCreation ? 'A published place is required before a field note can be attached.' : null
      ),
      trailMilestone(
        'founder-second-place', 'Publish a second place', 2,
        firstPlaceEvents.map(event => event.id), firstPlaceEvents,
        hasFirstPlace && hasWalked && hasNote && !hasSecondPlace
          ? { type: 'workbench', recipe: 'custom' } : null,
        !hasFirstPlace ? 'Publish your first place first.' :
          !hasWalked ? 'Discover a guide first.' :
          !hasNote ? 'Leave a field note on a retained version first.' : null
      ),
      trailMilestone(
        'founder-preserve-version', 'Preserve an earlier version', 1,
        earlierVersionRepairs.map(event => event.id), earlierVersionRepairs,
        hasFirstPlace && hasWalked && hasNote && hasSecondPlace && !hasPreservedVersion && firstCreation
          ? { type: 'creation', id: firstCreation.id, version: firstCreation.version } : null,
        !hasFirstPlace ? 'Publish your first place first.' :
          !hasWalked ? 'Discover a guide first.' :
          !hasNote ? 'Leave a field note first.' :
          !hasSecondPlace ? 'Publish a second place first.' :
          !firstCreation ? 'A published place is required before a version can be preserved.' : null
      ),
      trailMilestone(
        'founder-source-observatory', 'Publish a source observatory', 1,
        observatoryPublications.map(event => event.id), observatoryPublications,
        !hasObservatory ? { type: 'workbench', recipe: 'observatory' } : null
      ),
      trailMilestone(
        'founder-source-observation', 'Record a falsifiable source observation', 1,
        sourceObservationRecords.map(event => event.id), sourceObservationRecords,
        nextSourceObservationTarget && !sourceObservationRecords.length ? { type: 'creation', id: nextSourceObservationTarget.creationId, version: nextSourceObservationTarget.version } : null,
        !hasPublishedObservatory ? 'Publish a Source Observatory first; observations are recorded against one exact retained version.' : null,
        'This is an actor-attributed research note against one exact retained version. Source retrieval, independent verification and execution remain NOT_PERFORMED; the note is not a truth verdict.'
      ),
      trailMilestone(
        'founder-source-observation-challenge', 'Challenge another actor’s source observation', 1,
        sourceObservationChallenges.map(event => event.id), sourceObservationChallenges,
        nextSourceObservationChallengeTarget ? { type: 'creation', id: nextSourceObservationChallengeTarget.creationId, version: nextSourceObservationChallengeTarget.version } : null,
        !nextSourceObservationChallengeTarget && !sourceObservationChallenges.length ? 'Another actor must first retain a linked Source Observation that you have not challenged.' : null,
        'A challenge preserves attributed dissent; it does not decide truth, certify evidence, or alter the original note.'
      ),
      trailMilestone(
        'founder-source-observation-response', 'Respond to a challenge against your observation', 1,
        sourceObservationResponses.map(event => event.id), sourceObservationResponses,
        nextSourceObservationResponseTarget ? { type: 'creation', id: nextSourceObservationResponseTarget.record.creationId, version: nextSourceObservationResponseTarget.record.version } : null,
        !nextSourceObservationResponseTarget && !sourceObservationResponses.length ? 'Another actor must challenge one of your linked observations before you can respond.' : null,
        'The original author’s reply is retained beside the challenge. It is not independent evidence, adjudication, a truth verdict, or approval.'
      ),
      trailMilestone(
        'founder-research-report', 'Record a version-bound research report', 1,
        researchReports.map(match => match.event.id), researchReports.map(match => match.event),
        hasObservatory && !hasResearchReport && latestObservatoryPublication
          ? { type: 'creation', id: latestObservatoryPublication.creationId, version: latestObservatoryPublication.version } : null,
        !hasObservatory ? 'Publish a source observatory first; an empty brief is not research evidence.' :
          !latestObservatoryPublication ? 'A retained observatory publication is required before reporting.' : null
      ),
      trailMilestone(
        'founder-moonshot-proposal', 'Propose a falsifiable moonshot', 1,
        moonshotProposals.map(event => event.id), moonshotProposals,
        !hasMoonshotProposal ? { type: 'location', id: 'moonshot_field' } : null
      ),
      trailMilestone(
        'founder-experiment-report', 'Record an experiment attempt', 1,
        experimentReports.map(event => event.id), experimentReports,
        hasAnyMoonshotProposal && !hasExperimentReport
          ? (researchObjectAction(nextAttemptProposal) || { type: 'location', id: 'moonshot_field' }) : null,
        !hasAnyMoonshotProposal ? 'Propose a falsifiable moonshot first.' : null
      ),
      trailMilestone(
        'founder-experiment-evidence', 'Link a retained artifact to an experiment attempt', 1,
        experimentEvidenceReports.map(event => event.id), experimentEvidenceReports,
        hasExperimentReport && !hasExperimentEvidence
          ? (researchActivityAction(unlinkedExperimentReport, unlinkedExperimentReport?.reportId) ||
            { type: 'location', id: 'moonshot_field' }) : null,
        !hasAnyMoonshotProposal ? 'Propose a falsifiable moonshot first.' :
          !hasExperimentReport ? 'Record an experiment attempt first; then attach the exact retained artifact version.' : null,
        'Linkage only: this records a report-to-version reference. It does not verify the procedure, observation, outcome, or hypothesis.'
      ),
      trailMilestone(
        'founder-challenge-experiment-report', challengeQuestTitle, 1,
        challengeEvidence.map(event => event.id), challengeEvidence,
        hasChallengeTarget && !hasExperimentChallenge
          ? (researchActivityAction(challengeTargetReport, challengeTargetReport?.reportId) ||
            { type: 'location', id: 'moonshot_field' }) : null,
        challengeBlockedReason,
        challengeInterpretation
      ),
      trailMilestone('founder-academy-study-note', 'Record a source-bound study note', 1,
        studies.map(event => event.id), studies,
        !hasStudy && hasStudyTarget ? { type: 'location', id: 'academy' } : null,
        !hasStudyTarget ? 'Publish a real artifact before the Academy can attach study practice to a retained version.' : null
      ),
      trailMilestone('founder-academy-study-review', 'Review a prior study note’s next check', 1,
        studyReviews.map(event => event.id), studyReviews,
        !hasStudyReview && hasStudy ? { type: 'location', id: 'academy' } : null,
        !hasStudy ? 'Record a source-bound study note before reviewing its next check.' : null
      ),
      trailMilestone('founder-guild-response', 'Preserve a bounded collaborator response', 1,
        collaboratorResponses.map(event => event.id), collaboratorResponses,
        hasAnyMoonshotProposal && !hasCollaboratorResponse && nextCollaboratorPacket
          ? { type: 'location', id: 'guild-npc-' + nextCollaboratorPacket.id } : null,
        !hasAnyMoonshotProposal ? 'Propose a falsifiable Moonshot first; Guild Hall needs a retained research question.' :
          !hasCollaboratorResponse && !nextCollaboratorPacket
            ? 'No bounded collaborator packet is currently available. Preserve a qualifying research input, then return to Guild Hall.' : null,
        'Preservation only: the exact packet and external text are retained with attribution. Structural/scope validation is not truth, evidence, execution, approval, mastery or authority.'
      ),
      trailMilestone('founder-guild-council-coverage', 'Preserve one response from each Guild Hall role', COLLABORATOR_ROLES.length,
        collaboratorRoleEvidence.map(event => event.id), collaboratorRoleEvidence,
        hasAnyMoonshotProposal && nextCollaboratorPacket
          ? { type: 'location', id: 'guild-npc-' + nextCollaboratorPacket.id } : null,
        !hasAnyMoonshotProposal ? 'Propose a falsifiable Moonshot first; the Guild Hall roles need a retained research question.' :
          !nextCollaboratorPacket && collaboratorRoleEvidence.length < COLLABORATOR_ROLES.length
            ? 'No remaining role has a currently available source-bound packet. Preserve a qualifying research input, then return.' : null,
        'Coverage only: one archived response per role. Rejected responses count as preserved attempts, not endorsements. No provider provenance, truth, independent observation, execution, approval, mastery, XP or authority is established.'
      ),
      trailMilestone(
        'founder-multi-source-synthesis', 'Preserve a multi-source Synthesis Clerk attempt', 1,
        synthesisResponses.map(event => event.id), synthesisResponses,
        nextSynthesisPacket ? { type: 'location', id: 'guild-npc-synthesizer' } : null,
        synthesisBlockedReason,
        'The packet must cite one retained Moonshot proposal and at least one linked experiment report or challenge. Rejected responses remain preserved attempts, not endorsements. This does not establish correctness, consensus, truth, independent evidence, execution, mastery, approval, XP or authority.'
      ),
      trailMilestone(
        'founder-forge-field-item', 'Forge a field item from your own retained activity', 1,
        firstFieldForgeEvent ? [firstFieldForgeEvent.id] : [],
        firstFieldForgeEvent ? [firstFieldForgeEvent] : [],
        firstFieldForgeEvent ? null : { type: 'location', id: 'forge' },
        null,
        'The Forge binds one earlier event from this character to a compatible equipment slot. It records game activity only; it does not establish truth, mastery, independent evidence, XP, approval or authority.'
      ),
      trailMilestone(
        'founder-equip-field-item', 'Equip one of your own field items', 1,
        firstFieldEquipmentEvent ? [firstFieldEquipmentEvent.id] : [],
        firstFieldEquipmentEvent ? [firstFieldEquipmentEvent] : [],
        firstFieldEquipmentEvent ? null : { type: 'location', id: 'forge' },
        null,
        'The equipment event must reference one earlier item forged by this character in its matching slot. Completion records a reversible loadout action even if the item is later unequipped; it grants no XP, combat statistics, truth, mastery, approval or authority.'
      ),
      trailMilestone(
        'founder-complete-field-item-transfer', 'Complete a player-to-player field-item transfer', 1,
        fieldItemTransferEvents.map(event => event.id), fieldItemTransferEvents,
        fieldItemTransferEvents.length ? null : { type: 'location', id: 'forge' },
        null,
        'A retained offer followed by its designated recipient’s accepted transfer completes this objective for the sender and recipient. Actor IDs are pseudonymous sessions, not proof of distinct humans or legal title; the transfer grants no XP, combat statistics, truth, evidence, approval or authority.'
      ),
      trailMilestone(
        'founder-player-guild-membership', 'Join a player guild or found one', 1,
        guildMembership.event ? [guildMembership.event.id] : [],
        guildMembership.event ? [guildMembership.event] : [],
        guildMembership.available && !guildMembership.event
          ? { type: 'location', id: 'guild_hall' } : null,
        !guildMembership.available
          ? 'The retained guild history is ambiguous or invalid; inspect it before treating membership as active.' : null,
        'This objective reflects current actor/session membership, not proof of distinct humans, institutional authority, verified work, item ownership or approval. Private-mode guilds stay on this device; use Shared World to meet other players. Leaving or disbanding returns it to OPEN; membership grants no XP.'
      ),
      trailMilestone(
        actorRole + '-guild-leadership-handoff',
        'Accept an in-game guild leadership handoff', 1,
        guildLeadershipHandoffs.events.map(event => event.id),
        guildLeadershipHandoffs.events,
        guildLeadershipHandoffs.available ? { type: 'location', id: 'guild_hall' } : null,
        !guildLeadershipHandoffs.available
          ? 'The retained guild leadership history is ambiguous or invalid; inspect it before treating a handoff as completed.' : null,
        'A designated current member accepted a retained offer from the current guild leader. This records an in-game stewardship transition only; actor IDs are pseudonymous sessions, not proof of distinct humans, and the handoff grants no NGL institutional authority, XP, evidence, approval or external control.'
      ),
      guildDissentCircuit,
      trailMilestone(
        'founder-commons-message', 'Leave a message in The Commons', 1,
        firstCommonsMessage ? [firstCommonsMessage.id] : [],
        firstCommonsMessage ? [firstCommonsMessage] : [],
        firstCommonsMessage ? null : { type: 'location', id: 'town-square' },
        null,
        'A retained post records conversation only; it is not evidence, truth, approval, authority or XP. Human moderation can hide public text without erasing the original event. Private-mode posts remain on this device.'
      ),
    ]);
  }

  const mapComplete = locations.size >= 4;
  const workAvailable = availablePlaceEvents.length >= 1;
  return Object.freeze([
    trailMilestone(
      'witness-map-grounds', 'Map the four guide locations', 4,
      [...locations.values()].map(event => event.id), [...locations.values()],
      !mapComplete && nextGuide ? { type: 'location', id: nextGuide } : null
    ),
    trailMilestone(
      'witness-work-available', 'Published work exists to inspect', 1,
      availablePlaceEvents.map(event => event.id), availablePlaceEvents,
      null,
      !workAvailable ? 'Waiting for the Founder to publish a real place; Witnesses cannot draft or publish shared work.' : null
    ),
    trailMilestone(
      'witness-field-note', 'Leave an attributed field note', 1,
      notes.map(match => match.event.id), notes.map(match => match.event),
      mapComplete && workAvailable && !hasNote && latestCreation
        ? { type: 'creation', id: latestCreation.id, version: latestCreation.version } : null,
      !mapComplete ? 'Discover all four guide locations first.' :
        !workAvailable ? 'Wait for a Founder to publish a real place.' :
        !latestCreation ? 'No retained published place is available to open.' : null
    ),
    trailMilestone(
      'witness-version-report', 'Submit a version-bound report', 1,
      reports.map(match => match.event.id), reports.map(match => match.event),
      mapComplete && workAvailable && hasNote && !reports.length && latestCreation
        ? { type: 'creation', id: latestCreation.id, version: latestCreation.version } : null,
      !mapComplete ? 'Discover all four guide locations first.' :
        !workAvailable ? 'Wait for a Founder to publish a real place.' :
        !hasNote ? 'Leave an attributed field note before submitting a report.' :
        !latestCreation ? 'No retained published place is available to open.' : null
    ),
    trailMilestone(
      'witness-moonshot-proposal', 'Propose a falsifiable moonshot', 1,
      moonshotProposals.map(event => event.id), moonshotProposals,
      !hasMoonshotProposal ? { type: 'location', id: 'moonshot_field' } : null
    ),
    trailMilestone(
      'witness-experiment-report', 'Record an experiment attempt', 1,
      experimentReports.map(event => event.id), experimentReports,
      hasAnyMoonshotProposal && !hasExperimentReport
          ? (researchObjectAction(nextAttemptProposal) || { type: 'location', id: 'moonshot_field' }) : null,
      !hasAnyMoonshotProposal ? 'Propose a falsifiable moonshot first.' : null
    ),
    trailMilestone(
      'witness-experiment-evidence', 'Link a retained artifact to an experiment attempt', 1,
      experimentEvidenceReports.map(event => event.id), experimentEvidenceReports,
      hasExperimentReport && !hasExperimentEvidence
          ? (researchActivityAction(unlinkedExperimentReport, unlinkedExperimentReport?.reportId) ||
            { type: 'location', id: 'moonshot_field' }) : null,
      !hasAnyMoonshotProposal ? 'Propose a falsifiable moonshot first.' :
        !hasExperimentReport ? 'Record an experiment attempt first; then attach the exact retained artifact version.' : null,
        'Linkage only: this records a report-to-version reference. It does not verify the procedure, observation, outcome, or hypothesis.'
    ),
    trailMilestone(
      'witness-challenge-experiment-report', challengeQuestTitle, 1,
      challengeEvidence.map(event => event.id), challengeEvidence,
      hasChallengeTarget && !hasExperimentChallenge
          ? (researchActivityAction(challengeTargetReport, challengeTargetReport?.reportId) ||
            { type: 'location', id: 'moonshot_field' }) : null,
      challengeBlockedReason,
      challengeInterpretation
    ),
    trailMilestone('witness-academy-study-note', 'Record a source-bound study note', 1,
      studies.map(event => event.id), studies,
      !hasStudy && hasStudyTarget ? { type: 'location', id: 'academy' } : null,
      !hasStudyTarget ? 'Wait for a Founder to publish a real artifact before studying a retained version.' : null
    ),
    trailMilestone('witness-academy-study-review', 'Review a prior study note’s next check', 1,
      studyReviews.map(event => event.id), studyReviews,
      !hasStudyReview && hasStudy ? { type: 'location', id: 'academy' } : null,
      !hasStudy ? 'Record a source-bound study note before reviewing its next check.' : null
    ),
    trailMilestone('witness-source-observation', 'Record a falsifiable source observation', 1,
      sourceObservationRecords.map(event => event.id), sourceObservationRecords,
      nextSourceObservationTarget && !sourceObservationRecords.length ? { type: 'creation', id: nextSourceObservationTarget.creationId, version: nextSourceObservationTarget.version } : null,
      !hasPublishedObservatory ? 'Wait for a retained Source Observatory publication before recording an observation.' : null,
      'This is an actor-attributed research note against one exact retained version. Source retrieval, independent verification and execution remain NOT_PERFORMED; the note is not a truth verdict.'
    ),
    trailMilestone(
      'witness-source-observation-challenge', 'Challenge another actor’s source observation', 1,
      sourceObservationChallenges.map(event => event.id), sourceObservationChallenges,
      nextSourceObservationChallengeTarget ? { type: 'creation', id: nextSourceObservationChallengeTarget.creationId, version: nextSourceObservationChallengeTarget.version } : null,
      !nextSourceObservationChallengeTarget && !sourceObservationChallenges.length ? 'Another actor must first retain a linked Source Observation that you have not challenged.' : null,
      'A challenge preserves attributed dissent; it does not decide truth, certify evidence, or alter the original note.'
    ),
    trailMilestone(
      'witness-source-observation-response', 'Respond to a challenge against your observation', 1,
      sourceObservationResponses.map(event => event.id), sourceObservationResponses,
      nextSourceObservationResponseTarget ? { type: 'creation', id: nextSourceObservationResponseTarget.record.creationId, version: nextSourceObservationResponseTarget.record.version } : null,
      !nextSourceObservationResponseTarget && !sourceObservationResponses.length ? 'Another actor must challenge one of your linked observations before you can respond.' : null,
      'The original author’s reply is retained beside the challenge. It is not independent evidence, adjudication, a truth verdict, or approval.'
    ),
    trailMilestone('witness-guild-response', 'Preserve a bounded collaborator response', 1,
      collaboratorResponses.map(event => event.id), collaboratorResponses,
      hasAnyMoonshotProposal && !hasCollaboratorResponse && nextCollaboratorPacket
        ? { type: 'location', id: 'guild-npc-' + nextCollaboratorPacket.id } : null,
      !hasAnyMoonshotProposal ? 'Wait for a retained Moonshot proposal before preparing a bounded Guild Hall packet.' :
        !hasCollaboratorResponse && !nextCollaboratorPacket
          ? 'No bounded collaborator packet is currently available. Wait for a qualifying research input, then return to Guild Hall.' : null,
      'Preservation only: the exact packet and external text are retained with attribution. Structural/scope validation is not truth, evidence, execution, approval, mastery or authority.'
    ),
    trailMilestone('witness-guild-council-coverage', 'Preserve one response from each Guild Hall role', COLLABORATOR_ROLES.length,
      collaboratorRoleEvidence.map(event => event.id), collaboratorRoleEvidence,
      hasAnyMoonshotProposal && nextCollaboratorPacket
        ? { type: 'location', id: 'guild-npc-' + nextCollaboratorPacket.id } : null,
      !hasAnyMoonshotProposal ? 'Wait for a retained Moonshot proposal before preparing the Guild Hall role hand-offs.' :
        !nextCollaboratorPacket && collaboratorRoleEvidence.length < COLLABORATOR_ROLES.length
          ? 'No remaining role has a currently available source-bound packet. Wait for a qualifying research input, then return.' : null,
      'Coverage only: one archived response per role. Rejected responses count as preserved attempts, not endorsements. No provider provenance, truth, independent observation, execution, approval, mastery, XP or authority is established.'
    ),
    trailMilestone(
      'witness-multi-source-synthesis', 'Preserve a multi-source Synthesis Clerk attempt', 1,
      synthesisResponses.map(event => event.id), synthesisResponses,
      nextSynthesisPacket ? { type: 'location', id: 'guild-npc-synthesizer' } : null,
      synthesisBlockedReason,
      'The packet must cite one retained Moonshot proposal and at least one linked experiment report or challenge. Rejected responses remain preserved attempts, not endorsements. This does not establish correctness, consensus, truth, independent evidence, execution, mastery, approval, XP or authority.'
    ),
    trailMilestone(
      'witness-forge-field-item', 'Forge a field item from your own retained activity', 1,
      firstFieldForgeEvent ? [firstFieldForgeEvent.id] : [],
      firstFieldForgeEvent ? [firstFieldForgeEvent] : [],
      firstFieldForgeEvent ? null : { type: 'location', id: 'forge' },
      null,
      'The Forge binds one earlier event from this character to a compatible equipment slot. It records game activity only; it does not establish truth, mastery, independent evidence, XP, approval or authority.'
    ),
    trailMilestone(
      'witness-equip-field-item', 'Equip one of your own field items', 1,
      firstFieldEquipmentEvent ? [firstFieldEquipmentEvent.id] : [],
      firstFieldEquipmentEvent ? [firstFieldEquipmentEvent] : [],
      firstFieldEquipmentEvent ? null : { type: 'location', id: 'forge' },
      null,
      'The equipment event must reference one earlier item forged by this character in its matching slot. Completion records a reversible loadout action even if the item is later unequipped; it grants no XP, combat statistics, truth, mastery, approval or authority.'
    ),
    trailMilestone(
      'witness-complete-field-item-transfer', 'Complete a player-to-player field-item transfer', 1,
      fieldItemTransferEvents.map(event => event.id), fieldItemTransferEvents,
      fieldItemTransferEvents.length ? null : { type: 'location', id: 'forge' },
      null,
      'A retained offer followed by its designated recipient’s accepted transfer completes this objective for the sender and recipient. Actor IDs are pseudonymous sessions, not proof of distinct humans or legal title; the transfer grants no XP, combat statistics, truth, evidence, approval or authority.'
    ),
    trailMilestone(
      'witness-player-guild-membership', 'Join a player guild or found one', 1,
      guildMembership.event ? [guildMembership.event.id] : [],
      guildMembership.event ? [guildMembership.event] : [],
      guildMembership.available && !guildMembership.event
        ? { type: 'location', id: 'guild_hall' } : null,
      !guildMembership.available
        ? 'The retained guild history is ambiguous or invalid; inspect it before treating membership as active.' : null,
      'This objective reflects current actor/session membership, not proof of distinct humans, institutional authority, verified work, item ownership or approval. Private-mode guilds stay on this device; use Shared World to meet other players. Leaving or disbanding returns it to OPEN; membership grants no XP.'
    ),
    trailMilestone(
      actorRole + '-guild-leadership-handoff',
      'Accept an in-game guild leadership handoff', 1,
      guildLeadershipHandoffs.events.map(event => event.id),
      guildLeadershipHandoffs.events,
      guildLeadershipHandoffs.available ? { type: 'location', id: 'guild_hall' } : null,
      !guildLeadershipHandoffs.available
        ? 'The retained guild leadership history is ambiguous or invalid; inspect it before treating a handoff as completed.' : null,
      'A designated current member accepted a retained offer from the current guild leader. This records an in-game stewardship transition only; actor IDs are pseudonymous sessions, not proof of distinct humans, and the handoff grants no NGL institutional authority, XP, evidence, approval or external control.'
    ),
    guildDissentCircuit,
    trailMilestone(
      'witness-commons-message', 'Leave a message in The Commons', 1,
      firstCommonsMessage ? [firstCommonsMessage.id] : [],
      firstCommonsMessage ? [firstCommonsMessage] : [],
      firstCommonsMessage ? null : { type: 'location', id: 'town-square' },
      null,
      'A retained post records conversation only; it is not evidence, truth, approval, authority or XP. Human moderation can hide public text without erasing the original event. Private-mode posts remain on this device.'
    ),
  ]);
}
