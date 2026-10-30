import { isStrictTimestamp } from './timestamps.mjs';
import { isValidMoonshotProposal } from './research-records.mjs';
import { getLocationAction, getQuestTrail } from './quests.mjs';

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
  const counts = new Map();
  for (const candidate of candidates) counts.set(candidate.key, (counts.get(candidate.key) || 0) + 1);
  return candidates.filter(candidate => counts.get(candidate.key) === 1).map(candidate => candidate.event);
}

// A publication is an XP receipt only when the exact fixed reward is present.
// Invalid reward metadata does not erase a retained artifact from the world.
function matchedPublications(world) {
  return retainedPublicationEvents(world).filter(event =>
    Number.isSafeInteger(event.reward) && event.reward === XP_PER_PUBLICATION
  );
}


function validActivityActor(actor) {
  return actor && typeof actor.id === 'string' && actor.id.length > 0 &&
    actor.id.trim() === actor.id && ['founder', 'witness'].includes(actor.role);
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
  const publications = mine(canonicalPublications, viewer);
  const earned = publications.length * XP_PER_PUBLICATION;
  const xp = Number.isSafeInteger(earned) ? earned : 0;
  const earnedWorld = canonicalPublications.length * XP_PER_PUBLICATION;
  const worldXp = Number.isSafeInteger(earnedWorld) ? earnedWorld : 0;
  const level = 1 + Math.floor(xp / LEVEL_SPAN);

  const completedQuestObjectives = getQuestTrail(world, viewer)
    .filter(item => item.complete === true && Number.isSafeInteger(item.progress) &&
      Number.isSafeInteger(item.target) && item.progress >= item.target).length;

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
      basis: 'Recorded visits to the four authored guide locations.'
    },
    {
      id: 'observer',
      label: 'Observer',
      count: matchedContributions.length,
      record: 'field notes',
      basis: 'Attributed notes attached to a published version.'
    },
    {
      id: 'scholar',
      label: 'Scholar',
      count: studyEvents.length,
      record: 'source-bound study notes',
      basis: 'Unique study notes matched to a retained published version, a question, an explanation and a next check; this counts recorded practice, not mastery.'
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
      count: matchedReports.length,
      record: 'reports',
      basis: 'Attributed, version-bound reports; a report is not automatically upheld.'
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
    inventory: Object.freeze(inventory),
    recentActivity: Object.freeze(recentActivity)
  });
}
