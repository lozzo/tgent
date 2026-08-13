/**
 * NativeTransportProxy — 每 Store 一个的 WebRTCTransport 代理
 *
 * 通过 NativeBridgeClient 转发所有 DataChannel 操作到 Native 侧。
 * 对上层（TerminalClient、AgentDataStore、FileTransferStore）完全透明。
 *
 * 与 JS WebRTC 的 ConnectionStore 对齐：每个 store 有独立的 API/Events 通道，
 * Native 侧通过通道 label 中的 storeKey 路由到对应的 WebRTC 连接。
 *
 * 通道 label 格式：
 * - api:{storeKey}             — API 请求/响应
 * - events:{storeKey}          — 服务端事件推送
 * - terminal:{storeKey}:{paneId} — 终端 DataChannel
 * - file:{storeKey}:{transferId} — 文件传输 DataChannel
 */

import { NativeBridgeClient } from '../state/NativeBridgeClient'
import type { NativeConnectionInfo } from '../plugins/nativeConnection'

// 复用 protocol 常量
import { MSG_SESSION_EVENT } from './protocol'

// 分块协议常量
const API_CHUNK_MAGIC = 0xC0
const API_CHUNK_FIRST = 0x01
const API_CHUNK_LAST = 0x02

interface PendingRequest {
  resolve: (resp: { status: number; body: unknown }) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * NativeTransportProxy 实现了 WebRTCTransport 的公开接口，
 * 但底层通过 localhost WebSocket 与 Native 通信。
 * 每个 store（storeKey）一个实例，通道互相隔离。
 */
export class NativeTransportProxy {
  private bridge: NativeBridgeClient
  private connectionInfo: () => Promise<NativeConnectionInfo>
  readonly storeKey: string

  // 动态分配的 channelId（initChannels 后可用）
  private apiChannelId: number | null = null
  private _channelsReady: Promise<void>
  private _channelsReadyResolve!: () => void
  private _channelsInitialized = false
  private _channelsInitTask: Promise<void> | null = null

  // API 请求
  private pendingApiRequests = new Map<string, PendingRequest>()

  // 分块消息暂存区
  private pendingChunks = new Map<string, Uint8Array[]>()

  // 终端订阅
  private terminalSubscribers = new Map<string, (msgType: number, payload: Uint8Array) => void>()
  private terminalChannelCleanups = new Map<string, () => void>()

  // 事件订阅
  private eventSubscribers = new Set<(event: { type: string; session_id?: string; window_id?: string; pane_id?: string; name?: string }) => void>()

  // 断线回调（兼容 WebRTCTransport 接口）
  onDisconnect: (() => void) | null = null
  onRtcConfigFetched: ((config: any) => void) | null = null

  // 清理函数
  private cleanups: (() => void)[] = []

  constructor(bridge: NativeBridgeClient, storeKey: string, connectionInfo: () => Promise<NativeConnectionInfo>) {
    this.bridge = bridge
    this.storeKey = storeKey
    this.connectionInfo = connectionInfo
    this._channelsReady = new Promise(resolve => { this._channelsReadyResolve = resolve })
  }

  get connected(): boolean {
    return this.bridge.isConnected && this._channelsInitialized
  }

  // ========== 通道生命周期 ==========

  /**
   * 打开 per-store 的 API 和 Events 通道。
   * 由 NativeConnectionStoreManager 在 bridge 就绪后调用。
   */
  initChannels(): Promise<void> {
    if (this._channelsInitialized) return Promise.resolve()
    if (this._channelsInitTask) return this._channelsInitTask

    const task = this._openChannels().finally(() => {
      if (this._channelsInitTask === task) this._channelsInitTask = null
    })
    this._channelsInitTask = task
    return task
  }

  private async _openChannels(): Promise<void> {
    try {
      const [apiCh, eventsCh] = await Promise.all([
        this.bridge.openChannel(`api:${this.storeKey}`),
        this.bridge.openChannel(`events:${this.storeKey}`),
      ])

      this.apiChannelId = apiCh

      // 注册 API 响应 handler（分块协议）
      const apiUnsub = this.bridge.onChannelData(apiCh, (payload) => {
        this._handleApiResponse(payload)
      })
      this.cleanups.push(apiUnsub)

      // 注册 Events handler
      const eventsUnsub = this.bridge.onChannelData(eventsCh, (payload) => {
        this._handleEvent(payload)
      })
      this.cleanups.push(eventsUnsub)

      this._channelsInitialized = true
      this._channelsReadyResolve()
      console.log(`[NativeTransportProxy:${this.storeKey}] channels ready: api=0x${apiCh.toString(16)} events=0x${eventsCh.toString(16)}`)
    } catch (e) {
      console.warn(`[NativeTransportProxy:${this.storeKey}] initChannels failed:`, e)
    }
  }

