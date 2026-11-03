import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Android emulator acceptance uses a lean AOSP image and preserves offline WebView diagnostics', async () => {
  const source = await readFile(new URL('../.github/workflows/android-alpha1.yml', import.meta.url), 'utf8');
  const start = source.indexOf('      - name: Run offline-world emulator journey');
  const diagnosticsStart = source.indexOf('      - name: Preserve Android instrumentation diagnostics', start);
  const end = source.indexOf('      - name: Preserve debug APK', diagnosticsStart);
  assert.ok(start >= 0 && diagnosticsStart > start && end > diagnosticsStart,
    'the Android emulator journey and diagnostics upload must remain present before APK preservation');

  const emulatorStep = source.slice(start, diagnosticsStart);
  const diagnosticsStep = source.slice(diagnosticsStart, end);
  assert.match(emulatorStep, /^\s{10}target:\s*default\s*$/m,
    'the offline-only app must not boot unnecessary Google Play services');
  assert.doesNotMatch(emulatorStep, /^\s{10}target:\s*google_apis\s*$/m,
    'the emulator must not add a Google APIs system image to this offline WebView test');
  assert.match(emulatorStep, /webview_state=.*dumpsys webviewupdate/,
    'record the active platform WebView provider before instrumentation');
  assert.match(emulatorStep, /Current WebView package/,
    'fail fast with an explicit diagnostic if the system image has no WebView provider');
  assert.match(emulatorStep, /^\s{10}emulator-boot-timeout:\s*900\s*$/m,
    'allow a 15-minute cold boot on the observed slow macOS Intel runner');
  assert.match(source, /^\s{4}timeout-minutes:\s*40\s*$/m,
    'retain the bounded 40-minute job ceiling');
  assert.match(emulatorStep, /if gradle -p android :app:connectedDebugAndroidTest/,
    'capture diagnostics without masking the instrumentation exit status');
  assert.match(emulatorStep, /adb logcat -d -v threadtime -t 20000/,
    'preserve bounded emulator logcat before the emulator runner tears down the device');
  assert.match(emulatorStep, /dumpsys activity activities/);
  assert.match(emulatorStep, /dumpsys webviewupdate/);
  assert.ok(diagnosticsStep.includes('if: always()'));
  assert.ok(diagnosticsStep.includes('android/app/build/reports/androidTests/connected/debug/'));
  assert.ok(diagnosticsStep.includes('android/app/build/outputs/androidTest-results/connected/debug/'));
  assert.equal(source.split('test/android-workflow.test.mjs').length - 1, 3,
    'the regression must be in both workflow path filters and the Android preflight');
});
