import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { isLoggedIn, getWebToken, isWailsApp, validateLocalTGent, type LocalTGentValidation } from '../lib/platform'
import { attachHubIdentity, getLocalServers, removeLocalServer, type LocalServer } from '../lib/localServers'
import { webApi, type AgentInfo } from '../api/client'
import { useNetworkState } from './useNetworkState'
import { eventBus } from '../state/EventBus'
import { storage } from '../lib/storage'

const SERVERS_CACHE_KEY = 'tgent_servers_cache'

async function probeLocalTGent(address: string, password = ''): Promise<LocalTGentValidation> {
  if (isWailsApp()) {
    return validateLocalTGent(address, password)
  }
  const response = await fetch(`${address}/api/v1/status`, {
    signal: AbortSignal.timeout(5000),
    mode: 'cors',
  })
  return { ok: response.ok, requiresPassword: response.status === 401 }
}

export type OnlineStatus = 'checking' | 'online' | 'offline'

export interface ServerCard {
  type: 'local' | 'hub'
  id: string
  name: string
  addr?: string
  online: OnlineStatus
  hubOnline?: boolean
  localServer?: LocalServer
  agentInfo?: AgentInfo
  needPair?: boolean
}

function serverCardKey(card: ServerCard): string {
  return `${card.type}:${card.id}`
}

function sameServerCard(a: ServerCard, b: ServerCard): boolean {
  return a.type === b.type && a.id === b.id && a.name === b.name && a.addr === b.addr &&
    a.online === b.online && a.hubOnline === b.hubOnline && a.needPair === b.needPair &&
    JSON.stringify(a.localServer) === JSON.stringify(b.localServer) &&
    JSON.stringify(a.agentInfo) === JSON.stringify(b.agentInfo)
}

/** 按稳定 ID 对账，未变化的卡片继续复用原对象。 */
export function reconcileServerCards(previous: ServerCard[], incoming: ServerCard[]): ServerCard[] {
  const previousMap = new Map(previous.map(card => [serverCardKey(card), card]))
  const next = incoming.map(card => {
    const existing = previousMap.get(serverCardKey(card))
    if (!existing) return card

    // 本地探测结果在后台刷新期间继续有效，不能先退回 checking 造成状态闪烁。
    const candidate = card.online === 'checking' && existing.online !== 'checking'
      ? {
          ...card,
          online: existing.online,
          addr: card.addr || existing.addr,
          hubOnline: card.hubOnline ?? existing.hubOnline,
        }
      : card
    return sameServerCard(existing, candidate) ? existing : candidate
  })
  const unchanged = next.length === previous.length && next.every((card, index) => card === previous[index])
  return unchanged ? previous : next
}