  /**
   * Bridge 重连后重新打开通道。
   * 由 NativeConnectionStoreManager 在 onReady 回调中调用。
   */
  async reinitChannels(): Promise<void> {
    if (this._channelsInitTask) await this._channelsInitTask
    this._rejectAllPending(new Error('Bridge reconnected'))
    this.cleanups.forEach(fn => fn())
    this.cleanups = []
    this.apiChannelId = null
    this._channelsInitialized = false
    this._channelsReady = new Promise(resolve => { this._channelsReadyResolve = resolve })
    await this.initChannels()
  }

  /** Bridge 断线时由 Manager 调用 */
  onBridgeDisconnected(): void {
    this._rejectAllPending(new Error('Bridge disconnected'))
    this._channelsInitialized = false
    for (const paneId of this.terminalChannelCleanups.keys()) this.unbindTerminalChannel(paneId)
  }

  /**
   * 打开所有活跃终端通道。
   * 由 NativeConnectionStoreManager 在收到 connected 状态时调用。
   */
  openTerminalChannels(): void {
    console.log(`[NativeTransportProxy:${this.storeKey}] openTerminalChannels:`, [...this.terminalSubscribers.keys()])

    for (const paneId of this.terminalSubscribers.keys()) {
      void this.bindTerminalChannel(paneId)
    }
  }

  private async bindTerminalChannel(paneId: string): Promise<void> {
    const label = `terminal:${this.storeKey}:${paneId}`
    const generation = this.bridge.generation
    try {
      const channelId = await this.bridge.openChannel(label)
      if (generation !== this.bridge.generation || !this.terminalSubscribers.has(paneId)) return

      // Native state recovery and SYNC_RESPONSE can both reopen this channel.
      // Replace the old listener so each PTY frame is delivered exactly once.
      this.terminalChannelCleanups.get(paneId)?.()
      const cleanup = this.bridge.onChannelData(channelId, (payload) => {
        if (generation !== this.bridge.generation || payload.length === 0) return
        const msgType = payload[0]
        const data = payload.subarray(1)
        this.terminalSubscribers.get(paneId)?.(msgType, data)
      })
      if (generation !== this.bridge.generation || !this.terminalSubscribers.has(paneId)) {
        cleanup()
        return
      }
      this.terminalChannelCleanups.set(paneId, cleanup)
    } catch (e) {
      console.warn(`[NativeTransportProxy:${this.storeKey}] open ${label} failed:`, e)
    }
  }

  private unbindTerminalChannel(paneId: string): void {
    this.terminalChannelCleanups.get(paneId)?.()
    this.terminalChannelCleanups.delete(paneId)
  }

  // ========== 内部帧处理 ==========

  private _handleApiResponse(payload: Uint8Array): void {
    try {
      if (payload.length < 4 || payload[0] !== API_CHUNK_MAGIC) return

      const flags = payload[1]
      const idLen = payload[2]
      if (payload.length < 3 + idLen) return
      const requestId = new TextDecoder().decode(payload.subarray(3, 3 + idLen))
      const chunkData = payload.subarray(3 + idLen)

      const isFirst = (flags & API_CHUNK_FIRST) !== 0
      const isLast = (flags & API_CHUNK_LAST) !== 0

      if (isFirst) {
        this.pendingChunks.set(requestId, [chunkData])
      } else {
        const chunks = this.pendingChunks.get(requestId)
        if (chunks) chunks.push(chunkData)
      }

      if (isLast) {
        const chunks = this.pendingChunks.get(requestId)
        this.pendingChunks.delete(requestId)
        if (!chunks) return

        const bytes = chunks.length === 1 ? chunks[0] : (() => {
          const totalLen = chunks.reduce((sum, c) => sum + c.length, 0)
          const merged = new Uint8Array(totalLen)
          let offset = 0
          for (const c of chunks) {
            merged.set(c, offset)
            offset += c.length
          }
          return merged
        })()

        const text = new TextDecoder().decode(bytes)
        const resp = JSON.parse(text)
        const pending = this.pendingApiRequests.get(resp.id)
        if (pending) {
          clearTimeout(pending.timer)
          pending.resolve({ status: resp.status, body: resp.body })
          this.pendingApiRequests.delete(resp.id)
        }
      }
    } catch { /* ignore parse errors */ }
  }

