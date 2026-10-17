# Executable Forge

Forge compares trusted local JavaScript candidates by executing them in separate copied workspaces. It never merges a candidate, edits the source checkout, expands an authority grant, installs a dependency, or calls an AI provider.

```sh
node scripts/forge.mjs list
node scripts/forge.mjs demo --out /tmp/ngl-forge-review-001
node scripts/forge.mjs verify --out /tmp/ngl-repository-review-001
node --test test/forge-runner.test.mjs
```

The output directory must be fresh. The demo really runs the correct, incorrect and nonterminating fixtures in that order. Its expected outcomes are `passing`, `failed` and `timed_out`. Demonstrating those expected failures makes the CLI succeed; an unexpected outcome makes it exit nonzero. Invalid arguments and rejected policies also exit nonzero. The CLI prints a short JSON summary; the full machine-readable result is `report.json` under the requested directory.

## Library contract

```js
import { compareCandidates, runCandidate, forgeCapabilities } from './src/forge/runner.mjs';

const report = await compareCandidates({
  sourceDir: '/absolute/path/to/repository',
  outDir: '/tmp/fresh-forge-run',
  workloadId: 'vector-sum-v1',
  candidates: [
    {
      id: 'loop',
      overlay: {
        'fixtures/forge/workload/candidate.mjs':
          'export function sum(values) { let n = 0; for (const value of values) n += value; return n; }'
      }
    }
  ],
  limits: { timeoutMs: 1000, maxOutputBytes: 65536, concurrency: 1 }
});
```

`runCandidate({candidate, ...options})` returns the same report shape with one result. `forgeCapabilities()` describes the actual static policy without running a candidate. `listWorkloads()` returns the allowed workload definitions. Unknown fields are rejected, including arbitrary command arguments.

Candidate comparison implements `vector-sum-v1`. The benchmark sums the same deterministic vector of 10,000 signed integers 200 times. The parent sends seven deterministic challenges, including empty, negative and fractional input, to a second, fresh Node process. That harness captures I/O and primitive serializers before dynamically importing the candidate, then returns the actual per-case result and post-call vector. The parent independently compares every returned value and input vector with its expected bytes; mutable assertions or serializer/prototype changes inside the candidate process do not grant correctness. `verificationChecks` records the challenge digest, protocol validity and failed case indices. The parent also checks the benchmark's exact expected checksum. Every copied source file must retain its expected bytes. A wrong result, verifier failure or changed source file disqualifies a candidate regardless of its speed.

The only overlay path is `fixtures/forge/workload/candidate.mjs`. No caller can overlay the harness, original tests, README, core, evidence, authority files or institutional code. An empty overlay runs the checked-out baseline candidate. An overlay contains UTF8 source, with a 65,536-byte maximum. There is no command string, shell, install hook, remote adapter or automatic integration API.

## Repository verification

`repository-tests-v1` executes actual repository tests over a frozen copy of the supplied source. It accepts no overlays, test selectors or arbitrary command arguments:

```js
import { verifyRepository } from './src/forge/runner.mjs';
const report = await verifyRepository({
  sourceDir: '/absolute/path/to/repository-or-public-source-package',
  outDir: '/tmp/fresh-repository-verification',
  limits: { timeoutMs: 30000, maxOutputBytes: 1048576, concurrency: 2 }
});
```

The fixed selection includes direct `test/*.test.js`, `test/*.test.mjs`, `genesis.test.mjs` and direct `reconstitution/*.test.js|mjs` paths that are present in the snapshot. `test/forge-runner.test.js|mjs` is excluded to prevent recursive Forge workspace copying. Paths are sorted and passed explicitly to `node --test --test-reporter=tap --test-concurrency=N`; there is no recursive test discovery. The test worker concurrency is 1–4, the phase timeout is 50–120,000 ms (default 30,000), and the combined stdout/stderr bound is 1,024–1,048,576 bytes (default 1 MiB). Source and per-child heap bounds remain the same as candidate comparison.

