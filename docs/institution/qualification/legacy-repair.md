# Q-WORLD-002 — legacy projection verification guard

Date: 2026-10-18. Baseline: `0202138e6ab3cfb98cc2a83e37ac7b4d0d56c0d4`.
Classification: **CONFIRMED and REPRODUCED** in the legacy direct-function projection path. Disciplines: software correctness, evidence methodology, human participation/world representation.

The bounded repair requires `observation_verification === "VERIFIED"` in addition to the existing terminal-success conditions and receipt byte checks before legacy world consequences can be awarded. This establishes a necessary condition. It does **not** establish an independently participating observer, authenticated admission, authenticated Founder authority, or full security of a canonical event history. No exploit of, or integration with, the current HTTP game path is demonstrated here.

## Finding and cause

`src/world/project.js` checked accepted admission, authorized authority, executed status, observed evidence, successful outcome, nonempty receipts, and resolvable matching receipt bytes. It omitted observation verification. An otherwise successful event carrying a valid receipt for arbitrary bytes therefore awarded XP, inventory and world flags with an absent, `UNVERIFIED`, lowercase `verified`, or boolean verification field.

The incumbent `an unverified observation cannot mint canonical progress` test supplied no resolver. It passed because receipt verification failed before the omitted marker mattered. The strengthened test supplies the actual fixture bytes through the real receipt verifier, asserts no XP/inventory/world changes, preserves a proposed quest, and retains the event in history.

Impact: legacy projection can represent unsupported progress when it receives such events and a matching resolver. This is a demonstrated library contract violation. Exposure through a current HTTP route, an authenticated event store, or an external participant is unestablished; none is assumed to amplify its severity.

## Competing repairs

The isolated comparator imports the preserved baseline source from Git, constructs a marker-only alternative in memory, and imports the repaired source. Every variant receives the same event, actual SHA-256 receipt and resolver conditions. It uses arbitrary bytes intentionally: content integrity is distinct from independent observation. Marker-only retains the other terminal checks and nonempty receipt requirement but replaces receipt verification with the strict marker comparison. No source file was mutated to test alternatives.

| Controlled case | Baseline XP | Marker-only XP | Marker + existing byte checks XP |
| --- | ---: | ---: | ---: |
| VERIFIED, matching bytes | 100 | 100 | 100 |
| Absent marker, matching bytes | 100 | 0 | 0 |
| UNVERIFIED, matching bytes | 100 | 0 | 0 |
| Lowercase verified, matching bytes | 100 | 0 | 0 |
| Boolean marker, matching bytes | 100 | 0 | 0 |
| VERIFIED, no resolver | 0 | 100 | 0 |
| VERIFIED, changed bytes | 0 | 100 | 0 |
| VERIFIED, forged digest | 0 | 100 | 0 |
| VERIFIED, malformed receipt | 0 | 100 | 0 |
| VERIFIED, empty receipts | 0 | 0 | 0 |
| VERIFIED, absent authority | 0 | 0 | 0 |
| Cases matching the bounded contract | 7/11 | 7/11 | 11/11 |

Disposition: select marker plus existing byte checks. Marker-only repairs the reported omission by discarding an existing protection and fails the integrity controls. The selected guard adds one strict condition and preserves byte verification. The positive arbitrary-byte row also demonstrates the residual: a caller controlling the labels and a matching receipt/resolver can still supply VERIFIED and obtain consequences. This repair does not authenticate those labels.

## Producer and fixture contract repair

`adjudicateExecution` now records VERIFIED on successful outcomes only after its existing output/request binding and artifact-byte verification succeeds. `toWorldEvent` copies the adjudication's marker; accepted status alone does not manufacture one. Regressions cover fabricated accepted objects with a missing or UNVERIFIED marker and valid resolvable receipts: neither awards consequences. An accepted failed execution remains a failed quest with no verified-byte marker or XP.

The existing successful evidence-gameplay and world-spine fixtures now explicitly declare VERIFIED. This intentionally repairs the positive fixtures' contract: their matching bytes remain required, their expected rewards remain intact, and new negative tests first reproduced the missing guard. Assertions were strengthened rather than removed. These fixture labels are test input, not evidence that their observer identity is authenticated.

Changed files are `src/world/project.js`, `src/mesh/execution.js`, the four associated test files (`evidence-gated-gameplay`, `world-projection`, `execution-mesh`, `world-spine`), and this report. No commit, deployment, gate activation, or Founder-authority change is part of this repair.

## Preserved RED/GREEN evidence

