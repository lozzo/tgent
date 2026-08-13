package com.tgent.app.goclient

/** Android only adapts the stable C ABI. Network, WebRTC, channels and reconnect state live in Go. */
object GoClientNative {
    init { System.loadLibrary("tgent_client_jni") }

    external fun abiVersion(): Int
    external fun create(): Long
    external fun command(engine: Long, json: ByteArray): ByteArray
    external fun nextEvent(engine: Long, timeoutMillis: Int): ByteArray
    external fun bridgePort(engine: Long): Int
    external fun close(engine: Long)
}
