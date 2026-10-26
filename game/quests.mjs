const rows = value => Array.isArray(value) ? value : [];
const mine = (entries, viewer) => rows(entries).filter(entry => entry?.actor?.id === viewer?.id);

export function getQuest(world, viewer) {
  const creations = rows(world?.creations);
  const discoveries = mine(world?.discoveries, viewer);
  const notes = mine(world?.contributions, viewer);
  const reports = mine(world?.reports, viewer);
  const role = viewer?.role === 'founder' ? 'founder' : 'witness';

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
// to the exact retained artifact version.
const trailRows = value => Array.isArray(value) ? value : [];
const trailUnique = values => [...new Set(values.filter(value => typeof value === 'string' && value.length > 0))];

function matchingTrailRecords(type, records, events, fields, actorId) {
  const owned = trailRows(records).filter(record => record?.actor?.id === actorId);
  const candidates = trailRows(events).filter(event => event?.type === type && event?.actor?.id === actorId);
  const key = entry => JSON.stringify([entry?.actor?.id, entry?.at, ...fields.map(field => entry?.[field])]);
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
    const matches = candidates.filter(event => key(event) === fingerprint && typeof event.id === 'string' && event.id.length > 0);
    return recordCounts.get(fingerprint) === 1 && eventCounts.get(fingerprint) === 1 && matches.length === 1
      ? [{ record, event: matches[0] }] : [];
  });
}

function retainedPublicationEvents(world, actorId = null) {
  const creations = trailRows(world?.creations);
  const versions = creations.flatMap(creation => [...trailRows(creation?.versions), creation]);
  return trailRows(world?.events).filter(event => {
    if (event?.type !== 'publish' || typeof event.id !== 'string' || !event.id ||
        typeof event.creationId !== 'string' || !Number.isInteger(event.version) ||
        typeof event.at !== 'string' || (actorId !== null && event?.actor?.id !== actorId)) return false;
    const matches = versions.filter(version => version?.id === event.creationId &&
      version?.version === event.version && version?.publishedAt === event.at);
    return matches.length === 1;
  });
}

function distinctCreationEvidence(events) {
  const byCreation = new Map();
  for (const event of events) if (typeof event.creationId === 'string' && !byCreation.has(event.creationId)) {
    byCreation.set(event.creationId, event.id);
  }
  return [...byCreation.values()];
}

function trailMilestone(id, title, target, evidenceIds) {
  const evidence = trailUnique(evidenceIds);
  return Object.freeze({
    id, title, target, progress: Math.min(target, evidence.length),
    complete: evidence.length >= target, evidenceIds: Object.freeze(evidence),
  });
}

export function getQuestTrail(world, viewer) {
  const actorId = typeof viewer?.id === 'string' && viewer.id ? viewer.id : null;
  if (!actorId) return Object.freeze([]);
  const events = trailRows(world?.events);
  const publications = retainedPublicationEvents(world);
  const myPublications = publications.filter(event => event?.actor?.id === actorId);
  const firstPlaces = distinctCreationEvidence(myPublications.filter(event => event.version === 1));
  const availablePlaces = distinctCreationEvidence(publications.filter(event => event.version === 1));
  const discoveries = matchingTrailRecords('discover', world?.discoveries, events, ['locationId'], actorId);
  const locations = new Map();
  for (const match of discoveries) {
    if (GUIDE_LOCATIONS.has(match.record.locationId) && !locations.has(match.record.locationId)) {
      locations.set(match.record.locationId, match.event.id);
    }
  }
  const notes = matchingTrailRecords('contribute', world?.contributions, events, ['creationId', 'version'], actorId);
  const reports = matchingTrailRecords('report', world?.reports, events, ['creationId', 'version'], actorId);
  const earlierVersionRepairs = myPublications.filter(event => {
    if (event.version <= 1) return false;
    const creation = trailRows(world?.creations).find(item => item?.id === event.creationId);
    return Boolean(creation && trailRows(creation.versions).some(version => Number.isInteger(version?.version) && version.version < event.version));
  }).map(event => event.id);

  if (viewer?.role === 'founder') {
    return Object.freeze([
      trailMilestone('founder-first-place', 'Publish a first place', 1, firstPlaces),
      trailMilestone('founder-walk-institution', 'Discover a guide', 1, [...locations.values()]),
      trailMilestone('founder-field-note', 'Leave a field note', 1, notes.map(match => match.event.id)),
      trailMilestone('founder-second-place', 'Publish a second place', 2, firstPlaces),
      trailMilestone('founder-preserve-version', 'Preserve an earlier version', 1, earlierVersionRepairs),
    ]);
  }
  return Object.freeze([
    trailMilestone('witness-map-grounds', 'Map the four guide locations', 4, [...locations.values()]),
    trailMilestone('witness-work-available', 'Published work exists to inspect', 1, availablePlaces),
    trailMilestone('witness-field-note', 'Leave an attributed field note', 1, notes.map(match => match.event.id)),
    trailMilestone('witness-version-report', 'Submit a version-bound report', 1, reports.map(match => match.event.id)),
  ]);
}
