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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class NativeWorldFiles {
    static final int REQUEST_IMPORT = 4301;
    static final int REQUEST_EXPORT = 4302;

    private static final int CHUNK_BYTES = 64 * 1024;
    private static final long MAX_BYTES = 32L * 1024L * 1024L;

    private final Activity activity;
    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "ngl-world-files");
        thread.setDaemon(true);
        return thread;
    });

    private volatile boolean closed;
    private volatile boolean exportAwaitingPicker;
    private volatile File pendingExportFile;
    private JavaScriptReplyProxy importReplyProxy;

    // These fields are owned by the single-threaded I/O executor.
    private File exportFile;
    private FileOutputStream exportStream;
    private String exportName;
    private String exportMime;
    private long exportExpectedBytes;
    private long exportWrittenBytes;
    private boolean exportRejected;

    NativeWorldFiles(Activity activity) {
        this.activity = activity;
    }

    void onMessage(WebMessageCompat message, JavaScriptReplyProxy replyProxy) {
        if (closed) return;

        if (message.getType() == WebMessageCompat.TYPE_ARRAY_BUFFER) {
            byte[] chunk = message.getArrayBuffer();
            io.execute(() -> appendExportChunk(chunk));
            return;
        }
        if (message.getType() != WebMessageCompat.TYPE_STRING) return;

        try {
            JSONObject payload = new JSONObject(message.getData());
            String type = payload.optString("type", "");
            if ("ready".equals(type)) return;
            if ("import-request".equals(type)) {
                importReplyProxy = replyProxy;
                openImportPicker();
                return;
            }
            if ("export-start".equals(type)) {
                String name = payload.optString("name", "");
                String mime = payload.optString("mime", "");
                long size = payload.optLong("size", -1);
                io.execute(() -> startExport(name, mime, size));
                return;
            }
            if ("export-complete".equals(type)) io.execute(this::completeExport);
        } catch (Exception exception) {
            showToast("The native file request was rejected.");
        }
    }

    private void openImportPicker() {
        if (closed) return;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            activity.startActivityForResult(intent, REQUEST_IMPORT);
        } catch (ActivityNotFoundException exception) {
            importReplyProxy = null;
            showToast("No Android document picker is available.");
        }
    }

    boolean onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_IMPORT) {
            JavaScriptReplyProxy proxy = importReplyProxy;
            importReplyProxy = null;
            if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) return true;
            Uri source = data.getData();
            io.execute(() -> importDocument(source, proxy));
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
            Uri destination = data.getData();
            io.execute(() -> copyExport(file, destination));
            return true;
        }
        return false;
    }

    private synchronized void startExport(String name, String mime, long size) {
        if (closed) return;
        if (exportRejected || exportStream != null || exportAwaitingPicker || pendingExportFile != null) {
            exportRejected = true;
            showToast("Another file export is already in progress.");
            return;
        }
        resetActiveExport();
        if (size < 0 || size > MAX_BYTES || !isAllowedExportMime(mime)) {
            exportRejected = true;
            showToast("This export type or size is not supported.");
            return;
        }

        try {
            exportFile = File.createTempFile("ngl-export-", ".tmp", activity.getCacheDir());
            exportStream = new FileOutputStream(exportFile);
            exportName = safeFileName(name);
            exportMime = mime;
            exportExpectedBytes = size;
            exportWrittenBytes = 0;
        } catch (IOException exception) {
            abortExport("Could not prepare the export file.");
        }
    }

    private synchronized void appendExportChunk(byte[] chunk) {
        if (closed || exportRejected) return;
        if (exportStream == null || chunk == null || chunk.length == 0
                || chunk.length > CHUNK_BYTES || exportWrittenBytes + chunk.length > exportExpectedBytes) {
            abortExport("The export stream was incomplete or malformed.");
            return;
        }
        try {
            exportStream.write(chunk);
            exportWrittenBytes += chunk.length;
        } catch (IOException exception) {
            abortExport("Could not write the export file.");
        }
    }

    private synchronized void completeExport() {
        if (closed) {
            resetActiveExport();
            return;
        }
        if (exportRejected) {
            resetActiveExport();
            return;
        }
        if (exportStream == null || exportWrittenBytes != exportExpectedBytes) {
            abortExport("The export was incomplete; no file was saved.");
            return;
        }

        try {
            exportStream.flush();
            exportStream.close();
        } catch (IOException exception) {
            abortExport("Could not finish the export file.");
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
        exportWrittenBytes = 0;
        exportAwaitingPicker = true;
        activity.runOnUiThread(() -> launchCreateDocument(ready, name, mime));
    }

    private void launchCreateDocument(File file, String name, String mime) {
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

    private void importDocument(Uri source, JavaScriptReplyProxy proxy) {
        if (closed) return;
        if (proxy == null) {
            showToast("The game page is not ready to receive an import.");
            return;
        }

        try {
            byte[] bytes = readBounded(source);
            if (bytes.length == 0) throw new IOException("empty file");
            StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes));
            String name = displayName(source);

            activity.runOnUiThread(() -> {
                if (closed) return;
                try {
                    proxy.postMessage(new JSONObject()
                            .put("type", "import-start")
                            .put("name", name)
                            .put("size", bytes.length)
                            .toString());
                    for (int offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
                        int end = Math.min(offset + CHUNK_BYTES, bytes.length);
                        proxy.postMessage(Arrays.copyOfRange(bytes, offset, end));
                    }
                    proxy.postMessage(new JSONObject().put("type", "import-complete").toString());
                    showToast("World file sent to the in-world validator.");
                } catch (Exception exception) {
                    showToast("The game page changed before the import could finish.");
                }
            });
        } catch (Exception exception) {
            showToast("Import rejected. Choose a readable UTF-8 world JSON file under 32 MiB.");
        }
    }

    private byte[] readBounded(Uri source) throws IOException {
        try (InputStream input = activity.getContentResolver().openInputStream(source);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IOException("unreadable source");
            byte[] buffer = new byte[8192];
            long total = 0;
            int count;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > MAX_BYTES) throw new IOException("file too large");
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
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            output.flush();
            showToast("World or artifact export saved.");
        } catch (Exception exception) {
            showToast("The export could not be saved to that location.");
        } finally {
            source.delete();
        }
    }

    private synchronized void abortExport(String message) {
        resetActiveExport();
        exportRejected = true;
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
        exportWrittenBytes = 0;
        exportRejected = false;
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

    void close() {
        closed = true;
        importReplyProxy = null;
        try {
            io.execute(this::resetActiveExport);
        } catch (RuntimeException ignored) {
            resetActiveExport();
        }
        io.shutdown();
        File pending = pendingExportFile;
        pendingExportFile = null;
        exportAwaitingPicker = false;
        if (pending != null) pending.delete();
    }
}
