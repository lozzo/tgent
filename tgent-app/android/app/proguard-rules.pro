# ===== Capacitor / WebView =====
# Capacitor 通过 WebView JS Bridge 与 Java 交互
-keep class com.getcapacitor.** { *; }
-keep class com.tgent.app.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-dontwarn com.getcapacitor.**

# ===== WebRTC =====
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

# ===== Java-WebSocket =====
-keep class org.java_websocket.** { *; }
-dontwarn org.java_websocket.**

# ===== BouncyCastle =====
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**

# ===== Gson =====
-keep class com.google.gson.** { *; }
-keepattributes Signature
-keepattributes *Annotation*

# ===== Kotlin =====
-dontwarn kotlin.**
-dontwarn kotlinx.**

# ===== 通用 =====
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
