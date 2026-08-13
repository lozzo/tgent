package main

import (
	"errors"
	"testing"

	"github.com/lozzo/tgent-client/tgent-desktop/internal/globalhotkey"
	"github.com/lozzo/tgent-client/tgent-desktop/internal/quake"
)

type fakeHotkeyRegistration struct {
	closed bool
}

func (r *fakeHotkeyRegistration) Close() { r.closed = true }

type quakeSettingsWindow struct {
	bounds      quake.Rect
	alwaysOnTop bool
	restored    int
	shown       int
	hidden      int
}

func (w *quakeSettingsWindow) Snapshot() quake.Snapshot {
	return quake.Snapshot{Bounds: quake.Rect{X: 40, Y: 60, Width: 1200, Height: 800}}
}

func (w *quakeSettingsWindow) CurrentScreen() quake.Screen {
	return quake.Screen{Width: 1600, Height: 1000}
}

func (w *quakeSettingsWindow) Unmaximise()            {}
func (w *quakeSettingsWindow) Unfullscreen()          {}
func (w *quakeSettingsWindow) Maximise()              {}
func (w *quakeSettingsWindow) Fullscreen()            {}
func (w *quakeSettingsWindow) SetAlwaysOnTop(on bool) { w.alwaysOnTop = on }
func (w *quakeSettingsWindow) PrepareQuake() bool     { return false }
func (w *quakeSettingsWindow) ShowQuake()             {}
func (w *quakeSettingsWindow) RestoreNormal()         { w.restored++ }
func (w *quakeSettingsWindow) SetBounds(bounds quake.Rect) {
	w.bounds = bounds
}
func (w *quakeSettingsWindow) QuakeHeight() (int, int, bool) { return 0, 0, false }
func (w *quakeSettingsWindow) Show()                         { w.shown++ }
func (w *quakeSettingsWindow) Hide()                         { w.hidden++ }

func TestBeforeCloseHidesWindowAndKeepsProcessAlive(t *testing.T) {
	window := &quakeSettingsWindow{}
	controller := quake.New(window, quake.DefaultSettings())
	app := &App{quake: controller}

	if cancelTermination := app.beforeClose(nil); !cancelTermination {
		t.Fatal("beforeClose allowed the application to terminate")
	}
	if window.hidden != 1 {
		t.Fatalf("window hide calls = %d, want 1", window.hidden)
	}
	if state := controller.State(); state.Visible {
		t.Fatalf("controller still reports a visible window: %+v", state)
	}
}

func TestOpenSettingsRestoresNormalWindow(t *testing.T) {
	window := &quakeSettingsWindow{}
	controller := quake.New(window, quake.DefaultSettings())
	controller.Show()
	app := &App{quake: controller}

	app.OpenSettings()

	if state := controller.State(); state.Active {
		t.Fatalf("OpenSettings left Quake active: %+v", state)
	}
	if window.restored != 1 || window.shown != 1 {
		t.Fatalf("normal window was not restored: restored=%d shown=%d", window.restored, window.shown)
	}
}

func TestSetQuakeEnabledFalseRestoresNormalWindow(t *testing.T) {
	window := &quakeSettingsWindow{}
	controller := quake.New(window, quake.DefaultSettings())
	controller.Show()
	app := &App{quake: controller, quakeEnabled: true}

	status, err := app.SetQuakeEnabled(false)
	if err != nil {
		t.Fatalf("disable Quake Mode: %v", err)
	}
	if status.QuakeEnabled || status.HotkeyAvailable {
		t.Fatalf("unexpected desktop status after disable: %+v", status)
	}
	if status.Quake.Active {
		t.Fatalf("Quake window remained active after disable: %+v", status.Quake)
	}
	if window.alwaysOnTop {
		t.Fatal("normal window remained always on top")
	}
	if window.bounds != (quake.Rect{X: 40, Y: 60, Width: 1200, Height: 800}) {
		t.Fatalf("normal bounds = %+v", window.bounds)
	}
}

func TestSetQuakeShortcutKeepsPreviousRegistrationOnFailure(t *testing.T) {
	previous := &fakeHotkeyRegistration{}
	app := &App{
		quakeEnabled:  true,
		quakeShortcut: globalhotkey.DefaultShortcut,
		hotkey:        previous,
		hotkeyRegistrar: func(string, func()) (hotkeyRegistration, error) {
			return nil, errors.New("shortcut already registered")
		},
	}

	status, err := app.SetQuakeShortcut("Control+K")
	if err == nil {
		t.Fatal("SetQuakeShortcut unexpectedly succeeded")
	}
	if previous.closed {
		t.Fatal("previous registration was closed after replacement failed")
	}
	if status.QuakeShortcut != globalhotkey.DefaultShortcut || !status.HotkeyAvailable {
		t.Fatalf("status changed after replacement failed: %+v", status)
	}
}

func TestSetQuakeShortcutSwapsRegistrationAfterSuccess(t *testing.T) {
	previous := &fakeHotkeyRegistration{}
	replacement := &fakeHotkeyRegistration{}
	app := &App{
		quakeEnabled:  true,
		quakeShortcut: globalhotkey.DefaultShortcut,
		hotkey:        previous,
		hotkeyRegistrar: func(shortcut string, _ func()) (hotkeyRegistration, error) {
			if shortcut != "Control+Shift+K" {
				t.Fatalf("registered shortcut = %q", shortcut)
			}
			return replacement, nil
		},
	}

	status, err := app.SetQuakeShortcut("Control+Shift+k")
	if err != nil {
		t.Fatalf("SetQuakeShortcut: %v", err)
	}
	if !previous.closed {
		t.Fatal("previous registration remained active after replacement succeeded")
	}
	if replacement.closed {
		t.Fatal("replacement registration was closed")
	}
	if status.QuakeShortcut != "Control+Shift+K" || !status.HotkeyAvailable {
		t.Fatalf("unexpected status after replacement: %+v", status)
	}
}
