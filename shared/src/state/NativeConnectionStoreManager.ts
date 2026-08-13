/**
 * NativeConnectionStoreManager — 管理 NativeConnectionStoreProxy 实例
 *
 * API 与 ConnectionStoreManager 完全兼容，
 * useConnectionStore.ts 和 TerminalPage.tsx 无需修改。
 *
 * 核心改动（对比旧版）：
 * 每个 Store 有独立的 NativeTransportProxy，通过 store-scoped 的 channel label
 * （api:{storeKey}, events:{storeKey}, terminal:{storeKey}:{paneId}）
 * 让 Native 侧路由到对应的 WebRTC 连接，消除"串台"。
 */

import { NativeConnectionStoreProxy } from './NativeConnectionStoreProxy'
import { NativeBridgeClient } from './NativeBridgeClient'
import { NativeTransportProxy } from '../api/NativeTransportProxy'
import type { NativeSnapshot } from '../plugins/nativeConnection'
import type { GoEngineBackend } from './GoEngineBackend'
import type { SyncResponsePayload } from './NativeBridgeClient'
import { FileTransferStore } from './FileTransferStore'
import { eventBus } from './EventBus'
import type { ConnectionSnapshot } from './connectionTypes'
import { findLocalServerById, type LocalServer } from '../lib/localServers'
import type { NetworkState } from './NetworkStateManager'

function makeKey(serverType: string, serverId: string): string {
  return `${serverType}:${serverId}`
}

export class NativeConnectionStoreManager {
  private stores = new Map<string, NativeConnectionStoreProxy>()
  private transportProxies = new Map<string, NativeTransportProxy>()
  private fileTransferStores = new Map<string, FileTransferStore>()
  private transportUnsubscribers = new Map<string, () => void>()
  private eventCleanups: (() => void)[] = []
  private globalListeners = new Set<() => void>()
  private globalSnapshotVersion = 0
  private cachedGlobalSnapshot?: { transfers: { serverId: string; transfer: import('../types/files').TransferInfo }[]; hasActive: boolean }
  private cachedGlobalSnapshotVersion = -1

  // Bridge 客户端（共享）
  private bridgeClient: NativeBridgeClient | null = null
  private pluginListenerHandle: any = null

  constructor(private backend: GoEngineBackend) {
    this._subscribeEvents()
    this._initBridge()
  }

  // ========== Bridge 初始化 ==========

  private async _initBridge(): Promise<void> {
    try {
      this.bridgeClient = await this.backend.getBridgeClient()
      if (this.bridgeClient) {
        // 注册 SYNC_RESPONSE 回调
        this.bridgeClient.onSyncResponse = (data) => this._handleSyncResponse(data)

        // Bridge 生命周期管理（从 NativeTransportProxy 上移到 Manager）
        let bridgeWasReady = false
        this.bridgeClient.onReady = () => {
          const reconnecting = bridgeWasReady
          bridgeWasReady = true
          console.log(`[NativeStoreManager] bridge ${reconnecting ? 'reconnected' : 'ready'}, init all proxies`)
          for (const proxy of this.transportProxies.values()) {
            void (reconnecting ? proxy.reinitChannels() : proxy.initChannels())
          }
          // 请求文件传输状态同步
          this.bridgeClient!.sendTransferRequest({ action: 'sync_request' })
          // 请求全量状态快照
          this.bridgeClient!.sendSyncRequest()
        }

        this.bridgeClient.onDisconnected = () => {
          console.log('[NativeStoreManager] bridge disconnected')
          for (const proxy of this.transportProxies.values()) {
            proxy.onBridgeDisconnected()
          }
        }

        this.bridgeClient.connect()

        // 为已有的 stores 创建 transport proxy
        for (const [key, store] of this.stores) {
          if (!this.transportProxies.has(key)) {
            const proxy = new NativeTransportProxy(this.bridgeClient, key, () => this.backend.getConnectionInfo(key))
            this.transportProxies.set(key, proxy)
            store.setTransport(proxy as any)
            proxy.initChannels()
          }
        }
      }
    } catch (e) {
      console.warn('[NativeStoreManager] failed to init bridge:', e)
    }

    // 监听 Plugin 事件
    try {
      this.pluginListenerHandle = await this.backend.addStateListener(
        (data: NativeSnapshot) => this._handleNativeStateUpdate(data),
      )
    } catch (e) {
      console.warn('[NativeStoreManager] failed to add plugin listener:', e)
    }
  }

