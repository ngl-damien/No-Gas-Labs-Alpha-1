package labs.nogas.commonground;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.webkit.WebView;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.rules.ActivityScenarioRule;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;

@RunWith(AndroidJUnit4.class)
public final class MainActivityTest {
    @Rule
    public final ActivityScenarioRule<MainActivity> activityRule =
            new ActivityScenarioRule<>(MainActivity.class);

    @Test
    public void webViewIsDetachedBeforeDestroy() throws Exception {
        MainActivity activity = activity();
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        AtomicReference<Boolean> attachedAtDestroy = new AtomicReference<>(true);
        AtomicReference<Boolean> attachedBeforeDestroy = new AtomicReference<>(false);
        AtomicReference<Boolean> detachedAfterDestroy = new AtomicReference<>(false);
        AtomicReference<WebView> probe = new AtomicReference<>();

        instrumentation.runOnMainSync(() -> {
            WebView observed = new WebView(activity) {
                @Override
                public void destroy() {
                    attachedAtDestroy.set(isAttachedToWindow());
                    super.destroy();
                }
            };
            activity.addContentView(observed, new ViewGroup.LayoutParams(1, 1));
            probe.set(observed);
        });
        instrumentation.waitForIdleSync();
        instrumentation.runOnMainSync(() -> {
            WebView observed = probe.get();
            attachedBeforeDestroy.set(observed.isAttachedToWindow());
            MainActivity.destroyWebView(observed);
            detachedAfterDestroy.set(observed.getParent() == null);
        });

        assertTrue("the probe WebView was attached before cleanup", attachedBeforeDestroy.get());
        assertFalse("destroy() must never be called while the WebView is attached", attachedAtDestroy.get());
        assertTrue("the WebView is detached after cleanup", detachedAfterDestroy.get());
    }

    @Test
    public void bundledWorldStartsPrivatelyAndSharedModeFailsClosed() throws Exception {
        MainActivity activity = activity();
        assertEquals("offline Alpha-1 APK must not request INTERNET permission",
                PackageManager.PERMISSION_DENIED,
                activity.getPackageManager().checkPermission(
                        android.Manifest.permission.INTERNET, activity.getPackageName()));
        awaitJavaScript(activity, "document.readyState === 'complete' && !!document.getElementById('start-shared')");

        assertEquals("\"https://appassets.androidplatform.net\"",
                evaluate(activity, "location.origin"));
        assertEquals("true", evaluate(activity, "window.isSecureContext"));

        evaluate(activity, "document.getElementById('start-shared').click(); 'requested'");
        awaitCounter(activity, () -> activity.getUnconfiguredApiRequestsForTests() > 0);
        assertEquals("shared failure must leave the doorway available",
                "false",
                evaluate(activity, "document.getElementById('doorway').hidden"));
        assertEquals("shared failure must not enter play or invent a session",
                "true",
                evaluate(activity, "document.getElementById('play-ui').hidden"));
        assertEquals("no external request should escape the shell",
                0,
                activity.getBlockedExternalRequestsForTests());

        evaluate(activity, "document.getElementById('start-private').click(); 'started'");
        awaitJavaScript(activity, "document.getElementById('play-ui').hidden === false");
        assertEquals("\"Private world · saved on this device\"",
                evaluate(activity, "document.getElementById('mode-label').textContent"));
        assertEquals("the actual game canvas is present",
                "true",
                evaluate(activity, "!!document.getElementById('world')"));

    }


    @Test
    public void privateWorldWebViewStorageSurvivesActivityRecreation() throws Exception {
        MainActivity activity = activity();
        awaitJavaScript(activity,
                "document.readyState === 'complete' && !!document.getElementById('start-private')");
        evaluate(activity, "document.getElementById('start-private').click(); 'started'");
        awaitJavaScript(activity, "document.getElementById('play-ui').hidden === false");
        evaluate(activity, "localStorage.setItem('ngl.android.shell-smoke', 'persisted'); 'saved'");

        activityRule.getScenario().recreate();
        MainActivity recreated = activity();
        awaitPageLoaded(recreated);
        awaitJavaScript(recreated,
                "document.readyState === 'complete' && typeof document.getElementById('start-private')?.onclick === 'function'");
        assertEquals("the stable appassets origin retains DOM storage across activity recreation",
                "\"persisted\"",
                evaluate(recreated, "localStorage.getItem('ngl.android.shell-smoke')"));
    }

