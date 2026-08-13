package quake

import (
	"math"
	"testing"
)

type fakeWindow struct {
	snapshot          Snapshot
	screen            Screen
	bounds            Rect
	visible           bool
	onTop             bool
	maximised         bool
	fullscreen        bool
	prepared          int
	presented         int
	restored          int
	shown             int
	detached          bool
	setBounds         int
	quakeHeight       int
	quakeScreenHeight int
	quakeHeightOK     bool
}

func (w *fakeWindow) Snapshot() Snapshot    { return w.snapshot }
func (w *fakeWindow) CurrentScreen() Screen { return w.screen }
func (w *fakeWindow) Unmaximise()           { w.maximised = false }
func (w *fakeWindow) Unfullscreen()         { w.fullscreen = false }
func (w *fakeWindow) Maximise()             { w.maximised = true }
func (w *fakeWindow) Fullscreen()           { w.fullscreen = true }
func (w *fakeWindow) SetAlwaysOnTop(v bool) { w.onTop = v }
func (w *fakeWindow) PrepareQuake() bool    { w.prepared++; return w.detached }
func (w *fakeWindow) ShowQuake()            { w.presented++; w.visible = true }
func (w *fakeWindow) RestoreNormal()        { w.restored++ }
func (w *fakeWindow) SetBounds(bounds Rect) { w.setBounds++; w.bounds = bounds }
func (w *fakeWindow) QuakeHeight() (int, int, bool) {
	return w.quakeHeight, w.quakeScreenHeight, w.quakeHeightOK
}
func (w *fakeWindow) Show() { w.shown++; w.visible = true }
func (w *fakeWindow) Hide() { w.visible = false }

func TestToggleQuakeAndRestoreNormalWindow(t *testing.T) {
	normal := Rect{X: 120, Y: 80, Width: 1280, Height: 800}
	window := &fakeWindow{
		snapshot: Snapshot{Bounds: normal, Maximised: true},
		screen:   Screen{X: 1920, Y: 0, Width: 1920, Height: 1080},
		visible:  true,
	}
	controller := New(window, DefaultSettings())

	state := controller.Toggle()
	wantQuake := Rect{X: 1920, Y: 0, Width: 1920, Height: 486}
	if state.Bounds != wantQuake || window.bounds != wantQuake {
		t.Fatalf("quake bounds = %+v, want %+v", state.Bounds, wantQuake)
	}
	if !state.Active || !state.Visible || !window.onTop {
		t.Fatalf("unexpected quake state: %+v", state)
	}
	if window.prepared != 1 || window.presented != 1 {
		t.Fatalf("Quake window was not prepared and presented: %+v", window)
	}
	if window.shown != 0 {
		t.Fatalf("Quake window used the normal show path: %+v", window)
	}

	state = controller.Toggle()
	if state.Visible || window.visible {
		t.Fatalf("second toggle should hide the quake window: %+v", state)
	}

	state = controller.ShowNormal()
	if state.Active || !state.Visible || window.bounds != normal {
		t.Fatalf("normal window was not restored: state=%+v bounds=%+v", state, window.bounds)
	}
	if !window.maximised || window.onTop {
		t.Fatalf("normal window flags were not restored")
	}
	if window.restored != 1 {
		t.Fatalf("normal Space behavior was not restored")
	}
}

func TestQuakeReappearsOnCurrentCursorScreen(t *testing.T) {
	window := &fakeWindow{
		snapshot: Snapshot{Bounds: Rect{Width: 1200, Height: 800}},
		screen:   Screen{Width: 1728, Height: 1117},
	}
	controller := New(window, DefaultSettings())

	controller.Show()
	controller.Hide()
	window.screen = Screen{X: 1728, Y: -120, Width: 2560, Height: 1440}
	state := controller.Show()

	want := Rect{X: 1728, Y: -120, Width: 2560, Height: 648}
	if state.Bounds != want {
		t.Fatalf("Quake bounds after moving cursor = %+v, want %+v", state.Bounds, want)
	}
	if window.prepared != 2 || window.presented != 2 {
		t.Fatalf("Quake window was not moved to the current Space on re-show: %+v", window)
	}
}

func TestQuakeHeightIsClampedToScreen(t *testing.T) {
	window := &fakeWindow{
		snapshot: Snapshot{Bounds: Rect{Width: 800, Height: 600}},
		screen:   Screen{Width: 1000, Height: 300},
	}
	controller := New(window, Settings{HeightRatio: 0.2, MinHeight: 360, AlwaysOnTop: true})

	state := controller.Show()
	if state.Bounds.Height != 300 {
		t.Fatalf("height = %d, want 300", state.Bounds.Height)
	}
}

func TestShowNormalIsIdempotentInNormalMode(t *testing.T) {
	window := &fakeWindow{
		snapshot:   Snapshot{Bounds: Rect{Width: 1400, Height: 900}, Maximised: true, Fullscreen: true},
		maximised:  true,
		fullscreen: true,
	}
	controller := New(window, DefaultSettings())

	state := controller.ShowNormal()

	if state.Active || !state.Visible {
		t.Fatalf("unexpected normal state: %+v", state)
	}
	if !window.maximised || !window.fullscreen {
		t.Fatalf("ShowNormal changed the existing normal window state: %+v", window)
	}
	if window.restored != 0 || window.setBounds != 0 || window.shown != 1 {
		t.Fatalf("ShowNormal performed an unnecessary mode transition: %+v", window)
	}
}

func TestQuakeRemembersUserResizedHeight(t *testing.T) {
	window := &fakeWindow{
		snapshot:          Snapshot{Bounds: Rect{Width: 1200, Height: 800}},
		screen:            Screen{Width: 1920, Height: 1080},
		quakeHeight:       700,
		quakeScreenHeight: 1080,
		quakeHeightOK:     true,
	}
	controller := New(window, DefaultSettings())

	controller.Show()
	state := controller.Toggle()
	if state.Visible {
		t.Fatal("Quake window should be hidden")
	}
	if state.Bounds.Height != 700 {
		t.Fatalf("captured height = %d, want 700", state.Bounds.Height)
	}

	state = controller.Show()
	if state.Bounds.Height != 700 || window.bounds.Height != 700 {
		t.Fatalf("restored height = %d, window height = %d, want 700", state.Bounds.Height, window.bounds.Height)
	}
	wantRatio := 700.0 / 1080.0
	if math.Abs(state.Settings.HeightRatio-wantRatio) > 0.000001 {
		t.Fatalf("height ratio = %f, want %f", state.Settings.HeightRatio, wantRatio)
	}
}

func TestDetachedQuakePreservesNativeFullscreenWindow(t *testing.T) {
	window := &fakeWindow{
		snapshot:   Snapshot{Bounds: Rect{X: 80, Y: 40, Width: 1400, Height: 900}, Maximised: true, Fullscreen: true},
		screen:     Screen{Width: 1728, Height: 1117},
		maximised:  true,
		fullscreen: true,
		detached:   true,
	}
	controller := New(window, DefaultSettings())

	controller.Show()
	if !window.maximised || !window.fullscreen {
		t.Fatalf("detached Quake changed the normal window state: %+v", window)
	}
	if window.setBounds != 1 {
		t.Fatalf("detached Quake bounds calls = %d, want 1", window.setBounds)
	}

	controller.ShowNormal()
	if window.setBounds != 1 {
		t.Fatalf("normal bounds were reapplied to detached window: %d", window.setBounds)
	}
	if !window.maximised || !window.fullscreen {
		t.Fatalf("restoring detached Quake changed the normal window state: %+v", window)
	}
}
