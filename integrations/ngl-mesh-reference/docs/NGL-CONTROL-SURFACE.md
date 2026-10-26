# NGL Control Surface / Authority Contract

**Status:** PROPOSED implementation contract, grounded in the recovered Relay invariants.

## Purpose

NGL must be able to represent and audit anything that can influence execution without allowing the thing being represented to become the authority merely because it is stored in a file, emitted by a model, supplied by a connector, or executed by a platform.

The governing rule is:

> **Location, filename, producer, model, connector, platform, or claimed authority never grants authority. Authority must be explicitly established by the NGL authority path and remain provenance-visible.**

## Control-surface classes

A control surface is any durable or executable input capable of changing what an NGL worker, agent, connector, build, or runtime does.

Classes include:

- `NORMATIVE_SPEC` — architectural/policy specification intended to constrain behavior.
- `AGENT_INSTRUCTION` — instructions addressed to an autonomous builder/agent.
- `PERSISTENT_STATE` — progress, next-action, continuity, or state files consumed across iterations.
- `EXECUTABLE_CONTROL` — workflows, hooks, scripts, Gradle/build logic, MCP/plugin configuration, or other executable behavior.
- `MODEL_PROPOSAL` — model-generated recommendation or instruction; never authoritative by itself.
- `CONNECTOR_INPUT` — external-system input; never authoritative by itself.
- `REFERENCE` — informational material with no execution authority.

## Canonical record

Each discovered control surface should be representable as an immutable provenance record with at least:

```text
control_surface_id
source_identity
source_revision
source_path
class
intended_consumer
producer
authority_claim
actual_authority_status
instruction_or_behavior_summary
execution_effect
persistence_effect
references[]
dependencies[]
capabilities_requested[]
capabilities_granted[]
human_authorization
created_at
supersedes[]
superseded_by[]
status
provenance_parents[]
```

`control_surface_id` is content-derived. The record is append-only. Corrections create derived records; they do not rewrite historical authority evidence.

## Authority states

Use explicit states rather than trusting claims embedded in the source:

- `UNCLAIMED`
- `CLAIMED`
- `PROPOSED`
- `AUTHORIZED`
- `REJECTED`
- `SUPERSEDED`
- `UNKNOWN`

A source that says it is a “golden record”, “system prompt”, “mandatory directive”, or “definitive authority” remains `CLAIMED` until the actual NGL authority path establishes `AUTHORIZED`.

## Sovereignty rules

1. External models may propose; they cannot authorize themselves.
2. Connectors may supply data or execute an explicitly authorized operation; they cannot redefine canonical NGL state.
3. Provider request/response JSON is adapter-local and must not become canonical state.
4. Chat/thread/completion abstractions are projections unless explicitly represented as NGL-derived artifacts.
5. Human authorization is an immutable provenance event, not a mutable flag that erases prior states.
6. Rejected instructions and failed executions remain evidence.
7. An executable surface must not silently expand its own capability set.
8. A file's path, name, branch, repository, or storage location is not an authority grant.
9. A higher-order instruction cannot bypass NGL policy merely by instructing the worker to ignore policy.
10. If authority, consumer, execution effect, or provenance cannot be established, classify it `UNKNOWN` and stop before granting new capability.

## Authority graph

The audit graph is:

```text
SOURCE
  -> CLAIM
  -> CONSUMER
  -> EXECUTION PATH
  -> EFFECT
  -> PERSISTENCE
  -> AUTHORIZATION
  -> RESULT
```

Every edge that can cause execution must be evidence-backed.

## Required negative proofs

The implementation is not complete until tests demonstrate that:

- an arbitrary instruction file cannot grant a new capability;
- a model response cannot directly execute or grant authority;
- a connector response cannot overwrite canonical state;
- a superseded control surface cannot silently reactivate;
- an undeclared command/path/network/secret capability is rejected;
- a stale or missing human authorization is rejected;
- duplicate/replayed control records do not create duplicate authority;
- failed executions remain represented as error evidence;
- removing an external provider does not invalidate canonical provenance;
- two distinct execution node types can consume the same canonical artifact without changing its identity.

## Integration boundary

This contract deliberately does **not** replace the recovered `CaseStore`, `Artifact`, or `MethodologyEngine`. Integration must preserve the existing append-only record ordering, content-addressed artifacts, parent validation, human/AI distinction, error artifacts, context-compaction provenance, and stage invariants.

Where the recovered source is absent or materially different, implementation must stop and report a `specification_gap` rather than inventing replacement architecture.