    @Test
    public void nativeBridgeTrustsOnlyExactGameDocumentInMainFrame() {
        String origin = "https://" + MainActivity.APP_HOST;
        String siblingUrl = origin + "/assets/game/sibling.html";

        // loadDataWithBaseURL creates a data: document, not a real same-origin
        // sibling. The app blocks non-entry navigation; test the exact native
        // bridge gate inputs rather than treating an opaque data URL as proof.
        assertTrue(MainActivity.isTrustedGameDocumentForTests(MainActivity.GAME_URL));
        assertFalse(MainActivity.isTrustedGameDocumentForTests(siblingUrl));
        assertTrue(MainActivity.isTrustedGameDocumentForTests(
                MainActivity.GAME_URL, origin, true));
        assertFalse(MainActivity.isTrustedGameDocumentForTests(
                siblingUrl, origin, true));
        assertFalse(MainActivity.isTrustedGameDocumentForTests(
                MainActivity.GAME_URL, "https://example.org", true));
        assertFalse(MainActivity.isTrustedGameDocumentForTests(
                MainActivity.GAME_URL, origin, false));
        assertFalse(MainActivity.isTrustedGameDocumentForTests(
                MainActivity.GAME_URL, origin + ":444", true));
        assertFalse(MainActivity.isTrustedGameDocumentForTests(
                "https://" + MainActivity.APP_HOST + ":444/assets/game/index.html", origin, true));
        assertFalse(MainActivity.isTrustedGameDocumentForTests(
                "http://" + MainActivity.APP_HOST + "/assets/game/index.html", origin, true));
        assertFalse(MainActivity.isTrustedGameDocumentForTests(
                MainActivity.GAME_URL, null, true));
    }

    @Test
    public void nativeExportQueueBoundsBytesAndMessageCount() throws Exception {
        MainActivity activity = activity();
        ThreadPoolExecutor executor = blockedExecutor(NativeWorldFiles.MAX_QUEUED_MESSAGES);
        NativeWorldFiles files = new NativeWorldFiles(activity, executor);
        try {
            files.onMessage(new androidx.webkit.WebMessageCompat(
                    "{\"type\":\"export-start\",\"name\":\"bounded.json\",\"mime\":\"application/json\",\"size\":33554432}"
            ), null);
            for (int index = 0; index < NativeWorldFiles.MAX_QUEUED_CHUNKS; index++) {
                files.onMessage(new androidx.webkit.WebMessageCompat(
                        new byte[NativeWorldFiles.CHUNK_BYTES]
                ), null);
            }

            assertEquals("accepted bytes include queued and not-yet-written chunks",
                    NativeWorldFiles.MAX_BYTES, files.getAcceptedExportBytesForTests());
            assertEquals("one start plus 512 bounded chunks remain in the bounded queue",
                    NativeWorldFiles.MAX_QUEUED_CHUNKS + 1, files.getPendingIoTasksForTests());

            files.onMessage(new androidx.webkit.WebMessageCompat(
                    "{\"type\":\"export-complete\"}"
            ), null);
            assertEquals("the maximum valid transfer plus completion fits exactly in the queue",
                    NativeWorldFiles.MAX_QUEUED_MESSAGES, files.getPendingIoTasksForTests());

            files.onMessage(new androidx.webkit.WebMessageCompat(
                    "{\"type\":\"export-complete\"}"
            ), null);
            assertEquals("duplicate completion cannot grow the queue",
                    NativeWorldFiles.MAX_QUEUED_MESSAGES, files.getPendingIoTasksForTests());

            files.onMessage(new androidx.webkit.WebMessageCompat(new byte[]{1}), null);
            assertEquals("an extra byte after the declared 32-MiB transfer aborts and releases reservations",
                    0, files.getAcceptedExportBytesForTests());
            assertFalse(files.isExportTransferActiveForTests());
            assertTrue(files.getPendingIoTasksForTests() <= NativeWorldFiles.MAX_QUEUED_MESSAGES);
        } finally {
            files.close();
        }
    }

    @Test
    public void nativeExportQueueRejectsOversizedChunksAndExecutorSaturation() throws Exception {
        MainActivity activity = activity();
        ThreadPoolExecutor oversizedExecutor = blockedExecutor(NativeWorldFiles.MAX_QUEUED_MESSAGES);
        NativeWorldFiles oversizedFiles = new NativeWorldFiles(activity, oversizedExecutor);
        try {
            oversizedFiles.onMessage(new androidx.webkit.WebMessageCompat(
                    "{\"type\":\"export-start\",\"name\":\"oversized.json\",\"mime\":\"application/json\",\"size\":65537}"
            ), null);
            oversizedFiles.onMessage(new androidx.webkit.WebMessageCompat(
                    new byte[NativeWorldFiles.CHUNK_BYTES + 1]
            ), null);
            assertEquals("oversized chunks are rejected before enqueue",
                    1, oversizedFiles.getPendingIoTasksForTests());
            assertEquals(0, oversizedFiles.getAcceptedExportBytesForTests());
            assertFalse(oversizedFiles.isExportTransferActiveForTests());
        } finally {
            oversizedFiles.close();
        }

        ThreadPoolExecutor saturatedExecutor = blockedExecutor(2);
        NativeWorldFiles saturatedFiles = new NativeWorldFiles(activity, saturatedExecutor);
        try {
            saturatedFiles.onMessage(new androidx.webkit.WebMessageCompat(
                    "{\"type\":\"export-start\",\"name\":\"saturated.json\",\"mime\":\"application/json\",\"size\":131072}"
            ), null);
            saturatedFiles.onMessage(new androidx.webkit.WebMessageCompat(
                    new byte[NativeWorldFiles.CHUNK_BYTES]
            ), null);
            assertEquals(2, saturatedFiles.getPendingIoTasksForTests());
            saturatedFiles.onMessage(new androidx.webkit.WebMessageCompat(
                    new byte[NativeWorldFiles.CHUNK_BYTES]
            ), null);
            assertTrue("the queue remains bounded when the executor rejects a chunk",
                    saturatedFiles.getPendingIoTasksForTests() <= 2);
            assertEquals("rejected enqueue releases the reservation and aborts the transfer",
                    0, saturatedFiles.getAcceptedExportBytesForTests());
            assertFalse(saturatedFiles.isExportTransferActiveForTests());
        } finally {
            saturatedFiles.close();
        }
    }

