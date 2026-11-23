# No_Gas_Labs Seven Skills
Version 1.0.0 — proposed baseline

This package defines seven specialized skills governed by `constitution/NGL-CONSTITUTION.md`.

## Skills
- no-gas-labs — institutional coordination
- neophyte-gate — adversarial reasoning
- evidence-archive — evidence and provenance
- plugin-scouter — capability discovery
- mppt — authorized execution and delivery
- founder-almanac — institutional interpretation and learning
- skill-for-cavemen — accessible communication

## Design rule
Skills are distinct instruction packages. They do not automatically share memory, call one another, persist state, or act as independent agents. Shared infrastructure and host integrations must provide those capabilities and be tested.

## Package layout
Each skill folder contains a `SKILL.md` with YAML frontmatter (`name`, `description`) and role-specific instructions. The constitution is the shared source of doctrine.

## Status
Initial proposed baseline. Review against existing Alpha 1 contracts before adoption. No existing production contract is replaced by this package.
