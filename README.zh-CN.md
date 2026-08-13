<div align="center">

# TGent

**围绕 tmux 构建的现代终端工作区。**<br>
进程持续运行，视图、设备和屏幕可以随时切换。

[![CI](https://github.com/lozzo/tgent/actions/workflows/ci.yml/badge.svg)](https://github.com/lozzo/tgent/actions/workflows/ci.yml)
[![许可证：AGPL v3](https://img.shields.io/badge/license-AGPL--3.0--only-2f81f7.svg)](LICENSE)
![平台](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Android-30363d.svg)
![后端](https://img.shields.io/badge/backend-tmux-24a875.svg)

[下载](https://github.com/lozzo/tgent/releases) · [快速开始](#快速开始) · [源码构建](#从源码构建) · [English](README.md)

</div>

![包含标签页和 tmux 分屏的 TGent 桌面工作区](docs/assets/screenshots/desktop-workspace.png)

TGent 把 tmux 当作可持续运行的终端池，在它之上提供现代桌面端和移动端工作区。打开
客户端即可回到最近使用的终端；你可以用本地标签页和分屏重新组织视图，也可以按名称
跳转到任意 pane。即使客户端窗口关闭，shell 和长时间任务依然留在 tmux 中运行。

只在本地使用时不需要登录账号。桌面端会自动发现正在运行的 TGent endpoint；在支持的
平台上优先通过同一用户的 Socket 连接，因此本地连接不需要密码。

> [!IMPORTANT]
> TGent 仍在积极开发中。目前正式支持的终端后端是 tmux；首个稳定版本发布前，安装包
> 和部分交互仍可能调整。

## 为重度终端工作而设计

- **Terminal Picker**：按 `Command/Ctrl + P`，可按终端标题、机器、session、window 或
  pane 模糊搜索全部终端。每个连接可配置颜色，一眼区分不同机器。
- **本地标签页与分屏**：GUI 布局不再依赖 tmux 布局。可以替换当前视图、向右或向下
  分屏、调整尺寸，同时保持底层终端继续运行。
- **Quake Mode**：使用全局快捷键随时呼出或隐藏桌面端。在 macOS 上，下拉窗口会跟随
  光标进入当前显示器和 Space，也支持覆盖全屏 Space。
- **终端活动观察**：直接看到哪些终端仍在输出、已经安静或需要关注。无需把构建任务、
  日志和 coding agent 全部铺在屏幕上。
- **同步输入**：选择多个终端，把同一份输入同时发送给它们。
- **tmux 树状结构**：按 endpoint、session、window 和 pane 查看完整结构；支持新建、
  重命名、删除，也可以把 pane 拖入当前布局，并提前预览落点大小。
- **文件与图片粘贴**：浏览、上传和下载文件。向远程终端粘贴图片时，会先上传图片，再
  把远端可用路径交给终端程序。
- **外观与快捷键**：支持亮色/暗色主题、终端配色、透明度、背景图片、字体以及可配置
  快捷键。

<table>
  <tr>
    <td width="50%">
      <img src="docs/assets/screenshots/terminal-picker.png" alt="跨多个 TGent endpoint 的 Terminal Picker">
      <br><strong>找终端，而不是找窗口。</strong><br>
      跨机器搜索完整 tmux 身份，再把当前视图替换过去，不打断底层终端。
    </td>
    <td width="50%">
      <img src="docs/assets/screenshots/tmux-topology.png" alt="tmux 树状结构浏览器">
      <br><strong>需要时再展开真实 tmux 树。</strong><br>
      endpoint、session、window 和 pane 的完整层级都保留，但不会常驻干扰终端主体。
    </td>
  </tr>
  <tr>
    <td colspan="2">
      <img src="docs/assets/screenshots/file-browser.png" alt="分屏终端旁的远程文件浏览器">
      <br><strong>终端和文件在同一个工作区。</strong><br>
      不离开当前终端即可浏览活动 endpoint 上的文件。
    </td>
  </tr>
</table>

## 把真实终端装进口袋

Android 客户端不是一个简化的 session 列表。终端始终是屏幕主体；没有实体键盘时，
触控控制栏和根据当前程序变化的 Fn 面板会补齐移动端缺少的操作。

<table>
  <tr>
    <td width="33.33%" align="center">
      <img src="docs/assets/screenshots/mobile/terminal.png" alt="在 TGent Android 终端中运行 OpenCode">
      <br><strong>终端程序仍然是主角。</strong><br>
      全屏继续 Shell 和 coding agent，不把操作退化成远程控制列表。
    </td>
    <td width="33.33%" align="center">
      <img src="docs/assets/screenshots/mobile/fn-panel.png" alt="TGent Android 客户端中随程序变化的 Fn 面板">
      <br><strong>补齐软键盘没有的按键。</strong><br>
      快速使用控制键、命令片段、粘贴操作和当前程序的常用命令。
    </td>
    <td width="33.33%" align="center">
      <img src="docs/assets/screenshots/mobile/htop.png" alt="在 TGent Android 客户端中全屏运行 htop">
      <br><strong>全屏 TUI 依然全屏。</strong><br>
      在 Android 上查看进程，并直接操作交互式终端程序。
    </td>
  </tr>
</table>

## 安装

桌面端和 Android 安装包会陆续发布到
[Releases](https://github.com/lozzo/tgent/releases)。根据系统和处理器架构选择对应文件；
如果暂时没有你的平台安装包，可以按下文从源码构建。

| 平台 | 客户端 | 获取方式 |
| --- | --- | --- |
| macOS | Wails 桌面端，包含 Quake Mode | Release 安装包或源码构建 |
| Windows | Wails 桌面端 | Release 安装包或源码构建 |
| Linux | Wails 桌面端 | Release 安装包或源码构建 |
| Android | Capacitor 客户端，包含原生连接与文件能力 | APK 或源码构建 |

TGent 客户端连接到负责暴露 tmux 会话的 TGent endpoint。endpoint 可以运行在当前电脑，
也可以运行在其他机器上。

## 快速开始

### 1. 启动本地 endpoint

在安装了 tmux 的机器上安装单独发布的 `tgent` endpoint，然后在本机启动：

```bash
tgent start --listen 127.0.0.1:8080
```

### 2. 打开 TGent

安装桌面端 Release，或者从源码运行客户端。TGent 会先检查本地 endpoint，并打开最近
使用的终端。如果 tmux 中还没有可打开的终端，可以直接在 Terminal Picker 里新建。

常用 endpoint 命令：

```bash
tgent status
tgent logs -f
tgent stop
```

## 工作方式

```text
桌面端 / Android
       │
       ├── 同一用户 Socket（本地）
       └── WebRTC 或 WebSocket（远程）
                    │
              TGent endpoint
                    │
                   tmux
                    │
        sessions / windows / panes
```

tmux 负责终端生命周期；TGent 负责客户端体验，包括标签页、分屏、外观、快捷键、活动
状态，以及哪个视图拥有输入和终端尺寸控制权。其他视图可以观察同一个 pane，但不会
随意改变它的大小。

## 从源码构建

### 环境要求

- Go 1.24.2 或更高版本
- Node.js 22 和 npm
- endpoint 所在机器需要 tmux 3.0 或更高版本
- Wails CLI 2.12 以及对应系统的
  [平台依赖](https://wails.io/docs/v2.12.0/gettingstarted/installation/)
- 构建 Android 需要 Android Studio、Android SDK 和 NDK 27.2

克隆并验证客户端：

```bash
git clone https://github.com/lozzo/tgent.git
cd tgent
make bootstrap
make check
```

以开发模式运行桌面端：

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
make dev-desktop
```

构建桌面应用：

```bash
make build-desktop
```

构建 Android Debug APK：

```bash
bash client-go/scripts/build-android-client.sh
npm --prefix tgent-app run build
npm --prefix tgent-app run cap:sync
cd tgent-app/android
./gradlew assembleDebug
```

生成文件、原生环境和 Release 签名说明见
[客户端开发文档](docs/development.zh-CN.md)。

## 仓库结构

| 目录 | 用途 |
| --- | --- |
| [`shared`](shared) | React、xterm、状态、协议与共享客户端 UI |
| [`tgent-desktop`](tgent-desktop) | Wails v2 桌面壳和操作系统原生能力 |
| [`tgent-app`](tgent-app) | Capacitor Android 壳和原生能力 |
| [`client-go`](client-go) | Go 连接引擎、WebAssembly 和 Android C ABI |

## 参与贡献

欢迎提交 Issue 和 Pull Request。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；提交
使用或集成问题前请阅读 [SUPPORT.md](SUPPORT.md)。

不要在公开 Issue 中提交配对码、密码、Token、内网地址、文件路径或终端内容。安全问题
请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

TGent 客户端源码采用 [GNU Affero General Public License v3.0 only](LICENSE)。开源不
代表所有 TGent 产品或服务都免费提供，详情见[商业许可](COMMERCIAL.md)和
[商标政策](TRADEMARKS.md)。

可选的 TGent 托管连接服务可以帮助不同网络中的 endpoint 互相发现和连接，并可能作为
收费服务提供。