    private ThreadPoolExecutor blockedExecutor(int queueCapacity) throws Exception {
        CountDownLatch workerStarted = new CountDownLatch(1);
        ThreadPoolExecutor executor = new ThreadPoolExecutor(
                1,
                1,
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(queueCapacity),
                runnable -> {
                    Thread thread = new Thread(runnable, "ngl-test-blocked-file-io");
                    thread.setDaemon(true);
                    return thread;
                },
                new ThreadPoolExecutor.AbortPolicy()
        );
        executor.execute(() -> {
            workerStarted.countDown();
            try {
                new CountDownLatch(1).await();
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        });
        assertTrue("test executor worker should enter its blocking task",
                workerStarted.await(5, TimeUnit.SECONDS));
        return executor;
    }

    @Test
    public void nativeWorldExportAndImportRoundTripsEarnedProgress() throws Exception {
        MainActivity activity = activity();
        assertTrue("Android WebView must support the origin-scoped file bridge",
                activity.isNativeFileBridgeSupportedForTests());
        awaitJavaScript(activity,
                "document.readyState === 'complete' && typeof document.getElementById('start-private')?.onclick === 'function'");
        awaitJavaScript(activity, "window.__nglNativeFileBridgeInstalled === true");
        evaluate(activity,
                "localStorage.removeItem('ngl.common-ground.v2'); " +
                "localStorage.removeItem('ngl.common-ground.v2.backup'); " +
                "localStorage.removeItem('ngl.common-ground.player-position.v1'); 'clean'");
        evaluate(activity, "document.getElementById('start-private').click(); 'started'");
        awaitJavaScript(activity, "document.getElementById('play-ui').hidden === false");
        awaitJavaScript(activity,
                "localStorage.getItem('ngl.common-ground.player-position.v1') === null");
        evaluate(activity, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true })); 'moving'");
        awaitJavaScript(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1'))?.x > 180");
        evaluate(activity, "window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', bubbles: true })); 'stopped'");
        awaitStablePlayerPosition(activity, 1800);

        createAndPublishObservatory(activity);
        File exportFile = new File(
                InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(),
                "ngl-world-roundtrip.json");
        if (exportFile.exists()) assertTrue("old test export should be removable", exportFile.delete());

        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Instrumentation.ActivityMonitor createMonitor = monitorDocumentPicker(
                Intent.ACTION_CREATE_DOCUMENT, Uri.fromFile(exportFile));
        double expectedX = Double.NaN;
        double expectedY = Double.NaN;
        try {
            awaitJavaScript(activity, "typeof document.getElementById('journal-button')?.onclick === 'function'");
            evaluate(activity, "document.getElementById('journal-button').click(); 'journal'");
            awaitJavaScript(activity,
                    "!document.getElementById('sheet').hidden && !!document.getElementById('export-world') && !!document.getElementById('import-world')");
            awaitStablePlayerPosition(activity, 500);
            expectedX = Double.parseDouble(evaluate(activity,
                    "JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')).x"));
            expectedY = Double.parseDouble(evaluate(activity,
                    "JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')).y"));
            assertTrue("the round-trip must preserve a fresh movement from the spawn point", expectedX > 180.0);
            evaluate(activity, "document.getElementById('export-world').click(); 'export'");
            awaitMonitor(createMonitor);
            awaitNonEmptyFile(exportFile);
        } finally {
            instrumentation.removeMonitor(createMonitor);
        }

        String exported = new String(Files.readAllBytes(exportFile.toPath()), StandardCharsets.UTF_8);
        JSONObject envelope = new JSONObject(exported);
        assertEquals("ngl.private-save.v1", envelope.getString("schema"));
        JSONObject exportedWorld = envelope.getJSONObject("world");
        assertEquals("ngl.world.v2", exportedWorld.getString("schema"));
        assertTrue("export must retain the published creation", exported.contains("Android Source Observatory"));
        JSONObject exportedPosition = envelope.getJSONObject("playerPosition");
        assertEquals("portable positions contain coordinates only", 2, exportedPosition.length());
        assertTrue(exportedPosition.has("x"));
        assertTrue(exportedPosition.has("y"));
        assertFalse("private runtime identity must not leave the device", exportedPosition.has("id"));
        assertEquals("export must carry the moved character's x coordinate",
                expectedX, exportedPosition.getDouble("x"), 0.01);
        assertEquals("export must carry the moved character's y coordinate",
                expectedY, exportedPosition.getDouble("y"), 0.01);

        evaluate(activity,
                "localStorage.removeItem('ngl.common-ground.v2'); " +
                "localStorage.removeItem('ngl.common-ground.v2.backup'); " +
                "localStorage.removeItem('ngl.common-ground.player-position.v1'); " +
                "window.__nglAndroidReloadMarker = 'private-save-reset'; " +
                "location.reload(); 'cleared'");
        // The old document already has the entry handler and native bridge. Do not
        // let those stale flags satisfy the post-reload wait before Chromium has
        // committed a fresh document and discarded this one-shot marker.
        awaitJavaScript(activity,
                "typeof window.__nglAndroidReloadMarker === 'undefined' && " +
                "document.readyState === 'complete' && " +
                "typeof document.getElementById('start-private')?.onclick === 'function'");
        awaitJavaScript(activity, "window.__nglNativeFileBridgeInstalled === true");
        evaluate(activity, "document.getElementById('start-private').click(); 'new private world'");
        awaitJavaScript(activity, "document.getElementById('play-ui').hidden === false");
        assertEquals("the reset world starts in private mode",
                "true",
                evaluate(activity, "document.getElementById('mode-label').textContent.includes('Private')"));
        assertEquals("the reset private world has no published creations",
                "\"0\"",
                evaluate(activity, "document.getElementById('creation-count').textContent"));
        assertEquals("the reset private world has no earned XP",
                "\"0\"",
                evaluate(activity, "document.getElementById('xp-count').textContent"));

        Instrumentation.ActivityMonitor openMonitor = monitorDocumentPicker(
                Intent.ACTION_OPEN_DOCUMENT, Uri.fromFile(exportFile));
        try {
            awaitJavaScript(activity, "typeof document.getElementById('journal-button')?.onclick === 'function'");
            evaluate(activity, "document.getElementById('journal-button').click(); 'journal'");
            awaitJavaScript(activity, "!document.getElementById('sheet').hidden && !!document.getElementById('import-world')");
            evaluate(activity, "document.getElementById('import-world').click(); 'import'");
            awaitMonitor(openMonitor);
            awaitJavaScript(activity,
                    "document.getElementById('play-ui').hidden === false && " +
                    "document.getElementById('mode-label').textContent.includes('Private') && " +
                    "document.getElementById('creation-count').textContent === '1' && " +
                    "document.getElementById('xp-count').textContent === '100' && " +
                    "Math.abs(JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')).x - " + expectedX + ") < 0.01 && " +
                    "Math.abs(JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')).y - " + expectedY + ") < 0.01");
            assertEquals("the imported objective is projected from the retained publication",
                    "true",
                    evaluate(activity,
                            "document.querySelector('[data-objective-id=\"founder-first-place\"]')?.textContent.includes('RECORDED')"));
            assertEquals("the import remains a private world", "true",
                    evaluate(activity, "document.getElementById('mode-label').textContent.includes('Private')"));
        } finally {
            instrumentation.removeMonitor(openMonitor);
        }

        activityRule.getScenario().recreate();
        MainActivity recreated = activity();
        awaitJavaScript(recreated,
                "document.readyState === 'complete' && typeof document.getElementById('start-private')?.onclick === 'function'");
        evaluate(recreated, "document.getElementById('start-private').click(); 'resume'");
        awaitJavaScript(recreated,
                "document.getElementById('play-ui').hidden === false && " +
                "document.getElementById('mode-label').textContent.includes('Private') && " +
                "document.getElementById('creation-count').textContent === '1' && " +
                "document.getElementById('xp-count').textContent === '100' && " +
                "Math.abs(JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')).x - " + expectedX + ") < 0.01 && " +
                "Math.abs(JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')).y - " + expectedY + ") < 0.01");
        assertTrue("test export should be removable", exportFile.delete());
    }


