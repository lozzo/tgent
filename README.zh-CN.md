# TGent 客户端

[English](README.md)

TGent 是一个面向多设备、多主机和长时间运行 tmux 任务的终端工作区。本仓库只包含
开源客户端：Wails 桌面端、Android 客户端、共享终端 UI，以及原生客户端连接引擎。

本仓库有意**不包含** TGent endpoint、Hub、托管控制面、数据库、计费代码和部署设施。
你需要单独安装或运行 TGent endpoint，再使用这里的客户端连接它。

## 包含的功能

- 面向 macOS、Windows 和 Linux 的桌面终端工作区
- Quake Mode、标签页、分屏、Terminal Picker、Topology 和文件管理
- 同一用户下自动发现本地 Socket，本地使用不要求登录账号
- 可选的远程 endpoint 和账号连接
- 支持后台运行与文件传输的 Android 客户端
- React/xterm 共享界面，以及 Go 实现的 WebRTC/WebSocket 客户端引擎

## 仓库结构

| 目录 | 用途 |
| --- | --- |
| [`shared`](shared) | React、xterm、状态、协议与共享客户端 UI |
| [`tgent-desktop`](tgent-desktop) | Wails v2 桌面壳和系统原生能力 |
| [`tgent-app`](tgent-app) | Capacitor Android 壳和原生能力 |
| [`client-go`](client-go) | 纯客户端 Go 连接引擎、WebAssembly 和 Android C ABI |

本仓库没有 endpoint、daemon、tmux provider、Hub、控制面或其他服务端可执行程序。

## 使用 TGent

桌面客户端启动时会尝试发现已经运行的本地 TGent endpoint。本地 endpoint 是单独安装的
软件，本源码仓库不会内嵌或自动启动它。在支持的平台上，本地连接优先使用同一用户的
Unix Socket；只使用本地终端时无需登录账号。

预编译客户端之后会发布到仓库的
[Releases](https://github.com/lozzo/tgent-client/releases) 页面。在首个版本发布前，可以按
下面的说明从源码构建。

## 从源码构建

环境要求：

- Go 1.24.2 或更高版本
- Node.js 22 和 npm
- 桌面构建需要 Wails CLI 2.12
- Android 构建需要 Android Studio、SDK 和 NDK 27.2

```bash
git clone https://github.com/lozzo/tgent-client.git
cd tgent-client
make bootstrap
make test
```

运行桌面客户端：

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
make dev-desktop
```

完整构建命令与平台注意事项见
[`docs/development.zh-CN.md`](docs/development.zh-CN.md)。

## 安全

请勿在公开 Issue 中提交配对码、密码、endpoint 私钥、Token、内网地址、文件路径或终端
内容。安全问题请按 [`SECURITY.md`](SECURITY.md) 的说明私下报告。

## 开源与商业服务

客户端源码采用 [`AGPL-3.0-only`](LICENSE) 许可证。开源不代表 TGent 的所有产品和服务
都是免费的；官方托管连接、托管发布、企业能力和支持服务可以收费。详见
[`COMMERCIAL.md`](COMMERCIAL.md) 和 [`TRADEMARKS.md`](TRADEMARKS.md)。

参与贡献请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
