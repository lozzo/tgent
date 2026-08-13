import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { DndContext, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Laptop, LoaderCircle, Plus, RotateCw } from 'lucide-react'
import { discoverLocalTGent, haptic, getWebToken, isWailsApp, type LocalTGentDiscovery } from '../lib/platform'
import { getCachedSubscription } from '../api/client'
import { useAppContext } from '../contexts/AppContext'
import { eventBus } from '../state/EventBus'
import { useDragSensors } from '../hooks/useDragSensors'
import AddLocalServerDialog from '../components/AddLocalServerDialog'
import ConfirmDialog from '../components/common/ConfirmDialog'
import PullToRefresh from '../components/PullToRefresh'
import { useServerList, getConnType, CONN_STYLE, type ServerCard } from '../hooks/useServerList'
import { storage } from '../lib/storage'
import { addOrUpdateByHubAgentId, type LocalServer } from '../lib/localServers'
import { getDesktopLastServerId } from '../lib/desktopTerminalHistory'

const LOGIN_HINT_DISMISSED_KEY = 'tgent_login_hint_dismissed'
type LocalDiscoveryPhase = 'idle' | 'checking' | 'not-found' | 'needs-password' | 'failed' | 'connected'

function SortableServerCard({ card, isDragging: globalDragging, onClick, onRemove, onShowInfo }: {
  card: ServerCard
  isDragging: boolean
  onClick: (card: ServerCard) => void
  onRemove: (card: ServerCard) => void
  onShowInfo: (card: ServerCard) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: itemDragging } = useSortable({ id: card.id })
  const connType = getConnType(card)
  const style = CONN_STYLE[connType]
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggeredRef = useRef(false)

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: itemDragging ? 0.5 : 1 }}
      onClick={() => {
        if (longPressTriggeredRef.current) {
          longPressTriggeredRef.current = false
          return
        }
        if (!globalDragging) onClick(card)
      }}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        longPressTriggeredRef.current = false
        clearLongPress()
        longPressTimerRef.current = setTimeout(() => {
          longPressTriggeredRef.current = true
          haptic()
          onShowInfo(card)
        }, 450)
      }}
      onPointerUp={clearLongPress}
      onPointerLeave={clearLongPress}
      onPointerCancel={clearLongPress}
      onContextMenu={(e) => {
        e.preventDefault()
        clearLongPress()
        haptic()
        onShowInfo(card)
      }}
      className="rounded-2xl bg-[var(--color-border-subtle)] px-4 py-3.5 active:bg-[var(--color-border)] transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${style.bg}`}>
          {connType === 'hub' ? (
            <svg className={`w-5 h-5 ${style.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
          ) : (
            <svg className={`w-5 h-5 ${style.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-t-primary text-[17px] font-medium truncate">{card.name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${style.badge}`}>
              {style.label}
            </span>
            {card.addr && (
              <span className="text-t-muted text-[13px] font-mono truncate">{card.addr.replace(/^https?:\/\//, '')}</span>
            )}
            {card.type === 'hub' && card.agentInfo && (
              <span className="text-t-muted text-[13px]">{card.agentInfo.hostname}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {card.needPair ? (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium whitespace-nowrap">需配对</span>
          ) : card.online === 'checking' ? (
            <span className="w-2.5 h-2.5 rounded-full bg-gray-400 animate-pulse" />
          ) : card.online === 'online' ? (
            <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
          ) : card.online === 'offline' ? (
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
          ) : null}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); haptic(); onRemove(card) }}
            className="w-8 h-8 flex items-center justify-center rounded-full text-t-muted active:bg-red-500/15 active:text-red-400 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="w-8 h-8 flex items-center justify-center rounded-full text-t-muted active:bg-white/10 transition-colors touch-none"
            aria-label="拖拽排序"
            {...attributes} {...listeners}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M7 4a1.25 1.25 0 110 2.5A1.25 1.25 0 017 4zm6 0a1.25 1.25 0 110 2.5A1.25 1.25 0 0113 4zM7 8.75a1.25 1.25 0 110 2.5 1.25 1.25 0 010-2.5zm6 0a1.25 1.25 0 110 2.5 1.25 1.25 0 010-2.5zM7 13.5a1.25 1.25 0 110 2.5 1.25 1.25 0 010-2.5zm6 0a1.25 1.25 0 110 2.5 1.25 1.25 0 010-2.5z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function formatTime(value?: string | null): string {
  if (!value) return '-'
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return value
  return time.toLocaleString()
}

function ServerInfoDialog({ card, onClose }: {
  card: ServerCard | null
  onClose: () => void
}) {
  if (!card) return null

  const local = card.localServer
  const fields: Array<[string, string]> = [
    ['名称', card.name],
    ['连接类型', getConnType(card)],
    ['状态', card.needPair ? '需配对' : card.online === 'online' ? '在线' : card.online === 'offline' ? '离线' : '检测中'],
  ]

  if (local?.addr) fields.push(['当前地址', local.addr])
  if (local?.localAddrs?.length) fields.push(['候选地址', local.localAddrs.join('\n')])
  if (local?.socketPath) fields.push(['本机连接', '本地 Socket'])
  if (local?.hubAgentId) fields.push(['Agent ID', local.hubAgentId])
  if (local?.hubAddr) fields.push(['Hub 地址', local.hubAddr])
  if (card.agentInfo?.hostname) fields.push(['主机名', card.agentInfo.hostname])
  if (card.agentInfo?.osInfo) fields.push(['系统', card.agentInfo.osInfo])
  if (card.agentInfo?.labels) fields.push(['标签', card.agentInfo.labels])
  if (card.agentInfo?.tokenName) fields.push(['Token', card.agentInfo.tokenName])
  if (card.agentInfo?.lastSeen) fields.push(['最近在线', formatTime(card.agentInfo.lastSeen)])
  if (local?.addedAt) fields.push(['添加时间', formatTime(new Date(local.addedAt).toISOString())])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0" style={{ backgroundColor: 'var(--color-bg-overlay)' }} />
      <div
        className="relative w-[92%] max-w-md bg-surface rounded-2xl px-5 py-6 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-t-primary text-[18px] font-semibold">{card.name}</h3>
            <p className="text-t-muted text-[13px] mt-1">长按卡片查看的信息</p>
          </div>
          <button
            onClick={() => { haptic(); onClose() }}
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-t-muted active:bg-white/10"
            aria-label="关闭"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {fields.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-elevated px-3.5 py-3">
              <div className="text-[12px] text-t-muted mb-1">{label}</div>
              <div className="text-[14px] text-t-primary whitespace-pre-wrap break-all font-mono">{value}</div>
            </div>
          ))}
        </div>

        <button
          onClick={() => { haptic(); onClose() }}
          className="w-full mt-5 py-3 rounded-xl bg-blue-600 text-white text-[15px] font-medium active:bg-blue-700"
        >
          知道了
        </button>
      </div>
    </div>
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { storeManager, networkStateManager } = useAppContext()
  const desktopApp = isWailsApp()

  const {
    servers, loading, hubLoadError, loggedIn,
    refresh, removeServer, confirmDelete,
    deleteConfirmTarget, setDeleteConfirmTarget,
    reorderServers,
  } = useServerList()

  const [showAddDialog, setShowAddDialog] = useState(false)
  const [localDialogMode, setLocalDialogMode] = useState(false)
  const [showSubscriptionDialog, setShowSubscriptionDialog] = useState(false)
  const [infoCard, setInfoCard] = useState<ServerCard | null>(null)
  const [loginHintDismissed, setLoginHintDismissed] = useState(() => !!localStorage.getItem('login_hint_dismissed'))
  const [isDragging, setIsDragging] = useState(false)
  const [activeDragCard, setActiveDragCard] = useState<ServerCard | null>(null)
  // const [loginHintDismissed, setLoginHintDismissed] = useState(false)
  const [loginHintReady, setLoginHintReady] = useState(false)
  const [localDiscoveryPhase, setLocalDiscoveryPhase] = useState<LocalDiscoveryPhase>('idle')
  const [discoveredLocal, setDiscoveredLocal] = useState<LocalTGentDiscovery | null>(null)
  const discoveryStartedRef = useRef(false)
  const desktopHomeRequested = !!(location.state as { desktopHome?: boolean } | null)?.desktopHome
  const stayOnDesktopHomeRef = useRef(
    desktopHomeRequested,
  )
  const [desktopStartupPending, setDesktopStartupPending] = useState(desktopApp && !desktopHomeRequested)
  const sensors = useDragSensors()

  const runLocalDiscovery = useCallback(async (openOnSuccess = true): Promise<'opened' | 'available' | 'needs-password' | 'not-found' | 'failed'> => {
    if (!desktopApp) return 'not-found'
    setLocalDiscoveryPhase('checking')
    try {
      const discovery = await discoverLocalTGent()
      setDiscoveredLocal(discovery)
      if (!discovery.found || (!discovery.address && !discovery.socketPath)) {
        setLocalDiscoveryPhase('not-found')
        return 'not-found'
      }
      if (discovery.requiresPassword) {
        setLocalDiscoveryPhase('needs-password')
        if (openOnSuccess) {
          setLocalDialogMode(true)
          setShowAddDialog(true)
        }
        return 'needs-password'
      }

      const server = await addOrUpdateByHubAgentId({
        name: discovery.name || '本机 TGent',
        addr: discovery.address || '',
        password: '',
        socketPath: discovery.socketPath,
        hubAgentId: discovery.agentId,
        hubAddr: discovery.hubAddr,
      })
      setLocalDiscoveryPhase('connected')
      if (server.disabled) {
        await refresh()
        return 'not-found'
      }
      if (!openOnSuccess) {
        await refresh()
        return 'available'
      }
      storeManager.preconnect('local', server.id, server)
      navigate(`/s/${server.id}`, { replace: true })
      return 'opened'
    } catch (error) {
      console.warn('[HomePage] local TGent discovery failed', error)
      setLocalDiscoveryPhase('failed')
      return 'failed'
    }
  }, [desktopApp, navigate, refresh, storeManager])

  useEffect(() => {
    if (!desktopApp || loading || discoveryStartedRef.current) return
    discoveryStartedRef.current = true
    if (stayOnDesktopHomeRef.current) {
      setDesktopStartupPending(false)
      void runLocalDiscovery(false)
      return
    }

    let cancelled = false
    void (async () => {
      const localResult = await runLocalDiscovery(true)
      if (cancelled || localResult === 'opened' || localResult === 'needs-password') return

      const lastServerId = await getDesktopLastServerId()
      if (cancelled) return
      const preferred = servers.find(card => card.id === lastServerId && card.type === 'local' && !card.needPair)
        || servers.find(card => card.type === 'local' && !card.needPair)
      if (preferred) {
        storeManager.preconnect('local', preferred.id, preferred.localServer)
        navigate(`/s/${preferred.id}`, { replace: true })
        return
      }
      setDesktopStartupPending(false)
    })()
    return () => { cancelled = true }
  }, [desktopApp, loading, navigate, runLocalDiscovery, servers, storeManager])

  // 监听 searchParams 中的 action=add
  useEffect(() => {
    if (searchParams.get('action') === 'add') {
      setLocalDialogMode(false)
      setShowAddDialog(true)
    }
  }, [searchParams])

  useEffect(() => {
    let cancelled = false

    const syncLoginHintState = async () => {
      if (loggedIn) {
        await storage.remove(LOGIN_HINT_DISMISSED_KEY)
        if (!cancelled) {
          setLoginHintDismissed(false)
          setLoginHintReady(true)
        }
        return
      }

      const dismissed = await storage.get(LOGIN_HINT_DISMISSED_KEY)
      if (!cancelled) {
        setLoginHintDismissed(dismissed === '1')
        setLoginHintReady(true)
      }
    }

    void syncLoginHintState()

    return () => {
      cancelled = true
    }
  }, [loggedIn])

  const handleServerClick = async (card: ServerCard) => {
    haptic()

    // 未配对节点 → 跳转扫码配对页
    if (card.needPair) {
      const agentId = card.localServer?.hubAgentId || card.id
      navigate(`/scan?pairAgentId=${encodeURIComponent(agentId)}`)
      return
    }

    // 统一路由：/s/:id
    if (card.type === 'local') {
      const ls = card.localServer
      // 纯 Hub 存储（无本地地址且无本地地址列表）→ 需要登录
      if (ls && !ls.addr && !ls.localAddrs?.length && ls.hubAgentId) {
        if (!(await getWebToken())) {
          navigate('/login')
          return
        }
        // Hub 连接需要检查订阅
        const sub = await getCachedSubscription()
        if (!sub || !sub.active) {
          setShowSubscriptionDialog(true)
          return
        }
      }
    } else if (card.type === 'hub') {
      if (!(await getWebToken())) {
        navigate('/login')
        return
      }
      // Hub 连接需要检查订阅
      const sub = await getCachedSubscription()
      if (!sub || !sub.active) {
        setShowSubscriptionDialog(true)
        return
      }
    }
    storeManager.preconnect(
      card.type,
      card.id,
      card.localServer,
    )
    navigate(`/s/${card.id}`)
  }

  const handleAddDialogClose = () => {
    setShowAddDialog(false)
    setLocalDialogMode(false)
    if (searchParams.get('action') === 'add') {
      setSearchParams({}, { replace: true })
    }
  }

  const handleServerAdded = (server: LocalServer) => {
    handleAddDialogClose()
    void refresh()
    if (desktopApp) {
      storeManager.preconnect('local', server.id, server)
      navigate(`/s/${server.id}`, { replace: true })
    }
  }

  const handleDismissLoginHint = () => {
    haptic()
    setLoginHintDismissed(true)
    void storage.set(LOGIN_HINT_DISMISSED_KEY, '1')
  }

  if (desktopStartupPending) {
    return (
      <main className="desktop-startup-shell" role="status" aria-label="Restoring terminal workspace">
        <header>
          <span className="desktop-startup-tab-dot" aria-hidden="true" />
          <strong>tmux</strong>
        </header>
        <section>
          <LoaderCircle size={15} aria-hidden="true" />
          <span>{loading ? 'Loading connections' : 'Restoring terminal'}</span>
        </section>
      </main>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-page safe-x">
      <header className="shrink-0 z-10 bg-page/80 backdrop-blur-xl border-b border-t-border-subtle safe-top">
        <div className="max-w-lg mx-auto px-5 sm:px-6 pt-3 pb-2.5 sm:py-4 flex items-center justify-between">
          <h1 className="text-[28px] sm:text-xl font-bold text-t-primary tracking-tight leading-tight">tgent</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { haptic(); navigate('/scan') }}
              className="p-2 text-t-secondary hover:text-t-primary active:text-t-primary transition-colors"
              aria-label="扫码"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M3 4.5h3V3H3a1.5 1.5 0 00-1.5 1.5v3H3V4.5zM18 3v1.5h3V7.5h1.5v-3A1.5 1.5 0 0021 3h-3zM3 19.5H1.5v-3H0v3A1.5 1.5 0 001.5 21H3v-1.5zM19.5 21v-1.5H21v-3h1.5v3a1.5 1.5 0 01-1.5 1.5h-1.5zM3 9h1.5v6H3V9zm3 0h1.5v6H6V9zm3 0h1.5v6H9V9zm4.5 0H12v6h1.5V9zm1.5 0h1.5v6H15V9zm3 0h1.5v6H18V9z" />
              </svg>
            </button>
            <button
              onClick={() => { haptic(); navigate('/settings') }}
              className="p-2 text-t-secondary hover:text-t-primary active:text-t-primary transition-colors"
              aria-label="设置"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <PullToRefresh onRefresh={async () => {
        if (!networkStateManager.state.phoneOnline) {
          eventBus.emit('toast:show', { message: '网络已断开，无法刷新', type: 'error' })
          return
        }
        await refresh()
      }}>
      <main className="max-w-lg mx-auto px-4 sm:px-6 py-5 sm:py-6 pb-24">
        {loading && servers.length === 0 ? (
          <div className="text-center py-20 text-t-muted text-sm">加载中...</div>
        ) : servers.length === 0 ? (
          desktopApp ? (
            <div className="min-h-[440px] flex flex-col items-center justify-center text-center px-5">
              <div className="w-12 h-12 rounded-lg border border-t-border-subtle bg-elevated flex items-center justify-center mb-5">
                {localDiscoveryPhase === 'checking' || localDiscoveryPhase === 'idle' ? (
                  <LoaderCircle className="w-5 h-5 text-t-secondary animate-spin" aria-hidden="true" />
                ) : (
                  <Laptop className="w-5 h-5 text-t-secondary" aria-hidden="true" />
                )}
              </div>

              {localDiscoveryPhase === 'checking' || localDiscoveryPhase === 'idle' ? (
                <>
                  <p className="text-t-primary text-base font-medium">正在查找本机 TGent</p>
                  <p className="text-t-muted text-sm mt-1">无需登录账号</p>
                </>
              ) : localDiscoveryPhase === 'needs-password' ? (
                <>
                  <p className="text-t-primary text-base font-medium">已找到本机 TGent</p>
                  <p className="text-t-muted text-sm mt-1 max-w-sm">此 daemon 已启用访问密码，验证后即可直接进入。</p>
                </>
              ) : (
                <>
                  <p className="text-t-primary text-base font-medium">本机 TGent 尚未运行</p>
                  <p className="text-t-muted text-sm mt-1 max-w-sm">启动 TGent 后重新检测，或连接其他本地地址。</p>
                </>
              )}

              {localDiscoveryPhase !== 'checking' && localDiscoveryPhase !== 'idle' && (
                <div className="flex items-center gap-2 mt-6">
                  <button
                    onClick={() => {
                      haptic()
                      if (localDiscoveryPhase === 'needs-password') {
                        setLocalDialogMode(true)
                        setShowAddDialog(true)
                      } else {
                        void runLocalDiscovery()
                      }
                    }}
                    className="h-9 px-3.5 rounded-md bg-[#e9edf2] text-[#101216] text-sm font-medium hover:bg-white active:bg-[#d8dde4] transition-colors inline-flex items-center gap-2"
                  >
                    {localDiscoveryPhase === 'needs-password' ? (
                      <Laptop className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <RotateCw className="w-4 h-4" aria-hidden="true" />
                    )}
                    {localDiscoveryPhase === 'needs-password' ? '输入 daemon 密码' : '重新检测'}
                  </button>
                  <button
                    onClick={() => { haptic(); setLocalDialogMode(false); setShowAddDialog(true) }}
                    className="h-9 px-3.5 rounded-md border border-t-border text-t-secondary text-sm font-medium hover:text-t-primary hover:bg-elevated active:bg-[var(--color-border-subtle)] transition-colors inline-flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    添加地址
                  </button>
                </div>
              )}

              {!loggedIn && localDiscoveryPhase !== 'checking' && localDiscoveryPhase !== 'idle' && (
                <button
                  onClick={() => { haptic(); navigate('/login') }}
                  className="mt-7 text-xs text-t-muted hover:text-t-secondary transition-colors"
                >
                  需要跨机器远程管理？登录账号
                </button>
              )}
            </div>
          ) : (
            <div className="text-center py-20">
              <div className="w-16 h-16 rounded-2xl bg-[var(--color-border-subtle)] flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-t-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
                </svg>
              </div>
              <p className="text-t-secondary text-[17px] font-medium">没有服务器</p>
              <p className="text-t-muted text-[14px] mt-1">点击右下角 + 添加服务器</p>
            </div>
          )
        ) : (
          <DndContext
            sensors={sensors}
            onDragStart={(event: DragStartEvent) => {
              setIsDragging(true)
              const card = servers.find(s => s.id === event.active.id)
              setActiveDragCard(card || null)
              haptic()
            }}
            onDragEnd={(event: DragEndEvent) => {
              setIsDragging(false)
              setActiveDragCard(null)
              const { active, over } = event
              if (over && active.id !== over.id) {
                reorderServers(active.id as string, over.id as string)
              }
            }}
            onDragCancel={() => { setIsDragging(false); setActiveDragCard(null) }}
          >
          <div className="space-y-3">
            <SortableContext items={servers.map(s => s.id)} strategy={verticalListSortingStrategy}>
              {servers.map((card) => (
                <SortableServerCard
                  key={`${card.type}-${card.id}`}
                  card={card}
                  isDragging={isDragging}
                  onClick={handleServerClick}
                  onRemove={removeServer}
                  onShowInfo={setInfoCard}
                />
              ))}
            </SortableContext>
            {/* 加载失败提示卡片 */}
            {hubLoadError && (
              <div className="rounded-2xl bg-red-500/5 border border-red-500/20 px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <span className="text-t-secondary text-sm flex-1">Agent 列表加载失败</span>
                  <button
                    onClick={() => { haptic(); refresh() }}
                    className="text-blue-400 text-sm font-medium active:text-blue-300 shrink-0"
                  >
                    重试
                  </button>
                </div>
              </div>
            )}
          </div>
          <DragOverlay>
            {activeDragCard && (
              <div className="rounded-2xl bg-surface px-4 py-3.5 shadow-lg border border-t-border-subtle">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${CONN_STYLE[getConnType(activeDragCard)].bg}`}>
                    <svg className={`w-5 h-5 ${CONN_STYLE[getConnType(activeDragCard)].icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7" />
                    </svg>
                  </div>
                  <span className="text-t-primary text-[17px] font-medium truncate">{activeDragCard.name}</span>
                </div>
              </div>
            )}
          </DragOverlay>
          </DndContext>
        )}

        {/* 未登录时底部引导（可关闭） */}
        {!desktopApp && !loading && loginHintReady && !loggedIn && !loginHintDismissed && (
          <div className="mt-6 rounded-2xl bg-purple-500/5 border border-purple-500/20 px-4 py-3">
            <div className="flex items-start justify-between">
              <p className="text-t-secondary text-sm flex-1">登录可远程管理多台服务器</p>
              <button
                onClick={(e) => { e.stopPropagation(); handleDismissLoginHint() }}
                className="ml-2 -mt-0.5 -mr-1 p-1 text-t-muted active:text-t-secondary transition-colors"
                aria-label="关闭"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <button
              onClick={() => { haptic(); navigate('/login') }}
              className="mt-2 text-purple-400 text-sm font-medium active:text-purple-300"
            >
              登录
            </button>
          </div>
        )}
      </main>
      </PullToRefresh>

      {/* 添加按钮 */}
      <button
        onClick={() => {
          haptic()
          if (desktopApp) {
            setLocalDialogMode(false)
            setShowAddDialog(true)
          } else {
            navigate('/scan')
          }
        }}
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 active:bg-blue-700 rounded-full flex items-center justify-center shadow-lg shadow-blue-600/25 transition-colors z-40"
        style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
        aria-label={desktopApp ? '添加本地 TGent' : '扫码添加服务器'}
      >
        <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </button>

      {/* 添加服务器对话框 */}
      <AddLocalServerDialog
        open={showAddDialog}
        onClose={handleAddDialogClose}
        onAdded={handleServerAdded}
        initialAddr={localDialogMode ? discoveredLocal?.address : undefined}
        initialName={localDialogMode ? discoveredLocal?.name : undefined}
        localDiscovery={localDialogMode && !!discoveredLocal?.address}
      />

      {/* 订阅提示对话框 */}
      {showSubscriptionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowSubscriptionDialog(false)}>
          <div className="absolute inset-0" style={{ backgroundColor: 'var(--color-bg-overlay)' }} />
          <div
            className="relative w-[90%] max-w-sm bg-surface rounded-2xl px-5 py-6 animate-slide-up"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-t-primary text-[18px] font-semibold mb-2">需要订阅 Pro 版</h3>
            <p className="text-t-secondary text-[14px] mb-5">
              Hub 中转功能需要订阅 Pro 版。升级后即可远程管理服务器。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowSubscriptionDialog(false)}
                className="flex-1 py-3 rounded-xl bg-elevated text-t-secondary text-[15px] font-medium active:bg-[var(--color-border)]"
              >
                取消
              </button>
              <button
                onClick={() => { setShowSubscriptionDialog(false); navigate('/settings') }}
                className="flex-1 py-3 rounded-xl bg-blue-600 text-white text-[15px] font-medium active:bg-blue-700"
              >
                查看订阅
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={!!deleteConfirmTarget}
        title="确认删除"
        message={
          deleteConfirmTarget ? (
            <p>
              确定要删除{' '}
              <span className="font-medium text-t-primary">{deleteConfirmTarget.name}</span>
              ？删除后 Agent 将断开连接并退出，需要重新注册。
            </p>
          ) : ''
        }
        confirmText="删除"
        cancelText="取消"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirmTarget(null)}
      />
      <ServerInfoDialog card={infoCard} onClose={() => setInfoCard(null)} />

    </div>
  )
}
