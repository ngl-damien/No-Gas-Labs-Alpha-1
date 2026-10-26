const rows = value => Array.isArray(value) ? value : [];
const timestamp = value => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Read-only projection of version-bound reports for TownSquare.
 * A report remains an attributed submission; this projector never adjudicates it.
 */
export function projectDissentDocket(world) {
  const creations = rows(world?.creations);
  return rows(world?.reports).map((report, sequence) => {
    const creationId = typeof report?.creationId === 'string' ? report.creationId : null;
    const creation = creations.find(item => item?.id === creationId);
    const version = Number.isSafeInteger(report?.version) && report.version > 0 ? report.version : null;
    const inspectable = Boolean(creation && version !== null && (
      creation.version === version || rows(creation.versions).some(item => item?.version === version)
    ));
    const at = typeof report?.at === 'string' ? report.at : '';
    return {
      id: typeof report?.id === 'string' ? report.id : `report-${sequence + 1}`,
      creationId,
      version,
      creationTitle: typeof creation?.title === 'string' && creation.title ? creation.title : 'Unknown creation',
      text: typeof report?.text === 'string' ? report.text : '[Report text unavailable]',
      actorId: typeof report?.actor?.id === 'string' ? report.actor.id : null,
      actorName: typeof report?.actor?.name === 'string' && report.actor.name ? report.actor.name : 'Unknown actor',
      at,
      status: 'UNADJUDICATED REPORT',
      inspectable,
      limitation: inspectable ? null : 'The referenced creation or retained version is unavailable. The report remains visible, but cannot be opened from this docket.',
      _timestamp: timestamp(at),
      _sequence: sequence
    };
  }).sort((a, b) => {
    if (a._timestamp !== null && b._timestamp !== null && a._timestamp !== b._timestamp) return b._timestamp - a._timestamp;
    if (a._timestamp !== null && b._timestamp === null) return -1;
    if (a._timestamp === null && b._timestamp !== null) return 1;
    return b._sequence - a._sequence;
  }).map(({_timestamp, _sequence, ...report}) => Object.freeze(report));
}
