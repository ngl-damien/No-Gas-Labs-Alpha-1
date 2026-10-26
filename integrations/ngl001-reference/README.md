# NGL-001 recovery reference

## Source identity

- Source repository: `ngl-damien/ngl001-def4us28`
- Source tree observed: `792b7ebe17dcb92fbbb2223d9cd8fee98d2f78c3`
- Source App.jsx blob: `49ead4502256f11068cb12b7631e4e5054840de5` (4,563,284 bytes)
- Source path: [src/App.jsx](https://github.com/ngl-damien/ngl001-def4us28/blob/main/src/App.jsx)
- Hero asset blob: `02251f4b956c55af2d76fd0788124d7eee2b45eb` (13,057 bytes), recovered into `recovery/public-repos/ngl001-def4us28/src/assets/hero.png` by the accompanying recovery change.

## Recovery disposition

The original `recovery/public-repos/ngl001-def4us28/src/App.jsx` snapshot path is an empty blob, not the real application source. The exact source blob was successfully retrieved and inspected, but the connected GitHub write operation rejected the 4.56 MB content payload; no truncated replacement was written. The file-level ledger records this as `SOURCE_BLOB_VERIFIED_TARGET_EMPTY_WRITE_BLOCKED`.

Two other snapshot files, `contact/ledger.jsonl` and `contact/state.json`, differ from source. They are operational state/receipt material and remain unmerged pending semantic and sensitivity review. The source license and build/runtime compatibility have not been verified here.

## Evidence boundary

The recovered image's Git blob SHA matches the source blob. This proves byte identity for that asset, not that the application builds, is safe, licensed, deployed, or integrated into Alpha One. The full App.jsx remains unresolved until a repository write path can preserve its complete bytes.
