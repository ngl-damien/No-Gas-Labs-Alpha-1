import test from 'node:test';
import assert from 'node:assert/strict';
import { GUILD_NPCS, LOCAL_NPCS, WORLD_NPCS } from '../game/pixel-world-view.mjs';
import { COLLABORATOR_ROLES } from '../game/collaborator-contracts.mjs';
import {
  focusGuildCollaborator,
  focusLocalNpcWorkbench,
  resolveGuildNpcWorkbench
} from '../game/guild-npc-workbench.mjs';

test('collaborator NPCs resolve only to their exact owning institutions', () => {
  assert.equal(GUILD_NPCS.length, 4);
  assert.deepEqual(GUILD_NPCS.map(npc => npc.roleId), COLLABORATOR_ROLES.map(role => role.id));
  assert.equal(LOCAL_NPCS.length, 2);
  assert.equal(WORLD_NPCS.length, GUILD_NPCS.length + LOCAL_NPCS.length);
  for (const npc of GUILD_NPCS) {
    assert.deepEqual(resolveGuildNpcWorkbench({
      id: npc.routeLocation,
      npcRoleId: npc.roleId
    }), {
      npcId: npc.id,
      roleId: npc.roleId,
      institutionId: npc.routeLocation,
      name: npc.name,
      npcKind: 'collaborator'
    });
  }
  assert.equal(resolveGuildNpcWorkbench({ id: 'guild_hall', npcRoleId: 'archivist' }), null);
  assert.equal(resolveGuildNpcWorkbench({ id: 'evidence_archive', npcRoleId: 'tutor' }), null);
  assert.equal(resolveGuildNpcWorkbench({ id: 'evidence_archive', npcRoleId: 'unregistered' }), null);
  assert.equal(resolveGuildNpcWorkbench({ id: 'evidence_archive' }), null);
});

test('the Contradiction Clerk resolves as a fixed local Guild Hall adversary, never a collaborator packet', () => {
  const clerk = LOCAL_NPCS.find(npc => npc.roleId === 'contradiction-clerk');
  assert.ok(clerk);
  assert.deepEqual(resolveGuildNpcWorkbench({
    id: 'guild_hall',
    npcRoleId: 'contradiction-clerk'
  }), {
    npcId: clerk.id,
    roleId: clerk.roleId,
    institutionId: 'guild_hall',
    name: 'The Contradiction Clerk',
    npcKind: 'fixed-local'
  });
  assert.equal(resolveGuildNpcWorkbench({
    id: 'evidence_archive',
    npcRoleId: 'contradiction-clerk'
  }), null);
  assert.equal(resolveGuildNpcWorkbench({
    id: 'guild_hall',
    npcRoleId: 'archivist'
  }), null);
});

test('NPC route resolution does not invoke caller-supplied accessors', () => {
  let reads = 0;
  const hostile = Object.defineProperties({}, {
    id: { enumerable: true, get() { reads += 1; return 'evidence_archive'; } },
    npcRoleId: { enumerable: true, get() { reads += 1; return 'archivist'; } }
  });
  assert.equal(resolveGuildNpcWorkbench(hostile), null);
  assert.equal(reads, 0);
});

test('role focus scrolls to and focuses only the matching collaborator card', () => {
  const calls = [];
  const card = {
    dataset: { collaboratorRole: 'tutor' },
    scrollIntoView(options) { calls.push(['scroll', options]); },
    focus(options) { calls.push(['focus', options]); }
  };
  const root = {
    querySelectorAll(selector) {
      assert.equal(selector, '[data-collaborator-role]');
      return [card];
    }
  };
  assert.equal(focusGuildCollaborator(root, 'tutor'), true);
  assert.deepEqual(calls, [
    ['scroll', { block: 'center' }],
    ['focus', { preventScroll: true }]
  ]);
  assert.equal(focusGuildCollaborator(root, 'archivist'), false);
  assert.equal(focusGuildCollaborator(root, 'unknown'), false);
});

test('local NPC focus scrolls to and focuses only the matching fixed-protocol card', () => {
  const calls = [];
  const card = {
    dataset: { localNpcRole: 'contradiction-clerk' },
    scrollIntoView(options) { calls.push(['scroll', options]); },
    focus(options) { calls.push(['focus', options]); }
  };
  const root = {
    querySelectorAll(selector) {
      assert.equal(selector, '[data-local-npc-role]');
      return [card];
    }
  };
  assert.equal(focusLocalNpcWorkbench(root, 'contradiction-clerk'), true);
  assert.deepEqual(calls, [
    ['scroll', { block: 'center' }],
    ['focus', { preventScroll: true }]
  ]);
  assert.equal(focusLocalNpcWorkbench(root, 'tutor'), false);
  assert.equal(focusLocalNpcWorkbench(root, 'unknown'), false);
});

test('role focus fails closed when the card query or focus operation is unavailable', () => {
  assert.equal(focusGuildCollaborator(null, 'tutor'), false);
  assert.equal(focusGuildCollaborator({ querySelectorAll() { throw new Error('blocked'); } }, 'tutor'), false);
  const root = {
    querySelectorAll() {
      return [{
        dataset: { collaboratorRole: 'tutor' },
        scrollIntoView() {},
        focus() { throw new Error('not focusable'); }
      }];
    }
  };
  assert.equal(focusGuildCollaborator(root, 'tutor'), false);
});

test('local NPC focus fails closed when the card query or focus operation is unavailable', () => {
  assert.equal(focusLocalNpcWorkbench(null, 'contradiction-clerk'), false);
  assert.equal(focusLocalNpcWorkbench({ querySelectorAll() { throw new Error('blocked'); } }, 'contradiction-clerk'), false);
  const root = {
    querySelectorAll() {
      return [{
        dataset: { localNpcRole: 'contradiction-clerk' },
        scrollIntoView() {},
        focus() { throw new Error('not focusable'); }
      }];
    }
  };
  assert.equal(focusLocalNpcWorkbench(root, 'contradiction-clerk'), false);
});
