package labs.nogas.commonground;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
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
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicInteger;

public final class MainActivity extends Activity {
    static final String APP_HOST = "appassets.androidplatform.net";
    static final String GAME_URL = "https://" + APP_HOST + "/assets/game/index.html";

    private static final String NATIVE_FILE_BRIDGE_SCRIPT = """
            (() => {
              const native = window.NglNative;
              if (!native || window.__nglNativeFileBridgeInstalled) return;
              window.__nglNativeFileBridgeInstalled = true;
              let incoming = null;
              native.addEventListener('message', (event) => {
                const data = event.data;
                if (data instanceof ArrayBuffer) {
                  if (incoming) {
                    incoming.parts.push(data);
                    incoming.received += data.byteLength;
                  }
                  return;
                }
                if (typeof data !== 'string') return;
                let message;
                try { message = JSON.parse(data); } catch { return; }
                if (message.type === 'import-start') {
                  incoming = { name: message.name, size: message.size, parts: [], received: 0 };
                } else if (message.type === 'import-complete') {
                  const transfer = incoming;
                  incoming = null;
                  if (!transfer || transfer.received !== transfer.size) return;
                  const input = document.getElementById('import-world');
                  if (!input) return;
                  const file = new File(transfer.parts, transfer.name, { type: 'application/json' });
                  const selection = new DataTransfer();
                  selection.items.add(file);
                  input.files = selection.files;
                  input.dispatchEvent(new Event('change', { bubbles: true }));
                }
              });
              const blobs = new Map();
              const createObjectURL = URL.createObjectURL.bind(URL);
              const revokeObjectURL = URL.revokeObjectURL.bind(URL);
              URL.createObjectURL = (blob) => {
                const url = createObjectURL(blob);
                if (blob instanceof Blob) blobs.set(url, blob);
                return url;
              };
              URL.revokeObjectURL = (url) => {
                blobs.delete(url);
                revokeObjectURL(url);
              };
              document.addEventListener('click', (event) => {
                const target = event.target instanceof Element ? event.target : null;
                if (!target) return;
                const importInput = target.closest('#import-world');
                if (importInput) {
                  event.preventDefault();
                  event.stopImmediatePropagation();
                  native.postMessage(JSON.stringify({ type: 'import-request' }));
                  return;
                }
                const link = target.closest('a[download]');
                if (!link) return;
                const blob = blobs.get(link.href);
                if (!blob) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                (async () => {
                  try {
                    const bytes = await blob.arrayBuffer();
                    native.postMessage(JSON.stringify({
                      type: 'export-start',
                      name: link.download || 'no-gas-labs-export',
                      mime: blob.type || 'application/octet-stream',
                      size: bytes.byteLength
                    }));
                    for (let offset = 0; offset < bytes.byteLength; offset += 65536) {
                      native.postMessage(bytes.slice(offset, Math.min(offset + 65536, bytes.byteLength)));
                    }
                    native.postMessage(JSON.stringify({ type: 'export-complete' }));
                  } catch (error) {
                    console.error('Native export failed', error);
                  }
                })();
              }, true);
              native.postMessage(JSON.stringify({ type: 'ready' }));
            })();
            """;

    private WebView webView;
    private NativeWorldFiles nativeWorldFiles;
    private boolean nativeFileBridgeSupported;
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

        nativeFileBridgeSupported = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER);
        if (nativeFileBridgeSupported) {
            nativeWorldFiles = new NativeWorldFiles(this);
            WebViewCompat.addWebMessageListener(
                    webView,
                    "NglNative",
                    Collections.singleton("https://" + APP_HOST),
                    (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                        if (!isMainFrame || !"https".equals(sourceOrigin.getScheme())
                                || !APP_HOST.equals(sourceOrigin.getHost())) return;
                        nativeWorldFiles.onMessage(message, replyProxy);
                    }
            );
        }

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
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Uri finished = Uri.parse(url);
                if (nativeFileBridgeSupported && "https".equals(finished.getScheme())
                        && APP_HOST.equals(finished.getHost())
                        && "/assets/game/index.html".equals(finished.getPath())) {
                    view.evaluateJavascript(NATIVE_FILE_BRIDGE_SCRIPT, null);
                }
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

    boolean isNativeFileBridgeSupportedForTests() {
        return nativeFileBridgeSupported;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (nativeWorldFiles != null) nativeWorldFiles.onActivityResult(requestCode, resultCode, data);
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
        if (nativeWorldFiles != null) {
            nativeWorldFiles.close();
            nativeWorldFiles = null;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.setWebViewClient(new WebViewClient());
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
