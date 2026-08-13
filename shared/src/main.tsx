import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import PageTransition from './components/PageTransition'
// import NetworkBanner from './components/NetworkBanner'
import Toast from './components/Toast'
import UpdateChecker from './components/UpdateChecker'
import { AppProvider } from './contexts/AppContext'
import { applyWailsQuakePreferences, isNativeApp, isWailsApp } from './lib/platform'
import { loadDesktopSettings, saveDesktopQuakeHeightRatio } from './lib/desktopSettings'
import { isDesktopTarget } from './lib/runtimeTarget'
import { applyTheme, getTheme, loadThemeId } from './lib/themes'
import './index.css'
import './desktop-runtime.css'

// 应用启动时异步设置 CSS 变量
loadThemeId().then(id => applyTheme(getTheme(id)))

if (isDesktopTarget) {
  document.documentElement.classList.add('is-wails-desktop')
  // A fresh desktop process must resolve its startup terminal again. WebKit
  // can restore the last hash (including a remote endpoint), which would skip
  // HomePage's local-daemon discovery entirely.
  if (isWailsApp() && window.location.hash !== '#/' && window.location.hash !== '#') {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`)
  }
  const desktopEventsOn = (window as any).runtime?.EventsOn
  desktopEventsOn?.('desktop:quake-changed', (state: any) => {
    const heightRatio = state?.settings?.heightRatio
    if (typeof heightRatio === 'number') {
      void saveDesktopQuakeHeightRatio(heightRatio)
    }
  })
  void loadDesktopSettings()
    .then(settings => applyWailsQuakePreferences(settings.quake))
    .catch(() => {})
}

// 原生 App 启动时配置 StatusBar + 返回键
if (!isDesktopTarget && isNativeApp()) {
  import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
    StatusBar.setOverlaysWebView({ overlay: false })
    StatusBar.setStyle({ style: Style.Dark })
    StatusBar.setBackgroundColor({ color: '#030712' })
  }).catch(() => {})

  // 拦截 Android 返回手势/按键：
  // 子页面通过 useAppBack hook 监听 popstate 实现逻辑返回，
  // 这里只需触发 history.back()；首页则双击退出 App。
  import('@capacitor/app').then(({ App }) => {
    let lastBackTime = 0
    App.addListener('backButton', () => {
      const hash = window.location.hash
      if (hash && hash !== '#/' && hash !== '#') {
        window.history.back()
      } else {
        const now = Date.now()
        if (now - lastBackTime < 500) {
          App.exitApp()
        } else {
          lastBackTime = now
          // 通过 EventBus 显示提示
          import('./state/EventBus').then(({ eventBus }) => {
            eventBus.emit('toast:show', {
              message: '再按一次退出应用',
              type: 'info',
              duration: 1500,
            })
          })
        }
      }
    })
  }).catch(() => {})
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <AppProvider>
        {/* <NetworkBanner /> */}
        <Toast />
        <UpdateChecker />
        <PageTransition />
      </AppProvider>
    </HashRouter>
  </React.StrictMode>,
)
