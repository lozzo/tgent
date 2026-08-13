package com.tgent.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

@CapacitorPlugin(
    name = "ForegroundService",
    permissions = {
        @Permission(
            alias = "notifications",
            strings = { "android.permission.POST_NOTIFICATIONS" }
        )
    }
)
public class ForegroundServicePlugin extends Plugin {

    private static final int NOTIFICATION_PERMISSION_CODE = 1001;
    private static final int PERMISSION_REQUEST_CODE = 1002;
    private String pendingAction = null; // "start" or "request"

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(getContext(),
                    "android.permission.POST_NOTIFICATIONS")
                    != PackageManager.PERMISSION_GRANTED) {
                pendingAction = "start";
                saveCall(call);
                ActivityCompat.requestPermissions(
                    getActivity(),
                    new String[]{ "android.permission.POST_NOTIFICATIONS" },
                    NOTIFICATION_PERMISSION_CODE
                );
                return;
            }
        }
        startService(call);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(getContext(),
                    "android.permission.POST_NOTIFICATIONS")
                    != PackageManager.PERMISSION_GRANTED) {
                pendingAction = "request";
                saveCall(call);
                ActivityCompat.requestPermissions(
                    getActivity(),
                    new String[]{ "android.permission.POST_NOTIFICATIONS" },
                    PERMISSION_REQUEST_CODE
                );
                return;
            }
        }
        // 已有权限或低版本，直接返回 granted
        JSObject ret = new JSObject();
        ret.put("granted", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), TgentForegroundService.class);
        getContext().stopService(intent);
        call.resolve();
    }

    private void startService(PluginCall call) {
        Intent intent = new Intent(getContext(), TgentForegroundService.class);
        String content = call.getString("content", "终端连接中");
        intent.putExtra("content", content);
        Boolean deep = call.getBoolean("deep", false);
        intent.putExtra("deep", deep != null && deep);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }

        call.resolve();
    }

    @Override
    protected void handleRequestPermissionsResult(
            int requestCode, String[] permissions, int[] grantResults) {
        super.handleRequestPermissionsResult(requestCode, permissions, grantResults);

        PluginCall savedCall = getSavedCall();
        if (savedCall == null) return;

        boolean granted = grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;

        if (requestCode == NOTIFICATION_PERMISSION_CODE) {
            startService(savedCall);
        } else if (requestCode == PERMISSION_REQUEST_CODE) {
            JSObject ret = new JSObject();
            ret.put("granted", granted);
            savedCall.resolve(ret);
        }

        pendingAction = null;
    }
}
