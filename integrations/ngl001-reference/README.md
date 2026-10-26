# NGL-001 recovery reference

## Source identity

- Source repository: `ngl-damien/ngl001-def4us28`
- Source tree observed: `792b7ebe17dcb92fbbb2223d9cd8fee98d2f78c3`
- Source App.jsx blob: `49ead4502256f11068cb12b7631e4e5054840de5` (4,563,284 bytes)
- Source path: [src/App.jsx](https://github.com/ngl-damien/ngl001-def4us28/blob/main/src/App.jsx)
- Hero asset blob: `02251f4b956c55af2d76fd0788124d7eee2b45eb` (13,057 bytes), recovered into `recovery/public-repos/ngl001-def4us28/src/assets/hero.png` by the accompanying recovery change.

## Recovery disposition

The original `recovery/public-repos/ngl001-def4us28/src/App.jsx` snapshot path is an empty blob, not the real application source. The exact source blob was successfully retrieved and inspected, but the connected GitHub write operation rejected the 4.56 MB content payload; no truncated replacement was written. The file-level ledger records this as `SOURCE_BLOB_VERIFIED_TARGET_EMPTY_WRITE_BLOCKED`.

The source `contact/ledger.jsonl` (128 observations) and `contact/state.json` were verified as a consistent pair: the earlier 22-record snapshot was an exact prefix of the 128-record source ledger, and each state file's `last_event_hash` matched the last record present in its corresponding snapshot. Both files have now been restored byte-for-byte from the source and their target blob SHAs recorded in the reconciliation ledger. The source repository and Alpha One are public; this import adds no new privacy boundary, but the ledger remains source data rather than an independently verified truth record. The source license and build/runtime compatibility have not been verified here.

## Evidence boundary

The recovered image's Git blob SHA matches the source blob. This proves byte identity for that asset, not that the application builds, is safe, licensed, deployed, or integrated into Alpha One. The full App.jsx remains unresolved until a repository write path can preserve its complete bytes.