    @Test
    public void nativeSandboxedArtifactFileBridgeRequiresParentAuthorizationAndRoundTripsBoundedBytes() throws Exception {
        MainActivity activity = activity();
        assertTrue("Android WebView must support the origin-scoped file bridge",
                activity.isNativeFileBridgeSupportedForTests());
        awaitJavaScript(activity, "window.__nglNativeFileBridgeInstalled === true");
        assertEquals("artifact imports have the same 2 MiB cap as the Source Observatory parser",
                2L * 1024L * 1024L, NativeWorldFiles.MAX_ARTIFACT_BYTES);

        File exportFile = new File(
                InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(),
                "ngl-sandboxed-artifact.json");
        if (exportFile.exists()) assertTrue("old sandbox export should be removable", exportFile.delete());

        String payload = "{\"schema\":\"ngl.source-observatory.v2\",\"assurance\":{\"sourceRetrieval\":\"NOT_PERFORMED\",\"independentVerification\":\"NOT_PERFORMED\",\"modelAssertions\":\"LEADS_ONLY\",\"execution\":\"NOT_EXECUTED\"},\"observations\":[]}";
        String fixture = """
                <!doctype html><html><body>
                <input id="backup-file" type="file" accept="application/json">
                <script>
                const PARENT_ORIGIN = 'https://appassets.androidplatform.net';
                const EXPECTED = %s;
                let incoming = null;
                let exportRequests = 0;
                window.addEventListener('message', async event => {
                  if (event.source !== parent || event.origin !== PARENT_ORIGIN) return;
                  const message = event.data;
                  if (message?.type === 'ngl-native-file-export-request') {
                    exportRequests += 1;
                    if (exportRequests === 1) {
                      const oversized = new Uint8Array(2 * 1024 * 1024 + 1).buffer;
                      parent.postMessage({type:'ngl-native-file-export-start',name:'oversized.json',mime:'application/json',size:oversized.byteLength}, '*');
                      return;
                    }
                    const bytes = new TextEncoder().encode(EXPECTED).buffer;
                    parent.postMessage({type:'ngl-native-file-export-start',name:'sandboxed-fixture.json',mime:'application/json',size:bytes.byteLength}, '*');
                    parent.postMessage({type:'ngl-native-file-export-chunk',bytes}, '*', [bytes]);
                    parent.postMessage({type:'ngl-native-file-export-complete'}, '*');
                  } else if (message?.type === 'ngl-native-file-import-start') {
                    incoming = {name:message.name,size:message.size,parts:[],received:0};
                  } else if (message?.type === 'ngl-native-file-import-chunk') {
                    if (!incoming || !(message.bytes instanceof ArrayBuffer)) return;
                    incoming.parts.push(message.bytes);
                    incoming.received += message.bytes.byteLength;
                  } else if (message?.type === 'ngl-native-file-import-complete') {
                    const transfer = incoming;
                    incoming = null;
                    if (!transfer || transfer.received !== transfer.size) return;
                    const file = new File(transfer.parts, transfer.name, {type:'application/json'});
                    const selection = new DataTransfer();
                    selection.items.add(file);
                    const input = document.getElementById('backup-file');
                    input.files = selection.files;
                    input.dispatchEvent(new Event('change', {bubbles:true}));
                    if (await file.text() === EXPECTED) {
                      parent.postMessage({type:'ngl-native-file-import-received',name:transfer.name,size:transfer.size}, '*');
                    }
                  }
                });
                // An artifact cannot open a native picker or save dialog merely by
                // posting a message. The parent must initiate the export explicitly.
                const unsolicited = new TextEncoder().encode('x').buffer;
                parent.postMessage({type:'ngl-native-file-export-start',name:'unsolicited.json',mime:'application/json',size:1}, '*');
                parent.postMessage({type:'ngl-native-file-export-chunk',bytes:unsolicited}, '*', [unsolicited]);
                parent.postMessage({type:'ngl-native-file-export-complete'}, '*');
                </script></body></html>
                """.formatted(JSONObject.quote(payload));

        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Instrumentation.ActivityMonitor unsolicitedMonitor = monitorDocumentPicker(
                Intent.ACTION_CREATE_DOCUMENT, Uri.fromFile(exportFile));
        try {
            String install = "(() => { const portal=document.getElementById('portal'); portal.hidden=false; " +
                    "const frame=document.getElementById('artifact-frame'); " +
                    "frame.addEventListener('load',()=>{frame.dataset.nglFixtureReady='true';},{once:true}); " +
                    "frame.srcdoc=" + JSONObject.quote(fixture) + "; return 'installed'; })()";
            assertEquals("\"installed\"", evaluate(activity, install));
            awaitJavaScript(activity,
                    "document.getElementById('artifact-frame')?.dataset.nglFixtureReady === 'true'");
            Thread.sleep(400);
            assertEquals("an unsolicited sandbox message cannot open a native save picker",
                    0, unsolicitedMonitor.getHits());
        } finally {
            instrumentation.removeMonitor(unsolicitedMonitor);
        }

        Instrumentation.ActivityMonitor createMonitor = monitorDocumentPicker(
                Intent.ACTION_CREATE_DOCUMENT, Uri.fromFile(exportFile));
        try {
            assertEquals("true", evaluate(activity, "window.__nglNativeRequestArtifactExport()"));
            Thread.sleep(400);
            assertEquals("an authorized but oversized artifact export is rejected before native file creation",
                    0, createMonitor.getHits());
            assertEquals("true", evaluate(activity, "window.__nglNativeRequestArtifactExport()"));
            awaitMonitor(createMonitor);
            awaitNonEmptyFile(exportFile);
        } finally {
            instrumentation.removeMonitor(createMonitor);
        }
        String exported = new String(Files.readAllBytes(exportFile.toPath()), StandardCharsets.UTF_8);
        assertEquals("the parent-authorized artifact export preserves the exact notebook bytes", payload, exported);

        Instrumentation.ActivityMonitor openMonitor = monitorDocumentPicker(
                Intent.ACTION_OPEN_DOCUMENT, Uri.fromFile(exportFile));
        try {
            assertEquals("true", evaluate(activity, "window.__nglNativeRequestArtifactImport()"));
            awaitMonitor(openMonitor);
            awaitJavaScript(activity,
                    "document.getElementById('artifact-frame')?.dataset.nglNativeImportReceived === " +
                            JSONObject.quote("sandboxed-fixture.json:" + exportFile.length()));
        } finally {
            instrumentation.removeMonitor(openMonitor);
        }

        assertTrue("test export should be removable", exportFile.delete());
        assertEquals("the sandboxed transfer does not create a game-world session",
                "true", evaluate(activity, "document.getElementById('play-ui').hidden"));
    }


