// Deterministic, provider-independent rules for the Combat Yard prototype.
// This module is a pure rules engine. It does not write world state, grant
// authority, or claim real-world combat capability. The server/model layer
// must retain the returned actions before treating an encounter as canonical.

export const COMBAT_RULESET = 'ngl.combat-yard.v1';
export const COMBAT_PLAYER_MAX_HP = 100;
export const COMBAT_MAX_TURNS = 24;

export const COMBAT_OPPONENTS = Object.freeze([
  Object.freeze({
    id: 'yard-scout',
    name: 'Training Scout',
    tier: 1,
    maxHp: 44,
    attack: 10,
    xp: 30
  }),
  Object.freeze({
    id: 'yard-warden',
    name: 'Training Warden',
    tier: 2,
    maxHp: 68,
    attack: 14,
    xp: 45
  }),
  Object.freeze({
    id: 'yard-champion',
    name: 'Training Champion',
    tier: 3,
    maxHp: 92,
    attack: 16,
    xp: 60
  })
]);

const opponentById = new Map(COMBAT_OPPONENTS.map(opponent => [opponent.id, opponent]));
const validRoles = new Set(['founder', 'witness']);
const validPhases = new Set(['windup', 'strike', 'recovery']);
const validStatuses = new Set(['active', 'victory', 'defeat', 'draw', 'retreated', 'exhausted']);
const validMoves = new Set(['wait', 'feint', 'guard', 'strike', 'retreat']);
const actorKey = actor => JSON.stringify([actor.id, actor.role]);
const sameActor = (left, right) => left?.id === right?.id && left?.role === right?.role;
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};

function normalizeActor(actor) {
  if (!actor || typeof actor.id !== 'string' || !actor.id.trim() ||
      actor.id.trim() !== actor.id || Array.from(actor.id).length > 128 ||
      !validRoles.has(actor.role)) {
    fail('INVALID_COMBAT_ACTOR', 'A valid authenticated game actor is required.');
  }
  return { id: actor.id, role: actor.role };
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    fail('INVALID_COMBAT_TIME', 'Combat actions require a normalized UTC timestamp.');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail('INVALID_COMBAT_TIME', 'Combat actions require a valid normalized UTC timestamp.');
  }
  return value;
}

function opponentFor(opponentId) {
  const opponent = opponentById.get(opponentId);
  if (!opponent) fail('UNKNOWN_COMBAT_OPPONENT', 'Choose an opponent in the Combat Yard roster.');
  return opponent;
}

function assertEncounter(encounter) {
  if (!encounter || encounter.schema !== COMBAT_RULESET ||
      typeof encounter.id !== 'string' || !encounter.id ||
      !validRoles.has(encounter.actor?.role) ||
      typeof encounter.actor?.id !== 'string' || !encounter.actor.id ||
      !opponentById.has(encounter.opponentId) ||
      !Number.isSafeInteger(encounter.turn) || encounter.turn < 0 ||
      !validPhases.has(encounter.phase) ||
      !validStatuses.has(encounter.status) ||
      !Number.isSafeInteger(encounter.playerHp) || encounter.playerHp < 0 || encounter.playerHp > COMBAT_PLAYER_MAX_HP ||
      !Number.isSafeInteger(encounter.opponentHp) || encounter.opponentHp < 0 ||
      !Number.isSafeInteger(encounter.maxOpponentHp) ||
      encounter.maxOpponentHp !== opponentFor(encounter.opponentId).maxHp ||
      encounter.opponentHp > encounter.maxOpponentHp ||
      typeof encounter.feintReady !== 'boolean' ||
      !Array.isArray(encounter.actions) ||
      encounter.actions.length !== encounter.turn ||
      !normalizeTimestamp(encounter.createdAt) ||
      !normalizeTimestamp(encounter.updatedAt) ||
      Date.parse(encounter.updatedAt) < Date.parse(encounter.createdAt)) {
    fail('INVALID_COMBAT_ENCOUNTER', 'The retained encounter state is malformed.');
  }
  return encounter;
}

export function createCombatEncounter({ encounterId, actor, opponentId, at }) {
  const normalizedActor = normalizeActor(actor);
  const opponent = opponentFor(opponentId);
  const id = typeof encounterId === 'string' ? encounterId.trim() : '';
  if (!id || id !== encounterId || Array.from(id).length > 128) {
    fail('INVALID_COMBAT_ENCOUNTER_ID', 'Encounter ID must be a bounded, non-empty identifier.');
  }
  const timestamp = normalizeTimestamp(at);
  return Object.freeze({
    schema: COMBAT_RULESET,
    id,
    actor: Object.freeze(normalizedActor),
    opponentId: opponent.id,
    turn: 0,
    phase: 'windup',
    playerHp: COMBAT_PLAYER_MAX_HP,
    opponentHp: opponent.maxHp,
    maxOpponentHp: opponent.maxHp,
    feintReady: false,
    status: 'active',
    outcome: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    actions: Object.freeze([])
  });
}

