import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

test('Android emulator acceptance invokes a standalone Package Manager probe before instrumentation', async () => {
  const source = await readFile(new URL('../.github/workflows/android-alpha1.yml', import.meta.url), 'utf8');
  const start = source.indexOf('      - name: Run offline-world emulator journey');
  const end = source.indexOf('      - name: Preserve debug APK', start);
  assert.ok(start >= 0 && end > start, 'the Android emulator journey step must remain present');

  const emulatorStep = source.slice(start, end);
  assert.match(emulatorStep, /^\s{10}emulator-boot-timeout:\s*900\s*$/m,
    'allow a 15-minute cold boot on the observed slow macOS Intel runner');
  const packageProbe = emulatorStep.indexOf('sh scripts/wait-for-android-package-manager.sh');
  const instrumentationCommandIndex = emulatorStep.indexOf('gradle -p android :app:connectedDebugAndroidTest');
  assert.ok(packageProbe >= 0 && instrumentationCommandIndex > packageProbe,
    'the standalone Package Manager probe must run before Android instrumentation installs split APKs');
  assert.ok(!emulatorStep.includes('for attempt in'),
    'compound probe control flow must not be split into separate emulator-runner shell commands');

  const probeScript = await readFile(new URL('../scripts/wait-for-android-package-manager.sh', import.meta.url), 'utf8');
  assert.match(probeScript, /while \[ "\$attempt" -le "\$attempt_limit" \]; do/,
    'the readiness loop must be bounded by an explicit attempt limit');
  assert.match(probeScript, /adb shell cmd package list packages/,
    'readiness must be based on the actual Package Manager package-list command');
  assert.match(probeScript, /grep -q '\^package:'/,
    'readiness must require a real package listing, not merely a successful shell response');
  assert.match(probeScript, /attempt_limit=\$\{NGL_ANDROID_PACKAGE_PROBE_ATTEMPTS:-30\}/);
  assert.match(probeScript, /delay_seconds=\$\{NGL_ANDROID_PACKAGE_PROBE_DELAY_SECONDS:-2\}/);
  assert.match(probeScript, /-gt 30/);
  assert.match(probeScript, /-gt 10/);
  assert.ok(probeScript.includes('service check package') &&
    probeScript.includes('getprop sys.boot_completed') &&
    probeScript.includes('getprop init.svc.package'),
    'an unavailable service must preserve service, boot and package-init diagnostics');
  assert.ok(probeScript.includes('Android Package Manager did not become ready'),
    'a cold-start service failure must be explicit rather than misreported as an instrumentation test failure');

  assert.match(source, /^\s{4}timeout-minutes:\s*40\s*$/m,
    'retain the bounded 40-minute job ceiling');
  assert.equal((source.match(/test\/android-workflow\.test\.mjs/g) ?? []).length, 3,
    'the regression must remain in both workflow path filters and the Android preflight');
  assert.equal((source.match(/scripts\/wait-for-android-package-manager\.sh/g) ?? []).length, 4,
    'the standalone probe must be filtered and fingerprinted in both workflow paths and preflight');
  assert.match(source, /--receipt "agent-preflight-android-\$\{GITHUB_RUN_ID\}\.json"/,
    'the receipt uses a root-level path so descriptor-pinned creation needs no parent directory');
  assert.match(source, /path: agent-preflight-android-\$\{\{ github\.run_id \}\}\.json/,
    'the non-hidden root-level receipt must be preserved as an artifact');

  const instrumentation = await readFile(new URL('../android/app/src/androidTest/java/labs/nogas/commonground/MainActivityTest.java', import.meta.url), 'utf8');
  assert.match(instrumentation, /window\.__nglAndroidReloadMarker = 'private-save-reset'/,
    'the reset journey marks the old document before requesting a reload');
  assert.match(instrumentation, /typeof window\.__nglAndroidReloadMarker === 'undefined'/,
    'the reset journey must observe a fresh document before clicking its entry control');
  assert.match(instrumentation, /the reset private world has no published creations/,
    'fresh-world state is asserted separately so failures identify the mismatched projection');
});

test('Android Package Manager probe has valid POSIX syntax and bounded success/failure behavior', async () => {
  const scriptPath = fileURLToPath(new URL('../scripts/wait-for-android-package-manager.sh', import.meta.url));
  const syntax = spawnSync('sh', ['-n', scriptPath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout || 'Package Manager probe shell syntax failed');

  async function runWithFakeAdb(fakeAdb, overrides = {}) {
    const root = await mkdtemp(join(tmpdir(), 'ngl-android-package-manager-'));
    try {
      const bin = join(root, 'bin');
      await mkdir(bin);
      const adbPath = join(bin, 'adb');
      await writeFile(adbPath, fakeAdb, { mode: 0o755 });
      await chmod(adbPath, 0o755);
      return spawnSync('sh', [scriptPath], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: bin + delimiter + (process.env.PATH ?? ''),
          NGL_ANDROID_PACKAGE_PROBE_ATTEMPTS: '2',
          NGL_ANDROID_PACKAGE_PROBE_DELAY_SECONDS: '0',
          ...overrides
        }
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  const ready = await runWithFakeAdb(`#!/bin/sh
case "$*" in
  "shell cmd package list packages") printf 'package:android\\n' ;;
  *) printf 'unexpected adb command: %s\\n' "$*" >&2; exit 64 ;;
esac
`);
  assert.equal(ready.status, 0, ready.stderr || ready.stdout);
  assert.match(ready.stdout, /Android Package Manager ready after 1 probe/);

  const unavailable = await runWithFakeAdb(`#!/bin/sh
case "$*" in
  "shell cmd package list packages") printf "Can't find service: package\\n" >&2; exit 1 ;;
  "shell service check package") printf 'Service package: not found\\n' ;;
  "shell getprop sys.boot_completed") printf '1\\n' ;;
  "shell getprop init.svc.package") printf 'stopped\\n' ;;
  *) printf 'unexpected adb command: %s\\n' "$*" >&2; exit 64 ;;
esac
`);
  assert.equal(unavailable.status, 1, unavailable.stderr || unavailable.stdout);
  assert.match(unavailable.stdout, /did not become ready after 2 probe/);
  assert.match(unavailable.stdout, /Can't find service: package/);
  assert.match(unavailable.stdout, /Service package: not found/);
  assert.match(unavailable.stdout, /Boot complete: 1/);
  assert.match(unavailable.stdout, /Package init state: stopped/);
});