  private _handleEvent(payload: Uint8Array): void {
    if (payload.length < 2 || payload[0] !== MSG_SESSION_EVENT) return
    try {
      const event = JSON.parse(new TextDecoder().decode(payload.subarray(1)))
      this.eventSubscribers.forEach(cb => cb(event))
    } catch { /* ignore parse errors */ }
  }

  /** Reject 所有 pending API 请求 */
  private _rejectAllPending(err: Error): void {
    for (const req of this.pendingApiRequests.values()) {
      clearTimeout(req.timer)
      req.reject(err)
    }
    this.pendingApiRequests.clear()
    this.pendingChunks.clear()
  }

  // ========== WebRTCTransport 公开接口 ==========

  isAlive(): boolean {
    return this.bridge.isConnected && this._channelsInitialized
  }

  getLastRtt(): number {
    return 0 // Native 侧管理 RTT
  }

  getLastFailureReason(): string | null {
    return null
  }

  getLastFailureDetail(): string {
    return ''
  }

  handleAppResume(): void {
    // Native 侧自动处理，JS 不需要做任何事
  }

  /** 发送 API 请求 */
  async sendApiRequest(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    // 等待通道就绪
    let readyTimer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this._channelsReady,
        new Promise<never>((_, reject) => {
          readyTimer = setTimeout(() => reject(new Error('API channel unavailable')), 10000)
        }),
      ])
    } finally {
      if (readyTimer) clearTimeout(readyTimer)
    }

    if (this.apiChannelId === null || !this.bridge.isConnected) {
      throw new Error('Not connected')
    }

    const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingApiRequests.delete(id)
        reject(new Error('API request timeout'))
      }, 60000)

      this.pendingApiRequests.set(id, {
        resolve: (resp) => {
          clearTimeout(timer)
          this.pendingApiRequests.delete(id)
          resolve(resp)
        },
        reject: (err) => {
          clearTimeout(timer)
          this.pendingApiRequests.delete(id)
          reject(err)
        },
        timer,
      })

      // 通过 per-store API 通道发送
      const payload = new TextEncoder().encode(JSON.stringify({ id, method, path, body: body ?? null }))
      this.bridge.sendData(this.apiChannelId!, payload)
    })
  }

  /** 订阅服务端事件 */
  subscribeEvent(cb: (event: { type: string; session_id?: string; window_id?: string; pane_id?: string; name?: string }) => void): () => void {
    this.eventSubscribers.add(cb)
    return () => { this.eventSubscribers.delete(cb) }
  }

  /** 订阅终端消息 */
  subscribeTerminal(paneId: string, cb: (msgType: number, payload: Uint8Array) => void): () => void {
    this.terminalSubscribers.set(paneId, cb)
    void this.bindTerminalChannel(paneId)

    return () => {
      if (this.terminalSubscribers.get(paneId) !== cb) return
      this.terminalSubscribers.delete(paneId)
      this.unbindTerminalChannel(paneId)
      this.bridge.closeChannelByLabel(`terminal:${this.storeKey}:${paneId}`)
    }
  }

  /** 获取或创建终端 DataChannel（返回代理对象） */
  getTerminalChannel(paneId: string): TerminalChannelProxy | null {
    if (!this.bridge.isConnected) return null
    return new TerminalChannelProxy(this.bridge, paneId, this.storeKey)
  }

  /** 关闭指定 pane 的终端 DataChannel */
  closeTerminalChannel(paneId: string): void {
    this.unbindTerminalChannel(paneId)
    this.bridge.closeChannelByLabel(`terminal:${this.storeKey}:${paneId}`)
    this.terminalSubscribers.delete(paneId)
  }

  /** 创建文件传输 DataChannel */
  createFileChannel(transferId: string): FileChannelProxy | null {
    if (!this.bridge.isConnected) return null
    return new FileChannelProxy(this.bridge, transferId, this.storeKey)
  }

  /** 获取连接信息 */
  async getConnectionInfo(): Promise<{
    type: 'p2p' | 'relay' | 'unknown'
    localAddr?: string
    remoteAddr?: string
    candidateType?: string
    remoteCandidateType?: string
    rtt?: number
  }> {
    try {
      return await this.connectionInfo()
    } catch {
      return { type: 'unknown' }
    }
  }

  /** 断开连接，释放资源 */
  disconnect(): void {
    this._rejectAllPending(new Error('disconnected'))
    this.cleanups.forEach(fn => fn())
    this.cleanups = []
    this.apiChannelId = null
    this._channelsInitialized = false

    // 关闭所有终端通道
    for (const paneId of this.terminalSubscribers.keys()) {
      this.unbindTerminalChannel(paneId)
      this.bridge.closeChannelByLabel(`terminal:${this.storeKey}:${paneId}`)
    }
    this.terminalSubscribers.clear()
  }
}

