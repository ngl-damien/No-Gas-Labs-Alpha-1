package labs.nogas.commonground;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.RenderProcessGoneDetail;
import android.content.res.ColorStateList;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

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
              const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
              const CHUNK_BYTES = 64 * 1024;
              let incoming = null;
              let artifactExport = null;

              function currentArtifactFrame() {
                const frame = document.getElementById('artifact-frame');
                const portal = document.getElementById('portal');
                if (!frame || !frame.isConnected || !portal || portal.hidden) return null;
                if (!frame.sandbox.contains('allow-scripts') || frame.sandbox.contains('allow-same-origin')) return null;
                return frame;
              }

              function sendToArtifact(message, transfer) {
                const frame = currentArtifactFrame();
                if (!frame || !frame.contentWindow) return false;
                frame.contentWindow.postMessage(message, '*', transfer || []);
                return true;
              }

              async function sha256Hex(parts) {
                const bytes = await new Blob(parts).arrayBuffer();
                const digest = await crypto.subtle.digest('SHA-256', bytes);
                return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
              }

              window.__nglNativeRequestArtifactImport = () => {
                if (!currentArtifactFrame()) return false;
                native.postMessage(JSON.stringify({ type: 'import-request', target: 'artifact' }));
                return true;
              };

              window.__nglNativeRequestArtifactExport = () => {
                const frame = currentArtifactFrame();
                if (!frame || artifactExport) return false;
                const transfer = { size: null, received: 0, name: null, mime: null, parts: [] };
                artifactExport = transfer;
                frame.contentWindow.postMessage({ type: 'ngl-native-file-export-request' }, '*');
                setTimeout(() => {
                  if (artifactExport !== transfer) return;
                  artifactExport = null;
                  if (currentArtifactFrame() === frame) {
                    frame.dataset.nglNativeExportStage = 'timeout';
                    frame.contentWindow.postMessage({
                      type: 'ngl-native-file-export-error',
                      message: 'The Android export transfer timed out before integrity verification; no file was saved.'
                    }, '*');
                  }
                }, 15000);
                return true;
              };

              native.addEventListener('message', async (event) => {
                const data = event.data;
                if (data instanceof ArrayBuffer) {
                  if (incoming && incoming.target === 'artifact') {
                    if (data.byteLength < 1 || data.byteLength > CHUNK_BYTES ||
                        incoming.received + data.byteLength > incoming.size) {
                      incoming = null;
                      const frame = currentArtifactFrame();
                      if (frame) frame.dataset.nglNativeImportStage = 'malformed-chunk';
                      sendToArtifact({ type: 'ngl-native-file-import-error', message: 'The native backup transfer was malformed. Existing notes were left unchanged.' });
                      return;
                    }
                    incoming.parts.push(data);
                    incoming.received += data.byteLength;
                    const frame = currentArtifactFrame();
                    if (frame) frame.dataset.nglNativeImportBytes = String(incoming.received);
                  } else if (incoming) {
                    incoming.parts.push(data);
                    incoming.received += data.byteLength;
                  }
                  return;
                }
                if (typeof data !== 'string') return;
                let message;
                try { message = JSON.parse(data); } catch { return; }
                if (message.type === 'export-verified') {
                  const frame = currentArtifactFrame();
                  if (frame && typeof message.sha256 === 'string' && /^[a-f0-9]{64}$/.test(message.sha256)) {
                    frame.dataset.nglNativeExportSha256 = message.sha256;
                    sendToArtifact({ type: 'ngl-native-file-export-verified', sha256: message.sha256 });
                  }
                  return;
                }
                if (message.type === 'export-error') {
                  const frame = currentArtifactFrame();
                  if (frame) sendToArtifact({
                    type: 'ngl-native-file-export-error',
                    message: typeof message.message === 'string' ? message.message : 'The Android export failed integrity verification.'
                  });
                  return;
                }
                if (message.type === 'import-start') {
                  const target = message.target === 'artifact' ? 'artifact' : 'world';
                  if (incoming) {
                    if (target === 'artifact') sendToArtifact({
                      type: 'ngl-native-file-import-error',
                      message: 'Another native transfer is still being verified. Existing notes were left unchanged.'
                    });
                    return;
                  }
                  const sha256 = typeof message.sha256 === 'string' ? message.sha256 : '';
                  if (target === 'artifact' &&
                      (!Number.isSafeInteger(message.size) || message.size < 1 || message.size > MAX_ARTIFACT_BYTES ||
                       typeof message.name !== 'string' || message.name.length < 1 || message.name.length > 128 ||
                       !/^[a-f0-9]{64}$/.test(sha256))) {
                    sendToArtifact({ type: 'ngl-native-file-import-error', message: 'Native backup metadata or SHA-256 receipt was invalid. Existing notes were left unchanged.' });
                    incoming = null;
                    return;
                  }
                  incoming = {
                    target,
                    name: message.name,
                    size: message.size,
                    sha256,
                    parts: [],
                    received: 0
                  };
                  if (incoming.target === 'artifact') {
                    const frame = currentArtifactFrame();
                    if (frame) {
                      frame.dataset.nglNativeImportExpectedBytes = String(message.size);
                      frame.dataset.nglNativeImportName = message.name;
                      frame.dataset.nglNativeImportBytes = '0';
                      frame.dataset.nglNativeImportSha256 = sha256;
                      frame.dataset.nglNativeImportStage = 'started';
                    }
                  }
                } else if (message.type === 'import-complete') {
                  const transfer = incoming;
                  if (!transfer || transfer.received !== transfer.size) {
                    incoming = null;
                    if (transfer && transfer.target === 'artifact') {
                      sendToArtifact({ type: 'ngl-native-file-import-error', message: 'The native transfer was incomplete. Existing notes were left unchanged.' });
                    }
                    return;
                  }
                  if (transfer.target === 'artifact') {
                    try {
                      const actualDigest = await sha256Hex(transfer.parts);
                      if (actualDigest !== transfer.sha256) {
                        incoming = null;
                        const frame = currentArtifactFrame();
                        if (frame) frame.dataset.nglNativeImportStage = 'digest-mismatch';
                        sendToArtifact({ type: 'ngl-native-file-import-error', message: 'Native backup SHA-256 did not match. Existing notes were left unchanged.' });
                        return;
                      }
                      const frame = currentArtifactFrame();
                      if (!frame || !sendToArtifact({
                        type: 'ngl-native-file-import-start',
                        name: transfer.name,
                        size: transfer.size,
                        sha256: actualDigest
                      })) {
                        incoming = null;
                        if (frame) frame.dataset.nglNativeImportStage = 'start-delivery-rejected';
                        return;
                      }
                      for (const part of transfer.parts) {
                        if (!sendToArtifact({ type: 'ngl-native-file-import-chunk', bytes: part }, [part])) {
                          incoming = null;
                          frame.dataset.nglNativeImportStage = 'chunk-delivery-rejected';
                          sendToArtifact({ type: 'ngl-native-file-import-error', message: 'The verified backup could not be delivered to the notebook. Existing notes were left unchanged.' });
                          return;
                        }
                      }
                      if (!sendToArtifact({ type: 'ngl-native-file-import-complete' })) {
                        incoming = null;
                        frame.dataset.nglNativeImportStage = 'completion-delivery-rejected';
                        return;
                      }
                      frame.dataset.nglNativeImportStage = 'complete';
                      frame.dataset.nglNativeImportSha256 = actualDigest;
                      incoming = null;
                    } catch {
                      incoming = null;
                      const frame = currentArtifactFrame();
                      if (frame) frame.dataset.nglNativeImportStage = 'digest-error';
                      sendToArtifact({ type: 'ngl-native-file-import-error', message: 'Native backup SHA-256 could not be checked. Existing notes were left unchanged.' });
                    }
                    return;
                  }
                  incoming = null;
                  const input = document.getElementById('import-world');
                  if (!input) return;
                  const file = new File(transfer.parts, transfer.name, { type: 'application/json' });
                  const selection = new DataTransfer();
                  selection.items.add(file);
                  input.files = selection.files;
                  input.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (message.type === 'import-cancelled' || message.type === 'import-error') {
                  const target = incoming?.target || message.target;
                  incoming = null;
                  if (target === 'artifact') {
                    const frame = currentArtifactFrame();
                    if (frame) frame.dataset.nglNativeImportStage = message.type;
                    sendToArtifact({
                      type: message.type === 'import-cancelled'
                        ? 'ngl-native-file-import-cancelled'
                        : 'ngl-native-file-import-error',
                      message: message.message || ''
                    });
                  }
                }
              });

              window.addEventListener('message', async (event) => {
                const frame = currentArtifactFrame();
                if (!frame || event.source !== frame.contentWindow || event.origin !== 'null') return;
                const message = event.data;
                if (!message || typeof message !== 'object' || Array.isArray(message)) return;

                if (message.type === 'ngl-portal-painted') {
                  // The iframe's initial about:blank load can consume a one-shot load
                  // listener before srcdoc becomes the real sandboxed notebook. Use
                  // its own painted signal, sent after its script installs the handler.
                  if (frame.srcdoc.includes('data-ngl-native-file-surface="source-observatory-v2"') &&
                      Number.isSafeInteger(message.generation) && message.generation >= 0) {
                    frame.contentWindow.postMessage({ type: 'ngl-native-file-bridge-ready' }, '*');
                    frame.dataset.nglNativeBridgeHandshakeSent = 'true';
                    frame.dataset.nglNativeBridgeGeneration = String(message.generation);
                  }
                  return;
                }

                if (message.type === 'ngl-native-file-import-received') {
                  if (typeof message.name === 'string' && message.name.length <= 128 &&
                      Number.isSafeInteger(message.size) && message.size >= 0 && message.size <= MAX_ARTIFACT_BYTES &&
                      frame.dataset.nglNativeImportStage === 'complete' &&
                      message.name === frame.dataset.nglNativeImportName &&
                      message.size === Number(frame.dataset.nglNativeImportExpectedBytes) &&
                      typeof message.sha256 === 'string' &&
                      message.sha256 === frame.dataset.nglNativeImportSha256 &&
                      /^[a-f0-9]{64}$/.test(message.sha256)) {
                    frame.dataset.nglNativeImportReceived = message.name + ':' + message.size;
                    frame.dataset.nglNativeImportStage = 'acknowledged';
                  }
                  return;
                }

                if (message.type === 'ngl-native-file-export-start') {
                  if (!artifactExport || artifactExport.size !== null ||
                      typeof message.name !== 'string' || message.name.length < 1 || message.name.length > 128 ||
                      message.mime !== 'application/json' ||
                      !Number.isSafeInteger(message.size) || message.size < 1 || message.size > MAX_ARTIFACT_BYTES) {
                    artifactExport = null;
                    return;
                  }
                  artifactExport.size = message.size;
                  artifactExport.name = message.name;
                  artifactExport.mime = message.mime;
                  return;
                }

                if (message.type === 'ngl-native-file-export-chunk') {
                  if (!artifactExport || artifactExport.size === null ||
                      !(message.bytes instanceof ArrayBuffer)) return;
                  const expected = Math.min(CHUNK_BYTES, artifactExport.size - artifactExport.received);
                  if (expected <= 0 || message.bytes.byteLength !== expected) {
                    artifactExport = null;
                    sendToArtifact({
                      type: 'ngl-native-file-export-error',
                      message: 'The notebook export stream was malformed; no file was saved.'
                    });
                    return;
                  }
                  artifactExport.received += message.bytes.byteLength;
                  artifactExport.parts.push(message.bytes);
                  return;
                }

                if (message.type === 'ngl-native-file-export-complete') {
                  const transfer = artifactExport;
                  if (!transfer || transfer.size === null || transfer.received !== transfer.size) {
                    artifactExport = null;
                    sendToArtifact({
                      type: 'ngl-native-file-export-error',
                      message: 'The notebook export was incomplete; no file was saved.'
                    });
                    return;
                  }
                  try {
                    const sha256 = await sha256Hex(transfer.parts);
                    if (artifactExport !== transfer) return;
                    if (currentArtifactFrame() !== frame) {
                      artifactExport = null;
                      return;
                    }
                    native.postMessage(JSON.stringify({
                      type: 'export-start',
                      name: transfer.name,
                      mime: transfer.mime,
                      size: transfer.size,
                      sha256
                    }));
                    for (const part of transfer.parts) native.postMessage(part);
                    native.postMessage(JSON.stringify({ type: 'export-complete' }));
                    artifactExport = null;
                    frame.dataset.nglNativeExportStage = 'integrity-check-pending';
                  } catch {
                    artifactExport = null;
                    sendToArtifact({
                      type: 'ngl-native-file-export-error',
                      message: 'The notebook export SHA-256 could not be calculated; no file was saved.'
                    });
                  }
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
                  native.postMessage(JSON.stringify({ type: 'import-request', target: 'world' }));
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
                    for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
                      native.postMessage(bytes.slice(offset, Math.min(offset + CHUNK_BYTES, bytes.byteLength)));
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
    private Button rendererRecoveryButton;
    private boolean nativeFileBridgeSupported;
    private final AtomicInteger unconfiguredApiRequests = new AtomicInteger();
    private final AtomicInteger blockedExternalRequests = new AtomicInteger();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(12, 13, 11));
        getWindow().setNavigationBarColor(Color.rgb(12, 13, 11));
        createGameWebView();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createGameWebView() {
        rendererRecoveryButton = null;
        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebView created = new WebView(this);
        webView = created;
        created.setBackgroundColor(Color.rgb(12, 13, 11));
        created.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = created.getSettings();
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
        nativeWorldFiles = null;
        if (nativeFileBridgeSupported) {
            NativeWorldFiles bridge = new NativeWorldFiles(this);
            nativeWorldFiles = bridge;
            WebViewCompat.addWebMessageListener(
                    created,
                    "NglNative",
                    Collections.singleton("https://" + APP_HOST),
                    (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                        if (view != created || view != webView ||
                                !isTrustedGameDocument(view, sourceOrigin, isMainFrame)) return;
                        bridge.onMessage(message, replyProxy);
                    }
            );
        }

        created.setWebViewClient(new WebViewClient() {
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
                if (view != created || view != webView) return;
                Uri finished = Uri.parse(url);
                if (nativeFileBridgeSupported && isTrustedGameDocument(finished)) {
                    view.evaluateJavascript(NATIVE_FILE_BRIDGE_SCRIPT, null);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isTrustedGameDocument(request.getUrl());
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                return handleRendererTermination(view);
            }
        });

        setContentView(created);
        created.loadUrl(GAME_URL);
    }

    private static boolean isTrustedGameDocument(WebView view, Uri sourceOrigin, boolean isMainFrame) {
        return view != null && isTrustedGameDocument(view.getUrl(), sourceOrigin, isMainFrame);
    }

    private static boolean isTrustedGameDocument(String currentUrl, Uri sourceOrigin, boolean isMainFrame) {
        if (!isMainFrame || sourceOrigin == null
                || !"https".equals(sourceOrigin.getScheme())
                || !APP_HOST.equals(sourceOrigin.getHost())
                || (sourceOrigin.getPort() != -1 && sourceOrigin.getPort() != 443)
                || sourceOrigin.getUserInfo() != null) return false;
        return currentUrl != null && isTrustedGameDocument(Uri.parse(currentUrl));
    }

    private static boolean isTrustedGameDocument(Uri uri) {
        return uri != null
                && "https".equals(uri.getScheme())
                && APP_HOST.equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getUserInfo() == null
                && "/assets/game/index.html".equals(uri.getPath());
    }

    static boolean isTrustedGameDocumentForTests(String url) {
        return url != null && isTrustedGameDocument(Uri.parse(url));
    }

    static boolean isTrustedGameDocumentForTests(String currentUrl, String sourceOrigin, boolean isMainFrame) {
        Uri origin = sourceOrigin == null ? null : Uri.parse(sourceOrigin);
        return isTrustedGameDocument(currentUrl, origin, isMainFrame);
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

    private void closeNativeWorldFiles() {
        NativeWorldFiles current = nativeWorldFiles;
        nativeWorldFiles = null;
        nativeFileBridgeSupported = false;
        if (current != null) current.close();
    }

    private boolean handleRendererTermination(WebView terminated) {
        if (terminated == null || terminated != webView) return true;

        // The renderer is gone. Do not call back into the failed WebView or reuse it.
        webView = null;
        closeNativeWorldFiles();
        detachViewBeforeDestroy(terminated, terminated::destroy);
        if (!isFinishing() && !isDestroyed()) showRendererRecovery();
        return true;
    }

    private void showRendererRecovery() {
        int inset = Math.round(24f * getResources().getDisplayMetrics().density);
        LinearLayout recovery = new LinearLayout(this);
        recovery.setOrientation(LinearLayout.VERTICAL);
        recovery.setGravity(Gravity.CENTER);
        recovery.setPadding(inset, inset, inset, inset);
        recovery.setBackgroundColor(Color.rgb(12, 13, 11));
        recovery.setFocusableInTouchMode(true);

        TextView heading = new TextView(this);
        heading.setText("WORLD VIEW INTERRUPTED");
        heading.setTextColor(Color.rgb(232, 230, 220));
        heading.setTextSize(20f);
        heading.setGravity(Gravity.CENTER);

        TextView explanation = new TextView(this);
        explanation.setText("The game view stopped unexpectedly. The failed WebView has been discarded. Reload your private world from this device. Only state already saved by the game can be recovered; unsaved actions may be lost.");
        explanation.setTextColor(Color.rgb(197, 205, 212));
        explanation.setTextSize(14f);
        explanation.setGravity(Gravity.CENTER);

        Button retry = new Button(this);
        retry.setText("Reload saved world");
        retry.setContentDescription("Reload saved world");
        retry.setTextColor(Color.rgb(12, 13, 11));
        retry.setBackgroundTintList(ColorStateList.valueOf(Color.rgb(154, 163, 154)));
        retry.setOnClickListener(ignored -> {
            if (webView != null || isFinishing() || isDestroyed()) return;
            rendererRecoveryButton = null;
            createGameWebView();
        });

        LinearLayout.LayoutParams headingParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        headingParams.bottomMargin = inset / 2;
        recovery.addView(heading, headingParams);

        LinearLayout.LayoutParams explanationParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        explanationParams.bottomMargin = inset;
        recovery.addView(explanation, explanationParams);

        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        recovery.addView(retry, buttonParams);

        rendererRecoveryButton = retry;
        setContentView(recovery);
        recovery.requestFocus();
    }

    Button getRendererRecoveryButtonForTests() {
        return rendererRecoveryButton;
    }

    boolean isRendererRecoveryVisibleForTests() {
        return rendererRecoveryButton != null && rendererRecoveryButton.getParent() != null;
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

    static void detachViewBeforeDestroy(View view, Runnable destroy) {
        if (view == null) return;
        if (destroy == null) {
            throw new IllegalArgumentException("Destroy callback is required.");
        }
        if (view.getParent() instanceof ViewGroup) {
            ((ViewGroup) view.getParent()).removeView(view);
        }
        if (view.getParent() != null) {
            throw new IllegalStateException("View must be detached before destroy.");
        }
        destroy.run();
    }

    static void destroyWebView(WebView view) {
        if (view == null) return;
        view.stopLoading();
        view.setWebViewClient(new WebViewClient());
        detachViewBeforeDestroy(view, view::destroy);
    }

    @Override
    protected void onDestroy() {
        closeNativeWorldFiles();
        if (webView != null) {
            WebView current = webView;
            webView = null;
            destroyWebView(current);
        }
        rendererRecoveryButton = null;
        super.onDestroy();
    }
}
