package main

import (
	"embed"
	goruntime "runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	linuxoptions "github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func applicationMenu(app *App) *menu.Menu {
	if goruntime.GOOS != "darwin" {
		return nil
	}

	terminalMenu := menu.NewMenu()
	// The accelerator is managed by the configurable frontend command layer.
	// Keeping a native Cmd+, here would leave the old binding active after the
	// user changes it in Settings.
	terminalMenu.AddText("Settings...", nil, func(*menu.CallbackData) {
		app.OpenSettings()
	})

	return menu.NewMenuFromItems(
		menu.AppMenu(),
		menu.SubMenu("Terminal", terminalMenu),
		menu.EditMenu(),
		menu.WindowMenu(),
	)
}

func main() {
	app := NewApp()
	err := wails.Run(&options.App{
		Title:     "TGent",
		Width:     1440,
		Height:    900,
		MinWidth:  980,
		MinHeight: 680,
		// Route every close request through beforeClose so the Quake controller
		// stays in sync with the native window visibility on every platform.
		HideWindowOnClose: false,
		Menu:              applicationMenu(app),
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 9, G: 10, B: 12, A: 0},
		OnStartup:        app.startup,
		OnDomReady:       app.domReady,
		OnBeforeClose:    app.beforeClose,
		OnShutdown:       app.shutdown,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "com.tgent.desktop",
			OnSecondInstanceLaunch: func(options.SecondInstanceData) {
				_, _ = app.ShowNormal()
			},
		},
		Mac: &mac.Options{
			TitleBar:             mac.TitleBarHiddenInset(),
			Appearance:           mac.NSAppearanceNameDarkAqua,
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
		},
		Windows: &windows.Options{
			Theme:                windows.Dark,
			BackdropType:         windows.Mica,
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
		},
		Linux: &linuxoptions.Options{
			WindowIsTranslucent: true,
			WebviewGpuPolicy:    linuxoptions.WebviewGpuPolicyOnDemand,
		},
		Bind: []interface{}{app},
	})
	if err != nil {
		println("TGent desktop failed:", err.Error())
	}
}
