/**
 * 前台服务管理器
 * 监听连接事件，在有活跃连接且用户开启开关时启动 Android 前台服务
 */

import { eventBus } from './EventBus'
import { storage } from '../lib/storage'
import { isNativeApp } from '../lib/platform'
import ForegroundService from '../plugins/foregroundService'

const STORAGE_KEY = 'tgent_foreground_service'
const DEEP_STORAGE_KEY = 'tgent_foreground_deep'

export class ForegroundServiceManager {
  private activeConnections = new Set<string>()
  private enabled = false
  private deepEnabled = false
  private running = false
  private unsubConnect: (() => void) | null = null
  private unsubDisconnect: (() => void) | null = null

  async init(): Promise<void> {
    if (!isNativeApp()) return

    // 读取用户设置
    const val = await storage.get(STORAGE_KEY)
    this.enabled = val === '1'
    const deepVal = await storage.get(DEEP_STORAGE_KEY)
    this.deepEnabled = deepVal === '1'

    // 监听连接事件
    this.unsubConnect = eventBus.on('connection:connected', ({ key }) => {
      this.activeConnections.add(key)
      this.update()
    })

    this.unsubDisconnect = eventBus.on('connection:disconnected', ({ key }) => {
      this.activeConnections.delete(key)
      this.update()
    })
  }

  /** 外部更新开关状态（从设置页调用） */
  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled
    await storage.set(STORAGE_KEY, enabled ? '1' : '0')
    this.update()
  }

  /** 读取当前开关状态 */
  async getEnabled(): Promise<boolean> {
    const val = await storage.get(STORAGE_KEY)
    this.enabled = val === '1'
    return this.enabled
  }

  /** 外部更新深度保活开关 */
  async setDeepEnabled(enabled: boolean): Promise<void> {
    this.deepEnabled = enabled
    await storage.set(DEEP_STORAGE_KEY, enabled ? '1' : '0')
    this.update()
  }

  /** 读取深度保活开关状态 */
  async getDeepEnabled(): Promise<boolean> {
    const val = await storage.get(DEEP_STORAGE_KEY)
    this.deepEnabled = val === '1'
    return this.deepEnabled
  }

  private update(): void {
    const shouldRun = this.enabled && this.activeConnections.size > 0
    if (shouldRun && !this.running) {
      this.running = true
      ForegroundService.start({ content: '终端连接中', deep: this.deepEnabled }).catch(() => {})
    } else if (shouldRun && this.running) {
      // 已在运行，但 deep 状态可能变了，重新启动以更新锁
      ForegroundService.start({ content: '终端连接中', deep: this.deepEnabled }).catch(() => {})
    } else if (!shouldRun && this.running) {
      this.running = false
      ForegroundService.stop().catch(() => {})
    }
  }

  destroy(): void {
    this.unsubConnect?.()
    this.unsubDisconnect?.()
    if (this.running) {
      ForegroundService.stop().catch(() => {})
      this.running = false
    }
  }
}
