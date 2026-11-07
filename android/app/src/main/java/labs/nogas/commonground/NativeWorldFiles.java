package labs.nogas.commonground;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.widget.Toast;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

final class NativeWorldFiles {
    static final int REQUEST_IMPORT = 4301;
    static final int REQUEST_EXPORT = 4302;

    static final int CHUNK_BYTES = 64 * 1024;
    static final long MAX_BYTES = 32L * 1024L * 1024L;
    static final long MAX_ARTIFACT_BYTES = 2L * 1024L * 1024L;
    static final int MAX_QUEUED_CHUNKS = (int) (MAX_BYTES / CHUNK_BYTES);
    static final int MAX_QUEUED_MESSAGES = MAX_QUEUED_CHUNKS + 2;

    private final Activity activity;
    private final ThreadPoolExecutor io;

    private volatile boolean closed;
    private JavaScriptReplyProxy importReplyProxy;
    private String importTarget = "world";

    // All transfer state is protected by this instance's monitor.
    private boolean importPickerActive;
    private boolean importInProgress;
    private boolean exportTransferActive;
    private boolean exportCompletionQueued;
    private boolean exportAwaitingPicker;
    private boolean exportCopyInProgress;
    private File pendingExportFile;

    private long exportGeneration;
    private long exportExpectedBytes;
    // Counts bytes accepted into the queue plus bytes already written.
    private long exportAcceptedBytes;
    private long exportWrittenBytes;
    private File exportFile;
    private FileOutputStream exportStream;
    private String exportName;
    private String exportMime;

    NativeWorldFiles(Activity activity) {
        this(activity, createIoExecutor());
    }

    // Injection point for deterministic instrumentation of queue pressure.
    NativeWorldFiles(Activity activity, ThreadPoolExecutor io) {
        this.activity = activity;
        this.io = io;
    }

    private static ThreadPoolExecutor createIoExecutor() {
        return new ThreadPoolExecutor(
                1,
                1,
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(MAX_QUEUED_MESSAGES),
                runnable -> {
                    Thread thread = new Thread(runnable, "ngl-world-files");
                    thread.setDaemon(true);
                    return thread;
                },
                new ThreadPoolExecutor.AbortPolicy()
        );
    }

    synchronized void onMessage(WebMessageCompat message, JavaScriptReplyProxy replyProxy) {
        if (closed || message == null) return;

        if (message.getType() == WebMessageCompat.TYPE_ARRAY_BUFFER) {
            queueExportChunk(message.getArrayBuffer());
            return;
        }
        if (message.getType() != WebMessageCompat.TYPE_STRING) return;

        try {
            JSONObject payload = new JSONObject(message.getData());
            String type = payload.optString("type", "");
            if ("ready".equals(type)) return;
            if ("import-request".equals(type)) {
                String target = payload.optString("target", "world");
                if (!"world".equals(target) && !"artifact".equals(target)) {
                    showToast("The native import target was rejected.");
                    return;
                }
                openImportPicker(replyProxy, target);
                return;
            }
            if ("export-start".equals(type)) {
                beginExport(
                        payload.optString("name", ""),
                        payload.optString("mime", ""),
                        payload.optLong("size", -1)
                );
                return;
            }
            if ("export-complete".equals(type)) queueExportComplete();
        } catch (Exception exception) {
            showToast("The native file request was rejected.");
        }
    }

