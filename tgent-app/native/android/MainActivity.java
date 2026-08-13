package com.tgent.app;

import android.os.Bundle;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "TgentMainActivity";
    private boolean recoveringWebView = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 注册自定义插件
        registerPlugin(ForegroundServicePlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(SaveToDownloadsPlugin.class);
        registerPlugin(RingerModePlugin.class);
        registerPlugin(NativeHapticPlugin.class);
        registerPlugin(NativeConnectionPlugin.class);
        registerPlugin(NativeFilePickerPlugin.class);

        super.onCreate(savedInstanceState);

        // 开启 WebView 调试（仅 debug 构建）
        boolean isDebug = (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(isDebug);

        // 配置 WebView 减少冻结
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            settings.setDomStorageEnabled(true);
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        // Android 可能在后台内存压力下单独结束 WebView 渲染进程。
        // Capacitor 默认未处理该事件，会导致整个 App 被系统结束；重建 Activity 可恢复页面。
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (recoveringWebView) return true;
                recoveringWebView = true;

                Log.e(TAG, "WebView renderer gone, recreating activity; crashed=" + detail.didCrash());
                view.setVisibility(WebView.INVISIBLE);
                getWindow().getDecorView().post(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        recreate();
                    }
                });
                return true;
            }
        });
    }
}
