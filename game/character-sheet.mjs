const rows = value => Array.isArray(value) ? value : [];
const mine = (entries, actorId) => actorId
  ? rows(entries).filter(entry => entry?.actor?.id === actorId)
  : [];

const LEVEL_SPAN = 300;

export function projectCharacter(world, viewer) {
  const xp = Number.isSafeInteger(world?.xp) && world.xp >= 0 ? world.xp : 0;
  const level = 1 + Math.floor(xp / LEVEL_SPAN);
  const actorId = typeof viewer?.id === 'string' && viewer.id ? viewer.id : null;
  const events = mine(world?.events, actorId);

  const skills = [
    {
      id: 'maker',
      label: 'Maker',
      count: events.filter(event => event.type === 'publish').length,
      record: 'published versions',
      basis: 'Accepted publication events attributed to this character.'
    },
    {
      id: 'explorer',
      label: 'Explorer',
      count: mine(world?.discoveries, actorId).length,
      record: 'guide discoveries',
      basis: 'Recorded visits to the four authored guide locations.'
    },
    {
      id: 'observer',
      label: 'Observer',
      count: mine(world?.contributions, actorId).length,
      record: 'field notes',
      basis: 'Attributed notes attached to a published version.'
    },
    {
      id: 'challenger',
      label: 'Challenger',
      count: mine(world?.reports, actorId).length,
      record: 'reports',
      basis: 'Attributed, version-bound reports; a report is not automatically upheld.'
    },
    {
      id: 'restorer',
      label: 'Restorer',
      count: mine(world?.methods, actorId).length,
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
    .filter(event => typeof event.at === 'string')
    .slice()
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 6)
    .map(event => Object.freeze({
      type: typeof event.type === 'string' ? event.type : 'unknown',
      at: event.at,
      creationId: typeof event.creationId === 'string' ? event.creationId : null,
      version: Number.isInteger(event.version) ? event.version : null,
      locationId: typeof event.locationId === 'string' ? event.locationId : null
    }));

  return Object.freeze({
    level,
    xp,
    levelStartXp: (level - 1) * LEVEL_SPAN,
    nextLevelXp: level * LEVEL_SPAN,
    xpIntoLevel: xp - (level - 1) * LEVEL_SPAN,
    xpPerLevel: LEVEL_SPAN,
    skills: Object.freeze(skills),
    inventory: Object.freeze(inventory),
    recentActivity: Object.freeze(recentActivity)
  });
}