    private void openImportPicker(JavaScriptReplyProxy replyProxy, String target) {
        if (replyProxy == null) {
            showToast("The game page is not ready to receive an import.");
            return;
        }
        if (importPickerActive || importInProgress || exportTransferActive
                || exportAwaitingPicker || exportCopyInProgress || pendingExportFile != null) {
            showToast("Another native file transfer is already in progress.");
            return;
        }

        importReplyProxy = replyProxy;
        importTarget = target;
        importPickerActive = true;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            activity.startActivityForResult(intent, REQUEST_IMPORT);
        } catch (ActivityNotFoundException exception) {
            importReplyProxy = null;
            importPickerActive = false;
            importTarget = "world";
            postImportStatus(replyProxy, "import-error", target, "No Android document picker is available.");
            showToast("No Android document picker is available.");
        }
    }

    synchronized boolean onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_IMPORT) {
            JavaScriptReplyProxy proxy = importReplyProxy;
            String target = importTarget;
            importReplyProxy = null;
            importTarget = "world";
            importPickerActive = false;
            if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
                postImportStatus(proxy, "import-cancelled", target, "");
                return true;
            }
            if (proxy == null || exportTransferActive || exportAwaitingPicker || exportCopyInProgress
                    || importInProgress) {
                postImportStatus(proxy, "import-error", target, "The import could not start in the current file-transfer state.");
                showToast("The import could not be started in the current file-transfer state.");
                return true;
            }

            importInProgress = true;
            Uri source = data.getData();
            try {
                io.execute(() -> importDocument(source, proxy, target));
            } catch (RejectedExecutionException exception) {
                importInProgress = false;
                postImportStatus(proxy, "import-error", target, "The native file queue is full; retry the import.");
                showToast("The native file queue is full; retry the import.");
            }
            return true;
        }

        if (requestCode == REQUEST_EXPORT) {
            File file = pendingExportFile;
            pendingExportFile = null;
            exportAwaitingPicker = false;
            if (file == null) return true;
            if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
                file.delete();
                showToast("World export canceled.");
                return true;
            }
            if (importPickerActive || importInProgress || exportCopyInProgress || exportTransferActive) {
                file.delete();
                showToast("The export could not be saved while another transfer is active.");
                return true;
            }

            Uri destination = data.getData();
            exportCopyInProgress = true;
            try {
                io.execute(() -> copyExport(file, destination));
            } catch (RejectedExecutionException exception) {
                exportCopyInProgress = false;
                file.delete();
                showToast("The native file queue is full; retry the export.");
            }
            return true;
        }
        return false;
    }

    private void beginExport(String name, String mime, long size) {
        if (exportTransferActive) {
            abortExport(exportGeneration, "A second export start interrupted the active transfer.");
            return;
        }
        if (exportAwaitingPicker || pendingExportFile != null || exportCopyInProgress
                || importPickerActive || importInProgress) {
            showToast("Another native file transfer is already in progress.");
            return;
        }
        if (size < 0 || size > MAX_BYTES || !isAllowedExportMime(mime)) {
            showToast("This export type or size is not supported.");
            return;
        }

        resetActiveExport();
        long generation = ++exportGeneration;
        exportTransferActive = true;
        exportCompletionQueued = false;
        exportExpectedBytes = size;
        exportAcceptedBytes = 0;
        exportWrittenBytes = 0;
        exportName = safeFileName(name);
        exportMime = mime;
        try {
            io.execute(() -> prepareExport(generation));
        } catch (RejectedExecutionException exception) {
            abortExport(generation, "The native file queue is full; retry the export.");
        }
    }

    private synchronized void prepareExport(long generation) {
        if (closed || generation != exportGeneration || !exportTransferActive) return;
        try {
            exportFile = File.createTempFile("ngl-export-", ".tmp", activity.getCacheDir());
            exportStream = new FileOutputStream(exportFile);
        } catch (IOException exception) {
            abortExport(generation, "Could not prepare the export file.");
        }
    }

    private void queueExportChunk(byte[] chunk) {
        if (!exportTransferActive) return;
        if (exportCompletionQueued) {
            abortExport(exportGeneration, "Unexpected data arrived after export completion.");
            return;
        }
        long generation = exportGeneration;
        if (chunk == null || chunk.length == 0 || chunk.length > CHUNK_BYTES) {
            abortExport(generation, "The export chunk exceeded the native transfer limit.");
            return;
        }

        long remaining = exportExpectedBytes - exportAcceptedBytes;
        int expectedChunkBytes = (int) Math.min(CHUNK_BYTES, Math.max(0L, remaining));
        if (remaining <= 0 || chunk.length != expectedChunkBytes
                || exportAcceptedBytes + chunk.length > MAX_BYTES) {
            abortExport(generation, "The export stream exceeded its declared size.");
            return;
        }

        // Reserve before enqueue. This budget includes both queued and already-written bytes.
        exportAcceptedBytes += chunk.length;
        try {
            io.execute(() -> appendExportChunk(generation, chunk));
        } catch (RejectedExecutionException exception) {
            exportAcceptedBytes -= chunk.length;
            abortExport(generation, "The native file queue is full; retry the export.");
        }
    }

    private synchronized void appendExportChunk(long generation, byte[] chunk) {
        if (closed || generation != exportGeneration || !exportTransferActive) return;
        if (exportStream == null || chunk == null || chunk.length == 0
                || chunk.length > CHUNK_BYTES || exportWrittenBytes + chunk.length > exportExpectedBytes) {
            abortExport(generation, "The export stream was incomplete or malformed.");
            return;
        }
        try {
            exportStream.write(chunk);
            exportWrittenBytes += chunk.length;
        } catch (IOException exception) {
            abortExport(generation, "Could not write the export file.");
        }
    }

    private void queueExportComplete() {
        if (!exportTransferActive || exportCompletionQueued) return;
        long generation = exportGeneration;
        exportCompletionQueued = true;
        try {
            io.execute(() -> completeExport(generation));
        } catch (RejectedExecutionException exception) {
            abortExport(generation, "The native file queue is full; retry the export.");
        }
    }

    private synchronized void completeExport(long generation) {
        if (closed || generation != exportGeneration || !exportTransferActive) return;
        if (exportStream == null || exportWrittenBytes != exportExpectedBytes
                || exportAcceptedBytes != exportExpectedBytes) {
            abortExport(generation, "The export was incomplete; no file was saved.");
            return;
        }

        try {
            exportStream.flush();
            exportStream.close();
        } catch (IOException exception) {
            abortExport(generation, "Could not finish the export file.");
            return;
        }

        File ready = exportFile;
        String name = exportName;
        String mime = exportMime;
        exportFile = null;
        exportStream = null;
        exportName = null;
        exportMime = null;
        exportExpectedBytes = 0;
        exportAcceptedBytes = 0;
        exportWrittenBytes = 0;
        exportTransferActive = false;
        exportCompletionQueued = false;
        exportAwaitingPicker = true;
        activity.runOnUiThread(() -> launchCreateDocument(ready, name, mime));
    }

    private synchronized void launchCreateDocument(File file, String name, String mime) {
        if (closed || file == null) {
            if (file != null) file.delete();
            exportAwaitingPicker = false;
            return;
        }
        if (pendingExportFile != null) {
            file.delete();
            exportAwaitingPicker = false;
            showToast("Another export is waiting for a save location.");
            return;
        }
        pendingExportFile = file;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            activity.startActivityForResult(intent, REQUEST_EXPORT);
        } catch (ActivityNotFoundException exception) {
            pendingExportFile = null;
            exportAwaitingPicker = false;
            file.delete();
            showToast("No Android document picker is available.");
        }
    }

    private void importDocument(Uri source, JavaScriptReplyProxy proxy, String target) {
        try {
            long maxBytes = "artifact".equals(target) ? MAX_ARTIFACT_BYTES : MAX_BYTES;
            byte[] bytes = readBounded(source, maxBytes);
            if (bytes.length == 0) throw new IOException("empty file");
            StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes));
            String name = displayName(source);

            activity.runOnUiThread(() -> {
                try {
                    if (closed) return;
                    proxy.postMessage(new JSONObject()
                            .put("type", "import-start")
                            .put("target", target)
                            .put("name", name)
                            .put("size", bytes.length)
                            .toString());
                    for (int offset = 0; offset < bytes.length && !closed; offset += CHUNK_BYTES) {
                        int end = Math.min(offset + CHUNK_BYTES, bytes.length);
                        proxy.postMessage(Arrays.copyOfRange(bytes, offset, end));
                    }
                    if (!closed) {
                        proxy.postMessage(new JSONObject().put("type", "import-complete").put("target", target).toString());
                        showToast("World file sent to the in-world validator.");
                    }
                } catch (Exception exception) {
                    if (!closed) showToast("The game page changed before the import could finish.");
                } finally {
                    synchronized (NativeWorldFiles.this) {
                        importInProgress = false;
                    }
                }
            });
        } catch (Exception exception) {
            synchronized (this) {
                importInProgress = false;
            }
            if (!closed) {
                postImportStatus(proxy, "import-error", target,
                        "Import rejected. Choose a readable UTF-8 JSON file within the target's size limit.");
                showToast("Import rejected. Choose a readable UTF-8 JSON file within the target's size limit.");
            }
        }
    }

    private void postImportStatus(JavaScriptReplyProxy proxy, String type, String target, String message) {
        if (proxy == null || closed) return;
        activity.runOnUiThread(() -> {
            if (closed) return;
            try {
                JSONObject payload = new JSONObject().put("type", type).put("target", target);
                if (message != null && !message.isEmpty()) payload.put("message", message);
                proxy.postMessage(payload.toString());
            } catch (Exception ignored) {
                // The main document may have been replaced while the picker was open.
            }
        });
    }

    private byte[] readBounded(Uri source, long maxBytes) throws IOException {
        try (InputStream input = activity.getContentResolver().openInputStream(source);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IOException("unreadable source");
            byte[] buffer = new byte[8192];
            long total = 0;
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (closed) throw new IOException("activity closed");
                total += count;
                if (total > maxBytes) throw new IOException("file too large");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private String displayName(Uri source) {
        String name = source.getLastPathSegment();
        try (Cursor cursor = activity.getContentResolver().query(
                source, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) name = cursor.getString(column);
            }
        } catch (Exception ignored) {
            // A URI without display-name metadata still receives a safe fallback.
        }
        return safeFileName(name);
    }

    private void copyExport(File source, Uri destination) {
        try (InputStream input = new FileInputStream(source);
             OutputStream output = activity.getContentResolver().openOutputStream(destination, "w")) {
            if (output == null) throw new IOException("destination unavailable");
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (closed) throw new IOException("activity closed");
                output.write(buffer, 0, count);
            }
            output.flush();
            if (!closed) showToast("World or artifact export saved.");
        } catch (Exception exception) {
            if (!closed) showToast("The export could not be saved to that location.");
        } finally {
            source.delete();
            synchronized (this) {
                exportCopyInProgress = false;
            }
        }
    }

    private synchronized void abortExport(long generation, String message) {
        if (generation != exportGeneration) return;
        exportGeneration++;
        exportTransferActive = false;
        exportCompletionQueued = false;
        resetActiveExport();
        showToast(message);
    }

    private synchronized void resetActiveExport() {
        if (exportStream != null) {
            try {
                exportStream.close();
            } catch (IOException ignored) {
                // The temporary file is removed below.
            }
        }
        if (exportFile != null) exportFile.delete();
        exportFile = null;
        exportStream = null;
        exportName = null;
        exportMime = null;
        exportExpectedBytes = 0;
        exportAcceptedBytes = 0;
        exportWrittenBytes = 0;
    }

    private static boolean isAllowedExportMime(String mime) {
        String value = mime == null ? "" : mime.toLowerCase(Locale.ROOT);
        return "application/json".equals(value) || "text/html".equals(value) || "text/plain".equals(value);
    }

    private static String safeFileName(String name) {
        if (name == null) name = "";
        StringBuilder safe = new StringBuilder();
        for (int index = 0; index < name.length(); index++) {
            char value = name.charAt(index);
            boolean forbidden = value < 0x20 || value == 0x7f || value == '/' || value == '\\'
                    || value == ':' || value == '*' || value == '?' || value == '"'
                    || value == '<' || value == '>' || value == '|';
            safe.append(forbidden ? '_' : value);
        }
        String result = safe.toString().trim();
        if (result.isEmpty() || ".".equals(result) || "..".equals(result)) {
            result = "no-gas-labs-world.json";
        }
        return result.length() > 120 ? result.substring(0, 120) : result;
    }

    private void showToast(String message) {
        activity.runOnUiThread(() -> {
            if (!closed) Toast.makeText(activity, message, Toast.LENGTH_LONG).show();
        });
    }

    synchronized long getAcceptedExportBytesForTests() {
        return exportAcceptedBytes;
    }

    synchronized boolean isExportTransferActiveForTests() {
        return exportTransferActive;
    }

    int getPendingIoTasksForTests() {
        return io.getQueue().size();
    }

    void close() {
        File pending;
        synchronized (this) {
            if (closed) return;
            closed = true;
            importReplyProxy = null;
            importTarget = "world";
            importPickerActive = false;
            importInProgress = false;
            exportTransferActive = false;
            exportCompletionQueued = false;
            exportAwaitingPicker = false;
            exportCopyInProgress = false;
            exportGeneration++;
            resetActiveExport();
            pending = pendingExportFile;
            pendingExportFile = null;
        }
        if (pending != null) pending.delete();
        io.getQueue().clear();
        io.shutdownNow();
    }
}
