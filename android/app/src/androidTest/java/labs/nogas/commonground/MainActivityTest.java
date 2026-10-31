package labs.nogas.commonground;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.webkit.WebView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.rule.ActivityScenarioRule;

import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public final class MainActivityTest {
    @Rule
    public final ActivityScenarioRule<MainActivity> activityRule =
            new ActivityScenarioRule<>(MainActivity.class);

    @Test
    public void bundledWorldStartsPrivatelyAndSharedModeFailsClosed() throws Exception {
        MainActivity activity = activity();
        awaitJavaScript(activity, "document.readyState === 'complete' && !!document.getElementById('start-shared')");

        evaluate(activity, "document.getElementById('start-shared').click(); 'requested'");
        awaitJavaScript(activity,
                "document.getElementById('doorway').hidden === false && document.getElementById('play-ui').hidden === true");
        assertTrue("shared API must be rejected by the offline shell",
                activity.getUnconfiguredApiRequestsForTests() > 0);
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
}
