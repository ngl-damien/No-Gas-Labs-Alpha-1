# Combat Yard — Deterministic Rules v1

**Status:** Prototype with retained world-model events and character progression; not yet exposed through the shared-world server or player UI.  
**Scope:** First conventional-combat mechanic for the No_Gas_Labs MMORPG.  
**Companion system:** Research, adversarial reasoning, strategy, and consequential-decision encounters remain a separate first-class encounter mode. This system does not replace or narrow that mode.

## Design intent

The Combat Yard is a bounded, readable sparring loop against deterministic training automata. It introduces timing, defense, risk, health, victory/loss/retreat, and a small game-only first-win reward. It is an abstract game mechanic, not a simulation, guide, or training system for real-world violence.

## Fixed roster

| Order | Opponent | Health | Telegraph damage | First-win XP |
|---|---|---:|---:|---:|
| 1 | Training Scout | 44 | 10 | 30 |
| 2 | Training Warden | 68 | 14 | 45 |
| 3 | Training Champion | 92 | 16 | 60 |

The next opponent unlocks only after the same actor defeats the prior opponent. Actor identity is the pair (ID, role), not ID alone.

## Turn cycle

The opponent follows a fixed phase cycle:

1. **Windup:** choose wait or feint. A feint primes the next recovery strike for 32 damage.
2. **Strike:** choose guard, wait, or a risky early strike. Guard blocks the telegraphed hit; waiting takes the opponent's fixed damage; an early strike deals 8 damage and also takes the incoming hit.
3. **Recovery:** choose strike or wait. A normal recovery strike deals 22 damage; a primed strike deals 32. Waiting gives up the opening.

Retreat ends an encounter from any phase. An encounter is also bounded to 24 player actions. Outcomes are victory, defeat, draw, retreated, or exhausted.

## Reward and authority boundaries

- Only a first victory by the same (actor ID, role) against a given opponent awards that opponent's fixed XP.
- Rematches remain distinguishable in the event projection but award zero additional XP.
- Defeat, draw, retreat, and exhaustion award no XP.
- The rules engine is deterministic and contains no model, AI, provider, random-number, or external-action dependency.
- XP is a game projection only. It is not truth, evidence, mastery, approval, identity, or institutional authority.
- Canonical combat history is append-only: the world model retains encounter-start and move events, validates the full sequence, and reconstructs state from those events. The model does not trust client-supplied health, outcome, XP, or authority.
- Combat XP is actor-projected and does not alter the publication-only world XP summary. Character XP and the Combatant skill are derived from the validated retained combat history.

## Implemented layers

- game/combat.mjs — immutable roster, pure encounter creation and turn resolution, sequential unlocks, actor-bound replay projection, and first-win-only XP calculation.
- game/model.mjs — retains start/move events, validates exact event fields and idempotency receipts, rejects impossible/out-of-order/foreign-actor sequences, and reconstructs combat history before accepting an action or validating an imported world.
- game/server.mjs — serves combat.mjs through the explicit first-party static-module allowlist; this does not yet expose combat actions through /api/action.
- game/character-sheet.mjs — derives actor Combatant count, combat XP, character XP, and world XP from retained first-win records.
- test/game-combat.test.mjs — pure rules and projection tests.
- test/game-model.test.mjs — retained event, actor ownership, malformed history, and idempotency tests.
- test/game-character-sheet.test.mjs — actor-scoped XP, Combatant progression, and fail-closed projection tests.

## Remaining integration boundary

**Not yet implemented:** shared-server action allowlisting and request persistence for the new combat actions, location/proximity checks, Combat Yard map/NPC integration, browser/mobile UI, quest/Chronicle integration, PWA shell integration, and combat-specific browser/Android acceptance. The module is now served as an approved static dependency, but the shared HTTP action route still does not expose combat actions, so this is not yet playable. Do not mark G4 complete until the shared server and player-facing layers are integrated and verified on exact heads.
