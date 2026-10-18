# Q-WORLD-001: institutional experiment report consistency

The original project projection treated `m1.accepted` as a truthy value. A clone of the retained experiment report with `accepted: "false"` therefore produced a `LOCALLY_TESTED` accomplishment. Explicit boolean `true` also survived contradictory metadata: zero tests, test failure, failed integrity, retained errors, missing file coverage, build failure, and entry point failure.

The bounded repair exports `validateExperimentReport(report)` from `src/institution/experiment-report.mjs` and calls it before project receipts or accomplishments are produced. It returns the original report after checking consistency and throws `Invalid institutional experiment report: …` on invalid input. It neither changes the report nor executes its claimed commands.

Accepted outcomes require boolean acceptance and integrity, an empty string-array of errors, positive safe required-file counts consistent with the task, exact matched-file coverage, positive safe test counts with exit code zero, and an entry point whose boolean `passed` is true or whose exit code is zero. Explicit failure flags and conflicting nonzero exit codes reject acceptance. Build metadata remains optional for historical compatibility; when present on an accepted outcome it must report exit code zero without contradictory failure flags. Known execution counts, durations, commands, hashes, and result flags are checked for their explicit types. Rejected outcomes may retain failures, zero tests, and safe negative subprocess exit codes representing Python signal termination.

`TRANSFER_OBSERVED_COMPONENT_DELIVERY` additionally requires both M1 outcomes accepted, both M0 outcomes rejected with integrity true, and source integrity true. `INCONCLUSIVE` reports remain usable without being upgraded. No XP, promotion, authority, operational decision or review clock is granted. The accomplishment limitation now says: “Report consistency only; not independent verification of execution or external use.” A consistent self-reported result is still not independent evidence that execution happened.

## Test-first evidence and candidate comparison

All fixtures clone the actual retained `docs/institution/compounding/evidence/experiment.json`; the positive compatibility check also loads `experiment-initial.json`, whose accepted outcomes omit build metadata. Production code was unchanged when the initial 60-test run produced **4 passing / 56 failing** tests. The actual temporary type-only patch produced **7 passing / 53 failing** on those same 60 tests. The shared validator then produced **60 passing / 0 failing**.

A read-only review identified that Python subprocess signal return codes can be negative. A new INCONCLUSIVE SIGKILL fixture first failed **0 passing / 1 failing**. Allowing safe signed integer exit codes, while retaining the accepted-outcome requirement of exactly zero, made the final focused suite **61 passing / 0 failing**.

The final controlled replay used the same 61 fixtures for all three candidates:

| Candidate | Pass | Fail | Exit |
| --- | ---: | ---: | ---: |
| Original projection from commit `0202138e6ab3cfb98cc2a83e37ac7b4d0d56c0d4` | 5 | 56 | 1 |
| Original plus explicit boolean `m0.accepted` / `m1.accepted` checks | 8 | 53 | 1 |
| Shared consistency validator | 61 | 0 | 0 |

The comparison is executed behavior, not a predicted result. The type-only candidate is an actual temporary copy of the original module with this insertion immediately before `result.accomplishments.push({`:

```js
if(typeof task.m1.accepted!=='boolean'||typeof task.m0.accepted!=='boolean')throw Error('Invalid institutional experiment report: accepted must be boolean');
```

Both temporary candidates replace the relative kernel import with the absolute file URL solely so they can run from `/tmp`. Tests select them through `NGL_REPORT_PROJECTION_CANDIDATE`:

```sh
NGL_REPORT_PROJECTION_CANDIDATE=file:///tmp/q-world-project-projection-original.mjs node --test --test-reporter=tap test/institution-report.test.mjs
NGL_REPORT_PROJECTION_CANDIDATE=file:///tmp/q-world-project-projection-type-only.mjs node --test --test-reporter=tap test/institution-report.test.mjs
node --test --test-reporter=tap test/institution-report.test.mjs
```

Original source SHA-256 before its `/tmp` import adjustment: `a961e6b5be363fcf458e9fdf2e87d3a964ac2cc728b01c0f9ecb1acd40f46c76`. Temporary original candidate: `2a892e2058fc77f1e0a2a92fded9a2566150f04e7e1c42231a51195ab3b9a315`. Temporary type-only candidate: `1fdc855c3316ccc271a17a5508265aa20bf419d8d83a0eac2d99aa2fc43ec9aa`. Final test file: `b64918fb36eeda4ff939e745601383a48b465fdd1df6c3954049b6c9a95561ad`.

The complete normalized outcome table follows below. “Fail” means the test oracle failed; the retained-report compatibility test also requires the explicit consistency limitation, so its original/type-only failures do not mean those reports were rejected. The original missing-task exceptions also fail the normalized validation-error assertion.

## Verification and freeze

The final focused suite passed **61/61**. A real local HTTP server loaded the actual retained report and returned HTTP 200 from `/api/projects` with two `LOCALLY_TESTED` accomplishments; `/api/state` remained a witness with XP zero. A clone containing `accepted: "false"` was rejected during server startup. No game-decision fixture changes were necessary.

Two actual `npm test` runs passed: the earlier run had 309 passing tests; the final agent run had 311 passing tests, zero failures, skips or todos. Other qualification work was concurrent, so these are observed run counts, not a claim that all other source had already frozen. The root agent owns the final combined qualification run. `git diff --check` passed before the documentation write-up. No dependencies, setup configuration, recovery implementation, transfer profile or application design were changed by this repair.

Frozen source hashes communicated to the root agent before the separate transfer work:

