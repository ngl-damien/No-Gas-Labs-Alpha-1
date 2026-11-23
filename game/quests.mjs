import { isStrictTimestamp } from './timestamps.mjs';
import { FIELD_ITEM_DISCOVERY_LOCATIONS, FIELD_ITEM_SOURCE_TYPES, isSafeFieldItemReferenceId, projectArmorBearerChains, projectFieldItemState, projectValidFieldItemForgeEvents, projectValidFieldItemSourceEventIds } from './field-items.mjs';
export { FIELD_ITEM_SOURCE_TYPES } from './field-items.mjs';
import { readSatireIssueArtifact, indexSatireIssuePublications, findSatireIssuePublication, GITHUB_SOURCE_ARCHIVE_INTENT_PREFIX, GITHUB_SOURCE_ARCHIVE_CLIENT_REPORTED_LABEL, GITHUB_SOURCE_ARCHIVE_SERVER_RETRIEVED_LABEL, readGitHubSourceArchiveMetadata } from './artifacts.mjs';
import { isValidMoonshotProposal, projectResearchRecords, projectSourceArchivePredicateContrasts, projectSourceObservationRecords, sameResearchActor, retainedWorldEventHistoryOptions } from './research-records.mjs';
import { COMBAT_OPPONENTS, projectCombatHistory } from './combat.mjs';
import { COLLABORATOR_ROLES, projectCollaboratorPackets } from './collaborator-contracts.mjs';
import { projectCommonsMessages, projectPlayerGuilds, projectGuildFieldSatchel } from './social.mjs';
import { projectSourceArchiveFailureObjects } from './world-view.mjs';
const rows = value => Array.isArray(value) ? value : [];
const mine = (entries, viewer) => typeof viewer?.id === 'string' && viewer.id && ['founder', 'witness'].includes(viewer.role)
  ? rows(entries).filter(entry => entry?.actor?.id === viewer.id && entry.actor.role === viewer.role)
  : [];

function isServerRecheckedSourceArchiveVersion(creation, versionNumber) {
  if (!creation || typeof creation.id !== 'string' ||
      !Number.isSafeInteger(versionNumber) || versionNumber < 1) return false;
  const matches = [...rows(creation.versions), creation].filter(version => version?.version === versionNumber);
  if (matches.length !== 1 || typeof matches[0].html !== 'string' ||
      !matches[0].html.includes(GITHUB_SOURCE_ARCHIVE_SERVER_RETRIEVED_LABEL)) return false;
  try { return readGitHubSourceArchiveMetadata(matches[0].html).retrievalMode === 'SERVER_RECHECKED'; }
  catch { return false; }
}

function isRecognizedSourceArchiveVersion(creation, versionNumber) {
  if (!creation || typeof creation.id !== 'string' ||
      !Number.isSafeInteger(versionNumber) || versionNumber < 1) return false;
  const matches = [...rows(creation.versions), creation].filter(version => version?.version === versionNumber);
  if (matches.length !== 1) return false;
  const version = matches[0];
  return (version.kind ?? creation.kind) === 'custom' &&
    typeof version.intent === 'string' && version.intent.startsWith(GITHUB_SOURCE_ARCHIVE_INTENT_PREFIX) &&
    typeof version.html === 'string' && version.html.includes('data-ngl-source-archive="v1"') &&
    (version.html.includes(GITHUB_SOURCE_ARCHIVE_CLIENT_REPORTED_LABEL) ||
      version.html.includes(GITHUB_SOURCE_ARCHIVE_SERVER_RETRIEVED_LABEL)) &&
    typeof version.receipt?.digest === 'string' && /^[a-f0-9]{64}$/.test(version.receipt.digest);
}

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
    isStrictTimestamp(event.at) &&
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
 * A retained destination is not necessarily an available action. Keep the
 * objective's blocker authoritative across the HUD, map target and Quest Board.
 */
export function isQuestObjectiveActionable(item) {
  return Boolean(item && !item.complete && item.action && !item.blockedReason);
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
  // A blocked objective remains visible in the full trail, but it must not
  // strand the HUD while a later objective has its own satisfied prerequisites.
  // Prefer the first unfinished action that is not simultaneously marked blocked;
  // if none exists, keep the earliest unfinished objective and explain the blocker.
  const next = objectives.find(isQuestObjectiveActionable) ||
    objectives.find(item => item && !item.complete);
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

  const canAct = isQuestObjectiveActionable(next);
  const copy = next.blockedReason || next.interpretation ||
    `Progress ${next.progress}/${next.target}. Only retained, attributable activity advances this objective; it does not certify the underlying claim.`;
  return Object.freeze({
    id: next.id,
    title: next.title,
    copy,
    button: canAct ? 'Go do this →' : 'View quest trail →',
    action: 'trail',
    nextAction: canAct ? next.action : null
  });
}


const GUIDE_LOCATIONS = new Set(FIELD_ITEM_DISCOVERY_LOCATIONS);
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

function projectFieldForgeEvents(events, actorId, actorRole, validSourceEventIdsBySlot) {
  const validEvents = projectValidFieldItemForgeEvents(events, { validSourceEventIdsBySlot });
  if (actorId === null && actorRole === null) return validEvents;
  return validEvents.filter(event =>
    event.actor?.id === actorId && event.actor?.role === actorRole
  );
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

function projectQuestEvidenceDetail(event) {
  return Object.freeze({
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
    ...(event.type === 'experiment-reported' ? {
      reportedOutcome: ['supports', 'contradicts', 'inconclusive', 'failed'].includes(event.reportedOutcome)
        ? event.reportedOutcome : null
    } : {}),
    ...(event.type === 'experiment-challenged' ? {
      challengeId: typeof event.challengeId === 'string' ? event.challengeId : null,
      reportId: typeof event.reportId === 'string' ? event.reportId : null,
      moonshotId: typeof event.moonshotId === 'string' ? event.moonshotId : null,
      challengeType: typeof event.challengeType === 'string' ? event.challengeType : null,
      challengeText: typeof event.challengeText === 'string' ? event.challengeText : null
    } : {}),
    ...(event.type === 'experiment-challenge-responded' ? {
      responseId: typeof event.responseId === 'string' ? event.responseId : null,
      challengeId: typeof event.challengeId === 'string' ? event.challengeId : null,
      reportId: typeof event.reportId === 'string' ? event.reportId : null,
      moonshotId: typeof event.moonshotId === 'string' ? event.moonshotId : null,
      responseText: typeof event.responseText === 'string' ? event.responseText : null
    } : {}),
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
    } : {}),
    ...(event.type === 'field-item-transferred' ? {
      offerId: typeof event.offerId === 'string' ? event.offerId : null,
      itemId: typeof event.itemId === 'string' ? event.itemId : null,
      itemEventId: typeof event.itemEventId === 'string' ? event.itemEventId : null,
      fromActorId: typeof event.fromActorId === 'string' ? event.fromActorId : null,
      fromActorRole: ['founder', 'witness'].includes(event.fromActorRole) ? event.fromActorRole : null,
      recipientId: typeof event.actor?.id === 'string' ? event.actor.id : null,
      recipientRole: ['founder', 'witness'].includes(event.actor?.role) ? event.actor.role : null
    } : {})
  });
}

const questMilestoneEvidenceState = new WeakMap();

function questMilestoneEvidencePage(start, limit = 20) {
  const state = questMilestoneEvidenceState.get(this);
  const detailEvents = state?.detailEvents;
  if (!detailEvents || !Number.isSafeInteger(start) || start < 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || start >= detailEvents.length) {
    return Object.freeze([]);
  }
  const end = Math.min(detailEvents.length, start + Math.min(limit, 100));
  return Object.freeze(detailEvents.slice(start, end).map(projectQuestEvidenceDetail));
}

function questMilestoneEvidenceGetter() {
  const state = questMilestoneEvidenceState.get(this);
  if (!state) return Object.freeze([]);
  if (!state.fullEvidence) {
    state.fullEvidence = Object.freeze(state.detailEvents.map(projectQuestEvidenceDetail));
  }
  return state.fullEvidence;
}

function trailMilestone(id, title, target, evidenceIds, evidenceEvents = [], action = null, blockedReason = null, interpretation = null) {
  const evidence = trailUnique(evidenceIds);
  const allowed = new Set(evidence);
  const seen = new Set();
  const detailEvents = [];
  for (const event of trailRows(evidenceEvents)) {
    if (!allowed.has(event?.id) || seen.has(event.id)) continue;
    seen.add(event.id);
    detailEvents.push(event);
  }
  Object.freeze(detailEvents);
  const complete = evidence.length >= target;
  const nextAction = !complete && action && typeof action === 'object'
    ? Object.freeze({ ...action }) : null;
  const milestone = {
    id, title, target, progress: Math.min(target, evidence.length),
    complete,
    evidenceIds: Object.freeze(evidence),
    evidenceDetailCount: detailEvents.length,
    action: nextAction,
    blockedReason: !complete && !nextAction && typeof blockedReason === 'string' ? blockedReason : null,
    ...(typeof interpretation === 'string' ? { interpretation } : {}),
  };
  questMilestoneEvidenceState.set(milestone, { detailEvents, fullEvidence: null });
  Object.defineProperty(milestone, 'evidencePage', {
    value: questMilestoneEvidencePage,
    enumerable: false,
  });
  Object.defineProperty(milestone, 'evidence', {
    get: questMilestoneEvidenceGetter,
    enumerable: true,
  });
  return Object.freeze(milestone);
}

