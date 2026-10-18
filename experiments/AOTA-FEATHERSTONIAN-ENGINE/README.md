# AOTA / Featherstonian Engine — Codex handoff package

This is an **experimental Python standard-library prototype**, not an integrated or certified institution.

## Run
```sh
cd experiments/AOTA-FEATHERSTONIAN-ENGINE
python -m unittest -v test_engine.py
python engine.py example_claims.json --root .
```

The gate reads local files, compares SHA-256 bytes to declared digests, rejects duplicate use of one artifact for multiple evidence kinds, malformed digests, oversized artifacts and symlinks, caps claim status by available evidence kinds, rejects missing/unsafe paths and dependency cycles, and never promotes a claim above its declared status.

**Critical limitation:** a matching digest does not establish that a test actually ran, a witness is independent, or a claim is true. Treat `source`, `test`, `runtime`, and `external` as *untrusted labels* until linked to authenticated execution and authority records. In particular, the output ceiling `VERIFIED` means only that separately labeled local files match expected hashes, **not** that tests ran or verification occurred. The tool does not implement the No_Gas_Labs™ Founder Gate. TOCTOU, JSON manifest size limits, symlink races, schema validation, and trusted receipt provenance need further review. Do not advertise this as a proof system.

The original package had 10 tests; this revision adds 11 regression cases (21 total). GitHub commits do not establish that the updated suite executed. Codex must run the suite and preserve the actual output. Read `CODEX-MISSION.md` first.
