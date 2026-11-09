# Combat Yard — Deterministic Rules v1

**Status:** Prototype rules engine; not yet wired into the shared-world server, map, character sheet, quests, or UI.  
**Scope:** First conventional-combat mechanic for the No_Gas_Labs MMORPG.  
**Companion system:** Research, adversarial reasoning, strategy, and consequential-decision encounters remain a separate first-class encounter mode. This document does not replace or narrow that system.

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
- The pure module does not persist events or mutate canonical world state. A server/model integration must validate and retain each start/move event, reconstruct the encounter from retained history, enforce idempotent requests, and derive XP from the retained sequence before this becomes playable shared-world capability.

## Implemented prototype boundary

game/combat.mjs contains the immutable roster, pure encounter creation and turn resolution, and a strict event-history projection. test/game-combat.test.mjs exercises phase rules, damage, actor isolation, unlock progression, first-win rewards, replay determinism, invalid transitions, retreat, and turn exhaustion.

**Not yet implemented:** canonical world event types, shared-server action validation and persistence, location/proximity checks, Combat Yard map/NPC integration, mobile/browser UI, Chronicle/quest/skill projections, and browser/Android acceptance. Do not mark G4 complete or describe the Combat Yard as playable until those layers are integrated and verified on exact heads.
