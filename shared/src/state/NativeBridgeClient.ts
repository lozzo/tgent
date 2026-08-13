/**
 * NativeBridgeClient — 无状态 WebSocket 客户端
 *
 * 连接 Native 侧的 BridgeServer（ws://127.0.0.1:{port}），
 * 负责帧解析/封装/多路复用。
 *
 * 设计原则：无状态重连。连接异常或 Bridge 已断开 → forceReconnect() →
 * 关闭旧 WS → 立即重建新 WS → 上层通过 onReady 重建所有通道。
 * 本地回环重连 < 20ms，比任何恢复/同步逻辑都快。
 *
 * 帧格式（与 BridgeServer.kt 对应）：
 * ┌───────────┬──────────────┬──────────────┬──────────────────────────┐
 * │ frameType │ channelId    │ payloadLen   │ payload                  │
 * │ 1 byte    │ 2 bytes BE   │ 4 bytes BE   │ variable                 │
 * └───────────┴──────────────┴──────────────┴──────────────────────────┘
 */

// Frame types（与 Native 侧一致）
const FRAME_DATA = 0x01
const FRAME_OPEN_CHAN = 0x02
const FRAME_CHAN_OPENED = 0x03
const FRAME_CLOSE_CHAN = 0x04
const FRAME_CHAN_ERROR = 0x05
const FRAME_STATE_UPDATE = 0x10
const FRAME_TRANSFER_SYNC = 0x11    // Native→JS
const FRAME_TRANSFER_REQUEST = 0x12  // JS→Native
const FRAME_SYNC_REQUEST = 0x22     // JS→Native, 零 payload
const FRAME_SYNC_RESPONSE = 0x23    // Native→JS, JSON payload

const HEADER_SIZE = 7
const MAX_PENDING_CHANNEL_FRAMES = 64
const MAX_PENDING_CHANNEL_BYTES = 4 * 1024 * 1024

// 重连参数：本地回环首次立即重试，后续 backoff
const RECONNECT_DELAYS = [0, 0.3, 1, 2, 4, 8]
const MAX_RECONNECT_ATTEMPTS = 20

/** 通道数据回调 */
type ChannelDataHandler = (payload: Uint8Array) => void

/** 状态更新回调 */
type StateUpdateHandler = (snapshot: Record<string, unknown>) => void

/** 传输同步回调 */
export type TransferSyncPayload = {
  transfers: Array<{
    id: string
    name: string
    direction: 'download' | 'upload'
    totalSize: number
    transferredSize: number
    status: 'transferring' | 'completed' | 'failed'
    startedAt: number
    filePath?: string
    error?: string
    storeKey?: string
  }>
}
type TransferSyncHandler = (data: TransferSyncPayload) => void

/** SYNC_RESPONSE payload */
export type SyncResponsePayload = {
  stores: Array<Record<string, unknown>>
}
type SyncResponseHandler = (data: SyncResponsePayload) => void

export interface BridgeSocket {
  readyState: number
  binaryType: string
  onopen: (() => void) | null
  onclose: (() => void) | null
  onerror: ((event: unknown) => void) | null
  onmessage: ((event: { data: ArrayBuffer }) => void) | null
  send(data: ArrayBuffer): void
  close(): void
}

export type BridgeSocketFactory = () => BridgeSocket

export class NativeBridgeClient {
  private ws: BridgeSocket | null = null
  private port: number | null
  private socketFactory: BridgeSocketFactory | null
  private connected = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false
  private readyWaiters = new Set<() => void>()

  /**
   * 重连代次 — 每次重连递增。
   * TerminalChannelProxy / FileChannelProxy 用来检测自己是否已过期。
   */
  private _generation = 0

  /** channelId → 数据处理回调 */
  private dataHandlers = new Map<number, Set<ChannelDataHandler>>()

  /** 通道打开到 JS 代理订阅之间到达的早到数据 */
  private pendingChannelData = new Map<number, Uint8Array[]>()

  /** 状态更新监听 */
  private stateUpdateHandlers = new Set<StateUpdateHandler>()

  /** 传输同步监听 */
  private transferSyncHandlers = new Set<TransferSyncHandler>()

  /** 等待通道打开的 Promise（多个调用者共享同一个 Promise） */
  private pendingChannelOpens = new Map<string, {
    promise: Promise<number>
    resolve: (channelId: number) => void
    reject: (err: Error) => void
  }>()

