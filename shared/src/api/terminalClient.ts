import type { WebRTCTransport } from './transport'
import type { TerminalChannelProxy } from './NativeTransportProxy'
import {
  MSG_INPUT, MSG_RESIZE, MSG_SEND_KEYS,
  MSG_OUTPUT, MSG_PANE_STATE, MSG_PONG, MSG_ERROR,
  MSG_SESSION_EVENT, MSG_PANE_INFO, MSG_PING,
  MSG_PANE_STATE_CHUNK, CHUNK_FLAG_FIRST, CHUNK_FLAG_LAST,
  MSG_TERMINAL_FRAME, MSG_FRAME_CHUNK,
  MSG_PROTOCOL_HELLO,
  MSG_SNAPSHOT,
  SNAPSHOT_FLAG_VIEWPORT_ONLY,
  PONG_FLAG_OUTPUT_WORKER,
} from './protocol'

const terminalTextDecoder = new TextDecoder()
const terminalTextEncoder = new TextEncoder()

export interface TerminalFrame {
  lines: string[]
  scrollback?: string[]
  ansi: boolean
  columns?: number
  rows?: number
  cursor_x?: number
  cursor_y?: number
  cursor_visible: boolean
  application_mode?: boolean
}

export interface PaneInfo {
  pane_id: string
  terminal_id?: string
  provider_kind?: string
  provider_id?: string
  session_id?: string
  window_id?: string
  session_name?: string
  window_name?: string
  window_index?: number
  pane_index?: number
  command: string
  width: number
  height: number
  title: string
  current_path?: string
  viewer_resize?: boolean
  resize_owner?: boolean
}

export interface TerminalClientCallbacks {
  onOutput: (data: Uint8Array) => void
  onPaneState: (data: string, cols: number, rows: number) => void
  onFrame: (frame: TerminalFrame) => void
  onError: (msg: string) => void
  onClose: () => void
  onOpen?: () => void
  onPaneInfo?: (info: PaneInfo) => void
  onPaneClosed?: () => void
  onInputDropped?: () => void
  onRecoveryStart?: () => void
}

export interface TerminalClientRecoveryOptions {
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
  inputProbeDelayMs?: number
  inputRecoveryTimeoutMs?: number
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10000
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 20000
const DEFAULT_INPUT_PROBE_DELAY_MS = 350
const DEFAULT_INPUT_RECOVERY_TIMEOUT_MS = 2500

export class TerminalClient {
  private static readonly MAX_FRAME_BYTES = 16 * 1024 * 1024

  private callbacks: TerminalClientCallbacks
  private webrtcTransport: WebRTCTransport | null = null
  private dc: TerminalChannelProxy | null = null
  private paneId = ''
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private unsubscribe: (() => void) | null = null
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null
  private snapshotRetryCount = 0
  private chunkBuffers: Uint8Array[] = []
  private frameChunkBuffers: Uint8Array[] = []
  private frameChunkBytes = 0
  private assemblingFrame = false
  private frameAssemblyTimer: ReturnType<typeof setTimeout> | null = null
  private inputProbeTimer: ReturnType<typeof setTimeout> | null = null
  private inputRecoveryTimer: ReturnType<typeof setTimeout> | null = null
  private inputProbeActive = false
  private pendingPingAt = 0
  private retryInProgress = false
  private lastCols = 0
  private lastRows = 0
  private readonly heartbeatIntervalMs: number
  private readonly heartbeatTimeoutMs: number
  private readonly inputProbeDelayMs: number
  private readonly inputRecoveryTimeoutMs: number

  constructor(callbacks: TerminalClientCallbacks, recoveryOptions: TerminalClientRecoveryOptions = {}) {
    this.callbacks = callbacks
    this.heartbeatIntervalMs = recoveryOptions.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    this.heartbeatTimeoutMs = recoveryOptions.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS
    this.inputProbeDelayMs = recoveryOptions.inputProbeDelayMs ?? DEFAULT_INPUT_PROBE_DELAY_MS
    this.inputRecoveryTimeoutMs = recoveryOptions.inputRecoveryTimeoutMs ?? DEFAULT_INPUT_RECOVERY_TIMEOUT_MS
  }