    @Test
    public void publishedSourceObservatoryRestoresNativeBackupThroughPreviewAndAppendWithoutWorldProgress() throws Exception {
        MainActivity activity = activity();
        awaitJavaScript(activity,
                "document.readyState === 'complete' && typeof document.getElementById('start-private')?.onclick === 'function'");
        evaluate(activity, "document.getElementById('start-private').click(); 'started'");
        awaitJavaScript(activity, "document.getElementById('play-ui').hidden === false");
        createAndPublishObservatory(activity);

        evaluate(activity, "document.getElementById('places-button').click(); 'places'");
        awaitJavaScript(activity,
                "Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Walk to Source Observatory')");
        evaluate(activity,
                "Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Walk to Source Observatory').click(); 'walk'");
        awaitJavaScript(activity, "document.querySelector('[data-source-observatory]') !== null");
        awaitJavaScript(activity, "document.querySelector('[data-source-observatory-open]') !== null");
        evaluate(activity, "document.querySelector('[data-source-observatory-open]').click(); 'open retained Observatory'");
        awaitJavaScript(activity,
                "!document.getElementById('portal').hidden && " +
                "document.querySelector('[data-native-observatory-export]') !== null && " +
                "document.querySelector('[data-native-observatory-import]') !== null && " +
                "document.getElementById('artifact-frame')?.getAttribute('data-ngl-input-ready') === 'true'");
        assertEquals("the native portal is attached only to the marked Source Observatory artifact",
                "true",
                evaluate(activity,
                        "document.getElementById('artifact-frame').srcdoc.includes('data-ngl-native-file-surface=\\\"source-observatory-v2\\\"')"));

        String claim = "<b>Native recovery note</b>";
        JSONObject observation = new JSONObject()
                .put("claim", claim)
                .put("sourceKind", "model-assertion")
                .put("source", "Model output only; source retrieval was not performed.")
                .put("falsifier", "A direct observation contradicts the claim.")
                .put("uncertainty", "No independent observation.")
                .put("nextTest", "Inspect the cited source.");
        JSONObject backupEnvelope = new JSONObject()
                .put("schema", "ngl.source-observatory.v2")
                .put("assurance", new JSONObject()
                        .put("sourceRetrieval", "NOT_PERFORMED")
                        .put("independentVerification", "NOT_PERFORMED")
                        .put("modelAssertions", "LEADS_ONLY")
                        .put("execution", "NOT_EXECUTED"))
                .put("observations", new JSONArray().put(observation));

        File backup = new File(
                InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(),
                "source-observatory-native-import.json");
        File roundTrip = new File(
                InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(),
                "source-observatory-native-roundtrip.json");
        if (backup.exists()) assertTrue("old native import fixture should be removable", backup.delete());
        if (roundTrip.exists()) assertTrue("old native round-trip export should be removable", roundTrip.delete());
        Files.write(backup.toPath(), backupEnvelope.toString(2).getBytes(StandardCharsets.UTF_8));

        String worldBefore = evaluate(activity, "localStorage.getItem('ngl.common-ground.v2')");
        String positionBefore = evaluate(activity, "localStorage.getItem('ngl.common-ground.player-position.v1')");
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Instrumentation.ActivityMonitor openMonitor = monitorDocumentPicker(
                Intent.ACTION_OPEN_DOCUMENT, Uri.fromFile(backup));
        try {
            evaluate(activity, "document.querySelector('[data-native-observatory-import]').click(); 'restore notebook'");
            awaitMonitor(openMonitor);
            awaitJavaScript(activity,
                    "document.getElementById('artifact-frame')?.dataset.nglNativeImportReceived === " +
                            JSONObject.quote(backup.getName() + ":" + backup.length()));
        } finally {
            instrumentation.removeMonitor(openMonitor);
        }

        // Use the Android accessibility tree to exercise the actual sandboxed
        // controls; do not reach through the opaque-origin iframe from the parent.
        awaitAccessibleText("Preview backup");
        clickAccessibleText("Preview backup");
        awaitAccessibleText("Review local notebook import");
        awaitAccessibleText("Native recovery note");
        clickAccessibleText("Append previewed notes");
        awaitAccessibleText("Added 1 local observation(s)");

        Instrumentation.ActivityMonitor createMonitor = monitorDocumentPicker(
                Intent.ACTION_CREATE_DOCUMENT, Uri.fromFile(roundTrip));
        try {
            evaluate(activity, "document.querySelector('[data-native-observatory-export]').click(); 'save restored notebook'");
            awaitMonitor(createMonitor);
            awaitNonEmptyFile(roundTrip);
        } finally {
            instrumentation.removeMonitor(createMonitor);
        }

        JSONObject exported = new JSONObject(new String(Files.readAllBytes(roundTrip.toPath()), StandardCharsets.UTF_8));
        assertEquals("ngl.source-observatory.v2", exported.getString("schema"));
        assertEquals("NOT_PERFORMED", exported.getJSONObject("assurance").getString("sourceRetrieval"));
        assertEquals("NOT_PERFORMED", exported.getJSONObject("assurance").getString("independentVerification"));
        assertEquals("LEADS_ONLY", exported.getJSONObject("assurance").getString("modelAssertions"));
        assertEquals("NOT_EXECUTED", exported.getJSONObject("assurance").getString("execution"));
        assertEquals(1, exported.getJSONArray("observations").length());
        JSONObject restored = exported.getJSONArray("observations").getJSONObject(0);
        assertEquals(claim, restored.getString("claim"));
        assertEquals("model-assertion", restored.getString("sourceKind"));
        assertEquals("Model output only; source retrieval was not performed.", restored.getString("source"));

        assertEquals("native notebook restore/append/export does not mutate the private world record",
                worldBefore, evaluate(activity, "localStorage.getItem('ngl.common-ground.v2')"));
        assertEquals("native notebook restore/append/export does not mutate the saved character position",
                positionBefore, evaluate(activity, "localStorage.getItem('ngl.common-ground.player-position.v1')"));
        assertEquals("local notebook work does not award world XP",
                "100", evaluate(activity, "document.getElementById('xp-count').textContent"));
        assertEquals("local notebook work does not create another world building",
                "1", evaluate(activity, "document.getElementById('creation-count').textContent"));
        assertTrue("native import fixture should be removable", backup.delete());
        assertTrue("native round-trip export should be removable", roundTrip.delete());
    }