/**
 * Resolve one player choice against a fixed telegraph cycle:
 * windup -> strike -> recovery -> windup.
 *
 * - wait/feint advance the windup; feint improves the next recovery strike.
 * - guard blocks the opponent's telegraphed strike.
 * - strike during the opponent's strike phase is a weak trade and takes damage.
 * - strike during recovery is the full opening.
 * - retreat ends the encounter without a reward.
 */
export function resolveCombatMove(encounterInput, actorInput, move, at) {
  const encounter = assertEncounter(encounterInput);
  const actor = normalizeActor(actorInput);
  if (!sameActor(encounter.actor, actor)) {
    fail('COMBAT_ACTOR_MISMATCH', 'Only the actor who started this encounter may act in it.');
  }
  if (encounter.status !== 'active') {
    fail('COMBAT_ALREADY_FINISHED', 'A finished encounter cannot accept another move.');
  }
  if (!validMoves.has(move)) fail('INVALID_COMBAT_MOVE', 'Choose wait, feint, guard, strike, or retreat.');
  const timestamp = normalizeTimestamp(at);
  if (Date.parse(timestamp) < Date.parse(encounter.updatedAt)) {
    fail('COMBAT_TIME_REVERSED', 'A combat action cannot precede the previous retained action.');
  }
  if (encounter.turn >= COMBAT_MAX_TURNS) {
    fail('COMBAT_TURN_LIMIT', 'This encounter has reached its bounded turn limit.');
  }

  const opponent = opponentFor(encounter.opponentId);
  const phaseBefore = encounter.phase;
  let phaseAfter = phaseBefore;
  let playerHp = encounter.playerHp;
  let opponentHp = encounter.opponentHp;
  let feintReady = encounter.feintReady;
  let damageToPlayer = 0;
  let damageToOpponent = 0;
  let status = 'active';
  let outcome = null;

  if (move === 'retreat') {
    status = 'retreated';
    outcome = 'retreated';
  } else if (phaseBefore === 'windup') {
    if (move !== 'wait' && move !== 'feint') {
      fail('COMBAT_MOVE_OUT_OF_PHASE', 'During windup, choose wait or feint.');
    }
    if (move === 'feint') feintReady = true;
    phaseAfter = 'strike';
  } else if (phaseBefore === 'strike') {
    if (move === 'guard') {
      // The guard is the explicit answer to the opponent's telegraphed strike.
      damageToPlayer = 0;
    } else if (move === 'wait') {
      damageToPlayer = opponent.attack;
    } else if (move === 'strike') {
      // A rushed strike is possible but trades a small hit for the incoming one.
      damageToOpponent = 8;
      damageToPlayer = opponent.attack;
    } else {
      fail('COMBAT_MOVE_OUT_OF_PHASE', 'During the telegraphed strike, choose guard, wait, or a risky early strike.');
    }
    playerHp = Math.max(0, playerHp - damageToPlayer);
    opponentHp = Math.max(0, opponentHp - damageToOpponent);
    phaseAfter = 'recovery';
  } else if (phaseBefore === 'recovery') {
    if (move !== 'wait' && move !== 'strike') {
      fail('COMBAT_MOVE_OUT_OF_PHASE', 'During recovery, choose wait or strike.');
    }
    if (move === 'strike') {
      damageToOpponent = feintReady ? 32 : 22;
      opponentHp = Math.max(0, opponentHp - damageToOpponent);
    }
    feintReady = false;
    phaseAfter = 'windup';
  }

  if (opponentHp === 0 && playerHp === 0) {
    status = 'draw';
    outcome = 'draw';
  } else if (opponentHp === 0) {
    status = 'victory';
    outcome = 'victory';
  } else if (playerHp === 0) {
    status = 'defeat';
    outcome = 'defeat';
  } else if (encounter.turn + 1 >= COMBAT_MAX_TURNS) {
    status = 'exhausted';
    outcome = 'exhausted';
  }

  const receipt = Object.freeze({
    turn: encounter.turn + 1,
    move,
    phaseBefore,
    phaseAfter,
    damageToPlayer,
    damageToOpponent,
    playerHp,
    opponentHp,
    status,
    outcome
  });
  const next = Object.freeze({
    ...encounter,
    turn: encounter.turn + 1,
    phase: phaseAfter,
    playerHp,
    opponentHp,
    feintReady,
    status,
    outcome,
    updatedAt: timestamp,
    actions: Object.freeze([...encounter.actions, receipt])
  });
  return Object.freeze({ encounter: next, receipt });
}