  connect(paneId: string, webrtcTransport: WebRTCTransport) {
    this.paneId = paneId
    this.webrtcTransport = webrtcTransport
    this.snapshotRetryCount = 0

    const dc = webrtcTransport.getTerminalChannel(paneId)
    if (!dc) {
      this.callbacks.onClose()
      return
    }
    this.dc = dc

    const onOpen = () => {
      this.sendProtocolHello()
      this.callbacks.onOpen?.()
      this.startPing()
      this.resendLastResize()
    }

    if (dc.readyState === 'open') {
      onOpen()
    } else {
      dc.onopen = onOpen
    }

    // 按 paneId 订阅终端消息
    this.unsubscribe = webrtcTransport.subscribeTerminal(paneId, (msgType, payload) => {
      this.handleMessage(msgType, payload)
    })

    dc.onclose = () => {
      this.clearSnapshotTimer()
      this.stopPing()
      this.callbacks.onClose()
    }

    // 启动快照超时检测（覆盖 DC 打开和快照接收两个阶段）
    this.startSnapshotTimer()
  }

  private handleMessage(msgType: number, payload: Uint8Array) {
    // Any inbound message proves that the receive half of the channel is alive.
    this.pendingPingAt = 0
    switch (msgType) {
      case MSG_OUTPUT:
        this.clearSnapshotTimer()
        this.markTerminalActivity()
        this.callbacks.onOutput(payload)
        break
      case MSG_PANE_STATE: {
        this.clearSnapshotTimer()
        this.markTerminalActivity()
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
        const cols = view.getUint16(0, false)
        const rows = view.getUint16(2, false)
        const text = terminalTextDecoder.decode(payload.subarray(4))
        this.callbacks.onPaneState(text, cols, rows)
        break
      }
      case MSG_PANE_STATE_CHUNK: {
        if (payload.length < 1) break
        const flags = payload[0]
        const chunkData = payload.subarray(1)

        if (flags & CHUNK_FLAG_FIRST) {
          this.chunkBuffers = []
          // 收到第一块即清除超时，说明服务端已响应
          this.clearSnapshotTimer()
          this.markTerminalActivity()
        }
        this.chunkBuffers.push(chunkData)

        if (flags & CHUNK_FLAG_LAST) {
          // 组装完整快照
          const totalLen = this.chunkBuffers.reduce((sum, b) => sum + b.length, 0)
          const full = new Uint8Array(totalLen)
          let offset = 0
          for (const buf of this.chunkBuffers) {
            full.set(buf, offset)
            offset += buf.length
          }
          this.chunkBuffers = []

          // 与 MSG_PANE_STATE 相同格式: cols(2)+rows(2)+text
          const view = new DataView(full.buffer, full.byteOffset, full.byteLength)
          const cols = view.getUint16(0, false)
          const rows = view.getUint16(2, false)
          const text = terminalTextDecoder.decode(full.subarray(4))
          this.callbacks.onPaneState(text, cols, rows)
        }
        break
      }
      case MSG_TERMINAL_FRAME:
        if (payload.byteLength > TerminalClient.MAX_FRAME_BYTES) {
          this.recoverInvalidFrame()
          break
        }
        this.handleFramePayload(payload)
        break
      case MSG_FRAME_CHUNK: {
        if (payload.length < 1) break
        const flags = payload[0]
        if (flags & CHUNK_FLAG_FIRST) {
          this.resetFrameAssembly()
          this.assemblingFrame = true
          this.frameAssemblyTimer = setTimeout(() => this.recoverInvalidFrame(), 6000)
        } else if (!this.assemblingFrame) {
          this.recoverInvalidFrame()
          break
        }
        const chunk = payload.subarray(1)
        this.frameChunkBytes += chunk.byteLength
        if (this.frameChunkBytes > TerminalClient.MAX_FRAME_BYTES) {
          this.recoverInvalidFrame()
          break
        }
        this.frameChunkBuffers.push(chunk)
        if (flags & CHUNK_FLAG_LAST) {
          const full = new Uint8Array(this.frameChunkBytes)
          let offset = 0
          for (const part of this.frameChunkBuffers) {
            full.set(part, offset)
            offset += part.length
          }
          this.resetFrameAssembly()
          this.handleFramePayload(full)
        }
        break
      }
      case MSG_PONG:
        if (!this.inputProbeActive) break
        if (payload[0] === PONG_FLAG_OUTPUT_WORKER) {
          this.clearInputActivityProbe()
          break
        }
        // Backward compatibility: older agents answer ping in the input
        // handler, so an empty PONG cannot prove that output forwarding lives.
        // Ask for one authoritative viewport and wait on the existing timer.
        this.callbacks.onRecoveryStart?.()
        if (!this.sendRaw(new Uint8Array([MSG_SNAPSHOT, SNAPSHOT_FLAG_VIEWPORT_ONLY]).buffer)) {
          this.silentRetry()
        }
        break
      case MSG_ERROR: {
        this.clearSnapshotTimer()
        const msg = terminalTextDecoder.decode(payload)
        if (msg === 'pane_closed' || msg === 'terminal_not_found') {
          this.callbacks.onPaneClosed?.()
        } else if (msg === 'snapshot_failed' || msg === 'terminal_stream_stalled') {
          // The input handler can remain alive after the output goroutine or its
          // subscription has stalled. Rebuild only this pane channel in place.
          this.silentRetry()
        } else {
          this.callbacks.onError(msg)
        }
        break
      }
      case MSG_SESSION_EVENT:
        break
      case MSG_PANE_INFO:
        try {
          const info: PaneInfo = JSON.parse(terminalTextDecoder.decode(payload))
          this.callbacks.onPaneInfo?.(info)
        } catch { /* ignore parse errors */ }
        break
    }
  }