The report schema is `ngl.forge-repository-report.v1`. It retains `source/`, `source-manifest.json`, `workspace/`, actual `verification.stdout.log` and `verification.stderr.log` byte receipts, and `report.json`. `tests.paths` records exactly what ran; `tests.counts` records TAP totals, passed, failed, cancelled, skipped and todo tests; `tests.failures` retains reported `not ok` lines. A passing result requires child exit zero, a complete TAP summary, at least one passing executed test, zero failed/cancelled tests and unchanged copied source bytes. Empty or skipped-only workloads fail. Source snapshot failures and changed copied bytes report `source_failed`; timeouts and output bounds have explicit `timed_out` and `output_limited` outcomes. The CLI returns nonzero for every unsuccessful verification.

Repository timing records actual child `runtimeMs`, source snapshot and copy costs, host `integrityMs`, complete `verificationOverheadMs` (log retention, TAP validation and source integrity checks) and total `wallMs`. No candidate comparison or productivity multiplier is inferred from a repository check.

Git checkouts use the same tracked/nonignored source manifest as candidate comparison. When the selected source root has no `.git`, both repository verification and candidate comparison use a bounded public-source fallback: fixed roots `src`, `test`, `fixtures`, `scripts`, `game`, `docs/meteor` and `reconstitution`, plus selected root source/manifest files, and only public source/asset extensions (`mjs`, `js`, `html`, `css`, `md`, `py`, `json`, `jpg`, `png`). Hidden paths, known credential filenames, runtime and dependency/build directories are omitted. Traversal, file count and byte limits still apply; links are refused. This fallback records `snapshotMode:'public-source'`, `revision.head:null` and `revision.dirty:null`. It does not invent Git history or claim to evaluate Git-ignore rules in a source package. A present but corrupt `.git` file or directory remains an explicit error; arbitrary Git failures do not trigger the fallback. Consequently the demo and repository commands also run from an extracted public source ZIP without Git metadata.

## Copies and receipts

For Git-backed runs, Forge enumerates tracked and nonignored untracked files, excludes tracked files matching ignore rules, and excludes known runtime, dependency, build, metadata and credential filenames. It refuses symbolic links, including links in directory components. The snapshot is frozen in memory before workspace copies are made; concurrent source changes after a file is read cannot change that workspace's input bytes.

The manifest records HEAD, whether the source tree was dirty, and each included path, exact byte length and SHA-256 digest. HEAD is contextual: a dirty snapshot is not represented as the pristine commit. The content digest identifies the actual retained bytes. Task IDs deterministically bind the content digest, workload, candidate ID, overlay byte receipts and limits; timestamps, PIDs, output paths and measured times do not affect those IDs.

```text
<out>/
  report.json
  source-manifest.json
  source/                         exact original snapshot bytes
  candidates/<candidate-id>/
    workspace/                    disjoint copy plus this candidate's overlay
    execution.stdout.log
    execution.stderr.log
    verification.stdout.log       when verification ran
    verification.stderr.log       when verification ran
    result.json
```

Log receipts contain relative paths, SHA-256 digests and exact captured byte lengths. When output exceeds the limit, retained logs contain only the bounded prefix and the outcome is `output_limited`. A timeout is `timed_out`; a child error is `failed` or `spawn_failed`. Verification is explicitly `not_run` when execution fails. Directories remain for review rather than being silently deleted. Before any directory creation, Forge resolves the output's nearest existing ancestor to its physical path and applies the source containment guard there; a symlink alias cannot redirect output into an unapproved source directory. Outputs physically inside the source checkout are allowed only under `.runtime/`; `/tmp` is the recommended destination.

## Bounds and measurements

The caller may lower or raise bounds only inside the fixed policy:

| Bound | Default | Allowed |
| --- | --- | --- |
| Candidates | — | 1–8 |
| Concurrent candidate jobs | 1 | 1–4 |
| Time per child phase | 1,000 ms | 50–10,000 ms |
| Combined stdout/stderr per phase | 65,536 bytes | 1,024–1,048,576 bytes |
| V8 old-space heap per child | 128 MiB | fixed |
| Source files | — | at most 4,096 |
| Individual source file | — | at most 4 MiB |
| Total retained input snapshot | — | at most 32 MiB |

