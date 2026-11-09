import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMBAT_MAX_TURNS,
  COMBAT_OPPONENTS,
  COMBAT_PLAYER_MAX_HP,
  createCombatEncounter,
  projectCombatHistory,
  resolveCombatMove
} from '../game/combat.mjs';

const founder = Object.freeze({ id: 'damien', role: 'founder' });
const witness = Object.freeze({ id: 'witness-1', role: 'witness' });
const baseTime = Date.parse('2026-11-08T18:00:00.000Z');
const at = offset => new Date(baseTime + offset * 1000).toISOString();
const start = (actor = founder, opponentId = 'yard-scout', id = 'encounter-1') =>
  createCombatEncounter({ encounterId: id, actor, opponentId, at: at(0) });
const move = (encounter, actor, action, second) =>
  resolveCombatMove(encounter, actor, action, at(second)).encounter;
const actorKey = actor => JSON.stringify([actor.id, actor.role]);

function victoryEvents(actor = founder, opponentId = 'yard-scout', encounterId = 'encounter-1', offset = 0) {
  const events = [{
    id: `start-${encounterId}`,
    type: 'combat-encounter-started',
    encounterId,
    opponentId,
    actor,
    at: at(offset)
  }];
  let second = offset;
  for (let cycle = 0; cycle < 4; cycle += 1) {
    for (const action of ['feint', 'guard', 'strike']) {
      second += 1;
      events.push({
        id: `move-${encounterId}-${second}`,
        type: 'combat-move-resolved',
        encounterId,
        move: action,
        actor,
        at: at(second)
      });
      if (action === 'strike' && cycle === 1) return events;
    }
  }
  throw new Error('Fixture did not reach victory.');
}

test('the Combat Yard roster is fixed, ordered, and progressively stronger', () => {
  assert.deepEqual(COMBAT_OPPONENTS.map(item => item.id), [
    'yard-scout', 'yard-warden', 'yard-champion'
  ]);
  assert.deepEqual(COMBAT_OPPONENTS.map(item => item.tier), [1, 2, 3]);
  assert.ok(COMBAT_OPPONENTS.every(item =>
    Number.isSafeInteger(item.maxHp) && item.maxHp > 0 &&
    Number.isSafeInteger(item.attack) && item.attack > 0 &&
    Number.isSafeInteger(item.xp) && item.xp > 0
  ));
});

test('new encounters start with bounded health and the opponent telegraph at windup', () => {
  const encounter = start();
  assert.equal(encounter.playerHp, COMBAT_PLAYER_MAX_HP);
  assert.equal(encounter.opponentHp, 44);
  assert.equal(encounter.phase, 'windup');
  assert.equal(encounter.status, 'active');
  assert.equal(encounter.turn, 0);
  assert.deepEqual(encounter.actions, []);
});

test('feint, guard, strike resolves a deterministic first victory', () => {
  let encounter = start();
  encounter = move(encounter, founder, 'feint', 1);
  assert.equal(encounter.phase, 'strike');
  assert.equal(encounter.feintReady, true);

  encounter = move(encounter, founder, 'guard', 2);
  assert.equal(encounter.phase, 'recovery');
  assert.equal(encounter.playerHp, COMBAT_PLAYER_MAX_HP);

  let resolved;
  resolved = resolveCombatMove(encounter, founder, 'strike', at(3));
  encounter = resolved.encounter;
  assert.equal(resolved.receipt.damageToOpponent, 32);
  assert.equal(encounter.opponentHp, 12);
  assert.equal(encounter.phase, 'windup');

  encounter = move(encounter, founder, 'feint', 4);
  encounter = move(encounter, founder, 'guard', 5);
  resolved = resolveCombatMove(encounter, founder, 'strike', at(6));
  encounter = resolved.encounter;
  assert.equal(resolved.receipt.status, 'victory');
  assert.equal(encounter.status, 'victory');
  assert.equal(encounter.outcome, 'victory');
  assert.equal(encounter.opponentHp, 0);
  assert.equal(encounter.playerHp, COMBAT_PLAYER_MAX_HP);
  assert.equal(encounter.turn, 6);
});

