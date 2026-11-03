---
name: ngl-evidence-governed-delivery
description: Evidence-governed work in the No-Gas-Labs repository portfolio. Use when rehydrating Alpha-1, reviewing agent or donor work, assimilating code from another repository, evaluating a PR, or deciding whether a claimed capability is actually integrated.
---

# NGL Evidence-Governed Delivery

Use this skill for any No-Gas-Labs task that crosses repositories, agents, providers, branches, or authority boundaries. The purpose is to turn portfolio-scale agent activity into safe, reproducible, canonical capability.

## Non-negotiable model

Treat `ngl-damien/No-Gas-Labs-Alpha-1` as the canonical integration target unless a current repository record explicitly changes that decision. Alpha-1's canonical state includes the world, player progression, institution ledger, evidence lifecycle, authority boundary, Forge execution, and release evidence.

Never treat a repository name, README, branch, PR, green check, model assertion, matching hash, UI label, or generated report as proof of integrated capability. Keep these states separate:

`claimed -> authorized -> executed -> observed -> adjudicated`

A donor may propose events, provide code, or render a read-only projection. It must not silently create a second canonical ledger, grant Founder authority, award XP, publish externally, spend funds, alter protected state, or bypass evidence admission.

## Required rehydration sequence

1. Read the target repository's root `AGENTS.md` alone.
2. Read its canonical operating protocol alone.
3. Read applicable vendor pointers (`CLAUDE.md`, `GEMINI.md`, `CODEX.md`, Copilot instructions) and nested instructions.
4. Read the latest checkpoint, completion ledger, and handoff from the other worker when available.
5. Inspect current main, exact commit, working tree, relevant branches, PRs, issues, checks, and declared tests.
6. Inspect the donor's exact source commit, license, secrets, tests, and runtime boundaries.
7. Discard any observation gathered before the required instruction reads if the repository mandates sequential bootstrap.

Record access limitations instead of assuming that missing files, empty API results, or shallow clones prove absence.

## Classify before changing

Assign every candidate artifact one disposition:

- **Integrated:** wired into canonical runtime with source provenance and relevant verification.
- **Retained module:** kept separable with a defined interface and no canonical-state bypass.
- **Preserved source:** archived with source commit, path, blob hash, and license/provenance; not executable by Alpha-1.
- **Blocked:** withheld for security, license, missing source, missing test, authority, or runtime reasons.
- **Rejected:** unsuitable for Alpha-1's core or duplicates a canonical owner.

A copied file is not an integrated feature. A merged PR is not sufficient without the tests and runtime evidence relevant to its claim.

## Select one bounded slice

Before editing, write a work claim containing:

- exact repository and base/head refs;
- one target seam and one smallest reusable behavior;
- competing branches/PRs inspected and collision decision;
- acceptance criteria and negative/failure cases;
- security, license, authority, and state-duplication risks.

Prefer adapters, fixtures, schemas, and pure functions over wholesale donor imports. Reuse Alpha-1's existing owners rather than introducing a second server, ledger, world model, or authority system.

## Donor admission rules

For every imported or adapted item, preserve:

- source repository and source commit/tree;
- original path and blob digest where available;
- target path and adaptation commit;
- license and asset provenance status;
- transformation or interface mapping;
- donor tests and Alpha-1 tests run;
- known limitations and unresolved claims.

Reject or block the item when it contains secrets, credential-bearing inputs, self-authorizing keys, autonomous merge/deploy/spend paths, unreviewed generated output, unverified external observations, or an incompatible license.

For provider/model code, distinguish “supports provider X” from “written by provider X.” Only run records or commit identities establish authorship.

## Verification sequence

Run the narrowest meaningful checks first, then the full Alpha-1 suite:

1. donor tests and static checks;
2. adapter/unit tests, including stale, malformed, self-authorizing, replay, and failure cases;
3. Alpha-1 targeted tests;
4. `npm run verify` and `npm run build` when the change crosses runtime or governance boundaries;
5. exact-head hosted CI and browser/device checks when the claim concerns those environments;
6. inspect the full diff and current base again before declaring success.

State precisely what each check exercised. Passing tests do not prove deployment, multiplayer, commercial value, human acceptance, or real-world demand.

## Preserve a receipt and handoff

Leave a durable run record or PR description with:

- worker identity and timestamp;
- source/base/head refs;
- changed paths and disposition;
- commands, test totals, exact-head workflow IDs/statuses;
- observed result versus unverified claim;
- failures, blockers, security and license risks;
- next ranked action and receiving worker.

If work is only on a branch, say **proposed**. If it is on main but lacks runtime evidence, say **implemented/tested only**. Reserve **integrated**, **release-ready**, **deployed**, and **accepted** for their separately evidenced states.

## Alpha-1 portfolio seams

Use these default owners unless current source evidence shows otherwise:

- world/player/quest progression: `game/`, `src/quest/`, `src/world/`;
- evidence and provenance: `src/evidence/`, `game/artifacts.mjs`, retained receipts;
- authority and Founder decisions: `src/authority/`, `src/institution/`;
- bounded execution: `src/forge/`, `docs/meteor/forge.md`;
- durable service and recovery: `game/service-store.mjs`, `game/server.mjs`, `docs/meteor/`;
- agent governance: `AGENTS.md`, `docs/operations/`, `scripts/validate-agent-governance.mjs`;
- imported source: `integrations/` or `recovery/`, never silently into canonical runtime.

When no owner exists, record the gap and make a product decision rather than importing a whole foreign stack.

## Stop conditions

Stop before destructive, irreversible, costly, credential-sensitive, license-sensitive, external, or Founder-authority-bound actions. Stop a donor import when its tests cannot run, provenance is ambiguous, security is unresolved, it duplicates canonical state, or the smallest adapter cannot preserve Alpha-1's evidence and failure semantics.

The objective is not maximum commits or maximum assimilated files. The objective is a real capability or a materially improved evidence boundary that another worker can reproduce and safely extend.
