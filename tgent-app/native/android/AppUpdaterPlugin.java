package com.tgent.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    @PluginMethod
    public void getAppVersion(PluginCall call) {
        try {
            PackageInfo pInfo = getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0);
            JSObject ret = new JSObject();
            ret.put("versionName", pInfo.versionName);
            long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? pInfo.getLongVersionCode()
                    : pInfo.versionCode;
            ret.put("versionCode", versionCode);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to get app version", e);
        }
    }

    @PluginMethod
    public void checkFile(PluginCall call) {
        String fileName = call.getString("fileName");
        if (fileName == null) {
            call.reject("fileName is required");
            return;
        }

        File downloadsDir = new File(getContext().getFilesDir(), "downloads");
        File file = new File(downloadsDir, fileName);

        JSObject ret = new JSObject();
        ret.put("exists", file.exists());
        ret.put("size", file.exists() ? file.length() : 0);
        ret.put("path", file.getAbsolutePath());
        call.resolve(ret);
    }

    @PluginMethod
    public void downloadFile(PluginCall call) {
        String urlStr = call.getString("url");
        String fileName = call.getString("fileName");
        if (urlStr == null || fileName == null) {
            call.reject("url and fileName are required");
            return;
        }

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                File downloadsDir = new File(getContext().getFilesDir(), "downloads");
                if (!downloadsDir.exists()) {
                    downloadsDir.mkdirs();
                }
                File outFile = new File(downloadsDir, fileName);

                URL url = new URL(urlStr);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(30000);
                conn.connect();

                int totalSize = conn.getContentLength();
                InputStream input = new BufferedInputStream(conn.getInputStream());
                OutputStream output = new FileOutputStream(outFile);

                byte[] buffer = new byte[8192];
                int loaded = 0;
                int count;
                int lastReportedProgress = -1;

                while ((count = input.read(buffer)) != -1) {
                    output.write(buffer, 0, count);
                    loaded += count;

                    if (totalSize > 0) {
                        int progress = (int) ((loaded * 100L) / totalSize);
                        if (progress != lastReportedProgress) {
                            lastReportedProgress = progress;
                            JSObject event = new JSObject();
                            event.put("progress", progress);
                            event.put("loaded", loaded);
                            event.put("total", totalSize);
                            notifyListeners("downloadProgress", event);
                        }
                    }
                }

                output.flush();
                output.close();
                input.close();

                JSObject ret = new JSObject();
                ret.put("path", outFile.getAbsolutePath());
                ret.put("size", outFile.length());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Download failed: " + e.getMessage(), e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("path is required");
            return;
        }

        try {
            File apkFile = new File(path);
            if (!apkFile.exists()) {
                call.reject("APK file not found: " + path);
                return;
            }

            Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    apkFile
            );

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(intent);

            call.resolve();
        } catch (Exception e) {
            call.reject("Install APK failed: " + e.getMessage(), e);
        }
    }
}
