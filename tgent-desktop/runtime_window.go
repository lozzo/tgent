package main

import (
	"context"
	"math"

	"github.com/lozzo/tgent/tgent-desktop/internal/quake"
	"github.com/lozzo/tgent/tgent-desktop/internal/screenbounds"
	"github.com/lozzo/tgent/tgent-desktop/internal/windowspace"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type runtimeWindow struct {
	ctx context.Context
}

func newRuntimeWindow(ctx context.Context) *runtimeWindow {
	return &runtimeWindow{ctx: ctx}
}

func (w *runtimeWindow) Snapshot() quake.Snapshot {
	x, y := runtime.WindowGetPosition(w.ctx)
	width, height := runtime.WindowGetSize(w.ctx)
	return quake.Snapshot{
		Bounds:     quake.Rect{X: x, Y: y, Width: width, Height: height},
		Maximised:  runtime.WindowIsMaximised(w.ctx),
		Fullscreen: runtime.WindowIsFullscreen(w.ctx),
	}
}

func (w *runtimeWindow) CurrentScreen() quake.Screen {
	if bounds, ok := screenbounds.UnderCursor(); ok {
		return quake.Screen{
			X:      bounds.X,
			Y:      bounds.Y,
			Width:  bounds.Width,
			Height: bounds.Height,
		}
	}

	x, y := runtime.WindowGetPosition(w.ctx)
	width, height := runtime.WindowGetSize(w.ctx)
	screens, err := runtime.ScreenGetAll(w.ctx)
	if err != nil || len(screens) == 0 {
		return quake.Screen{X: x, Y: y, Width: max(width, 1024), Height: max(height, 768)}
	}

	selected := screens[0]
	for _, screen := range screens {
		if screen.IsCurrent {
			selected = screen
			break
		}
		if screen.IsPrimary {
			selected = screen
		}
	}
	screenWidth := selected.Size.Width
	screenHeight := selected.Size.Height
	if screenWidth <= 0 {
		screenWidth = selected.Width
	}
	if screenHeight <= 0 {
		screenHeight = selected.Height
	}
	if screenWidth <= 0 || screenHeight <= 0 {
		return quake.Screen{X: x, Y: y, Width: max(width, 1024), Height: max(height, 768)}
	}

	centerX := x + width/2
	centerY := y + height/2
	return quake.Screen{
		X:      alignedScreenOrigin(centerX, screenWidth),
		Y:      alignedScreenOrigin(centerY, screenHeight),
		Width:  screenWidth,
		Height: screenHeight,
	}
}

func (w *runtimeWindow) Unmaximise()           { runtime.WindowUnmaximise(w.ctx) }
func (w *runtimeWindow) Unfullscreen()         { runtime.WindowUnfullscreen(w.ctx) }
func (w *runtimeWindow) Maximise()             { runtime.WindowMaximise(w.ctx) }
func (w *runtimeWindow) Fullscreen()           { runtime.WindowFullscreen(w.ctx) }
func (w *runtimeWindow) SetAlwaysOnTop(v bool) { runtime.WindowSetAlwaysOnTop(w.ctx, v) }
func (w *runtimeWindow) PrepareQuake() bool    { return windowspace.Prepare() }
func (w *runtimeWindow) ShowQuake() {
	if windowspace.Present() {
		return
	}
	runtime.WindowUnminimise(w.ctx)
	runtime.WindowShow(w.ctx)
}
func (w *runtimeWindow) RestoreNormal() { windowspace.Restore() }
func (w *runtimeWindow) Show()          { runtime.WindowUnminimise(w.ctx); runtime.WindowShow(w.ctx) }
func (w *runtimeWindow) QuakeHeight() (int, int, bool) {
	if height, screenHeight, ok := windowspace.Height(); ok {
		return height, screenHeight, true
	}
	height := w.Snapshot().Bounds.Height
	screenHeight := w.CurrentScreen().Height
	return height, screenHeight, height > 0 && screenHeight > 0
}
func (w *runtimeWindow) Hide() {
	if windowspace.Hide() {
		return
	}
	runtime.WindowHide(w.ctx)
}

func (w *runtimeWindow) SetBounds(bounds quake.Rect) {
	if windowspace.SetBounds(bounds.X, bounds.Y, bounds.Width, bounds.Height) {
		return
	}
	runtime.WindowSetSize(w.ctx, bounds.Width, bounds.Height)
	runtime.WindowSetPosition(w.ctx, bounds.X, bounds.Y)
}

func alignedScreenOrigin(point, screenSize int) int {
	return int(math.Floor(float64(point)/float64(screenSize))) * screenSize
}
