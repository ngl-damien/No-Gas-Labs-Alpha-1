import { isStrictTimestamp } from './timestamps.mjs';
import { isValidMoonshotProposal } from './research-records.mjs';
import { getLocationAction, getQuestTrail, matchActivityRecords, isQuestTrailProjection } from './quests.mjs';
import { projectCollaboratorResponseWorldObjects, isCollaboratorResponseProjection } from './collaborator-world-objects.mjs';

const rows = value => Array.isArray(value) ? value : [];
const mine = (entries, viewer) => typeof viewer?.id === 'string' && viewer.id &&
  (viewer.role === 'founder' || viewer.role === 'witness')
  ? rows(entries).filter(entry => entry?.actor?.id === viewer.id && entry.actor.role === viewer.role)
  : [];

const LEVEL_SPAN = 300;
const XP_PER_PUBLICATION = 100;
const MAX_FIELD_SATCHEL_ITEMS = 100;
const FIELD_EQUIPMENT_SLOTS = Object.freeze([
  Object.freeze({
    id: 'provenance', label: 'Receipt Buckler', kinds: Object.freeze(['published-artifact']),
    description: 'A version-matched publication receipt. It identifies retained bytes, not truth.'
  }),
  Object.freeze({
    id: 'scouting', label: 'Surveyor’s Compass', kinds: Object.freeze(['guide-discovery']),
    description: 'A recorded visit to an authored guide location; visiting does not verify its claims.'
  }),
  Object.freeze({
    id: 'observation', label: 'Observer’s Lens', kinds: Object.freeze(['field-report', 'field-note']),
    description: 'An attributed note or report attached to a retained published version.'
  }),
  Object.freeze({
    id: 'learning', label: 'Polymath Codex', kinds: Object.freeze(['retrieval-review', 'study-note']),
    description: 'Recorded study or retrieval practice; it is not a correctness or mastery certificate.'
  }),
  Object.freeze({
    id: 'research', label: 'Moonshot Compass', kinds: Object.freeze(['experiment-report', 'moonshot-proposal']),
    description: 'A falsifiable proposal or retained attempt, including failure and inconclusive outcomes.'
  }),
  Object.freeze({
    id: 'adversarial', label: 'Contradiction Ward', kinds: Object.freeze(['experiment-challenge']),
    description: 'A retained challenge to another actor’s report; dissent remains unadjudicated.'
  }),
  Object.freeze({
    id: 'collaboration', label: 'Relay Sigil', kinds: Object.freeze(['guild-folio']),
    description: 'A source-bound collaborator response preserved for human review, not approval.'
  }),
  Object.freeze({
    id: 'restoration', label: 'Repair Gloves', kinds: Object.freeze(['checked-repair']),
    description: 'A repair method linked to a checked publication sequence; it is not independent validation.'
  })
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


function matchedActivityEvidence(type, records, allEvents, fields, viewer, predicate = () => true) {
  const matches = matchActivityRecords(type, records, allEvents, fields, viewer?.id, viewer?.role, predicate);
  return { matches, records: matches.map(match => match.record) };
}

export function projectCharacter(world, viewer, options = null) {
  const suppliedResponseObjects = options && typeof options === 'object'
    ? options.collaboratorResponseObjects : null;
  const collaboratorResponseObjects = isCollaboratorResponseProjection(suppliedResponseObjects, world)
    ? suppliedResponseObjects
    : projectCollaboratorResponseWorldObjects(world);
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
  const discoveryEvidence = matchedActivityEvidence(
    'discover', world?.discoveries, allEvents, ['locationId'], viewer,
    event => event.repeat !== true && getLocationAction(event.locationId, world, viewer) !== null
  );
  const matchedDiscoveries = discoveryEvidence.records;
  const contributionEvidence = matchedActivityEvidence(
    'contribute', world?.contributions, allEvents, ['creationId', 'version'], viewer,
    hasEarlierPublication
  );
  const matchedContributions = contributionEvidence.records;
  const reportEvidence = matchedActivityEvidence(
    'report', world?.reports, allEvents, ['creationId', 'version'], viewer,
    hasEarlierPublication
  );
  const matchedReports = reportEvidence.records;
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
  const methodEvidence = matchedActivityEvidence(
    'publish', world?.methods, allEvents, ['creationId', 'version'], viewer,
    event => event.version > 1 && retainedPublicationIds.has(event.id) && hasUniquePriorRepair(event)
  );
  const matchedMethods = methodEvidence.records;
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

  const suppliedQuestTrail = options && typeof options === 'object' ? options.questTrail : null;
  const questTrail = isQuestTrailProjection(suppliedQuestTrail, world, viewer)
    ? suppliedQuestTrail
    : getQuestTrail(world, viewer, { collaboratorResponseObjects });
  const completedQuestObjectives = questTrail
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

  // The field satchel is a bounded, read-only index of this character's
  // retained work. Every entry points back to a unique event (and, where
  // relevant, a matched activity record or strict Relay folio projection).
  // It never creates ownership, XP, approval, or canonical world state.
  const creationsById = new Map();
  for (const creation of rows(world?.creations)) {
    if (!creation || typeof creation.id !== 'string' || !creation.id) continue;
    if (creationsById.has(creation.id)) creationsById.set(creation.id, null);
    else creationsById.set(creation.id, creation);
  }
  const eventById = new Map(allEvents.map(event => [event.id, event]));
  const satchelEntries = [];
  const compactText = value => typeof value === 'string'
    ? Array.from(value.replace(/\s+/g, ' ').trim()).slice(0, 280).join('')
    : '';
  const creationTitle = id => {
    const creation = creationsById.get(id);
    return typeof creation?.title === 'string' && creation.title.trim()
      ? creation.title
      : (typeof id === 'string' && id ? id : 'retained source');
  };
  const addFieldItem = (kind, event, record, metadata = {}) => {
    const position = positionByEvent.get(event);
    if (!Number.isInteger(position) || !isStrictTimestamp(event?.at)) return;
    const recordId = typeof record?.id === 'string' && record.id ? record.id : event.id;
    const receipt = metadata.receipt && typeof metadata.receipt.digest === 'string' &&
      Number.isSafeInteger(metadata.receipt.size)
      ? Object.freeze({ digest: metadata.receipt.digest, size: metadata.receipt.size })
      : null;
    satchelEntries.push({
      position,
      item: Object.freeze({
        id: kind + ':' + recordId,
        eventId: event.id,
        kind,
        title: typeof metadata.title === 'string' && metadata.title.trim()
          ? Array.from(metadata.title.replace(/\s+/g, ' ').trim()).slice(0, 120).join('')
          : kind,
        at: event.at,
        status: typeof metadata.status === 'string' ? metadata.status : 'retained',
        summary: compactText(metadata.summary),
        sourceCreationId: typeof metadata.sourceCreationId === 'string' ? metadata.sourceCreationId : null,
        sourceVersion: Number.isSafeInteger(metadata.sourceVersion) && metadata.sourceVersion > 0
          ? metadata.sourceVersion : null,
        locationId: typeof metadata.locationId === 'string' ? metadata.locationId : null,
        receipt,
        action: metadata.action && typeof metadata.action === 'object' && typeof metadata.action.type === 'string'
          ? Object.freeze({ ...metadata.action })
          : null
      })
    });
  };

  for (const match of discoveryEvidence.matches) {
    addFieldItem('guide-discovery', match.event, match.record, {
      title: 'Guide discovery · ' + match.record.locationId,
      status: 'visit recorded',
      summary: 'A recorded visit; it does not verify the guide or its claims.',
      locationId: match.record.locationId,
      action: { type: 'location', id: match.record.locationId }
    });
  }
  for (const match of contributionEvidence.matches) {
    addFieldItem('field-note', match.event, match.record, {
      title: 'Field note · ' + creationTitle(match.record.creationId),
      status: 'retained note',
      summary: match.record.text,
      sourceCreationId: match.record.creationId,
      sourceVersion: match.record.version,
      action: { type: 'creation', id: match.record.creationId, version: match.record.version }
    });
  }
  for (const match of reportEvidence.matches) {
    addFieldItem('field-report', match.event, match.record, {
      title: 'Field report · ' + creationTitle(match.record.creationId),
      status: 'retained report · not adjudicated',
      summary: match.record.text,
      sourceCreationId: match.record.creationId,
      sourceVersion: match.record.version,
      action: { type: 'creation', id: match.record.creationId, version: match.record.version }
    });
  }
  for (const match of methodEvidence.matches) {
    addFieldItem('checked-repair', match.event, match.record, {
      title: 'Repair method · ' + (match.record.title || creationTitle(match.record.creationId)),
      status: 'repair publication matched',
      summary: match.record.description,
      sourceCreationId: match.record.creationId,
      sourceVersion: match.record.version,
      action: { type: 'creation', id: match.record.creationId, version: match.record.version }
    });
  }
  for (const event of studyEvents) {
    addFieldItem('study-note', event, null, {
      title: 'Study note · ' + creationTitle(event.creationId),
      status: 'practice recorded · not mastery',
      summary: 'Question: ' + event.question + ' · Attempt: ' + event.attempt + ' · Next check: ' + event.nextCheck,
      sourceCreationId: event.creationId,
      sourceVersion: event.version,
      action: { type: 'creation', id: event.creationId, version: event.version }
    });
  }
  for (const event of studyReviews) {
    addFieldItem('retrieval-review', event, null, {
      title: 'Retrieval review · ' + event.studyId,
      status: 'practice recorded · not accuracy proof',
      summary: 'Response: ' + event.response + ' · Reflection: ' + event.reflection,
      sourceCreationId: event.creationId,
      sourceVersion: event.version,
      action: { type: 'creation', id: event.creationId, version: event.version }
    });
  }
  for (const event of events) {
    if (!validMoonshotProposalIds.has(event.id)) continue;
    addFieldItem('moonshot-proposal', event, null, {
      title: 'Moonshot · ' + event.title,
      status: 'proposal only · not execution',
      summary: 'Hypothesis: ' + event.hypothesis + ' · Falsifier: ' + event.falsifier + ' · Evidence needed: ' + event.evidenceNeeded,
      sourceCreationId: event.sourceCreationId,
      sourceVersion: event.sourceVersion,
      action: { type: 'moonshot', moonshotId: event.moonshotId }
    });
  }
  for (const event of experimentReports) {
    addFieldItem('experiment-report', event, null, {
      title: 'Experiment report · ' + event.reportedOutcome,
      status: 'self-reported · ' + event.reportedOutcome,
      summary: 'Procedure: ' + event.procedure + ' · Observation: ' + event.observation,
      sourceCreationId: event.evidenceCreationId,
      sourceVersion: event.evidenceVersion,
      action: { type: 'moonshot-activity', moonshotId: event.moonshotId, activityId: event.reportId }
    });
  }
  for (const event of experimentChallenges) {
    addFieldItem('experiment-challenge', event, null, {
      title: 'Challenge · ' + event.challengeType,
      status: 'dissent preserved · not adjudicated',
      summary: event.challengeText,
      sourceCreationId: event.evidenceCreationId,
      sourceVersion: event.evidenceVersion,
      action: { type: 'moonshot-activity', moonshotId: event.moonshotId, activityId: event.challengeId }
    });
  }
  for (const object of collaboratorResponseObjects) {
    if (object.actorId !== viewer?.id || object.actorRole !== viewer?.role) continue;
    const event = eventById.get(object.eventId);
    if (!event) continue;
    const rejected = object.validationStatus === 'rejected';
    addFieldItem('guild-folio', event, object, {
      title: 'Guild folio · ' + object.name,
      status: rejected ? 'rejected response preserved' : 'structurally valid · human review only',
      summary: rejected
        ? 'Reason: ' + (object.validationReason || 'structural validation rejected the response') + ' · Moonshot ' + object.moonshotId
        : 'Response preserved for human review · Moonshot ' + object.moonshotId + '. Structural validity is not truth, evidence, execution or approval.',
      action: { type: 'collaborator-response', id: object.responseId }
    });
  }

  satchelEntries.sort((left, right) =>
    right.position - left.position || left.item.id.localeCompare(right.item.id)
  );
  const fieldSatchelTotal = satchelEntries.length;
  const fieldSatchelOmittedCount = Math.max(0, fieldSatchelTotal - MAX_FIELD_SATCHEL_ITEMS);
  const fieldSatchel = Object.freeze(
    satchelEntries.slice(0, MAX_FIELD_SATCHEL_ITEMS).map(entry => entry.item)
  );

  // Field equipment is an automatically selected, read-only loadout. Each
  // slot points to the newest qualifying retained activity for this actor;
  // it creates no item event, ownership, combat statistic, approval or XP.
  // Sources are selected from the full bounded scan, not only the 100 visible
  // satchel cards, so older evidence does not silently unequip a field practice.
  const publicationEquipmentEntries = mine(retainedPublications, viewer).flatMap(event => {
    const version = retainedVersions.get(versionKey(event.creationId, event.version));
    if (!version || !Number.isInteger(positionByEvent.get(event))) return [];
    return [{
      position: positionByEvent.get(event),
      item: Object.freeze({
        id: 'published-artifact:' + event.id,
        eventId: event.id,
        kind: 'published-artifact',
        title: 'Published artifact · ' + creationTitle(event.creationId),
        at: event.at,
        status: 'version retained · content not verified',
        summary: 'This exact published version is retained. Its receipt identifies bytes only.',
        sourceCreationId: event.creationId,
        sourceVersion: event.version,
        locationId: null,
        receipt: Object.freeze({
          digest: version.receipt.digest,
          size: version.receipt.size
        }),
        action: Object.freeze({
          type: 'creation',
          id: event.creationId,
          version: event.version
        })
      })
    }];
  });
  // satchelEntries is already sorted by descending append position. Select
  // its first source per kind, then scan publication sources once; avoid a
  // second full sort when a long Chronicle contains many retained records.
  const latestEquipmentSourceByKind = new Map();
  for (const entry of satchelEntries) {
    if (!latestEquipmentSourceByKind.has(entry.item.kind)) {
      latestEquipmentSourceByKind.set(entry.item.kind, entry);
    }
  }
  for (const entry of publicationEquipmentEntries) {
    const current = latestEquipmentSourceByKind.get('published-artifact');
    if (!current || entry.position > current.position ||
        (entry.position === current.position && entry.item.id.localeCompare(current.item.id) < 0)) {
      latestEquipmentSourceByKind.set('published-artifact', entry);
    }
  }
  const equipment = Object.freeze(FIELD_EQUIPMENT_SLOTS.map(slot => {
    let selected = null;
    for (const kind of slot.kinds) {
      const candidate = latestEquipmentSourceByKind.get(kind);
      if (candidate && (!selected || candidate.position > selected.position ||
          (candidate.position === selected.position && candidate.item.id.localeCompare(selected.item.id) < 0))) {
        selected = candidate;
      }
    }
    return Object.freeze({
      id: slot.id,
      label: slot.label,
      description: slot.description,
      status: selected ? 'record-backed' : 'empty',
      source: selected?.item ?? null
    });
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
    inventory: Object.freeze(inventory),
    fieldSatchel,
    fieldSatchelTotal,
    fieldSatchelOmittedCount,
    recentActivity: Object.freeze(recentActivity)
  });
}
