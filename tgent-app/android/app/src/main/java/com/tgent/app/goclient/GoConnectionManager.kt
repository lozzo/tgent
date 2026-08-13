package com.tgent.app.goclient

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.util.Log
import com.tgent.app.util.StorageHelper
import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import java.util.concurrent.atomic.AtomicBoolean

class GoConnectionManager(
    private val context: Context,
    private val onStateChange: (String, JSONObject) -> Unit
) : Closeable {
    companion object { private const val TAG = "GoConnectionManager" }

    private val engine = GoClientNative.create()
    private val running = AtomicBoolean(true)
    private val eventThread = Thread(::pollEvents, "TgentGoEvents").apply { start() }
    private val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    init {
        check(GoClientNative.abiVersion() == 1) { "unsupported Tgent Go ABI" }
        check(engine != 0L) { "failed to create Tgent Go engine" }
        startNetworkMonitor()
    }

    fun bridgePort(): Int = GoClientNative.bridgePort(engine)

    fun connect(serverType: String, serverId: String, localServer: String?) {
        command(JSONObject().apply {
            put("action", "connect")
            put("serverType", serverType)
            put("serverId", serverId)
            if (!localServer.isNullOrEmpty()) put("localServer", JSONObject(localServer))
            put("webUrl", StorageHelper.getWebUrl(context))
            put("webToken", StorageHelper.getWebToken(context) ?: "")
            put("refreshToken", StorageHelper.getWebRefreshToken(context) ?: "")
        })
    }

    fun retry(serverType: String, serverId: String) = command(action("retry", serverType, serverId))
    fun release(serverType: String, serverId: String) = command(action("release", serverType, serverId))
    fun releaseAll() = command(JSONObject().put("action", "release_all"))
    fun releaseHubStores() = command(JSONObject().put("action", "release_hub"))
    fun releaseStores(keys: List<String>) = command(JSONObject().put("action", "release_keys").put("keys", JSONArray(keys)))

    fun snapshot(serverType: String, serverId: String): JSONObject =
        command(action("snapshot", serverType, serverId))

    fun connectionInfo(storeKey: String?): JSONObject = command(JSONObject().apply {
        put("action", "connection_info")
        if (!storeKey.isNullOrEmpty()) put("storeKey", storeKey)
    })

    fun network(up: Boolean, type: String = "") = command(JSONObject().apply {
        put("action", "network")
        put("networkUp", up)
        if (type.isNotEmpty()) put("networkType", type)
    })

    fun lifecycle(active: Boolean, resume: Boolean) = command(JSONObject().apply {
        put("action", "lifecycle")
        put("appActive", active)
        put("resume", resume)
    })

    private fun action(name: String, serverType: String, serverId: String) = JSONObject()
        .put("action", name).put("serverType", serverType).put("serverId", serverId)

    private fun command(json: JSONObject): JSONObject {
        val response = GoClientNative.command(engine, json.toString().toByteArray(Charsets.UTF_8))
        return if (response.isEmpty()) JSONObject() else JSONObject(String(response, Charsets.UTF_8))
    }

    private fun pollEvents() {
        while (running.get()) {
            try {
                val bytes = GoClientNative.nextEvent(engine, 1000)
                if (bytes.isEmpty()) continue
                val event = JSONObject(String(bytes, Charsets.UTF_8))
                when (event.optString("type")) {
                    "state_change" -> onStateChange(event.getString("storeKey"), event.getJSONObject("snapshot"))
                    "token_update" -> {
                        event.optString("token").takeIf { it.isNotEmpty() }?.let { StorageHelper.setWebToken(context, it) }
                        event.optString("refreshToken").takeIf { it.isNotEmpty() }?.let { StorageHelper.setWebRefreshToken(context, it) }
                    }
                }
            } catch (e: Throwable) {
                if (running.get()) Log.e(TAG, "Go event poll failed", e)
            }
        }
    }

    private fun startNetworkMonitor() {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = publishNetworkState()
            override fun onLost(network: Network) = publishNetworkState()
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = publishNetworkState()
        }
        networkCallback = callback
        connectivityManager.registerDefaultNetworkCallback(callback)
        publishNetworkState()
    }

    private fun publishNetworkState() {
        if (!running.get()) return
        val active = connectivityManager.activeNetwork
        val caps = active?.let { connectivityManager.getNetworkCapabilities(it) }
        val online = active != null && caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        val type = when {
            caps == null -> "none"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "unknown"
        }
        try {
            network(online, type)
        } catch (e: Throwable) {
            if (running.get()) Log.w(TAG, "failed to publish network state", e)
        }
    }

    override fun close() {
        if (!running.compareAndSet(true, false)) return
        networkCallback?.let {
            try { connectivityManager.unregisterNetworkCallback(it) } catch (_: Throwable) {}
        }
        networkCallback = null
        try { GoClientNative.close(engine) } finally { eventThread.interrupt() }
    }
}
