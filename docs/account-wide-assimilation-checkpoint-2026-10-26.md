# Account-wide assimilation checkpoint (2026-10-26)

## Purpose

Record a fresh, connected-account inventory and the next safe assimilation sequence for Alpha One. This is an audit checkpoint, not a claim that all twelve repositories or the historical 94-repository inventory have been recovered or integrated.

Canonical target: `ngl-damien/No-Gas-Labs-Alpha-1` (`main`).
Evidence rule: a repository name, README, hash, archived file, or model assertion does not establish a working capability. Preserve source identity and classify runtime status separately.

## Fresh account inventory

The GitHub connector returned these twelve repositories for owner `ngl-damien` on 2026-10-26. Visibility/default-branch metadata is from that response; functional dispositions below are based on the current README, existing Alpha One assimilation plan/ledger, or both.

| Repository | Visibility | Default branch | Current disposition | Next action |
|---|---|---|---|---|
| `No-Gas-Labs-Alpha-1` | public | `main` | Canonical integration target; includes game/institutional kernel and prior assimilation tranches | Continue integration behind existing authority/evidence boundaries; keep PR #26 draft until production trust root exists |
| `Damien-Featherstone` | private | `main` | High-value app/state source identified in assimilation plan; secret-bearing data flagged | Do not bulk-copy. Review sensitive paths and history; rotate/revoke exposed key through an authorized secure process before trusting signed receipts |
| `ngl-recovery-2026-10-25` | private | `main` | Recovery package and historical source inventory; README alone does not prove all contents recovered | Inspect inventory and archives; track each of the historical 94 source identities with an explicit recovered/unrecovered disposition |
| `ngl001-def4us28` | public | `main` | Vite/React candidate; source-to-snapshot comparison already recorded | Recover missing `src/assets/hero.png`; investigate 4.56 MB `src/App.jsx`; resolve the two differing contact-state files only after provenance review; then run a clean build |
| `no-gas-labs-command-center` | public | `main` | Command-center source; snapshot ledger identifies four missing images | Recover `ai-avatar.jpg`, `capabilities-grid.jpg`, `hero-bg.jpg`, `security-shield.jpg`; verify routes against Alpha One interfaces before runtime wiring |
| `TaskAgile` | public | `main` | Partial source-only reference already copied into Alpha One | Reconcile remaining source paths (plan reports roughly 80 outstanding at last count); classify licensing, assets, duplication and runtime/security risks before each tranche |
| `ngl-mesh` | public | `main` | Java evidence bridge/reference imported; README explicitly says not a full mesh runtime or Android rebuild | Preserve UUID artifact identity versus content digest distinction; verify/build bridge and define narrow Alpha One adapter contract |
| `no-gas-labs` | public | `main` | Static browser client; README explicitly disclaims backend, orchestration service and payment processing | Keep as a publication/exhibit module; do not promote client-side hooks or prose into backend capabilities |
| `AI-BI-Intelligence-node-gate` | private | `main` | Observed README-only recovery placeholder | Recover original source/history from the original organization or archive; until then mark capability unrecovered |
| `ai-guild-hardened-v0.2` | private | `main` | Observed README-only recovery placeholder in this account repo; historical references may describe a different shell/source | Recover original source and compare provenance; do not infer a complete guild implementation from its name |
| `AI-orchestrator-test` | private | `main` | Observed README-only recovery placeholder | Recover original source/tests; then evaluate as orchestration/disagreement evidence, not as assumed production runtime |
| `app` | private | `main` | Observed README-only recovery placeholder | Identify original project and recover source before assigning a runtime role |

## Verified facts versus limits

- The connected-account inventory contains 12 repositories.
- Alpha One already has `docs/ASSIMILATION_PLAN.md` and `docs/repository-reconciliation-ledger.csv`; prior merged tranches are recorded there.
- The existing ledger records NGL-001 source-to-snapshot differences, including the missing hero image and the large differing `App.jsx`, plus Command Center and TaskAgile snapshot gaps.
- The observed README files for `AI-BI-Intelligence-node-gate`, `ai-guild-hardened-v0.2`, `AI-orchestrator-test`, and `app` contain only recovery-port provenance statements. This establishes that their current README files are placeholders; it does not prove no source exists elsewhere.
- The `ngl-mesh` README expressly distinguishes its tested Java evidence bridge from the inferred/full Android mesh runtime.
- The `no-gas-labs` README expressly describes a static client and disclaims a backend/payment processor.
- The current Alpha One open draft PR #26 introduces fail-closed host-injected observation/adjudication verifier contracts, but its own body says production trust roots are not provisioned. It must not be wired to an always-true verifier or treated as production trust.

Not established by this checkpoint: all 94 historical repositories recovered; all source files imported; all imported applications build; Android device runtime; production observation trust root; key rotation; deployment, public release, revenue, or external approval.

## Next execution order

1. **Security gate:** isolate and remediate the potentially compromised signing key and inspect wallet/environment/private data before any bulk import. Do not print, copy, or commit secret values.
2. **Recover exact source:** retrieve missing NGL-001 and Command Center assets and the remaining TaskAgile paths from their authoritative source commits. Use blob/tree identity for provenance, then classify each path before import.
3. **Recover missing repositories:** obtain the original source/history for the four README-only placeholders and map each to a distinct Alpha One module or mark it blocked.
4. **Integrate, don't flatten:** one canonical world state, receipt lifecycle, and authority boundary. Imported projects remain named modules/exhibits until interface, dependency, license, and tests are reviewed.
5. **Verify each tranche:** record exact source and target commit/blob IDs, tests actually run, CI run URLs, failures, and runtime/device evidence. No evidence means UNVERIFIED, not passed.
6. **Finish reconciliation:** update the existing file-level ledger and assimilation plan after each real import. Do not create duplicate competing ledgers.

## Review scope of this PR

Documentation-only inventory and next-action checkpoint. It changes no runtime code, secrets, authority configuration, or production state. It does not merge source applications and does not close the outstanding blockers.
