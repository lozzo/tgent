package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/lozzo/tgent/client-go/clientcore"
	"github.com/lozzo/tgent/tgent-desktop/internal/clipboardimage"
	"github.com/lozzo/tgent/tgent-desktop/internal/globalhotkey"
	"github.com/lozzo/tgent/tgent-desktop/internal/quake"
	"github.com/lozzo/tgent/tgent-desktop/internal/windowpulse"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type DesktopStatus struct {
	EngineReady      bool        `json:"engineReady"`
	Provider         string      `json:"provider"`
	QuakeEnabled     bool        `json:"quakeEnabled"`
	QuakeShortcut    string      `json:"quakeShortcut"`
	HotkeyAvailable  bool        `json:"hotkeyAvailable"`
	HotkeyError      string      `json:"hotkeyError,omitempty"`
	LocalDaemon      string      `json:"localDaemon"`
	LocalDaemonError string      `json:"localDaemonError,omitempty"`
	Quake            quake.State `json:"quake"`
}

type ClipboardImage struct {
	LocalPath string `json:"localPath"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	Data      string `json:"data"`
}

type TerminalClipboard struct {
	Kind  string         `json:"kind"`
	Text  string         `json:"text,omitempty"`
	Image ClipboardImage `json:"image,omitempty"`
}

type hotkeyRegistration interface {
	Close()
}

type hotkeyRegistrar func(string, func()) (hotkeyRegistration, error)

type App struct {
	mu             sync.RWMutex
	hotkeyChangeMu sync.Mutex

	ctx             context.Context
	engine          *clientcore.Engine
	engineErr       error
	quake           *quake.Controller
	quakeEnabled    bool
	quakeShortcut   string
	hotkey          hotkeyRegistration
	hotkeyRegistrar hotkeyRegistrar
	hotkeyErr       error
	localDaemon     string
	localDaemonErr  error
}

func NewApp() *App {
	engine, err := clientcore.NewEngine()
	return &App{
		engine:        engine,
		engineErr:     err,
		localDaemon:   "checking",
		quakeEnabled:  true,
		quakeShortcut: globalhotkey.DefaultShortcut,
		hotkeyRegistrar: func(shortcut string, onTriggered func()) (hotkeyRegistration, error) {
			return globalhotkey.Register(shortcut, onTriggered)
		},
	}
}

func (a *App) startup(ctx context.Context) {
	a.mu.Lock()
	a.ctx = ctx
	a.quake = quake.New(newRuntimeWindow(ctx), quake.DefaultSettings())
	a.mu.Unlock()
	go a.refreshLocalTGentState()
}

func (a *App) refreshLocalTGentState() {
	access := a.GetLocalTGentAccess()
	state := "unavailable"
	if access.Found {
		state = "external"
	}
	a.setLocalDaemonState(state, nil)
}

func (a *App) setLocalDaemonState(state string, err error) {
	a.mu.Lock()
	a.localDaemon = state
	a.localDaemonErr = err
	ctx := a.ctx
	a.mu.Unlock()
	if ctx != nil {
		if err != nil {
			wailsruntime.LogErrorf(ctx, "local TGent endpoint unavailable: %v", err)
		}
		wailsruntime.EventsEmit(ctx, "desktop:status", a.Status())
	}
}

func (a *App) domReady(ctx context.Context) {
	err := a.setQuakeHotkeyEnabled(true)
	if err != nil {
		wailsruntime.LogWarningf(ctx, "global Quake shortcut unavailable: %v", err)
	}
	wailsruntime.EventsEmit(ctx, "desktop:status", a.Status())
}

func (a *App) setQuakeHotkeyEnabled(enabled bool) error {
	a.hotkeyChangeMu.Lock()
	defer a.hotkeyChangeMu.Unlock()

	a.mu.RLock()
	previous := a.hotkey
	shortcut := a.quakeShortcut
	registrar := a.hotkeyRegistrar
	a.mu.RUnlock()
	if shortcut == "" {
		shortcut = globalhotkey.DefaultShortcut
	}
	if registrar == nil {
		registrar = func(shortcut string, onTriggered func()) (hotkeyRegistration, error) {
			return globalhotkey.Register(shortcut, onTriggered)
		}
	}

	if !enabled {
		a.mu.Lock()
		a.hotkey = nil
		a.hotkeyErr = nil
		a.quakeEnabled = false
		a.mu.Unlock()
		if previous != nil {
			previous.Close()
		}
		return nil
	}
	if previous != nil {
		a.mu.Lock()
		a.quakeEnabled = true
		a.hotkeyErr = nil
		a.mu.Unlock()
		return nil
	}

	registration, err := registrar(shortcut, func() {
		if _, toggleErr := a.ToggleQuake(); toggleErr != nil {
			a.mu.RLock()
			ctx := a.ctx
			a.mu.RUnlock()
			if ctx != nil {
				wailsruntime.LogErrorf(ctx, "toggle Quake window: %v", toggleErr)
			}
		}
	})
	a.mu.Lock()
	a.hotkey = registration
	a.hotkeyErr = err
	a.quakeEnabled = true
	a.quakeShortcut = shortcut
	a.mu.Unlock()
	return err
}

func (a *App) shutdown(context.Context) {
	a.hotkeyChangeMu.Lock()
	a.mu.Lock()
	registration := a.hotkey
	a.hotkey = nil
	engine := a.engine
	a.engine = nil
	a.mu.Unlock()

	if registration != nil {
		registration.Close()
	}
	a.hotkeyChangeMu.Unlock()
	if engine != nil {
		engine.Close()
	}
}

func (a *App) beforeClose(context.Context) bool {
	a.mu.RLock()
	controller := a.quake
	ctx := a.ctx
	a.mu.RUnlock()
	if controller != nil {
		state := controller.Hide()
		if ctx != nil {
			wailsruntime.EventsEmit(ctx, "desktop:quake-changed", state)
		}
	}
	// Cancelling native termination keeps the engine and global Quake hotkey
	// alive. The controller has already hidden the window above.
	return true
}

func (a *App) BridgePort() (int, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.engineErr != nil {
		return 0, a.engineErr
	}
	if a.engine == nil {
		return 0, errors.New("desktop Go engine is unavailable")
	}
	return a.engine.BridgePort(), nil
}

func (a *App) Command(payload string) (string, error) {
	a.mu.RLock()
	engine := a.engine
	engineErr := a.engineErr
	a.mu.RUnlock()
	if engineErr != nil {
		return "", engineErr
	}
	if engine == nil {
		return "", errors.New("desktop Go engine is unavailable")
	}
	if isLocalConnectCommand(payload) {
		payload = injectLocalTGentAccess(payload, a.GetLocalTGentAccess())
	}
	result, err := engine.Command([]byte(payload))
	return string(result), err
}

func isLocalConnectCommand(payload string) bool {
	var header struct {
		Action     string `json:"action"`
		ServerType string `json:"serverType"`
	}
	return json.Unmarshal([]byte(payload), &header) == nil && header.Action == "connect" && header.ServerType == "local"
}

func injectLocalTGentAccess(payload string, access LocalTGentAccess) string {
	if !access.Found {
		return payload
	}
	var envelope map[string]any
	if json.Unmarshal([]byte(payload), &envelope) != nil || envelope["action"] != "connect" || envelope["serverType"] != "local" {
		return payload
	}
	localServer, ok := envelope["localServer"].(map[string]any)
	if !ok {
		return payload
	}
	targetAddress, _ := localServer["addr"].(string)
	targetSocket, _ := localServer["socketPath"].(string)
	socketMatches := access.SocketPath != "" && targetSocket == access.SocketPath
	if !socketMatches && !sameLocalTGentAddress(targetAddress, access.Address) {
		return payload
	}
	if access.Address != "" && targetAddress == "" {
		localServer["addr"] = access.Address
	}
	if access.SocketAvailable && access.SocketPath != "" {
		localServer["socketPath"] = access.SocketPath
		localServer["password"] = ""
	} else if access.AuthEnabled && access.WebPassword != "" {
		localServer["password"] = access.WebPassword
	}
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return payload
	}
	return string(encoded)
}

func (a *App) NextEvent() (string, error) {
	a.mu.RLock()
	engine := a.engine
	engineErr := a.engineErr
	a.mu.RUnlock()
	if engineErr != nil {
		return "", engineErr
	}
	if engine == nil {
		return "", errors.New("desktop Go engine is unavailable")
	}
	// This is a blocking poll: queued events still return immediately. A longer
	// idle timeout avoids crossing the Wails JS/Go bridge four times per second.
	event, err := engine.NextEvent(2 * time.Second)
	return string(event), err
}

func (a *App) OpenSettings() {
	_, _ = a.ShowNormal()
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx == nil {
		return
	}
	wailsruntime.EventsEmit(ctx, "desktop:open-settings")
}

// PulseTerminalSurface forces WKWebView to commit a newly hydrated WebGL terminal.
func (a *App) PulseTerminalSurface() {
	windowpulse.Pulse()
}

// SaveClipboardImage stores a native clipboard image in a private temporary PNG.
func (a *App) SaveClipboardImage() (string, error) {
	return clipboardimage.Save()
}

// ReadClipboardImage returns the native clipboard image together with the
// bytes needed to upload it when the active terminal belongs to another host.
func (a *App) ReadClipboardImage() (ClipboardImage, error) {
	path, err := clipboardimage.Save()
	if err != nil || path == "" {
		return ClipboardImage{}, err
	}
	return readClipboardImage(path)
}

// ReadTerminalClipboard classifies one native pasteboard snapshot. Explicit
// image bytes win over accompanying source URLs; otherwise URL/text content is
// returned verbatim for terminal paste.
func (a *App) ReadTerminalClipboard() (TerminalClipboard, error) {
	path, err := clipboardimage.Save()
	if err != nil {
		return TerminalClipboard{}, err
	}
	if path != "" {
		image, err := readClipboardImage(path)
		if err != nil {
			return TerminalClipboard{}, err
		}
		return TerminalClipboard{Kind: "image", Image: image}, nil
	}
	if text := clipboardimage.ReadText(); text != "" {
		return TerminalClipboard{Kind: "text", Text: text}, nil
	}
	return TerminalClipboard{Kind: "empty"}, nil
}

func readClipboardImage(path string) (ClipboardImage, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return ClipboardImage{}, fmt.Errorf("read clipboard image: %w", err)
	}
	return ClipboardImage{
		LocalPath: path,
		Name:      filepath.Base(path),
		Size:      int64(len(data)),
		Data:      base64.StdEncoding.EncodeToString(data),
	}, nil
}

func (a *App) ToggleQuake() (quake.State, error) {
	a.mu.RLock()
	controller := a.quake
	ctx := a.ctx
	a.mu.RUnlock()
	if controller == nil {
		return quake.State{}, errors.New("desktop window is not ready")
	}
	state := controller.Toggle()
	if ctx != nil {
		wailsruntime.EventsEmit(ctx, "desktop:quake-changed", state)
	}
	return state, nil
}

func (a *App) HideQuake() (quake.State, error) {
	a.mu.RLock()
	controller := a.quake
	ctx := a.ctx
	a.mu.RUnlock()
	if controller == nil {
		return quake.State{}, errors.New("desktop window is not ready")
	}
	state := controller.Hide()
	if ctx != nil {
		wailsruntime.EventsEmit(ctx, "desktop:quake-changed", state)
	}
	return state, nil
}

func (a *App) ShowNormal() (quake.State, error) {
	a.mu.RLock()
	controller := a.quake
	ctx := a.ctx
	a.mu.RUnlock()
	if controller == nil {
		return quake.State{}, errors.New("desktop window is not ready")
	}
	state := controller.ShowNormal()
	if ctx != nil {
		wailsruntime.EventsEmit(ctx, "desktop:quake-changed", state)
	}
	return state, nil
}

func (a *App) UpdateQuakeSettings(settings quake.Settings) (quake.State, error) {
	a.mu.RLock()
	controller := a.quake
	a.mu.RUnlock()
	if controller == nil {
		return quake.State{}, errors.New("desktop window is not ready")
	}
	return controller.UpdateSettings(settings), nil
}

func (a *App) SetQuakeEnabled(enabled bool) (DesktopStatus, error) {
	if !enabled {
		a.mu.RLock()
		controller := a.quake
		ctx := a.ctx
		a.mu.RUnlock()
		if controller != nil && controller.State().Active {
			state := controller.ShowNormal()
			if ctx != nil {
				wailsruntime.EventsEmit(ctx, "desktop:quake-changed", state)
			}
		}
	}
	err := a.setQuakeHotkeyEnabled(enabled)
	status := a.Status()
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx != nil {
		wailsruntime.EventsEmit(ctx, "desktop:status", status)
	}
	return status, err
}

func (a *App) SetQuakeShortcut(shortcut string) (DesktopStatus, error) {
	normalized, err := globalhotkey.Normalize(shortcut)
	if err != nil {
		return a.Status(), err
	}

	a.hotkeyChangeMu.Lock()
	a.mu.RLock()
	current := a.quakeShortcut
	if current == "" {
		current = globalhotkey.DefaultShortcut
	}
	enabled := a.quakeEnabled
	previous := a.hotkey
	registrar := a.hotkeyRegistrar
	a.mu.RUnlock()
	if normalized == current {
		a.hotkeyChangeMu.Unlock()
		return a.Status(), nil
	}
	if registrar == nil {
		registrar = func(shortcut string, onTriggered func()) (hotkeyRegistration, error) {
			return globalhotkey.Register(shortcut, onTriggered)
		}
	}

	var replacement hotkeyRegistration
	if enabled {
		replacement, err = registrar(normalized, func() {
			if _, toggleErr := a.ToggleQuake(); toggleErr != nil {
				a.mu.RLock()
				ctx := a.ctx
				a.mu.RUnlock()
				if ctx != nil {
					wailsruntime.LogErrorf(ctx, "toggle Quake window: %v", toggleErr)
				}
			}
		})
		if err != nil {
			a.hotkeyChangeMu.Unlock()
			return a.Status(), err
		}
	}

	a.mu.Lock()
	a.quakeShortcut = normalized
	a.hotkey = replacement
	a.hotkeyErr = nil
	a.mu.Unlock()
	if previous != nil {
		previous.Close()
	}
	a.hotkeyChangeMu.Unlock()

	status := a.Status()
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx != nil {
		wailsruntime.EventsEmit(ctx, "desktop:status", status)
	}
	return status, nil
}

func (a *App) Status() DesktopStatus {
	a.mu.RLock()
	defer a.mu.RUnlock()
	shortcut := a.quakeShortcut
	if shortcut == "" {
		shortcut = globalhotkey.DefaultShortcut
	}
	status := DesktopStatus{
		EngineReady:     a.engine != nil && a.engineErr == nil,
		Provider:        "tmux",
		QuakeEnabled:    a.quakeEnabled,
		QuakeShortcut:   shortcut,
		HotkeyAvailable: a.hotkey != nil && a.hotkeyErr == nil,
		LocalDaemon:     a.localDaemon,
	}
	if a.hotkeyErr != nil {
		status.HotkeyError = a.hotkeyErr.Error()
	}
	if a.localDaemonErr != nil {
		status.LocalDaemonError = a.localDaemonErr.Error()
	}
	if a.quake != nil {
		status.Quake = a.quake.State()
	}
	return status
}