  /** label → channelId 映射 */
  private labelToChannel = new Map<string, number>()

  /** channelId → label 反向映射 */
  private channelToLabel = new Map<number, string>()

  /** WS 连接就绪 — 上层应在此回调中重建所有通道 */
  onReady: (() => void) | null = null
  /** WS 断开 — 上层可用于 reject pending 请求等 */
  onDisconnected: (() => void) | null = null
  /** SYNC_RESPONSE 回调 — 收到 Native 全量状态快照时触发 */
  onSyncResponse: SyncResponseHandler | null = null

  constructor(endpoint: number | BridgeSocketFactory) {
    this.port = typeof endpoint === 'number' ? endpoint : null
    this.socketFactory = typeof endpoint === 'function' ? endpoint : null
  }

  // ========== 生命周期 ==========

  /** 启动连接 */
  connect(): void {
    if (this.destroyed) return
    if (this.ws) return

    this.reconnectAttempt = 0
    this._doConnect()
  }

  /**
   * 强制断开并立即重连。
   * 用于 Bridge 已断开或状态不可用时重建所有状态 — 不做局部恢复，直接重来。
   */
  forceReconnect(): void {
    if (this.destroyed) return
    this._clearReconnectTimer()
    this.reconnectAttempt = 0
    if (this.ws) {
      this.ws.onclose = null  // 阻止 onclose 触发 _scheduleReconnect
      this.ws.close()
      this.ws = null
    }
    this.connected = false
    this._clearAllChannelState()
    this.onDisconnected?.()
    this._generation++
    this._doConnect()
  }

  /** 销毁客户端 */
  destroy(): void {
    this.destroyed = true
    this._clearReconnectTimer()
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    this.connected = false
    this._clearAllChannelState()
    this.dataHandlers.clear()
    this.stateUpdateHandlers.clear()
    this.transferSyncHandlers.clear()
    this.readyWaiters.clear()
  }

  get isConnected(): boolean {
    return this.connected
  }

  /** 当前重连代次 */
  get generation(): number {
    return this._generation
  }

  // ========== 发送帧 ==========

  /** 发送数据帧 */
  sendData(channelId: number, payload: Uint8Array): void {
    this._sendFrame(FRAME_DATA, channelId, payload)
  }

  /**
   * 打开通道请求
   * @returns 分配的 channelId
   */
  async openChannel(label: string): Promise<number> {
    await this._waitUntilConnected()
    // 检查是否已有此通道
    const existing = this.labelToChannel.get(label)
    if (existing !== undefined) return existing

    // 检查是否已有等待中的请求 — 共享同一个 Promise
    const pending = this.pendingChannelOpens.get(label)
    if (pending) {
      return pending.promise
    }

    let resolve!: (channelId: number) => void
    let reject!: (err: Error) => void
    const promise = new Promise<number>((res, rej) => { resolve = res; reject = rej })

    this.pendingChannelOpens.set(label, { promise, resolve, reject })

    const labelBytes = new TextEncoder().encode(label)
    // 使用临时 channelId 0（Native 会分配真正的 ID）
    this._sendFrame(FRAME_OPEN_CHAN, 0, labelBytes)

    // 超时
    setTimeout(() => {
      const p = this.pendingChannelOpens.get(label)
      if (p) {
        this.pendingChannelOpens.delete(label)
        p.reject(new Error(`Channel open timeout: ${label}`))
      }
    }, 10000)

    return promise
  }

  /** 关闭通道 */
  closeChannel(channelId: number): void {
    const label = this.channelToLabel.get(channelId)
    if (label) {
      this.labelToChannel.delete(label)
      this.channelToLabel.delete(channelId)
    }
    this.dataHandlers.delete(channelId)
    this.pendingChannelData.delete(channelId)
    this._sendFrame(FRAME_CLOSE_CHAN, channelId, new Uint8Array(0))
  }

  /** 关闭指定 label 的通道 */
  closeChannelByLabel(label: string): void {
    const channelId = this.labelToChannel.get(label)
    if (channelId !== undefined) {
      this.closeChannel(channelId)
    }
  }

  // ========== 订阅 ==========

