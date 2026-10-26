# DIA P2E Cockpit — Partial Source Preservation

**Source:** `ngl-damien/ngl-recovery-2026-10-25/cockpit/`  
**Reported original head:** `e5fcc85bd4157e680dcbb711faa119a08457a37c` (from source FILE_INVENTORY.md; not independently verified against the original private repository).  
**Status:** partial source reference only; not runnable and not integrated into Alpha One's canonical game state.

This import preserves six text files from the recovered cockpit folder: App.js, package.json, FILE_INVENTORY.md, BlessingsLog.js, GameDashboard.js, and useGameState.js. The inventory names additional missing files, including App.css, main.js, GameContainer, ProfileManager, ResetButton, StatsPanel, and related hooks/utilities. Those omissions prevent treating this snapshot as a complete application.

The original code tracks XP and shrine blessings in React client state and exposes a reset. That is not a trusted source for canonical Alpha One progression, XP, or authority. Reuse only behind Alpha One's existing server-/kernel-controlled state and evidence boundaries. No build or runtime test is claimed. Source licensing has not yet been established; preserve attribution and resolve license before redistribution or production reuse.
