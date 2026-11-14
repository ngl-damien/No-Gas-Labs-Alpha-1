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
import android.webkit.WebViewRenderProcess;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.rules.ActivityScenarioRule;
import androidx.lifecycle.Lifecycle;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.io.File;
import java.util.HashSet;
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
    public void viewIsDetachedBeforeDestroyCallback() throws Exception {
        MainActivity activity = activity();
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        AtomicReference<Boolean> attachedAtDestroy = new AtomicReference<>(true);
        AtomicReference<Boolean> attachedBeforeDestroy = new AtomicReference<>(false);
        AtomicReference<Boolean> detachedAfterDestroy = new AtomicReference<>(false);
        AtomicReference<Integer> destroyCalls = new AtomicReference<>(0);
        AtomicReference<View> probe = new AtomicReference<>();

        instrumentation.runOnMainSync(() -> {
            View observed = new View(activity);
            activity.addContentView(observed, new ViewGroup.LayoutParams(1, 1));
            probe.set(observed);
        });
        instrumentation.waitForIdleSync();
        instrumentation.runOnMainSync(() -> {
            View observed = probe.get();
            attachedBeforeDestroy.set(observed.isAttachedToWindow());
            MainActivity.detachViewBeforeDestroy(observed, () -> {
                attachedAtDestroy.set(observed.isAttachedToWindow());
                destroyCalls.set(destroyCalls.get() + 1);
            });
            detachedAfterDestroy.set(observed.getParent() == null);
        });

        assertTrue("the probe view was attached before cleanup", attachedBeforeDestroy.get());
        assertFalse("the destroy callback must not run while the view is attached", attachedAtDestroy.get());
        assertTrue("the view is detached after cleanup", detachedAfterDestroy.get());
        assertEquals("the destroy callback must run exactly once", Integer.valueOf(1), destroyCalls.get());
    }

    @Test
    public void bundledWorldStartsPrivatelyAndSharedModeFailsClosed() throws Exception {
        MainActivity activity = activity();
        awaitPageLoaded(activity);
        assertEquals("offline Alpha-1 APK must not request INTERNET permission",
                PackageManager.PERMISSION_DENIED,
                activity.getPackageManager().checkPermission(
                        android.Manifest.permission.INTERNET, activity.getPackageName()));
        android.content.pm.PackageInfo packageInfo = activity.getPackageManager().getPackageInfo(
                activity.getPackageName(), PackageManager.GET_PERMISSIONS);
        assertFalse("offline Alpha-1 APK must not declare INTERNET permission",
                packageInfo.requestedPermissions != null &&
                        java.util.Arrays.asList(packageInfo.requestedPermissions)
                                .contains(android.Manifest.permission.INTERNET));
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
    public void guildHallSynthesisClerkShowsBundledProjectSnapshotWithoutWorldMutation() throws Exception {
        MainActivity activity = activity();
        awaitPageLoaded(activity);
        awaitJavaScript(activity,
                "document.readyState === 'complete' && !!document.getElementById('start-private')");
        evaluate(activity,
                "localStorage.removeItem('ngl.common-ground.v2'); " +
                "localStorage.removeItem('ngl.common-ground.v2.backup'); " +
                "localStorage.removeItem('ngl.common-ground.v2.actor'); " +
                "localStorage.removeItem('ngl.common-ground.player-position.v1'); 'clean'");
        evaluate(activity, "document.getElementById('start-private').click(); 'started'");
        awaitJavaScript(activity, "document.getElementById('play-ui').hidden === false");

        awaitJavaScript(activity, """
                document.querySelectorAll('[data-guild-npc-control="synthesizer"]').length === 1
                """);
        evaluate(activity, """
                Array.from(document.querySelectorAll('[data-guild-npc-control]'))
                  .find(button => button.dataset.guildNpcControl === 'synthesizer').click();
                'walk'
                """);
        awaitJavaScript(activity, """
                Array.from(document.querySelectorAll('[data-guild-npc-control]')).some(button =>
                  button.dataset.guildNpcControl === 'synthesizer' &&
                  button.dataset.guildNpcAction === 'talk')
                """);
        String beforeTalk = evaluate(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null') || " +
                "{revision:0,xp:0,events:[],creations:[],discoveries:[]}");
        evaluate(activity, """
                Array.from(document.querySelectorAll('[data-guild-npc-control]'))
                  .find(button => button.dataset.guildNpcControl === 'synthesizer' &&
                                  button.dataset.guildNpcAction === 'talk').click();
                'talk'
                """);
        awaitJavaScript(activity, """
                document.querySelector('[data-project-state-snapshot]')?.dataset.projectStateStatus === 'receipt-verified'
                """);
        assertEquals("Guild Hall remains the Synthesis Clerk's in-world workbench",
                "\"Guild Hall\"",
                evaluate(activity, "document.getElementById('sheet-title').textContent"));
        assertEquals("the snapshot identifies itself as not live",
                "true",
                evaluate(activity, "document.querySelector('[data-project-state-snapshot]')?.textContent.includes('NOT LIVE') === true"));
        assertEquals("the snapshot records its capture time",
                "true",
                evaluate(activity, "!!document.querySelector('[data-project-state-snapshot]')?.dataset.projectStateCapturedAt"));
        assertEquals("the snapshot binds to the APK source commit",
                "true",
                evaluate(activity, "!!document.querySelector('[data-project-state-snapshot]')?.dataset.projectStateBuildSha"));
        assertEquals("the read-only snapshot does not mutate the private world, XP, events, or creations",
                beforeTalk,
                evaluate(activity,
                        "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null') || " +
                        "{revision:0,xp:0,events:[],creations:[],discoveries:[]}"));
    }


    @Test
    public void privateSynthesisClerkSnapshotLeadBecomesLocalObservationWithoutXp() throws Exception {
        Log.i("labs.nogas.commonground.test", "private-synthesis stage=start");
        MainActivity activity = activity();
        awaitGameDocumentReady(activity);
        Log.i("labs.nogas.commonground.test", "private-synthesis stage=initial-page-ready");
        awaitJavaScript(activity,
                "document.readyState === 'complete' && typeof document.getElementById('start-private')?.onclick === 'function'");
        evaluate(activity,
                "localStorage.removeItem('ngl.common-ground.v2'); " +
                "localStorage.removeItem('ngl.common-ground.v2.backup'); " +
                "localStorage.removeItem('ngl.common-ground.v2.actor'); " +
                "localStorage.removeItem('ngl.common-ground.player-position.v1'); 'clean'");
        evaluate(activity, "document.getElementById('start-private').click(); 'started'");
        awaitJavaScript(activity, "document.getElementById('play-ui').hidden === false");

        createAndPublishObservatory(activity);
        awaitJavaScript(activity,
                "!document.getElementById('sheet').hidden && " +
                "document.getElementById('sheet-title').textContent === 'Android Source Observatory'");
        Log.i("labs.nogas.commonground.test", "private-synthesis stage=source-observatory-published");
        evaluate(activity, "document.getElementById('sheet-close').click(); 'close publication'");

        // Walk into Guild Hall, approach the fixed NPC, and read the bundled snapshot.
        evaluate(activity, "document.getElementById('places-button').click(); 'places'");
        awaitJavaScript(activity,
                "Array.from(document.querySelectorAll('button[aria-label]')).some(button => " +
                "button.getAttribute('aria-label') === 'Walk to Guild Hall')");
        evaluate(activity,
                "Array.from(document.querySelectorAll('button[aria-label]')).find(button => " +
                "button.getAttribute('aria-label') === 'Walk to Guild Hall').click(); 'walk'");
        awaitJavaScript(activity,
                "document.querySelectorAll('[data-guild-npc-control=\"synthesizer\"]').length === 1");
        evaluate(activity,
                "Array.from(document.querySelectorAll('[data-guild-npc-control]')).find(button => " +
                "button.dataset.guildNpcControl === 'synthesizer').click(); 'approach'");
        awaitJavaScript(activity,
                "Array.from(document.querySelectorAll('[data-guild-npc-control]')).some(button => " +
                "button.dataset.guildNpcControl === 'synthesizer' && button.dataset.guildNpcAction === 'talk')");
        String beforeTalk = evaluate(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null')");
        evaluate(activity,
                "Array.from(document.querySelectorAll('[data-guild-npc-control]')).find(button => " +
                "button.dataset.guildNpcControl === 'synthesizer' && button.dataset.guildNpcAction === 'talk').click(); 'talk'");
        awaitJavaScript(activity,
                "document.querySelector('[data-project-state-snapshot]')?.dataset.projectStateStatus === 'receipt-verified'");
        Log.i("labs.nogas.commonground.test", "private-synthesis stage=snapshot-read");
        assertEquals("reading the snapshot does not mutate the private world",
                beforeTalk,
                evaluate(activity, "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null')"));
        assertEquals("the bundled snapshot is explicitly not live", "true",
                evaluate(activity,
                        "document.querySelector('[data-project-state-snapshot]')?.textContent.includes('NOT LIVE') === true"));

        JSONObject sourceMeta = new JSONObject(evaluate(activity, """
                (() => {
                  const lead = document.querySelector('[data-project-state-record-lead="pullRequests"]');
                  const snapshot = document.querySelector('[data-project-state-snapshot]');
                  return {url: lead?.dataset.projectStateRecordUrl || '',
                          headSha: lead?.dataset.projectStateRecordHeadSha || '',
                          baseSha: lead?.dataset.projectStateRecordBaseSha || '',
                          headUrl: lead?.dataset.projectStateRecordHeadUrl || '',
                          checkSha: lead?.dataset.projectStateRecordCheckSha || '',
                          checkStatus: lead?.dataset.projectStateRecordCheckStatus || '',
                          checkCapturedAt: lead?.dataset.projectStateRecordCheckCapturedAt || '',
                          checkSummary: lead?.dataset.projectStateRecordCheckSummary || '',
                          capturedAt: snapshot?.dataset.projectStateCapturedAt || '',
                          digest: snapshot?.dataset.projectStateReceiptDigest || ''};
                })()
                """));
        String recordUrl = sourceMeta.getString("url");
        String headSha = sourceMeta.getString("headSha");
        String baseSha = sourceMeta.getString("baseSha");
        String headUrl = sourceMeta.getString("headUrl");
        String checkSha = sourceMeta.getString("checkSha");
        String checkStatus = sourceMeta.getString("checkStatus");
        String checkCapturedAt = sourceMeta.getString("checkCapturedAt");
        String checkSummary = sourceMeta.getString("checkSummary");
        String capturedAt = sourceMeta.getString("capturedAt");
        String receiptDigest = sourceMeta.getString("digest");
        assertTrue(recordUrl.startsWith("https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/pull/"));
        assertTrue(headSha.matches("[a-f0-9]{40}"));
        assertTrue(baseSha.matches("[a-f0-9]{40}"));
        assertEquals("https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/commit/" + headSha, headUrl);
        assertEquals("the check inventory must be bound to the captured PR head", headSha, checkSha);
        assertTrue(java.util.Arrays.asList(
                "unavailable", "failure-reported", "waiting", "checks-reported-success", "incomplete"
        ).contains(checkStatus));
        assertTrue("the selected recent PR must have an exact-head check capture time", !checkCapturedAt.isEmpty());
        assertTrue(checkSummary.contains("EXACT-HEAD CHECKS"));
        assertTrue(receiptDigest.matches("[a-f0-9]{64}"));

        evaluate(activity,
                "document.querySelector('[data-project-state-record-lead=\"pullRequests\"]').click(); 'prepare lead'");
        // Reaching Source Observatory is navigation only. The player must
        // explicitly use the nearby interaction control to enter the workbench.
        awaitJavaScript(activity,
                "document.getElementById('sheet').hidden === true && " +
                "document.getElementById('world')?.dataset.nearbyInstitutionId === 'source_observatory' && " +
                "((document.getElementById('enter-institution-button') && !document.getElementById('enter-institution-button').hidden && document.getElementById('enter-institution-button').getAttribute('aria-label') === 'Enter Source Observatory') || " +
                "document.getElementById('interact-button')?.getAttribute('aria-label') === 'Enter Source Observatory')");
        String beforeEnter = evaluate(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null')");
        String separateEntry = evaluate(activity,
                "document.getElementById('enter-institution-button') && !document.getElementById('enter-institution-button').hidden ? 'true' : 'false'");
        if ("true".equals(separateEntry)) {
            evaluate(activity, "document.getElementById('enter-institution-button').click(); 'enter Source Observatory'");
        } else {
            evaluate(activity, "document.getElementById('interact-button').click(); 'enter Source Observatory'");
        }
        awaitJavaScript(activity,
                "!document.getElementById('sheet').hidden && " +
                "document.getElementById('sheet-title').textContent === 'Source Observatory' && " +
                "document.querySelector('[data-source-observatory-prefill-lead]') !== null && " +
                "document.querySelector('[data-source-observatory-record-lead]') !== null");
        assertEquals("explicitly entering Source Observatory is read-only",
                beforeEnter,
                evaluate(activity, "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null')"));
        String beforeForm = evaluate(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null')");
        evaluate(activity,
                "document.querySelector('[data-source-observatory-record-lead]').click(); 'select exact version'");
        awaitJavaScript(activity,
                "document.querySelector('[data-source-observation-form]')?.dataset.sourceObservationPrefillOrigin === 'project-state-snapshot'");
        assertEquals("private attribution is disclosed", "true",
                evaluate(activity,
                        "document.querySelector('[data-source-observation-attribution-disclosure=\"private\"]')?.textContent.includes('PRIVATE SAVE · LOCAL ATTRIBUTION ONLY') === true"));
        assertEquals("the prefill discloses build-time and unverified status", "true",
                evaluate(activity,
                        "(() => { const text=document.querySelector('[data-source-observation-prefill-disclosure]')?.textContent || ''; " +
                        "return text.includes('build-time public GitHub snapshot') && text.includes('not live') && " +
                        "text.includes('not independently authored or verified'); })()"));

        JSONObject target = new JSONObject(evaluate(activity, """
                (() => {
                  const form = document.querySelector('[data-source-observation-form]');
                  return {creationId: form?.dataset.sourceObservationCreationId || '',
                          version: form?.dataset.sourceObservationVersion || ''};
                })()
                """));
        String creationId = target.getString("creationId");
        assertTrue(!creationId.isEmpty());
        assertEquals("1", target.getString("version"));
        String prefilledSource = evaluate(activity,
                "document.getElementById('source-observation-source')?.value || ''");
        String prefilledClaim = evaluate(activity,
                "document.getElementById('source-observation-claim')?.value || ''");
        assertTrue(prefilledSource.contains(headSha));
        assertTrue(prefilledSource.contains(headUrl));
        assertTrue(prefilledSource.contains(baseSha));
        assertTrue(prefilledSource.contains(checkStatus));
        assertTrue(prefilledSource.contains(checkCapturedAt));
        assertTrue(prefilledSource.contains(capturedAt));
        assertTrue(prefilledSource.contains(receiptDigest));
        assertTrue("prefilled source must fit the canonical 500-character bound", prefilledSource.length() <= 500);
        assertTrue(prefilledClaim.contains(headSha));
        assertTrue(prefilledClaim.contains(checkSummary));
        Log.i("labs.nogas.commonground.test", "private-synthesis stage=lead-prefilled");

        String claim = "At snapshot capture " + capturedAt +
                ", GitHub reported the selected pull request as open at head " + headSha +
                " with exact-head checks " + checkSummary + ".";
        String source = recordUrl + " · captured head " + headSha + " · " + headUrl +
                " · captured base " + baseSha + " · exact-head checks " + checkStatus +
                " captured " + checkCapturedAt + " · snapshot captured " + capturedAt +
                " · sha256 " + receiptDigest;
        assertTrue("edited source attribution must fit the canonical 500-character bound", source.length() <= 500);
        String falsifier = "A fresh independent GitHub read shows a different state, head SHA, or check inventory.";
        String uncertainty = "Build-time snapshot may be stale; the receipt identifies payload bytes only. Exact-head checks are GitHub-reported and may be incomplete or stale.";
        String nextTest = "Open the exact captured head commit and PR; confirm the current PR head still equals " +
                headSha + ", then compare a fresh check-run and commit-status inventory for that exact commit with these captured observations.";
        String fillNote = """
                (() => {
                  const set = (id, value, eventName = 'input') => {
                    const field = document.getElementById(id);
                    if (!field) return false;
                    field.value = value;
                    field.dispatchEvent(new Event(eventName, { bubbles: true }));
                    return true;
                  };
                  return [
                    set('source-observation-claim', %s),
                    set('source-observation-kind', 'tool-output', 'change'),
                    set('source-observation-source', %s),
                    set('source-observation-falsifier', %s),
                    set('source-observation-uncertainty', %s),
                    set('source-observation-next-test', %s)
                  ].every(Boolean);
                })()
                """.formatted(
                JSONObject.quote(claim), JSONObject.quote(source), JSONObject.quote(falsifier),
                JSONObject.quote(uncertainty), JSONObject.quote(nextTest));
        assertEquals("the prefilled lead can be edited locally", "true", evaluate(activity, fillNote));
        assertEquals("selecting a version and editing the note create no event",
                beforeForm,
                evaluate(activity, "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null')"));
        String beforeSubmit = evaluate(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null')");
        evaluate(activity, "document.getElementById('source-observation-submit').click(); 'submit'");
        awaitJavaScript(activity,
                "!document.getElementById('sheet').hidden && " +
                "document.getElementById('sheet-title').textContent === 'Android Source Observatory' && " +
                "document.querySelector('#source-observations')?.textContent.includes(" + JSONObject.quote(claim) + ")");
        Log.i("labs.nogas.commonground.test", "private-synthesis stage=local-observation-submitted");
        String afterSubmit = evaluate(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null')");
        JSONObject before = new JSONObject(beforeSubmit);
        JSONObject after = new JSONObject(afterSubmit);
        JSONArray beforeEvents = before.getJSONArray("events");
        JSONArray afterEvents = after.getJSONArray("events");
        assertEquals(beforeEvents.length() + 1, afterEvents.length());
        assertEquals(before.getInt("revision") + 1, after.getInt("revision"));
        assertEquals("a private source note awards no XP", before.getInt("xp"), after.getInt("xp"));

        JSONObject event = afterEvents.getJSONObject(afterEvents.length() - 1);
        assertEquals("source-observation-recorded", event.getString("type"));
        assertEquals(creationId, event.getString("creationId"));
        assertEquals(1, event.getInt("version"));
        assertEquals(claim, event.getString("claim"));
        assertEquals("tool-output", event.getString("sourceKind"));
        assertEquals(source, event.getString("source"));
        assertEquals(falsifier, event.getString("falsifier"));
        assertEquals(uncertainty, event.getString("uncertainty"));
        assertEquals(nextTest, event.getString("nextTest"));
        assertEquals("ngl.source-observatory.v2", event.getString("originSchema"));
        assertEquals("USER_SELECTED", event.getString("bindingMode"));
        assertEquals("NOT_PERFORMED", event.getString("sourceRetrieval"));
        assertEquals("NOT_PERFORMED", event.getString("independentVerification"));
        assertEquals("LEADS_ONLY", event.getString("modelAssertions"));
        assertEquals("NOT_EXECUTED", event.getString("execution"));
        JSONObject actor = event.getJSONObject("actor");
        assertEquals("founder", actor.getString("role"));
        assertTrue("the local actor label is present but is not authenticated", !actor.getString("id").isEmpty());
        String observationId = event.getString("observationId");
        assertTrue(observationId.matches("source-observation-[a-f0-9]{64}"));
        assertEquals(observationId.substring("source-observation-".length()),
                event.getString("normalizedRecordDigest"));
        String eventId = event.getString("id");
        Log.i("labs.nogas.commonground.test", "private-synthesis stage=event-verified");

        // Recreate the native Activity and inspect the same retained research object.
        Log.i("labs.nogas.commonground.test", "private-synthesis stage=before-activity-recreation");
        activityRule.getScenario().recreate();
        MainActivity recreated = activity();
        awaitPageLoaded(recreated);
        Log.i("labs.nogas.commonground.test", "private-synthesis stage=activity-recreated");
        awaitJavaScript(recreated,
                "document.readyState === 'complete' && typeof document.getElementById('start-private')?.onclick === 'function'");
        evaluate(recreated, "document.getElementById('start-private').click(); 'restore private world'");
        awaitJavaScript(recreated, "document.getElementById('play-ui').hidden === false");
        String restoredState = evaluate(recreated,
                "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null')");
        JSONObject restored = new JSONObject(restoredState);
        JSONArray restoredEvents = restored.getJSONArray("events");
        assertEquals(after.getInt("revision"), restored.getInt("revision"));
        assertEquals(after.getInt("xp"), restored.getInt("xp"));
        assertEquals(afterEvents.length(), restoredEvents.length());
        assertEquals(eventId,
                restoredEvents.getJSONObject(restoredEvents.length() - 1).getString("id"));

        evaluate(recreated, "document.getElementById('places-button').click(); 'places'");
        awaitJavaScript(recreated,
                "Array.from(document.querySelectorAll('button[aria-label]')).some(button => " +
                "button.getAttribute('aria-label') === 'Walk to Source Observatory')");
        evaluate(recreated,
                "Array.from(document.querySelectorAll('button[aria-label]')).find(button => " +
                "button.getAttribute('aria-label') === 'Walk to Source Observatory').click(); 'return'");
        enterNearbyInstitution(recreated, "source_observatory", "Source Observatory");
        awaitJavaScript(recreated, "document.querySelector('[data-source-observatory-open]') !== null");
        evaluate(recreated, "document.querySelector('[data-source-observatory-open]').click(); 'history'");
        awaitJavaScript(recreated,
                "!document.getElementById('sheet').hidden && " +
                "document.getElementById('sheet-title').textContent === 'Android Source Observatory' && " +
                "document.querySelector('#source-observations')?.textContent.includes(" + JSONObject.quote(claim) + ")");
        assertEquals("the offline note remains visible after Activity recreation", "true",
                evaluate(recreated,
                        "document.querySelector('#source-observations')?.textContent.includes(" + JSONObject.quote(claim) + ") === true"));
        assertEquals("reopening retained history is read-only",
                restoredState,
                evaluate(recreated, "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null')"));
        Log.i("labs.nogas.commonground.test", "private-synthesis stage=retained-history-reopened");
        Log.i("labs.nogas.commonground.test", "private-synthesis stage=complete");
    }


    @Test
    public void privateWorldWebViewStorageSurvivesActivityRecreation() throws Exception {
        MainActivity activity = activity();
        awaitPageLoaded(activity);
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
        awaitPageLoaded(activity);
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
            awaitCompleteJsonFile(exportFile);
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
                "window.__nglAndroidReloadMarker = 'private-save-reset'; 'cleared'");
        reloadWebView(activity);
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
        awaitPageLoaded(recreated);
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
    public void nativeExportRejectsSameLengthDigestMismatchBeforeOpeningSavePicker() throws Exception {
        MainActivity activity = activity();
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        NativeWorldFiles files = new NativeWorldFiles(activity);
        File unexpected = new File(
                InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(),
                "ngl-rejected-digest-export.json");
        if (unexpected.exists()) assertTrue(unexpected.delete());
        Instrumentation.ActivityMonitor monitor = monitorDocumentPicker(
                Intent.ACTION_CREATE_DOCUMENT, Uri.fromFile(unexpected));
        byte[] payload = new byte[]{1, 2, 3};
        String start = new JSONObject()
                .put("type", "export-start")
                .put("name", "tampered.json")
                .put("mime", "application/json")
                .put("size", payload.length)
                .put("sha256", "0".repeat(64))
                .toString();
        try {
            files.onMessage(new androidx.webkit.WebMessageCompat(start), null);
            files.onMessage(new androidx.webkit.WebMessageCompat(payload), null);
            files.onMessage(new androidx.webkit.WebMessageCompat("{\"type\":\"export-complete\"}"), null);
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (files.isExportTransferActiveForTests() && System.nanoTime() < deadline) Thread.sleep(10);
            instrumentation.waitForIdleSync();
            assertFalse("digest mismatch must abort the native export", files.isExportTransferActiveForTests());
            assertEquals("the mismatched digest path must be reached exactly once", 1, files.getExportDigestMismatchCountForTests());
            assertEquals("same-length corrupted bytes must not open the Android save picker", 0, monitor.getHits());
            assertFalse("a rejected export must not leave a destination file", unexpected.exists());
        } finally {
            instrumentation.removeMonitor(monitor);
            files.close();
            if (unexpected.exists()) unexpected.delete();
        }
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
                    if (typeof message.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(message.sha256)) return;
                    incoming = {name:message.name,size:message.size,sha256:message.sha256,parts:[],received:0};
                  } else if (message?.type === 'ngl-native-file-import-chunk') {
                    if (!incoming || !(message.bytes instanceof ArrayBuffer)) return;
                    incoming.parts.push(message.bytes);
                    incoming.received += message.bytes.byteLength;
                  } else if (message?.type === 'ngl-native-file-import-complete') {
                    const transfer = incoming;
                    incoming = null;
                    if (!transfer || transfer.received !== transfer.size || !/^[a-f0-9]{64}$/.test(transfer.sha256)) return;
                    const file = new File(transfer.parts, transfer.name, {type:'application/json'});
                    const selection = new DataTransfer();
                    selection.items.add(file);
                    const input = document.getElementById('backup-file');
                    input.files = selection.files;
                    input.dispatchEvent(new Event('change', {bubbles:true}));
                    if (await file.text() === EXPECTED) {
                      parent.postMessage({type:'ngl-native-file-import-received',name:transfer.name,size:transfer.size,sha256:transfer.sha256}, '*');
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
            awaitJavaScript(activity,
                    "document.getElementById('artifact-frame')?.dataset.nglNativeExportSha256 && " +
                    "/^[a-f0-9]{64}$/.test(document.getElementById('artifact-frame').dataset.nglNativeExportSha256)");
            awaitCompleteJsonFile(exportFile);
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
                            JSONObject.quote(exportFile.getName() + ":" + exportFile.length()));
            awaitJavaScript(activity,
                    "document.getElementById('artifact-frame')?.dataset.nglNativeImportStage === 'acknowledged' && " +
                    "document.getElementById('artifact-frame')?.dataset.nglNativeImportSha256 && " +
                    "/^[a-f0-9]{64}$/.test(document.getElementById('artifact-frame').dataset.nglNativeImportSha256)");
        } finally {
            instrumentation.removeMonitor(openMonitor);
        }

        assertTrue("test export should be removable", exportFile.delete());
        assertEquals("the sandboxed transfer does not create a game-world session",
                "true", evaluate(activity, "document.getElementById('play-ui').hidden"));
    }


    @Test
    public void founderGateIsReachableThroughTheMobileWorldAndRemainsReadOnly() throws Exception {
        MainActivity activity = activity();
        awaitPageLoaded(activity);
        awaitJavaScript(activity,
                "document.readyState === 'complete' && typeof document.getElementById('start-private')?.onclick === 'function'");
        evaluate(activity,
                "localStorage.removeItem('ngl.common-ground.v2'); " +
                "localStorage.removeItem('ngl.common-ground.v2.backup'); " +
                "localStorage.removeItem('ngl.common-ground.player-position.v1'); 'clean'");
        evaluate(activity, "document.getElementById('start-private').click(); 'started'");
        awaitJavaScript(activity,
                "document.getElementById('play-ui').hidden === false && " +
                "document.getElementById('creation-count').textContent === '0' && " +
                "document.getElementById('xp-count').textContent === '0'");

        // A brand-new private world is an in-memory seed until its first action.
        // After clearing storage, compare navigation against the exact createWorld()
        // empty baseline instead of asking Android to parse a missing localStorage value.
        String worldBefore = evaluate(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null') || " +
                "{revision:0,xp:0,events:[],creations:[],discoveries:[]}");
        evaluate(activity, "document.getElementById('places-button').click(); 'places'");
        awaitJavaScript(activity,
                "Array.from(document.querySelectorAll('button[aria-label]')).some(button => " +
                "button.getAttribute('aria-label') === 'Walk to Founder Gate')");
        evaluate(activity,
                "Array.from(document.querySelectorAll('button[aria-label]')).find(button => " +
                "button.getAttribute('aria-label') === 'Walk to Founder Gate').click(); 'walk'");

        // The map route only approaches the institution; entering the Founder Gate is explicit.
        enterNearbyInstitution(activity, "decision_chamber", "Decision Chamber");
        awaitJavaScript(activity,
                "document.getElementById('sheet').getAttribute('role') === 'dialog' && " +
                "document.getElementById('sheet').getAttribute('aria-modal') === 'true' && " +
                "document.getElementById('sheet').getAttribute('aria-labelledby') === 'sheet-title'");
        assertEquals("the mobile world route opens the Decision Chamber sheet",
                "\"Decision Chamber\"",
                evaluate(activity, "document.getElementById('sheet-title').textContent"));
        assertEquals("the Founder Gate is a labelled modal dialog",
                "true",
                evaluate(activity,
                        "(() => { const dialog=document.getElementById('sheet'); " +
                        "return dialog.getAttribute('role') === 'dialog' && " +
                        "dialog.getAttribute('aria-modal') === 'true' && " +
                        "dialog.getAttribute('aria-labelledby') === 'sheet-title' && " +
                        "document.getElementById('sheet-title').textContent === 'Decision Chamber'; })()"));
        assertEquals("the sheet identifies the human-gate function",
                "\"HUMAN GATE · DECISIONS\"",
                evaluate(activity, "document.getElementById('sheet-kicker').textContent"));
        assertEquals("private progress is not represented as institutional work",
                "true",
                evaluate(activity,
                        "document.getElementById('sheet-content').textContent.includes(" +
                        "'Private game progress does not establish institutional work.')"));
        assertEquals("private Founder Gate exposes no disposition controls",
                "0",
                evaluate(activity, "document.querySelectorAll('[data-gate-action]').length"));
        String worldAfter = evaluate(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null') || " +
                "{revision:0,xp:0,events:[],creations:[],discoveries:[]}");
        assertNavigationOnlyDiscovers(worldBefore, worldAfter, "Founder Gate arrival");
        assertEquals("arrival and inspection award no XP",
                "\"0\"",
                evaluate(activity, "document.getElementById('xp-count').textContent"));
        assertEquals("arrival and inspection create no building",
                "\"0\"",
                evaluate(activity, "document.getElementById('creation-count').textContent"));
    }


    @Test
    public void privateCombatYardJourneyPersistsNativeProgressAcrossActivityRecreation() throws Exception {
        MainActivity activity = activity();
        awaitPageLoaded(activity);
        assertEquals("offline Alpha-1 APK must not request INTERNET permission",
                PackageManager.PERMISSION_DENIED,
                activity.getPackageManager().checkPermission(
                        android.Manifest.permission.INTERNET, activity.getPackageName()));
        awaitJavaScript(activity,
                "document.readyState === 'complete' && typeof document.getElementById('start-private')?.onclick === 'function'");
        evaluate(activity,
                "localStorage.removeItem('ngl.common-ground.v2'); " +
                "localStorage.removeItem('ngl.common-ground.v2.backup'); " +
                "localStorage.removeItem('ngl.common-ground.v2.actor'); " +
                "localStorage.removeItem('ngl.common-ground.player-position.v1'); 'clean'");
        evaluate(activity, "document.getElementById('start-private').click(); 'started'");
        awaitJavaScript(activity,
                "document.getElementById('play-ui').hidden === false && !!document.getElementById('world')");

        String worldBefore = evaluate(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null') || " +
                "{revision:0,xp:0,events:[],creations:[],discoveries:[]}");
        awaitJavaScript(activity, """
                document.querySelectorAll('[data-guild-npc-control="combat-marshal"]').length === 1
                """);
        evaluate(activity, """
                Array.from(document.querySelectorAll('[data-guild-npc-control]'))
                  .find(button => button.dataset.guildNpcControl === 'combat-marshal').click();
                'walk'
                """);
        awaitJavaScript(activity, """
                Array.from(document.querySelectorAll('[data-guild-npc-control]')).some(button =>
                  button.dataset.guildNpcControl === 'combat-marshal' &&
                  button.dataset.guildNpcAction === 'talk')
                """);
        String afterApproach = evaluate(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null') || " +
                "{revision:0,xp:0,events:[],creations:[],discoveries:[]}");
        assertNavigationOnlyDiscovers(worldBefore, afterApproach, "Combat Marshal approach");
        JSONArray approachEvents = new JSONObject(afterApproach).getJSONArray("events");
        for (int index = 0; index < approachEvents.length(); index++) {
            assertFalse("Combat Yard is an institution, not a discovery landmark",
                    "combat_yard".equals(approachEvents.getJSONObject(index).optString("locationId")));
        }

        evaluate(activity, """
                Array.from(document.querySelectorAll('[data-guild-npc-control]'))
                  .find(button => button.dataset.guildNpcControl === 'combat-marshal' &&
                                  button.dataset.guildNpcAction === 'talk').click();
                'talk'
                """);
        awaitJavaScript(activity, """
                !document.getElementById('sheet').hidden &&
                document.getElementById('sheet-title').textContent === 'Combat Yard' &&
                !!document.querySelector('[data-combat-yard-panel]')
                """);
        String afterTalk = evaluate(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.v2') || 'null') || " +
                "{revision:0,xp:0,events:[],creations:[],discoveries:[]}");
        assertEquals("approaching or talking to the fixed Marshal must not create events or XP",
                afterApproach, afterTalk);
        assertEquals("\"0\"", evaluate(activity,
                "document.querySelector('[data-combat-yard-panel]').dataset.combatXp"));

        evaluate(activity, """
                Array.from(document.querySelectorAll('[data-combat-opponent]'))
                  .find(button => button.dataset.combatOpponent === 'yard-scout').click();
                'start'
                """);
        awaitJavaScript(activity, """
                document.querySelector('[data-combat-yard-panel]')?.dataset.combatStatus === 'active'
                """);

        String[] moves = {"feint", "guard", "strike", "feint", "guard", "strike"};
        String[] phases = {"strike", "recovery", "windup", "strike", "recovery", "windup"};
        for (int index = 0; index < moves.length; index++) {
            String action = moves[index];
            evaluate(activity,
                    "Array.from(document.querySelectorAll('[data-combat-move]'))" +
                    ".find(button => button.dataset.combatMove === '" + action + "').click(); 'move'");
            if (index < moves.length - 1) {
                awaitJavaScript(activity,
                        "document.querySelector('[data-combat-yard-panel]')?.dataset.combatPhase === '" +
                        phases[index] + "'");
            }
        }
        awaitJavaScript(activity, """
                document.querySelector('[data-combat-yard-panel]')?.dataset.combatStatus === 'victory'
                """);
        assertEquals("\"30\"", evaluate(activity,
                "document.querySelector('[data-combat-yard-panel]').dataset.combatXp"));
        assertEquals("\"1\"", evaluate(activity,
                "document.querySelector('[data-combat-yard-panel]').dataset.combatVictories"));

        String afterVictory = evaluate(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.v2'))");
        JSONObject savedWorld = new JSONObject(afterVictory);
        JSONArray savedEvents = savedWorld.getJSONArray("events");
        assertEquals("revision is the exact retained event count",
                savedEvents.length(), savedWorld.getInt("revision"));
        assertEquals("combat XP must not change publication-only world XP", 0, savedWorld.getInt("xp"));

        int starts = 0;
        int resolvedMoves = 0;
        int moveIndex = 0;
        String[] expectedMoves = {"feint", "guard", "strike", "feint", "guard", "strike"};
        String combatActorId = null;
        String combatActorRole = null;
        HashSet<String> eventIds = new HashSet<>();
        for (int index = 0; index < savedEvents.length(); index++) {
            JSONObject event = savedEvents.getJSONObject(index);
            assertTrue("all retained event IDs must be unique", eventIds.add(event.getString("id")));
            String type = event.getString("type");
            if ("combat-encounter-started".equals(type)) {
                starts++;
                assertEquals("yard-scout", event.getString("opponentId"));
                combatActorId = event.getJSONObject("actor").getString("id");
                combatActorRole = event.getJSONObject("actor").getString("role");
            } else if ("combat-move-resolved".equals(type)) {
                resolvedMoves++;
                JSONObject actor = event.getJSONObject("actor");
                assertEquals(combatActorId, actor.getString("id"));
                assertEquals(combatActorRole, actor.getString("role"));
                assertEquals(expectedMoves[moveIndex++], event.getString("move"));
            }
        }
        assertEquals("one explicit encounter start is retained", 1, starts);
        assertEquals("six explicit player moves are retained", 6, resolvedMoves);
        assertEquals("the private actor is a local Founder game character", "founder", combatActorRole);
        assertTrue("the local actor ID is non-empty", combatActorId != null && !combatActorId.isEmpty());
        assertEquals("all six expected moves were retained", expectedMoves.length, moveIndex);
        assertEquals("the publication XP counter remains unchanged", "\"0\"",
                evaluate(activity, "document.getElementById('xp-count').textContent"));
        assertEquals("private combat stays inside the bundled appassets shell",
                0, activity.getBlockedExternalRequestsForTests());

        activityRule.getScenario().recreate();
        MainActivity restored = activity();
        awaitPageLoaded(restored);
        awaitJavaScript(restored,
                "document.readyState === 'complete' && typeof document.getElementById('start-private')?.onclick === 'function'");
        evaluate(restored, "document.getElementById('start-private').click(); 'resume'");
        awaitJavaScript(restored, "document.getElementById('play-ui').hidden === false");
        JSONObject resumedWorld = new JSONObject(evaluate(restored,
                "JSON.parse(localStorage.getItem('ngl.common-ground.v2'))"));
        assertEquals("activity recreation must retain the exact combat event history",
                savedEvents.toString(), resumedWorld.getJSONArray("events").toString());
        assertEquals("activity recreation must retain the exact revision",
                savedWorld.getInt("revision"), resumedWorld.getInt("revision"));
        assertEquals("activity recreation must not invent publication XP", 0, resumedWorld.getInt("xp"));
        assertEquals("recovered private combat must remain offline",
                0, restored.getBlockedExternalRequestsForTests());

        evaluate(restored, "document.getElementById('places-button').click(); 'places'");
        awaitJavaScript(restored, """
                Array.from(document.querySelectorAll('button[aria-label]')).some(button =>
                  button.getAttribute('aria-label') === 'Walk to Quest Board')
                """);
        evaluate(restored, """
                Array.from(document.querySelectorAll('button[aria-label]'))
                  .find(button => button.getAttribute('aria-label') === 'Walk to Quest Board').click();
                'walk'
                """);
        enterNearbyInstitution(restored, "quest_board", "Quest Board");
        assertEquals("the retained Scout victory exposes the full actor quest ladder",
                "true", evaluate(restored, """
                (() => {
                  const text = document.getElementById('sheet-content').textContent;
                  return text.includes('Win a deterministic Combat Yard training encounter') &&
                    text.includes('Defeat the Training Warden in the Combat Yard') &&
                    text.includes('Defeat the Training Champion in the Combat Yard');
                })()
                """));
        assertEquals("the retained Scout first victory is recorded for this Founder",
                "true", evaluate(restored, """
                document.querySelector('[data-objective-id="founder-combat-yard-first-victory"]')
                  ?.classList.contains('is-recorded')
                """));
        assertEquals("the retained Scout first victory makes the Warden actionable for this Founder",
                "true", evaluate(restored, """
                (() => {
                  const row = document.querySelector('[data-objective-id="founder-combat-yard-warden-first-victory"]');
                  return row?.classList.contains('is-open') &&
                    row.querySelector('.quest-action') !== null &&
                    row.querySelector('.quest-blocked') === null;
                })()
                """));
        assertEquals("the Champion remains blocked until this Founder retains a Warden first victory",
                "true", evaluate(restored, """
                (() => {
                  const row = document.querySelector('[data-objective-id="founder-combat-yard-champion-first-victory"]');
                  return row?.classList.contains('is-open') &&
                    row.querySelector('.quest-action') === null &&
                    row.querySelector('.quest-blocked')?.textContent.includes(
                      'Defeat the Training Warden first to unlock the Training Champion.');
                })()
                """));
        assertEquals("only the Scout first-victory objective is recorded",
                "true", evaluate(restored, """
                document.querySelector('[data-quest-board]')?.querySelectorAll(
                  '[data-objective-id^="founder-combat-yard-"].is-recorded').length === 1
                """));

        evaluate(restored,
                "document.getElementById('sheet-close').click(); " +
                "document.getElementById('character-button').click(); 'character'");
        awaitJavaScript(restored,
                "document.getElementById('sheet-title').textContent === 'Character & field record'");
        assertEquals("the Combatant skill is reconstructed after activity recreation",
                "true", evaluate(restored, """
                document.querySelector('[data-skill-id="combatant"]')?.textContent.includes('1 recorded')
                """));
        assertEquals("the fixed first-victory reward is reconstructed after activity recreation",
                "true", evaluate(restored,
                "document.getElementById('sheet-content').textContent.includes('30 character XP')"));
    }


    @Test
    public void publishedSourceObservatoryRestoresNativeBackupThroughPreviewAndAppendWithoutWorldProgress() throws Exception {
        MainActivity activity = activity();
        awaitPageLoaded(activity);
        assertTrue("the Android WebView must support the bounded native file bridge",
                activity.isNativeFileBridgeSupportedForTests());
        awaitJavaScript(activity,
                "window.__nglNativeFileBridgeInstalled === true && " +
                "typeof window.__nglNativeRequestArtifactImport === 'function' && " +
                "typeof window.__nglNativeRequestArtifactExport === 'function'");
        awaitJavaScript(activity,
                "document.readyState === 'complete' && typeof document.getElementById('start-private')?.onclick === 'function'");
        // WebView localStorage survives ActivityScenario recreation and can be
        // shared by successive instrumentation methods. Give this test its own
        // empty private-world fixture before publishing the Observatory.
        evaluate(activity,
                "localStorage.removeItem('ngl.common-ground.v2'); " +
                "localStorage.removeItem('ngl.common-ground.v2.backup'); " +
                "localStorage.removeItem('ngl.common-ground.player-position.v1'); 'clean'");
        evaluate(activity, "document.getElementById('start-private').click(); 'started'");
        awaitJavaScript(activity,
                "document.getElementById('play-ui').hidden === false && " +
                "document.getElementById('creation-count').textContent === '0' && " +
                "document.getElementById('xp-count').textContent === '0'");
        createAndPublishObservatory(activity);

        // Observe the saved position first, then the actual arrival interaction.
        // If routing stalls, the timeout diagnostic includes the persisted player
        // position, retained creation coordinates, sheet state and modal state.
        awaitJavaScript(activity,
                "(() => { const p=JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')); " +
                "return !!p && Math.hypot(p.x-540,p.y-700)<50; })()");
        awaitJavaScript(activity,
                "!document.getElementById('sheet').hidden && " +
                "document.getElementById('sheet-title').textContent === 'Android Source Observatory'");
        assertEquals("the character reached the published Observatory through the world route",
                "true",
                evaluate(activity,
                        "(() => { const p=JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')); " +
                        "return !!p && Math.hypot(p.x-540,p.y-700)<50; })()"));
        evaluate(activity, "document.getElementById('sheet-close').click(); 'close published Observatory'");
        awaitJavaScript(activity,
                "document.getElementById('sheet').hidden && !document.body.classList.contains('modal-open')");

        evaluate(activity, "document.getElementById('places-button').click(); 'places'");
        awaitJavaScript(activity,
                "Array.from(document.querySelectorAll('button[aria-label]')).some(button => button.getAttribute('aria-label') === 'Walk to Source Observatory')");
        evaluate(activity,
                "Array.from(document.querySelectorAll('button[aria-label]')).find(button => button.getAttribute('aria-label') === 'Walk to Source Observatory').click(); 'walk'");
        // The route only approaches Source Observatory; entering its workbench is a separate action.
        enterNearbyInstitution(activity, "source_observatory", "Source Observatory");
        awaitJavaScript(activity,
                "document.getElementById('sheet').getAttribute('role') === 'dialog' && " +
                "document.getElementById('sheet').getAttribute('aria-modal') === 'true' && " +
                "document.getElementById('sheet').getAttribute('aria-labelledby') === 'sheet-title' && " +
                "document.querySelector('[data-source-observatory]') !== null && " +
                "Array.from(document.querySelectorAll('[data-source-observatory-open]')).some(button => " +
                "button.textContent.includes('Inspect retained research history'))");
        assertEquals("the route opened the physical Source Observatory workbench",
                "\"Source Observatory\"",
                evaluate(activity, "document.getElementById('sheet-title').textContent"));
        assertEquals("the in-world workbench is open",
                "true",
                evaluate(activity, "document.querySelector('[data-source-observatory]') !== null"));
        assertEquals("the retained publication exposes its exact-version history control",
                "true",
                evaluate(activity, "document.querySelector('[data-source-observatory-open]') !== null"));
        assertEquals("the history action exposes a readable button name",
                "true",
                evaluate(activity,
                        "(() => { const button=document.querySelector('[data-source-observatory-open]'); " +
                        "return !!button && button.tagName === 'BUTTON' && " +
                        "button.textContent.includes('Inspect retained research history'); })()"));
        evaluate(activity, "document.querySelector('[data-source-observatory-open]').click(); 'open retained Observatory'");
        awaitJavaScript(activity,
                "!document.getElementById('sheet').hidden && " +
                "document.getElementById('sheet-title').textContent === 'Android Source Observatory' && " +
                "!!document.getElementById('enter-creation')");
        evaluate(activity, "document.getElementById('enter-creation').click(); 'enter published Observatory'");
        awaitJavaScript(activity,
                "!document.getElementById('portal').hidden && " +
                "document.querySelector('[data-native-observatory-export]') !== null && " +
                "document.querySelector('[data-native-observatory-import]') !== null && " +
                "document.getElementById('artifact-frame')?.getAttribute('data-ngl-input-ready') === 'true'");
        // The native bridge handshake follows the sandboxed srcdoc's painted signal;
        // the iframe's first load can describe about:blank before srcdoc is installed.
        awaitJavaScript(activity,
                "document.getElementById('artifact-frame')?.dataset.nglNativeBridgeHandshakeSent === 'true'");
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

        // The native build hides the sandbox's own file controls once the privileged bridge
        // is ready. The user-facing review controls are parent-owned buttons in the labelled
        // review region. Exercise that real UI and its generation-bound message round-trip
        // without asking Android's accessibility service to traverse an opaque-origin iframe.
        awaitJavaScript(activity,
                "(() => { const panel=document.querySelector('[data-native-observatory-review]'); " +
                "const preview=panel?.querySelector('[data-native-observatory-preview]'); " +
                "return !!panel && !panel.hidden && panel.getAttribute('role') === 'region' && " +
                "panel.getAttribute('aria-label') === 'Local notebook import review' && " +
                "preview instanceof HTMLButtonElement && preview.textContent.trim() === 'Preview backup' && " +
                "!preview.disabled; })()");
        assertEquals("native import exposes a visible, labelled parent-owned review region",
                "true",
                evaluate(activity,
                        "(() => { const panel=document.querySelector('[data-native-observatory-review]'); " +
                        "return !!panel && !panel.hidden && panel.getAttribute('role') === 'region' && " +
                        "panel.getAttribute('aria-label') === 'Local notebook import review'; })()"));
        evaluate(activity, "document.querySelector('[data-native-observatory-preview]').click(); 'preview requested'");
        awaitJavaScript(activity,
                "(() => { const panel=document.querySelector('[data-native-observatory-review]'); " +
                "const status=panel?.querySelector('[role=status]'); " +
                "const append=panel?.querySelector('[data-native-observatory-append]'); " +
                "return !!panel && !panel.hidden && " +
                "status?.textContent.startsWith('Preview ready: 1 new note(s); skipped 0 exact-content duplicate(s).') && " +
                "panel.textContent.includes('Native recovery note') && " +
                "panel.textContent.includes('Model assertion: lead only, not evidence.') && " +
                "panel.querySelectorAll('.native-observatory-review-item').length === 1 && " +
                "append instanceof HTMLButtonElement && !append.disabled; })()");
        evaluate(activity, "document.querySelector('[data-native-observatory-append]').click(); 'append requested'");
        awaitJavaScript(activity,
                "(() => { const panel=document.querySelector('[data-native-observatory-review]'); " +
                "const status=panel?.querySelector('[role=status]'); " +
                "const append=panel?.querySelector('[data-native-observatory-append]'); " +
                "return status?.textContent.startsWith('Added 1 local observation(s); skipped 0 exact-content duplicate(s).') && " +
                "append instanceof HTMLButtonElement && append.disabled; })()");

        Instrumentation.ActivityMonitor createMonitor = monitorDocumentPicker(
                Intent.ACTION_CREATE_DOCUMENT, Uri.fromFile(roundTrip));
        try {
            evaluate(activity, "document.querySelector('[data-native-observatory-export]').click(); 'save restored notebook'");
            awaitMonitor(createMonitor);
            awaitCompleteJsonFile(roundTrip);
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
                "\"100\"", evaluate(activity, "document.getElementById('xp-count').textContent"));
        assertEquals("local notebook work does not create another world building",
                "\"1\"", evaluate(activity, "document.getElementById('creation-count').textContent"));
        assertTrue("native import fixture should be removable", backup.delete());
        assertTrue("native round-trip export should be removable", roundTrip.delete());
    }

    @Test
    public void rendererProcessDeathOffersExplicitRecoveryAndPreservesSavedWorld() throws Exception {
        Log.i("labs.nogas.commonground.test", "renderer-recovery stage=start");
        MainActivity activity = activity();
        awaitPageLoaded(activity);
        evaluate(activity,
                "localStorage.removeItem('ngl.common-ground.v2'); " +
                "localStorage.removeItem('ngl.common-ground.v2.backup'); " +
                "localStorage.removeItem('ngl.common-ground.v2.actor'); " +
                "localStorage.removeItem('ngl.common-ground.player-position.v1'); 'clean'");
        evaluate(activity, "document.getElementById('start-private').click(); 'started'");
        awaitJavaScript(activity, "document.getElementById('play-ui').hidden === false");
        awaitJavaScript(activity, "document.visibilityState === 'visible' && document.hasFocus()");

        evaluate(activity,
                "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true })); 'moving'");
        awaitJavaScript(activity,
                "JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1'))?.x > 180");
        evaluate(activity,
                "window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', bubbles: true })); 'stopped'");
        awaitStablePlayerPosition(activity, 1800);
        createAndPublishObservatory(activity);
        // Publishing focuses the new Observatory and may still be walking the
        // character toward that world object. Capture recovery state only after
        // the replaceable position snapshot has settled.
        awaitStablePlayerPosition(activity, 1800);

        String worldBefore = evaluate(activity,
                "JSON.stringify(JSON.parse(localStorage.getItem('ngl.common-ground.v2')))");
        String positionBefore = evaluate(activity,
                "JSON.stringify(JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')))");
        String xpBefore = evaluate(activity, "document.getElementById('xp-count').textContent");
        assertTrue("the recovery fixture must contain a saved world", worldBefore != null && !"null".equals(worldBefore));
        assertTrue("the recovery fixture must contain a saved player position",
                positionBefore != null && !"null".equals(positionBefore));
        assertTrue("the native file bridge is supported before renderer termination",
                activity.isNativeFileBridgeSupportedForTests());
        awaitJavaScript(activity, "window.__nglNativeFileBridgeInstalled === true");

        WebView terminated = activity.getGameWebViewForTests();
        assertTrue("the game WebView exists before the renderer crash", terminated != null);
        AtomicReference<WebViewRenderProcess> rendererProcess = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(
                () -> rendererProcess.set(terminated.getWebViewRenderProcess()));
        assertTrue("the active WebView exposes its renderer process on the API 35 emulator",
                rendererProcess.get() != null);
        assertTrue("the renderer process accepts explicit test termination",
                rendererProcess.get().terminate());
        Log.i("labs.nogas.commonground.test", "renderer-recovery stage=termination-requested");

        awaitRendererRecovery(activity);
        Log.i("labs.nogas.commonground.test", "renderer-recovery stage=recovery-screen-visible");
        AtomicReference<View> retryButton = new AtomicReference<>();
        AtomicReference<String> retryLabel = new AtomicReference<>();
        AtomicReference<String> retryDescription = new AtomicReference<>();
        AtomicReference<String> recoveryExplanation = new AtomicReference<>();
        AtomicReference<Boolean> detached = new AtomicReference<>(false);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            retryButton.set(activity.getRendererRecoveryButtonForTests());
            if (retryButton.get() instanceof android.widget.Button button) {
                retryLabel.set(button.getText().toString());
                retryDescription.set(String.valueOf(button.getContentDescription()));
            }
            recoveryExplanation.set(activity.getRendererRecoveryExplanationTextForTests());
            detached.set(terminated.getParent() == null && !terminated.isAttachedToWindow());
        });

        assertTrue("the terminated WebView is detached before recovery is offered", detached.get());
        assertTrue("the terminated WebView is no longer the active game view",
                activity.getGameWebViewForTests() == null);
        assertTrue("the recovery action is explicitly available", retryButton.get() != null);
        assertEquals("the recovery action accurately describes what it does", "Reload game", retryLabel.get());
        assertEquals("the recovery action exposes the same accessible label", "Reload game", retryDescription.get());
        assertEquals("the recovery explanation names the explicit saved-world resume step",
                "The game view stopped unexpectedly. The failed WebView has been discarded. Reload the game, then tap Play your world to reopen the last saved private world. Only state already saved by the game can be recovered; unsaved actions may be lost.",
                recoveryExplanation.get());

        InstrumentationRegistry.getInstrumentation().runOnMainSync(
                () -> retryButton.get().performClick());
        awaitPageLoaded(activity);
        Log.i("labs.nogas.commonground.test", "renderer-recovery stage=new-webview-loaded");
        MainActivity recovered = activity();
        assertTrue("recovery creates a new WebView rather than reusing the terminated renderer",
                recovered.getGameWebViewForTests() != terminated);
        assertEquals("the refreshed doorway requires the explicit private-world action",
                "\"Play your world\"",
                evaluate(recovered, "document.getElementById('start-private').childNodes[0].textContent.trim()"));
        assertTrue("native file bridge support is restored on the replacement WebView",
                recovered.isNativeFileBridgeSupportedForTests());
        awaitJavaScript(recovered, "window.__nglNativeFileBridgeInstalled === true");
        String positionAfterReloadBeforeResume = evaluate(recovered,
                "JSON.stringify(JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')))");
        Log.i("labs.nogas.commonground.test",
                "renderer-recovery stage=raw-position-before-resume " + positionAfterReloadBeforeResume);

        evaluate(recovered, "document.getElementById('start-private').click(); 'resume saved world'");
        awaitJavaScript(recovered, "document.getElementById('play-ui').hidden === false");
        awaitJavaScript(recovered, "document.visibilityState === 'visible' && document.hasFocus()");
        assertEquals("renderer recovery preserves the exact retained world event/state projection",
                worldBefore,
                evaluate(recovered,
                        "JSON.stringify(JSON.parse(localStorage.getItem('ngl.common-ground.v2')))"));
        assertEquals("renderer recovery does not award or remove XP",
                xpBefore,
                evaluate(recovered, "document.getElementById('xp-count').textContent"));
        assertEquals("the native file bridge is reinstalled on the fresh WebView",
                "true",
                evaluate(recovered, "window.__nglNativeFileBridgeInstalled === true"));
        assertEquals("renderer recovery preserves the raw saved position before private mode resumes",
                positionBefore, positionAfterReloadBeforeResume);
        assertEquals("renderer recovery preserves the saved character position after private mode resumes",
                positionBefore,
                evaluate(recovered,
                        "JSON.stringify(JSON.parse(localStorage.getItem('ngl.common-ground.player-position.v1')))"));
        Log.i("labs.nogas.commonground.test", "renderer-recovery stage=complete");
    }

    private void assertNavigationOnlyDiscovers(String beforeJson, String afterJson, String label) throws Exception {
        JSONObject before = new JSONObject(beforeJson);
        JSONObject after = new JSONObject(afterJson);
        JSONArray beforeEvents = before.getJSONArray("events");
        JSONArray afterEvents = after.getJSONArray("events");
        HashSet<String> retainedIds = new HashSet<>();

        assertTrue(label + ": retained history must not shrink", afterEvents.length() >= beforeEvents.length());
        for (int index = 0; index < beforeEvents.length(); index++) {
            JSONObject beforeEvent = beforeEvents.getJSONObject(index);
            JSONObject afterEvent = afterEvents.getJSONObject(index);
            assertEquals(label + ": retained events must remain append-only and unchanged",
                    beforeEvent.toString(), afterEvent.toString());
            assertTrue(label + ": retained event IDs must be unique",
                    retainedIds.add(beforeEvent.getString("id")));
        }

        int newEventCount = afterEvents.length() - beforeEvents.length();
        for (int index = beforeEvents.length(); index < afterEvents.length(); index++) {
            JSONObject event = afterEvents.getJSONObject(index);
            assertTrue(label + ": new event IDs must be unique", retainedIds.add(event.getString("id")));
            assertEquals(label + ": navigation may append only landmark-discovery events",
                    "discover", event.getString("type"));
            assertFalse(label + ": an institution visit is not a discovery landmark",
                    "decision_chamber".equals(event.optString("locationId")));
        }

        assertEquals(label + ": revision delta must be explained by retained events",
                newEventCount, after.getInt("revision") - before.getInt("revision"));
        assertEquals(label + ": navigation must not award XP", before.getInt("xp"), after.getInt("xp"));
        assertEquals(label + ": navigation must not create or alter retained buildings",
                before.getJSONArray("creations").toString(), after.getJSONArray("creations").toString());
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

    private void awaitCompleteJsonFile(File file) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        long previousLength = -1;
        long stableSince = 0;
        String lastParseFailure = "file was not written";
        while (System.nanoTime() < deadline) {
            if (file.isFile() && file.length() > 0) {
                long beforeRead = file.length();
                String content = new String(
                        Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
                long afterRead = file.length();
                if (beforeRead == afterRead && afterRead == previousLength) {
                    try {
                        new JSONObject(content);
                        if (System.nanoTime() - stableSince >= TimeUnit.MILLISECONDS.toNanos(200)) {
                            return;
                        }
                    } catch (org.json.JSONException incompleteJson) {
                        lastParseFailure = incompleteJson.getMessage();
                        stableSince = 0;
                    }
                } else {
                    previousLength = afterRead;
                    stableSince = System.nanoTime();
                    try {
                        new JSONObject(content);
                    } catch (org.json.JSONException incompleteJson) {
                        lastParseFailure = incompleteJson.getMessage();
                    }
                }
            }
            Thread.sleep(50);
        }
        throw new AssertionError(
                "Android JSON export did not finish as a stable complete document: " + lastParseFailure);
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
        // ActivityScenario can report a loaded WebView while its EmptyActivity
        // transition still leaves the target window hidden. The game loop
        // deliberately pauses while the document is hidden or unfocused.
        activityRule.getScenario().moveToState(Lifecycle.State.RESUMED);
        AtomicReference<MainActivity> result = new AtomicReference<>();
        activityRule.getScenario().onActivity(result::set);
        return result.get();
    }

    private void awaitRendererRecovery(MainActivity activity) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        AtomicReference<Boolean> visible = new AtomicReference<>(false);
        while (System.nanoTime() < deadline) {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(
                    () -> visible.set(activity.isRendererRecoveryVisibleForTests()));
            if (Boolean.TRUE.equals(visible.get())) return;
            Thread.sleep(100);
        }
        throw new AssertionError("WebView renderer termination did not expose the explicit recovery action; "
                + describeWebView(activity));
    }

    private void awaitPageLoaded(MainActivity activity) throws Exception {
        // Hosted Android emulators can expose a usable WebView before Chromium reaches 100%.
        // Keep the initial-load wait bounded, but align it with the JavaScript readiness ceiling.
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(45);
        AtomicReference<Boolean> ready = new AtomicReference<>(false);
        while (System.nanoTime() < deadline) {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                WebView current = activity.getGameWebViewForTests();
                ready.set(current != null && current.getUrl() != null && current.getProgress() == 100 &&
                        current.getVisibility() == View.VISIBLE &&
                        current.getWindowVisibility() == View.VISIBLE &&
                        current.isShown() && current.hasWindowFocus());
            });
            if (Boolean.TRUE.equals(ready.get())) {
                // Page readiness and interaction focus are separate: the entry screen is
                // visible before the player has selected a world. The private-world
                // action below focuses the actual game canvas and is asserted there.
                awaitJavaScript(activity, "document.visibilityState === 'visible'");
                return;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("WebView did not become loaded and visible: "
                + describeWebView(activity));
    }

    private void awaitGameDocumentReady(MainActivity activity) throws Exception {
        // This private Synthesis journey uses the bundled document and local world;
        // it does not require the native file bridge's separate onPageFinished hook.
        // Wait for the app document rather than aggregate subresource progress.
        awaitJavaScript(activity,
                "document.readyState === 'complete' && document.visibilityState === 'visible'");
        AtomicReference<Boolean> visible = new AtomicReference<>(false);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView current = activity.getGameWebViewForTests();
            visible.set(current != null && current.getUrl() != null &&
                    current.isAttachedToWindow() &&
                    current.getVisibility() == View.VISIBLE &&
                    current.getWindowVisibility() == View.VISIBLE &&
                    current.isShown());
        });
        assertTrue("the ready game document must remain attached and visible: "
                + describeWebView(activity), Boolean.TRUE.equals(visible.get()));
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
                    + ", shown=" + current.isShown()
                    + ", focused=" + current.isFocused()
                    + ", windowHasFocus=" + current.hasWindowFocus()
                    + ", activityDestroyed=" + activity.isDestroyed()
                    + ", finishing=" + activity.isFinishing());
        });
        return state.get();
    }

    private void awaitJavaScript(MainActivity activity, String condition) throws Exception {
        // Hosted macOS emulators can take longer to finish loading the local WebView shell.
        // Keep the wait bounded, but do not mistake a slow initial document load for a game failure.
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(45);
        while (System.nanoTime() < deadline) {
            if ("true".equals(evaluate(activity, condition))) return;
            Thread.sleep(100);
        }
        throw new AssertionError("Timed out waiting for WebView condition: " + condition
                + "; gameState=" + describeGameState(activity)
                + "; " + describeWebView(activity));
    }

    private void enterNearbyInstitution(MainActivity activity, String placeId, String title) throws Exception {
        // Activity recreation may restore the exact workbench. Reuse that visible state rather
        // than requiring a second arrival/entry gesture or treating it as a fresh interaction.
        String alreadyOpen = evaluate(activity,
                "!document.getElementById('sheet').hidden && " +
                "document.getElementById('sheet-title').textContent === '" + title + "' ? 'true' : 'false'");
        if ("true".equals(alreadyOpen)) return;
        awaitJavaScript(activity,
                "document.getElementById('sheet').hidden === true && " +
                "document.getElementById('world')?.dataset.nearbyInstitutionId === '" + placeId + "' && " +
                "((document.getElementById('enter-institution-button') && !document.getElementById('enter-institution-button').hidden && document.getElementById('enter-institution-button').getAttribute('aria-label')?.startsWith('Enter ') === true) || " +
                "document.getElementById('interact-button')?.getAttribute('aria-label')?.startsWith('Enter ') === true)");
        String separateEntry = evaluate(activity,
                "document.getElementById('enter-institution-button') && !document.getElementById('enter-institution-button').hidden ? 'true' : 'false'");
        if ("true".equals(separateEntry)) {
            evaluate(activity, "document.getElementById('enter-institution-button').click(); 'enter " + placeId + "'");
        } else {
            evaluate(activity, "document.getElementById('interact-button').click(); 'enter " + placeId + "'");
        }
        awaitJavaScript(activity,
                "!document.getElementById('sheet').hidden && " +
                "document.getElementById('sheet-title').textContent === '" + title + "'");
    }

    private String describeGameState(MainActivity activity) {
        try {
            return evaluate(activity, """
                    (() => {
                      const read = key => {
                        try { return JSON.parse(localStorage.getItem(key)); }
                        catch { return null; }
                      };
                      const world = read('ngl.common-ground.v2');
                      return JSON.stringify({
                        readyState: document.readyState,
                        visibilityState: document.visibilityState,
                        hasFocus: document.hasFocus(),
                        activeElementId: document.activeElement?.id ?? null,
                        modalOpen: document.body.classList.contains('modal-open'),
                        sheetHidden: document.getElementById('sheet')?.hidden ?? null,
                        sheetTitle: document.getElementById('sheet-title')?.textContent ?? null,
                        portalHidden: document.getElementById('portal')?.hidden ?? null,
                        artifactInputReady: document.getElementById('artifact-frame')?.dataset.nglInputReady ?? null,
                        nativeBridgeReady: window.__nglNativeFileBridgeInstalled === true,
                        artifactBridgeHandshakeSent: document.getElementById('artifact-frame')?.dataset.nglNativeBridgeHandshakeSent ?? null,
                        artifactBridgeGeneration: document.getElementById('artifact-frame')?.dataset.nglNativeBridgeGeneration ?? null,
                        artifactImportStage: document.getElementById('artifact-frame')?.dataset.nglNativeImportStage ?? null,
                        artifactImportBytes: document.getElementById('artifact-frame')?.dataset.nglNativeImportBytes ?? null,
                        artifactImportExpectedBytes: document.getElementById('artifact-frame')?.dataset.nglNativeImportExpectedBytes ?? null,
                        nativeExportButton: !!document.querySelector('[data-native-observatory-export]'),
                        nativeImportButton: !!document.querySelector('[data-native-observatory-import]'),
                        nativeReviewPanelHidden: document.querySelector('[data-native-observatory-review]')?.hidden ?? null,
                        nativeReviewPanelRole: document.querySelector('[data-native-observatory-review]')?.getAttribute('role') ?? null,
                        nativeReviewPanelLabel: document.querySelector('[data-native-observatory-review]')?.getAttribute('aria-label') ?? null,
                        nativeReviewPreviewText: document.querySelector('[data-native-observatory-preview]')?.textContent ?? null,
                        nativeReviewSummary: document.querySelector('.native-observatory-review-status')?.textContent ?? null,
                        nativeReviewAppendDisabled: document.querySelector('[data-native-observatory-append]')?.disabled ?? null,
                        creationCount: document.getElementById('creation-count')?.textContent ?? null,
                        xp: document.getElementById('xp-count')?.textContent ?? null,
                        playerPosition: read('ngl.common-ground.player-position.v1'),
                        creations: Array.isArray(world?.creations)
                                ? world.creations.map(creation => ({
                                    id: creation.id,
                                    title: creation.title,
                                    position: creation.position
                                  }))
                                : null
                      });
                    })()
                    """);
        } catch (Exception error) {
            return "unavailable: " + error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage());
        }
    }

    private void awaitCounter(MainActivity activity, CounterCondition condition) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            if (condition.isMet()) return;
            Thread.sleep(100);
        }
        throw new AssertionError("Timed out waiting for Android request boundary");
    }

    private void reloadWebView(MainActivity activity) throws Exception {
        WebView current = activity.getGameWebViewForTests();
        assertTrue("activity WebView must exist before reload", current != null);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(current::reload);
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
