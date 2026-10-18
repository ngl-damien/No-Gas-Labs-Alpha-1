# Declared-file component export machinery (M1)

M1 adds a component export capability to the repository. M0 remains the existing Meteor game distribution packager in `scripts/build-game.mjs`. This change makes no speed claim and does not change M0.

## Contract

```js
import {buildComponent} from '../../../src/production/component-package.mjs';
const result = await buildComponent({rootDir, profile, outDir});
// {archivePath, manifestPath, manifest}
```

`rootDir` defaults to this repository. Relative API `outDir` values resolve against `rootDir`. The output parent must already exist; the final output directory must not exist. Node 24 on Linux with `/proc/self/fd`, `O_DIRECTORY`, and `O_NOFOLLOW` is required. Unsupported platforms fail closed.

```sh
node scripts/package-component.mjs --profile PROFILE.json --out NEW_DIRECTORY
node scripts/package-component.mjs --root REPOSITORY --profile PROFILE.json --out NEW_DIRECTORY
```

CLI paths resolve against the working directory; the default source repository comes from the script location. Success prints one JSON result. Invalid or duplicate CLI flags fail. The profile must be a regular JSON file of at most 4 MiB, read with bounded nonblocking file reads; malformed profile content is not echoed in parse errors.

A profile has exactly four fields:

```json
{
  "schema": "ngl.component-profile.v1",
  "id": "example-component",
  "entryPoint": "lib/main.mjs",
  "files": [
    {"source": "public/main.mjs", "target": "lib/main.mjs"},
    {"source": "public/example.json", "target": "data/example.json"}
  ]
}
```

`entryPoint` must exactly name a selected target. The id contains one to eighty lowercase ASCII letters, digits, or hyphens and starts with a letter or digit. Each file entry has exactly `source` and `target`. Sources are literal repository-relative files; JSON is supported. The exporter never follows imports, discovers repository files, runs payloads, starts a shell, calls an API, merges changes, or grants authority.

The fresh output directory contains `<id>.zip` and `manifest.json`. The ZIP contains exactly the declared targets plus its own byte-identical `manifest.json`. The manifest schema is `ngl.component-manifest.v1`; it records `id`, `entryPoint`, `totalBytes`, and `files: [{source,target,size,sha256}]`. Sizes and hashes identify the exact source bytes included at each target. They do not establish truth, safety, authorship, licensing, acceptance, or execution success. ZIP timestamps are fixed; identical profiles and bytes produce identical archive bytes.

## Boundary checks

- Reject unknown schemas or fields, malformed entries, undeclared entry points, duplicate sources or targets, case aliases, and file/directory collisions. `manifest.json` is reserved.
- Reject absolute, traversal, backslash, NUL/control, ambiguous, non-NFC, Windows-device, trailing-dot/space, or otherwise nonportable relative paths. Paths are at most 1,024 UTF-8 bytes; components are at most 255 bytes; profiles select at most 4,096 files.
- Deny known credential and private/runtime path names, including `.runtime`, `runtime`, `.git`, `.ssh`, `.aws`, `.env*`, secret/credential/keypair names, private-key containers, and saved-state names. Scan every complete selected buffer for PEM private-key headers. This is a defined denylist and key-material check, not a general secret detector: a caller remains responsible for declaring public sources.
- Walk every directory component using pinned Linux directory descriptors and no-follow opens. Open regular files with no-follow and nonblocking flags. Reject symbolic links, nonregular files, and any hardlink count other than one. This conservatively rejects even benign hardlinks without scanning unrelated private directories.
- Compare bigint device/inode, mode, link count, size, nanosecond modification time, and change time around bounded reads. Read every selected source again and compare metadata and SHA-256 before generating outputs, catching earlier-file mutations while later files were gathered. All selected traversal begins at the original pinned repository descriptor.
- Enforce 8 MiB per source and 32 MiB total selected payload. Generated manifest metadata is additional. Outputs use exclusive file creation through a pinned fresh directory; existing destinations and selected-source overlaps are rejected. Failure cleanup targets only generated files in the newly created directory.

The host kernel, procfs, and operating-system owner of the output parent remain trusted. Node builtins cannot atomically return a descriptor for a newly created directory: a hostile process with the same UID could substitute a directory between `mkdir` and the first identity check. The mode, identity, and namespace checks reduce this window; they do not eliminate it. This exporter is not a native operating-system sandbox. Concurrent writers can cause rejection. Changes after final source verification do not alter the already captured archive bytes. The archive is never extracted or executed by this machinery.

## Verification evidence

The initial focused RED run reported **14 failed / 0 passed**, demonstrating the absent exporter and CLI. Added regressions separately failed for a descriptor leak on invalid output parents, malformed-profile error content, and FIFO profile blocking. Both were corrected.

The final focused command is:

```sh
node --test test/component-package.test.mjs
```

On Node **24.19.0**, the current result is **17 passed / 0 failed / 0 skipped**, with no warnings. Tests independently read the ZIP central directory, match external and embedded manifests, compare source bytes/SHA-256/sizes, include selected JSON while excluding undeclared neighbors, exercise strict schema/path/private-material denials, symbolic and hardlink aliases, nonregular/FIFO sources, size limits, fresh output preservation, descriptor cleanup, an actual source mutation injected during file reads, CLI behavior, profile regular-file/4 MiB bounds, and parse-error redaction.

The Linux FIFO negative fixtures require executable `/usr/bin/mkfifo`; both calls use this absolute path so they work under Forge’s Node-only `PATH`. The focused suite was also verified with `PATH` containing only the Node binary directory: **17 passed / 0 failed / 0 skipped**.

No full repository suite, commits, or publication were performed by the machinery worker. Task A's profile was the only workload profile inspected; no Task B profile, TRU source, or Task B result was read or used to tune the exporter.
