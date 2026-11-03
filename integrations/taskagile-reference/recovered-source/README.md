# TaskAgile recovered source reference

This directory now preserves **85 source files** from `ngl-damien/TaskAgile` that were absent from the original Alpha One recovery snapshot, including the 8-file server/config tranche and 77 additional source/assets. The 15-file selected tranche is preserved under the parent `integrations/taskagile-reference/` path. The complete 169-file disposition is recorded in `TASKAGILE_RECOVERY_MANIFEST.json` at the parent folder and in the file-level reconciliation ledger.

## Current accounting

- 66 source blobs match the original recovery snapshot exactly.
- 100 source files from the original snapshot gap are preserved in the reference area (15 selected files + 8 initial recovery files + 77 additional files).
- Three source PNG blobs remain identified but not copied because the GitHub content interface returned empty content for these multi-megabyte binary files: `production/deathmatch/assets/arena_bg.png`, `musk_fighter.png`, and `trump_fighter.png`. Their source blob SHAs and sizes remain in the manifest/ledger.
- Source code is preserved, not runtime-integrated. The TaskAgile app has not been built or tested by this import.

## License discrepancy

TaskAgile `package.json` declares `MIT`, but the root `LICENSE` and `LICENSE.md` state NGL-A v1.0 with attribution, non-commercial reuse conditions, commercial permission/payment requirements, and AI-training restrictions. This is a material inconsistency. Preserve both files and treat reuse as blocked for commercial deployment until the rights are resolved; do not silently assume MIT-only rights.

## Safety boundary

- `staging/rollback.sh` and `staging/rollback-codex.sh` are preserved as ordinary non-executable source files. They contain `git reset --hard` and `git push --force-with-lease`; do not execute them as part of recovery.
- Prototype server code includes WebSocket/client-action and host-configuration risks documented in the prior tranche README. No service is launched by this import.
- No credentials were copied. Source presence and SHA identity do not establish runtime safety, license clearance, or product readiness.
