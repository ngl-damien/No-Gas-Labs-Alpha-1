package labs.nogas.commonground;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.webkit.WebView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.rules.ActivityScenarioRule;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;

@RunWith(AndroidJUnit4.class)
public final class MainActivityTest {
    @Rule
    public final ActivityScenarioRule<MainActivity> activityRule =
            new ActivityScenarioRule<>(MainActivity.class);

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
    public void nativeBridgeRejectsSameOriginSiblingDocuments() throws Exception {
        MainActivity activity = activity();
        assertTrue(activity.isNativeFileBridgeSupportedForTests());
        String siblingUrl = "https://" + MainActivity.APP_HOST + "/assets/game/sibling.html";
        assertTrue(MainActivity.isTrustedGameDocumentForTests(MainActivity.GAME_URL));
        assertFalse(MainActivity.isTrustedGameDocumentForTests(siblingUrl));

        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        IntentFilter filter = new IntentFilter(Intent.ACTION_OPEN_DOCUMENT);
        filter.addCategory(Intent.CATEGORY_OPENABLE);
        filter.addDataType("application/json");
        Instrumentation.ActivityMonitor pickerMonitor = instrumentation.addMonitor(
                filter,
                new Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null),
                true
        );
        try {
            WebView webView = activity.getGameWebViewForTests();
            String siblingPage = """
                    <!doctype html>
                    <html><body><script>
                      document.documentElement.dataset.bridgeType =
                        typeof window.NglNative;
                      if (window.NglNative &&
                          typeof window.NglNative.postMessage === 'function') {
                        window.NglNative.postMessage(
                          JSON.stringify({ type: 'import-request' })
                        );
                      }
                    </script></body></html>
                    """;
            instrumentation.runOnMainSync(() ->
                    webView.loadDataWithBaseURL(siblingUrl, siblingPage, "text/html", "UTF-8", null)
            );
            awaitJavaScript(activity,
                    "document.readyState === 'complete' && " +
                    "document.documentElement.dataset.bridgeType === 'object'");
            Thread.sleep(500);
            assertEquals("same-origin sibling pages must not reach the native document picker",
                    0, pickerMonitor.getHits());
            AtomicReference<String> observedSiblingUrl = new AtomicReference<>();
            instrumentation.runOnMainSync(() -> observedSiblingUrl.set(webView.getUrl()));
            assertEquals("the sibling page is not the trusted game document",
                    siblingUrl, observedSiblingUrl.get());
        } finally {
            instrumentation.removeMonitor(pickerMonitor);
        }
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

        createAndPublishComic(activity);
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
        assertTrue("export must retain the published creation", exported.contains("Android round-trip artifact"));
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
                "location.reload(); 'cleared'");
        awaitJavaScript(activity,
                "document.readyState === 'complete' && typeof document.getElementById('start-private')?.onclick === 'function'");
        evaluate(activity, "document.getElementById('start-private').click(); 'new private world'");
        awaitJavaScript(activity,
                "document.getElementById('play-ui').hidden === false && " +
                "document.getElementById('mode-label').textContent.includes('Private') && " +
                "document.getElementById('creation-count').textContent === '0' && " +
                "document.getElementById('xp-count').textContent === '0'");

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

    private void createAndPublishComic(MainActivity activity) throws Exception {
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
                  set('command-input', 'Android round-trip artifact');
                  set('recipe-select', 'comic', 'change');
                  set('creation-title', 'Android round-trip artifact');
                  document.getElementById('draft-button').click();
                  return 'drafted';
                })()
                """);
        awaitJavaScript(activity,
                "!!document.getElementById('publish-button') && !!document.getElementById('preview-button')");
        evaluate(activity, "document.getElementById('preview-button').click(); 'preview'");
        awaitJavaScript(activity,
                "document.getElementById('artifact-frame')?.getAttribute('data-ngl-input-ready') === 'true'");
        evaluate(activity,
                "document.getElementById('portal-close').click(); " +
                "document.getElementById('publish-button').click(); 'published'");
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
