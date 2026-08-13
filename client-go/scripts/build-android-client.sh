#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace_root="$(cd "${repo_root}/.." && pwd)"
sdk_root="${ANDROID_SDK_ROOT:-${HOME}/Library/Android/sdk}"
ndk_version="${TGENT_ANDROID_NDK_VERSION:-27.2.12479018}"
ndk_root="${ANDROID_NDK_ROOT:-${sdk_root}/ndk/${ndk_version}}"
output_root="${1:-${workspace_root}/tgent-app/android/app/src/main/jniLibs}"
api="${TGENT_ANDROID_API:-24}"

[[ -d "${ndk_root}" ]] || { echo "Android NDK missing: ${ndk_root}" >&2; exit 1; }
case "$(uname -s)" in Darwin) host_tag="darwin-x86_64";; Linux) host_tag="linux-x86_64";; *) exit 1;; esac
toolchain="${ndk_root}/toolchains/llvm/prebuilt/${host_tag}/bin"
include_dir="${repo_root}/cabi"
jni_source="${workspace_root}/tgent-app/native/android/cpp/tgent_client_jni.c"

(cd "${repo_root}" && go test ./clientcore ./cabi/androidlib)

build_abi() {
  local abi="$1" goarch="$2" triple="$3" dest="${output_root}/$1"
  mkdir -p "${dest}"
  (cd "${repo_root}" && GOOS=android GOARCH="${goarch}" CGO_ENABLED=1 CC="${toolchain}/${triple}${api}-clang" \
    go build -trimpath -buildmode=c-shared -ldflags='-checklinkname=0' -o "${dest}/libtgent_client.so" ./cabi/androidlib)
  "${toolchain}/${triple}${api}-clang" -shared -fPIC -I"${include_dir}" "${jni_source}" -L"${dest}" -ltgent_client \
    -Wl,-soname,libtgent_client_jni.so -o "${dest}/libtgent_client_jni.so"
  rm -f "${dest}/libtgent_client.h"
}

build_abi arm64-v8a arm64 aarch64-linux-android
