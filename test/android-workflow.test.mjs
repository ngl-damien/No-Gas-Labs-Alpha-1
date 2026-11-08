import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Android emulator acceptance invokes a bounded Package Manager probe before instrumentation', async () => {
  const source = await readFile(new URL('../.github/workflows/android-alpha1.yml', import.meta.url), 'utf8');
  const preflightStep = source.indexOf('      - name: Portable repository preflight');
  const smokeStep = source.indexOf('      - name: Exercise Package Manager probe with fake adb');
  const emulatorStepStart = source.indexOf('      - name: Run offline-world emulator journey');
  const emulatorStepEnd = source.indexOf('      - name: Preserve debug APK', emulatorStepStart);
  assert.ok(preflightStep >= 0 && smokeStep > preflightStep && emulatorStepStart > smokeStep,
    'the fake-adb smoke test must run after preflight and before emulator boot');
  assert.ok(emulatorStepEnd > emulatorStepStart, 'the Android emulator journey step must remain present');
  assert.ok(source.includes('run: sh scripts/test-android-package-manager-probe.sh'),
    'the smoke test must run as a normal runner step, not inside the line-splitting emulator action');

  const emulatorStep = source.slice(emulatorStepStart, emulatorStepEnd);
  assert.match(emulatorStep, /^\s{10}emulator-boot-timeout:\s*900\s*$/m,
    'allow a 15-minute cold boot on the observed slow macOS Intel runner');
  const packageProbe = emulatorStep.indexOf('sh scripts/wait-for-android-package-manager.sh');
  const instrumentationCommandIndex = emulatorStep.indexOf('sh scripts/run-android-instrumentation-with-retry.sh');
  assert.ok(packageProbe >= 0 && instrumentationCommandIndex > packageProbe,
    'the standalone Package Manager probe must run before the bounded instrumentation retry wrapper');
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

  const retryScript = await readFile(new URL('../scripts/run-android-instrumentation-with-retry.sh', import.meta.url), 'utf8');
  assert.ok(retryScript.includes('INSTALL_FAILED_VERIFICATION_FAILURE') &&
    retryScript.includes('Integrity verification timed out') &&
    retryScript.includes('Finished 0 tests on test(AVD)') &&
    retryScript.includes('Failed to install split APK(s)') &&
    retryScript.includes("cmd: Can't find service: package"),
    'retry is limited to the two observed pre-test split-APK installation failures');
  assert.ok(!retryScript.includes('failed to attach'),
    'instrumentation-runner attach failures must remain fail-closed');
  assert.ok(retryScript.includes('sh scripts/wait-for-android-package-manager.sh') &&
    retryScript.includes('no further retry will be attempted'),
    'the one retry must recheck Package Manager readiness and never loop indefinitely');

  const smokeScript = await readFile(new URL('../scripts/test-android-package-manager-probe.sh', import.meta.url), 'utf8');
  assert.ok(smokeScript.includes('NGL_ANDROID_PACKAGE_PROBE_ATTEMPTS=2') &&
    smokeScript.includes('NGL_ANDROID_PACKAGE_PROBE_DELAY_SECONDS=0'),
    'the fake-adb smoke test must bound its own failure path without waiting a full minute');
  assert.ok(smokeScript.includes('Service package: not found') &&
    smokeScript.includes('Package init state: stopped'),
    'the smoke test must exercise and assert failure diagnostics');

  assert.match(source, /^\s{4}timeout-minutes:\s*40\s*$/m,
    'retain the bounded 40-minute job ceiling');
  assert.equal((source.match(/test\/android-workflow\.test\.mjs/g) ?? []).length, 3,
    'the regression must remain in both workflow path filters and the Android preflight');
  assert.equal((source.match(/scripts\/wait-for-android-package-manager\.sh/g) ?? []).length, 4,
    'the helper must be filtered, fingerprinted and invoked in the workflow');
  assert.equal((source.match(/scripts\/test-android-package-manager-probe\.sh/g) ?? []).length, 4,
    'the smoke test must be filtered, fingerprinted and invoked in the workflow');
  assert.equal((source.match(/scripts\/run-android-instrumentation-with-retry\.sh/g) ?? []).length, 4,
    'the bounded instrumentation runner must be filtered, fingerprinted and invoked in the workflow');
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

test('Android acceptance workflow pins Node 24-compatible action releases', async () => {
  const source = await readFile(new URL('../.github/workflows/android-alpha1.yml', import.meta.url), 'utf8');
  const requiredPins = [
    ['actions/checkout@v7.0.1', 1],
    ['actions/setup-node@v7.1.0', 1],
    ['actions/upload-artifact@v7.0.2', 2],
    ['actions/setup-java@v5.1.0', 1],
    ['android-actions/setup-android@v4', 1],
    ['gradle/actions/setup-gradle@v5', 1]
  ];
  for (const [pin, expected] of requiredPins) {
    assert.equal(source.split(pin).length - 1, expected, pin + ' must be pinned the expected number of times');
  }
  assert.doesNotMatch(
    source,
    /uses:\s*(?:actions\/checkout@v4|actions\/setup-node@v4|actions\/upload-artifact@v4|actions\/setup-java@v4|android-actions\/setup-android@v3|gradle\/actions\/setup-gradle@v4)\b/,
    'the Android workflow must not retain the Node 20 action pins that emitted deprecation warnings'
  );
});
 