  private _handleNativeStateUpdate(snapshot: NativeSnapshot): void {
    const store = this.stores.get(snapshot.storeKey)
    if (store) {
      const wasConnected = store.getSnapshot().isConnected
      const willConnect = !wasConnected && snapshot.phase === 'connected'

      // 首次连接只需确保初始化已经开始。Bridge 真正重连时才重建通道，
      // 避免 connected 状态与 onReady 并发覆盖 _channelsReady。
      if (willConnect) {
        const proxy = this.transportProxies.get(snapshot.storeKey)
        if (proxy) {
          void proxy.initChannels()
          proxy.openTerminalChannels()
        }
      }

      store.updateFromNative(snapshot)
    }
  }

  // ========== Store 管理（与 ConnectionStoreManager 接口一致） ==========

  ensureStore(serverType: 'local' | 'hub', serverId: string, localServer?: LocalServer): NativeConnectionStoreProxy {
    const key = makeKey(serverType, serverId)
    let store = this.stores.get(key)
    if (store) return store

    console.log('[NativeStoreManager] ensureStore:', key, 'localServer=', !!localServer)
    store = new NativeConnectionStoreProxy(serverType, serverId)
    this.stores.set(key, store)

    // 创建 per-store transport proxy
    if (this.bridgeClient) {
      const proxy = new NativeTransportProxy(this.bridgeClient, key, () => this.backend.getConnectionInfo(key))
      this.transportProxies.set(key, proxy)
      store.setTransport(proxy as any)
      proxy.initChannels()
    }

    // 通知 Native 侧创建连接
    // 如果未传入 localServer 且是 local 模式，异步查找（与 JS ConnectionStore.connect() 对齐）
    const doConnect = (ls?: LocalServer) => {
      this.backend.connect(
        serverType,
        serverId,
        ls ? JSON.stringify(ls) : undefined,
      ).then(() => {
        console.log('[NativeStoreManager] connect resolved:', key)
      }).catch((e) => {
        console.warn('[NativeStoreManager] connect rejected:', key, e)
      })
    }

    if (localServer) {
      doConnect(localServer)
    } else if (serverType === 'local') {
      findLocalServerById(serverId).then((ls) => {
        doConnect(ls ?? undefined)
      })
    } else {
      doConnect()
    }

    // FileTransferStore 同步
    const ftStore = this.fileTransferStores.get(key)
    if (ftStore) this._syncTransport(key, ftStore)

    return store
  }

  releaseStore(serverType: 'local' | 'hub', serverId: string): void {
    const key = makeKey(serverType, serverId)
    const store = this.stores.get(key)
    if (!store) return
    store.release()
    this.stores.delete(key)

    // 释放对应的 transport proxy
    const proxy = this.transportProxies.get(key)
    if (proxy) {
      proxy.disconnect()
      this.transportProxies.delete(key)
    }

    this.backend.release(serverType, serverId).catch(() => {})
  }

  releaseHubStores(): void {
    const keysToRelease: string[] = []
    for (const [key, store] of this.stores) {
      const snap = store.getSnapshot()
      let shouldRelease = false
      if (store.serverType === 'hub') {
        shouldRelease = true
      } else if (store.serverType === 'local') {
        if (snap.connectionMode === 'p2p' || snap.needLogin) {
          shouldRelease = true
        }
      }
      if (shouldRelease) {
        keysToRelease.push(key)
        store.release()
        this.stores.delete(key)
        const proxy = this.transportProxies.get(key)
        if (proxy) {
          proxy.disconnect()
          this.transportProxies.delete(key)
        }
      }
    }
    if (keysToRelease.length > 0) {
      this.backend.releaseStores(keysToRelease).catch(() => {})
    }
  }

