import NativeHaptic from '../plugins/nativeHaptic'
import { storage } from './storage'

const WEB_URL_KEY = 'tgent_web_url'
const WEB_TOKEN_KEY = 'tgent_web_token'
const WEB_REFRESH_TOKEN_KEY = 'tgent_web_refresh_token'

export const DEFAULT_WEB_URL = import.meta.env.VITE_WEB_URL || 'https://tgent.omscd.com'

/** 判断是否运行在 Capacitor 原生 App 中 */
export function isNativeApp(): boolean {
  // return true // 硬编码为 true，因为目前只在原生环境下使用
  return !!(window as any).Capacitor?.isNativePlatform?.()
}

/** 判断是否运行在 Wails 桌面容器中 */
export function isWailsApp(): boolean {
  return typeof window !== 'undefined' && !!(window as any).go?.main?.App
}

/** Ask WKWebView to commit its terminal surface without changing window geometry. */
export async function pulseWailsWindowSurface(): Promise<void> {
  if (!isWailsApp()) return
  const nativePulse = (window as any).go?.main?.App?.PulseTerminalSurface
  if (nativePulse) {
    try {
      await nativePulse()
    } catch { /* xterm refresh remains the fallback */ }
  }
}

export interface WailsQuakePreferences {
  enabled: boolean
  shortcut: string
  heightRatio: number
  alwaysOnTop: boolean
}

export interface WailsDesktopStatus {
	engineReady?: boolean
	provider?: string
  quakeEnabled: boolean
  quakeShortcut: string
  hotkeyAvailable: boolean
  hotkeyError?: string
	localDaemon?: 'checking' | 'external' | 'unavailable' | string
	localDaemonError?: string
}

export async function getWailsDesktopStatus(): Promise<WailsDesktopStatus | null> {
  const api = (window as any).go?.main?.App
  if (!api?.Status) return null
  return api.Status()
}

export async function updateWailsQuakeSettings(preferences: WailsQuakePreferences): Promise<void> {
  const api = (window as any).go?.main?.App
  if (!api?.UpdateQuakeSettings) return
  await api.UpdateQuakeSettings({
    heightRatio: preferences.heightRatio,
    minHeight: 360,
    alwaysOnTop: preferences.alwaysOnTop,
  })
}

export async function setWailsQuakeEnabled(enabled: boolean): Promise<WailsDesktopStatus | null> {
  const api = (window as any).go?.main?.App
  if (!api?.SetQuakeEnabled) return null
  return api.SetQuakeEnabled(enabled)
}

export async function setWailsQuakeShortcut(shortcut: string): Promise<WailsDesktopStatus | null> {
  const api = (window as any).go?.main?.App
  if (!api?.SetQuakeShortcut) return null
  return api.SetQuakeShortcut(shortcut)
}

export async function applyWailsQuakePreferences(preferences: WailsQuakePreferences): Promise<WailsDesktopStatus | null> {
  await updateWailsQuakeSettings(preferences)
  let status: WailsDesktopStatus | null = null
  if (!preferences.enabled) {
    status = await setWailsQuakeEnabled(false)
  }
  status = await setWailsQuakeShortcut(preferences.shortcut)
  if (preferences.enabled) {
    status = await setWailsQuakeEnabled(true)
  }
  return status
}

export interface WailsClipboardImage {
  localPath: string
  name: string
  size: number
  data: string
}

export type WailsTerminalClipboard =
  | { kind: 'image'; image: WailsClipboardImage }
  | { kind: 'text'; text: string }
  | { kind: 'empty' }

/** Read native desktop clipboard content, retaining image bytes for remote upload. */
export async function readWailsTerminalClipboard(): Promise<WailsTerminalClipboard> {
  if (!isWailsApp()) return { kind: 'empty' }
  const api = (window as any).go?.main?.App
  if (api?.ReadTerminalClipboard) {
    try {
      const clipboard = await api.ReadTerminalClipboard()
      if (clipboard?.kind === 'image') {
        const image = clipboard.image
        if (image && typeof image.localPath === 'string' && image.localPath && typeof image.data === 'string') {
          return { kind: 'image', image }
        }
      }
      if (clipboard?.kind === 'text' && typeof clipboard.text === 'string' && clipboard.text) {
        return { kind: 'text', text: clipboard.text }
      }
      if (clipboard?.kind === 'empty') return { kind: 'empty' }
    } catch {
      // Older/partial native bridges continue through the compatibility path.
    }
  }
  if (api?.ReadClipboardImage) {
    try {
      const image = await api.ReadClipboardImage()
      if (image && typeof image.localPath === 'string' && image.localPath && typeof image.data === 'string') {
        return { kind: 'image', image }
      }
    } catch {
      // Unsupported or malformed image data must not block the text fallback.
    }
  } else {
    try {
      const imagePath = await api?.SaveClipboardImage?.()
      if (typeof imagePath === 'string' && imagePath) {
        return {
          kind: 'image',
          image: { localPath: imagePath, name: imagePath.split('/').pop() || 'clipboard.png', size: 0, data: '' },
        }
      }
    } catch { /* continue with clipboard text */ }
  }
  const text = await (window as any).runtime?.ClipboardGetText?.()
  return typeof text === 'string' && text ? { kind: 'text', text } : { kind: 'empty' }
}

export async function writeWailsTerminalClipboardText(text: string): Promise<void> {
  if (!isWailsApp() || !text) return
  await (window as any).runtime?.ClipboardSetText?.(text)
}

