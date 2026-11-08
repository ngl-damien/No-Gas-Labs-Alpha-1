import { LOCAL_NPCS, WORLD_NPCS } from './pixel-world-view.mjs';

function ownDataValue(object, key) {
  if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a world NPC interaction to its exact owning institution.
 * Caller-supplied role labels are never trusted without matching the fixed world catalogue.
 */
export function resolveGuildNpcWorkbench(interaction) {
  const roleId = ownDataValue(interaction, 'npcRoleId');
  const institutionId = ownDataValue(interaction, 'id');
  if (typeof roleId !== 'string' || typeof institutionId !== 'string') return null;
  const matches = WORLD_NPCS.filter(npc => npc.roleId === roleId);
  if (matches.length !== 1 || matches[0].routeLocation !== institutionId) return null;
  const npc = matches[0];
  return Object.freeze({
    npcId: npc.id,
    roleId: npc.roleId,
    institutionId: npc.routeLocation,
    name: npc.name,
    npcKind: npc.npcKind
  });
}

/**
 * Focus one exact role card after its owning institution has rendered it.
 * This is navigation only: it does not invoke a collaborator or mutate the world.
 */
export function focusGuildCollaborator(root, roleId) {
  if (typeof roleId !== 'string' || !GUILD_NPCS.some(npc => npc.roleId === roleId)) return false;
  let cards;
  try {
    cards = root?.querySelectorAll?.('[data-collaborator-role]');
  } catch {
    return false;
  }
  if (!cards) return false;
  let card = null;
  try {
    for (const candidate of cards) {
      if (candidate?.dataset?.collaboratorRole === roleId) {
        card = candidate;
        break;
      }
    }
  } catch {
    return false;
  }
  if (!card || typeof card.focus !== 'function') return false;
  try {
    if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'center' });
    card.focus({ preventScroll: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Focus a fixed local protocol NPC card after its owning institution has rendered.
 * This is navigation only; it does not invoke the protocol or append a report.
 */
export function focusLocalNpcWorkbench(root, roleId) {
  if (typeof roleId !== 'string' || !LOCAL_NPCS.some(npc => npc.roleId === roleId)) return false;
  let cards;
  try {
    cards = root?.querySelectorAll?.('[data-local-npc-role]');
  } catch {
    return false;
  }
  if (!cards) return false;
  let card = null;
  try {
    for (const candidate of cards) {
      if (candidate?.dataset?.localNpcRole === roleId) {
        card = candidate;
        break;
      }
    }
  } catch {
    return false;
  }
  if (!card || typeof card.focus !== 'function') return false;
  try {
    if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'center' });
    card.focus({ preventScroll: true });
    return true;
  } catch {
    return false;
  }
}
