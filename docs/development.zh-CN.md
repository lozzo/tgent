# 客户端开发

## 共享 UI

```bash
npm --prefix shared ci
npm --prefix shared run typecheck
npm --prefix shared run build:app
npm --prefix shared run build:desktop
```

App 与 Desktop 通过 Vite mode 选择平台行为。终端渲染、协议状态和可复用交互应放在
`shared` 中。

## Go 客户端引擎

```bash
cd client-go
go test ./...
cd ..
bash client-go/scripts/build-web-client.sh
```

脚本会把生成的 WebAssembly 写入 `tgent-app/public/wasm`。这些文件属于构建产物，不会
提交到 Git。

## 桌面端

安装 Wails 2.12 后运行或构建：

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
make dev-desktop
make build-desktop
```

桌面客户端只发现单独安装的本地 TGent endpoint，不包含也不会启动 endpoint 进程。

## Android

配置 `ANDROID_SDK_ROOT`，并安装 Android NDK `27.2.12479018`（也可通过
`TGENT_ANDROID_NDK_VERSION` 指定版本），然后运行：

```bash
npm --prefix tgent-app ci
bash client-go/scripts/build-android-client.sh
npm --prefix tgent-app run build
npm --prefix tgent-app run cap:sync
cd tgent-app/android && ./gradlew assembleDebug
```

Release 签名只能通过 `tgent-app/native/android/signing.gradle` 描述的环境变量传入。
禁止提交 keystore 或本地签名配置。