/** Keep WKWebView's native paste event from also reaching xterm's text handler. */
export function interceptWailsTerminalPaste(event: ClipboardEvent): boolean {
  if (!isWailsApp()) return false
  event.preventDefault()
  event.stopImmediatePropagation()
  return true
}

/** Coalesce WKWebView's Command+V keydown and the paste event it emits next. */
export function createWailsPasteEventGate(windowMs = 750) {
  let suppressUntil = 0
  return {
    expectPasteEvent() {
      suppressUntil = Date.now() + windowMs
    },
    consumePasteEvent() {
      if (Date.now() > suppressUntil) return false
      suppressUntil = 0
      return true
    },
  }
}

export interface LocalTGentDiscovery {
  found: boolean
  address?: string
  name?: string
  socketPath?: string
  requiresPassword?: boolean
  agentId?: string
  hubAddr?: string
}

export interface LocalTGentAccess {
  found: boolean
  address?: string
  name?: string
  socketAvailable: boolean
  socketPath?: string
  authEnabled: boolean
  passwordAvailable: boolean
  agentId?: string
  hubAddr?: string
}

/** 仅在用户明确查看或复制时读取本机 daemon 的 Web 密码。 */
export async function getLocalTGentPassword(): Promise<string> {
  const api = (window as any).go?.main?.App
  if (!api?.GetLocalTGentPassword) {
    throw new Error('local_password_unavailable')
  }
  return api.GetLocalTGentPassword()
}

export interface LocalTGentValidation {
  ok: boolean
  requiresPassword?: boolean
  error?: 'invalid_address' | 'connection_failed' | 'not_tgent' | 'invalid_password' | 'authentication_failed'
  agentId?: string
  hubAddr?: string
}

/** 通过 Wails 原生层探测当前用户的本机 TGent daemon。 */
export async function discoverLocalTGent(): Promise<LocalTGentDiscovery> {
  const api = (window as any).go?.main?.App
  if (!api?.DiscoverLocalTGent) {
    return { found: false }
  }
  return api.DiscoverLocalTGent()
}

/** 读取本机连接状态；密码值由单独的显式操作按需获取。 */
export async function getLocalTGentAccess(): Promise<LocalTGentAccess> {
  const api = (window as any).go?.main?.App
  if (!api?.GetLocalTGentAccess) {
    return { found: false, socketAvailable: false, authEnabled: false, passwordAvailable: false }
  }
  return api.GetLocalTGentAccess()
}

/** 在 Wails 原生层验证本地 daemon，避免 WebView 自定义 Origin 的 CORS 限制。 */
export async function validateLocalTGent(address: string, password = ''): Promise<LocalTGentValidation> {
  const api = (window as any).go?.main?.App
  if (!api?.ValidateLocalTGent) {
    return { ok: false, error: 'connection_failed' }
  }
  return api.ValidateLocalTGent(address, password)
}

/** 判断是否已登录（检查 web token） */
export async function isLoggedIn(): Promise<boolean> {
  return !!(await getWebToken())
}

// ========== Web URL/Token 管理 ==========

/** 获取 Web URL（无自定义值时返回默认值） */
export async function getWebUrl(): Promise<string> {
  return (await storage.get(WEB_URL_KEY)) || DEFAULT_WEB_URL
}

/** 是否使用了自定义 Web URL */
export async function isCustomWebUrl(): Promise<boolean> {
  const stored = await storage.get(WEB_URL_KEY)
  return !!stored && stored !== DEFAULT_WEB_URL
}

/** 保存 Web URL */
export async function setWebUrl(url: string): Promise<void> {
  await storage.set(WEB_URL_KEY, url.replace(/\/+$/, ''))
}

/** 清除 Web URL（恢复默认值） */
export async function clearWebUrl(): Promise<void> {
  await storage.remove(WEB_URL_KEY)
}

/** 获取 Web JWT token */
export async function getWebToken(): Promise<string | null> {
  return storage.get(WEB_TOKEN_KEY)
}

/** 保存 Web JWT token */
export async function setWebToken(token: string): Promise<void> {
  await storage.set(WEB_TOKEN_KEY, token)
}

/** 清除 Web token（退出登录） */
export async function clearWebToken(): Promise<void> {
  await storage.remove(WEB_TOKEN_KEY)
  await storage.remove(WEB_REFRESH_TOKEN_KEY)
}

/** 获取 Web refresh token */
export async function getWebRefreshToken(): Promise<string | null> {
  return storage.get(WEB_REFRESH_TOKEN_KEY)
}

/** 保存 Web refresh token */
export async function setWebRefreshToken(token: string): Promise<void> {
  await storage.set(WEB_REFRESH_TOKEN_KEY, token)
}

// ========== 触觉反馈 ==========

let _hapticEnabled = true

/** 初始化时从存储加载震动设置 */
export function initHapticSetting() {
  storage.get('tgent_terminal_settings').then(raw => {
    if (!raw) return
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed.haptic === 'boolean') {
        _hapticEnabled = parsed.haptic
      }
    } catch {}
  }).catch(() => {})
}

/** 更新震动设置缓存（设置页面修改时调用） */
export function setHapticEnabled(v: boolean) {
  _hapticEnabled = v
}

/** 触觉反馈 */
export function haptic() {
  if (!_hapticEnabled) return
  NativeHaptic.impact().catch(() => {})
}

// 模块加载时自动初始化
initHapticSetting()
