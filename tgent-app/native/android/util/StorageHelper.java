package com.tgent.app.util;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 存储工具 — 读取 Capacitor SharedPreferences
 *
 * Capacitor Preferences 底层使用 SharedPreferences，文件名为 "CapacitorStorage"。
 * Native 侧通过此工具直接读取 JS 侧写入的数据。
 *
 * 常用 key：
 * - tgent_web_url: Web 端 URL
 * - tgent_web_token: Web JWT Token
 * - tgent_web_refresh_token: Web Refresh Token
 * - tgent_local_servers: 本地服务器列表 JSON
 * - tgent_token: 本地 Agent Token
 */
public class StorageHelper {

    private static final String TAG = "StorageHelper";
    /** Capacitor Preferences 使用的 SharedPreferences 名称 */
    private static final String CAPACITOR_PREFS = "CapacitorStorage";
    /** Native 自有的 SharedPreferences 名称 */
    private static final String NATIVE_PREFS = "NativeConnectionPrefs";

    // ========== Capacitor Storage 读取 ==========

    /**
     * 读取 Capacitor Preferences 中的字符串值
     */
    public static String getString(Context context, String key) {
        SharedPreferences prefs = context.getSharedPreferences(CAPACITOR_PREFS, Context.MODE_PRIVATE);
        return prefs.getString(key, null);
    }

    /**
     * 读取 Capacitor Preferences 中的 JSON 对象
     */
    public static JSONObject getJsonObject(Context context, String key) {
        String value = getString(context, key);
        if (value == null) return null;
        try {
            return new JSONObject(value);
        } catch (Exception e) {
            Log.w(TAG, "Failed to parse JSON for key: " + key, e);
            return null;
        }
    }

    /**
     * 读取 Capacitor Preferences 中的 JSON 数组
     */
    public static JSONArray getJsonArray(Context context, String key) {
        String value = getString(context, key);
        if (value == null) return null;
        try {
            return new JSONArray(value);
        } catch (Exception e) {
            Log.w(TAG, "Failed to parse JSON array for key: " + key, e);
            return null;
        }
    }

    // ========== Native Preferences ==========

    /**
     * 读取 Native SharedPreferences 布尔值
     */
    public static boolean getBoolean(Context context, String key, boolean defaultValue) {
        SharedPreferences prefs = context.getSharedPreferences(NATIVE_PREFS, Context.MODE_PRIVATE);
        return prefs.getBoolean(key, defaultValue);
    }

    /**
     * 写入 Native SharedPreferences 布尔值
     */
    public static void putBoolean(Context context, String key, boolean value) {
        SharedPreferences prefs = context.getSharedPreferences(NATIVE_PREFS, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(key, value).apply();
    }

    /**
     * 读取 Native SharedPreferences 字符串
     */
    public static String getNativeString(Context context, String key) {
        SharedPreferences prefs = context.getSharedPreferences(NATIVE_PREFS, Context.MODE_PRIVATE);
        return prefs.getString(key, null);
    }

    /**
     * 写入 Native SharedPreferences 字符串
     */
    public static void putNativeString(Context context, String key, String value) {
        SharedPreferences prefs = context.getSharedPreferences(NATIVE_PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(key, value).apply();
    }

    // ========== 便捷方法 ==========

    /**
     * 获取 Web Token
     */
    public static String getWebToken(Context context) {
        return getString(context, "tgent_web_token");
    }

    /**
     * 获取 Web Refresh Token
     */
    public static String getWebRefreshToken(Context context) {
        return getString(context, "tgent_web_refresh_token");
    }

    /** 默认 Web URL，与 JS 侧 platform.ts 中的 DEFAULT_WEB_URL 保持一致 */
    private static final String DEFAULT_WEB_URL = "https://tgent.omscd.com";

    /**
     * 获取 Web URL（无自定义值时返回默认值）
     */
    public static String getWebUrl(Context context) {
        String url = getString(context, "tgent_web_url");
        return (url != null && !url.isEmpty()) ? url : DEFAULT_WEB_URL;
    }

    /**
     * 获取本地服务器列表
     */
    public static JSONArray getLocalServers(Context context) {
        return getJsonArray(context, "tgent_local_servers");
    }

    /**
     * 获取本地 Agent Token
     */
    public static String getLocalToken(Context context) {
        return getString(context, "tgent_token");
    }

    /**
     * 写入 Web Token（用于 token refresh）
     */
    public static void setWebToken(Context context, String token) {
        SharedPreferences prefs = context.getSharedPreferences(CAPACITOR_PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString("tgent_web_token", token).apply();
    }

    /**
     * 写入 Web Refresh Token
     */
    public static void setWebRefreshToken(Context context, String token) {
        SharedPreferences prefs = context.getSharedPreferences(CAPACITOR_PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString("tgent_web_refresh_token", token).apply();
    }
}
