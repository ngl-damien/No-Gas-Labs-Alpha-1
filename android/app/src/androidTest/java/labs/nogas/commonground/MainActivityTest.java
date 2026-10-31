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

        evaluate(activity, "localStorage.setItem('ngl.android.shell-smoke', 'persisted'); 'saved'");
        activityRule.getScenario().recreate();
        MainActivity recreated = activity();
        awaitJavaScript(recreated,
                "document.readyState === 'complete' && !!document.getElementById('start-private')");
        assertEquals("the stable appassets origin retains DOM storage across activity recreation",
                "\"persisted\"",
                evaluate(recreated, "localStorage.getItem('ngl.android.shell-smoke')"));
    }


    @Test
    public void nativeWorldExportAndImportRoundTripsEarnedProgress() throws Exception {
        MainActivity activity = activity();
        assertTrue("Android WebView must support the origin-scoped file bridge",
                activity.isNativeFileBridgeSupportedForTests());
        awaitJavaScript(activity,
                "document.readyState === 'complete' && !!document.getElementById('start-private')");
        evaluate(activity, "document.getElementById('start-private').click(); 'started'");
        awaitJavaScript(activity, "document.getElementById('play-ui').hidden === false");
        evaluate(activity, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true })); 'moving'");
        Thread.sleep(1200);
        evaluate(activity, "window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', bubbles: true })); 'stopped'");
        awaitJavaScript(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1'))?.x > 180");
        double expectedX = Double.parseDouble(evaluate(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')).x"));
        double expectedY = Double.parseDouble(evaluate(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')).y"));

        createAndPublishComic(activity);
        File exportFile = new File(
                InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(),
                "ngl-world-roundtrip.json");
        if (exportFile.exists()) assertTrue("old test export should be removable", exportFile.delete());

        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Instrumentation.ActivityMonitor createMonitor = monitorDocumentPicker(
                Intent.ACTION_CREATE_DOCUMENT, Uri.fromFile(exportFile));
        try {
            evaluate(activity, "document.getElementById('journal-button').click(); 'journal'");
            awaitJavaScript(activity,
                    "!!document.getElementById('export-world') && !!document.getElementById('import-world')");
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
                "document.readyState === 'complete' && !!document.getElementById('start-private')");
        evaluate(activity, "document.getElementById('start-private').click(); 'new private world'");
        awaitJavaScript(activity,
                "document.getElementById('play-ui').hidden === false && " +
                "document.getElementById('mode-label').textContent.includes('Private') && " +
                "document.getElementById('creation-count').textContent === '0' && " +
                "document.getElementById('xp-count').textContent === '0'");

        Instrumentation.ActivityMonitor openMonitor = monitorDocumentPicker(
                Intent.ACTION_OPEN_DOCUMENT, Uri.fromFile(exportFile));
        try {
            evaluate(activity, "document.getElementById('journal-button').click(); 'journal'");
            awaitJavaScript(activity, "!!document.getElementById('import-world')");
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
                "document.readyState === 'complete' && !!document.getElementById('start-private')");
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

    private MainActivity activity() {
        AtomicReference<MainActivity> result = new AtomicReference<>();
        activityRule.getScenario().onActivity(result::set);
        return result.get();
    }

    private void awaitJavaScript(MainActivity activity, String condition) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        while (System.nanoTime() < deadline) {
            if ("true".equals(evaluate(activity, condition))) return;
            Thread.sleep(100);
        }
        throw new AssertionError("Timed out waiting for WebView condition: " + condition);
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
        assertTrue("JavaScript evaluation did not complete", latch.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    private interface CounterCondition {
        boolean isMet();
    }
}
