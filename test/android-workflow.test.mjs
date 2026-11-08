import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('Android emulator acceptance invokes a bounded Package Manager probe before instrumentation', async () => {
  const source = await readFile(new URL('../.github/workflows/android-alpha1.yml', import.meta.url), 'utf8');
  const preflightStep = source.indexOf('      - name: Portable repository preflight');
  for (const target of ['game/artifacts.mjs','game/client.mjs','game/styles.css','test/game-artifacts.test.mjs']) {
    assert.ok(source.includes('--path ' + target), 'Android preflight must fingerprint ' + target);
  }
  assert.equal((source.match(/test\/game-artifacts\.test\.mjs/g) ?? []).length, 3,
    'the native notebook bridge regression must trigger Android acceptance and be included in preflight');
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
  assert.ok(retryScript.includes('collect_android_diagnostics "first instrumentation attempt"') &&
    retryScript.includes('collect_android_diagnostics "one permitted retry"') &&
    retryScript.includes('adb logcat -d -v threadtime -t 2500') &&
    retryScript.includes('tail -n 250'),
    'both failed attempts must preserve bounded emulator, WebView and test-report diagnostics');

  const smokeScript = await readFile(new URL('../scripts/test-android-package-manager-probe.sh', import.meta.url), 'utf8');
  assert.ok(smokeScript.includes('NGL_ANDROID_PACKAGE_PROBE_ATTEMPTS=2') &&
    smokeScript.includes('NGL_ANDROID_PACKAGE_PROBE_DELAY_SECONDS=0'),
    'the fake-adb smoke test must bound its own failure path without waiting a full minute');
  assert.ok(smokeScript.includes('Service package: not found') &&
    smokeScript.includes('Package init state: stopped'),
    'the smoke test must exercise and assert failure diagnostics');

  assert.match(source, /^\s{4}timeout-minutes:\s*40\s*$/m,
    'retain the bounded 40-minute job ceiling');
  assert.ok(source.includes('concurrency:\n  group: android-alpha1-${{ github.event.pull_request.head.ref || github.ref }}\n  cancel-in-progress: true'),
    'superseded Android emulator runs for the same branch must not build an unbounded queue');
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

  const client = await readFile(new URL('../game/client.mjs', import.meta.url), 'utf8');
  assert.ok(client.includes('data-native-observatory-review') &&
    client.includes('ngl-native-file-preview-request') &&
    client.includes('ngl-native-file-append-request') &&
    client.includes('message.generation!==generation'),
    'native notebook preview and append must be generation-bound parent-document accessible controls');
  assert.ok(client.includes("node('h4',{text:item.claim})"),
    'untrusted notebook text must be rendered as text, never interpolated as HTML');
  assert.ok(client.includes("event.source!==frame.contentWindow") && client.includes("event.origin!=='null'"),
    'sandbox review messages must be bound to the current opaque-origin iframe');
  const instrumentation = await readFile(new URL('../android/app/src/androidTest/java/labs/nogas/commonground/MainActivityTest.java', import.meta.url), 'utf8');
  assert.match(instrumentation, /window\.__nglAndroidReloadMarker = 'private-save-reset'/,
    'the reset journey marks the old document before requesting a reload');
  assert.match(instrumentation, /typeof window\.__nglAndroidReloadMarker === 'undefined'/,
    'the reset journey must observe a fresh document before clicking its entry control');
  assert.match(instrumentation, /the reset private world has no published creations/,
    'fresh-world state is asserted separately so failures identify the mismatched projection');
});

