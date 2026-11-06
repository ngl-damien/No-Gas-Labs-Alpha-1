import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Android emulator acceptance allows cold macOS boot without consuming the instrumentation window', async () => {
  const source = await readFile(new URL('../.github/workflows/android-alpha1.yml', import.meta.url), 'utf8');
  const start = source.indexOf('      - name: Run offline-world emulator journey');
  const end = source.indexOf('      - name: Preserve debug APK', start);
  assert.ok(start >= 0 && end > start, 'the Android emulator journey step must remain present');

  const emulatorStep = source.slice(start, end);
  assert.match(emulatorStep, /^\s{10}emulator-boot-timeout:\s*900\s*$/m,
    'allow a 15-minute cold boot on the observed slow macOS Intel runner');
  const packageProbe = emulatorStep.indexOf('adb shell cmd package list packages');
  const instrumentation = emulatorStep.indexOf('gradle -p android :app:connectedDebugAndroidTest');
  assert.ok(packageProbe >= 0 && instrumentation > packageProbe,
    'Package Manager readiness must be observed before Android instrumentation installs split APKs');
  assert.ok(emulatorStep.includes('for attempt in $(seq 1 30); do') &&
    emulatorStep.includes("grep -q '^package:'") && emulatorStep.includes('sleep 2'),
    'the Package Manager probe must retry for a bounded 60-second window and require an actual package listing');
  assert.ok(emulatorStep.includes('service check package') &&
    emulatorStep.includes('getprop sys.boot_completed') &&
    emulatorStep.includes('getprop init.svc.package'),
    'a missing Package Manager service must preserve boot diagnostics');
  assert.ok(emulatorStep.includes('Android Package Manager did not become ready after emulator boot'),
    'a cold-start service failure must be explicit rather than misreported as an instrumentation test failure');

  assert.match(source, /^\s{4}timeout-minutes:\s*40\s*$/m,
    'retain the bounded 40-minute job ceiling');
  assert.equal((source.match(/test\/android-workflow\.test\.mjs/g) ?? []).length, 3,
    'the regression must be in both workflow path filters and the Android preflight');
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