test('an unfeinted recovery strike deals the lower fixed damage', () => {
  let encounter = start();
  encounter = move(encounter, founder, 'wait', 1);
  encounter = move(encounter, founder, 'guard', 2);
  const resolved = resolveCombatMove(encounter, founder, 'strike', at(3));
  assert.equal(resolved.receipt.damageToOpponent, 22);
  assert.equal(resolved.encounter.opponentHp, 22);
  assert.equal(resolved.encounter.feintReady, false);
});

test('guard blocks the telegraphed strike while waiting takes the fixed hit', () => {
  let guarded = start();
  guarded = move(guarded, founder, 'wait', 1);
  guarded = move(guarded, founder, 'guard', 2);
  assert.equal(guarded.playerHp, COMBAT_PLAYER_MAX_HP);

  let exposed = start();
  exposed = move(exposed, founder, 'wait', 1);
  exposed = move(exposed, founder, 'wait', 2);
  assert.equal(exposed.playerHp, COMBAT_PLAYER_MAX_HP - 10);
});

test('a rushed strike trades a small hit for the incoming telegraphed strike', () => {
  let encounter = start();
  encounter = move(encounter, founder, 'wait', 1);
  const resolved = resolveCombatMove(encounter, founder, 'strike', at(2));
  assert.equal(resolved.receipt.damageToOpponent, 8);
  assert.equal(resolved.receipt.damageToPlayer, 10);
  assert.equal(resolved.encounter.playerHp, 90);
  assert.equal(resolved.encounter.opponentHp, 36);
});

test('moves outside their phase are rejected without mutating the input state', () => {
  const encounter = start();
  const before = structuredClone(encounter);
  assert.throws(() => resolveCombatMove(encounter, founder, 'guard', at(1)), {
    code: 'COMBAT_MOVE_OUT_OF_PHASE'
  });
  assert.deepEqual(encounter, before);
});

test('only the actor who started an encounter can move it', () => {
  const encounter = start(founder);
  assert.throws(() => resolveCombatMove(encounter, witness, 'wait', at(1)), {
    code: 'COMBAT_ACTOR_MISMATCH'
  });
});

test('retreat ends the encounter without a victory or reward', () => {
  const events = [
    { id: 'start-retreat', type: 'combat-encounter-started', encounterId: 'retreat-1', opponentId: 'yard-scout', actor: founder, at: at(0) },
    { id: 'retreat', type: 'combat-move-resolved', encounterId: 'retreat-1', move: 'retreat', actor: founder, at: at(1) }
  ];
  const projection = projectCombatHistory(events);
  assert.equal(projection.encounters[0].status, 'retreated');
  assert.deepEqual(projection.victoryRecords, []);
  assert.deepEqual(projection.xpByActor, {});
});

test('the actor must defeat each prior opponent before the next tier unlocks', () => {
  const locked = [{
    id: 'start-locked',
    type: 'combat-encounter-started',
    encounterId: 'locked-1',
    opponentId: 'yard-warden',
    actor: founder,
    at: at(0)
  }];
  assert.throws(() => projectCombatHistory(locked), {
    code: 'COMBAT_OPPONENT_LOCKED'
  });

  const unlocked = victoryEvents();
  unlocked.push({
    id: 'start-warden',
    type: 'combat-encounter-started',
    encounterId: 'warden-1',
    opponentId: 'yard-warden',
    actor: founder,
    at: at(10)
  });
  const projection = projectCombatHistory(unlocked);
  assert.equal(projection.encounters.length, 2);
  assert.equal(projection.encounters[1].opponentId, 'yard-warden');
});