/**
 * Rebuild combat state from the full retained event log. Unknown event types
 * do not affect combat state, but every retained event must have a globally
 * unique, non-empty ID before combat progress can be projected. Malformed
 * combat events or impossible turn sequences fail closed. First victory per
 * (actor ID, role, opponent) earns the fixed XP once.
 */
export function projectCombatHistory(events) {
  if (!Array.isArray(events)) fail('INVALID_COMBAT_HISTORY', 'Combat history must be an event array.');
  const eventIds = new Set();
  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event) ||
        typeof event.id !== 'string' || !event.id || eventIds.has(event.id)) {
      fail('INVALID_COMBAT_HISTORY', 'Retained event IDs must be globally unique and non-empty.');
    }
    eventIds.add(event.id);
  }
  const encounters = new Map();
  const activeByActor = new Map();
  const winsByActor = new Map();
  const xpByActor = new Map();
  const victoryRecords = [];
  let previousCombatAt = -Infinity;
  const getWins = key => {
    if (!winsByActor.has(key)) winsByActor.set(key, new Set());
    return winsByActor.get(key);
  };

  for (const event of events) {
    if (event?.type !== 'combat-encounter-started' && event?.type !== 'combat-move-resolved') continue;
    const actor = normalizeActor(event.actor);
    const timestamp = normalizeTimestamp(event.at);
    if (Date.parse(timestamp) < previousCombatAt) {
      fail('COMBAT_HISTORY_TIME_REVERSED', 'Retained combat events must remain in chronological order.');
    }
    previousCombatAt = Date.parse(timestamp);
    const key = actorKey(actor);

    if (event.type === 'combat-encounter-started') {
      if (typeof event.encounterId !== 'string' || !event.encounterId ||
          encounters.has(event.encounterId)) {
        fail('INVALID_COMBAT_HISTORY', 'Combat encounter identities must be unique and non-empty.');
      }
      if (activeByActor.has(key)) {
        fail('COMBAT_ALREADY_ACTIVE', 'An actor cannot start a second encounter while one is active.');
      }
      const opponent = opponentFor(event.opponentId);
      const priorOpponent = COMBAT_OPPONENTS[opponent.tier - 2];
      if (priorOpponent && !getWins(key).has(priorOpponent.id)) {
        fail('COMBAT_OPPONENT_LOCKED', 'The previous Combat Yard opponent must be defeated first.');
      }
      const encounter = createCombatEncounter({
        encounterId: event.encounterId,
        actor,
        opponentId: event.opponentId,
        at: timestamp
      });
      encounters.set(encounter.id, encounter);
      activeByActor.set(key, encounter.id);
      continue;
    }

    const encounter = encounters.get(event.encounterId);
    if (!encounter || !sameActor(encounter.actor, actor) ||
        activeByActor.get(key) !== encounter.id) {
      fail('INVALID_COMBAT_HISTORY', 'A combat move must belong to its actor’s active retained encounter.');
    }
    const resolved = resolveCombatMove(encounter, actor, event.move, timestamp);
    encounters.set(encounter.id, resolved.encounter);
    if (resolved.encounter.status !== 'active') activeByActor.delete(key);

    if (resolved.encounter.status === 'victory') {
      const wins = getWins(key);
      const firstWin = !wins.has(encounter.opponentId);
      wins.add(encounter.opponentId);
      const xpAwarded = firstWin ? opponentFor(encounter.opponentId).xp : 0;
      xpByActor.set(key, (xpByActor.get(key) || 0) + xpAwarded);
      victoryRecords.push(Object.freeze({
        encounterId: encounter.id,
        eventId: event.id,
        actor: Object.freeze(actor),
        opponentId: encounter.opponentId,
        firstWin,
        xpAwarded,
        at: timestamp
      }));
    }
  }

  return Object.freeze({
    encounters: Object.freeze([...encounters.values()]),
    activeByActor: Object.freeze(Object.fromEntries(activeByActor)),
    winsByActor: Object.freeze(Object.fromEntries([...winsByActor].map(([key, wins]) => [key, Object.freeze([...wins])]))),
    xpByActor: Object.freeze(Object.fromEntries(xpByActor)),
    victoryRecords: Object.freeze(victoryRecords)
  });
}