  releaseAllStores(): void {
    for (const [, store] of this.stores) {
      store.release()
    }
    this.stores.clear()
    for (const proxy of this.transportProxies.values()) {
      proxy.disconnect()
    }
    this.transportProxies.clear()
    this.backend.releaseAll().catch(() => {})
  }

  // ========== 网络状态响应 ==========

  onNetworkStateChange(curr: NetworkState, _prev: NetworkState): void {
    this.backend.network(curr.phoneOnline).catch(() => {})
    this.backend.lifecycle(curr.appActive, Boolean(curr.resumeType || curr.jsFrozenRecovery)).catch(() => {})
    if (!curr.resumeType && !curr.jsFrozenRecovery) return

    const bridge = this.bridgeClient
    if (!bridge) return

    // Android 进入后台时 JS 定时器会正常暂停，但 Native Bridge 仍在运行。
    // 健康连接只需补一次全量状态，避免每次回前台都销毁通道并触发 WebView 重绘。
    if (bridge.isConnected) {
      bridge.sendTransferRequest({ action: 'sync_request' })
      bridge.sendSyncRequest()
      return
    }

    bridge.forceReconnect()
  }

  // ========== React 集成 ==========

  subscribe(serverType: 'local' | 'hub', serverId: string, callback: () => void): () => void {
    const store = this.ensureStore(serverType, serverId)
    return store.subscribe(callback)
  }

  getSnapshot(serverType: 'local' | 'hub', serverId: string): ConnectionSnapshot {
    const store = this.ensureStore(serverType, serverId)
    return store.getSnapshot()
  }

  retryConnection(serverType: 'local' | 'hub', serverId: string): void {
    this.backend.retry(serverType, serverId).catch(() => {})
    const key = makeKey(serverType, serverId)
    const store = this.stores.get(key)
    if (store) {
      store.updateFromNative({
        storeKey: key,
        phase: 'reconnecting',
        statusText: '正在重试连接...',
        connectionMode: null,
        reconnectAttempt: 0,
        isRecovering: false,
        needLogin: false,
        allowRelayTransfer: false,
      })
    }
  }

  preconnect(serverType: 'local' | 'hub', serverId: string, localServer?: LocalServer): void {
    this.ensureStore(serverType, serverId, localServer)
  }

  // ========== FileTransferStore 管理 ==========

  getFileTransferStore(serverType: 'local' | 'hub', serverId: string): FileTransferStore {
    const key = makeKey(serverType, serverId)
    let ftStore = this.fileTransferStores.get(key)
    if (ftStore) return ftStore

    ftStore = new FileTransferStore()
    ftStore.setStoreKey(key)
    ftStore.setBridge(this.bridgeClient)
    this.fileTransferStores.set(key, ftStore)

    const connStore = this.stores.get(key)
    if (connStore) {
      const snap = connStore.getSnapshot()
      ftStore.setTransport(snap.transport)
    }

    this._syncTransport(key, ftStore)

    ftStore.subscribe(() => {
      this.globalSnapshotVersion++
      for (const fn of this.globalListeners) fn()
    })

    return ftStore
  }

  subscribeGlobalTransfers(listener: () => void): () => void {
    this.globalListeners.add(listener)
    return () => { this.globalListeners.delete(listener) }
  }