/** 从存储读取缓存的服务器列表，online 状态重置为 checking */
async function loadCachedServers(): Promise<ServerCard[]> {
  try {
    const raw = await storage.get(SERVERS_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ServerCard[]
    return parsed.map(s => ({ ...s, online: 'checking' as OnlineStatus }))
  } catch {
    return []
  }
}

/** 保存服务器列表到存储（online 状态重置为 checking） */
async function saveCachedServers(cards: ServerCard[]): Promise<void> {
  try {
    const toCache = cards.map(s => ({ ...s, online: 'checking' }))
    await storage.set(SERVERS_CACHE_KEY, JSON.stringify(toCache))
  } catch {}
}

const SERVER_ORDER_KEY = 'tgent_server_order'

export interface UseServerListReturn {
  servers: ServerCard[]
  loading: boolean
  hubLoadError: boolean
  loggedIn: boolean
  refresh: () => Promise<void>
  removeServer: (card: ServerCard) => Promise<void>
  confirmDelete: () => Promise<void>
  deleteConfirmTarget: ServerCard | null
  setDeleteConfirmTarget: (card: ServerCard | null) => void
  reorderServers: (activeId: string, overId: string) => void
}

export function useServerList(): UseServerListReturn {
  const navigate = useNavigate()

  const [servers, setServers] = useState<ServerCard[]>([])
  const [loading, setLoading] = useState(true)
  const [hubLoadError, setHubLoadError] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [refreshCounter, setRefreshCounter] = useState(0)
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<ServerCard | null>(null)
  const serversRef = useRef<ServerCard[]>([])
  const loadRequestRef = useRef(0)
  const identityReconcileRef = useRef(Promise.resolve())
  const hasCompletedLoadRef = useRef(false)
  serversRef.current = servers

  const loadServers = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    const previous = serversRef.current
    if (!hasCompletedLoadRef.current && previous.length === 0) setLoading(true)
    const cards: ServerCard[] = []
    let hubLoadFailed = false

    // 加载本地服务器，收集已有的 hubAgentId 用于去重
    const locals = await getLocalServers()
    const localHubAgentIds = new Set<string>()
    for (const ls of locals) {
      if (ls.hubAgentId) localHubAgentIds.add(ls.hubAgentId)
      if (ls.disabled) continue
      const existing = previous.find(card => card.type === 'local' && card.id === ls.id)
      cards.push({
        type: 'local',
        id: ls.id,
        name: ls.name,
        addr: ls.addr || existing?.addr,
        online: existing?.online || 'checking',
        hubOnline: existing?.hubOnline,
        localServer: ls,
        needPair: !!(ls.hubAgentId && !ls.privateKeySeed && !ls.pairCode),
      })
    }

    // 如果已登录，从 tgent-web 加载 Agent 列表（跳过已存在于本地的）
    const webToken = await getWebToken()
    if (webToken) {
      try {
        // 同时获取订阅状态（缓存到 client 中）
        webApi.getMe().catch(() => {})
        const agents = await webApi.listAgents()
        for (const a of agents || []) {
          if (localHubAgentIds.has(a.id)) {
            // 合并在线状态到对应的本地服务器卡片
            const idx = cards.findIndex(c => c.localServer?.hubAgentId === a.id)
            if (idx >= 0) {
              cards[idx].hubOnline = a.online
              const ls = cards[idx].localServer
              const hasLocalAddr = !!ls?.addr || !!ls?.localAddrs?.length
              if (a.online) {
                cards[idx].online = 'online'
              } else if (!hasLocalAddr) {
                cards[idx].online = 'offline'
              }
            }
            continue
          }
          cards.push({
            type: 'hub',
            id: a.id,
            name: a.name || a.hostname,
            online: a.online ? 'online' : 'offline',
            agentInfo: a,
            needPair: true, // 本地无此 agent 的密钥记录，需要扫码配对
          })
        }
      } catch {
        hubLoadFailed = true
        // 网络抖动时保留上一次的 Hub 卡片，不能把机器从列表中短暂移除。
        for (const previousCard of previous) {
          if (previousCard.type === 'hub' && !cards.some(card => serverCardKey(card) === serverCardKey(previousCard))) {
            cards.push(previousCard)
          }
        }
      }
    }

    // 应用持久化排序
    try {
      const orderRaw = await storage.get(SERVER_ORDER_KEY)
      if (orderRaw) {
        const order = JSON.parse(orderRaw) as string[]
        const orderMap = new Map(order.map((id, idx) => [id, idx]))
        cards.sort((a, b) => {
          const ai = orderMap.get(a.id) ?? Infinity
          const bi = orderMap.get(b.id) ?? Infinity
          return ai - bi
        })
      }
    } catch {}

    const currentlyLoggedIn = await isLoggedIn()
    if (requestId !== loadRequestRef.current) return

    setServers(current => {
      const next = reconcileServerCards(current, cards)
      serversRef.current = next
      return next
    })
    void saveCachedServers(cards)
    setHubLoadError(hubLoadFailed)
    hasCompletedLoadRef.current = true
    setLoading(false)
    setLoggedIn(currentlyLoggedIn)

    // 移动端保留首次引导；桌面端直接进入首页探测本机 TGent。
    if (!isWailsApp() && cards.length === 0 && !webToken && !(await storage.get('tgent_welcome_seen'))) {
      await storage.set('tgent_welcome_seen', '1')
      navigate('/welcome', { replace: true })
    }
  }, [navigate])

  useEffect(() => { loadServers() }, [loadServers])

  // 初始化时加载缓存
  useEffect(() => {
    loadCachedServers().then(cached => {
      if (cached.length > 0) {
        setServers(current => {
          if (hasCompletedLoadRef.current || current.length > 0) return current
          const next = reconcileServerCards(current, cached)
          serversRef.current = next
          return next
        })
      }
    })
  }, [])

  // networkReady 恢复时刷新列表（替代原来的 useAppResume）
  const networkState = useNetworkState()
  const prevNetworkReadyRef = useRef(networkState.networkReady)
  const loadServersRef = useRef(loadServers)
  loadServersRef.current = loadServers
  useEffect(() => {
    const wasReady = prevNetworkReadyRef.current
    prevNetworkReadyRef.current = networkState.networkReady
    // networkReady 从 false 变为 true → 刷新
    if (networkState.networkReady && !wasReady) {
      loadServersRef.current()
      setRefreshCounter(c => c + 1)
    }
  }, [networkState.networkReady])

  // 登出时刷新列表（移除纯 hub 服务后需要更新 UI）
  useEffect(() => {
    const cleanup = eventBus.on('auth:logout', () => {
      loadServersRef.current()
    })
    return cleanup
  }, [])

  // App 从后台恢复时刷新列表 + 订阅状态
  useEffect(() => {
    const cleanup = eventBus.on('app:resume', () => {
      loadServersRef.current()
    })
    return cleanup
  }, [])

  // 异步 ping 本地服务器在线状态（支持 addr 或 localAddrs）
  const localIds = servers.filter(s => s.type === 'local').map(s => s.id).join(',')
  useEffect(() => {
    const locals = servers.filter(s => s.type === 'local' && s.localServer && (s.localServer.socketPath || s.localServer.addr || s.localServer.localAddrs?.length))
    if (locals.length === 0) return

    locals.forEach(async (card) => {
      const ls = card.localServer!
      // 有确定的 addr 直接 ping
      if (ls.addr) {
        try {
          const validation = await probeLocalTGent(ls.addr, ls.password)
          const isOk = validation.ok || !!validation.requiresPassword
          setServers(prev => prev.map(s =>
            s.id === card.id ? { ...s, online: ((isOk || s.hubOnline) ? 'online' : 'offline') as OnlineStatus, addr: isOk ? ls.addr : s.addr } : s
          ))
          if (validation.ok && validation.agentId && validation.agentId !== ls.hubAgentId) {
            identityReconcileRef.current = identityReconcileRef.current.then(async () => {
              await attachHubIdentity(ls.id, validation.agentId!, validation.hubAddr)
              await loadServersRef.current()
            }).catch(() => {})
          }
        } catch {
          setServers(prev => prev.map(s =>
            s.id === card.id ? { ...s, online: (s.hubOnline ? 'online' : 'offline') as OnlineStatus } : s
          ))
        }
        return
      }
      // 无 addr 但有 localAddrs，并发探测
      if (ls.localAddrs?.length) {
        let found = false
        let pending = ls.localAddrs.length
        for (const addr of ls.localAddrs) {
          ;(async () => {
            try {
              const validation = await probeLocalTGent(addr, ls.password)
              const isOk = validation.ok || !!validation.requiresPassword
              if (isOk && !found) {
                found = true
                setServers(prev => prev.map(s =>
                  s.id === card.id ? { ...s, online: 'online' as OnlineStatus, addr } : s
                ))
                if (validation.ok && validation.agentId && validation.agentId !== ls.hubAgentId) {
                  identityReconcileRef.current = identityReconcileRef.current.then(async () => {
                    await attachHubIdentity(ls.id, validation.agentId!, validation.hubAddr)
                    await loadServersRef.current()
                  }).catch(() => {})
                }
              }
            } catch {}
            pending--
            if (pending <= 0 && !found) {
              setServers(prev => prev.map(s =>
                s.id === card.id ? { ...s, online: (s.hubOnline ? 'online' : 'offline') as OnlineStatus } : s
              ))
            }
          })()
        }
      }
    })
  }, [localIds, refreshCounter])

  const refresh = useCallback(async () => {
    await loadServers()
    setRefreshCounter(c => c + 1)
  }, [loadServers])

  const removeServer = useCallback(async (card: ServerCard) => {
    const connType = getConnType(card)

    // hub 或 both 类型需要确认
    if (connType === 'hub' || connType === 'both') {
      setDeleteConfirmTarget(card)
      return
    }

    // local 类型直接移除
    await removeLocalServer(card.id)
    setServers(prev => {
      const next = prev.filter(s => s.id !== card.id)
      saveCachedServers(next)
      return next
    })
  }, [])

  const reorderServers = useCallback((activeId: string, overId: string) => {
    setServers(prev => {
      const srcIdx = prev.findIndex(s => s.id === activeId)
      const dstIdx = prev.findIndex(s => s.id === overId)
      if (srcIdx < 0 || dstIdx < 0 || srcIdx === dstIdx) return prev
      const next = [...prev]
      const [moved] = next.splice(srcIdx, 1)
      next.splice(dstIdx, 0, moved)
      // 持久化排序
      storage.set(SERVER_ORDER_KEY, JSON.stringify(next.map(s => s.id))).catch(() => {})
      saveCachedServers(next)
      return next
    })
  }, [])

  const confirmDelete = useCallback(async () => {
    const card = deleteConfirmTarget
    if (!card) return
    setDeleteConfirmTarget(null)

    // 先删除 hub 端
    if (card.type === 'hub' || (card.type === 'local' && card.localServer?.hubAgentId)) {
      const hubAgentId = card.type === 'hub' ? card.id : card.localServer!.hubAgentId!
      try {
        await webApi.deleteAgent(hubAgentId)
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e)
        // 404 表示服务端已删除，继续删除本地记录
        if (!errMsg.toLowerCase().includes('not found')) {
          eventBus.emit('toast:show', { message: '删除失败，请重试', type: 'error' })
          return
        }
      }
    }

    // both 或 local 类型移除 local 端
    if (card.type === 'local') {
      await removeLocalServer(card.id)
    }

    setServers(prev => {
      const next = prev.filter(s => s.id !== card.id)
      saveCachedServers(next)
      return next
    })
  }, [deleteConfirmTarget])

  return {
    servers,
    loading,
    hubLoadError,
    loggedIn,
    refresh,
    removeServer,
    confirmDelete,
    deleteConfirmTarget,
    setDeleteConfirmTarget,
    reorderServers,
  }
}

/** 判断卡片的连接类型：local / hub / both */
export type ConnType = 'local' | 'hub' | 'both'

export function getConnType(card: ServerCard): ConnType {
  if (card.type === 'hub') {
    const labels = card.agentInfo?.labels || ''
    return labels.includes('local') && labels.includes('hub') ? 'both' : 'hub'
  }
  const hasLocal = !!card.localServer?.socketPath || !!card.localServer?.addr || !!card.localServer?.localAddrs?.length
  if (hasLocal && card.localServer?.hubAgentId) return 'both'
  if (!hasLocal && card.localServer?.hubAgentId) return 'hub'
  return 'local'
}

export const CONN_STYLE = {
  local: { bg: 'bg-blue-500/15', icon: 'text-blue-400', badge: 'bg-blue-500/20 text-blue-400', label: '本地' },
  hub:   { bg: 'bg-purple-500/15', icon: 'text-purple-400', badge: 'bg-purple-500/20 text-purple-400', label: 'Hub' },
  both:  { bg: 'bg-green-500/15', icon: 'text-green-400', badge: 'bg-green-500/20 text-green-400', label: '本地+Hub' },
} as const
