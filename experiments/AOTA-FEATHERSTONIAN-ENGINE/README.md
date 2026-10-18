# AOTA / Featherstonian Engine — Codex handoff package

This is an **experimental Python standard-library prototype**, not an integrated or certified institution.

## Run
```sh
cd experiments/AOTA-FEATHERSTONIAN-ENGINE
python -m unittest -v test_engine.py
python engine.py example_claims.json --root .
```

The gate reads local files, compares SHA-256 bytes to declared digests, caps claim status by available evidence kinds, rejects missing/unsafe paths and dependency cycles, and never promotes a claim above its declared status.

**Critical limitation:** a matching digest does not establish that a test actually ran, a witness is independent, or a claim is true. Treat `source`, `test`, `runtime`, and `external` as *untrusted labels* until linked to authenticated execution and authority records. TOCTOU, file size limits, symlink races, JSON schema validation, and trusted receipt provenance need further review. Do not advertise this as a proof system.

The first local v0.2 prototype was tested with 10 tests before packaging. The repository version must be rerun by Codex and independently reviewed. Read `CODEX-MISSION.md` first.
