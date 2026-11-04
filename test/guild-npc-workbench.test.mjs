import test from 'node:test';
import assert from 'node:assert/strict';
import { GUILD_NPCS } from '../game/pixel-world-view.mjs';
import { focusGuildCollaborator, resolveGuildNpcWorkbench } from '../game/guild-npc-workbench.mjs';

test('each registered Guild NPC resolves only to its exact owning institution', () => {
  assert.equal(GUILD_NPCS.length, 4);
  for (const npc of GUILD_NPCS) {
    assert.deepEqual(resolveGuildNpcWorkbench({
      id: npc.routeLocation,
      npcRoleId: npc.roleId
    }), {
      npcId: npc.id,
      roleId: npc.roleId,
      institutionId: npc.routeLocation,
      name: npc.name
    });
  }
  assert.equal(resolveGuildNpcWorkbench({ id: 'guild_hall', npcRoleId: 'archivist' }), null);
  assert.equal(resolveGuildNpcWorkbench({ id: 'evidence_archive', npcRoleId: 'tutor' }), null);
  assert.equal(resolveGuildNpcWorkbench({ id: 'evidence_archive', npcRoleId: 'unregistered' }), null);
  assert.equal(resolveGuildNpcWorkbench({ id: 'evidence_archive' }), null);
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
