/**
 * 网络状态管理器（单一数据源）
 *
 * 合并手机网络感知、App 生命周期、JS 冻结检测，统一产出 NetworkState。
 * 外部通过 subscribe() 响应状态变化。
 */

import { isNativeApp } from '../lib/platform'

// ========== 类型 ==========

export type ResumeType = 'quick' | 'normal' | 'cold'

export interface NetworkState {
  /** 手机有网络连接 */
  phoneOnline: boolean
  /** 网络类型: wifi / cellular / 4g / 3g / ... */
  connectionType: string
  /** App 在前台 */
  appActive: boolean
  /** JS 刚从冻结中恢复（瞬态，触发一轮 verify 后自动重置） */
  jsFrozenRecovery: boolean
  /** 派生: 网络整体可用 = phoneOnline && appActive && !jsFrozenRecovery */
  networkReady: boolean
  /** App 恢复类型（仅在刚恢复时有值，随后重置为 null） */
  resumeType: ResumeType | null
  /** App 恢复时的后台时长（ms），仅 resumeType 非 null 时有意义 */
  resumeDuration: number
}

// ========== 常量 ==========

/** JS 冻结检测：心跳间隔 */
const HEARTBEAT_INTERVAL = 3_000
/** JS 冻结检测：drift 超过此值视为冻结 */
const FREEZE_THRESHOLD = 5_000

/** App 恢复分级阈值 */
const QUICK_THRESHOLD = 30_000     // < 30s
const NORMAL_THRESHOLD = 300_000   // < 5min

/** subscribe 回调防抖：不会在此间隔内连续触发 */
const NOTIFY_DEBOUNCE = 100

// ========== Manager ==========

type Listener = (state: NetworkState, prevState: NetworkState) => void

export class NetworkStateManager {
  private _cleanup: (() => void)[] = []
  private _initialized = false
  private _listeners = new Set<Listener>()

  // ---- 原始信号 ----
  private _phoneOnline = navigator.onLine
  private _connectionType = ''
  private _appActive = !document.hidden
  private _jsFrozenRecovery = false

  // ---- JS 冻结检测 ----
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private _lastHeartbeat = Date.now()

  // ---- App 生命周期 ----
  private _backgroundTimestamp: number | null = null
  private _resumeType: ResumeType | null = null
  private _resumeDuration = 0

  // ---- 去重 ----
  private _notifyTimer: ReturnType<typeof setTimeout> | null = null
  /** 缓存的快照（引用稳定，仅在 _doNotify 时更新） */
  private _lastSnapshot: NetworkState

  constructor() {
    this._lastSnapshot = this._snapshot()
  }

  // ========== 公开 API ==========

  /** 返回缓存的快照（引用稳定，适配 useSyncExternalStore） */
  get state(): NetworkState {
    return this._lastSnapshot
  }

  init(): void {
    if (this._initialized) return
    this._initialized = true

    this._initPhoneNetwork()
    this._initAppLifecycle()
    this._initHeartbeat()
  }

  /** 订阅状态变化，返回取消订阅函数 */
  subscribe(listener: Listener): () => void {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  destroy(): void {
    this._cleanup.forEach((fn) => fn())
    this._cleanup = []
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = null
    }
    if (this._notifyTimer) {
      clearTimeout(this._notifyTimer)
      this._notifyTimer = null
    }
    this._listeners.clear()
    this._initialized = false
  }

  // ========== 信号采集：手机网络 ==========

  private _initPhoneNetwork(): void {
    // 浏览器 online/offline
    const onOnline = () => {
      this._phoneOnline = true
      this._scheduleNotify()
    }
    const onOffline = () => {
      this._phoneOnline = false
      this._scheduleNotify()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    this._cleanup.push(() => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    })

    // NetworkInformation API（Chrome/Edge/Android WebView）
    const conn = (navigator as any).connection as
      | { type?: string; effectiveType?: string; addEventListener: Function; removeEventListener: Function }
      | undefined
    if (conn) {
      this._connectionType = conn.effectiveType || conn.type || ''
      const onChange = () => {
        this._connectionType = conn.effectiveType || conn.type || ''
        this._scheduleNotify()
      }
      conn.addEventListener('change', onChange)
      this._cleanup.push(() => conn.removeEventListener('change', onChange))
    }

    // Capacitor Network 插件（原生 App）
    if (isNativeApp()) {
      import('@capacitor/network')
        .then(({ Network }: any) => {
          Network.addListener('networkStatusChange', (status: any) => {
            this._phoneOnline = status.connected
            this._connectionType = status.connectionType || ''
            this._scheduleNotify()
          }).then((handle: any) => {
            this._cleanup.push(() => handle.remove())
          })
        })
        .catch(() => {})
    }
  }

