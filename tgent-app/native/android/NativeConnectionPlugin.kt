package com.tgent.app

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.tgent.app.goclient.GoConnectionManager
import com.tgent.app.util.StorageHelper
import org.json.JSONObject

/**
 * NativeConnectionPlugin — Capacitor Plugin（控制面）
 *
 * JS 通过此 Plugin 控制 Native 连接层：
 * - connect/retry/release: 管理连接
 * - getBridgePort: 获取 WS Bridge 端口
 * - setEnabled/isEnabled: Feature flag
 * - 事件推送: stateChange, serverEvent
 */
@CapacitorPlugin(name = "NativeConnection")
class NativeConnectionPlugin : Plugin() {

    companion object {
        private const val TAG = "NativeConnectionPlugin"
    }

    private var goManager: GoConnectionManager? = null
    private var enabled = false

    override fun load() {
        enabled = StorageHelper.getBoolean(context, "native_connection_enabled", true)
        if (enabled) startBridgeServer()
    }

    // ========== 连接管理 ==========

    @PluginMethod
    fun connect(call: PluginCall) {
        if (!ensureEnabled(call)) return

        val serverType = call.getString("serverType")
        val serverId = call.getString("serverId")
        if (serverType == null || serverId == null) {
            call.reject("serverType and serverId are required")
            return
        }

        val localServerJson = call.getString("localServer")
        Log.i(TAG, "connect: type=$serverType id=$serverId")
        goManager?.connect(serverType, serverId, localServerJson)
        call.resolve()
    }

    @PluginMethod
    fun retry(call: PluginCall) {
        if (!ensureEnabled(call)) return
        val serverType = call.getString("serverType")
        val serverId = call.getString("serverId")
        if (serverType == null || serverId == null) {
            call.reject("serverType and serverId are required")
            return
        }
        goManager?.retry(serverType, serverId)
        call.resolve()
    }

    @PluginMethod
    fun release(call: PluginCall) {
        if (!ensureEnabled(call)) return
        val serverType = call.getString("serverType")
        val serverId = call.getString("serverId")
        if (serverType == null || serverId == null) {
            call.reject("serverType and serverId are required")
            return
        }
        goManager?.release(serverType, serverId)
        call.resolve()
    }

    @PluginMethod
    fun releaseAll(call: PluginCall) {
        if (!ensureEnabled(call)) return
        goManager?.releaseAll()
        call.resolve()
    }

    @PluginMethod
    fun releaseHubStores(call: PluginCall) {
        if (!ensureEnabled(call)) return
        goManager?.releaseHubStores()
        call.resolve()
    }

    @PluginMethod
    fun releaseStores(call: PluginCall) {
        if (!ensureEnabled(call)) return
        val keysArray = call.getArray("keys")
        if (keysArray == null) {
            call.reject("keys is required")
            return
        }
        val keys = mutableListOf<String>()
        for (i in 0 until keysArray.length()) {
            keysArray.optString(i)?.let { keys.add(it) }
        }
        goManager?.releaseStores(keys)
        call.resolve()
    }

    @PluginMethod
    fun getSnapshot(call: PluginCall) {
        if (!ensureEnabled(call)) return
        val serverType = call.getString("serverType")
        val serverId = call.getString("serverId")
        if (serverType == null || serverId == null) {
            call.reject("serverType and serverId are required")
            return
        }

        val snapshot = goManager?.snapshot(serverType, serverId)
        if (snapshot != null) {
            try {
                call.resolve(JSObject.fromJSONObject(snapshot))
            } catch (e: org.json.JSONException) {
                call.reject("Failed to convert snapshot", e)
            }
        } else {
            call.resolve(JSObject())
        }
    }

    @PluginMethod
    fun getBridgePort(call: PluginCall) {
        val ret = JSObject()
        val port = goManager?.bridgePort() ?: 0
        Log.i(TAG, "getBridgePort: $port")
        ret.put("port", port)
        call.resolve(ret)
    }

    @PluginMethod
    fun getConnectionInfo(call: PluginCall) {
        if (!ensureEnabled(call)) return
        val storeKey = call.getString("storeKey")
        val info = goManager?.connectionInfo(storeKey)
            ?: JSONObject().apply { put("type", "unknown") }
        try {
            call.resolve(JSObject.fromJSONObject(info))
        } catch (e: org.json.JSONException) {
            call.reject("Failed to convert connection info", e)
        }
    }

    @PluginMethod
    fun network(call: PluginCall) {
        if (!ensureEnabled(call)) return
        goManager?.network(call.getBoolean("up", true) ?: true)
        call.resolve()
    }

    // ========== Feature Flag ==========

    @PluginMethod
    fun setEnabled(call: PluginCall) {
        val value = call.getBoolean("enabled", false) ?: false
        enabled = value
        StorageHelper.putBoolean(context, "native_connection_enabled", enabled)

        if (enabled && goManager == null) {
            startBridgeServer()
        } else if (!enabled && goManager != null) {
            stopBridgeServer()
        }
        call.resolve()
    }

    @PluginMethod
    fun isEnabled(call: PluginCall) {
        val ret = JSObject()
        ret.put("enabled", enabled)
        call.resolve(ret)
    }

    // ========== 内部方法 ==========

    private fun ensureEnabled(call: PluginCall): Boolean {
        if (!enabled) {
            Log.w(TAG, "ensureEnabled: REJECTED (enabled=false) method=${call.methodName}")
            call.reject("Native connection is not enabled")
            return false
        }
        return true
    }

    private fun startBridgeServer() {
        if (goManager != null) return
        try {
            goManager = GoConnectionManager(context) { storeKey, snapshot ->
                notifyStateChange(storeKey, snapshot)
            }
            Log.i(TAG, "Go connection engine initialized on port ${goManager?.bridgePort()}")
        } catch (e: Throwable) {
            goManager = null
            enabled = false
            Log.e(TAG, "Go connection engine unavailable", e)
        }
    }

    private fun stopBridgeServer() {
        goManager?.close()
        goManager = null
    }

    fun notifyStateChange(storeKey: String, snapshot: JSONObject) {
        val data = JSObject()
        data.put("storeKey", storeKey)
        try {
            val keys = snapshot.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                data.put(key, snapshot.get(key))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to build state change event", e)
        }
        notifyListeners("stateChange", data)
    }

    override fun handleOnResume() {
        goManager?.lifecycle(active = true, resume = true)
    }

    override fun handleOnPause() {
        goManager?.lifecycle(active = false, resume = false)
    }

    override fun handleOnDestroy() {
        stopBridgeServer()
    }
}