/**
 * 终端 DataChannel 代理
 * 模拟 RTCDataChannel 接口，通过 Bridge 转发数据。
 * 持有 bridge.generation 用于检测通道是否已过期。
 */
export class TerminalChannelProxy {
  private bridge: NativeBridgeClient
  private label: string
  private channelId: number | undefined
  private _readyState: string = 'connecting'
  private _generation: number

  binaryType = 'arraybuffer'
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(bridge: NativeBridgeClient, paneId: string, storeKey: string) {
    this.bridge = bridge
    this.label = `terminal:${storeKey}:${paneId}`
    this._generation = bridge.generation
    this.init()
  }

  get readyState(): string {
    return this._readyState
  }

  private async init(): Promise<void> {
    try {
      this.channelId = await this.bridge.openChannel(this.label)
      if (this._generation !== this.bridge.generation) {
        this._readyState = 'closed'
        return
      }
      this._readyState = 'open'

      this.bridge.onChannelData(this.channelId, (payload) => {
        if (this.onmessage) {
          this.onmessage({ data: new Uint8Array(payload).buffer as ArrayBuffer })
        }
      })

      this.onopen?.()
    } catch {
      this._readyState = 'closed'
      this.onerror?.()
    }
  }

  send(data: ArrayBuffer | Uint8Array): void {
    if (this.channelId === undefined || this._readyState !== 'open') return
    if (this._generation !== this.bridge.generation) {
      this._readyState = 'closed'
      return
    }
    const payload = data instanceof Uint8Array ? data : new Uint8Array(data)
    this.bridge.sendData(this.channelId, payload)
  }

  close(): void {
    if (this.channelId !== undefined && this._generation === this.bridge.generation) {
      this.bridge.closeChannel(this.channelId)
    }
    this._readyState = 'closed'
    this.onclose?.()
  }
}

/**
 * 文件传输 DataChannel 代理
 * 持有 bridge.generation 用于检测通道是否已过期。
 */
export class FileChannelProxy {
  private bridge: NativeBridgeClient
  private label: string
  private channelId: number | undefined
  private _readyState: string = 'connecting'
  private _generation: number

  binaryType = 'arraybuffer'
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  bufferedAmountLowThreshold = 0
  private bufferedAmountLowListeners = new Set<() => void>()

  constructor(bridge: NativeBridgeClient, transferId: string, storeKey: string) {
    this.bridge = bridge
    this.label = `file:${storeKey}:${transferId}`
    this._generation = bridge.generation
    this.init()
  }

  get readyState(): string {
    return this._readyState
  }

  get bufferedAmount(): number {
    return 0
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'bufferedamountlow') this.bufferedAmountLowListeners.add(listener)
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'bufferedamountlow') this.bufferedAmountLowListeners.delete(listener)
  }

  private async init(): Promise<void> {
    try {
      this.channelId = await this.bridge.openChannel(this.label)
      if (this._generation !== this.bridge.generation) {
        this._readyState = 'closed'
        return
      }
      this._readyState = 'open'

      this.bridge.onChannelData(this.channelId, (payload) => {
        if (this.onmessage) {
          this.onmessage({ data: new Uint8Array(payload).buffer as ArrayBuffer })
        }
      })

      this.onopen?.()
    } catch {
      this._readyState = 'closed'
      this.onerror?.()
    }
  }

  send(data: ArrayBuffer | Uint8Array): void {
    if (this.channelId === undefined || this._readyState !== 'open') return
    if (this._generation !== this.bridge.generation) {
      this._readyState = 'closed'
      return
    }
    const payload = data instanceof Uint8Array ? data : new Uint8Array(data)
    this.bridge.sendData(this.channelId, payload)
  }

  close(): void {
    if (this.channelId !== undefined && this._generation === this.bridge.generation) {
      this.bridge.closeChannel(this.channelId)
    }
    this._readyState = 'closed'
    this.bufferedAmountLowListeners.clear()
    this.onclose?.()
  }
}