Node `v24.19.0`; commands run from the repository root. Raw capture preserves the Node runner exit status. Logs below are local execution receipts under `/tmp`, not external verification.

| Stage | Command | Exit | Result | Raw local log |
| --- | --- | ---: | --- | --- |
| Incumbent tests before edits | `node --test test/evidence-gated-gameplay.test.js test/world-projection.test.js` | 0 | 19 pass, 0 fail | `/tmp/q-world-002-baseline.log` |
| Strengthened tests before guard | same | 1 | 18 pass, 5 fail | `/tmp/q-world-002-red.log` |
| Guard applied | same | 0 | 23 pass, 0 fail | `/tmp/q-world-002-green.log` |
| Producer/fixture contract before producer repair | `node --test test/execution-mesh.test.js test/world-spine.test.js` | 1 | 10 pass, 3 fail | `/tmp/q-world-002-producer-red.log` |
| Projection, execution and replay after repair | `node --test test/evidence-gated-gameplay.test.js test/world-projection.test.js test/execution-mesh.test.js test/world-spine.test.js` | 0 | 36 pass, 0 fail | `/tmp/q-world-002-producer-green.log` |
| Broader related regression | command below | 0 | 63 pass, 0 fail | `/tmp/q-world-002-broader.log` |

The first RED run failed these real behavioral assertions, each with valid receipts and actual matching resolver bytes:

```text
valid artifact bytes with absent observation verification cannot mint world consequences: 100 !== 0
valid artifact bytes with UNVERIFIED observation verification cannot mint world consequences: 100 !== 0
valid artifact bytes with an invalid string observation verification cannot mint world consequences: 100 !== 0
valid artifact bytes with an invalid type observation verification cannot mint world consequences: 100 !== 0
an unverified observation cannot mint canonical progress: 25 !== 0
tests 23; pass 18; fail 5; cancelled 0; skipped 0; todo 0
```

The producer RED run failed positive propagation (`undefined` versus VERIFIED), propagation of the supplied UNVERIFIED value (`undefined` versus UNVERIFIED), and the old omitted-marker world-spine fixture (0 versus 100 XP). After the producer/fixture repair, the focused run reported:

```text
tests 36; pass 36; fail 0; cancelled 0; skipped 0; todo 0
```

Broader command:

```sh
node --test test/evidence-gated-gameplay.test.js test/execution-mesh.test.js test/world-projection.test.js test/world-spine.test.js test/quest-engine.test.js test/location-rpg-integration.test.js test/location-consent.test.js test/game-model.test.mjs test/institution-continuity.test.mjs
```

```text
tests 63; pass 63; fail 0; cancelled 0; skipped 0; todo 0
```

`git diff --check` passed. The comparator executed successfully with all 11 selected-guard expectations asserted. Its reproducible local driver is `/tmp/q-world-002-alternatives.mjs`; complete observations are `/tmp/q-world-002-alternatives.json` (`node /tmp/q-world-002-alternatives.mjs`). The main qualification executor owns integrated full-suite evidence; the 63-test result here is not a full-suite claim.

## Authority, residuals and recovery

The local reversible disposition is within Founder Directive 001 Articles III, VI and VII and the delegated Meteor repair scope. This report is internal AI engineering evidence, not independent human specialist certification. Gate A has the bounded comparison above. Gate B remains unestablished for authenticated admission or actual observer independence. Gate C has local failure preservation and regression evidence; this subtask does not claim the broader commission's transfer test or completion criterion.

The event's admission, authority, execution, observation and verification fields still come from callers. `toWorldEvent` still relies on the provided request and adjudication objects. Correct receipt bytes establish byte integrity only. Direct callers can fabricate VERIFIED alongside valid arbitrary bytes; cryptographic provenance, observer independence, authorization bindings at admission, durable storage, and HTTP exposure require separate evidence and design. This change also does not retroactively remove rewards from a caller-supplied seed state.

Compatibility consequence: historical otherwise-successful events missing VERIFIED no longer mint rewards when replayed from empty state, so their derived world projection/hash can change. Do not silently relabel imported or historical records to recover old rewards. Preserve the original history and compare old/new projections under an explicitly reviewed migration policy if legacy data is used.

Rollback is local and reversible: restore only the one projection condition, the successful adjudication marker/adapter propagation additions, and their associated test hunks from the preserved baseline, while retaining this finding and RED evidence. A rollback reopens the documented defect; it is not a security remedy. Do not reset unrelated qualification work or erase recorded failures.
