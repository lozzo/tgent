/**
 * 类型安全的全局事件总线
 * 所有跨模块通信通过此总线进行，避免模块间直接依赖
 */

/** 连接状态枚举 */
export type ConnectionState =
  | 'IDLE'
  | 'PROBING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'WAITING_NETWORK'
  | 'NEED_LOGIN'
  | 'FAILED'
  | 'RELEASED'

/** 事件类型映射表 */
export interface EventMap {
  'connection:stateChange': {
    key: string
    state: ConnectionState
    prevState: ConnectionState
  }
  'connection:connected': { key: string; mode: 'local' | 'p2p' }
  'connection:disconnected': { key: string }
  'auth:login': {}
  'auth:logout': {}
  'auth:tokenRefreshed': {}
  'auth:sessionExpired': { returnTo?: string }
  'theme:change': { themeId: string }
  'toast:show': {
    message: string
    type?: 'info' | 'success' | 'error'
    duration?: number
  }
  'update:check': {}
  'update:result': {
    status: 'available' | 'latest' | 'error'
    message?: string
  }
  'app:resume': {}
  /** Bridge WS 重连并收到 SYNC_RESPONSE 后触发 — Terminal 应 reattach channel */
  'bridge:recovered': {}
}

type Handler<T> = (data: T) => void

class EventBus {
  private listeners = new Map<string, Set<Handler<any>>>()

  /** 订阅事件，返回取消订阅函数 */
  on<K extends keyof EventMap>(
    event: K,
    handler: Handler<EventMap[K]>,
  ): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(handler)
    return () => {
      set!.delete(handler)
      if (set!.size === 0) this.listeners.delete(event)
    }
  }

  /** 发布事件 */
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const handler of set) {
      try {
        handler(data)
      } catch (err) {
        console.error(`[EventBus] handler error for "${event}":`, err)
      }
    }
  }

  /** 一次性订阅 */
  once<K extends keyof EventMap>(
    event: K,
    handler: Handler<EventMap[K]>,
  ): () => void {
    const off = this.on(event, (data) => {
      off()
      handler(data)
    })
    return off
  }

  /** 清除所有监听器（用于测试） */
  clear(): void {
    this.listeners.clear()
  }
}

export const eventBus = new EventBus()
