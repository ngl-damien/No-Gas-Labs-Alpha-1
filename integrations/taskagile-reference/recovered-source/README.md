# TaskAgile recovered server/config source

This directory preserves eight additional text files from `ngl-damien/TaskAgile` at source commit `66885999064997b332f61dac13333058c462e857`. The files were absent from the prior 15-file selected reference tranche and are copied without runtime wiring.

## Contents

- Express/WebSocket server entry point and route/storage stubs
- Vite development/static server helper
- Shared database schema
- Vite, Tailwind and TypeScript configuration

## Evidence and limits

- Each source blob SHA is recorded in the parent `SOURCE_MANIFEST.json`.
- Source bytes were retrieved from the exact source commit above.
- No build or tests were run for this tranche.
- This is not a standalone runnable application: the original client tree, dependency graph, environment, and other assets are not all present in this directory.
- **Do not execute or expose this code as an Alpha One service.** The source server accepts WebSocket clients without an evident identity/authorization layer, processes client-provided movement/combat messages, keeps multiplayer state in memory, binds to `0.0.0.0:5000`, and configures Vite `allowedHosts: true`. These are prototype-level behaviors requiring threat review before any adaptation.
- The storage schema includes a password field; no authentication implementation is supplied by the included route stub. Do not infer secure authentication from the schema.

The original TaskAgile repository remains untouched. This import is recovery/provenance only, not integration or a security approval.
