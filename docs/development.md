# Client development

## Shared UI

```bash
npm --prefix shared ci
npm --prefix shared run typecheck
npm --prefix shared run build:app
npm --prefix shared run build:desktop
```

The App and Desktop targets select platform behavior through Vite modes. Keep
terminal rendering, protocol state, and reusable interactions in `shared`.

## Go client engine

```bash
cd client-go
go test ./...
cd ..
bash client-go/scripts/build-web-client.sh
```

The script writes generated WebAssembly files to `tgent-app/public/wasm`.
Those files are build artifacts and are ignored by Git.

## Desktop

Install Wails 2.12, then run or build the desktop client:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
make dev-desktop
make build-desktop
```

The desktop app discovers a separately installed local TGent endpoint. It does
not contain or launch an endpoint process.

## Android

Set `ANDROID_SDK_ROOT` and install Android NDK `27.2.12479018` (or set
`TGENT_ANDROID_NDK_VERSION`). Then run:

```bash
npm --prefix tgent-app ci
bash client-go/scripts/build-android-client.sh
npm --prefix tgent-app run build
npm --prefix tgent-app run cap:sync
cd tgent-app/android && ./gradlew assembleDebug
```

Release signing is supplied only through environment variables described by
`tgent-app/native/android/signing.gradle`. Never commit a keystore or signing
configuration.
