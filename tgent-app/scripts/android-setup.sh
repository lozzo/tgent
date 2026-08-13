#!/bin/bash
# Android 项目初始化脚本
# 在 npx cap add android 之后运行，自动配置权限和原生文件
# 用法: bash scripts/android-setup.sh

set -e
cd "$(dirname "$0")/.."

ANDROID_DIR="android"
BUILD_GRADLE="$ANDROID_DIR/app/build.gradle"
MANIFEST="$ANDROID_DIR/app/src/main/AndroidManifest.xml"

if [ ! -d "$ANDROID_DIR" ]; then
  echo "错误: android 目录不存在，请先运行 npx cap add android"
  exit 1
fi

# 跨平台 sed -i
sedi() {
  if [ "$(uname)" = "Darwin" ]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

echo "=== Android 项目初始化 ==="

# 1. 签名配置只读取环境变量，密钥不复制到项目目录。
SIGNING_APPLY="apply from: '../../native/android/signing.gradle'"
if ! grep -Fq "$SIGNING_APPLY" "$BUILD_GRADLE"; then
  printf '\n%s\n' "$SIGNING_APPLY" >> "$BUILD_GRADLE"
  echo "[✓] 启用环境变量签名配置"
fi

# 2. 添加权限
add_permission() {
  local perm="$1"
  local attrs="$2"
  if ! grep -q "android.permission.$perm" "$MANIFEST"; then
    if [ -n "$attrs" ]; then
      sedi "/<uses-permission android:name=\"android.permission.INTERNET\"/a\\
    <uses-permission android:name=\"android.permission.$perm\" $attrs />" "$MANIFEST"
    else
      sedi "/<uses-permission android:name=\"android.permission.INTERNET\"/a\\
    <uses-permission android:name=\"android.permission.$perm\" />" "$MANIFEST"
    fi
    echo "[✓] 添加权限: $perm"
  else
    echo "[·] 权限已存在: $perm"
  fi
}

add_permission "CAMERA"
add_permission "WRITE_EXTERNAL_STORAGE" 'android:maxSdkVersion="28"'
add_permission "READ_EXTERNAL_STORAGE" 'android:maxSdkVersion="32"'
add_permission "READ_MEDIA_IMAGES" 'android:minSdkVersion="33"'
add_permission "FOREGROUND_SERVICE"
add_permission "FOREGROUND_SERVICE_SPECIAL_USE"
add_permission "POST_NOTIFICATIONS"
add_permission "REQUEST_INSTALL_PACKAGES"
add_permission "WAKE_LOCK"
add_permission "VIBRATE"

# 4. 复制原生 Java/Kotlin 文件（含子目录）
NATIVE_JAVA_DIR="native/android"
TARGET_JAVA_DIR="$ANDROID_DIR/app/src/main/java/com/tgent/app"

if [ -d "$NATIVE_JAVA_DIR" ]; then
  mkdir -p "$TARGET_JAVA_DIR"
  # 顶层 .java 和 .kt 文件
  for ext in java kt; do
    for jfile in "$NATIVE_JAVA_DIR"/*.$ext; do
      [ -f "$jfile" ] || continue
      cp "$jfile" "$TARGET_JAVA_DIR/"
      echo "[✓] 复制 $(basename "$jfile")"
    done
  done
  # 子目录（含 Go C ABI 的 Kotlin 薄适配层）
  for subdir in util goclient; do
    if [ -d "$NATIVE_JAVA_DIR/$subdir" ]; then
      mkdir -p "$TARGET_JAVA_DIR/$subdir"
      for ext in java kt; do
        for jfile in "$NATIVE_JAVA_DIR/$subdir"/*.$ext; do
          [ -f "$jfile" ] || continue
          cp "$jfile" "$TARGET_JAVA_DIR/$subdir/"
          echo "[✓] 复制 $subdir/$(basename "$jfile")"
        done
      done
    fi
  done
else
  echo "[!] 未找到 $NATIVE_JAVA_DIR 目录，跳过 Java/Kotlin 文件复制"
fi

# 5. 注册 ForegroundService 到 AndroidManifest.xml
if ! grep -q 'TgentForegroundService' "$MANIFEST"; then
  sedi '/<\/application>/i\
        <service\
            android:name=".TgentForegroundService"\
            android:foregroundServiceType="specialUse"\
            android:exported="false" />' "$MANIFEST"
  echo "[✓] 注册 TgentForegroundService"
else
  echo "[·] TgentForegroundService 已注册，跳过"
fi

# 5c. 添加 Kotlin 支持到 Gradle
PROJECT_BUILD_GRADLE="$ANDROID_DIR/build.gradle"
if ! grep -q 'kotlin-gradle-plugin' "$PROJECT_BUILD_GRADLE"; then
  python3 -c "
with open('$PROJECT_BUILD_GRADLE', 'r') as f:
    content = f.read()
# 添加 kotlin_version 和 kotlin-gradle-plugin
content = content.replace(
    'buildscript {',
    'buildscript {\n    ext.kotlin_version = \"1.9.24\"'
)
content = content.replace(
    \"classpath 'com.google.gms:google-services:4.4.4'\",
    \"classpath 'com.google.gms:google-services:4.4.4'\n        classpath \\\"org.jetbrains.kotlin:kotlin-gradle-plugin:\\\\\\\$kotlin_version\\\"\"
)
with open('$PROJECT_BUILD_GRADLE', 'w') as f:
    f.write(content)
"
  echo "[✓] 添加 Kotlin Gradle plugin"
else
  echo "[·] Kotlin Gradle plugin 已存在，跳过"
fi

if ! grep -q 'kotlin-android' "$BUILD_GRADLE"; then
  sed -i "s/apply plugin: 'com.android.application'/apply plugin: 'com.android.application'\napply plugin: 'kotlin-android'/" "$BUILD_GRADLE"
  echo "[✓] 添加 kotlin-android plugin"
else
  echo "[·] kotlin-android plugin 已存在，跳过"
fi

# 5d. 添加 ACCESS_NETWORK_STATE 权限（ConnectivityManager 需要）
add_permission "ACCESS_NETWORK_STATE"

# 5e. 配置 network_security_config（允许 localhost 明文 WebSocket）
NETWORK_SEC_SRC="native/android/res/xml/network_security_config.xml"
NETWORK_SEC_DST="$ANDROID_DIR/app/src/main/res/xml/network_security_config.xml"
if [ -f "$NETWORK_SEC_SRC" ]; then
  cp "$NETWORK_SEC_SRC" "$NETWORK_SEC_DST"
  echo "[✓] 复制 network_security_config.xml"
fi

FILE_PATHS_SRC="native/android/res/xml/file_paths.xml"
FILE_PATHS_DST="$ANDROID_DIR/app/src/main/res/xml/file_paths.xml"
if [ -f "$FILE_PATHS_SRC" ]; then
  cp "$FILE_PATHS_SRC" "$FILE_PATHS_DST"
  echo "[✓] 复制 file_paths.xml"
fi
if ! grep -q 'networkSecurityConfig' "$MANIFEST"; then
  sed -i 's/<application/<application\n        android:networkSecurityConfig="@xml\/network_security_config"/' "$MANIFEST"
  echo "[✓] 配置 networkSecurityConfig"
else
  echo "[·] networkSecurityConfig 已配置，跳过"
fi

if ! grep -q 'usesCleartextTraffic' "$MANIFEST"; then
  python3 - <<PY
from pathlib import Path
path = Path("$MANIFEST")
text = path.read_text()
text = text.replace("<application", '<application\\n        android:usesCleartextTraffic="true"', 1)
path.write_text(text)
PY
  echo "[✓] 配置 usesCleartextTraffic"
else
  echo "[·] usesCleartextTraffic 已配置，跳过"
fi

# 6. 配置 local.properties (sdk.dir)
LOCAL_PROPS="$ANDROID_DIR/local.properties"
if [ -n "$ANDROID_HOME" ]; then
  echo "sdk.dir=$ANDROID_HOME" > "$LOCAL_PROPS"
  echo "[✓] 配置 sdk.dir=$ANDROID_HOME"
elif [ -n "$ANDROID_SDK_ROOT" ]; then
  echo "sdk.dir=$ANDROID_SDK_ROOT" > "$LOCAL_PROPS"
  echo "[✓] 配置 sdk.dir=$ANDROID_SDK_ROOT"
else
  echo "[!] 未检测到 ANDROID_HOME，请手动配置 $LOCAL_PROPS"
fi

# 7. 复制 ProGuard 规则
PROGUARD_SRC="native/android/proguard-rules.pro"
PROGUARD_DST="$ANDROID_DIR/app/proguard-rules.pro"
if [ -f "$PROGUARD_SRC" ]; then
  cp "$PROGUARD_SRC" "$PROGUARD_DST"
  echo "[✓] 复制 proguard-rules.pro"
fi

# 8. 开启 minify + shrink + ABI 分包
if ! grep -q 'shrinkResources' "$BUILD_GRADLE"; then
  sed -i 's/minifyEnabled false/minifyEnabled true/' "$BUILD_GRADLE"
  sed -i "s/proguard-android.txt/proguard-android-optimize.txt/" "$BUILD_GRADLE"
  # 在 minifyEnabled 后插入 shrinkResources
  sed -i '/minifyEnabled true/a\            shrinkResources true' "$BUILD_GRADLE"
  echo "[✓] 开启 minify + shrink"
else
  echo "[·] minify + shrink 已配置，跳过"
fi

if ! grep -q 'splits' "$BUILD_GRADLE"; then
  # 在 buildTypes 块的结束 } 后插入 splits 配置
  python3 -c "
with open('$BUILD_GRADLE', 'r') as f:
    content = f.read()
splits_block = '''    splits {
        abi {
            enable true
            reset()
            include 'arm64-v8a'
            universalApk true
        }
    }
'''
# 在 buildTypes 块后插入
import re
# 找到 buildTypes { ... } 块的结束位置
lines = content.split('\n')
brace_count = 0
insert_idx = -1
in_build_types = False
for i, line in enumerate(lines):
    if 'buildTypes {' in line:
        in_build_types = True
        brace_count = 0
    if in_build_types:
        brace_count += line.count('{') - line.count('}')
        if brace_count == 0:
            insert_idx = i + 1
            break
if insert_idx > 0:
    lines.insert(insert_idx, splits_block)
    content = '\n'.join(lines)
with open('$BUILD_GRADLE', 'w') as f:
    f.write(content)
"
  echo "[✓] 配置 ABI 分包 (arm64-v8a)"
else
  echo "[·] ABI 分包已配置，跳过"
fi

echo "=== 初始化完成 ==="