  getGlobalTransfersSnapshot(): { transfers: { serverId: string; transfer: import('../types/files').TransferInfo }[]; hasActive: boolean } {
    if (this.cachedGlobalSnapshotVersion === this.globalSnapshotVersion && this.cachedGlobalSnapshot) {
      return this.cachedGlobalSnapshot
    }
    const transfers: { serverId: string; transfer: import('../types/files').TransferInfo }[] = []
    let hasActive = false
    for (const [key, ftStore] of this.fileTransferStores) {
      const snap = ftStore.getSnapshot()
      const serverId = key.split(':').slice(1).join(':')
      for (const t of snap.transfers) {
        transfers.push({ serverId, transfer: t })
      }
      if (snap.hasActiveTransfers) hasActive = true
    }
    this.cachedGlobalSnapshot = { transfers, hasActive }
    this.cachedGlobalSnapshotVersion = this.globalSnapshotVersion
    return this.cachedGlobalSnapshot
  }

  dispatchTransferAction(transferId: string, action: 'cancel' | 'dismiss' | 'retry'): void {
    for (const ftStore of this.fileTransferStores.values()) {
      const snap = ftStore.getSnapshot()
      if (snap.transfers.some(t => t.id === transferId)) {
        if (action === 'cancel') ftStore.cancelTransfer(transferId)
        else if (action === 'dismiss') ftStore.dismissTransfer(transferId)
        else if (action === 'retry') ftStore.retryTransfer(transferId)
        return
      }
    }
  }

  private _syncTransport(key: string, ftStore: FileTransferStore): void {
    const connStore = this.stores.get(key)
    if (!connStore) return

    const oldUnsub = this.transportUnsubscribers.get(key)
    if (oldUnsub) oldUnsub()

    let lastTransport = connStore.getSnapshot().transport
    const unsub = connStore.subscribe(() => {
      const snap = connStore.getSnapshot()
      if (snap.transport !== lastTransport) {
        lastTransport = snap.transport
        ftStore.setTransport(snap.transport)
      }
    })
    this.transportUnsubscribers.set(key, unsub)
  }

  // ========== SYNC_RESPONSE 处理 ==========

  private _handleSyncResponse(payload: SyncResponsePayload): void {
    console.log('[NativeStoreManager] handleSyncResponse:', payload.stores?.length, 'stores')

    let hasConnected = false
    for (const storeData of payload.stores ?? []) {
      const storeKey = storeData.storeKey as string
      if (!storeKey) continue
      const proxy = this.stores.get(storeKey)
      if (proxy) {
        proxy.updateFromNative(storeData as unknown as NativeSnapshot, { batch: true })
        if (storeData.phase === 'connected') hasConnected = true
      }
    }

    // 统一 notify React subscribers
    for (const proxy of this.stores.values()) {
      proxy.flushBatchNotify()
    }

    // 对 connected 的 store，重建其终端通道
    if (hasConnected) {
      for (const [key, transportProxy] of this.transportProxies) {
        const store = this.stores.get(key)
        if (store?.getSnapshot().isConnected) {
          transportProxy.openTerminalChannels()
        }
      }
    }

    // 通知已挂载的 Terminal 重建 bridge channel 发送路径
    eventBus.emit('bridge:recovered', {})
  }

  // ========== 事件订阅 ==========

  private _subscribeEvents(): void {
    this.eventCleanups.push(
      eventBus.on('auth:logout', () => {
        this.releaseHubStores()
      }),
    )
    this.eventCleanups.push(
      eventBus.on('auth:sessionExpired', () => {
        this.releaseHubStores()
      }),
    )
  }

  destroy(): void {
    this.releaseAllStores()
    for (const unsub of this.transportUnsubscribers.values()) unsub()
    this.transportUnsubscribers.clear()
    this.fileTransferStores.clear()
    this.globalListeners.clear()
    this.eventCleanups.forEach((fn) => fn())
    this.eventCleanups = []

    if (this.bridgeClient) {
      this.bridgeClient.destroy()
      this.bridgeClient = null
    }
    if (this.pluginListenerHandle) {
      this.pluginListenerHandle.remove?.()
      this.pluginListenerHandle = null
    }
    this.backend.destroy()
  }
}
