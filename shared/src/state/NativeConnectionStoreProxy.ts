/**
 * NativeConnectionStoreProxy — 单连接的 JS 代理 Store
 *
 * 接收 Native 侧通过 WS Bridge 和 Plugin 推送的状态更新，
 * 维护 ConnectionSnapshot，通过 useSyncExternalStore 暴露给 React。
 *
 * 完全信任 Native 推送的状态，不做任何 JS 侧 verify/override。
 * JS 解冻后由 Manager 同步 Native 全量状态；Bridge 已断开时才重连，
 * 不需要 proxy 层参与。
 */

import type { ConnectionSnapshot } from './connectionTypes'
import type { NativeSnapshot } from '../plugins/nativeConnection'
import type { WebRTCTransport } from '../api/transport'
import type { ServerApi } from '../api/client'
import { api, createP2PServerApi } from '../api/client'
import { AgentDataStore } from './AgentDataStore'
import { eventBus } from './EventBus'

/**
 * 从 NativeSnapshot 转换为 ConnectionSnapshot
 */
function toConnectionSnapshot(
  native: NativeSnapshot,
  transport: WebRTCTransport | undefined,
  serverApi: ServerApi,
  agentStore: AgentDataStore,
): ConnectionSnapshot {
  return {
    phase: native.phase as ConnectionSnapshot['phase'],
    transport,
    serverApi,
    statusText: native.statusText,
    connectionMode: native.connectionMode,
    isConnected: native.phase === 'connected',
    isRecovering: native.isRecovering,
    isFailed: native.phase === 'failed',
    needLogin: native.needLogin,
    needSubscription: native.needSubscription ?? false,
    reconnectAttempt: native.reconnectAttempt,
    agentStore,
    allowRelayTransfer: native.allowRelayTransfer,
  }
}

/** 默认快照 */
const DEFAULT_NATIVE_SNAPSHOT: NativeSnapshot = {
  storeKey: '',
  phase: 'idle',
  statusText: '准备连接...',
  connectionMode: null,
  reconnectAttempt: 0,
  isRecovering: false,
  needLogin: false,
  allowRelayTransfer: false,
}

export class NativeConnectionStoreProxy {
  readonly serverType: 'local' | 'hub'
  readonly serverId: string
  readonly agentStore = new AgentDataStore()

  private _nativeSnapshot: NativeSnapshot = { ...DEFAULT_NATIVE_SNAPSHOT }
  private _transport: WebRTCTransport | undefined
  private _serverApi: ServerApi = api
  private _listeners = new Set<() => void>()
  private _snapshotVersion = 0
  private _cachedSnapshot?: ConnectionSnapshot
  private _cachedSnapshotVersion = -1
  private _lastNativeVersion = -1

  constructor(serverType: 'local' | 'hub', serverId: string) {
    this.serverType = serverType
    this.serverId = serverId
    this._nativeSnapshot.storeKey = `${serverType}:${serverId}`
  }

  // ========== Native 状态更新 ==========

  /** Native 推送状态更新时调用 */
  updateFromNative(snapshot: NativeSnapshot, opts?: { batch?: boolean }): void {
    // version 检查：丢弃过期的更新
    if (snapshot.version !== undefined && snapshot.version <= this._lastNativeVersion) {
      return
    }
    this._lastNativeVersion = snapshot.version ?? this._lastNativeVersion

    const wasConnected = this._nativeSnapshot.phase === 'connected'
    const isConnected = snapshot.phase === 'connected'
    const key = `${this.serverType}:${this.serverId}`

    this._nativeSnapshot = snapshot
    this._snapshotVersion++

    // 连接状态变化时处理 transport 和 agentStore
    if (isConnected) {
      if (this._transport) {
        // 无论之前是否 connected，都重新 bind。
        // 场景：JS bridge 断线重连后，store phase 从未离开 connected（bridge 断线不改变 store phase），
        // 但 native 侧可能经历了 transport 重建。需要重新 bind 以刷新 session 数据和事件订阅。
        this._serverApi = createP2PServerApi(this._transport)
        this.agentStore.bind(this._serverApi, this._transport)
      }
      if (!wasConnected) {
        // 首次连接或从断线恢复 — 通知 EventBus
        const mode = (snapshot.connectionMode as 'local' | 'p2p') ?? 'local'
        eventBus.emit('connection:connected', { key, mode })
      }
    } else if (wasConnected && !isConnected) {
      // 连接断开
      this.agentStore.unbind()
      eventBus.emit('connection:disconnected', { key })
    }

    if (!opts?.batch) this._notify()
  }

  /** 在 batch 模式更新后统一触发 notify */
  flushBatchNotify(): void {
    this._notify()
  }

  /** 设置 transport（由 NativeConnectionStoreManager 在 bridge 连接后调用） */
  setTransport(transport: WebRTCTransport | undefined): void {
    this._transport = transport
    if (transport) {
      this._serverApi = createP2PServerApi(transport)
      // 如果已经处于 connected 状态，立即绑定 agentStore
      if (this._nativeSnapshot.phase === 'connected') {
        this.agentStore.bind(this._serverApi, transport)
      }
    } else {
      this._serverApi = api
    }
    this._snapshotVersion++
    this._notify()
  }

  // ========== React 集成（与 ConnectionStore 接口一致） ==========

  subscribe(callback: () => void): () => void {
    this._listeners.add(callback)
    return () => { this._listeners.delete(callback) }
  }

  getSnapshot(): ConnectionSnapshot {
    if (this._cachedSnapshotVersion === this._snapshotVersion && this._cachedSnapshot) {
      return this._cachedSnapshot
    }
    this._cachedSnapshot = toConnectionSnapshot(
      this._nativeSnapshot,
      this._transport,
      this._serverApi,
      this.agentStore,
    )
    this._cachedSnapshotVersion = this._snapshotVersion
    return this._cachedSnapshot
  }

  // ========== 资源释放 ==========

  release(): void {
    // 如果释放时仍处于连接状态，发送断开事件
    if (this._nativeSnapshot.phase === 'connected') {
      eventBus.emit('connection:disconnected', { key: `${this.serverType}:${this.serverId}` })
    }
    this.agentStore.destroy()
    this._listeners.clear()
  }

  // ========== 内部 ==========

  private _notify(): void {
    for (const fn of this._listeners) {
      fn()
    }
  }
}
