# TGent Desktop

Wails v2.12 desktop shell for the shared TGent React client and native Go
connection engine. The desktop app discovers and connects to a separately
installed TGent endpoint; it does not bundle or launch endpoint/server code.

## Development

Install Wails v2.12 and run from the repository root:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
make dev-desktop
```

The global Quake shortcut is `Ctrl+\``. macOS uses the native Carbon hotkey API
and does not require Accessibility/Input Monitoring permission. Linux global
shortcuts currently require an X11 session; the app remains usable when
registration is not available.

## Build

```bash
make build-desktop
```
