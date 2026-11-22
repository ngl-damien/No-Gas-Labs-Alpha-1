import { publicWorld } from './model.mjs';

export const SHARED_SNAPSHOT_CACHE_KEY = 'ngl.common-ground.shared-snapshot.v1';
export const SHARED_POSITION_CACHE_KEY = 'ngl.common-ground.shared-position.v1';
export const SHARED_SNAPSHOT_CACHE_SCHEMA = 'ngl.shared-public-snapshot.v1';
export const SHARED_POSITION_CACHE_SCHEMA = 'ngl.shared-accepted-position.v2';
export const MAX_SHARED_SNAPSHOT_CACHE_BYTES = 2 * 1024 * 1024;
const MAX_SHARED_POSITION_CACHE_BYTES = 1024;

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}
function validPosition(position) {
  return isRecord(position) &&
    Number.isFinite(position.x) && position.x >= 0 && position.x <= 1600 &&
    Number.isFinite(position.y) && position.y >= 0 && position.y <= 1000;
}
function validViewer(viewer) {
  return isRecord(viewer) &&
    typeof viewer.id === 'string' && viewer.id.length > 0 && viewer.id.length <= 128 &&
    typeof viewer.name === 'string' && viewer.name.length > 0 && viewer.name.length <= 80 &&
    ['founder', 'witness'].includes(viewer.role) &&
    validPosition(viewer.position);
}
function validWorldProjection(world) {
  if (!isRecord(world) || world.schema !== 'ngl.world.v2' ||
      typeof world.id !== 'string' || typeof world.founderName !== 'string' ||
      !Number.isSafeInteger(world.revision) || world.revision < 0 ||
      !Number.isSafeInteger(world.xp) || world.xp < 0 ||
      typeof world.createdAt !== 'string' || typeof world.updatedAt !== 'string') return false;
  for (const key of ['creations', 'drafts', 'events', 'contributions', 'reports', 'discoveries', 'methods']) {
    if (!Array.isArray(world[key])) return false;
  }
  if (world.creations.length > 12 || world.drafts.length !== 0 ||
      world.events.length > world.revision || world.events.length > 100000) return false;
  let previousPosition = 0;
  for (const event of world.events) {
    if (!isRecord(event) || ['draft', 'repair', 'message-reported'].includes(event.type) ||
        !Number.isSafeInteger(event.historyPosition) ||
        event.historyPosition <= previousPosition || event.historyPosition > world.revision) return false;
    previousPosition = event.historyPosition;
  }
  return true;
}
function validWorldRevisionIdentity(world) {
  return isRecord(world) &&
    typeof world.id === 'string' && world.id.length > 0 && world.id.length <= 128 &&
    Number.isSafeInteger(world.revision) && world.revision >= 0;
}

/**
 * Shared world revisions are ordered within a world, not within a viewer session.
 * A delayed HTTP, action, or SSE DTO must not roll the live projection backward
 * after another actor's newer snapshot has already been accepted.
 */
export function isNonRegressingSharedWorldSnapshot(currentWorld, incomingWorld) {
  if (!validWorldRevisionIdentity(incomingWorld)) return false;
  if (currentWorld === null || currentWorld === undefined) return true;
  if (!validWorldRevisionIdentity(currentWorld)) return false;
  return currentWorld.id !== incomingWorld.id ||
    incomingWorld.revision >= currentWorld.revision;
}
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createSharedSnapshotEnvelope(dto, { now = Date.now() } = {}) {
  if (!Number.isSafeInteger(now) || now < 0 ||
      !isRecord(dto) || !isRecord(dto.world) || !validViewer(dto.viewer)) return null;
  const sourceWorld = dto.world;
  if (!Number.isSafeInteger(sourceWorld.revision) || sourceWorld.revision < 0 ||
      !Array.isArray(sourceWorld.events) || sourceWorld.events.length > sourceWorld.revision) return null;
  let projection;
  try {
    // Founder DTOs contain founder-only draft/report detail. Redact them with the
    // same public-world projection used for Witness reads. Witness DTOs are
    // already redacted by the server; clone them without renumbering history gaps.
    projection = dto.viewer.role === 'founder'
      ? publicWorld(sourceWorld, { id: 'ngl-offline-public-snapshot', role: 'witness' })
      : cloneJson(sourceWorld);
    projection.drafts = [];
    projection.events = projection.events.filter(event =>
      event && !['draft', 'repair', 'message-reported'].includes(event.type)
    );
  } catch {
    return null;
  }
  if (!validWorldProjection(projection)) return null;
  const envelope = {
    schema: SHARED_SNAPSHOT_CACHE_SCHEMA,
    scope: 'public-witness-projection',
    cachedAt: now,
    world: projection,
    viewer: {
      id: dto.viewer.id,
      name: dto.viewer.name,
      role: dto.viewer.role,
      position: { x: dto.viewer.position.x, y: dto.viewer.position.y }
    }
  };
  let raw;
  try { raw = JSON.stringify(envelope); } catch { return null; }
  if (byteLength(raw) > MAX_SHARED_SNAPSHOT_CACHE_BYTES) return null;
  return envelope;
}

