# Manus Handoff — GitHub PR CI Triage Skill

**Status:** Coordination handoff; implementation not yet performed  
**Repository:** `ngl-damien/No-Gas-Labs-Alpha-1`  
**Base:** `main`  
**Working branch:** `coord/manus-github-pr-ci-triage`  
**Requested by:** Damien Featherstone  
**Receiving collaborator:** Manus

---

## Manus — let's coordinate this installation here.

Damien wants the supplied `github-pr-ci-triage.skill` installed as a permanent, mandatory repository skill in Alpha-1. This branch is the shared working location for that task. Please inspect this handoff, then reply in the linked GitHub issue / branch discussion with your findings and proposed implementation before making changes.

### Intended outcome

1. Preserve the supplied skill's complete, original instructions in:
   `skills/github-pr-ci-triage/SKILL.md`
2. Register it in `skills/README.md`.
3. Update the root `AGENTS.md` so agents are required to apply this skill whenever they:
   - diagnose or triage failing pull-request CI;
   - investigate workflow/check failures;
   - prepare or review CI-related fixes; or
   - split an oversized or mixed-scope pull request.
4. Ensure vendor instruction entry points inherit the requirement through the existing root governance contract. Avoid duplicating the full skill into vendor files.
5. Add or update validation/tests if the repository has an established mechanism for checking skill registration and mandatory instruction coverage.

### Source integrity

Use the exact supplied `github-pr-ci-triage.skill` artifact. Do not reconstruct its contents from its filename, invent missing sections, or silently rewrite its procedures. If you cannot access the original artifact, stop and ask Damien to make it available.

### Repository governance

- Follow root `AGENTS.md`, the complete shared Ralph protocol, and the Institutional Charter in the mandated sequential bootstrap order.
- Inspect current main, open PRs, active branches, and latest durable checkpoints after bootstrap. Do not duplicate existing work.
- Keep this task bounded to the skill installation and its enforcement/validation seam.
- Preserve the repository's evidence labels: Verified, Reported, Simulated, Proposed, Unknown.
- Do not weaken CI, tests, branch protections, security controls, or Founder authority boundaries to make the installation pass.
- Do not merge, release, deploy, or publish externally without Damien's explicit authorization.
- Do not create another scheduler, parallel operating protocol, or duplicate skill registry.
- The user's current doctrine is **AAOTA**. If repository source uses a conflicting acronym or wording, surface the discrepancy; do not silently change canonical institutional text as part of this task.

### Coordination requested

Manus, please report:
1. whether you can access the exact source skill;
2. which existing instructions and skill-registry files you inspected;
3. any overlap with existing Alpha-1 skills;
4. the smallest safe implementation plan;
5. how mandatory invocation will be made testable or enforceable; and
6. the exact files/commits you propose to change.

Please coordinate in this branch/issue thread and preserve one canonical workstream. Do not assume this handoff itself authorizes merging or any other protected action.
