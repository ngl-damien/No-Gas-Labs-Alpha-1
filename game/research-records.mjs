const rows = value => Array.isArray(value) ? value : [];
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const sameActor = (left, right) => left?.id === right?.id;

const RESEARCH_TYPES = new Set([
  'moonshot-proposed',
  'experiment-reported',
  'experiment-challenged'
]);

function countBy(events, field, predicate = () => true) {
  const counts = new Map();
  for (const event of events) {
    const value = event?.[field];
    if (!predicate(value, event)) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function eventIdentityIsUnique(event, eventIdCounts) {
  return hasText(event?.id) && eventIdCounts.get(event.id) === 1;
}

export function isValidMoonshotProposal(event) {
  return event?.type === 'moonshot-proposed' &&
    hasText(event.moonshotId) && validTime(event.at) &&
    hasText(event.title) && Array.from(event.title).length <= 80 &&
    hasText(event.hypothesis) && Array.from(event.hypothesis).length <= 1000 &&
    hasText(event.falsifier) && Array.from(event.falsifier).length <= 1000 &&
    hasText(event.evidenceNeeded) && Array.from(event.evidenceNeeded).length <= 1000 &&
    hasText(event.actor?.id) && ['founder', 'witness'].includes(event.actor.role);
}

function validReport(event) {
  return event?.type === 'experiment-reported' &&
    hasText(event.reportId) && hasText(event.moonshotId) &&
    validTime(event.at) && hasText(event.procedure) &&
    hasText(event.observation) &&
    ['supports', 'contradicts', 'inconclusive', 'failed'].includes(event.reportedOutcome) &&
    hasText(event.actor?.id) && ['founder', 'witness'].includes(event.actor.role);
}

/**
 * Read-only projection for the Evidence Archive.
 *
 * Links are exposed only when their identifiers are unique and the referenced
 * record precedes the referring event in append-only history. This is display
 * logic, not adjudication: invalid or ambiguous records remain visible, but
 * their context is not guessed.
 */
export function projectResearchRecords(input) {
  const events = rows(input);
  const eventIdCounts = countBy(events, 'id', value => hasText(value));
  const proposalCounts = countBy(events.filter(event => event?.type === 'moonshot-proposed'), 'moonshotId', value => hasText(value));
  const reportCounts = countBy(events.filter(event => event?.type === 'experiment-reported'), 'reportId', value => hasText(value));
  const challengeCounts = countBy(events.filter(event => event?.type === 'experiment-challenged'), 'challengeId', value => hasText(value));

  // A proposal's optional source is historical evidence only when the exact
  // retained version has one unambiguous publication event before the proposal.
  const publicationsByReference = new Map();
  events.forEach((event, index) => {
    if (event?.type !== 'publish' || !hasText(event.creationId) ||
        !Number.isSafeInteger(event.version) || event.version < 1) return;
    const key = JSON.stringify([event.creationId, event.version]);
    if (!publicationsByReference.has(key)) publicationsByReference.set(key, []);
    publicationsByReference.get(key).push({ event, index });
  });

  const artifactStatusFor = (event, index, idField, versionField) => {
    const creationId = event?.[idField];
    const version = event?.[versionField];
    const hasCreationId = hasText(creationId);
    const hasVersion = version !== undefined && version !== null;
    if (!hasCreationId && !hasVersion) return 'not-provided';
    if (!hasCreationId || !Number.isSafeInteger(version) || version < 1) return 'invalid';
    const candidates = publicationsByReference.get(JSON.stringify([creationId, version])) || [];
    if (!candidates.length) return 'unavailable';
    if (candidates.length !== 1 || !eventIdentityIsUnique(candidates[0].event, eventIdCounts)) return 'ambiguous';
    const candidate = candidates[0];
    if (candidate.index >= index) return 'not-earlier';
    if (!validTime(candidate.event.at) || !validTime(event.at) ||
        Date.parse(candidate.event.at) > Date.parse(event.at)) return 'timestamp-conflict';
    return 'linked';
  };

  const proposalByMoonshot = new Map();
  events.forEach((event, index) => {
    if (!isValidMoonshotProposal(event) || !eventIdentityIsUnique(event, eventIdCounts) ||
        proposalCounts.get(event.moonshotId) !== 1) return;
    proposalByMoonshot.set(event.moonshotId, { event, index });
  });

  const reportById = new Map();
  events.forEach((event, index) => {
    if (!validReport(event) || !eventIdentityIsUnique(event, eventIdCounts) ||
        reportCounts.get(event.reportId) !== 1) return;
    const proposal = proposalByMoonshot.get(event.moonshotId);
    if (!proposal || proposal.index >= index || Date.parse(proposal.event.at) > Date.parse(event.at)) return;
    reportById.set(event.reportId, { event, index });
  });

  return events
    .map((event, index) => {
      if (!RESEARCH_TYPES.has(event?.type)) return null;
      const eventIdUnique = eventIdentityIsUnique(event, eventIdCounts);
      let proposal = null;
      let proposalStatus = 'not-applicable';

      if (event.type === 'moonshot-proposed') {
        proposalStatus = eventIdUnique && isValidMoonshotProposal(event) && proposalCounts.get(event.moonshotId) === 1
          ? 'unique'
          : 'ambiguous';
      } else if (!eventIdUnique) {
        proposalStatus = 'ambiguous';
      } else if (!hasText(event.moonshotId)) {
        proposalStatus = 'missing';
      } else if (proposalCounts.get(event.moonshotId) > 1) {
        proposalStatus = 'ambiguous';
      } else {
        const candidate = proposalByMoonshot.get(event.moonshotId);
        if (!candidate) proposalStatus = 'missing';
        else if (candidate.index >= index) proposalStatus = 'not-earlier';
        else if (!validTime(event.at) || Date.parse(candidate.event.at) > Date.parse(event.at)) proposalStatus = 'timestamp-conflict';
        else {
          proposal = candidate.event;
          proposalStatus = 'linked';
        }
      }

      let targetReport = null;
      let targetReportStatus = 'not-applicable';
      if (event.type === 'experiment-challenged') {
        if (!eventIdUnique || !hasText(event.challengeId) || challengeCounts.get(event.challengeId) !== 1) targetReportStatus = 'ambiguous';
        else if (!hasText(event.actor?.id) || !['founder', 'witness'].includes(event.actor.role) ||
            !['missing-evidence', 'methodology', 'contradiction', 'reproducibility', 'scope', 'other'].includes(event.challengeType) ||
            !hasText(event.challengeText) || Array.from(event.challengeText).length > 1000) targetReportStatus = 'invalid-challenge';
        else if (!hasText(event.reportId)) targetReportStatus = 'missing';
        else if (reportCounts.get(event.reportId) > 1) targetReportStatus = 'ambiguous';
        else {
          const candidate = reportById.get(event.reportId);
          if (!candidate) targetReportStatus = 'unavailable';
          else if (candidate.index >= index) targetReportStatus = 'not-earlier';
          else if (candidate.event.moonshotId !== event.moonshotId) targetReportStatus = 'mismatch';
          else if (sameActor(candidate.event.actor, event.actor)) targetReportStatus = 'same-actor';
          else if (!validTime(event.at) || Date.parse(candidate.event.at) > Date.parse(event.at)) targetReportStatus = 'timestamp-conflict';
          else {
            targetReport = candidate.event;
            targetReportStatus = 'linked';
          }
        }
      }

      return Object.freeze({
        ...event,
        _projection: Object.freeze({
          index,
          eventIdUnique,
          proposal,
          proposalStatus,
          sourceStatus: event.type === 'moonshot-proposed' ? artifactStatusFor(event, index, 'sourceCreationId', 'sourceVersion') : 'not-applicable',
          evidenceStatus: event.type === 'experiment-reported' || event.type === 'experiment-challenged'
            ? artifactStatusFor(event, index, 'evidenceCreationId', 'evidenceVersion')
            : 'not-applicable',
          targetReport,
          targetReportStatus
        })
      });
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = validTime(left.at) ? Date.parse(left.at) : Number.NEGATIVE_INFINITY;
      const rightTime = validTime(right.at) ? Date.parse(right.at) : Number.NEGATIVE_INFINITY;
      return rightTime - leftTime || right._projection.index - left._projection.index;
    });
}
