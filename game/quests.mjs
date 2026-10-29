import { isStrictTimestamp } from './timestamps.mjs';
import { isValidMoonshotProposal } from './research-records.mjs';
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
      copy: 'Visit a guide and discover a place. Discovery records where you went; it does not make a claim true.',
      button: 'Explore the world →', action: 'places'
    };
    if (creations.length === 0 && discoveries.length < 4) return {
      id: 'witness-map', title: 'Witness Quest 2 · Map the grounds',
      copy: `You have recorded ${discoveries.length} of four guide locations. Discover another one; the map is a record of visits, not proof of a claim.`,
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
    copy: 'Your first place exists. Discover a guide, then return to inspect your creation as a player—not only as its maker.',
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
  const recordCounts = new Map(), eventCounts = new Map();
  for (const record of owned) {
    const fingerprint = key(record);
    recordCounts.set(fingerprint, (recordCounts.get(fingerprint) || 0) + 1);
  }
  for (const event of candidates) {
    const fingerprint = key(event);
    eventCounts.set(fingerprint, (eventCounts.get(fingerprint) || 0) + 1);
  }
  return owned.flatMap(record => {
    const fingerprint = key(record);
    const matches = candidates.filter(event => key(event) === fingerprint);
    return recordCounts.get(fingerprint) === 1 && eventCounts.get(fingerprint) === 1 && matches.length === 1
      ? [{ record, event: matches[0] }] : [];
  });
}

function retainedPublicationEvents(world, actorId = null, actorRole = null) {
  const events = trailRows(world?.events);
  const validIds = uniqueEventIds(events);
  const creations = trailRows(world?.creations);
  const versions = creations.flatMap(creation => [...trailRows(creation?.versions), creation]);
  return events.filter(event => {
    if (event?.type !== 'publish' || typeof event.id !== 'string' || !validIds.has(event.id) ||
        typeof event.creationId !== 'string' || !Number.isInteger(event.version) ||
        !isStrictTimestamp(event.at) || typeof event.actor?.id !== 'string' || event.actor?.role !== 'founder' ||
        ((actorId !== null && event.actor.id !== actorId) || (actorRole !== null && event.actor.role !== actorRole))) return false;
    const matches = versions.filter(version => version?.id === event.creationId &&
      version?.version === event.version && version?.publishedAt === event.at);
    return matches.length === 1;
  });
}

