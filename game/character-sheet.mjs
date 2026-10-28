const rows = value => Array.isArray(value) ? value : [];
const mine = (entries, viewer) => typeof viewer?.id === 'string' && viewer.id &&
  (viewer.role === 'founder' || viewer.role === 'witness')
  ? rows(entries).filter(entry => entry?.actor?.id === viewer.id && entry.actor.role === viewer.role)
  : [];

const LEVEL_SPAN = 300;
const XP_PER_PUBLICATION = 100;
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
    typeof version.publishedAt === 'string' && Number.isFinite(Date.parse(version.publishedAt)) &&
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

// A publish label alone is not a reward receipt. The event must be unique,
// Founder-attributed, match a retained version and timestamp, and carry the
// game's fixed publication reward. Duplicate claims for one version are
// ambiguous, so none of them award character XP or Maker skill.
function matchedPublications(world) {
  const events = uniqueEvents(world?.events);
  const versions = retainedVersionIndex(world);
  const candidates = [];
  for (const event of events) {
    if (event.type !== 'publish' || event.actor?.role !== 'founder' ||
        !Number.isSafeInteger(event.reward) || event.reward !== XP_PER_PUBLICATION ||
        typeof event.creationId !== 'string' || !Number.isSafeInteger(event.version) ||
        event.version < 1 || typeof event.at !== 'string') continue;
    const key = versionKey(event.creationId, event.version);
    const version = versions.get(key);
    if (!version || version.publishedAt !== event.at) continue;
    candidates.push({ event, key });
  }
  const counts = new Map();
  for (const candidate of candidates) counts.set(candidate.key, (counts.get(candidate.key) || 0) + 1);
  return candidates.filter(candidate => counts.get(candidate.key) === 1).map(candidate => candidate.event);
}

export function projectCharacter(world, viewer) {
  const allEvents = uniqueEvents(world?.events);
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
  allEvents.forEach((event, index) => {
    if (event?.type === 'moonshot-proposed' && typeof event.moonshotId === 'string' &&
        proposalCounts.get(event.moonshotId) === 1 && typeof event.at === 'string' &&
        Number.isFinite(Date.parse(event.at))) proposalPositions.set(event.moonshotId, index);
  });
  const proposalIds = new Set(proposalPositions.keys());
  const experimentReports = events.filter(event => {
    const proposalIndex = proposalPositions.get(event?.moonshotId);
    const proposal = Number.isInteger(proposalIndex) ? allEvents[proposalIndex] : null;
    return event.type === 'experiment-reported' &&
      typeof event.reportId === 'string' && reportCounts.get(event.reportId) === 1 &&
      proposalIds.has(event.moonshotId) && Number.isInteger(proposalIndex) &&
      allEvents.indexOf(event) > proposalIndex && typeof event.at === 'string' &&
      Number.isFinite(Date.parse(event.at)) && Date.parse(proposal.at) <= Date.parse(event.at) &&
      typeof event.procedure === 'string' && event.procedure.trim() &&
      typeof event.observation === 'string' && event.observation.trim() &&
      ['supports', 'contradicts', 'inconclusive', 'failed'].includes(event.reportedOutcome);
  });
  const publications = mine(matchedPublications(world), viewer);
  const earned = publications.length * XP_PER_PUBLICATION;
  const xp = Number.isSafeInteger(earned) ? earned : 0;
  const worldXp = Number.isSafeInteger(world?.xp) && world.xp >= 0 ? world.xp : 0;
  const level = 1 + Math.floor(xp / LEVEL_SPAN);

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
      count: mine(world?.discoveries, viewer).length,
      record: 'guide discoveries',
      basis: 'Recorded visits to the four authored guide locations.'
    },
    {
      id: 'observer',
      label: 'Observer',
      count: mine(world?.contributions, viewer).length,
      record: 'field notes',
      basis: 'Attributed notes attached to a published version.'
    },
    {
      id: 'challenger',
      label: 'Challenger',
      count: mine(world?.reports, viewer).length,
      record: 'reports',
      basis: 'Attributed, version-bound reports; a report is not automatically upheld.'
    },
    {
      id: 'researcher',
      label: 'Researcher',
      count: events.filter(event => event.type === 'moonshot-proposed' &&
        typeof event.moonshotId === 'string' && typeof event.hypothesis === 'string' &&
        event.hypothesis.trim() && typeof event.falsifier === 'string' && event.falsifier.trim() &&
        typeof event.evidenceNeeded === 'string' && event.evidenceNeeded.trim()).length,
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
      id: 'restorer',
      label: 'Restorer',
      count: mine(world?.methods, viewer).length,
      record: 'checked repairs',
      basis: 'Methods recorded when a checked repair is published.'
    }
  ].map(skill => Object.freeze(skill));

  const inventory = rows(world?.creations)
    .filter(creation => creation && typeof creation.id === 'string')
    .map(creation => Object.freeze({
      id: creation.id,
      title: typeof creation.title === 'string' && creation.title ? creation.title : 'Untitled place',
      kind: typeof creation.kind === 'string' ? creation.kind : 'unknown',
      version: Number.isInteger(creation.version) && creation.version > 0 ? creation.version : 1,
      receipt: creation.receipt && typeof creation.receipt.digest === 'string'
        ? Object.freeze({ digest: creation.receipt.digest, size: creation.receipt.size })
        : null
    }));

  const recentActivity = events
    .filter(event => typeof event.at === 'string' && Number.isFinite(Date.parse(event.at)))
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
    inventory: Object.freeze(inventory),
    recentActivity: Object.freeze(recentActivity)
  });
}
