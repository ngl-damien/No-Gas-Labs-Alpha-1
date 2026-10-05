# World Projection Contract

The game world is a projection, not an authority source.

## Boundary

Input is an append-only event sequence. A world consequence is admitted only when the event is simultaneously:

- `admission: ACCEPTED`
- `authority: AUTHORIZED`
- `execution: EXECUTED`
- `evidence: OBSERVED`
- `outcome: SUCCEEDED`
- backed by at least one receipt reference.

Claims and proposals may create visible quests, but cannot award XP, inventory, completion, or world mutations.

Failures, refutations, and rejected candidates remain in history.

Replay is idempotent by `event_id`.

## Donor alignment

This seam is intentionally compatible with the recovered NGL direction:

- RAE supplies independent observation/receipt and bounded authority semantics.
- Mesh/Relay supplies durable system-event/case history.
- RuneUX supplies world, quest, XP, inventory, and interaction grammar.
- Guild/Command Center supply human/agent operational surfaces.

The reducer does not claim those donor systems are already wired into Alpha 1. It creates the boundary through which they can be stitched without allowing the game UI or a model assertion to manufacture canonical state.