function referencesEarlierRetainedPublication(match, publications, events) {
  const event = match?.event;
  if (!event || typeof event.creationId !== 'string' || !Number.isSafeInteger(event.version) ||
      event.version < 1 || !isStrictTimestamp(event.at)) return false;
  const eventPosition = events.indexOf(event);
  if (eventPosition < 0) return false;
  const at = Date.parse(event.at);
  return publications.some(publication => {
    const publicationPosition = events.indexOf(publication);
    return publicationPosition >= 0 && publicationPosition < eventPosition &&
      publication.creationId === event.creationId && publication.version === event.version &&
      isStrictTimestamp(publication.at) && Date.parse(publication.at) <= at;
  });
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
  const observatoryPublications = distinctCreationEvents(myPublications.filter(event =>
    creationById.get(event.creationId)?.kind === 'observatory'
  ));
  const latestObservatoryPublication = [...myPublications].reverse().find(event =>
    creationById.get(event.creationId)?.kind === 'observatory'
  ) || null;
  const publishedObservatoryVersions = publications.filter(event =>
    creationById.get(event.creationId)?.kind === 'observatory'
  );
  const firstPlaceEvents = distinctCreationEvents(myPublications.filter(event => event.version === 1));
  const availablePlaceEvents = distinctCreationEvents(publications.filter(event => event.version === 1));
  const discoveries = matchingTrailRecords('discover', world?.discoveries, events, ['locationId'], actorId, actorRole);
  const locations = new Map();
  for (const match of discoveries) {
    if (GUIDE_LOCATIONS.has(match.record.locationId) && !locations.has(match.record.locationId)) {
      locations.set(match.record.locationId, match.event);
    }
  }
  const notes = matchingTrailRecords('contribute', world?.contributions, events, ['creationId', 'version'], actorId, actorRole)
    .filter(match => referencesEarlierRetainedPublication(match, publications, events));
  const reports = matchingTrailRecords('report', world?.reports, events, ['creationId', 'version'], actorId, actorRole)
    .filter(match => referencesEarlierRetainedPublication(match, publications, events));
  const uniqueMoonshotEventIds = uniqueEventIds(events);
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
  const allExperimentReports = events.filter(event =>
    event?.type === 'experiment-reported' && typeof event.id === 'string' &&
    uniqueMoonshotEventIds.has(event.id) && typeof event.reportId === 'string' &&
    reportIdCounts.get(event.reportId) === 1 && validMoonshotIds.has(event.moonshotId) &&
    proposalPositionById.get(event.moonshotId) < events.indexOf(event) &&
    isStrictTimestamp(event.at) &&
    Date.parse(events[proposalPositionById.get(event.moonshotId)]?.at) <= Date.parse(event.at) &&
    typeof event.actor?.id === 'string' && ['founder', 'witness'].includes(event.actor?.role) &&
    typeof event.procedure === 'string' && event.procedure.trim() &&
    typeof event.observation === 'string' && event.observation.trim() &&
    ['supports', 'contradicts', 'inconclusive', 'failed'].includes(event.reportedOutcome)
  );
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
    const reportPosition = events.indexOf(event);
    const matchingPublications = publications.filter(publication =>
      publication.creationId === event.evidenceCreationId &&
      publication.version === event.evidenceVersion &&
      events.indexOf(publication) >= 0 && events.indexOf(publication) < reportPosition &&
      Date.parse(publication.at) <= Date.parse(event.at)
    );
    return matchingPublications.length === 1;
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
    const version = creation && [creation, ...trailRows(creation.versions)]
      .find(item => item?.version === event.evidenceVersion);
    const eventPosition = eventPositionByReference.get(event);
    return Boolean(version && isStrictTimestamp(version.publishedAt) && isStrictTimestamp(event.at) &&
      Date.parse(version.publishedAt) <= Date.parse(event.at) &&
      hasUniqueEarlierPublication(event.evidenceCreationId, event.evidenceVersion, event.at, eventPosition));
  };
  const experimentChallenges = events.filter(event => {
    const report = reportById.get(event?.reportId);
    const reportPosition = report ? events.indexOf(report) : -1;
    const challengePosition = events.indexOf(event);
    return event?.type === 'experiment-challenged' && typeof event.id === 'string' &&
      uniqueMoonshotEventIds.has(event.id) &&
      typeof event.challengeId === 'string' && challengeIdCounts.get(event.challengeId) === 1 &&
      typeof event.reportId === 'string' && Boolean(report) &&
      report.actor?.id !== actorId && report.moonshotId === event.moonshotId &&
      event.actor?.id === actorId && event.actor?.role === actorRole &&
      ['missing-evidence', 'methodology', 'contradiction', 'reproducibility', 'scope', 'other'].includes(event.challengeType) &&
      typeof event.challengeText === 'string' && Boolean(event.challengeText.trim()) &&
      Array.from(event.challengeText).length <= 1000 &&
      reportPosition >= 0 && challengePosition > reportPosition &&
      isStrictTimestamp(event.at) &&
      isStrictTimestamp(report.at) && Date.parse(report.at) <= Date.parse(event.at) &&
      validChallengeEvidence(event);
  });
  const researchReports = reports.filter(match =>
    creationById.get(match.record.creationId)?.kind === 'observatory' &&
    publishedObservatoryVersions.some(event =>
      event.creationId === match.record.creationId && event.version === match.record.version
    )
  );
  const earlierVersionRepairs = myPublications.filter(event => {
    if (event.version <= 1) return false;
    const creation = trailRows(world?.creations).find(item => item?.id === event.creationId);
    return Boolean(creation && trailRows(creation.versions).some(version => Number.isInteger(version?.version) && version.version < event.version));
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
  const hasChallengeTarget = allExperimentReports.some(event => event.actor?.id !== actorId);
  const hasExperimentChallenge = experimentChallenges.length >= 1;
  const hasStudy = studies.length >= 1;
  const linkedExperimentReportIds = new Set(experimentEvidenceReports.map(event => event.id));
  const unlinkedExperimentReport = [...experimentReports].reverse()
    .find(event => !linkedExperimentReportIds.has(event.id)) || null;
  const nextAttemptProposal = events.find(event =>
    isValidMoonshotProposal(event) && validMoonshotIds.has(event.moonshotId)
  ) || null;
  const challengeTargetReport = allExperimentReports.find(event => event.actor?.id !== actorId) || null;

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
        'founder-challenge-experiment-report', 'Challenge another actor’s experiment report', 1,
        experimentChallenges.map(event => event.id), experimentChallenges,
        hasChallengeTarget && !hasExperimentChallenge
          ? (researchActivityAction(challengeTargetReport, challengeTargetReport?.reportId) ||
            { type: 'location', id: 'moonshot_field' }) : null,
        !hasChallengeTarget ? 'Another actor must retain a valid experiment report before you can challenge it.' : null
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
      'witness-challenge-experiment-report', 'Challenge another actor’s experiment report', 1,
      experimentChallenges.map(event => event.id), experimentChallenges,
      hasChallengeTarget && !hasExperimentChallenge
          ? (researchActivityAction(challengeTargetReport, challengeTargetReport?.reportId) ||
            { type: 'location', id: 'moonshot_field' }) : null,
      !hasChallengeTarget ? 'Another actor must retain a valid experiment report before you can challenge it.' : null
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
  ]);
}