  // ========== 信号采集：App 生命周期 ==========

  private _initAppLifecycle(): void {
    // visibilitychange（Web 通用）
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        this._onBackground()
      } else if (document.visibilityState === 'visible') {
        this._onResume()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    this._cleanup.push(() => document.removeEventListener('visibilitychange', onVisibilityChange))

    // Capacitor appStateChange（原生 App，Android 上更可靠）
    if (isNativeApp()) {
      import('@capacitor/app')
        .then(({ App }) => {
          App.addListener('appStateChange', ({ isActive }) => {
            if (isActive) {
              this._onResume()
            } else {
              this._onBackground()
            }
          }).then((handle: any) => {
            this._cleanup.push(() => handle.remove())
          })
        })
        .catch(() => {})
    }
  }

  private _onBackground(): void {
    // visibilitychange 和 Capacitor appStateChange 会先后到达，只记录第一次。
    if (!this._appActive && this._backgroundTimestamp !== null) return

    this._backgroundTimestamp = Date.now()
    this._appActive = false
    this._scheduleNotify()
  }

  private _onResume(): void {
    const now = Date.now()

    // Capacitor listener 注册时可能立即上报当前前台状态，不应当作一次恢复。
    if (this._appActive && this._backgroundTimestamp === null) {
      this._lastHeartbeat = now
      return
    }
    const duration = this._backgroundTimestamp ? now - this._backgroundTimestamp : 0
    this._backgroundTimestamp = null
    this._appActive = true
    this._lastHeartbeat = now
    // 后台计时器暂停是正常生命周期，不属于前台 JS 冻结。
    this._jsFrozenRecovery = false

    const type = this._classifyResume(duration)
    this._resumeType = type
    this._resumeDuration = duration

    console.log(`[NetworkState] resume type=${type} duration=${duration}ms`)
    this._scheduleNotify()
  }

  private _classifyResume(duration: number): ResumeType {
    if (duration < QUICK_THRESHOLD) return 'quick'
    if (duration < NORMAL_THRESHOLD) return 'normal'
    return 'cold'
  }

  // ========== 信号采集：JS 冻结检测 ==========

  private _initHeartbeat(): void {
    this._lastHeartbeat = Date.now()
    this._heartbeatTimer = setInterval(() => {
      const now = Date.now()
      const drift = now - this._lastHeartbeat - HEARTBEAT_INTERVAL
      this._lastHeartbeat = now

      // 浏览器在后台会暂停定时器，这是正常行为；恢复由生命周期事件处理。
      if (!this._appActive || document.hidden) return

      if (drift > FREEZE_THRESHOLD) {
        console.log(`[NetworkState] JS freeze detected, drift=${drift}ms`)
        this._jsFrozenRecovery = true
        this._scheduleNotify()
      }
    }, HEARTBEAT_INTERVAL)
  }

  // ========== 状态快照 & 通知 ==========

  private _snapshot(): NetworkState {
    const { _phoneOnline, _connectionType, _appActive, _jsFrozenRecovery, _resumeType, _resumeDuration } = this
    return {
      phoneOnline: _phoneOnline,
      connectionType: _connectionType,
      appActive: _appActive,
      jsFrozenRecovery: _jsFrozenRecovery,
      networkReady: _phoneOnline && _appActive && !_jsFrozenRecovery,
      resumeType: _resumeType,
      resumeDuration: _resumeDuration,
    }
  }

  /**
   * 合并多个信号变化，统一通知一次。
   * 避免 online + resume 同时触发导致 listener 被调用两次。
   */
  private _scheduleNotify(): void {
    if (this._notifyTimer) return
    this._notifyTimer = setTimeout(() => {
      this._notifyTimer = null
      this._doNotify()
    }, NOTIFY_DEBOUNCE)
  }

  private _doNotify(): void {
    const prev = this._lastSnapshot
    const curr = this._snapshot()
    this._lastSnapshot = curr

    // 通知所有 listener
    for (const listener of this._listeners) {
      try {
        listener(curr, prev)
      } catch (err) {
        console.error('[NetworkState] listener error:', err)
      }
    }

    // 瞬态标志重置：jsFrozenRecovery 和 resumeType 只在本轮通知中有效
    let needRenotify = false
    if (this._jsFrozenRecovery) {
      this._jsFrozenRecovery = false
      needRenotify = true
    }
    if (this._resumeType !== null) {
      this._resumeType = null
      this._resumeDuration = 0
    }

    // 瞬态标志重置后 networkReady 可能变化（例如 jsFrozenRecovery 重置后 networkReady 变为 true）
    // 需要再通知一轮，让 ConnectionManager 知道网络已恢复
    if (needRenotify) {
      this._scheduleNotify()
    }
  }
}
