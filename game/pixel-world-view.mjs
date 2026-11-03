import { WorldView, PLACES, WORLD_WIDTH, WORLD_HEIGHT, findRoute } from './world-view.mjs';
import { isCollaboratorPacket, projectCollaboratorPackets } from './collaborator-contracts.mjs';
import { projectSourceObservationRecords } from './research-records.mjs';

const MAX_SOURCE_OBSERVATION_MAP_EVENTS = 100_000;
const unavailableSourceObservationMapCounts = () => Object.freeze({
  available: false, notes: null, dissent: null, responses: null, pending: null, review: null
});

function ownDataValue(object, key) {
  if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function isArraySafely(value) {
  try { return Array.isArray(value); } catch { return false; }
}

/**
 * Project only uniquely linked Source Observation activity onto the map.
 * Unlinked, malformed, duplicated, or otherwise unprojectable retained events
 * are counted as review items rather than silently becoming zero activity.
 */
export function projectSourceObservationMapCounts(world) {
  const events = ownDataValue(world, 'events');
  const creations = ownDataValue(world, 'creations');
  if (!isArraySafely(events) || !isArraySafely(creations)) {
    return unavailableSourceObservationMapCounts();
  }

  const eventCount = ownDataValue(events, 'length');
  if (!Number.isSafeInteger(eventCount) || eventCount < 0 ||
      eventCount > MAX_SOURCE_OBSERVATION_MAP_EVENTS) {
    return unavailableSourceObservationMapCounts();
  }

  const raw = { notes: 0, dissent: 0, responses: 0 };
  for (let index = 0; index < eventCount; index += 1) {
    const event = ownDataValue(events, String(index));
    const type = ownDataValue(event, 'type');
    if (type === 'source-observation-recorded') raw.notes += 1;
    else if (type === 'source-observation-challenged') raw.dissent += 1;
    else if (type === 'source-observation-challenge-responded') raw.responses += 1;
  }

  let records;
  try {
    records = projectSourceObservationRecords(events, creations);
  } catch {
    return unavailableSourceObservationMapCounts();
  }
  if (!isArraySafely(records)) return unavailableSourceObservationMapCounts();

  const linkedRecords = records.filter(record => record?.projectionStatus === 'linked');
  const challenges = linkedRecords.flatMap(record =>
    isArraySafely(record.challenges) ? record.challenges : []
  );
  const responses = challenges.reduce((total, challenge) =>
    total + (challenge.responseStatus === 'answered' && isArraySafely(challenge.responses)
      ? challenge.responses.length : 0), 0);
  const pending = challenges.filter(challenge => challenge.responseStatus === 'unanswered').length;
  const review = Math.max(0, raw.notes - linkedRecords.length) +
    Math.max(0, raw.dissent - challenges.length) +
    Math.max(0, raw.responses - responses);

  return Object.freeze({
    available: true,
    notes: linkedRecords.length,
    dissent: challenges.length,
    responses,
    pending,
    review
  });
}


const QUEST_TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const QUEST_RECIPES = new Set(['comic', 'loom', 'observatory', 'custom']);

const GUILD_NPC_POSITIONS = Object.freeze([
  { roleId: 'archivist', x: 980, y: 220, accent: '#6b805d', sigil: 'A', routeLocation: 'evidence_archive' },
  { roleId: 'adversary', x: 1080, y: 235, accent: '#af5138', sigil: '!', routeLocation: 'evidence_archive' },
  { roleId: 'synthesizer', x: 150, y: 230, accent: '#536b68', sigil: 'S', routeLocation: 'guild_hall' },
  { roleId: 'tutor', x: 250, y: 470, accent: '#9a8b5b', sigil: 'T', routeLocation: 'academy' }
]);
const COLLABORATOR_ROLE_CATALOGUE = projectCollaboratorPackets({ events: [], creations: [] });
const GUILD_NPC_SHORT_NAMES = Object.freeze({
  archivist: 'ARCHIVIST',
  adversary: 'ADVERSARY',
  synthesizer: 'SYNTHESIS',
  tutor: 'TUTOR'
});

// The role catalogue is the single source of names and objectives. The pixel
// renderer contributes map positions, service institutions and visual accents.
export const GUILD_NPCS = Object.freeze(GUILD_NPC_POSITIONS.flatMap(position => {
  const role = COLLABORATOR_ROLE_CATALOGUE.find(candidate => candidate.id === position.roleId);
  const place = PLACES.find(candidate => candidate.id === position.routeLocation && candidate.type === 'institution');
  return role && place ? [Object.freeze({
    id: 'guild-npc-' + role.id,
    roleId: role.id,
    name: role.name,
    objective: role.objective,
    shortName: GUILD_NPC_SHORT_NAMES[role.id] || role.name.toUpperCase(),
    ...position,
    routeLocation: place.id,
    locationLabel: place.name.toUpperCase(),
    authority: 'advisory-only',
    invokesModel: false,
    mayWriteCanonicalState: false,
    mayGrantAuthority: false,
    mayAwardProgress: false,
    mayCertifyTruthOrExecution: false
  })] : [];
}));

const GUILD_NPC_COLORS = Object.freeze({
  archivist: Object.freeze({ H: '#536b49', F: '#e0bd96', G: '#718765', L: '#d4d8c2', T: '#765d40', B: '#343e39' }),
  adversary: Object.freeze({ R: '#a64f3b', F: '#e0bd96', W: '#e8e6dc', B: '#343e39' }),
  synthesizer: Object.freeze({ S: '#536b68', F: '#e0bd96', C: '#5f8873', L: '#c4d1a0', T: '#765d40', B: '#343e39' }),
  tutor: Object.freeze({ H: '#7c876a', F: '#e0bd96', V: '#9a8b5b', L: '#e8e6dc', T: '#765d40', B: '#343e39' })
});

function guildNpcStatusLabel(status) {
  return status === 'ready' ? 'PACKET READY'
    : status === 'partial' ? 'READY · PARTIAL'
      : 'NO PACKET';
}

/**
 * Project each authored Guild Hall guide's current bounded hand-off availability.
 * This reads the sealed collaborator packet projection only: it never invokes a
 * model, mutates the world, or treats packet availability as agent execution.
 */
export function projectGuildNpcReadiness(world) {
  const packets = projectCollaboratorPackets(world);
  const byRole = new Map(packets.filter(isCollaboratorPacket).map(packet => [packet.id, packet]));
  return Object.freeze(GUILD_NPCS.map(npc => {
    const packet = byRole.get(npc.roleId);
    const sourceSnapshotStatus = packet?.sourceSnapshot?.status === 'identified'
      ? 'identified' : 'incomplete';
    const packetAvailable = packet?.available === true;
    const status = packetAvailable
      ? sourceSnapshotStatus === 'identified' ? 'ready' : 'partial'
      : 'unavailable';
    const inputCount = packetAvailable && Array.isArray(packet.inputRefs) ? packet.inputRefs.length : 0;
    const omittedCount = Number.isSafeInteger(packet?.omittedCount) && packet.omittedCount >= 0
      ? packet.omittedCount : 0;
    return Object.freeze({
      npcId: npc.id,
      roleId: npc.roleId,
      status,
      label: guildNpcStatusLabel(status),
      sourceSnapshotStatus,
      inputCount,
      omittedCount,
      reason: !packetAvailable && typeof packet?.reason === 'string' ? packet.reason : null
    });
  }));
}

const GUILD_NPC_POINTER_HIT_RADIUS = 34;

function ownFiniteCoordinate(value, key) {
  try {
    const descriptor = value && Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
      Number.isFinite(descriptor.value) ? descriptor.value : null;
  } catch {
    return null;
  }
}

export function projectGuildNpcPointerTarget(point, camera, zoom, width, height) {
  const x = ownFiniteCoordinate(point, 'x');
  const y = ownFiniteCoordinate(point, 'y');
  const cameraX = ownFiniteCoordinate(camera, 'x');
  const cameraY = ownFiniteCoordinate(camera, 'y');
  if (x === null || y === null || cameraX === null || cameraY === null ||
      !Number.isFinite(zoom) || zoom <= 0 ||
      !Number.isFinite(width) || width <= 0 ||
      !Number.isFinite(height) || height <= 0 ||
      x < 0 || y < 0 || x > width || y > height) return null;

  const worldX = (x - width / 2) / zoom + cameraX;
  const worldY = (y - height / 2) / zoom + cameraY;
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
  let selected = null;
  for (const npc of GUILD_NPCS) {
    const distance = Math.hypot(npc.x - worldX, npc.y + 10 - worldY);
    if (distance <= GUILD_NPC_POINTER_HIT_RADIUS &&
        (!selected || distance < selected.distance)) {
      selected = { npc, distance };
    }
  }
  if (!selected) return null;
  return Object.freeze({
    id: selected.npc.id,
    roleId: selected.npc.roleId,
    name: selected.npc.name,
    routeLocation: selected.npc.routeLocation
  });
}

function guildNpcAccessibilityText(readiness) {
  const byRole = new Map(readiness.map(entry => [entry.roleId, entry]));
  const descriptions = GUILD_NPCS.map(npc => {
    const entry = byRole.get(npc.roleId);
    if (!entry) return npc.name + ' at ' + npc.locationLabel + ': packet state unavailable.';
    const countPhrase = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;
    const packetState = entry.status === 'ready'
      ? `a source-bound packet is available with ${countPhrase(entry.inputCount, 'retained event reference', 'retained event references')}`
      : entry.status === 'partial'
        ? `a source-bound packet is available with ${countPhrase(entry.inputCount, 'retained event reference', 'retained event references')}, but source snapshot identity is incomplete`
        : `no bounded packet is currently available${entry.reason ? ': ' + entry.reason : ''}`;
    const omitted = entry.omittedCount > 0
      ? ` ${countPhrase(entry.omittedCount, 'additional eligible event reference is omitted', 'additional eligible event references are omitted')} from this bounded packet.`
      : '';
    return `${npc.name} at ${npc.locationLabel}: ${npc.objective} Current packet state: ${packetState}.${omitted}`;
  });
  return 'Bounded institutional collaborator guides: ' + descriptions.join(' ') +
    ' These are authored advisory entry points, not autonomous AI agents. Packet availability is a read-only projection of retained research events; no model is invoked, and no canonical state, authority, XP, truth certification, execution, or mastery is created.';
}
function safeQuestTargetId(value) {
  return typeof value === 'string' && QUEST_TARGET_ID.test(value) &&
    !['constructor', 'prototype', '__proto__'].includes(value);
}

function questTargetRows(value) {
  if (!isArraySafely(value)) return null;
  const length = ownDataValue(value, 'length');
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_SOURCE_OBSERVATION_MAP_EVENTS) return null;
  const rows = [];
  for (let index = 0; index < length; index += 1) {
    const row = ownDataValue(value, String(index));
    if (row === undefined) return null;
    rows.push(row);
  }
  return rows;
}

