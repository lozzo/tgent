# TGent Clients

[简体中文](README.zh-CN.md)

TGent is a terminal workspace for people who keep long-running tmux terminals
across a laptop, desktop, phone, and remote machines. This repository contains
the open-source TGent client applications: the Wails desktop app, Android app,
shared terminal UI, and the native client connection engine.

The TGent endpoint, Hub, hosted control plane, databases, billing code, and
deployment infrastructure are intentionally **not included** in this
repository. Install or operate a TGent endpoint separately, then connect these
clients to it.

## What you get

- Desktop-first terminal workspace for macOS, Windows, and Linux
- Quake Mode, tabs, splits, terminal picker, topology, and file management
- Local same-user socket discovery without requiring account login
- Optional remote endpoint and account connections
- Android terminal access with native background and file-transfer support
- One shared React/xterm UI backed by a Go WebRTC/WebSocket client engine

## Repository layout

| Directory | Purpose |
| --- | --- |
| [`shared`](shared) | React, xterm, state, protocol, and shared client UI |
| [`tgent-desktop`](tgent-desktop) | Wails v2 desktop shell and native integrations |
| [`tgent-app`](tgent-app) | Capacitor Android shell and native integrations |
| [`client-go`](client-go) | Client-only Go connection engine, WebAssembly, and Android C ABI |

There are no endpoint, daemon, tmux provider, Hub, control-plane, or server
executables in this repository.

## Use TGent

The desktop app tries to discover an already-running local TGent endpoint when
it starts. A local endpoint is separate software and is not launched or bundled
by this source tree. Local access prefers a same-user Unix socket when the
platform supports it; signing in is optional for local use.

Prebuilt client releases will be published on the repository's
[Releases](https://github.com/lozzo/tgent-client/releases) page. Until then,
build from source using the instructions below.

## Build from source

Requirements:

- Go 1.24.2 or newer
- Node.js 22 and npm
- Wails CLI 2.12 for desktop builds
- Android Studio, SDK, and NDK 27.2 for Android builds

```bash
git clone https://github.com/lozzo/tgent-client.git
cd tgent-client
make bootstrap
make test
```

Run the desktop app:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
make dev-desktop
```

Build targets and platform notes are documented in
[`docs/development.md`](docs/development.md).

## Security

Never post pair codes, passwords, endpoint private keys, tokens, private
addresses, file paths, or terminal contents in a public issue. Report
vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md).

## Open source and commercial services

The client source is licensed under
[`AGPL-3.0-only`](LICENSE). Open source does not mean that every TGent product
or service is free. Official hosted connectivity, managed releases, enterprise
features, and support may be paid offerings. See
[`COMMERCIAL.md`](COMMERCIAL.md) and [`TRADEMARKS.md`](TRADEMARKS.md).

Contributions are welcome under [`CONTRIBUTING.md`](CONTRIBUTING.md).