test('Android instrumentation failures preserve bounded emulator diagnostics without retrying test failures', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'ngl-android-diagnostics-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const bin = join(temporary, 'bin');
  await mkdir(bin, { recursive: true });
  // Forge's copied-repository verifier deliberately exposes only the Node
  // executable directory. Supply the host utilities used by this POSIX
  // wrapper explicitly so this test is hermetic in both runner environments.
  for (const utility of ['mktemp', 'rm', 'cat', 'grep', 'tail', 'find']) {
    const wrapper = join(bin, utility);
    await writeFile(wrapper, ['#!/bin/sh', `exec /usr/bin/${utility} "$@"`, ''].join('\n'));
    await chmod(wrapper, 0o755);
  }
  const gradleCalls = join(temporary, 'gradle-calls.txt');
  const gradle = join(bin, 'gradle');
  const adb = join(bin, 'adb');

  await writeFile(gradle, `#!/bin/sh
echo called >> "$NGL_FAKE_GRADLE_CALLS"
echo 'instrumentation failure fixture' >&2
exit 7
`);
  await writeFile(adb, `#!/bin/sh
case "$1" in
  devices)
    echo 'List of devices attached'
    echo 'emulator-5554 device'
    ;;
  logcat)
    echo '11-08 00:00:00.000 123 456 E AndroidRuntime: FATAL EXCEPTION: fixture'
    echo '11-08 00:00:00.001 123 456 E ActivityTaskManager: Process labs.nogas.commonground (pid 42) has died'
    echo '11-08 00:00:00.002 123 456 E emulator: Failed to find ColorBuffer: 352'
    ;;
  *)
    exit 0
    ;;
esac
`);
  await chmod(gradle, 0o755);
  await chmod(adb, 0o755);

  const script = fileURLToPath(new URL('../scripts/run-android-instrumentation-with-retry.sh', import.meta.url));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = spawnSync('/bin/sh', [script], {
    cwd: root,
    env: {
      ...process.env,
      PATH: bin + ':' + (process.env.PATH || ''),
      NGL_FAKE_GRADLE_CALLS: gradleCalls
    },
    encoding: 'utf8',
    timeout: 15000
  });

  assert.equal(result.status, 7, String(result.error || result.stderr));
  assert.match(result.stdout, /instrumentation failure fixture/);
  assert.match(result.stdout, /Android emulator diagnostics: first instrumentation attempt/);
  assert.match(result.stdout, /emulator-5554 device/);
  assert.match(result.stdout, /FATAL EXCEPTION: fixture/);
  assert.match(result.stdout, /labs\.nogas\.commonground/);
  assert.match(result.stdout, /ColorBuffer: 352/);
  const calls = (await readFile(gradleCalls, 'utf8')).trim().split(/\r?\n/);
  assert.equal(calls.length, 1, 'an instrumentation/process failure must not trigger the installation-only retry');
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

  const roundTripStart = instrumentation.indexOf('public void nativeWorldExportAndImportRoundTripsEarnedProgress()');
  const roundTripEnd = instrumentation.indexOf('    @Test', roundTripStart + 1);
  assert.ok(roundTripStart >= 0 && roundTripEnd > roundTripStart);
  const roundTripJourney = instrumentation.slice(roundTripStart, roundTripEnd);
  const initialPageWait = roundTripJourney.indexOf('awaitPageLoaded(activity);');
  const firstJavaScriptWait = roundTripJourney.indexOf('awaitJavaScript(activity,');
  assert.ok(initialPageWait >= 0 && firstJavaScriptWait > initialPageWait,
    'the native save round-trip must wait for the initial WebView document before its first JavaScript evaluation');
  const recreation = roundTripJourney.indexOf('activityRule.getScenario().recreate();');
  const recreatedPageWait = roundTripJourney.indexOf('awaitPageLoaded(recreated);', recreation);
  const resumedJavaScript = roundTripJourney.indexOf('awaitJavaScript(recreated,', recreation);
  assert.ok(recreation >= 0 && recreatedPageWait > recreation && resumedJavaScript > recreatedPageWait,
    'the save round-trip must wait for the recreated WebView document before resuming the retained world');

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
  const accessibleWorkbenchWait = observatoryJourney.indexOf("button.textContent.includes('Inspect retained research history')");
  const workbenchStateCheck = observatoryJourney.indexOf("document.querySelector('[data-source-observatory]') !== null");
  assert.ok(accessibleWorkbenchWait >= 0 && workbenchStateCheck >= 0,
    'the long in-world route must wait for both the labelled workbench control and its DOM surface');
  assert.ok(observatoryJourney.includes("button.tagName === 'BUTTON'"),
    'the retained-history action must remain a native button with a readable text name');
  assert.ok(observatoryJourney.includes("document.getElementById('sheet-close').click()"),
    'the first location must close before the next world route starts');
  for (const label of ['Preview backup','Review local notebook import','Native recovery note','Append previewed notes','Added 1 local observation(s)']) {
    assert.ok(observatoryJourney.includes('awaitAccessibleText("' + label + '")') ||
      observatoryJourney.includes('clickAccessibleText("' + label + '")'),
      'native notebook acceptance must exercise accessible parent control/content: ' + label);
  }
  assert.ok(observatoryJourney.includes('activity.isNativeFileBridgeSupportedForTests()') &&
    observatoryJourney.includes('window.__nglNativeFileBridgeInstalled === true'),
    'native notebook acceptance must establish WebView bridge support and completed bridge installation before opening the artifact');
  assert.ok(observatoryJourney.includes("document.getElementById('enter-creation').click()"),
    'the published Observatory history row opens a detail sheet; the test must enter the creation before expecting its sandboxed portal');
  for (const diagnostic of ['portalHidden', 'artifactInputReady', 'nativeBridgeReady', 'nativeExportButton', 'nativeImportButton']) {
    assert.ok(instrumentation.includes(diagnostic), 'native portal timeout diagnostics must include ' + diagnostic);
  }

  const gateJourneyStart = instrumentation.indexOf('public void founderGateIsReachableThroughTheMobileWorldAndRemainsReadOnly()');
  assert.ok(gateJourneyStart >= 0, 'native acceptance must exercise Founder Gate as a world destination');
  const nextGateTest = instrumentation.indexOf('    @Test', gateJourneyStart + 1);
  const gateJourney = instrumentation.slice(gateJourneyStart, nextGateTest < 0 ? undefined : nextGateTest);
  assert.ok(gateJourney.includes("Walk to Founder Gate"), 'the mobile journey must use the Gate destination accessible name');
  assert.ok(gateJourney.includes("getAttribute('role') === 'dialog'") &&
    gateJourney.includes("getAttribute('aria-modal') === 'true'") &&
    gateJourney.includes("getAttribute('aria-labelledby') === 'sheet-title'"),
    'the Gate route must expose a labelled modal dialog in the WebView accessibility contract');
  assert.ok(gateJourney.includes('HUMAN GATE · DECISIONS'), 'the opened location must identify the human-gate function');
  assert.ok(gateJourney.includes("data-gate-action"), 'private Gate inspection must assert that no disposition controls are exposed');
  assert.ok(gateJourney.includes("worldBefore") && gateJourney.includes("xp-count") && gateJourney.includes("creation-count"),
    'Gate arrival must prove no world mutation, XP or publication');
  const pageLoadStart = instrumentation.indexOf('private void awaitPageLoaded(MainActivity activity)');
  const pageLoadEnd = instrumentation.indexOf('private String describeWebView', pageLoadStart);
  assert.ok(pageLoadStart >= 0 && pageLoadEnd > pageLoadStart);
  const pageLoadHelper = instrumentation.slice(pageLoadStart, pageLoadEnd);
  assert.ok(pageLoadHelper.includes('TimeUnit.SECONDS.toNanos(45)') &&
    pageLoadHelper.includes('current.getProgress() == 100'),
    'initial Android WebView loading must remain finite while tolerating the observed slow hosted emulator');
});

