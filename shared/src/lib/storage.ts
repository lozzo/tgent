import { Preferences } from '@capacitor/preferences'
import { isNativeApp } from './platform'

interface KVStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

/** 原生环境：使用 Capacitor Preferences */
const nativeStorage: KVStorage = {
  async get(key) {
    const { value } = await Preferences.get({ key })
    return value
  },
  async set(key, value) {
    await Preferences.set({ key, value })
  },
  async remove(key) {
    await Preferences.remove({ key })
  },
}

/** 浏览器 fallback：localStorage 的 async wrapper */
const webStorage: KVStorage = {
  async get(key) {
    return localStorage.getItem(key)
  },
  async set(key, value) {
    localStorage.setItem(key, value)
  },
  async remove(key) {
    localStorage.removeItem(key)
  },
}

/** 导出单例 */
export const storage: KVStorage = isNativeApp() ? nativeStorage : webStorage

/** 需要迁移的所有 localStorage key */
const MIGRATION_KEYS = [
  'tgent_web_url',
  'tgent_web_token',
  'tgent_web_refresh_token',
  'tgent_local_servers',
  'tgent_theme',
  'tgent_terminal_settings',
  'tgent_desktop_settings',
  'tgent_fn_config',
  'tgent-snippets',
  'tgent_servers_cache',
  'tgent_subscription_cache',
  'tgent_favorite_panes',
  'tgent_welcome_seen',
  'tgent_token',
]

const MIGRATION_DONE_KEY = 'tgent_migration_done'

/**
 * 将 localStorage 中的旧数据迁移到 Preferences（仅原生环境执行）。
 * 迁移完成后在 Preferences 中写入标记，防止重复迁移。
 */
export async function migrateFromLocalStorage(): Promise<void> {
  if (!isNativeApp()) return

  const { value: done } = await Preferences.get({ key: MIGRATION_DONE_KEY })
  if (done === '1') return

  for (const key of MIGRATION_KEYS) {
    try {
      const value = localStorage.getItem(key)
      if (value !== null) {
        await Preferences.set({ key, value })
      }
    } catch {}
  }

  await Preferences.set({ key: MIGRATION_DONE_KEY, value: '1' })
}