test('Android Source Observatory destination selection follows the UI accessible name', async () => {
  const client = await readFile(new URL('../game/client.mjs', import.meta.url), 'utf8');
  const instrumentation = await readFile(new URL('../android/app/src/androidTest/java/labs/nogas/commonground/MainActivityTest.java', import.meta.url), 'utf8');
  assert.ok(client.includes("'aria-label':`Walk to"), 'the map destination exposes an authored accessible name');
  assert.ok(instrumentation.includes("getAttribute('aria-label') === 'Walk to Source Observatory'"));
  assert.ok(!instrumentation.includes("textContent.trim() === 'Walk to Source Observatory'"));

  const firstJourneyStart = instrumentation.indexOf('public void bundledWorldStartsPrivatelyAndSharedModeFailsClosed()');
  const firstJourneyEnd = instrumentation.indexOf('    @Test', firstJourneyStart + 1);
  assert.ok(firstJourneyStart >= 0 && firstJourneyEnd > firstJourneyStart);
  assert.ok(instrumentation.slice(firstJourneyStart, firstJourneyEnd).includes('awaitPageLoaded(activity);'),
    'the first native journey must wait for the initial WebView document before evaluating JavaScript');

  const persistenceStart = instrumentation.indexOf('public void privateWorldWebViewStorageSurvivesActivityRecreation()');
  const persistenceEnd = instrumentation.indexOf('    @Test', persistenceStart + 1);
  assert.ok(persistenceStart >= 0 && persistenceEnd > persistenceStart);
  const persistenceJourney = instrumentation.slice(persistenceStart, persistenceEnd);
  assert.ok(persistenceJourney.includes('awaitPageLoaded(activity);'),
    'the storage-recreation journey must wait for its initial WebView document before evaluating JavaScript');
  assert.ok(instrumentation.includes('private String describeGameState(MainActivity activity)'),
    'WebView timeouts must preserve game-specific state needed to diagnose route and modal failures');

  const observatoryJourneyStart = instrumentation.indexOf('public void publishedSourceObservatoryRestoresNativeBackupThroughPreviewAndAppendWithoutWorldProgress()');
  assert.ok(observatoryJourneyStart >= 0);
  const nextObservatoryTest = instrumentation.indexOf('    @Test', observatoryJourneyStart + 1);
  const observatoryJourney = instrumentation.slice(observatoryJourneyStart,
    nextObservatoryTest < 0 ? undefined : nextObservatoryTest);
  const routeArrivalWait = observatoryJourney.indexOf("return !!p && Math.hypot(p.x-540,p.y-700)<50;");
  const arrivalSheetWait = observatoryJourney.indexOf("document.getElementById('sheet-title').textContent === 'Android Source Observatory'");
  assert.ok(routeArrivalWait >= 0 && arrivalSheetWait > routeArrivalWait,
    'the native notebook journey must observe persisted route arrival before the building interaction sheet');
  assert.ok(observatoryJourney.includes("Math.hypot(p.x-540,p.y-700)<50"),
    'the native notebook journey must confirm the character reached the published building');
  const accessibleWorkbenchWait = observatoryJourney.indexOf('awaitAccessibleText("Inspect retained research history", 45)');
  const workbenchStateCheck = observatoryJourney.indexOf("document.querySelector('[data-source-observatory]') !== null");
  assert.ok(accessibleWorkbenchWait >= 0 && workbenchStateCheck > accessibleWorkbenchWait,
    'the long in-world route must wait on the visible Android accessibility tree before inspecting WebView state');
  assert.ok(observatoryJourney.includes("document.getElementById('sheet-close').click()"),
    'the first location must close before the next world route starts');

  const gateJourneyStart = instrumentation.indexOf('public void founderGateIsReachableThroughTheMobileWorldAndRemainsReadOnly()');
  assert.ok(gateJourneyStart >= 0, 'native acceptance must exercise Founder Gate as a world destination');
  const nextGateTest = instrumentation.indexOf('    @Test', gateJourneyStart + 1);
  const gateJourney = instrumentation.slice(gateJourneyStart, nextGateTest < 0 ? undefined : nextGateTest);
  assert.ok(gateJourney.includes("Walk to Founder Gate"), 'the mobile journey must use the Gate destination's accessible name');
  assert.ok(gateJourney.includes('awaitAccessibleText("Decision Chamber", 45)'), 'the Gate route must wait for its accessible in-world chamber');
  assert.ok(gateJourney.includes('"HUMAN GATE · DECISIONS"'), 'the opened location must identify the human-gate function');
  assert.ok(gateJourney.includes("data-gate-action"), 'private Gate inspection must assert that no disposition controls are exposed');
  assert.ok(gateJourney.includes("worldBefore") && gateJourney.includes("xp-count") && gateJourney.includes("creation-count"),
    'Gate arrival must prove no world mutation, XP or publication');
  assert.ok(instrumentation.includes('private void awaitAccessibleText(String text, long timeoutSeconds)') &&
    instrumentation.includes('awaitAccessibleText(text, 15);'),
    'long routes use a finite per-call timeout while ordinary accessibility waits retain their short default');
});