test('first victory awards fixed XP once; rematches remain recorded but award zero XP', () => {
  const events = victoryEvents();
  events.push({
    id: 'start-rematch',
    type: 'combat-encounter-started',
    encounterId: 'rematch-1',
    opponentId: 'yard-scout',
    actor: founder,
    at: at(7)
  });
  events.push({
    id: 'retreat-rematch',
    type: 'combat-move-resolved',
    encounterId: 'rematch-1',
    move: 'retreat',
    actor: founder,
    at: at(8)
  });
  const projection = projectCombatHistory(events);
  assert.equal(projection.xpByActor[actorKey(founder)], 30);
  assert.equal(projection.victoryRecords.length, 1);
  assert.equal(projection.victoryRecords[0].firstWin, true);
  assert.equal(projection.victoryRecords[0].xpAwarded, 30);
  assert.equal(
    projection.victoryRecords[0].eventId,
    events.filter(event => event.type === 'combat-move-resolved' && event.encounterId === 'encounter-1').at(-1).id
  );
});

test('same actor ID with a different role has a separate unlock and reward history', () => {
  const sameIdWitness = { id: founder.id, role: 'witness' };
  const events = victoryEvents(founder);
  events.push({
    id: 'witness-start-locked',
    type: 'combat-encounter-started',
    encounterId: 'witness-warden',
    opponentId: 'yard-warden',
    actor: sameIdWitness,
    at: at(10)
  });
  assert.throws(() => projectCombatHistory(events), {
    code: 'COMBAT_OPPONENT_LOCKED'
  });
});

test('an actor cannot start a second encounter while the first is active', () => {
  const events = [
    { id: 'start-one', type: 'combat-encounter-started', encounterId: 'one', opponentId: 'yard-scout', actor: founder, at: at(0) },
    { id: 'start-two', type: 'combat-encounter-started', encounterId: 'two', opponentId: 'yard-scout', actor: founder, at: at(1) }
  ];
  assert.throws(() => projectCombatHistory(events), {
    code: 'COMBAT_ALREADY_ACTIVE'
  });
});

test('encounter IDs cannot be reused', () => {
  const events = [
    { id: 'start-one', type: 'combat-encounter-started', encounterId: 'one', opponentId: 'yard-scout', actor: founder, at: at(0) },
    { id: 'retreat-one', type: 'combat-move-resolved', encounterId: 'one', move: 'retreat', actor: founder, at: at(1) },
    { id: 'start-two', type: 'combat-encounter-started', encounterId: 'one', opponentId: 'yard-scout', actor: founder, at: at(2) }
  ];
  assert.throws(() => projectCombatHistory(events), {
    code: 'INVALID_COMBAT_HISTORY'
  });
});

test('encounter timestamps cannot move backward', () => {
  const encounter = start();
  assert.throws(() => resolveCombatMove(encounter, founder, 'wait', at(-1)), {
    code: 'COMBAT_TIME_REVERSED'
  });
});

test('turn limit produces a bounded exhausted result', () => {
  let encounter = start();
  let second = 1;
  while (encounter.status === 'active') {
    const action = encounter.phase === 'windup' ? 'wait'
      : encounter.phase === 'strike' ? 'wait'
      : 'wait';
    encounter = move(encounter, founder, action, second++);
  }
  assert.equal(encounter.turn, COMBAT_MAX_TURNS);
  assert.equal(encounter.status, 'exhausted');
  assert.equal(encounter.outcome, 'exhausted');
  assert.equal(encounter.playerHp, 20);
});

test('finished encounters reject additional actions', () => {
  let encounter = start();
  encounter = move(encounter, founder, 'retreat', 1);
  assert.throws(() => resolveCombatMove(encounter, founder, 'wait', at(2)), {
    code: 'COMBAT_ALREADY_FINISHED'
  });
});

test('the same retained action sequence projects to the same encounter state', () => {
  const events = victoryEvents();
  const first = projectCombatHistory(events);
  const second = projectCombatHistory(structuredClone(events));
  assert.deepEqual(first, second);
  assert.equal(first.encounters[0].status, 'victory');
});


test('retained combat projections reject globally out-of-order combat events', () => {
  const events = victoryEvents();
  events[2].at = at(0);
  assert.throws(() => projectCombatHistory(events), {
    code: 'COMBAT_HISTORY_TIME_REVERSED'
  });
});