  private handleFramePayload(payload: Uint8Array) {
    try {
      const value: unknown = JSON.parse(terminalTextDecoder.decode(payload))
      if (!this.isTerminalFrame(value)) throw new Error('invalid frame')
      this.clearSnapshotTimer()
      this.markTerminalActivity()
      this.callbacks.onFrame(value)
    } catch {
      this.recoverInvalidFrame()
    }
  }

  private isTerminalFrame(value: unknown): value is TerminalFrame {
    if (!value || typeof value !== 'object') return false
    const frame = value as Partial<TerminalFrame>
    if (!Array.isArray(frame.lines) || !frame.lines.every(line => typeof line === 'string')) return false
    if (frame.scrollback !== undefined && (!Array.isArray(frame.scrollback) || !frame.scrollback.every(line => typeof line === 'string'))) return false
    if (typeof frame.ansi !== 'boolean' || typeof frame.cursor_visible !== 'boolean') return false
    if (frame.application_mode !== undefined && typeof frame.application_mode !== 'boolean') return false
    const validDimension = (dimension: unknown) => dimension === undefined ||
      (Number.isInteger(dimension) && Number(dimension) > 0 && Number(dimension) <= 4096)
    if (!validDimension(frame.columns) || !validDimension(frame.rows)) return false
    const validCoordinate = (coordinate: unknown) => coordinate === undefined ||
      (Number.isInteger(coordinate) && Number(coordinate) >= 0 && Number(coordinate) <= 4095)
    return validCoordinate(frame.cursor_x) && validCoordinate(frame.cursor_y)
  }

  private resetFrameAssembly() {
    if (this.frameAssemblyTimer) clearTimeout(this.frameAssemblyTimer)
    this.frameAssemblyTimer = null
    this.frameChunkBuffers = []
    this.frameChunkBytes = 0
    this.assemblingFrame = false
  }

  private recoverInvalidFrame() {
    this.resetFrameAssembly()
    if (this.snapshotRetryCount < 1 && this.webrtcTransport) {
      this.snapshotRetryCount++
      this.silentRetry()
      return
    }
    this.callbacks.onError('invalid_terminal_frame')
  }

  sendInput(data: string) {
    const payload = terminalTextEncoder.encode(data)
    const msg = new Uint8Array(1 + payload.length)
    msg[0] = MSG_INPUT
    msg.set(payload, 1)
    if (!this.sendRaw(msg.buffer)) {
      this.callbacks.onInputDropped?.()
    } else {
      this.armInputActivityProbe()
    }
  }

  sendKeys(keys: string) {
    const payload = terminalTextEncoder.encode(keys)
    const msg = new Uint8Array(1 + payload.length)
    msg[0] = MSG_SEND_KEYS
    msg.set(payload, 1)
    if (!this.sendRaw(msg.buffer)) {
      this.callbacks.onInputDropped?.()
    } else {
      this.armInputActivityProbe()
    }
  }

  sendResize(cols: number, rows: number, reassert = false) {
    this.lastCols = cols
    this.lastRows = rows
    const msg = new Uint8Array(reassert ? 6 : 5)
    msg[0] = MSG_RESIZE
    const view = new DataView(msg.buffer)
    view.setUint16(1, cols, false)
    view.setUint16(3, rows, false)
    if (reassert) msg[5] = 0x01
    this.sendRaw(msg.buffer)
  }