function questTargetLabel(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return Array.from(value.trim()).slice(0, 32).join('');
}

function createQuestMapTarget(kind, id, x, y, label) {
  if (!safeQuestTargetId(id) || !Number.isFinite(x) || !Number.isFinite(y) ||
      x < 0 || y < 0 || x > WORLD_WIDTH || y > WORLD_HEIGHT) return null;
  return Object.freeze({ kind, id, x, y, label: questTargetLabel(label, 'Next objective') });
}

/** Keep canvas map labels at a stable CSS-pixel size despite world zoom. */
export function projectMapLabelMetrics(screenFontSize, zoom, viewportWidth) {
  if (!Number.isFinite(screenFontSize) || screenFontSize < 8 || screenFontSize > 18 ||
      !Number.isFinite(zoom) || zoom <= 0 || zoom > 4 ||
      !Number.isFinite(viewportWidth) || viewportWidth < 64) return null;
  const maxScreenWidth = Math.max(48, Math.min(220, viewportWidth - 16));
  return Object.freeze({
    fontSize: screenFontSize / zoom,
    maxWidth: maxScreenWidth / zoom,
    minWidth: Math.min(48, maxScreenWidth) / zoom,
    horizontalPadding: 8 / zoom,
    verticalPadding: 5 / zoom,
    lineWidth: 1.5 / zoom
  });
}

/**
 * Keep a map-label panel inside the visible viewport without pulling wholly
 * off-screen objects into view. Inputs and outputs are in CSS pixels/world units.
 */
export function projectMapLabelPosition(anchorX, anchorY, viewportWidth, viewportHeight, camera, zoom,
  panelWidth, panelHeight, margin = 8) {
  const cameraX = ownDataValue(camera, 'x');
  const cameraY = ownDataValue(camera, 'y');
  if (![anchorX, anchorY, viewportWidth, viewportHeight, cameraX, cameraY, zoom,
    panelWidth, panelHeight, margin].every(Number.isFinite) ||
      viewportWidth < 64 || viewportHeight < 64 || zoom <= 0 ||
      panelWidth <= 0 || panelHeight <= 0 || margin < 0 ||
      margin * 2 >= Math.min(viewportWidth, viewportHeight) ||
      panelWidth > viewportWidth - margin * 2 ||
      panelHeight > viewportHeight - margin * 2) return null;

  const screenX = viewportWidth / 2 + (anchorX - cameraX) * zoom;
  const screenY = viewportHeight / 2 + (anchorY - cameraY) * zoom;
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
  const originalLeft = screenX - panelWidth / 2;
  const originalTop = screenY - panelHeight;
  const originalRight = originalLeft + panelWidth;
  const originalBottom = originalTop + panelHeight;
  if (originalRight <= margin || originalLeft >= viewportWidth - margin ||
      originalBottom <= margin || originalTop >= viewportHeight - margin) return null;

  const left = Math.max(margin, Math.min(viewportWidth - margin - panelWidth, originalLeft));
  const top = Math.max(margin, Math.min(viewportHeight - margin - panelHeight, originalTop));
  return Object.freeze({
    x: cameraX + (left + panelWidth / 2 - viewportWidth / 2) / zoom,
    y: cameraY + (top + panelHeight - viewportHeight / 2) / zoom
  });
}

/**
 * Resolve a quest action to one exact, already-projected world object.
 * This is a read-only navigation hint: it never advances the objective.
 */
