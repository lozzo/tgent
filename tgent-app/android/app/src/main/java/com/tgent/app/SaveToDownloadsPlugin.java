package com.tgent.app;

import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.UUID;

@CapacitorPlugin(name = "SaveToDownloads")
public class SaveToDownloadsPlugin extends Plugin {

    private static class StreamSession {
        OutputStream stream;
        Uri uri;          // Android 10+ MediaStore uri
        File file;        // Android 9- file reference
        String savedPath;
    }

    private static class MediaStoreEntry {
        Uri uri;
        String fileName;
    }

    private final HashMap<String, StreamSession> sessions = new HashMap<>();

    @PluginMethod
    public void save(PluginCall call) {
        String data = call.getString("data");
        String fileName = call.getString("fileName");
        String subDir = call.getString("subDir", "tgent");

        if (data == null || fileName == null) {
            call.reject("data and fileName are required");
            return;
        }

        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                String savedPath;

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    savedPath = saveWithMediaStore(bytes, fileName, subDir);
                } else {
                    savedPath = saveToExternalDownloads(bytes, fileName, subDir);
                }

                JSObject ret = new JSObject();
                ret.put("path", savedPath);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Save failed: " + e.getMessage(), e);
            }
        }).start();
    }

    private String saveWithMediaStore(byte[] bytes, String fileName, String subDir) throws Exception {
        String relativePath = Environment.DIRECTORY_DOWNLOADS + "/" + subDir;
        MediaStoreEntry entry = insertUniqueMediaStoreEntry(fileName, subDir);

        try (OutputStream os = getContext().getContentResolver().openOutputStream(entry.uri)) {
            if (os == null) {
                throw new Exception("Failed to open output stream");
            }
            os.write(bytes);
            os.flush();
        }

        return relativePath + "/" + entry.fileName;
    }

    private String saveToExternalDownloads(byte[] bytes, String fileName, String subDir) throws Exception {
        File downloadsDir = new File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                subDir);
        if (!downloadsDir.exists()) {
            downloadsDir.mkdirs();
        }

        String uniqueName = resolveUniqueFileName(fileName, downloadsDir);
        File outFile = new File(downloadsDir, uniqueName);
        try (FileOutputStream fos = new FileOutputStream(outFile)) {
            fos.write(bytes);
            fos.flush();
        }

        return outFile.getAbsolutePath();
    }

    private String getMimeType(String fileName) {
        String lower = fileName.toLowerCase();
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".doc")) return "application/msword";
        if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
        if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        return "application/octet-stream";
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        String fileName = call.getString("fileName");
        String subDir = call.getString("subDir", "tgent");

        if (fileName == null) {
            call.reject("fileName is required");
            return;
        }

        new Thread(() -> {
            try {
                String sessionId = UUID.randomUUID().toString();
                StreamSession session = new StreamSession();

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    String relativePath = Environment.DIRECTORY_DOWNLOADS + "/" + subDir;
                    MediaStoreEntry entry = insertUniqueMediaStoreEntry(fileName, subDir);

                    OutputStream os = getContext().getContentResolver().openOutputStream(entry.uri);
                    if (os == null) {
                        getContext().getContentResolver().delete(entry.uri, null, null);
                        throw new Exception("Failed to open output stream");
                    }

                    session.stream = os;
                    session.uri = entry.uri;
                    session.savedPath = relativePath + "/" + entry.fileName;
                } else {
                    File downloadsDir = new File(
                            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                            subDir);
                    if (!downloadsDir.exists()) {
                        downloadsDir.mkdirs();
                    }
                    String uniqueName = resolveUniqueFileName(fileName, downloadsDir);
                    File outFile = new File(downloadsDir, uniqueName);
                    session.stream = new FileOutputStream(outFile);
                    session.file = outFile;
                    session.savedPath = outFile.getAbsolutePath();
                }

                synchronized (sessions) {
                    sessions.put(sessionId, session);
                }

                JSObject ret = new JSObject();
                ret.put("sessionId", sessionId);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("openFile failed: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void writeChunk(PluginCall call) {
        String sessionId = call.getString("sessionId");
        String data = call.getString("data");

        if (sessionId == null || data == null) {
            call.reject("sessionId and data are required");
            return;
        }

        StreamSession session;
        synchronized (sessions) {
            session = sessions.get(sessionId);
        }
        if (session == null) {
            call.reject("Invalid sessionId");
            return;
        }

        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                synchronized (session) {
                    session.stream.write(bytes);
                }
                call.resolve();
            } catch (Exception e) {
                cleanupSession(sessionId);
                call.reject("writeChunk failed: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void closeFile(PluginCall call) {
        String sessionId = call.getString("sessionId");
        Boolean success = call.getBoolean("success", false);

        if (sessionId == null) {
            call.reject("sessionId is required");
            return;
        }

        StreamSession session;
        synchronized (sessions) {
            session = sessions.remove(sessionId);
        }
        if (session == null) {
            call.reject("Invalid sessionId");
            return;
        }

        new Thread(() -> {
            try {
                if (success) {
                    session.stream.flush();
                    session.stream.close();

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && session.uri != null) {
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.Downloads.IS_PENDING, 0);
                        getContext().getContentResolver().update(session.uri, values, null, null);
                    }

                    JSObject ret = new JSObject();
                    ret.put("path", session.savedPath);
                    call.resolve(ret);
                } else {
                    try { session.stream.close(); } catch (Exception ignored) {}

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && session.uri != null) {
                        getContext().getContentResolver().delete(session.uri, null, null);
                    } else if (session.file != null) {
                        session.file.delete();
                    }

                    call.resolve();
                }
            } catch (Exception e) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && session.uri != null) {
                    try { getContext().getContentResolver().delete(session.uri, null, null); } catch (Exception ignored) {}
                } else if (session.file != null) {
                    session.file.delete();
                }
                call.reject("closeFile failed: " + e.getMessage(), e);
            }
        }).start();
    }

    /**
     * 在扩展名前加序号生成不冲突的文件名。
     * QQ.exe -> QQ (1).exe -> QQ (2).exe
     */
    private String resolveUniqueFileName(String fileName, File dir) {
        String name = fileName;
        String ext = "";
        int dotIdx = fileName.lastIndexOf('.');
        if (dotIdx > 0) {
            name = fileName.substring(0, dotIdx);
            ext = fileName.substring(dotIdx);
        }

        String candidate = fileName;
        int counter = 1;
        while (new File(dir, candidate).exists()) {
            candidate = name + " (" + counter + ")" + ext;
            counter++;
        }
        return candidate;
    }

    /**
     * Android 10+: 先检查文件系统确定唯一文件名，再插入 MediaStore。
     * 避免 MediaStore 的自动重命名（会在整个文件名后加 -1 而不是扩展名前）。
     */
    private MediaStoreEntry insertUniqueMediaStoreEntry(String fileName, String subDir) throws Exception {
        File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        File targetDir = new File(downloadsDir, subDir);
        String uniqueName = resolveUniqueFileName(fileName, targetDir);

        String relativePath = Environment.DIRECTORY_DOWNLOADS + "/" + subDir;
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, uniqueName);
        values.put(MediaStore.Downloads.RELATIVE_PATH, relativePath);
        String mimeType = getMimeType(uniqueName);
        if (mimeType != null) {
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
        }
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri uri = getContext().getContentResolver().insert(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            throw new Exception("Failed to create MediaStore entry");
        }

        MediaStoreEntry entry = new MediaStoreEntry();
        entry.uri = uri;
        entry.fileName = uniqueName;
        return entry;
    }

    private void cleanupSession(String sessionId) {
        StreamSession session;
        synchronized (sessions) {
            session = sessions.remove(sessionId);
        }
        if (session == null) return;

        try { session.stream.close(); } catch (Exception ignored) {}

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && session.uri != null) {
            try { getContext().getContentResolver().delete(session.uri, null, null); } catch (Exception ignored) {}
        } else if (session.file != null) {
            session.file.delete();
        }
    }
}