    private void createAndPublishObservatory(MainActivity activity) throws Exception {
        evaluate(activity, "document.getElementById('make-button').click(); 'make'");
        awaitJavaScript(activity, "!!document.getElementById('draft-button')");
        evaluate(activity, """
                (() => {
                  const set = (id, value, eventName = 'input') => {
                    const field = document.getElementById(id);
                    if (!field) return false;
                    field.value = value;
                    field.dispatchEvent(new Event(eventName, { bubbles: true }));
                    return true;
                  };
                  set('command-input', 'Android Source Observatory');
                  set('recipe-select', 'observatory', 'change');
                  set('creation-title', 'Android Source Observatory');
                  document.getElementById('draft-button').click();
                  return 'drafted';
                })()
                """);
        awaitJavaScript(activity, "!!document.getElementById('publish-button')");
        // This helper creates a retained world object for save/restore tests.
        // Draft preview is covered by browser acceptance and is not part of this
        // persistence journey; the published Observatory is opened below.
        evaluate(activity, "document.getElementById('publish-button').click(); 'published'");
        awaitJavaScript(activity,
                "document.getElementById('creation-count').textContent === '1' && " +
                "document.getElementById('xp-count').textContent === '100'");
    }

    private Instrumentation.ActivityMonitor monitorDocumentPicker(String action, Uri selectedFile) throws IntentFilter.MalformedMimeTypeException {
        Intent result = new Intent();
        result.setData(selectedFile);
        IntentFilter filter = new IntentFilter(action);
        filter.addCategory(Intent.CATEGORY_OPENABLE);
        // Both native picker intents carry the JSON MIME type as well as the category.
        filter.addDataType("application/json");
        return InstrumentationRegistry.getInstrumentation().addMonitor(
                filter,
                new Instrumentation.ActivityResult(Activity.RESULT_OK, result),
                true
        );
    }

