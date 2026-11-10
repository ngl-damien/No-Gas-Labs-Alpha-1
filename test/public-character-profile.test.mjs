import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyAction } from '../game/model.mjs';
import { projectCharacter, projectPublicCharacterProfile } from '../game/character-sheet.mjs';

const founder = { id: 'founder-1', role: 'founder' };
const witness = { id: 'witness-1', role: 'witness' };

test('public character profile is an immutable actor-scoped allowlist', async () => {
  const initial = createWorld({
    id: 'public-character-profile-world',
    founderName: 'Test Founder',
    now: '2026-11-10T00:00:00.000Z'
  });
  const first = await applyAction(
    initial,
    { type: 'discover', locationId: 'relay' },
    founder,
    { now: '2026-11-10T00:01:00.000Z' }
  );
  const repeated = await applyAction(
    first.world,
    { type: 'discover', locationId: 'relay' },
    founder,
    { now: '2026-11-10T00:02:00.000Z' }
  );
  const world = repeated.world;
  const beforeProjection = JSON.stringify(world);
  const character = projectCharacter(world, founder);
  const profile = projectPublicCharacterProfile(world, founder);
  const otherActorProfile = projectPublicCharacterProfile(world, witness);

  assert.equal(profile.schema, 'ngl.public-character-profile.v1');
  assert.equal(profile.level, character.level);
  assert.equal(profile.characterXp, character.xp);
  assert.equal(profile.xpIntoLevel, character.xpIntoLevel);
  assert.equal(profile.xpPerLevel, character.xpPerLevel);
  assert.deepEqual(
    profile.skills,
    character.skills
      .filter(skill => Number.isSafeInteger(skill.count) && skill.count > 0)
      .map(skill => ({
        id: skill.id,
        label: skill.label,
        count: skill.count,
        record: skill.record,
        basis: skill.basis
      }))
  );
  assert.deepEqual(profile.equipment, []);
  assert.equal(profile.skills.find(skill => skill.id === 'explorer')?.count, 1);
  assert.equal(otherActorProfile.skills.length, 0);
  assert.equal(profile.characterXp, 0);
  assert.equal(world.xp, 0);

  assert.deepEqual(Object.keys(profile).sort(), [
    'schema',
    'level',
    'characterXp',
    'xpIntoLevel',
    'xpPerLevel',
    'skills',
    'equipment'
  ].sort());
  for (const privateField of [
    'worldXp',
    'inventory',
    'fieldInventory',
    'fieldSatchel',
    'recentActivity',
    'fieldItemTransferOffers'
  ]) {
    assert.equal(Object.hasOwn(profile, privateField), false, privateField);
  }

  assert.ok(Object.isFrozen(profile));
  assert.ok(Object.isFrozen(profile.skills));
  assert.ok(Object.isFrozen(profile.equipment));
  assert.ok(profile.skills.every(Object.isFrozen));
  assert.ok(profile.equipment.every(Object.isFrozen));
  assert.equal(JSON.stringify(world), beforeProjection, 'projecting a public profile must not mutate canonical world state');
});