export function parseSharedSnapshotEnvelope(raw) {
  if (typeof raw !== 'string' || byteLength(raw) > MAX_SHARED_SNAPSHOT_CACHE_BYTES) return null;
  let envelope;
  try { envelope = JSON.parse(raw); } catch { return null; }
  if (!isRecord(envelope) ||
      Object.keys(envelope).sort().join(',') !== 'cachedAt,schema,scope,viewer,world' ||
      envelope.schema !== SHARED_SNAPSHOT_CACHE_SCHEMA ||
      envelope.scope !== 'public-witness-projection' ||
      !Number.isSafeInteger(envelope.cachedAt) || envelope.cachedAt < 0 ||
      !validViewer(envelope.viewer) || Object.keys(envelope.viewer).sort().join(',') !== 'id,name,position,role' ||
      Object.keys(envelope.viewer.position || {}).sort().join(',') !== 'x,y' ||
      !validWorldProjection(envelope.world)) return null;
  return envelope;
}

export function readSharedSnapshotCache(storage) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return null;
    return parseSharedSnapshotEnvelope(storage.getItem(SHARED_SNAPSHOT_CACHE_KEY));
  } catch {
    return null;
  }
}

export function writeSharedSnapshotCache(storage, dto, { now = Date.now() } = {}) {
  const envelope = createSharedSnapshotEnvelope(dto, { now });
  if (!envelope) return { stored: false, reason: 'invalid-or-oversized' };
  try {
    if (!storage || typeof storage.setItem !== 'function') {
      return { stored: false, reason: 'storage-unavailable' };
    }
    const existing = readSharedSnapshotCache(storage);
    if (existing &&
        existing.world.id === envelope.world.id &&
        existing.world.revision > envelope.world.revision) {
      return {
        stored: false,
        reason: 'newer-cache-preserved',
        revision: existing.world.revision,
        viewerId: existing.viewer.id,
        viewerRole: existing.viewer.role
      };
    }
    storage.setItem(SHARED_SNAPSHOT_CACHE_KEY, JSON.stringify(envelope));
    return {
      stored: true,
      revision: envelope.world.revision,
      viewerId: envelope.viewer.id,
      viewerRole: envelope.viewer.role
    };
  } catch {
    return { stored: false, reason: 'storage-unavailable' };
  }
}

export function writeSharedPositionCache(storage, viewer, worldId, worldRevision, position, { now = Date.now() } = {}) {
  if (!Number.isSafeInteger(now) || now < 0 ||
      !isRecord(viewer) || typeof viewer.id !== 'string' || !viewer.id ||
      !['founder', 'witness'].includes(viewer.role) ||
      typeof worldId !== 'string' || worldId.length === 0 || worldId.length > 128 ||
      !Number.isSafeInteger(worldRevision) || worldRevision < 0 ||
      !validPosition(position)) return false;
  const envelope = {
    schema: SHARED_POSITION_CACHE_SCHEMA,
    cachedAt: now,
    actorId: viewer.id,
    actorRole: viewer.role,
    worldId,
    worldRevision,
    position: { x: position.x, y: position.y }
  };
  try {
    const raw = JSON.stringify(envelope);
    if (byteLength(raw) > MAX_SHARED_POSITION_CACHE_BYTES ||
        !storage || typeof storage.setItem !== 'function') return false;
    storage.setItem(SHARED_POSITION_CACHE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

export function readSharedPositionCache(storage, snapshot) {
  if (!snapshot?.viewer || !snapshot?.world) return null;
  try {
    const raw = storage?.getItem?.(SHARED_POSITION_CACHE_KEY);
    if (typeof raw !== 'string' || byteLength(raw) > MAX_SHARED_POSITION_CACHE_BYTES) return null;
    const envelope = JSON.parse(raw);
    if (!isRecord(envelope) ||
        Object.keys(envelope).sort().join(',') !== 'actorId,actorRole,cachedAt,position,schema,worldId,worldRevision' ||
        envelope.schema !== SHARED_POSITION_CACHE_SCHEMA ||
        !Number.isSafeInteger(envelope.cachedAt) || envelope.cachedAt < 0 ||
        envelope.actorId !== snapshot.viewer.id ||
        envelope.actorRole !== snapshot.viewer.role ||
        envelope.worldId !== snapshot.world.id ||
        envelope.worldRevision !== snapshot.world.revision ||
        !isRecord(envelope.position) ||
        Object.keys(envelope.position).sort().join(',') !== 'x,y' ||
        !validPosition(envelope.position)) return null;
    return { x: envelope.position.x, y: envelope.position.y };
  } catch {
    return null;
  }
}


/**
 * Tracks whether the in-memory world has actually been accepted from the
 * shared server or from the read-only public shared-snapshot cache.
 *
 * A private import can preserve the same world ID and locally advance its
 * revision. That local revision is not evidence that the client has ever
 * accepted a shared snapshot, so it must not participate in the first-join
 * monotonicity comparison.
 */
export function createSharedSnapshotAcceptanceGuard() {
  let accepted = false;
  return {
    get hasAcceptedSnapshot() {
      return accepted;
    },
    accept(currentWorld, incomingWorld) {
      const allowed = isNonRegressingSharedWorldSnapshot(
        accepted ? currentWorld : null,
        incomingWorld
      );
      if (allowed) accepted = true;
      return allowed;
    },
    reset() {
      accepted = false;
    }
  };
}