Each phase uses `spawn(process.execPath, args, {shell:false})`, a minimal environment without inherited secret variables, a private working directory, a wall-clock timer and bounded output collection. Benchmark stdin is closed; verification receives only its bounded JSON challenge and then EOF. POSIX process-group termination also kills ordinary descendants that share the group. Time bounds are per execution/verification phase, so a candidate that completes both phases can use twice the configured phase limit plus copy, logging and integrity overhead. Very small output limits can reject a correct candidate because its full verification evidence does not fit.

`timing.runtimeMs` measures the benchmark child from spawn through close, including Node startup. `verificationMs` measures the verification child. `integrityMs` records host-side copied-source checks. `verificationOverheadMs` includes verification child startup/execution, its log retention, integrity checks and result validation. `copyMs` and total candidate `wallMs` are separate. Report timing also records snapshot cost and aggregate runtime/verification overhead. Aggregate times can exceed elapsed report wall time when concurrency is greater than one.

Only candidates with `correct:true` enter the comparison. With two or more passing candidates, `comparison.speedup` is the slowest passing runtime divided by the fastest passing runtime for this single local run. With fewer than two it is `null`. This measurement has startup and scheduling noise; it is not a human-work baseline, a sustained performance guarantee or a productivity multiplier.

## Trust boundary

This is a trusted local repository runner, not an adversarial OS sandbox. Candidates execute as the host user, can access the host filesystem using absolute paths, and retain the host's network access. Filename filtering cannot identify secrets embedded in ordinary source files. The fixed V8 heap is not an OS memory limit, and this runner does not enforce disk quotas, prevent hostile process-group escape, or prove that malicious code is truthful. Source-integrity checks detect changes that remain in the copied workspace after execution; they cannot establish hostile-code containment. Run reviewed candidates here. Untrusted submissions require an additional externally enforced filesystem, process, network and resource sandbox before execution.

These limits do not change institutional authority. Passing this fixture proves only that these bytes passed this workload and verifier in this recorded run.

## Verification record

On October 17, 2026, `node --test test/forge-runner.test.mjs` first failed six tests because the runner and CLI did not exist. After implementation, all six passed. Two additional acceptance tests then failed on an absent full-verification-overhead measurement and unfiltered `.npmrc` credentials configuration. After those specific changes, all eight tests passed (8 passed, 0 failed, approximately 3.55 seconds).

Independent review then reproduced a false positive caused by monkeypatching shared child assertions, and a source-output guard bypass through a symlinked parent directory. Two regression tests failed on those exact behaviors before the fixes. After parent-owned challenge/result checks and physical output ancestry validation, all ten focused tests passed (10 passed, 0 failed, approximately 3.77 seconds).

The repository workload added four failing acceptance tests before implementation, then a failing CLI fixture test before the CLI command existed. After implementing real copied test execution, parent-side TAP completion checks, source integrity checks, timeout policy, Gitless public-source snapshots and CLI status propagation, the complete focused Forge suite passed (16 passed, 0 failed, approximately 5.19 seconds). These checks execute only disposable miniature repositories; the integration owner executes the full Alpha-1 repository workload.

An extracted-package review then showed that the demo had not enabled the same public-source fallback. A real Gitless comparison/demo regression failed on `git rev-parse`; after enabling the existing bounded policy, both that test and the corrupt-Git-metadata rejection test passed. Public package manifests retain null Git revision fields throughout.

The tests use actual Git fixture repositories, source copies and Node child processes. They cover correct/incorrect candidates, timeout and output termination, retained hashes and source bytes, deterministic IDs, passing-only comparison, protected path and command rejection, symbolic-link source/output boundaries, ignored/tracked-ignore/credential omission, copied constitutional-byte tampering, inherited-secret omission, assertion/serializer/prototype monkeypatches, and a real CLI demo. The integration owner runs the complete repository suite separately.
