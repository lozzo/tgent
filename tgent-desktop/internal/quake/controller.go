package quake

import (
	"math"
	"sync"
)

type Rect struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type Screen struct {
	X      int
	Y      int
	Width  int
	Height int
}

type Snapshot struct {
	Bounds     Rect
	Maximised  bool
	Fullscreen bool
}

type Window interface {
	Snapshot() Snapshot
	CurrentScreen() Screen
	Unmaximise()
	Unfullscreen()
	Maximise()
	Fullscreen()
	SetAlwaysOnTop(bool)
	PrepareQuake() bool
	ShowQuake()
	RestoreNormal()
	SetBounds(Rect)
	QuakeHeight() (height int, screenHeight int, ok bool)
	Show()
	Hide()
}

type Settings struct {
	HeightRatio float64 `json:"heightRatio"`
	MinHeight   int     `json:"minHeight"`
	AlwaysOnTop bool    `json:"alwaysOnTop"`
}

func DefaultSettings() Settings {
	return Settings{
		HeightRatio: 0.45,
		MinHeight:   360,
		AlwaysOnTop: true,
	}
}

type State struct {
	Active   bool     `json:"active"`
	Visible  bool     `json:"visible"`
	Bounds   Rect     `json:"bounds"`
	Settings Settings `json:"settings"`
}

type Controller struct {
	mu sync.Mutex

	window      Window
	settings    Settings
	normal      Snapshot
	hasNormal   bool
	active      bool
	visible     bool
	detached    bool
	quakeBounds Rect
}

func New(window Window, settings Settings) *Controller {
	settings = normaliseSettings(settings)
	return &Controller{
		window:   window,
		settings: settings,
		visible:  true,
	}
}

func (c *Controller) Toggle() State {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.active && c.visible {
		c.captureQuakeHeightLocked()
		c.window.Hide()
		c.visible = false
		return c.stateLocked()
	}
	c.showLocked()
	return c.stateLocked()
}

func (c *Controller) Show() State {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.showLocked()
	return c.stateLocked()
}

func (c *Controller) Hide() State {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.captureQuakeHeightLocked()
	c.window.Hide()
	c.visible = false
	return c.stateLocked()
}

func (c *Controller) MarkHidden() State {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.captureQuakeHeightLocked()
	c.visible = false
	return c.stateLocked()
}

func (c *Controller) ShowNormal() State {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.active {
		c.window.Show()
		c.visible = true
		return c.stateLocked()
	}
	c.captureQuakeHeightLocked()

	if !c.detached {
		c.window.Unfullscreen()
		c.window.Unmaximise()
	}
	c.window.SetAlwaysOnTop(false)
	c.window.RestoreNormal()
	if c.hasNormal && !c.detached {
		c.window.SetBounds(c.normal.Bounds)
	}
	c.window.Show()
	if c.hasNormal && !c.detached && c.normal.Maximised {
		c.window.Maximise()
	}
	if c.hasNormal && !c.detached && c.normal.Fullscreen {
		c.window.Fullscreen()
	}

	c.active = false
	c.visible = true
	c.hasNormal = false
	c.detached = false
	c.quakeBounds = Rect{}
	return c.stateLocked()
}

func (c *Controller) State() State {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.stateLocked()
}

func (c *Controller) UpdateSettings(settings Settings) State {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.settings = normaliseSettings(settings)
	if c.active && c.visible {
		c.applyQuakeBoundsLocked()
	}
	return c.stateLocked()
}

func (c *Controller) showLocked() {
	if !c.active {
		c.normal = c.window.Snapshot()
		c.hasNormal = true
	}
	c.detached = c.window.PrepareQuake()
	if !c.detached {
		c.window.Unfullscreen()
		c.window.Unmaximise()
		c.window.SetAlwaysOnTop(c.settings.AlwaysOnTop)
	}
	c.applyQuakeBoundsLocked()
	c.window.ShowQuake()
	c.active = true
	c.visible = true
}

func (c *Controller) applyQuakeBoundsLocked() {
	screen := c.window.CurrentScreen()
	height := int(math.Round(float64(screen.Height) * c.settings.HeightRatio))
	if height < c.settings.MinHeight {
		height = c.settings.MinHeight
	}
	if height > screen.Height {
		height = screen.Height
	}
	c.quakeBounds = Rect{
		X:      screen.X,
		Y:      screen.Y,
		Width:  screen.Width,
		Height: height,
	}
	c.window.SetBounds(c.quakeBounds)
}

func (c *Controller) captureQuakeHeightLocked() {
	if !c.active || !c.visible {
		return
	}
	height, screenHeight, ok := c.window.QuakeHeight()
	if !ok || height <= 0 || screenHeight <= 0 {
		return
	}
	if height < c.settings.MinHeight {
		height = c.settings.MinHeight
	}
	if height > screenHeight {
		height = screenHeight
	}
	c.settings.HeightRatio = float64(height) / float64(screenHeight)
	c.quakeBounds.Height = height
}

func (c *Controller) stateLocked() State {
	return State{
		Active:   c.active,
		Visible:  c.visible,
		Bounds:   c.quakeBounds,
		Settings: c.settings,
	}
}

func normaliseSettings(settings Settings) Settings {
	if settings.HeightRatio <= 0 || settings.HeightRatio > 1 {
		settings.HeightRatio = DefaultSettings().HeightRatio
	}
	if settings.MinHeight <= 0 {
		settings.MinHeight = DefaultSettings().MinHeight
	}
	return settings
}