  /** 订阅某通道的数据 */
  onChannelData(channelId: number, handler: ChannelDataHandler): () => void {
    let handlers = this.dataHandlers.get(channelId)
    if (!handlers) {
      handlers = new Set()
      this.dataHandlers.set(channelId, handlers)
    }
    handlers.add(handler)
    const pending = this.pendingChannelData.get(channelId)
    if (pending) {
      this.pendingChannelData.delete(channelId)
      for (const payload of pending) handler(payload)
    }
    return () => {
      handlers!.delete(handler)
      if (handlers!.size === 0) this.dataHandlers.delete(channelId)
    }
  }

  /** 通过 label 订阅数据 */
  onChannelDataByLabel(label: string, handler: ChannelDataHandler): () => void {
    const channelId = this.labelToChannel.get(label)
    if (channelId !== undefined) {
      return this.onChannelData(channelId, handler)
    }
    console.warn(`[NativeBridgeClient] label ${label} not yet open, handler will be lost`)
    return () => {}
  }

  /** 订阅状态更新 */
  onStateUpdate(handler: StateUpdateHandler): () => void {
    this.stateUpdateHandlers.add(handler)
    return () => { this.stateUpdateHandlers.delete(handler) }
  }

  /** 订阅传输同步 */
  onTransferSync(handler: TransferSyncHandler): () => void {
    this.transferSyncHandlers.add(handler)
    return () => { this.transferSyncHandlers.delete(handler) }
  }

  /** 发送文件传输请求到 Native */
  sendTransferRequest(request: Record<string, unknown>): void {
    const json = JSON.stringify(request)
    const payload = new TextEncoder().encode(json)
    this._sendFrame(FRAME_TRANSFER_REQUEST, 0, payload)
  }

  /** 发送 SYNC_REQUEST 到 Native（零 payload） */
  sendSyncRequest(): void {
    this._sendFrame(FRAME_SYNC_REQUEST, 0, new Uint8Array(0))
  }

  /** 获取 label 对应的 channelId */
  getChannelId(label: string): number | undefined {
    return this.labelToChannel.get(label)
  }

  // ========== 内部连接 ==========