export function projectQuestMapTarget(action, world, researchObjects = [], researchActivityObjects = []) {
  const type = ownDataValue(action, 'type');
  if (type === 'workbench') {
    if (!QUEST_RECIPES.has(ownDataValue(action, 'recipe'))) return null;
    const place = PLACES.find(item => item.id === 'workbench');
    return place ? createQuestMapTarget('location', place.id, place.x, place.y, place.name) : null;
  }

  if (type === 'location') {
    const id = ownDataValue(action, 'id');
    if (!safeQuestTargetId(id)) return null;
    const npcMatches = GUILD_NPCS.filter(npc => npc.id === id);
    if (npcMatches.length === 1) {
      const npc = npcMatches[0];
      return createQuestMapTarget('npc', npc.id, npc.x, npc.y + 10, npc.name);
    }
    const place = PLACES.find(item => item.id === id);
    return place ? createQuestMapTarget('location', place.id, place.x, place.y, place.name) : null;
  }

  if (type === 'creation') {
    const id = ownDataValue(action, 'id');
    const version = ownDataValue(action, 'version');
    if (!safeQuestTargetId(id) || !Number.isSafeInteger(version) || version < 1) return null;
    const creations = questTargetRows(ownDataValue(world, 'creations'));
    if (!creations) return null;
    const matches = creations.filter(item => ownDataValue(item, 'id') === id);
    if (matches.length !== 1) return null;
    const creation = matches[0];
    const rawVersions = ownDataValue(creation, 'versions');
    const versions = rawVersions === undefined || rawVersions === null ? [] : questTargetRows(rawVersions);
    if (!versions) return null;
    const versionMatches = [creation, ...versions].filter(item => ownDataValue(item, 'version') === version);
    if (versionMatches.length !== 1) return null;
    const position = ownDataValue(creation, 'position');
    return createQuestMapTarget(
      'creation', id, ownDataValue(position, 'x'), ownDataValue(position, 'y'),
      ownDataValue(creation, 'title')
    );
  }

  if (type === 'research-object') {
    const id = ownDataValue(action, 'id');
    const moonshotId = ownDataValue(action, 'moonshotId');
    if (!safeQuestTargetId(id) || !safeQuestTargetId(moonshotId)) return null;
    const objects = questTargetRows(researchObjects);
    if (!objects) return null;
    const matches = objects.filter(item => ownDataValue(item, 'id') === id);
    if (matches.length !== 1) return null;
    const object = matches[0];
    if (ownDataValue(object, 'moonshotId') !== moonshotId) return null;
    return createQuestMapTarget(
      'research-object', id, ownDataValue(object, 'x'), ownDataValue(object, 'y'),
      ownDataValue(object, 'title')
    );
  }

  if (type === 'research-activity') {
    const id = ownDataValue(action, 'id');
    const moonshotId = ownDataValue(action, 'moonshotId');
    const activityId = ownDataValue(action, 'activityId');
    if (!safeQuestTargetId(id) || !safeQuestTargetId(moonshotId) || !safeQuestTargetId(activityId)) return null;
    const objects = questTargetRows(researchActivityObjects);
    if (!objects) return null;
    const matches = objects.filter(item => ownDataValue(item, 'id') === id);
    if (matches.length !== 1) return null;
    const object = matches[0];
    if (ownDataValue(object, 'moonshotId') !== moonshotId ||
        ownDataValue(object, 'activityId') !== activityId ||
        ownDataValue(object, 'mapVisible') !== true) return null;
    return createQuestMapTarget(
      'research-activity', id, ownDataValue(object, 'x'), ownDataValue(object, 'y'),
      ownDataValue(object, 'title')
    );
  }

  return null;
}

/**
 * Project an off-screen quest destination to the nearest safe viewport edge.
 * A null result means the target is already visible or the projection is unsafe.
 */
export function projectQuestCompassIndicator(target, camera, width, height, zoom, margin = 26) {
  const targetX = ownDataValue(target, 'x');
  const targetY = ownDataValue(target, 'y');
  const cameraX = ownDataValue(camera, 'x');
  const cameraY = ownDataValue(camera, 'y');
  const label = ownDataValue(target, 'label');
  if (![targetX, targetY, cameraX, cameraY, width, height, zoom, margin].every(Number.isFinite) ||
      zoom <= 0 || width < 64 || height < 64 || margin < 8 ||
      margin * 2 >= Math.min(width, height)) return null;

  const screenX = width / 2 + (targetX - cameraX) * zoom;
  const screenY = height / 2 + (targetY - cameraY) * zoom;
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
  if (screenX >= margin && screenX <= width - margin &&
      screenY >= margin && screenY <= height - margin) return null;

  const dx = screenX - width / 2;
  const dy = screenY - height / 2;
  if (dx === 0 && dy === 0) return null;
  const scale = Math.min(
    dx === 0 ? Infinity : (width / 2 - margin) / Math.abs(dx),
    dy === 0 ? Infinity : (height / 2 - margin) / Math.abs(dy)
  );
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return Object.freeze({
    x: width / 2 + dx * scale,
    y: height / 2 + dy * scale,
    angle: Math.atan2(dy, dx),
    label: questTargetLabel(label, 'Next objective')
  });
}

export const WORLD_TILE_SIZE = 32;
const HALF_TILE = WORLD_TILE_SIZE / 2;
const PATHS = [
  [[85,730],[180,640],[325,675],[540,710],[690,720],[850,720],[1050,720],[1130,625],[1280,600],[1480,620]],
  [[325,675],[350,510],[430,425],[670,380],[850,360],[1025,360],[1160,320],[1310,350]],
  [[1050,720],[1120,820],[1280,850],[1440,820]],
  [[180,640],[150,450],[240,300],[480,260],[670,330]]
];

function riverX(y) {
  return 856 + Math.sin(y / 155) * 34;
}