- `src/institution/experiment-report.mjs`: `39538f55b4933c7a811bc9b9b5ae583091528b00f1ad995a1fa4a7d2703b51aa`
- `src/institution/project-projection.mjs`: `d19a428daacb89aeee9b219d0c71423661b678037b1963c8d2ee1598e31f6a17`

Local raw-run receipts (ephemeral files; the normalized comparison below is retained here):

| Run | SHA-256 |
| --- | --- |
| `/tmp/q-world-report-original-comparison.tap` | `59353aeac095d9bf8d8069e9d8c35d4d8fb4a63c07a008808369d153f0ce52b9` |
| `/tmp/q-world-report-type-only-comparison.tap` | `c5d82e97ce343441e331eb9a2e0d36ae3dbc303e97ea4e76f7be8c81041b26e9` |
| `/tmp/q-world-report-final-green.tap` | `330dff615f0bdcfdaff6dd978f84b2aefea90422286ad004a71be1a6f2bad7c8` |
| `/tmp/q-world-report-full-suite-final.log` | `c4091c13e2cd6be2233ac295aa0f70afca777b7ed763197eeb0b4785a88c7fa9` |

## Retained candidate outcomes

| Fixture | Original | Type-only | Shared |
| --- | --- | --- | --- |
| both retained reports remain usable without making execution or authority claims | Fail | Fail | Pass |
| a consistent INCONCLUSIVE report can retain failed executions and zero tests | Pass | Pass | Pass |
| an accepted baseline remains representable without claiming transfer | Pass | Pass | Pass |
| INCONCLUSIVE reports retain a rejected subprocess killed by a signal | Pass | Pass | Pass |
| report guard rejects candidate accepted string false | Fail | Pass | Pass |
| report guard rejects candidate accepted numeric one | Fail | Pass | Pass |
| report guard rejects baseline accepted string false | Fail | Pass | Pass |
| report guard rejects zero accepted tests | Fail | Fail | Pass |
| report guard rejects negative tests | Fail | Fail | Pass |
| report guard rejects unsafe test count | Fail | Fail | Pass |
| report guard rejects fractional tests | Fail | Fail | Pass |
| report guard rejects string test count | Fail | Fail | Pass |
| report guard rejects missing test count | Fail | Fail | Pass |
| report guard rejects failed tests | Fail | Fail | Pass |
| report guard rejects string test exit | Fail | Fail | Pass |
| report guard rejects missing test exit | Fail | Fail | Pass |
| report guard rejects tests explicitly failed | Fail | Fail | Pass |
| report guard rejects candidate integrity failed | Fail | Fail | Pass |
| report guard rejects candidate integrity string | Fail | Fail | Pass |
| report guard rejects missing integrity | Fail | Fail | Pass |
| report guard rejects accepted with retained error | Fail | Fail | Pass |
| report guard rejects errors string | Fail | Fail | Pass |
| report guard rejects non-string error | Fail | Fail | Pass |
| report guard rejects missing errors | Fail | Fail | Pass |
| report guard rejects zero task required files | Fail | Fail | Pass |
| report guard rejects unsafe required files | Fail | Fail | Pass |
| report guard rejects fractional required files | Fail | Fail | Pass |
| report guard rejects string required files | Fail | Fail | Pass |
| report guard rejects candidate file requirement differs | Fail | Fail | Pass |
| report guard rejects baseline file requirement differs | Fail | Fail | Pass |
| report guard rejects no matched files | Fail | Fail | Pass |
| report guard rejects negative matched files | Fail | Fail | Pass |
| report guard rejects excess matched files | Fail | Fail | Pass |
| report guard rejects string matched files | Fail | Fail | Pass |
| report guard rejects failed build | Fail | Fail | Pass |
| report guard rejects build explicitly failed | Fail | Fail | Pass |
| report guard rejects missing build exit | Fail | Fail | Pass |
| report guard rejects null build | Fail | Fail | Pass |
| report guard rejects failed command entry point | Fail | Fail | Pass |
| report guard rejects failed browser entry point | Fail | Fail | Pass |
| report guard rejects string browser passed | Fail | Fail | Pass |
| report guard rejects false browser passed despite zero exit | Fail | Fail | Pass |
| report guard rejects true browser passed despite failed exit | Fail | Fail | Pass |
| report guard rejects explicit failed entry point flag | Fail | Fail | Pass |
| report guard rejects missing entry point | Fail | Fail | Pass |
| report guard rejects empty entry point | Fail | Fail | Pass |
| report guard rejects TRANSFER with accepted baseline | Fail | Fail | Pass |
| report guard rejects TRANSFER with failed baseline integrity | Fail | Fail | Pass |
| report guard rejects TRANSFER with failed source integrity | Fail | Fail | Pass |
| report guard rejects TRANSFER with rejected candidate | Fail | Fail | Pass |
| report guard rejects unknown classification | Fail | Fail | Pass |
| report guard rejects wrong schema | Pass | Pass | Pass |
| report guard rejects blank report id | Fail | Fail | Pass |
| report guard rejects non-object tasks | Fail | Fail | Pass |
| report guard rejects missing second task | Fail | Fail | Pass |
| report guard rejects non-string contradiction | Fail | Fail | Pass |
| report guard rejects negative archive bytes | Fail | Fail | Pass |
| report guard rejects non-finite duration | Fail | Fail | Pass |
| report guard rejects invalid command metadata | Fail | Fail | Pass |
| report guard rejects invalid digest metadata | Fail | Fail | Pass |
| null reports continue to project no accomplishments | Pass | Pass | Pass |