/**
 * Resolve one Quest Board evidence detail to its exact retained world event.
 * The index is built from the pinned snapshot once; duplicate, malformed,
 * missing, or type-mismatched identities fail closed. A link establishes only
 * event identity, never the truth or authority of the event's contents.
 */
export function createQuestEvidenceEventLinkResolver(world) {
  const events = Array.isArray(world?.events) ? world.events : null;
  if (!events) {
    return () => ({
      status: 'unavailable',
      event: null,
      reason: 'Retained world event history is unavailable.'
    });
  }

  const eventsById = new Map();
  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    const id = event.id;
    if (typeof id !== 'string' || !id || id.length > 128 || id.trim() !== id) continue;
    const matches = eventsById.get(id) || [];
    matches.push(event);
    eventsById.set(id, matches);
  }

  return evidence => {
    const id = evidence?.id;
    if (typeof id !== 'string' || !id || id.length > 128 || id.trim() !== id) {
      return {
        status: 'invalid',
        event: null,
        reason: 'The evidence identity is missing or not normalized.'
      };
    }
    const type = evidence?.type;
    if (typeof type !== 'string' || !type || type.trim() !== type) {
      return {
        status: 'invalid',
        event: null,
        reason: 'The evidence event type is missing or not normalized.'
      };
    }
    const matches = eventsById.get(id) || [];
    if (matches.length === 0) {
      return {
        status: 'unlinked',
        event: null,
        reason: 'No retained world event matches this evidence identity.'
      };
    }
    if (matches.length !== 1) {
      return {
        status: 'ambiguous',
        event: null,
        reason: 'Multiple retained world events share this evidence identity.'
      };
    }
    const event = matches[0];
    if (event.type !== type) {
      return {
        status: 'mismatched',
        event: null,
        reason: 'The retained event type does not match this evidence detail.'
      };
    }
    return { status: 'linked', event, reason: null };
  };
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
function projectGuildDissentCircuitRound(world, viewer, events, membership, sourceObservationRecords, nextSourceObservationTarget, round, afterPosition) {
  const id = viewer.role + '-guild-dissent-circuit' + (round === 1 ? '' : '-' + round);
  const title = round === 1 ? 'Complete a Guild Dissent Circuit' : 'Complete Guild Dissent Circuit · Round ' + round;
  const guildHall = { type: 'location', id: 'guild_hall' };
  const evidenceArchive = { type: 'location', id: 'evidence_archive' };
  const sourceObservatory = { type: 'location', id: 'source_observatory' };
  const interpretationFor = guildName => [
    'Shared objective for ' + guildName + ': one linked Source Observation from each of two current guild actor identities, then a later challenge by a different current member, then the original author response.',
    'Membership and Source Observatory stage order are evaluated by append position in retained history; strict timestamps are metadata, not causal order. Actor IDs are not proof of distinct humans.',
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

  // Source Observatory actions are append-ordered: a valid later-appended
  // observation counts after the actor's join event even when its wall clock regresses.
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
        Number.isInteger(position) && position > joinPosition && position > afterPosition);
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
  let nextAction = membersByActor.size < 2 ? guildHall :
    nextSourceObservationTarget ? sourceObservatory : { type: 'workbench', recipe: 'observatory' };

  if (selectedObservations.length < 2) {
    if (membersByActor.size >= 2) {
      nextAction = nextSourceObservationTarget ? sourceObservatory : { type: 'workbench', recipe: 'observatory' };
    }
    return trailMilestone(
      id, title, 4, evidenceEvents.map(event => event.id), evidenceEvents,
      nextAction, null, interpretationFor(guild.name || 'the current guild')
    );
  }

  const latestObservationPosition = Math.max(...selectedObservations.map(record =>
    eventPositionById.get(record.id)
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
      isStrictTimestamp(challenge.at));
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
      isStrictTimestamp(response.at)
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

const MAX_GUILD_DISSENT_CIRCUIT_ROUNDS = 100;

/**
 * Preserve completed rounds and expose one next actionable round. Each new
 * round begins strictly after the prior round's retained author response, so
 * observations, challenges and responses cannot be reused across rounds.
 */
function projectGuildDissentCircuits(world, viewer, events, membership, sourceObservationRecords, nextSourceObservationTarget) {
  const rounds = [];
  const validIds = uniqueEventIds(events);
  const eventPositionById = new Map();
  trailRows(events).forEach((event, index) => {
    if (validIds.has(event?.id)) eventPositionById.set(event.id, index);
  });

  let afterPosition = -1;
  for (let round = 1; round <= MAX_GUILD_DISSENT_CIRCUIT_ROUNDS; round += 1) {
    const milestone = projectGuildDissentCircuitRound(
      world, viewer, events, membership, sourceObservationRecords,
      nextSourceObservationTarget, round, afterPosition
    );
    rounds.push(milestone);
    if (!milestone.complete) break;

    const responseEventId = milestone.evidenceIds.at(-1);
    const responsePosition = eventPositionById.get(responseEventId);
    if (!Number.isInteger(responsePosition) || responsePosition <= afterPosition) break;
    afterPosition = responsePosition;
  }
  return Object.freeze(rounds);
}


export function getQuestTrail(world, viewer, options = {}) {
  const actorId = typeof viewer?.id === 'string' && viewer.id ? viewer.id : null;
  const actorRole = viewer?.role;
  if (!actorId || !['founder', 'witness'].includes(actorRole)) return Object.freeze([]);
  const events = trailRows(world?.events);
  let combatProjection = null;
  let combatHistoryBlockedReason = null;
  try { combatProjection = projectCombatHistory(events); } catch { combatHistoryBlockedReason = 'Combat history is malformed or contradictory; objective progress is withheld.'; }
  const combatActorKey = JSON.stringify([actorId, actorRole]);
  const combatWins = new Set(combatProjection?.winsByActor?.[combatActorKey] || []);
  const validEventIds = uniqueEventIds(events);
  const firstVictoryEvents = new Map();
  for (const record of combatProjection?.victoryRecords || []) {
    if (record.firstWin !== true || record.actor?.id !== actorId || record.actor?.role !== actorRole) continue;
    const matching = events.filter(event =>
      event?.id === record.eventId &&
      validEventIds.has(record.eventId) &&
      event?.type === 'combat-move-resolved' &&
      event.encounterId === record.encounterId &&
      event.at === record.at &&
      event.actor?.id === actorId &&
      event.actor?.role === actorRole
    );
    if (matching.length !== 1) {
      combatHistoryBlockedReason = 'A projected first victory has no unique matching retained move event; all Combat Yard objective progress is withheld.';
      continue;
    }
    firstVictoryEvents.set(record.opponentId, matching[0]);
  }
  const combatMilestones = COMBAT_OPPONENTS.map((opponent, index) => {
    const previous = COMBAT_OPPONENTS[index - 1] || null;
    const event = firstVictoryEvents.get(opponent.id) || null;
    const unlocked = !previous || combatWins.has(previous.id);
    const blockedReason = combatHistoryBlockedReason ||
      (!unlocked ? 'Defeat the ' + previous.name + ' first to unlock the ' + opponent.name + '.' : null);
    const id = index === 0
      ? actorRole + '-combat-yard-first-victory'
      : actorRole + '-combat-yard-' + opponent.id.slice('yard-'.length) + '-first-victory';
    const title = index === 0
      ? 'Win a deterministic Combat Yard training encounter'
      : 'Defeat the ' + opponent.name + ' in the Combat Yard';
    const action = (blockedReason || event) ? null : { type: 'location', id: 'combat_yard' };
    return trailMilestone(
      id, title, 1,
      event ? [event.id] : [],
      event ? [event] : [],
      action,
      blockedReason,
      'Progress is reconstructed from the unique actor-bound retained move that completed this opponent’s first victory. Fixed XP is game progression only; NPC dialogue, model assertions, rematches, or unretained claims cannot complete this objective or certify real-world skill.'
    );
  });
  const publications = retainedPublicationEvents(world);
  const myPublications = retainedPublicationEvents(world, actorId, actorRole);
  // Index the append-only event positions and exact retained versions once. The
  // Academy must not count a backdated publication that appears after its study
  // note, and repeated references to one version remain ambiguous.
  const eventPositionByReference = new Map(events.map((event, index) => [event, index]));
  // Source Observation records are timestamp-sorted for display. Quest routing
  // must instead follow retained append-only event order: a backdated
  // timestamp must not redirect a player to an older observation or challenge.
  const eventPositionById = new Map();
  events.forEach((event, index) => {
    if (validEventIds.has(event?.id)) eventPositionById.set(event.id, index);
  });
  const latestByAppendPosition = (entries, eventIdFor) => {
    let selected = null;
    let selectedPosition = -1;
    for (const entry of entries) {
      const position = eventPositionById.get(eventIdFor(entry));
      if (!Number.isSafeInteger(position) || position <= selectedPosition) continue;
      selected = entry;
      selectedPosition = position;
    }
    return selected;
  };
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
  // Academy practice is append-ordered: the exact publication must precede the note/review in the retained stream, regardless of wall-clock regression.
  const hasUniqueEarlierPublicationByAppendPosition = (creationId, version, eventPosition) => {
    if (!Number.isInteger(eventPosition)) return false;
    const candidates = publicationCandidatesByVersion.get(JSON.stringify([creationId, version])) || [];
    return candidates.length === 1 && Number.isFinite(candidates[0].at) &&
      Number.isInteger(candidates[0].index) && candidates[0].index < eventPosition;
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
  const sourceArchiveVersions = [];
  for (const [key, retainedVersions] of retainedVersionsByCreationAndVersion) {
    if (retainedVersions.length !== 1) continue;
    const [creationId, versionNumber] = JSON.parse(key);
    const creation = creationById.get(creationId);
    const version = retainedVersions[0];
    if (!isRecognizedSourceArchiveVersion(creation, versionNumber) ||
        !isStrictTimestamp(version.publishedAt)) continue;
    const publicationCandidates = publicationCandidatesByVersion.get(key) || [];
    if (publicationCandidates.length !== 1 ||
        publicationCandidates[0].at !== Date.parse(version.publishedAt) ||
        !hasUniqueEarlierPublication(creationId, versionNumber, version.publishedAt, events.length)) continue;
    sourceArchiveVersions.push({
      creationId, version: versionNumber,
      publicationPosition: publicationCandidates[0].index,
      serverRechecked: isServerRecheckedSourceArchiveVersion(creation, versionNumber)
    });
  }
  sourceArchiveVersions.sort((left, right) => left.publicationPosition - right.publicationPosition);
  const sourceArchiveVersionKeys = new Set(sourceArchiveVersions.map(item =>
    JSON.stringify([item.creationId, item.version])
  ));
  const serverRecheckedSourceArchiveVersionKeys = new Set(sourceArchiveVersions
    .filter(item => item.serverRechecked)
    .map(item => JSON.stringify([item.creationId, item.version])));
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
  const allSourceObservationRecords = projectSourceObservationRecords(events, world?.creations, retainedWorldEventHistoryOptions(world, events));
  const linkedSourceObservationRecords = allSourceObservationRecords
    .filter(record => record.projectionStatus === 'linked');
  const sourceObservationRecords = linkedSourceObservationRecords
    .filter(record => record.actor?.id === actorId && record.actor?.role === actorRole);
  let sourceArchiveFailureProjection = null;
  try { sourceArchiveFailureProjection = projectSourceArchiveFailureObjects(world); } catch {}
  const failureOriginObservationRecords = sourceObservationRecords.filter(record =>
    record.failureOriginStatus === 'linked' && typeof record.originFailureEventId === 'string'
  );
  const failureOriginObservationEvents = failureOriginObservationRecords
    .map(record => events.find(event => event?.id === record.id))
    .filter(Boolean);
  const sourceArchiveFailureProjectionAvailable =
    sourceArchiveFailureProjection?.available === true &&
    Number.isSafeInteger(sourceArchiveFailureProjection.total) &&
    sourceArchiveFailureProjection.total >= 0 &&
    Number.isSafeInteger(sourceArchiveFailureProjection.invalidCount) &&
    sourceArchiveFailureProjection.invalidCount >= 0 &&
    typeof sourceArchiveFailureProjection.complete === 'boolean' &&
    typeof sourceArchiveFailureProjection.captureProjectionComplete === 'boolean' &&
    Number.isSafeInteger(sourceArchiveFailureProjection.unseenEventCount) &&
    sourceArchiveFailureProjection.unseenEventCount >= 0;
  const sourceArchiveFailureProjectionHasVisibleRecords =
    sourceArchiveFailureProjectionAvailable && sourceArchiveFailureProjection.total > 0;
  const sourceArchiveFailureInvestigationVisible =
    !sourceArchiveFailureProjectionAvailable ||
    sourceArchiveFailureProjectionHasVisibleRecords ||
    sourceArchiveFailureProjection.complete !== true ||
    sourceArchiveFailureProjection.invalidCount > 0;
  const sourceArchiveFailureInvestigationBlockedReason = !sourceArchiveFailureProjectionAvailable
    ? 'Source Archive failure history is unavailable or unclassifiable; reconnect or refresh the accepted world snapshot and inspect the Evidence Archive. No failure absence or progress is inferred.'
    : !sourceArchiveFailureProjectionHasVisibleRecords
      ? [
          sourceArchiveFailureProjection.complete !== true
            ? 'The accepted world snapshot is partial (' + sourceArchiveFailureProjection.unseenEventCount + ' unseen event(s)); reconnect and refresh before treating the failure list as empty.'
            : null,
          sourceArchiveFailureProjection.invalidCount > 0
            ? 'The Source Archive failure projection withheld ' + sourceArchiveFailureProjection.invalidCount + ' invalid record(s); inspect the Evidence Archive.'
            : null,
          'No progress is credited.'
        ].filter(Boolean).join(' ')
      : null;
  const sourceArchiveFailureInvestigationScope = !sourceArchiveFailureProjectionAvailable
    ? 'The Source Archive failure-history projection is unavailable or unclassifiable.'
    : [
        sourceArchiveFailureProjection.complete !== true
          ? 'The accepted snapshot is partial; ' + sourceArchiveFailureProjection.unseenEventCount + ' event(s) are unseen.'
          : null,
        sourceArchiveFailureProjection.invalidCount > 0
          ? sourceArchiveFailureProjection.invalidCount + ' invalid failure record(s) were withheld.'
          : null
      ].filter(Boolean).join(' ');
  const sourceArchiveFailureInvestigationInterpretation =
    'Only an exact retained originFailureEventId link to one earlier service-observed Source Archive failure in the declared snapshot prefix counts. This records a provenance link only; it is not a source retry or an investigation result. Source retrieval and independent verification remain NOT_PERFORMED, model assertions remain LEADS_ONLY, execution remains NOT_EXECUTED, and no XP, truth verdict, or evidence certification is awarded.' +
    (sourceArchiveFailureInvestigationScope
      ? ' Snapshot scope: ' + sourceArchiveFailureInvestigationScope + ' Only validated, visible failure links can count.'
      : '');
  const sourceArchiveFailureInvestigationMilestones = sourceArchiveFailureInvestigationVisible
    ? [Object.freeze({
        ...trailMilestone(
          actorRole + '-source-archive-failure-investigation',
          'Link a Source Archive failure to a Source Observation',
          1,
          failureOriginObservationEvents.map(event => event.id),
          failureOriginObservationEvents,
          sourceArchiveFailureProjectionHasVisibleRecords
            ? { type: 'location', id: 'moonshot_field' } : null,
          sourceArchiveFailureInvestigationBlockedReason,
          sourceArchiveFailureInvestigationInterpretation
        ),
        countsForQuestkeeper: false
      })]
    : [];
  const sourceArchiveLaterCaptureMilestones = (() => {
    if (actorRole !== 'founder') return [];
    const failure = sourceArchiveFailureProjection?.mostRecentVisibleRetryableFailure;
    if (!failure || typeof failure.eventId !== 'string') return [];
    const failureEvent = events.find(event => event?.id === failure.eventId) || null;
    if (!failureEvent || failureEvent.type !== 'source-archive-attempt-failed') return [];
    const captureProjectionComplete = sourceArchiveFailureProjection.captureProjectionComplete === true;
    const candidateCapture = captureProjectionComplete && failure.laterCaptureStatus === 'observed'
      ? failure.laterCapture : null;
    const publicationEvent = candidateCapture
      ? events.find(event => event?.id === candidateCapture.publicationEventId) || null
      : null;
    const observed = Boolean(candidateCapture && publicationEvent &&
      publicationEvent.type === 'publish' &&
      publicationEvent.creationId === candidateCapture.creationId &&
      publicationEvent.version === candidateCapture.version &&
      publicationEvent.actor?.id === actorId &&
      publicationEvent.actor?.role === actorRole);
    const statusUnknown = !captureProjectionComplete ||
      failure.laterCaptureStatus === 'unknown' ||
      (failure.laterCaptureStatus === 'observed' && !observed);
    const captureProjectionReason = sourceArchiveFailureProjection.captureProjectionReason;
    const blockedReason = !statusUnknown ? null :
      captureProjectionReason === 'capture-match-scan-budget-exhausted'
        ? 'The bounded later-capture matching budget was exhausted; status remains UNKNOWN. No capture or absence is inferred.'
        : captureProjectionReason === 'retained-version-scan-budget-exhausted'
          ? 'The bounded retained-version scan budget was exhausted; status remains UNKNOWN. No capture or absence is inferred.'
          : captureProjectionReason === 'unsafe-retained-version-object'
          ? 'A retained Source Archive version has an unsafe object shape; later-capture status remains UNKNOWN. No capture or absence is inferred.'
          : captureProjectionReason === 'unlinked-published-artifact'
            ? 'A retained publish event is missing a unique artifact/version link; later-capture status remains UNKNOWN. No capture or absence is inferred.'
            : 'The accepted Source Archive history is partial, incomplete, or ambiguous; refresh and inspect the Evidence Archive before treating a later capture as absent. No capture is inferred.';
    const evidenceEvents = observed ? [failureEvent, publicationEvent] : [failureEvent];
    const interpretation = 'This objective links one service-observed failure to a later explicitly published server-rechecked capture of the same repository, full commit SHA, and path. The expected response body is not retained; the later capture records bytes fetched later and is not proof of source truth, claim accuracy, authorship, independent verification, approval, or authority. The two-event game objective grants no XP.';
    return [Object.freeze({
      ...trailMilestone(
        'founder-source-archive-later-capture',
        'Capture the same pinned source after a recorded failure',
        2,
        evidenceEvents.map(event => event.id),
        evidenceEvents,
        statusUnknown || observed ? null : { type: 'location', id: 'evidence_archive' },
        blockedReason,
        interpretation
      ),
      countsForQuestkeeper: false
    })];
  })();
  const unlinkedSourceObservationHistory = allSourceObservationRecords.some(record =>
    record.actor?.id === actorId && record.actor?.role === actorRole &&
    record.projectionStatus !== 'linked'
  );
  const sourceObservationChallenges = linkedSourceObservationRecords.flatMap(record => record.challenges || [])
    .filter(challenge => challenge.actor?.id === actorId && challenge.actor?.role === actorRole);
  const challengeTargetCandidates = linkedSourceObservationRecords.filter(record =>
    !sameResearchActor(record.actor, viewer) &&
    !record.challenges.some(challenge => sameResearchActor(challenge.actor, viewer))
  );
  const nextSourceObservationChallengeTarget = sourceObservationChallenges.length ? null :
    latestByAppendPosition(challengeTargetCandidates, record => record.id);
  const sourceObservationResponses = sourceObservationRecords.flatMap(record =>
    (record.challenges || [])
      .filter(challenge => challenge.responseStatus === 'answered' &&
        Array.isArray(challenge.responses) && challenge.responses.length === 1)
      .flatMap(challenge => challenge.responses)
  ).filter(response => response.actor?.id === actorId && response.actor?.role === actorRole);
  const ambiguousSourceObservationResponseHistory = sourceObservationRecords.some(record =>
    (record.challenges || []).some(challenge => challenge.responseStatus === 'ambiguous')
  );
  const responseTargetCandidates = sourceObservationRecords.flatMap(record =>
    (record.challenges || []).filter(challenge => challenge.responseStatus === 'unanswered')
      .map(challenge => ({ record, challenge }))
  );
  const nextSourceObservationResponseTarget = latestByAppendPosition(
    responseTargetCandidates, target => target.challenge.id
  );
  const sourceObservationResponseBlockedReason = !nextSourceObservationResponseTarget &&
      !sourceObservationResponses.length
    ? ambiguousSourceObservationResponseHistory
      ? 'The retained Source Observation response history is ambiguous; inspect the Source Observatory record. No response progress is credited.'
      : unlinkedSourceObservationHistory && !sourceObservationRecords.length
        ? 'Your retained Source Observation record cannot currently be linked to one valid published version; inspect the Source Observatory record. No response progress is credited.'
        : !sourceObservationRecords.length
          ? 'No linked Source Observation is available to respond to yet. Record one against a retained published version, then another actor must challenge it before you can respond.'
          : 'Another actor must challenge one of your linked observations before you can respond.'
    : null;
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
  const guildDissentCircuits = projectGuildDissentCircuits(
    world, viewer, events, guildMembership, linkedSourceObservationRecords, nextSourceObservationTarget
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
  const validFieldItemSourceEventIdsBySlot = options?.validFieldItemSourceEventIdsBySlot || projectValidFieldItemSourceEventIds(world);
  const allFieldForgeEvents = projectFieldForgeEvents(events, null, null, validFieldItemSourceEventIdsBySlot);
  const validFieldForgeEventIds = new Set(allFieldForgeEvents.map(event => event.id));
  const fieldForgeEvents = allFieldForgeEvents.filter(event =>
    event.actor?.id === actorId && event.actor?.role === actorRole
  );
  const firstFieldForgeEvent = fieldForgeEvents[0] || null;
  const fieldItemState = projectFieldItemState(events, {
    slotIds: Object.keys(FIELD_ITEM_SOURCE_TYPES),
    validForgeEventIds: validFieldForgeEventIds
  });
  const fieldEquipmentEvents = fieldItemState.equipmentEvents.filter(event =>
    event.actor?.id === actorId && event.actor?.role === actorRole
  );
  const firstFieldEquipmentEvent = fieldEquipmentEvents[0] || null;
  const validAdversarialSourceIds = validFieldItemSourceEventIdsBySlot?.adversarial instanceof Set
    ? validFieldItemSourceEventIdsBySlot.adversarial : new Set();
  // The Contradiction Ward quest is narrower than the generic Forge objective:
  // only this actor's uniquely linked, cross-actor Source Observatory challenges qualify.
  const sourceObservationChallengeEventIds = new Set(sourceObservationChallenges
    .map(challenge => challenge.id)
    .filter(id => validAdversarialSourceIds.has(id)));
  const contradictionWardForgeEvents = fieldForgeEvents.filter(event =>
    event.slotId === 'adversarial' && sourceObservationChallengeEventIds.has(event.sourceEventId)
  );
  const contradictionWardForgeEventIds = new Set(contradictionWardForgeEvents.map(event => event.id));
  const contradictionWardEquipmentEvents = fieldEquipmentEvents.filter(event =>
    event.slotId === 'adversarial' && contradictionWardForgeEventIds.has(event.sourceEventId)
  );
  const firstContradictionWardForgeEvent = contradictionWardForgeEvents[0] || null;
  const firstContradictionWardEquipmentEvent = contradictionWardEquipmentEvents[0] || null;
  const contradictionWardMilestones = Object.freeze([
    trailMilestone(
      actorRole + '-forge-contradiction-ward',
      'Forge a Contradiction Ward from retained Source Observatory dissent',
      1,
      firstContradictionWardForgeEvent ? [firstContradictionWardForgeEvent.id] : [],
      firstContradictionWardForgeEvent ? [firstContradictionWardForgeEvent] : [],
      firstContradictionWardForgeEvent ? null :
        sourceObservationChallengeEventIds.size ? { type: 'location', id: 'forge' } : null,
      sourceObservationChallengeEventIds.size ? null :
        'Retain a valid cross-actor Source Observatory challenge first; an experiment challenge or model assertion alone does not satisfy this source-specific objective.',
      'Only this actor’s uniquely linked challenge against another actor’s retained Source Observatory note can supply the Forge objective. The item preserves dissent as a game object, not a truth verdict, independent evidence, XP, mastery, approval or authority.'
    ),
    trailMilestone(
      actorRole + '-equip-contradiction-ward',
      'Equip the Contradiction Ward forged from that source challenge',
      1,
      firstContradictionWardEquipmentEvent ? [firstContradictionWardEquipmentEvent.id] : [],
      firstContradictionWardEquipmentEvent ? [firstContradictionWardEquipmentEvent] : [],
      firstContradictionWardEquipmentEvent ? null :
        firstContradictionWardForgeEvent ? { type: 'location', id: 'forge' } : null,
      !sourceObservationChallengeEventIds.size
        ? 'Retain a valid cross-actor Source Observatory challenge first.'
        : !firstContradictionWardForgeEvent
          ? 'Forge the Contradiction Ward from that retained challenge first.' : null,
      'Equipment must reference this actor’s exact retained Forge event. It is a reversible loadout projection, not evidence, XP, combat power, mastery, approval or authority.'
    )
  ].map(milestone => Object.freeze({ ...milestone, countsForQuestkeeper: false })));
  const fieldItemTransferEvents = [...fieldItemState.offers.values()]
    .filter(offer => offer.status === 'accepted' &&
      ((offer.fromActorId === actorId && offer.fromActorRole === actorRole) ||
       (offer.recipientId === actorId && offer.recipientRole === actorRole)))
    .map(offer => offer.transferEvent)
    .filter(Boolean);
  // The shared transfer objective records both participants. The separate
  // carry-forward objective belongs only to the actor who initiated an
  // accepted offer; receiving an item is not Armor Bearer activity.
  const fieldItemSupportTransferEvents = [...fieldItemState.offers.values()]
    .filter(offer => offer.status === 'accepted' &&
      offer.fromActorId === actorId && offer.fromActorRole === actorRole)
    .map(offer => offer.transferEvent)
    .filter(event => event?.type === 'field-item-transferred');
  const fieldItemSupportMilestone = Object.freeze({
    ...trailMilestone(
      actorRole + '-carry-field-item-forward',
      'Carry a field item onward to another player',
      1,
      fieldItemSupportTransferEvents.map(event => event.id),
      fieldItemSupportTransferEvents,
      fieldItemSupportTransferEvents.length ? null : { type: 'location', id: 'forge' },
      null,
      'Only the initiating actor receives this support objective after the designated recipient accepts the exact retained offer. Receiving an item is separate participation; it does not count as carrying it onward. Actor IDs are pseudonymous sessions, not proof of distinct humans. This records game support only, not XP, combat power, mastery, truth, independent evidence, approval or NGL authority.'
    ),
    countsForQuestkeeper: false
  });
  const armorBearerChains = projectArmorBearerChains(events, fieldItemState, {
    id: actorId, role: actorRole
  });
  // A current-ownership opportunity is distinct from an older accepted handoff
  // that is waiting on, or was returned by, its designated recipient.
  const armorBearerChain = armorBearerChains.find(chain =>
    !chain.complete &&
    chain.recipient === null &&
    chain.progress < 3 &&
    chain.currentOwner?.id === actorId &&
    chain.currentOwner?.role === actorRole
  ) || armorBearerChains.find(chain => !chain.complete) ||
    armorBearerChains[0] || null;
  const armorBearerCanContinue = !armorBearerChain ||
    (armorBearerChain.recipient === null &&
      armorBearerChain.currentOwner?.id === actorId &&
      armorBearerChain.currentOwner?.role === actorRole);
  const armorBearerAction = !armorBearerChain ||
    (armorBearerChain.recipient === null &&
      armorBearerChain.progress < 3 && armorBearerCanContinue)
      ? { type: 'location', id: 'forge' } : null;
  const armorBearerSecondaryLimit = 12;
  const armorBearerSecondaryChains = armorBearerChains
    .filter(chain => chain !== armorBearerChain)
    .slice()
    .sort((left, right) =>
      right.lastPosition - left.lastPosition ||
      left.itemEventId.localeCompare(right.itemEventId));
  const armorBearerOmittedCount = Math.max(
    0, armorBearerSecondaryChains.length - armorBearerSecondaryLimit
  );
  const armorBearerChainMilestones = armorBearerSecondaryChains
    .slice(0, armorBearerSecondaryLimit)
    .map(chain => {
      const lastEvidenceEvent = chain.evidenceEvents.at(-1);
      if (!isSafeFieldItemReferenceId(lastEvidenceEvent?.id)) return null;
      const chainAction = !chain.complete &&
        chain.recipient === null &&
        chain.progress < 3 &&
        chain.currentOwner?.id === actorId &&
        chain.currentOwner?.role === actorRole
          ? { type: 'location', id: 'forge' } : null;
      const recipientLabel = chain.recipient?.role === 'founder' ? 'Founder' :
        chain.recipient?.role === 'witness' ? 'Witness' : null;
      const title = chain.complete
        ? 'Completed Armor Bearer handoff · ' + chain.slotId
        : chain.recipient
          ? 'Armor Bearer handoff · ' + chain.slotId
          : 'Armor Bearer item · ' + chain.slotId;
      const interpretation = 'Separate field-item chain · item ref …' +
        String(chain.itemId).slice(-8) +
        (recipientLabel ? ' · designated recipient ' + recipientLabel + '.' : '.') +
        ' This row is a read-only projection of its own retained Forge, equipment and transfer events; it grants no XP, truth, mastery, approval or authority.';
      return Object.freeze({
        ...trailMilestone(
          actorRole + '-armor-bearer-chain-' + lastEvidenceEvent.id,
          title,
          4,
          chain.evidenceEvents.map(event => event.id),
          chain.evidenceEvents,
          chainAction,
          chain.blockedReason,
          interpretation
        ),
        countsForQuestkeeper: false
      });
    })
    .filter(Boolean);
  const armorBearerSelectedItemNote = armorBearerChain
    ? ' Selected item ref …' + String(armorBearerChain.itemId).slice(-8) + '.'
    : '';
  const armorBearerHistoryNote = armorBearerOmittedCount > 0
    ? ' The board shows ' + armorBearerSecondaryLimit +
      ' additional item chains; ' + armorBearerOmittedCount +
      ' more remain in the Chronicle.'
    : '';
  const armorBearerMilestone = Object.freeze({
    ...trailMilestone(
      actorRole + '-armor-bearer-delivery',
      'Complete a four-step Armor Bearer handoff',
      4,
      armorBearerChain?.evidenceEvents.map(event => event.id) || [],
      armorBearerChain?.evidenceEvents || [],
      armorBearerAction,
      armorBearerChain?.blockedReason || null,
      'The exact sequence is: a valid source-bound Forge event → this bearer equips the same item → the designated recipient accepts the exact transfer → that recipient equips the same item after transfer. A failed, reordered, duplicated, or mismatched event does not count. This records in-game support only; source provenance is not truth, actor IDs are pseudonymous, and no XP, combat power, mastery, approval or NGL authority is created.' + armorBearerSelectedItemNote + armorBearerHistoryNote
    ),
    countsForQuestkeeper: false
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
    return hasUniqueEarlierPublicationByAppendPosition(event.creationId, event.version, eventPositionByReference.get(event));
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
        typeof event.response !== 'string' || !event.response.trim() || Array.from(event.response).length > 1000 ||
        typeof event.reflection !== 'string' || !event.reflection.trim() || Array.from(event.reflection).length > 1000) return false;
    return hasUniqueEarlierPublicationByAppendPosition(event.creationId, event.version, reviewIndex);
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
  const projectedResearchByEventId = new Map(projectResearchRecords(events, rows(world?.creations), retainedWorldEventHistoryOptions(world, events))
    .filter(record => record?._projection?.recordSafe && record._projection.eventIdUnique)
    .map(record => [record.id, record]));
  // Quest Board and Character Sheet consume the same fail-closed R&D projection.
  // Keep one retained-order source for proposals, reports, challenges and responses.
  const projectedExperimentRecords = [...projectedResearchByEventId.values()]
    .sort((left, right) => left._projection.index - right._projection.index);
  const validMoonshotProposals = projectedExperimentRecords.filter(record =>
    record?.type === 'moonshot-proposed' && record?._projection?.proposalStatus === 'unique'
  );
  const validMoonshotIds = new Set(validMoonshotProposals.map(record => record.moonshotId));
  const hasAnyMoonshotProposal = validMoonshotIds.size >= 1;
  // Source Archives become usable research objects only through an exact,
  // earlier, uniquely retained publication. Client-reported and server-rechecked
  // retrieval labels are provenance distinctions, not truth or authorship verdicts.
  const sourceArchiveProposalRecords = [...projectedResearchByEventId.values()].filter(record =>
    record?.type === 'moonshot-proposed' &&
    record?._projection?.proposalStatus === 'unique' &&
    record?._projection?.sourceStatus === 'linked' &&
    sourceArchiveVersionKeys.has(JSON.stringify([record.sourceCreationId, record.sourceVersion]))
  );
  const sourceArchiveProposalByMoonshot = new Map(sourceArchiveProposalRecords.map(record =>
    [record.moonshotId, record]
  ));
  const mySourceArchiveProposals = sourceArchiveProposalRecords.filter(record =>
    record.actor?.id === actorId && record.actor?.role === actorRole
  );
  const sourceArchiveExperimentReports = [...projectedResearchByEventId.values()].filter(record => {
    const proposal = sourceArchiveProposalByMoonshot.get(record?.moonshotId);
    return record?.type === 'experiment-reported' &&
      record?._projection?.proposalStatus === 'linked' &&
      record?._projection?.evidenceStatus === 'linked' &&
      record?._projection?.reportIdUnique === true &&
      proposal &&
      sameResearchActor(record.actor, proposal.actor) &&
      record.evidenceCreationId === proposal.sourceCreationId &&
      record.evidenceVersion === proposal.sourceVersion;
  });
  const mySourceArchiveExperimentReports = sourceArchiveExperimentReports.filter(record =>
    sameResearchActor(record.actor, viewer)
  );
  const sourceArchiveExperimentReportIds = new Set(sourceArchiveExperimentReports.map(record => record.id));
  // Quest navigation is actor-scoped as well as progress: never route a player
  // into another actor's proposal just because it is globally the newest record.
  const latestActorSourceArchiveProposal = [...mySourceArchiveProposals]
    .sort((left, right) => left._projection.index - right._projection.index)
    .at(-1) || null;
  const sourceArchiveAction = sourceArchiveVersions.length
    ? { type: 'location', id: 'moonshot_field' }
    : actorRole === 'founder'
      ? { type: 'location', id: 'source_observatory' }
      : null;
  const sourceArchiveBlockedReason = sourceArchiveVersions.length
    ? null
    : actorRole === 'founder'
      ? 'Publish a client-reported or server-rechecked Source Archive through the Source Observatory first. A server-rechecked archive records pinned bytes retrieved by the shared service; neither mode verifies authorship, claim accuracy or source truth.'
      : 'A Founder must explicitly publish a Source Archive before a Witness can use it; private drafts are not visible in the shared world.';
  const sourceArchiveExperimentAction = latestActorSourceArchiveProposal
    ? researchObjectAction(latestActorSourceArchiveProposal)
    : sourceArchiveAction;
  const sourceArchivePredicateRecords = [...projectedResearchByEventId.values()].filter(record =>
    record?.type === 'source-archive-predicate-evaluated' &&
    record?._projection?.predicateStatus === 'linked' &&
    serverRecheckedSourceArchiveVersionKeys.has(JSON.stringify([record.creationId, record.version]))
  );
  const seenSourceArchivePredicateKeys = new Set();
  const mySourceArchivePredicateRecords = sourceArchivePredicateRecords
    .filter(record => sameResearchActor(record.actor, viewer))
    .filter(record => {
      const key = JSON.stringify([record.creationId, record.version, record.predicateKind, record.literal]);
      if (seenSourceArchivePredicateKeys.has(key)) return false;
      seenSourceArchivePredicateKeys.add(key);
      return true;
    });
  const sourceArchivePredicateContrasts = projectSourceArchivePredicateContrasts(sourceArchivePredicateRecords, viewer);
  const sourceArchivePredicateContrast = sourceArchivePredicateContrasts.find(group => group.complete) ||
    sourceArchivePredicateContrasts.find(group => group.conflictEventIds?.length > 0) ||
    sourceArchivePredicateContrasts[0] || null;
  const sourceArchivePredicateAction = serverRecheckedSourceArchiveVersionKeys.size
    ? { type: 'location', id: 'local-npc-source-analyst' }
    : actorRole === 'founder'
      ? { type: 'location', id: 'source_observatory' }
      : null;
  const sourceArchivePredicateBlockedReason = serverRecheckedSourceArchiveVersionKeys.size
    ? null
    : actorRole === 'founder'
      ? 'Publish a server-rechecked Source Archive through the shared Source Observatory first. Client-reported bytes cannot support this server-computed predicate exercise.'
      : 'A Founder must explicitly publish a server-rechecked Source Archive before a Witness can evaluate a predicate against its retained bytes.';
  const sourceArchivePredicateContrastConflicted = Boolean(
    sourceArchivePredicateContrast?.conflictEventIds?.length
  );
  const sourceArchivePredicateContrastAction = sourceArchivePredicateContrastConflicted
    ? null
    : sourceArchivePredicateAction;
  const sourceArchivePredicateContrastBlockedReason = sourceArchivePredicateContrastConflicted
    ? 'Repeated identical Source Analyst operator predicates against the same retained source version produced conflicting outcomes. The original events remain in Chronicle; this contrast is withheld pending history review.'
    : sourceArchivePredicateBlockedReason;
  const sourceArchivePredicateContrastInspection = (() => {
    const group = sourceArchivePredicateContrast;
    const evidenceEvents = rows(group?.evidenceEvents);
    const conflictEvents = rows(group?.conflictEvents);
    const visibleEvidenceEvents = evidenceEvents.slice(0, 8);
    const visibleConflictLimit = Math.max(0, 8 - visibleEvidenceEvents.length);
    const visibleConflictEvents = visibleConflictLimit > 0
      ? conflictEvents.slice(-visibleConflictLimit) : [];
    const conflictEventIds = new Set(conflictEvents.map(event => event.id));
    const visibleEvents = [...visibleEvidenceEvents, ...visibleConflictEvents]
      .filter(event => typeof event?.id === 'string')
      .sort((left, right) =>
        (left._projection?.index ?? Number.MAX_SAFE_INTEGER) -
          (right._projection?.index ?? Number.MAX_SAFE_INTEGER) ||
        left.id.localeCompare(right.id)
      );
    return Object.freeze({
      status: !group ? 'empty' : conflictEvents.length ? 'conflict' : group.complete ? 'complete' : 'partial',
      creationId: group?.creationId ?? null,
      version: group?.version ?? null,
      sourceSha256: group?.sourceSha256 ?? null,
      literal: group?.literal ?? null,
      conflictEventCount: conflictEvents.length,
      omittedConflictEventCount: Math.max(0, conflictEvents.length - visibleConflictEvents.length),
      events: Object.freeze(visibleEvents.map(event => Object.freeze({
        eventId: event.id,
        predicateId: event.predicateId,
        predicateKind: event.predicateKind,
        outcome: event.outcome,
        conflicted: conflictEventIds.has(event.id),
        counted: !conflictEventIds.has(event.id)
      })))
    });
  })();

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
        source._projection.challengeStatus === 'linked')
    );
    // Retained append order, not wall-clock order, decides whether a source preceded this response.
    // Offline and cross-device clock skew may regress timestamps without reversing event history.
    return responseIndex >= 0 && proposalSources.length === 1 && activitySources.length >= 1 &&
      sources.every(source => source.moonshotId === event.moonshotId &&
        Number.isInteger(source._projection.index) &&
        source._projection.index < responseIndex);
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
  const moonshotProposals = validMoonshotProposals.filter(record =>
    sameResearchActor(record.actor, viewer)
  );
  const allExperimentReports = projectedExperimentRecords.filter(record =>
    record?.type === 'experiment-reported' &&
    record?._projection?.proposalStatus === 'linked' &&
    record?._projection?.reportIdUnique === true
  );
  const experimentReports = allExperimentReports.filter(record =>
    sameResearchActor(record.actor, viewer)
  );
  // The defensive research projection binds the exact earlier publication by
  // retained event position and exact version receipt. This is artifact linkage,
  // not proof of the reported procedure, observation, outcome, or hypothesis.
  const experimentEvidenceReports = experimentReports.filter(record =>
    record?._projection?.evidenceStatus === 'linked'
  );
  const experimentChallenges = projectedExperimentRecords.filter(record =>
    record?.type === 'experiment-challenged' &&
    record?._projection?.proposalStatus === 'linked' &&
    record?._projection?.challengeStatus === 'linked' &&
    sameResearchActor(record.actor, viewer)
  );
  // Reuse the defensive full-history linker for author responses. A quest counts
  // only uniquely linked responses from the original report author; a retained
  // but invalid/duplicate response blocks retry rather than inviting a second reply.
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

  const sourceArchiveChallenges = projectedExperimentRecords
    .filter(record => record?.type === 'experiment-challenged' &&
      record?._projection?.recordSafe === true &&
      record?._projection?.eventIdUnique === true &&
      record?._projection?.proposalStatus === 'linked' &&
      record?._projection?.challengeStatus === 'linked' &&
      sourceArchiveExperimentReportIds.has(record?._projection?.targetReport?.id) &&
      !guildChallengeScopeBlocked &&
      (!guildChallengeScopeActive ||
        (guildChallengeEventIds.has(record.id) &&
          guildReportEventIds.has(record?._projection?.targetReport?.id))))
    .sort((left, right) => left._projection.index - right._projection.index);
  const mySourceArchiveChallenges = sourceArchiveChallenges.filter(record =>
    sameResearchActor(record.actor, viewer)
  );
  const sourceArchiveChallengesByReport = new Map();
  for (const challenge of mySourceArchiveChallenges) {
    const reportId = challenge._projection.targetReport.id;
    if (!sourceArchiveChallengesByReport.has(reportId)) {
      sourceArchiveChallengesByReport.set(reportId, challenge);
    }
  }
  const sourceArchiveChallengeEvidence = [...sourceArchiveChallengesByReport.values()];
  const sourceArchiveChallengeReportTargets = (guildChallengeScopeBlocked ? []
    : guildChallengeScopeActive
      ? sourceArchiveExperimentReports.filter(record => guildReportEventIds.has(record.id))
      : sourceArchiveExperimentReports)
    .filter(record => !sameResearchActor(record.actor, viewer))
    .sort((left, right) => left._projection.index - right._projection.index);
  const challengedSourceArchiveReportIds = new Set(sourceArchiveChallengeEvidence.map(record =>
    record._projection.targetReport.id
  ));
  const nextSourceArchiveChallengeTarget = [...sourceArchiveChallengeReportTargets].reverse()
    .find(record => !challengedSourceArchiveReportIds.has(record.id)) || null;
  const sourceArchiveChallengeBlockedReason = guildChallengeScopeBlocked
    ? 'Guild membership or retained work history is ambiguous; inspect the Guild Hall history before counting a Source Archive challenge.'
    : sourceArchiveChallengeReportTargets.length === 0
      ? guildChallengeScopeActive
        ? 'Another current guild member must retain a Source Archive proposal and a same-version experiment attempt before you can challenge it.'
        : 'Another actor must retain a Source Archive proposal and a same-version experiment attempt before you can challenge it.'
      : null;
  const sourceArchiveChallengesOnMyReports = sourceArchiveChallenges.filter(challenge =>
    sameResearchActor(challenge._projection.targetReport?.actor, viewer)
  );
  const sourceArchiveChallengeIdsOnMyReports = new Set(sourceArchiveChallengesOnMyReports.map(record =>
    record.challengeId
  ));
  const linkedExperimentChallengesOnMyReports = projectedExperimentRecords
    .filter(record => record?.type === 'experiment-challenged' &&
      record?._projection?.recordSafe === true &&
      record?._projection?.eventIdUnique === true &&
      record?._projection?.proposalStatus === 'linked' &&
      record?._projection?.challengeStatus === 'linked' &&
      sameResearchActor(record?._projection?.targetReport?.actor, viewer))
    .sort((left, right) => left._projection.index - right._projection.index);
  const responseEventCountsByChallenge = new Map();
  for (const event of events) {
    if (event?.type === 'experiment-challenge-responded' && typeof event.challengeId === 'string') {
      responseEventCountsByChallenge.set(
        event.challengeId, (responseEventCountsByChallenge.get(event.challengeId) || 0) + 1
      );
    }
  }
  const sourceArchiveChallengeResponseRecords = projectedExperimentRecords
    .filter(record => record?.type === 'experiment-challenge-responded' &&
      record?._projection?.recordSafe === true &&
      record?._projection?.eventIdUnique === true &&
      record?._projection?.proposalStatus === 'linked' &&
      record?._projection?.targetChallengeStatus === 'linked' &&
      sourceArchiveChallengeIdsOnMyReports.has(record.challengeId) &&
      sameResearchActor(record.actor, viewer))
    .sort((left, right) => left._projection.index - right._projection.index);
  const sourceArchiveAnsweredChallengeIds = new Set(sourceArchiveChallengeResponseRecords.map(record =>
    record.challengeId
  ));
  const nextSourceArchiveChallengeResponseTarget = sourceArchiveChallengesOnMyReports.find(challenge =>
    (responseEventCountsByChallenge.get(challenge.challengeId) || 0) === 0
  ) || null;
  const ambiguousSourceArchiveChallengeResponse = sourceArchiveChallengesOnMyReports.some(challenge =>
    (responseEventCountsByChallenge.get(challenge.challengeId) || 0) > 0 &&
    !sourceArchiveAnsweredChallengeIds.has(challenge.challengeId)
  );
  const sourceArchiveChallengeResponseTarget = Math.max(1, sourceArchiveChallengesOnMyReports.length);
  const sourceArchiveChallengeResponseBlockedReason = guildChallengeScopeBlocked
    ? 'Guild membership or retained work history is ambiguous; inspect the Guild Hall history before counting a Source Archive response.'
    : nextSourceArchiveChallengeResponseTarget ? null
      : ambiguousSourceArchiveChallengeResponse
        ? 'A retained response on one of your Source Archive experiment challenges is ambiguous or invalid; inspect the Evidence Archive. No response progress is credited.'
        : sourceArchiveChallengesOnMyReports.length === 0
          ? guildChallengeScopeActive
            ? 'Another current guild member must retain a valid challenge against your Source Archive experiment report before you can respond; the proposal and attempt must reference the same published archive version.'
            : 'Another actor must retain a valid challenge against your Source Archive experiment report before you can respond; the proposal and experiment attempt must reference the same published archive version.'
          : null;
  const linkedExperimentChallengeIds = new Set(
    linkedExperimentChallengesOnMyReports.map(record => record.challengeId)
  );
  const experimentChallengeResponseRecords = projectedExperimentRecords
    .filter(record => record?.type === 'experiment-challenge-responded' &&
      record?._projection?.recordSafe === true &&
      record?._projection?.eventIdUnique === true &&
      record?._projection?.proposalStatus === 'linked' &&
      record?._projection?.targetChallengeStatus === 'linked' &&
      linkedExperimentChallengeIds.has(record.challengeId) &&
      sameResearchActor(record.actor, viewer))
    .sort((left, right) => left._projection.index - right._projection.index);
  const answeredExperimentChallengeIds = new Set(
    experimentChallengeResponseRecords.map(record => record.challengeId)
  );
  const nextExperimentChallengeResponseTarget = linkedExperimentChallengesOnMyReports.find(challenge =>
    (responseEventCountsByChallenge.get(challenge.challengeId) || 0) === 0
  ) || null;
  const ambiguousExperimentChallengeResponse = linkedExperimentChallengesOnMyReports.some(challenge =>
    (responseEventCountsByChallenge.get(challenge.challengeId) || 0) > 0 &&
    !answeredExperimentChallengeIds.has(challenge.challengeId)
  );
  const experimentChallengeResponseTarget = Math.max(1, linkedExperimentChallengesOnMyReports.length);
  const experimentChallengeResponseBlockedReason = nextExperimentChallengeResponseTarget ? null
    : ambiguousExperimentChallengeResponse
      ? 'A retained response on one of your experiment challenges is ambiguous or invalid; inspect the Evidence Archive. No response progress is credited.'
      : linkedExperimentChallengesOnMyReports.length === 0
        ? 'Another actor must retain a valid challenge against one of your experiment reports before you can respond; record a valid experiment report first if you have none.'
        : null;
  const sourceArchiveQuestMilestones = () => [
    trailMilestone(
      actorRole + '-source-archive-moonshot',
      'Ground a falsifiable Moonshot in a published Source Archive',
      1,
      mySourceArchiveProposals.map(record => record.id),
      mySourceArchiveProposals,
      sourceArchiveAction,
      sourceArchiveBlockedReason,
      'Progress requires a uniquely linked Moonshot proposal referencing one earlier, uniquely retained Source Archive version. The archive may be client-reported or server-rechecked. Server retrieval records bytes received for the pinned file at that time; neither mode establishes commit authorship, primary-source status, claim accuracy, independent verification, or truth.'
    ),
    trailMilestone(
      actorRole + '-source-archive-experiment',
      'Use the same Source Archive in a retained experiment attempt',
      1,
      mySourceArchiveExperimentReports.map(record => record.id),
      mySourceArchiveExperimentReports,
      sourceArchiveExperimentAction,
      sourceArchiveBlockedReason,
      'Progress requires an actor-attributed experiment report linked to the same exact Source Archive creation and version used by one uniquely linked proposal. A failed or inconclusive self-report still records an attempt; linkage does not verify the procedure, observation, outcome, hypothesis, or source.'
    ),
    trailMilestone(
      actorRole + '-source-archive-predicate',
      'Test a bounded predicate against server-rechecked Source Archive bytes',
      1,
      mySourceArchivePredicateRecords.map(record => record.id),
      mySourceArchivePredicateRecords,
      sourceArchivePredicateAction,
      sourceArchivePredicateBlockedReason,
      'The shared server evaluates an exact, case-sensitive UTF-8 literal predicate against one published server-rechecked Source Archive version. MATCH/NO_MATCH describes only that byte test; it is not a natural-language claim verdict, source truth, authorship, independent verification, approval, authority, or XP.'
    ),
    Object.freeze({
      ...trailMilestone(
        actorRole + '-source-archive-contrast',
        'Compare both literal operators against one Source Archive version',
        2,
        sourceArchivePredicateContrast?.evidenceIds || [],
        sourceArchivePredicateContrast?.evidenceEvents || [],
        sourceArchivePredicateContrast?.complete ? null : sourceArchivePredicateContrastAction,
        sourceArchivePredicateContrastBlockedReason,
        'Progress requires this actor’s unique linked contains-literal and does-not-contain-literal predicates using the same exact literal against the same exact published server-rechecked Source Archive version. Their outcomes must be opposite (one MATCH and one NO_MATCH). These byte outcomes do not adjudicate a claim, establish source truth, authorship, independent verification, approval, authority or XP.'
      ),
      countsForQuestkeeper: false,
      contrastInspection: sourceArchivePredicateContrastInspection
    }),
    trailMilestone(
      actorRole + '-source-archive-challenge',
      guildChallengeScopeActive
        ? 'Challenge a guild member’s Source Archive experiment attempt'
        : 'Challenge another actor’s Source Archive experiment attempt',
      Math.max(1, sourceArchiveChallengeReportTargets.length),
      sourceArchiveChallengeEvidence.map(record => record.id),
      sourceArchiveChallengeEvidence,
      nextSourceArchiveChallengeTarget
        ? researchActivityAction(nextSourceArchiveChallengeTarget, nextSourceArchiveChallengeTarget.reportId)
        : null,
      sourceArchiveChallengeBlockedReason,
      guildChallengeScopeActive
        ? 'Guild-scoped challenge: the target report and challenger are current members, and the report is linked to the same exact Source Archive version as its author’s proposal. A challenge preserves attributed dissent; it does not adjudicate, verify the procedure or source, award XP, or grant authority.'
        : 'Each objective target is a uniquely linked experiment report whose author proposed a Moonshot against the same exact published Source Archive version. A challenge preserves attributed dissent; it does not adjudicate, verify the procedure or source, award XP, or grant authority.'
    ),
    trailMilestone(
      actorRole + '-source-archive-response',
      guildChallengeScopeActive
        ? 'Respond to a guild member’s challenge against your Source Archive experiment'
        : 'Respond to a challenge against your Source Archive experiment',
      sourceArchiveChallengeResponseTarget,
      sourceArchiveChallengeResponseRecords.map(record => record.id),
      sourceArchiveChallengeResponseRecords,
      nextSourceArchiveChallengeResponseTarget
        ? researchActivityAction(nextSourceArchiveChallengeResponseTarget, nextSourceArchiveChallengeResponseTarget.challengeId)
        : null,
      sourceArchiveChallengeResponseBlockedReason,
      guildChallengeScopeActive
        ? 'Guild-scoped response: only the original report author may respond to a current member’s uniquely linked challenge against an experiment tied to the same Source Archive version. The reply is attributed speech, not adjudication or independent verification; it awards no XP or authority.'
        : 'Only the original report author may respond to a uniquely linked challenge against an experiment tied to the same Source Archive version. The reply is attributed speech, not adjudication or independent verification; it awards no XP or authority.'
    )
  ];
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
  const satirePublicationIndex = indexSatireIssuePublications(world);
  const issuePublicationForEvent = event => findSatireIssuePublication(world, {
    creationId:event.creationId,version:event.version,publicationEventId:event.id
  },satirePublicationIndex);
  const satireIssuePublications = myPublications.filter(event => Boolean(issuePublicationForEvent(event)));
  const satireIssueCorrections = satireIssuePublications.filter(event => {
    const publication = issuePublicationForEvent(event);
    if (publication?.issue.schema !== 'ngl.satire-issue.v2') return false;
    const source = findSatireIssuePublication(world, publication.issue.correctionOf, satirePublicationIndex);
    return Boolean(
      source &&
      source.creation.id !== publication.creation.id &&
      source.eventIndex < eventPositionByReference.get(event)
    );
  });
  const hasSatireIssue = satireIssuePublications.length >= 1;
  const hasSatireIssueCorrection = satireIssueCorrections.length >= 1;
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
        'founder-agp-satire-issue', 'Publish an America’s Got Problems issue', 1,
        satireIssuePublications.map(event => event.id), satireIssuePublications,
        !hasSatireIssue && hasFirstPlace && hasWalked && hasNote && hasSecondPlace && hasPreservedVersion
          ? { type: 'location', id: 'publication_house' } : null,
        !hasFirstPlace ? 'Publish your first place first.' :
          !hasWalked ? 'Discover a guide first.' :
          !hasNote ? 'Leave a field note first.' :
          !hasSecondPlace ? 'Publish a second place first.' :
          !hasPreservedVersion ? 'Preserve an earlier version first.' : null,
        'Progress requires a retained publication event bound to an issue with a separate author-entered factual substrate, at least one author-entered source reference, satirical treatment, strongest counterargument, uncertainty and falsifier. Source retrieval and independent verification remain NOT_PERFORMED; model assertions remain LEADS_ONLY; this is an in-world publication, not a truth verdict or external release.'
      ),
      trailMilestone(
        'founder-agp-follow-up-correction', 'Publish a separate linked follow-up issue', 1,
        satireIssueCorrections.map(event => event.id), satireIssueCorrections,
        hasSatireIssue && !hasSatireIssueCorrection ? { type: 'location', id: 'publication_house' } : null,
        !hasSatireIssue ? 'Publish an initial America’s Got Problems issue first.' : null,
        'Progress requires a retained v2 issue published as a distinct creation from its source, whose correctionOf binds one earlier creation ID, edition version and unique publication event, plus an author-entered correction note. Repairing the source creation alone does not satisfy this follow-up objective; the prior edition remains preserved. This is not independent verification, adjudication or a truth verdict; no extra quest XP is awarded.'
      ),
      trailMilestone(
        'founder-source-observatory', 'Publish a source observatory', 1,
        observatoryPublications.map(event => event.id), observatoryPublications,
        !hasObservatory ? { type: 'workbench', recipe: 'observatory' } : null
      ),
      trailMilestone(
        'founder-source-observation', 'Record a falsifiable source observation', 1,
        sourceObservationRecords.map(event => event.id), sourceObservationRecords,
        nextSourceObservationTarget && !sourceObservationRecords.length ? { type: 'location', id: 'source_observatory' } : null,
        !hasPublishedObservatory ? 'Publish a Source Observatory first; observations are recorded against one exact retained version.' : null,
        'This is an actor-attributed research note against one exact retained version. Source retrieval, independent verification and execution remain NOT_PERFORMED; the note is not a truth verdict.'
      ),
      ...sourceArchiveFailureInvestigationMilestones,
      ...sourceArchiveLaterCaptureMilestones,
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
        sourceObservationResponseBlockedReason,
        'Only one uniquely linked author response to a retained challenge counts. An unlinked note or ambiguous response history remains review-only and cannot complete the quest. The reply is attributed speech, not independent evidence, adjudication, a truth verdict, or approval.'
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
      ...sourceArchiveQuestMilestones(),
      trailMilestone(
        'founder-challenge-experiment-report', challengeQuestTitle, 1,
        challengeEvidence.map(event => event.id), challengeEvidence,
        hasChallengeTarget && !hasExperimentChallenge
          ? (researchActivityAction(challengeTargetReport, challengeTargetReport?.reportId) ||
            { type: 'location', id: 'moonshot_field' }) : null,
        challengeBlockedReason,
        challengeInterpretation
      ),
      trailMilestone(
        'founder-experiment-challenge-response',
        'Respond to a challenge against your experiment report',
        experimentChallengeResponseTarget,
        experimentChallengeResponseRecords.map(event => event.id),
        experimentChallengeResponseRecords,
        nextExperimentChallengeResponseTarget
          ? (researchActivityAction(nextExperimentChallengeResponseTarget, nextExperimentChallengeResponseTarget.challengeId) ||
            { type: 'location', id: 'moonshot_field' }) : null,
        experimentChallengeResponseBlockedReason,
        'The original report author responds to a uniquely linked later challenge. This is attributed speech, not adjudication; it is not independent verification, reproduction, truth, or approval. It awards no XP and grants no NGL authority.'
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
      ...contradictionWardMilestones,
      trailMilestone(
        'founder-complete-field-item-transfer', 'Participate in a player-to-player field-item transfer', 1,
        fieldItemTransferEvents.map(event => event.id), fieldItemTransferEvents,
        fieldItemTransferEvents.length ? null : { type: 'location', id: 'forge' },
        null,
        'A retained offer followed by its designated recipient’s accepted transfer completes this shared participation objective for both actors. The initiating actor also receives the separate Carry Forward objective; receiving an item is not Armor Bearer activity. Actor IDs are pseudonymous sessions, not proof of distinct humans or legal title; the transfer grants no XP, combat statistics, truth, evidence, approval or authority.'
      ),
      fieldItemSupportMilestone,
      armorBearerMilestone,
      ...armorBearerChainMilestones,
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
      ...guildDissentCircuits,
      trailMilestone(
        'founder-commons-message', 'Leave a message in The Commons', 1,
        firstCommonsMessage ? [firstCommonsMessage.id] : [],
        firstCommonsMessage ? [firstCommonsMessage] : [],
        firstCommonsMessage ? null : { type: 'location', id: 'town-square' },
        null,
        'A retained post records conversation only; it is not evidence, truth, approval, authority or XP. Human moderation can hide public text without erasing the original event. Private-mode posts remain on this device.'
      ),
      ...combatMilestones,
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
    trailMilestone(
      'witness-experiment-challenge-response',
      'Respond to a challenge against your experiment report',
      experimentChallengeResponseTarget,
      experimentChallengeResponseRecords.map(event => event.id),
      experimentChallengeResponseRecords,
      nextExperimentChallengeResponseTarget
        ? (researchActivityAction(nextExperimentChallengeResponseTarget, nextExperimentChallengeResponseTarget.challengeId) ||
          { type: 'location', id: 'moonshot_field' }) : null,
      experimentChallengeResponseBlockedReason,
      'The original report author responds to a uniquely linked later challenge. This is attributed speech, not adjudication; it is not independent verification, reproduction, truth, or approval. It awards no XP and grants no NGL authority.'
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
      nextSourceObservationTarget && !sourceObservationRecords.length ? { type: 'location', id: 'source_observatory' } : null,
      !hasPublishedObservatory ? 'Wait for a retained Source Observatory publication before recording an observation.' : null,
      'This is an actor-attributed research note against one exact retained version. Source retrieval, independent verification and execution remain NOT_PERFORMED; the note is not a truth verdict.'
    ),
    ...sourceArchiveFailureInvestigationMilestones,
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
      sourceObservationResponseBlockedReason,
      'Only one uniquely linked author response to a retained challenge counts. An unlinked note or ambiguous response history remains review-only and cannot complete the quest. The reply is attributed speech, not independent evidence, adjudication, a truth verdict, or approval.'
    ),
    ...sourceArchiveQuestMilestones(),
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
    ...contradictionWardMilestones,
    trailMilestone(
      'witness-complete-field-item-transfer', 'Participate in a player-to-player field-item transfer', 1,
      fieldItemTransferEvents.map(event => event.id), fieldItemTransferEvents,
      fieldItemTransferEvents.length ? null : { type: 'location', id: 'forge' },
      null,
      'A retained offer followed by its designated recipient’s accepted transfer completes this shared participation objective for both actors. The initiating actor also receives the separate Carry Forward objective; receiving an item is not Armor Bearer activity. Actor IDs are pseudonymous sessions, not proof of distinct humans or legal title; the transfer grants no XP, combat statistics, truth, evidence, approval or authority.'
    ),
    fieldItemSupportMilestone,
    armorBearerMilestone,
    ...armorBearerChainMilestones,
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
    ...guildDissentCircuits,
    trailMilestone(
      'witness-commons-message', 'Leave a message in The Commons', 1,
      firstCommonsMessage ? [firstCommonsMessage.id] : [],
      firstCommonsMessage ? [firstCommonsMessage] : [],
      firstCommonsMessage ? null : { type: 'location', id: 'town-square' },
      null,
      'A retained post records conversation only; it is not evidence, truth, approval, authority or XP. Human moderation can hide public text without erasing the original event. Private-mode posts remain on this device.'
    ),
    ...combatMilestones,
  ]);
}