  requestSnapshot(viewportOnly = false) {
    this.sendRaw(new Uint8Array([
      MSG_SNAPSHOT,
      viewportOnly ? SNAPSHOT_FLAG_VIEWPORT_ONLY : 0,
    ]).buffer)
  }

  private resendLastResize() {
    if (this.lastCols > 0 && this.lastRows > 0) {
      this.sendResize(this.lastCols, this.lastRows)
    }
  }

  private sendProtocolHello() {
    this.sendRaw(new Uint8Array([MSG_PROTOCOL_HELLO, 1, 2]).buffer)
  }

  disconnect() {
    this.clearSnapshotTimer()
    this.clearInputActivityProbe()
    this.resetFrameAssembly()
    this.stopPing()
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.dc) {
      this.dc.onopen = null
      this.dc.onclose = null
      this.dc.onmessage = null
      this.dc.onerror = null
    }
    // unsubscribe owns channel cleanup. An unconditional close by pane ID can race
    // with a replacement TerminalClient and tear down its freshly-bound channel.
    this.dc = null
    this.webrtcTransport = null
  }

  /** 重新绑定到新的 transport（不销毁 xterm，自动恢复终端） */
  rebind(newTransport: WebRTCTransport) {
    // 取消旧订阅和 ping
    this.clearSnapshotTimer()
    this.clearInputActivityProbe()
    this.resetFrameAssembly()
    this.snapshotRetryCount = 0
    this.stopPing()
    this.unsubscribe?.()
    this.unsubscribe = null
    // 清理旧 DC 的事件处理器，防止旧 transport 断开时触发 onClose 干扰新连接
    if (this.dc) {
      this.dc.onopen = null
      this.dc.onclose = null
      this.dc.onmessage = null
      this.dc.onerror = null
    }
    // 不调 closeTerminalChannel — 旧 transport 可能已销毁
    this.dc = null
    this.webrtcTransport = newTransport

    const dc = newTransport.getTerminalChannel(this.paneId)
    if (!dc) {
      this.callbacks.onClose()
      return
    }
    this.dc = dc

    const onOpen = () => {
      this.sendProtocolHello()
      this.callbacks.onOpen?.()
      this.startPing()
      this.resendLastResize()
    }

    if (dc.readyState === 'open') {
      onOpen()
    } else {
      dc.onopen = onOpen
    }

    this.unsubscribe = newTransport.subscribeTerminal(this.paneId, (msgType, payload) => {
      this.handleMessage(msgType, payload)
    })

    dc.onclose = () => {
      this.clearSnapshotTimer()
      this.stopPing()
      this.callbacks.onClose()
    }

    // 启动快照超时检测
    this.startSnapshotTimer()
  }

  /**
   * 轻量级重新绑定 — 只重建 bridge channel 映射，不清屏、不重载 snapshot。
   * 用于 verify 恢复场景：WebRTC 连接没断，终端数据没变，只需恢复发送路径。
   */
  reattach(transport: WebRTCTransport) {
    this.clearSnapshotTimer()
    this.clearInputActivityProbe()
    this.resetFrameAssembly()
    this.stopPing()

    // 清理旧 DC 事件（不 close channel — bridge 侧可能已失效）
    if (this.dc) {
      this.dc.onopen = null
      this.dc.onclose = null
      this.dc.onmessage = null
      this.dc.onerror = null
    }
    this.dc = null
    this.webrtcTransport = transport

    // 获取新 DC（TerminalChannelProxy 带当前 generation）
    const dc = transport.getTerminalChannel(this.paneId)
    if (!dc) return
    this.dc = dc

    const onOpen = () => {
      this.sendProtocolHello()
      this.startPing()
      // 不 sendResize、不 startSnapshotTimer — 终端尺寸和内容未变
    }

    if (dc.readyState === 'open') {
      onOpen()
    } else {
      dc.onopen = onOpen
    }

    // 重新绑定接收路径
    // 注意：不调旧 unsubscribe — bridge WS 已重连，旧 channel 状态已清空。
    // 调旧的会错误地 closeChannelByLabel + 删除 openTerminalChannels 刚注册的 subscriber。
    this.unsubscribe = null
    this.unsubscribe = transport.subscribeTerminal(this.paneId, (msgType, payload) => {
      this.handleMessage(msgType, payload)
    })

    dc.onclose = () => {
      this.stopPing()
      this.callbacks.onClose()
    }
  }