  private _doConnect(): void {
    if (this.destroyed) return
    if (this.ws) return  // 防重入

    try {
      const ws = this.socketFactory
        ? this.socketFactory()
        : new WebSocket(`ws://127.0.0.1:${this.port}`) as unknown as BridgeSocket
      ws.binaryType = 'arraybuffer'
      this.ws = ws

      ws.onopen = () => {
        console.log('[NativeBridgeClient] bridge connected', this.port ?? 'wasm')
        this.connected = true
        this.reconnectAttempt = 0
        for (const resolve of this.readyWaiters) resolve()
        this.readyWaiters.clear()
        this.onReady?.()
      }

      ws.onclose = () => {
        console.log('[NativeBridgeClient] disconnected')
        const wasConnected = this.connected
        this.connected = false
        this.ws = null
        this._clearAllChannelState()
        this._generation++

        if (wasConnected) {
          this.onDisconnected?.()
        }

        this._scheduleReconnect()
      }

      ws.onerror = (ev) => {
        console.warn('[NativeBridgeClient] error:', ev)
      }

      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          this._handleBinaryMessage(new Uint8Array(ev.data))
        }
      }
    } catch (e) {
      console.warn('[NativeBridgeClient] connect error:', e)
      this._scheduleReconnect()
    }
  }

  private _scheduleReconnect(): void {
    if (this.destroyed) return
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('[NativeBridgeClient] max reconnect attempts reached')
      return
    }

    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)]
    this.reconnectAttempt++
    console.log(`[NativeBridgeClient] reconnect #${this.reconnectAttempt} in ${delay}s`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this._doConnect()
    }, delay * 1000)
  }

  private _clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private _waitUntilConnected(): Promise<void> {
    if (this.connected) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer)
        this.readyWaiters.delete(done)
        resolve()
      }
      const timer = setTimeout(() => {
        this.readyWaiters.delete(done)
        reject(new Error('Bridge connection timeout'))
      }, 10000)
      this.readyWaiters.add(done)
    })
  }

  /** 清空所有通道映射和 pending 请求 */
  private _clearAllChannelState(): void {
    this.labelToChannel.clear()
    this.channelToLabel.clear()
    this.dataHandlers.clear()
    this.pendingChannelData.clear()
    for (const pending of this.pendingChannelOpens.values()) {
      pending.reject(new Error('Bridge disconnected'))
    }
    this.pendingChannelOpens.clear()
  }

  // ========== 帧处理 ==========

  private _handleBinaryMessage(data: Uint8Array): void {
    if (data.length < HEADER_SIZE) {
      console.warn('[NativeBridgeClient] frame too short:', data.length)
      return
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const frameType = data[0]
    const channelId = view.getUint16(1) // big-endian
    const payloadLen = view.getUint32(3) // big-endian

    if (data.length < HEADER_SIZE + payloadLen) {
      console.warn('[NativeBridgeClient] incomplete frame')
      return
    }

    const payload = data.subarray(HEADER_SIZE, HEADER_SIZE + payloadLen)

    switch (frameType) {
      case FRAME_DATA:
        if (this.dataHandlers.get(channelId)?.size) {
          for (const handler of this.dataHandlers.get(channelId) || []) {
            handler(payload)
          }
        } else {
          const pending = this.pendingChannelData.get(channelId) ?? []
          pending.push(payload.slice())
          let pendingBytes = pending.reduce((sum, frame) => sum + frame.byteLength, 0)
          while (pending.length > MAX_PENDING_CHANNEL_FRAMES || pendingBytes > MAX_PENDING_CHANNEL_BYTES) {
            pendingBytes -= pending.shift()?.byteLength ?? 0
          }
          this.pendingChannelData.set(channelId, pending)
        }
        break

      case FRAME_CHAN_OPENED: {
        const label = new TextDecoder().decode(payload)
        this.labelToChannel.set(label, channelId)
        this.channelToLabel.set(channelId, label)

        const pending = this.pendingChannelOpens.get(label)
        if (pending) {
          this.pendingChannelOpens.delete(label)
          pending.resolve(channelId)
        }
        break
      }

      case FRAME_CHAN_ERROR: {
        const errorMsg = new TextDecoder().decode(payload)
        console.warn(`[NativeBridgeClient] channel error on 0x${channelId.toString(16)}:`, errorMsg)
        const label = this.channelToLabel.get(channelId)
        if (label) {
          const pending = this.pendingChannelOpens.get(label)
          if (pending) {
            this.pendingChannelOpens.delete(label)
            pending.reject(new Error(errorMsg))
          }
        }
        break
      }

      case FRAME_CLOSE_CHAN: {
        const label = this.channelToLabel.get(channelId)
        if (label) {
          this.labelToChannel.delete(label)
          this.channelToLabel.delete(channelId)
        }
        this.dataHandlers.delete(channelId)
        this.pendingChannelData.delete(channelId)
        break
      }

      case FRAME_STATE_UPDATE: {
        try {
          const json = JSON.parse(new TextDecoder().decode(payload))
          for (const handler of this.stateUpdateHandlers) {
            handler(json)
          }
        } catch (e) {
          console.warn('[NativeBridgeClient] invalid state update JSON:', e)
        }
        break
      }

      case FRAME_TRANSFER_SYNC: {
        try {
          const json = JSON.parse(new TextDecoder().decode(payload))
          for (const handler of this.transferSyncHandlers) {
            handler(json)
          }
        } catch (e) {
          console.warn('[NativeBridgeClient] invalid transfer sync JSON:', e)
        }
        break
      }

      case FRAME_SYNC_RESPONSE: {
        try {
          const json = JSON.parse(new TextDecoder().decode(payload))
          this.onSyncResponse?.(json)
        } catch (e) {
          console.warn('[NativeBridgeClient] invalid sync response JSON:', e)
        }
        break
      }

      default:
        console.warn(`[NativeBridgeClient] unknown frame type: 0x${frameType.toString(16)}`)
    }
  }

  // ========== 帧构建 ==========

  private _sendFrame(frameType: number, channelId: number, payload: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== 1) {
      console.warn('[NativeBridgeClient] cannot send: not connected')
      return
    }

    const frame = new ArrayBuffer(HEADER_SIZE + payload.length)
    const view = new DataView(frame)
    view.setUint8(0, frameType)
    view.setUint16(1, channelId) // big-endian
    view.setUint32(3, payload.length) // big-endian
    new Uint8Array(frame).set(payload, HEADER_SIZE)

    this.ws.send(frame)
  }
}
