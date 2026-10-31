package labs.nogas.commonground;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

public final class MainActivity extends Activity {
    static final String APP_HOST = "appassets.androidplatform.net";
    static final String GAME_URL = "https://" + APP_HOST + "/assets/game/index.html";

    private WebView webView;
    private final AtomicInteger unconfiguredApiRequests = new AtomicInteger();
    private final AtomicInteger blockedExternalRequests = new AtomicInteger();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(12, 13, 11));
        getWindow().setNavigationBarColor(Color.rgb(12, 13, 11));

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(12, 13, 11));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setDatabaseEnabled(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSafeBrowsingEnabled(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && APP_HOST.equals(uri.getHost())) {
                    WebResourceResponse local = assetLoader.shouldInterceptRequest(uri);
                    if (local != null) return local;

                    String path = uri.getPath();
                    if (path != null && path.startsWith("/api/")) {
                        unconfiguredApiRequests.incrementAndGet();
                        return jsonError(
                                503,
                                "Service Unavailable",
                                "ANDROID_SHARED_SERVICE_UNCONFIGURED",
                                "This Android build is offline-first; shared-world service is not configured. Your private world remains available."
                        );
                    }
                    return textError(404, "Not Found", "The requested local game asset is not packaged.");
                }

                blockedExternalRequests.incrementAndGet();
                return textError(403, "Forbidden", "External network access is disabled in this offline-first build.");
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !("https".equals(uri.getScheme()) && APP_HOST.equals(uri.getHost()));
            }
        });

        setContentView(webView);
        webView.loadUrl(GAME_URL);
    }

    private WebResourceResponse jsonError(int status, String reason, String code, String message) {
        String json = "{\"error\":{\"code\":\"" + escapeJson(code) +
                "\",\"message\":\"" + escapeJson(message) + "\"}}";
        Map<String, String> headers = responseHeaders();
        return new WebResourceResponse(
                "application/json",
                "utf-8",
                status,
                reason,
                headers,
                new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8))
        );
    }

    private WebResourceResponse textError(int status, String reason, String message) {
        return new WebResourceResponse(
                "text/plain",
                "utf-8",
                status,
                reason,
                responseHeaders(),
                new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8))
        );
    }

    private Map<String, String> responseHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        return headers;
    }

    private static String escapeJson(String value) {
        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    WebView getGameWebViewForTests() {
        return webView;
    }

    int getUnconfiguredApiRequestsForTests() {
        return unconfiguredApiRequests.get();
    }

    int getBlockedExternalRequestsForTests() {
        return blockedExternalRequests.get();
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(() => { const portal = document.getElementById('portal'); " +
                        "if (portal && !portal.hidden) { document.getElementById('portal-close')?.click(); return true; } " +
                        "const sheet = document.getElementById('sheet'); " +
                        "if (sheet && !sheet.hidden) { document.getElementById('sheet-close')?.click(); return true; } " +
                        "return false; })()",
                result -> {
                    if (!"true".equals(result)) {
                        if (webView != null && webView.canGoBack()) webView.goBack();
                        else finish();
                    }
                }
        );
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.setWebViewClient(new WebViewClient());
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