  private sendRaw(data: ArrayBuffer): boolean {
    if (this.dc?.readyState === 'open') {
      this.dc.send(data)
      return true
    }
    return false
  }

  private startPing() {
    this.stopPing()
    this.pendingPingAt = 0
    this.sendPing()
    this.pingInterval = setInterval(() => this.sendPing(), this.heartbeatIntervalMs)
  }

  private sendPing() {
    const now = Date.now()
    if (this.pendingPingAt > 0) {
      if (now - this.pendingPingAt >= this.heartbeatTimeoutMs) {
        this.pendingPingAt = 0
        this.silentRetry()
      }
      return
    }
    if (this.sendRaw(new Uint8Array([MSG_PING]).buffer)) {
      this.pendingPingAt = now
    }
  }

  /**
   * An interactive terminal normally emits an echo or a frame after input. If
   * it does not, probe the terminal receive path without touching the screen.
   * This avoids treating password prompts and other no-echo modes as failures.
   */
  private armInputActivityProbe() {
    if (this.inputProbeActive) return
    this.inputProbeActive = true
    this.inputProbeTimer = setTimeout(() => {
      this.inputProbeTimer = null
      if (!this.inputProbeActive) return
      if (!this.sendRaw(new Uint8Array([MSG_PING]).buffer)) {
        this.silentRetry()
        return
      }
      this.inputRecoveryTimer = setTimeout(() => {
        this.inputRecoveryTimer = null
        if (this.inputProbeActive) this.silentRetry()
      }, this.inputRecoveryTimeoutMs)
    }, this.inputProbeDelayMs)
  }

  private markTerminalActivity() {
    this.snapshotRetryCount = 0
    this.clearInputActivityProbe()
  }

  private clearInputActivityProbe() {
    this.inputProbeActive = false
    if (this.inputProbeTimer) clearTimeout(this.inputProbeTimer)
    if (this.inputRecoveryTimer) clearTimeout(this.inputRecoveryTimer)
    this.inputProbeTimer = null
    this.inputRecoveryTimer = null
  }

  /** 启动快照超时检测：覆盖 DC 打开 + 服务端响应两个阶段 */
  private startSnapshotTimer() {
    this.clearSnapshotTimer()
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null
      if (this.snapshotRetryCount < 1 && this.webrtcTransport) {
        this.snapshotRetryCount++
        this.silentRetry()
      } else {
        this.callbacks.onError('snapshot_timeout')
      }
    }, 6000)
  }

  private clearSnapshotTimer() {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer)
      this.snapshotTimer = null
    }
  }

  /** 静默重试：关闭当前 DataChannel 并重新创建，不触发 onClose 回调 */
  private silentRetry() {
    if (this.retryInProgress) return
    if (!this.webrtcTransport || !this.paneId) {
      this.callbacks.onError('snapshot_timeout')
      return
    }
    this.retryInProgress = true
    this.callbacks.onRecoveryStart?.()
    this.clearSnapshotTimer()
    this.clearInputActivityProbe()
    this.stopPing()
    this.resetFrameAssembly()
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.dc) {
      this.dc.onopen = null
      this.dc.onclose = null
    }
    this.dc = null
    this.webrtcTransport.closeTerminalChannel(this.paneId)

    const dc = this.webrtcTransport.getTerminalChannel(this.paneId)
    if (!dc) {
      this.retryInProgress = false
      this.callbacks.onError('snapshot_timeout')
      return
    }
    this.dc = dc

    const onOpen = () => {
      this.sendProtocolHello()
      this.callbacks.onOpen?.()
      this.startPing()
      this.resendLastResize()
    }

    if (dc.readyState === 'open') {
      onOpen()
    } else {
      dc.onopen = onOpen
    }

    this.unsubscribe = this.webrtcTransport.subscribeTerminal(this.paneId, (msgType, payload) => {
      this.handleMessage(msgType, payload)
    })

    dc.onclose = () => {
      this.clearSnapshotTimer()
      this.stopPing()
      this.callbacks.onClose()
    }

    // 重试后重新启动超时检测
    this.startSnapshotTimer()
    this.retryInProgress = false
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
    this.pendingPingAt = 0
  }
}