    private void awaitMonitor(Instrumentation.ActivityMonitor monitor) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            if (monitor.getHits() > 0) return;
            Thread.sleep(50);
        }
        throw new AssertionError("Android document picker was not launched");
    }

    private void awaitNonEmptyFile(File file) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            if (file.isFile() && file.length() > 0) return;
            Thread.sleep(50);
        }
        throw new AssertionError("Android world export was not written");
    }

    private void awaitStablePlayerPosition(MainActivity activity, long stableMillis) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
        long stableSince = 0;
        String previous = null;
        while (System.nanoTime() < deadline) {
            String current = evaluate(activity,
                    "JSON.stringify(JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')))");
            if (current == null || "null".equals(current)) {
                previous = null;
                stableSince = 0;
            } else if (current.equals(previous)) {
                if (System.nanoTime() - stableSince >= TimeUnit.MILLISECONDS.toNanos(stableMillis)) return;
            } else {
                previous = current;
                stableSince = System.nanoTime();
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Private player position did not remain stable for " + stableMillis + "ms");
    }

    private MainActivity activity() {
        AtomicReference<MainActivity> result = new AtomicReference<>();
        activityRule.getScenario().onActivity(result::set);
        return result.get();
    }

    private void awaitPageLoaded(MainActivity activity) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        AtomicReference<Boolean> ready = new AtomicReference<>(false);
        while (System.nanoTime() < deadline) {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                WebView current = activity.getGameWebViewForTests();
                ready.set(current != null && current.getUrl() != null && current.getProgress() == 100);
            });
            if (Boolean.TRUE.equals(ready.get())) return;
            Thread.sleep(100);
        }
        throw new AssertionError("WebView page did not finish loading: " + describeWebView(activity));
    }

    private String describeWebView(MainActivity activity) throws Exception {
        AtomicReference<String> state = new AtomicReference<>("state unavailable");
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView current = activity.getGameWebViewForTests();
            if (current == null) {
                state.set("webView=null, activityDestroyed=" + activity.isDestroyed()
                        + ", finishing=" + activity.isFinishing());
                return;
            }
            state.set("url=" + current.getUrl()
                    + ", progress=" + current.getProgress()
                    + ", title=" + current.getTitle()
                    + ", attached=" + current.isAttachedToWindow()
                    + ", visibility=" + current.getVisibility()
                    + ", windowVisibility=" + current.getWindowVisibility()
                    + ", activityDestroyed=" + activity.isDestroyed()
                    + ", finishing=" + activity.isFinishing());
        });
        return state.get();
    }

    private void awaitJavaScript(MainActivity activity, String condition) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        while (System.nanoTime() < deadline) {
            if ("true".equals(evaluate(activity, condition))) return;
            Thread.sleep(100);
        }
        throw new AssertionError("Timed out waiting for WebView condition: " + condition
                + "; " + describeWebView(activity));
    }

    private void awaitAccessibleText(String text) throws Exception {
        UiAutomation automation = InstrumentationRegistry.getInstrumentation().getUiAutomation();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        while (System.nanoTime() < deadline) {
            AccessibilityNodeInfo root = automation.getRootInActiveWindow();
            if (root != null) {
                List<AccessibilityNodeInfo> matches = root.findAccessibilityNodeInfosByText(text);
                if (matches != null && !matches.isEmpty()) return;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Timed out waiting for Android accessibility text: " + text);
    }

    private void clickAccessibleText(String text) throws Exception {
        UiAutomation automation = InstrumentationRegistry.getInstrumentation().getUiAutomation();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        while (System.nanoTime() < deadline) {
            AccessibilityNodeInfo root = automation.getRootInActiveWindow();
            if (root != null) {
                List<AccessibilityNodeInfo> matches = root.findAccessibilityNodeInfosByText(text);
                if (matches != null) {
                    for (AccessibilityNodeInfo match : matches) {
                        AccessibilityNodeInfo candidate = match;
                        while (candidate != null) {
                            if (candidate.isVisibleToUser() && candidate.isEnabled() && candidate.isClickable()
                                    && candidate.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                                return;
                            }
                            candidate = candidate.getParent();
                        }
                    }
                }
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Could not click enabled Android accessibility control: " + text);
    }

    private void awaitCounter(MainActivity activity, CounterCondition condition) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            if (condition.isMet()) return;
            Thread.sleep(100);
        }
        throw new AssertionError("Timed out waiting for Android request boundary");
    }

    private String evaluate(MainActivity activity, String script) throws Exception {
        WebView webView = activity.getGameWebViewForTests();
        assertTrue("activity WebView must exist", webView != null);

        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch latch = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
                webView.evaluateJavascript(script, value -> {
                    result.set(value);
                    latch.countDown();
                })
        );
        if (!latch.await(10, TimeUnit.SECONDS)) {
            throw new AssertionError("JavaScript evaluation did not complete for [" + script
                    + "]; " + describeWebView(activity));
        }
        return result.get();
    }

    private interface CounterCondition {
        boolean isMet();
    }
}