function hash2(x, y) {
  let value = Math.imul(x | 0, 0x45d9f3b) ^ Math.imul(y | 0, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function distanceToSegment(x, y, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(x - start[0], y - start[1]);
  const amount = Math.max(0, Math.min(1,
    ((x - start[0]) * dx + (y - start[1]) * dy) / lengthSquared
  ));
  return Math.hypot(x - (start[0] + amount * dx), y - (start[1] + amount * dy));
}

function nearPath(x, y) {
  return PATHS.some(path => path.slice(1).some((point, index) =>
    distanceToSegment(x, y, path[index], point) <= 15
  ));
}

/** Deterministic terrain classification for the shared world coordinate grid. */
export function classifyWorldTile(tileX, tileY) {
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) return 'void';
  const x = tileX * WORLD_TILE_SIZE + HALF_TILE;
  const y = tileY * WORLD_TILE_SIZE + HALF_TILE;
  if (x < 0 || y < 0 || x >= WORLD_WIDTH || y >= WORLD_HEIGHT) return 'void';

  if (Math.abs(x - riverX(y)) < 58) {
    return (y >= 326 && y <= 396) || (y >= 682 && y <= 754) ? 'bridge' : 'water';
  }
  if (Math.hypot(x - 1040, y - 440) < 74) return 'plaza';
  if (nearPath(x, y)) return 'path';
  if (Math.hypot(x - 1280, y - 810) < 88) return 'stone';
  return 'grass';
}

/** Stable tile descriptor; no world state or random source is consulted. */
export function worldTileAt(tileX, tileY) {
  return Object.freeze({
    x: tileX * WORLD_TILE_SIZE,
    y: tileY * WORLD_TILE_SIZE,
    kind: classifyWorldTile(tileX, tileY),
    variant: hash2(tileX, tileY) % 4
  });
}

export const PIXEL_SPRITES = Object.freeze({
  tree: Object.freeze([
    '....GGGG....',
    '...GGGGGG...',
    '..GGGGGGGG..',
    '.GGGLLGGGGG.',
    '.GGGGGGGGGG.',
    '..GGGGGGGG..',
    '...GGGGGG...',
    '....TTTT....',
    '....TTTT....',
    '....TTTT....'
  ]),
  rock: Object.freeze([
    '...SSSS...',
    '..SSSSSS..',
    '.SSLLLLSS.',
    'SSLLLLLLSS',
    '.SSSSSSSS.'
  ]),
  founder: Object.freeze([
    '...HHHH...',
    '..HHHHHH..',
    '..HFFFFH..',
    '..FFFFFF..',
    '...CCCC...',
    '..CCCCCC..',
    '..CCLLCC..',
    '...CCCC...',
    '...BBBB...',
    '..BB..BB..'
  ]),
  visitor: Object.freeze([
    '...GGGG...',
    '..GGGGGG..',
    '..GFFFFG..',
    '..FFFFFF..',
    '...VVVV...',
    '..VVVVVV..',
    '..VVLLVV..',
    '...VVVV...',
    '...BBBB...',
    '..BB..BB..'
  ]),
  moonshot: Object.freeze([
    '...CC...',
    '..CLLC..',
    '.CLLLLC.',
    'CLLLLLLC',
    '.CLLLLC.',
    '..CLLC..',
    '...CC...',
    '...TT...'
  ]),
  challenge: Object.freeze([
    '..RRRR..',
    '.RWWWWR.',
    'RWWWWWWR',
    'RWWWWWWR',
    '.RWWWWR.',
    '..RRRR..',
    '...TT...',
    '...TT...'
  ]),
  archivist: Object.freeze([
    '....HHHH....',
    '...HHHHHH...',
    '..HHFFFFHH..',
    '..HFFFFFFH..',
    '..GGGGGGGG..',
    '..GGLGGGLG..',
    '...GGTTGG...',
    '...GGTTGG...',
    '...BBBBBB...',
    '..BB....BB..'
  ]),
  adversary: Object.freeze([
    '....RRRR....',
    '...RRRRRR...',
    '..RRFFFFRR..',
    '..RFFFFFFR..',
    '.RRWWWWWWRR.',
    '.RRRWWWWRRR.',
    '...RRRRRR...',
    '...RRRRRR...',
    '...BBBBBB...',
    '..BB....BB..'
  ]),
  synthesizer: Object.freeze([
    '...SSSSSS...',
    '..SSSSSSSS..',
    '..SFFFFFFS..',
    '..FFFFFFF...',
    '..CCCCCCCC..',
    '..CCLLCCLL..',
    '...CCTTCC...',
    '...CCCCCC...',
    '...BBBBBB...',
    '..BB....BB..'
  ]),
  tutor: Object.freeze([
    '...HHHHHH...',
    '..HHHHHHHH..',
    '..HHFFFFHH..',
    '..HFFFFFFH..',
    '..VVVVVVVV..',
    '..VVLLVVLL..',
    '...VVTTVV...',
    '...VVVVVV...',
    '...BBBBBB...',
    '..BB....BB..'
  ])
});

const TILE_COLORS = Object.freeze({
  void: ['#0c0d0b'],
  grass: ['#536b49','#58704c','#4f6746','#5c744e'],
  path: ['#aa9669','#b29c70','#a28e65','#b9a477'],
  water: ['#527f7d','#4e7978','#588784','#4a7475'],
  bridge: ['#806344','#896b48','#765b3f','#92734d'],
  plaza: ['#9a9a79','#a1a080','#929574','#a8a588'],
  stone: ['#777d69','#828572','#6e7664','#898a76']
});

const SPRITE_COLORS = Object.freeze({
  tree: Object.freeze({G:'#3e5b3e',L:'#77915c',T:'#71543b'}),
  rock: Object.freeze({S:'#656e60',L:'#b0b39a'}),
  founder: Object.freeze({H:'#bd713c',F:'#e4bd91',C:'#3c5e55',L:'#b7c4a1',B:'#343e39'}),
  visitor: Object.freeze({G:'#718765',F:'#e0bd96',V:'#718c77',L:'#b7c4a1',B:'#343e39'}),
  moonshot: Object.freeze({C:'#5f8873',L:'#c4d1a0',T:'#765d40'}),
  challenge: Object.freeze({R:'#a64f3b',W:'#e8e6dc',T:'#765d40'})
});

function drawSprite(context, rows, colors, x, bottom, pixelSize) {
  const width = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const left = Math.round(x - width * pixelSize / 2);
  const top = Math.round(bottom - rows.length * pixelSize);
  rows.forEach((row, rowIndex) => {
    Array.from(row).forEach((symbol, columnIndex) => {
      const color = colors[symbol];
      if (!color) return;
      context.fillStyle = color;
      context.fillRect(
        left + columnIndex * pixelSize,
        top + rowIndex * pixelSize,
        pixelSize,
        pixelSize
      );
    });
  });
}

function drawTile(context, tile) {
  const x = tile.x;
  const y = tile.y;
  const colorSet = TILE_COLORS[tile.kind] || TILE_COLORS.void;
  context.fillStyle = colorSet[tile.variant % colorSet.length];
  context.fillRect(x, y, WORLD_TILE_SIZE, WORLD_TILE_SIZE);

  if (tile.kind === 'grass') {
    const seed = hash2(x / WORLD_TILE_SIZE, y / WORLD_TILE_SIZE);
    context.fillStyle = tile.variant % 2 ? '#71865a' : '#6b8055';
    context.fillRect(x + 4 + seed % 19, y + 5 + (seed >>> 5) % 18, 3, 2);
    context.fillRect(x + 7 + (seed >>> 9) % 17, y + 8 + (seed >>> 13) % 16, 2, 3);
  } else if (tile.kind === 'path') {
    context.fillStyle = '#d0bb8b';
    context.fillRect(x + 4 + tile.variant * 2, y + 6, 8, 5);
    context.fillRect(x + 17, y + 19 + tile.variant, 9, 5);
    context.fillStyle = '#887957';
    context.fillRect(x + 5 + tile.variant * 2, y + 11, 7, 1);
  } else if (tile.kind === 'water') {
    context.fillStyle = '#86aa9b';
    context.fillRect(x + 4, y + 7 + tile.variant * 3, 11, 2);
    context.fillRect(x + 17, y + 21 - tile.variant * 2, 10, 2);
    context.fillStyle = '#3f6d70';
    context.fillRect(x + 10, y + 15, 5, 1);
  } else if (tile.kind === 'bridge') {
    context.fillStyle = '#b08a5b';
    for (let plank = 0; plank < 4; plank++) {
      context.fillRect(x + 3 + plank * 7, y + 2, 4, 28);
    }
    context.fillStyle = '#5d4b36';
    context.fillRect(x + 1, y + 2, 2, 28);
    context.fillRect(x + 29, y + 2, 2, 28);
  } else if (tile.kind === 'plaza') {
    context.fillStyle = '#b9b28d';
    context.fillRect(x + 2, y + 2, 13, 2);
    context.fillRect(x + 17, y + 17, 13, 2);
    context.fillStyle = '#7f866e';
    context.fillRect(x + 15, y + 3, 1, 26);
    context.fillRect(x + 3, y + 15, 26, 1);
  } else if (tile.kind === 'stone') {
    context.fillStyle = '#a4a58e';
    context.fillRect(x + 4, y + 7, 10, 7);
    context.fillRect(x + 17, y + 19, 11, 6);
    context.fillStyle = '#5f685d';
    context.fillRect(x + 5, y + 14, 8, 1);
  }
  context.fillStyle = '#25372c18';
  context.fillRect(x, y, WORLD_TILE_SIZE, 1);
  context.fillRect(x, y, 1, WORLD_TILE_SIZE);
}

function drawPixelBuilding(context, x, y, roof, wall, trim) {
  context.fillStyle = '#25372e66';
  context.fillRect(x - 42, y - 2, 84, 14);
  context.fillStyle = '#354638';
  context.fillRect(x - 40, y - 58, 80, 62);
  context.fillStyle = trim;
  context.fillRect(x - 38, y - 58, 76, 42);
  context.fillStyle = roof;
  context.fillRect(x - 34, y - 54, 68, 34);
  for (let seam = 0; seam < 4; seam++) {
    context.fillStyle = '#24362d55';
    context.fillRect(x - 30, y - 50 + seam * 8, 60, 2);
  }
  context.fillStyle = wall;
  context.fillRect(x - 32, y - 20, 64, 24);
  context.fillStyle = '#2d3c31';
  context.fillRect(x - 8, y - 20, 16, 24);
  context.fillStyle = '#c2c9a4';
  context.fillRect(x - 27, y - 14, 10, 8);
  context.fillRect(x + 17, y - 14, 10, 8);
  context.fillStyle = '#657b5e';
  context.fillRect(x - 25, y - 12, 6, 4);
  context.fillRect(x + 19, y - 12, 6, 4);
}

function institutionFeatures(rows) {
  return Object.freeze(rows.map(([x, y, width, height, palette]) =>
    Object.freeze({ x, y, width, height, palette })
  ));
}

// Each landmark gets a silhouette tied to its actual institutional purpose:
// council banner, forge chimney, archive stacks, human-gate pillars, academy
// spire, observatory telescope, or publication press.
const INSTITUTION_ARCHITECTURE = Object.freeze({
  guild_hall: institutionFeatures([
    [-48, -64, 96, 7, 'trim'], [-4, -86, 8, 22, 'trim'],
    [-16, -82, 32, 12, 'accent'], [-42, -18, 8, 24, 'trim'], [34, -18, 8, 24, 'trim']
  ]),
  forge: institutionFeatures([
    [-28, -100, 16, 46, 'trim'], [-32, -104, 24, 6, 'wall'],
    [10, -30, 22, 18, 'accent'], [14, -26, 14, 10, 'glow'], [-12, 4, 38, 6, 'trim']
  ]),
  evidence_archive: institutionFeatures([
    [-42, -92, 18, 40, 'trim'], [24, -92, 18, 40, 'trim'],
    [-37, -84, 10, 5, 'accent'], [29, -84, 10, 5, 'accent'],
    [-27, -14, 8, 10, 'accent'], [-9, -14, 8, 10, 'wall'],
    [9, -14, 8, 10, 'accent'], [27, -14, 8, 10, 'wall']
  ]),
  decision_chamber: institutionFeatures([
    [-44, -78, 8, 58, 'trim'], [-18, -78, 8, 58, 'trim'],
    [10, -78, 8, 58, 'trim'], [36, -78, 8, 58, 'trim'],
    [-50, -86, 100, 8, 'roof'], [-10, -28, 20, 28, 'accent']
  ]),
  academy: institutionFeatures([
    [-12, -116, 24, 62, 'trim'], [-6, -132, 12, 16, 'roof'],
    [-30, -82, 12, 28, 'trim'], [18, -82, 12, 28, 'trim'],
    [-8, -56, 16, 12, 'accent'], [-3, -53, 6, 6, 'wall']
  ]),
  moonshot_field: institutionFeatures([
    [-42, -74, 84, 8, 'trim'], [-34, -90, 68, 16, 'roof'],
    [-20, -98, 40, 8, 'trim'], [28, -112, 8, 36, 'accent'],
    [22, -114, 20, 6, 'glow'], [18, -76, 28, 6, 'wall']
  ]),
  publication_house: institutionFeatures([
    [-42, -76, 84, 8, 'trim'], [-32, -90, 64, 14, 'roof'],
    [-20, -102, 40, 10, 'trim'], [-12, -32, 24, 18, 'accent'],
    [-34, -10, 68, 8, 'trim'], [22, -54, 12, 18, 'wall']
  ])
});
const INSTITUTION_FEATURE_COLORS = Object.freeze({ accent: '#c77b48', glow: '#e0bd69' });

function drawInstitutionBuilding(context, place, roof, wall, trim) {
  const baseY = place.y + 8;
  drawPixelBuilding(context, place.x, baseY, roof, wall, trim);
  for (const feature of INSTITUTION_ARCHITECTURE[place.id] || []) {
    const color = feature.palette === 'roof' ? roof
      : feature.palette === 'wall' ? wall
        : feature.palette === 'trim' ? trim
          : INSTITUTION_FEATURE_COLORS[feature.palette];
    if (!color) continue;
    context.fillStyle = color;
    context.fillRect(place.x + feature.x, baseY + feature.y, feature.width, feature.height);
  }
}

const DECORATIONS = Array.from({ length: 48 }, (_, index) => ({
  x: 48 + hash2(index + 11, 17) % 1504,
  y: 48 + hash2(index + 73, 29) % 904,
  type: index % 8 === 0 ? 'rock' : 'tree'
})).filter(item =>
  classifyWorldTile(Math.floor(item.x / WORLD_TILE_SIZE), Math.floor(item.y / WORLD_TILE_SIZE)) === 'grass' &&
  PLACES.every(place => Math.hypot(place.x - item.x, place.y - item.y) > 92) &&
  GUILD_NPCS.every(npc => Math.hypot(npc.x - item.x, npc.y - item.y) > 56)
);

export class PixelWorldView extends WorldView {
  constructor(canvas, options = {}) {
    super(canvas, options);
    const inheritedPointer = this.onPointer;
    canvas.removeEventListener('pointerdown', inheritedPointer);
    this.onPointer = event => this.handlePointer(event, inheritedPointer);
    canvas.addEventListener('pointerdown', this.onPointer);
    canvas.dataset.worldRenderer = 'pixel-v1';
    canvas.style.imageRendering = 'pixelated';
    this.sourceObservationMapCounts = projectSourceObservationMapCounts(this.world);
    this.guildNpcReadiness = projectGuildNpcReadiness(this.world);
    this.questAction = null;
    this.questTarget = null;
    this.updateResearchAccessibility();
  }

  handlePointer(event, fallback) {
    const rect = this.canvas.getBoundingClientRect();
    const target = projectGuildNpcPointerTarget({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    }, this.camera, this.zoom, this.width, this.height);
    if (!target) {
      if (typeof fallback === 'function') fallback(event);
      return;
    }

    const nearest = this.nearest(target.id, 'npc');
    if (nearest?.type !== 'npc') {
      if (typeof fallback === 'function') fallback(event);
      return;
    }
    event.preventDefault?.();
    if (nearest.distance < 160) {
      this.interact(target.id, 'npc');
      return;
    }
    this.goTo(target.id, 'npc');
    this.canvas.focus({ preventScroll: true });
  }

  goTo(id, targetType) {
    const npc = typeof id === 'string' ? GUILD_NPCS.find(candidate => candidate.id === id) : null;
    if (!npc) return super.goTo(id, targetType);
    if (targetType !== undefined && targetType !== 'npc') {
      this.cancelRoute();
      return;
    }
    const route = findRoute(this.player, { x: npc.x, y: npc.y + 12 }, this.world.creations);
    if (!route.length) {
      this.cancelRoute();
      return;
    }
    this.route = route;
    this.route.shift();
    // Arrival leaves the player beside the NPC. The player must still use
    // the explicit interact control; navigation alone is not a world event.
    this.target = null;
    this.targetType = null;
  }

  nearest(targetId, targetType) {
    const ordinary = super.nearest(targetId, targetType);
    const includeNpcs = targetType === undefined || targetType === 'npc';
    const npcs = includeNpcs ? GUILD_NPCS.filter(npc =>
      targetId === undefined || (typeof targetId === 'string' && npc.id === targetId)
    ).map(npc => ({
      ...npc,
      type: 'npc',
      x: npc.x,
      y: npc.y + 10,
      distance: Math.hypot(npc.x - this.player.x, npc.y + 10 - this.player.y)
    })) : [];
    return [ordinary, ...npcs].filter(Boolean)
      .sort((left, right) => left.distance - right.distance)[0] || null;
  }

  interact(targetId, targetType) {
    const nearest = this.nearest(targetId, targetType);
    if (nearest?.type === 'npc') {
      if (nearest.distance >= 160) return;
      if (targetId !== undefined) this.cancelRoute();
      this.callbacks.onInteract({
        type: 'institution',
        id: nearest.routeLocation,
        npcRoleId: nearest.roleId,
        npcName: nearest.name
      });
      return;
    }
    return super.interact(targetId, targetType);
  }

  setWorld(world, institutionSummary = this.institutionSummary) {
    const previousWorld = this.world;
    super.setWorld(world, institutionSummary);
    if (this.world !== previousWorld) {
      this.sourceObservationMapCounts = projectSourceObservationMapCounts(this.world);
      this.guildNpcReadiness = projectGuildNpcReadiness(this.world);
      this.updateResearchAccessibility();
    }
  }

  updateResearchAccessibility() {
    const counts = this.sourceObservationMapCounts;
    const npcReadiness = Array.isArray(this.guildNpcReadiness)
      ? this.guildNpcReadiness : projectGuildNpcReadiness(this.world);
    this.canvas.dataset.guildNpcPackets = npcReadiness.map(entry =>
      `${entry.roleId}=${entry.status}:${entry.inputCount}:${entry.omittedCount}:${entry.sourceSnapshotStatus}`
    ).join(';');
    this.canvas.dataset.guildNpcLocations = GUILD_NPCS.map(npc =>
      `${npc.roleId}=${npc.routeLocation}`
    ).join(';');
    const npcAccessibility = guildNpcAccessibilityText(npcReadiness);
    if (!counts?.available) {
      this.canvas.dataset.sourceObservationCounts = 'unavailable';
      this.researchAccessibilityLabel =
        'No Gas Labs top-down pixel-art world. Evidence Archive research counts are unavailable; the map does not claim zero activity. ' +
        npcAccessibility;
    } else {
      this.canvas.dataset.sourceObservationCounts =
        `notes=${counts.notes};dissent=${counts.dissent};responses=${counts.responses};pending=${counts.pending};review=${counts.review}`;
      const phrase = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;
      this.researchAccessibilityLabel =
        `No Gas Labs top-down pixel-art world. Evidence Archive: ${phrase(counts.notes, 'linked Source Observation note', 'linked Source Observation notes')}, ${phrase(counts.dissent, 'linked dissent challenge', 'linked dissent challenges')}, ${phrase(counts.responses, 'linked author response', 'linked author responses')}, ${phrase(counts.pending, 'pending author response', 'pending author responses')}, and ${phrase(counts.review, 'retained record requiring review', 'retained records requiring review')}. These are read-only navigation counts; notes, challenges and responses do not establish truth, independent verification, approval or authority.` + ' ' +
        npcAccessibility;
    }
    this.questTarget = projectQuestMapTarget(
      this.questAction, this.world, this.researchObjects, this.researchActivityObjects
    );
    this.updateQuestAccessibility();
  }

  setQuestTarget(action) {
    this.questAction = action && typeof action === 'object' ? action : null;
    this.questTarget = projectQuestMapTarget(
      this.questAction, this.world, this.researchObjects, this.researchActivityObjects
    );
    this.updateQuestAccessibility();
  }

  updateQuestAccessibility() {
    if (!this.questAction) {
      this.canvas.dataset.activeQuestTarget = 'none';
      delete this.canvas.dataset.activeQuestTargetLabel;
      this.canvas.setAttribute('aria-label',
        `${this.researchAccessibilityLabel} No specific map destination is currently available for the next objective.`);
      return;
    }
    if (!this.questTarget) {
      this.canvas.dataset.activeQuestTarget = 'unavailable';
      delete this.canvas.dataset.activeQuestTargetLabel;
      this.canvas.setAttribute('aria-label',
        `${this.researchAccessibilityLabel} The active quest target is unavailable or ambiguous; no substitute destination is inferred.`);
      return;
    }
    this.canvas.dataset.activeQuestTarget = `${this.questTarget.kind}:${this.questTarget.id}`;
    this.canvas.dataset.activeQuestTargetLabel = this.questTarget.label;
    this.canvas.setAttribute('aria-label',
      `${this.researchAccessibilityLabel} Active quest target: ${this.questTarget.label}. The map shows its world location and an edge compass when it is outside the current view. Navigation is read-only and does not record progress or award XP.`);
  }

  sourceObservationMapLine() {
    const counts = this.sourceObservationMapCounts;
    if (!counts?.available) return 'RESEARCH COUNTS UNAVAILABLE';
    return `N${counts.notes} D${counts.dissent} R${counts.responses} P${counts.pending} !${counts.review}`;
  }

  text(value, x, y, size = 13, color = '#29443d', font = 'ui-monospace, monospace') {
    const context = this.ctx;
    context.font = size + 'px ' + font;
    context.fillStyle = color;
    context.textAlign = 'center';
    context.fillText(String(value), x, y);
  }

  drawMapLabel(value, x, y, size = 11) {
    const context = this.ctx;
    const source = String(value);
    const metrics = projectMapLabelMetrics(size, this.zoom, this.width);
    if (!metrics) return;
    context.font = metrics.fontSize + 'px ui-monospace, monospace';
    const characters = Array.from(source);
    const originalLength = characters.length;
    const maxTextWidth = metrics.maxWidth - 2 * metrics.horizontalPadding;
    let label = source;
    while (characters.length > 1 && context.measureText(label).width > maxTextWidth) {
      characters.pop();
      label = characters.join('');
    }
    if (characters.length < originalLength) {
      while (characters.length > 1 &&
          context.measureText(characters.join('') + '…').width > maxTextWidth) characters.pop();
      label = characters.join('') + '…';
    }
    const width = Math.min(metrics.maxWidth, Math.max(metrics.minWidth,
      Math.ceil(context.measureText(label).width) + 2 * metrics.horizontalPadding));
    const height = metrics.fontSize + 2 * metrics.verticalPadding;
    const placement = projectMapLabelPosition(
      x, y, this.width, this.height, this.camera, this.zoom, width * this.zoom, height * this.zoom
    );
    if (!placement) return;
    const drawX = placement.x;
    const drawY = placement.y;
    const left = Math.round(drawX - width / 2);
    const top = Math.round(drawY - metrics.fontSize - metrics.verticalPadding);
    context.fillStyle = '#0c0d0b';
    context.fillRect(left, top, width, height);
    context.strokeStyle = '#e8e6dc';
    context.lineWidth = metrics.lineWidth;
    context.strokeRect(left + metrics.lineWidth / 2, top + metrics.lineWidth / 2,
      width - metrics.lineWidth, height - metrics.lineWidth);
    this.text(label, drawX, drawY, metrics.fontSize, '#f5f1e6');
  }

  drawResearchCounterPanel(x, y) {
    this.drawMapLabel(this.sourceObservationMapLine(), x, y, 10);
  }

  drawLandscape() {
    const context = this.ctx;
    const halfWidth = this.width / (2 * this.zoom);
    const halfHeight = this.height / (2 * this.zoom);
    const firstColumn = Math.max(0, Math.floor((this.camera.x - halfWidth) / WORLD_TILE_SIZE) - 1);
    const lastColumn = Math.min(Math.ceil(WORLD_WIDTH / WORLD_TILE_SIZE),
      Math.ceil((this.camera.x + halfWidth) / WORLD_TILE_SIZE) + 1);
    const firstRow = Math.max(0, Math.floor((this.camera.y - halfHeight) / WORLD_TILE_SIZE) - 1);
    const lastRow = Math.min(Math.ceil(WORLD_HEIGHT / WORLD_TILE_SIZE),
      Math.ceil((this.camera.y + halfHeight) / WORLD_TILE_SIZE) + 1);

    for (let row = firstRow; row < lastRow; row++) {
      for (let column = firstColumn; column < lastColumn; column++) {
        drawTile(context, worldTileAt(column, row));
      }
    }

    for (const item of DECORATIONS) {
      if (item.type === 'rock') {
        drawSprite(context, PIXEL_SPRITES.rock, SPRITE_COLORS.rock, item.x, item.y, 4);
      } else {
        drawSprite(context, PIXEL_SPRITES.tree, SPRITE_COLORS.tree, item.x, item.y, 4);
      }
    }

    this.text('COMMON GROUND', 460, 100, 20, '#e8e6dc');
    this.text('A WALKABLE INSTITUTION', 460, 120, 9, '#d4d8c2');
    this.text('N', 1490, 80, 10, '#e8e6dc');
    context.fillStyle = '#e8e6dc';
    context.fillRect(1487, 88, 6, 20);
    context.fillRect(1480, 94, 20, 6);
  }

  drawTownSquare() {
    const context = this.ctx;
    const stalls = [
      { x: 995, color: '#a95d43' },
      { x: 1040, color: '#6f855e' },
      { x: 1085, color: '#496c68' }
    ];
    for (const stall of stalls) {
      context.fillStyle = '#26382e66';
      context.fillRect(stall.x - 19, 448, 38, 8);
      context.fillStyle = '#354638';
      context.fillRect(stall.x - 18, 414, 36, 34);
      context.fillStyle = stall.color;
      context.fillRect(stall.x - 20, 410, 40, 9);
      context.fillStyle = '#d8d1ad';
      context.fillRect(stall.x - 14, 424, 28, 3);
    }
    this.drawMapLabel('TOWNSQUARE', 1040, 478, 12);
    this.drawMapLabel((this.institutionCounts['town-square'] || 0) + ' retained records', 1040, 508, 10);
    this.drawResearchCounterPanel(1040, 538);
  }

  drawInstitution(place) {
    if (place.id === 'town-square') {
      this.drawTownSquare();
      return;
    }
    const roofColors = {
      guild_hall: '#506f54',
      forge: '#a45e3d',
      evidence_archive: '#6f825e',
      decision_chamber: '#3e5b50',
      academy: '#84916d',
      moonshot_field: '#526d60',
      publication_house: '#a85f42'
    };
    const roof = roofColors[place.id] || '#536d53';
    drawInstitutionBuilding(this.ctx, place, roof, '#c6c7a5', '#344638');
    this.text(place.glyph || 'I', place.x, place.y - 28, 13, '#e8e6dc');
    this.drawMapLabel(place.name.toUpperCase(), place.x, place.y + 38, 11);
    this.drawMapLabel((this.institutionCounts[place.id] || 0) + ' records', place.x, place.y + 68, 10);
    if (place.id === 'evidence_archive') {
      this.drawResearchCounterPanel(place.x, place.y + 98);
    }
  }

  drawPlace(place) {
    const context = this.ctx;
    const { x, y, id } = place;
    context.fillStyle = '#26382e55';
    context.fillRect(x - 25, y + 20, 50, 7);

    if (id === 'relay') {
      context.fillStyle = '#69553b';
      context.fillRect(x - 3, y - 60, 6, 82);
      context.fillRect(x - 28, y - 48, 30, 6);
      context.fillStyle = '#b65f40';
      context.fillRect(x + 2, y - 58, 24, 15);
      context.fillStyle = '#e8e6dc';
      context.fillRect(x + 4, y - 55, 17, 2);
      context.fillRect(x + 4, y - 50, 12, 2);
    } else if (id === 'river') {
      context.fillStyle = '#3d5140';
      context.fillRect(x - 23, y - 42, 46, 40);
      context.fillStyle = '#c7bc91';
      context.fillRect(x - 19, y - 38, 38, 31);
      context.fillStyle = '#a75d40';
      context.fillRect(x - 23, y - 45, 46, 7);
      context.fillStyle = '#5b7357';
      context.fillRect(x - 12, y - 29, 24, 3);
      context.fillRect(x - 12, y - 21, 18, 3);
    } else if (id === 'overlook') {
      context.fillStyle = '#4c5e4c';
      context.fillRect(x - 28, y - 32, 56, 34);
      context.fillStyle = '#9e956f';
      context.fillRect(x - 23, y - 27, 46, 24);
      context.fillStyle = '#5e6f55';
      context.fillRect(x - 4, y - 58, 8, 30);
      context.fillRect(x - 20, y - 58, 40, 7);
      context.fillStyle = '#c3c79f';
      context.fillRect(x - 17, y - 48, 34, 4);
    } else {
      for (const offset of [-24, 0, 24]) {
        context.fillStyle = '#586452';
        context.fillRect(x + offset - 7, y - 35, 14, 45);
        context.fillStyle = '#a8aa91';
        context.fillRect(x + offset - 5, y - 31, 10, 37);
        context.fillStyle = '#65715c';
        context.fillRect(x + offset - 9, y + 5, 18, 5);
      }
    }
    this.drawMapLabel(place.name.toUpperCase(), x, y + 43, 11);
  }

  drawWorkbench() {
    const context = this.ctx;
    const x = 325, y = 645;
    context.fillStyle = '#29392e';
    context.fillRect(x - 34, y - 15, 68, 24);
    context.fillStyle = '#b79a68';
    context.fillRect(x - 37, y - 20, 74, 8);
    context.fillStyle = '#66513a';
    context.fillRect(x - 28, y + 4, 7, 22);
    context.fillRect(x + 21, y + 4, 7, 22);
    context.fillStyle = '#e8e6dc';
    context.fillRect(x - 13, y - 17, 20, 12);
    context.fillStyle = '#a95f3e';
    context.fillRect(x + 18, y - 28, 5, 18);
    context.fillRect(x + 13, y - 28, 15, 5);
    this.drawMapLabel('THE MAKING BENCH', x, y + 48, 11);
  }

  drawBuilding(creation) {
    if (!creation?.position || !Number.isFinite(creation.position.x) || !Number.isFinite(creation.position.y)) return;
    const colors = {
      comic: '#a85b43',
      loom: '#496f65',
      observatory: '#7a865c',
      custom: '#66746b'
    };
    const x = creation.position.x, y = creation.position.y;
    drawPixelBuilding(this.ctx, x, y + 8, colors[creation.kind] || '#596d5a', '#c9c7a5', '#354538');
    const title = Array.from(String(creation.title || 'Untitled'));
    this.drawMapLabel(title.length > 20 ? title.slice(0, 19).join('') + '…' : title.join(''), x, y + 46, 10);
    this.drawMapLabel(String(creation.kind || 'artifact').toUpperCase() + ' · v' + creation.version, x, y + 74, 9);
  }

  drawMoonshotObject(object) {
    drawSprite(this.ctx, PIXEL_SPRITES.moonshot, SPRITE_COLORS.moonshot, object.x, object.y + 12, 4);
    this.drawMapLabel(String(object.title || 'MOONSHOT').slice(0, 16), object.x, object.y + 34, 10);
    this.drawMapLabel('R' + object.attemptCount + ' · C' + object.challengeCount, object.x, object.y + 62, 9);
  }

  drawResearchActivityObject(object) {
    const challenge = object.recordType === 'experiment-challenged';
    const sprite = challenge ? PIXEL_SPRITES.challenge : PIXEL_SPRITES.moonshot;
    const colors = challenge ? SPRITE_COLORS.challenge : SPRITE_COLORS.moonshot;
    drawSprite(this.ctx, sprite, colors, object.x, object.y + 8, 3);
    this.drawMapLabel(String(object.title || 'RESEARCH').slice(0, 14), object.x, object.y + 30, 10);
  }

  drawPlayer(player, other = false) {
    const bob = !this.reduced && this.moving && !other ? Math.round(Math.sin(this.time * 16)) : 0;
    const sprite = other ? PIXEL_SPRITES.visitor : PIXEL_SPRITES.founder;
    const colors = other ? SPRITE_COLORS.visitor : SPRITE_COLORS.founder;
    drawSprite(this.ctx, sprite, colors, player.x, player.y + bob, 4);
    if (!other) this.text('YOU', player.x, player.y + 25, 8, '#e8e6dc');
    else if (player.name) this.text(String(player.name).slice(0, 24), player.x, player.y + 25, 8, '#e8e6dc');
  }

  drawGuildNpc(npc) {
    const colors = GUILD_NPC_COLORS[npc.roleId];
    const sprite = PIXEL_SPRITES[npc.roleId];
    if (!colors || !sprite) return;
    const context = this.ctx;
    context.fillStyle = '#26382e66';
    context.fillRect(npc.x - 12, npc.y + 2, 24, 5);
    drawSprite(context, sprite, colors, npc.x, npc.y, 4);
    this.text(npc.sigil, npc.x, npc.y - 13, 9, '#e8e6dc', 'system-ui');
    this.drawMapLabel(npc.shortName, npc.x, npc.y + 22, 9);
    const readiness = this.guildNpcReadiness?.find(entry => entry.roleId === npc.roleId);
    this.drawMapLabel(readiness?.label ?? 'NO PACKET', npc.x, npc.y + 36, 8);
  }

  drawQuestTarget() {
    const target = this.questTarget;
    if (!target) return;
    const label = Array.from(target.label).slice(0, 18).join('');
    this.drawMapLabel('NEXT QUEST · ' + label, target.x, target.y - 68, 11);
    const context = this.ctx;
    context.fillStyle = '#c77b48';
    context.fillRect(target.x - 2, target.y - 60, 4, 40);
    context.strokeStyle = '#e8e6dc';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(target.x, target.y - 3, 17, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = '#c77b48';
    context.fillRect(target.x - 5, target.y - 8, 10, 10);
  }

  drawQuestCompass() {
    const indicator = projectQuestCompassIndicator(
      this.questTarget, this.camera, this.width, this.height, this.zoom
    );
    this.canvas.dataset.questCompass = indicator ? 'offscreen' : this.questTarget ? 'onscreen' : 'none';
    if (!indicator) return;
    const context = this.ctx;
    context.save();
    context.translate(indicator.x, indicator.y);
    context.rotate(indicator.angle);
    context.fillStyle = '#0c0d0b';
    context.strokeStyle = '#e8e6dc';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(14, 0);
    context.lineTo(-8, -9);
    context.lineTo(-3, 0);
    context.lineTo(-8, 9);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();

    const caption = 'NEXT · ' + Array.from(indicator.label).slice(0, 14).join('');
    context.save();
    context.font = '11px ui-monospace, monospace';
    const width = Math.min(this.width - 16, Math.max(92, Math.ceil(context.measureText(caption).width) + 18));
    const left = Math.max(8, Math.min(this.width - width - 8, indicator.x - width / 2));
    const top = Math.max(8, Math.min(this.height - 30,
      indicator.y < this.height / 2 ? indicator.y + 18 : indicator.y - 34));
    context.fillStyle = '#0c0d0b';
    context.fillRect(left, top, width, 24);
    context.strokeStyle = '#e8e6dc';
    context.lineWidth = 1.5;
    context.strokeRect(left + 0.75, top + 0.75, width - 1.5, 22.5);
    context.fillStyle = '#f5f1e6';
    context.textAlign = 'center';
    context.fillText(caption, left + width / 2, top + 16);
    context.restore();
  }

  render() {
    const context = this.ctx;
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    context.imageSmoothingEnabled = false;
    context.save();
    context.translate(this.width / 2 - this.camera.x * this.zoom,
      this.height / 2 - this.camera.y * this.zoom);
    context.scale(this.zoom, this.zoom);

    this.drawLandscape();
    if (this.route.length) {
      context.fillStyle = '#c77b48';
      for (const point of this.route) context.fillRect(point.x - 3, point.y - 3, 6, 6);
    }

    const objects = [
      ...PLACES.filter(place => place.type === 'discovery').map(place => ({
        y: place.y, draw: () => this.drawPlace(place)
      })),
      ...PLACES.filter(place => place.type === 'institution').map(place => ({
        y: place.y, draw: () => this.drawInstitution(place)
      })),
      { y: 645, draw: () => this.drawWorkbench() },
      ...(this.world.creations || []).map(creation => ({
        y: creation?.position?.y ?? 0, draw: () => this.drawBuilding(creation)
      })),
      ...this.researchObjects.map(object => ({
        y: object.y, draw: () => this.drawMoonshotObject(object)
      })),
      ...this.researchActivityObjects.filter(object => object.mapVisible).map(object => ({
        y: object.y, draw: () => this.drawResearchActivityObject(object)
      })),
      ...GUILD_NPCS.map(npc => ({
        y: npc.y, draw: () => this.drawGuildNpc(npc)
      })),
      ...this.presence.filter(player => player.id !== this.player.id &&
        Number.isFinite(player.x) && Number.isFinite(player.y)).map(player => ({
          y: player.y, draw: () => this.drawPlayer(player, true)
        })),
      { y: this.player.y, draw: () => this.drawPlayer(this.player) }
    ];
    objects.sort((left, right) => left.y - right.y).forEach(object => object.draw());
    this.drawQuestTarget();

    const near = this.nearest();
    const modalOpen = document.body.classList.contains('modal-open');
    const promptRange = near?.type === 'npc' ? 160 : 145;
    const promptVisible = !!near && near.distance < promptRange && !modalOpen;
    const nearbyNpc = promptVisible && near?.type === 'npc' ? near : null;
    this.canvas.dataset.nearbyNpcRole = nearbyNpc?.roleId ?? 'none';
    this.canvas.dataset.nearbyNpcPacketState = nearbyNpc
      ? this.guildNpcReadiness?.find(entry => entry.roleId === nearbyNpc.roleId)?.status ?? 'unavailable'
      : 'none';
    if (nearbyNpc) {
      this.canvas.setAttribute('aria-description',
        `Nearby collaborator ${nearbyNpc.name} at ${nearbyNpc.locationLabel}. Tap the character to talk; when farther away, tapping routes you to it and a second tap opens its owning institution. Keyboard users can press E or Space. This NPC is advisory only and cannot create canonical state, evidence, progress, approval, or authority.`);
    } else {
      this.canvas.removeAttribute('aria-description');
    }
    if (promptVisible) {
      const label = near?.type === 'npc'
        ? (this.width < 600 ? 'TAP · TALK · ' : 'E · TALK · ') + near.shortName
        : near.type === 'workbench' ? 'E · Make something'
        : near.type === 'creation' ? 'E · Enter creation'
        : near.type === 'research-activity' ? 'E · Inspect research record'
        : near.type === 'research-object' ? 'E · Inspect moonshot'
        : 'E · Discover';
      const x = this.player.x, y = this.player.y - 70;
      context.font = '11px ui-monospace, monospace';
      const width = context.measureText(label).width + 18;
      context.fillStyle = '#e8e6dfee';
      context.fillRect(x - width / 2, y - 12, width, 22);
      context.fillStyle = '#293c30';
      context.fillRect(x - width / 2, y - 12, width, 2);
      this.text(label, x, y + 3, 10, '#293c30');
    }
    context.restore();
    this.drawQuestCompass();
  }
}
