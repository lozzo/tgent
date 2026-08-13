import { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import Terminal, { TerminalHandle, type ConnStatus, type LoadingStage } from '../components/Terminal'
import type { PaneInfo } from '../api/terminalClient'
import VirtualKeybar from '../components/VirtualKeybar'
import FnPanel from '../components/FnPanel'
import PaneSwitcher from '../components/PaneSwitcher'
import TerminalTopologySwitcher from '../components/TerminalTopologySwitcher'
import TerminalToolbar, { type ToolbarMode } from '../components/TerminalToolbar'
import PasteConfirmDialog from '../components/PasteConfirmDialog'
import SnippetPanel from '../components/SnippetPanel'
import SplitTerminalSlot from '../components/SplitTerminalSlot'
import SplitDivider from '../components/SplitDivider'
import SplitPaneSelector from '../components/SplitPaneSelector'
import TerminalFileDrawer, { type TerminalFileDrawerHandle } from '../components/files/TerminalFileDrawer'
import { useConnectionStore } from '../hooks/useConnectionStore'
import { useFileTransferStore } from '../hooks/useFileTransferStore'
import { useAgentTopology } from '../hooks/useAgentData'
import { useIsMobile } from '../hooks/useIsMobile'
import { useTerminalKeyboard } from '../hooks/useTerminalKeyboard'
import { useTerminalInput } from '../hooks/useTerminalInput'
import { loadTerminalSettings, saveTerminalSettings, FONT_OPTIONS, type TerminalSettings } from '../lib/terminalSettings'
import { useAppBack } from '../hooks/useAppBack'
import { useFavoritePanes } from '../hooks/useFavoritePanes'
import { useMultiFingerSwipe } from '../hooks/useMultiFingerSwipe'
import { useAppContext } from '../contexts/AppContext'
import { eventBus } from '../state/EventBus'
import { resolveServerType } from '../lib/resolveServerType'
import { storage } from '../lib/storage'
import { rememberDesktopTerminal } from '../lib/desktopTerminalHistory'
import { acquireWithAutoReacquire, releaseAndStopAutoReacquire } from '../lib/wakeLock'
import { haptic, isWailsApp } from '../lib/platform'
import type { TopologyNode } from '../api/types'

/** 状态灯配置 */
function getIndicator(phase: string, needLogin: boolean): { color: string; pulse: boolean; label: string } {
  if (phase === 'connected') return { color: 'bg-green-500', pulse: false, label: '已连接' }
  if (phase === 'reconnecting' || phase === 'verifying') return { color: 'bg-yellow-500', pulse: true, label: '重连中' }
  if (phase === 'failed' || phase === 'waiting_network') return { color: 'bg-red-500', pulse: false, label: '已断开' }
  if (needLogin) return { color: 'bg-red-500', pulse: false, label: '需登录' }
  return { color: 'bg-yellow-500', pulse: true, label: '连接中' }
}

function normalizePanePath(value: unknown): string {
  if (typeof value !== 'string') return '/'
  const path = value.trim()
  return path.startsWith('/') ? path : '/'
}

function findTerminalPath(nodes: TopologyNode[], terminalId: string, parents: TopologyNode[] = []): TopologyNode[] | null {
  for (const node of nodes) {
    const path = [...parents, node]
    if (node.terminal_id === terminalId) return path
    const childPath = findTerminalPath(node.children || [], terminalId, path)
    if (childPath) return childPath
  }
  return null
}

export default function TerminalPage() {
  const { paneId: rawId, serverId } = useParams<{ paneId: string; serverId?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { storeManager } = useAppContext()
  const termRef = useRef<TerminalHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const termWrapperRef = useRef<HTMLDivElement>(null)
  const isAlternateRef = useRef(false)
  const keyboardModeRef = useRef<'auto' | 'resize' | 'shift'>('auto')
  const isSplitRef = useRef(false)
  // 根据 keyboardMode 配置决定键盘弹出时是 resize 还是 CSS shift
  const shouldResize = useCallback(() => {
    // 分屏模式下始终 resize，shift 在分屏中没有意义
    if (isSplitRef.current) return true
    const mode = keyboardModeRef.current
    if (mode === 'resize') return true
    if (mode === 'shift') return false
    return isAlternateRef.current // auto: 由 xterm buffer 类型决定
  }, [])
  const getTermRef = useCallback(() => termRef.current, [])

  // ---- 分屏状态 ----
  const [splitSlot, setSplitSlot] = useState<{ serverId: string; paneId: string } | null>(null)
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0)
  const [splitRatio, setSplitRatio] = useState(0.5)
  const [syncInput, setSyncInput] = useState(false)
  const [showSplitSelector, setShowSplitSelector] = useState(false)
  const [splitPaneInfo, setSplitPaneInfo] = useState<PaneInfo | null>(null)
  const splitTermRef = useRef<TerminalHandle>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)
  const isSplit = splitSlot !== null
  isSplitRef.current = isSplit

  // 测量内容区高度（用于 divider 拖拽计算）
  useEffect(() => {
    const el = contentRef.current
    if (!el || !isSplit) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setContentHeight(entry.contentRect.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [isSplit])

  const { keyboardVisible, reapplyKeyboardLayout, handleBufferChange: baseHandleBufferChange, handleCursorMove } = useTerminalKeyboard({
    containerRef, mainRef, termWrapperRef, getTermRef, shouldResize,
  })

  const [keyboardLocked, setKeyboardLocked] = useState(false)
  const keyboardVisibleRef = useRef(false)
  keyboardVisibleRef.current = keyboardVisible
  const keyboardLockedRef = useRef(false)
  keyboardLockedRef.current = keyboardLocked
  const getKeyboardVisible = useCallback(() => keyboardVisibleRef.current, [])
  const getKeyboardLocked = useCallback(() => keyboardLockedRef.current, [])
  const syncInputRef = useRef(false)
  syncInputRef.current = syncInput
  const activeSlotRef = useRef<0 | 1>(0)
  activeSlotRef.current = activeSlot
  const getTermRefs = useCallback(() => {
    if (syncInputRef.current) return [termRef.current, splitTermRef.current]
    return activeSlotRef.current === 0 ? [termRef.current] : [splitTermRef.current]
  }, [])

  const { ctrlState, setCtrlState, altState, setAltState, handleKey, handleFnSend, handleModifierUsed } = useTerminalInput({
    getTermRefs, getKeyboardVisible, getKeyboardLocked,
  })

  const handleBufferChange = useCallback((isAlternate: boolean) => {
    isAlternateRef.current = isAlternate
    baseHandleBufferChange(isAlternate)
  }, [baseHandleBufferChange])

  // ---- 分屏同步输入 ----
  const handleInput0 = useCallback((data: string) => {
    if (!syncInputRef.current) return
    splitTermRef.current?.sendInput(data)
  }, [])

  const handleInput1 = useCallback((data: string) => {
    if (!syncInputRef.current) return
    termRef.current?.sendInput(data)
  }, [])

  const handleSplitPaneInfo = useCallback((info: PaneInfo) => {
    setSplitPaneInfo(info)
  }, [])

  // 分屏选择回调
  const handleSplitSelect = useCallback((sid: string, pid: string) => {
    setSplitSlot({ serverId: sid, paneId: pid })
    setShowSplitSelector(false)
    setActiveSlot(0) // 保持当前终端活跃
  }, [])

  const handleExitSplit = useCallback(() => {
    haptic()
    setSplitSlot(null)
    setShowSplitSelector(false)
    setSplitPaneInfo(null)
    setSyncInput(false)
    setActiveSlot(0)
    setSplitRatio(0.5)
  }, [])

  const [paneInfo, setPaneInfo] = useState<PaneInfo | null>(null)
  const [pageReady, setPageReady] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [fnPanelOpen, setFnPanelOpen] = useState(false)
  const [paneClosed, setPaneClosed] = useState(false)
  const [termStage, setTermStage] = useState<LoadingStage>('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [termOverlay, setTermOverlay] = useState(false)
  // 三点菜单
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  // 工具栏相关状态
  const [toolbarOpen, setToolbarOpen] = useState(false)
  const [toolbarMode, setToolbarMode] = useState<ToolbarMode>('default')
  const [selectionMode, setSelectionMode] = useState(false)
  const [searchActive, setSearchActive] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [snippetPanelOpen, setSnippetPanelOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false)
  const [snippetPrefill, setSnippetPrefill] = useState('')
  const [termSettings, setTermSettings] = useState<TerminalSettings | null>(null)
  const [serverType, setServerType] = useState<'local' | 'hub' | 'direct'>('direct')
  const [serverName, setServerName] = useState('')
  const [filesOpen, setFilesOpen] = useState(false)
  const [fileInitialPath, setFileInitialPath] = useState('/')
  const [fileContextKey, setFileContextKey] = useState('terminal:/')
  const [isRelay, setIsRelay] = useState(false)
  const fileDrawerRef = useRef<TerminalFileDrawerHandle>(null)
  const fileOpenRequestRef = useRef(0)

  useEffect(() => {
    loadTerminalSettings().then(s => {
      keyboardModeRef.current = s.keyboardMode
      setTermSettings({ ...s, fontSize: Math.max(10, s.fontSize - 2) })
    })
  }, [])

  // Wake Lock：终端页面活跃时防止屏幕休眠
  useEffect(() => {
    acquireWithAutoReacquire()
    return () => { releaseAndStopAutoReacquire() }
  }, [])

  useEffect(() => {
    resolveServerType(serverId).then(setServerType)
  }, [serverId])

  // 解析 server 名称（从缓存）
  useEffect(() => {
    if (!serverId) return
    storage.get('tgent_servers_cache').then(raw => {
      if (!raw) return
      try {
        const cards = JSON.parse(raw) as { id: string; name: string }[]
        const card = cards.find(c => c.id === serverId)
        if (card) setServerName(card.name)
      } catch {}
    })
  }, [serverId])
  const settingsPanelRef = useRef<HTMLDivElement>(null)
  const settingsBtnRef = useRef<HTMLButtonElement>(null)
  const paneInfoRef = useRef<PaneInfo | null>(null)

  // 追踪是否曾经连接成功（用于决定 Terminal 是否挂载）
  const hasEverConnectedRef = useRef(false)
  const [hasEverConnected, setHasEverConnected] = useState(false)

  // 使用新的连接 hook
  const conn = useConnectionStore(serverId)
  const terminalTopology = useAgentTopology(conn.agentStore)
  const { transport: webrtcTransport, statusText, phase, needLogin } = conn
  const fileTransfer = useFileTransferStore(serverId)

  // 文件抽屉在短暂重连时继续持有最后一个 transport，避免整个文件界面闪退。
  const lastTransportRef = useRef(webrtcTransport)
  if (webrtcTransport) lastTransportRef.current = webrtcTransport

  const transferProps = useMemo(() => ({
    transfers: fileTransfer.transfers,
    hasActiveTransfers: fileTransfer.hasActiveTransfers,
    startDownload: fileTransfer.startDownload,
    startUpload: fileTransfer.startUpload,
    startNativeUpload: fileTransfer.startNativeUpload,
    cancelTransfer: fileTransfer.cancelTransfer,
    dismissTransfer: fileTransfer.dismissTransfer,
    retryTransfer: fileTransfer.retryTransfer,
  }), [
    fileTransfer.transfers,
    fileTransfer.hasActiveTransfers,
    fileTransfer.startDownload,
    fileTransfer.startUpload,
    fileTransfer.startNativeUpload,
    fileTransfer.cancelTransfer,
    fileTransfer.dismissTransfer,
    fileTransfer.retryTransfer,
  ])

  useEffect(() => {
    if (!conn.isConnected || !webrtcTransport) {
      setIsRelay(false)
      return
    }
    let cancelled = false
    webrtcTransport.getConnectionInfo().then(info => {
      if (!cancelled) setIsRelay(info.type === 'relay')
    }).catch(() => {
      if (!cancelled) setIsRelay(false)
    })
    return () => { cancelled = true }
  }, [conn.isConnected, webrtcTransport])

  useEffect(() => {
    const resolvedId = serverId || '__direct__'
    const ftStore = storeManager.getFileTransferStore(
      serverType === 'direct' ? 'local' : serverType,
      resolvedId,
    )
    ftStore.onTransferComplete = () => fileDrawerRef.current?.refresh()
    return () => { ftStore.onTransferComplete = undefined }
  }, [serverId, serverType, storeManager])

  // 追踪上一次的 transport 和 phase，用于检测重连
  const prevTransportRef = useRef(webrtcTransport)
  const prevPhaseRef = useRef(phase)
  const [bridgeOverlay, setBridgeOverlay] = useState(false)
  const effectiveTermOverlay = termOverlay || bridgeOverlay

  // 首次 connected 后标记
  useEffect(() => {
    if (phase === 'connected' && webrtcTransport && !hasEverConnectedRef.current) {
      hasEverConnectedRef.current = true
      setHasEverConnected(true)
    }
  }, [phase, webrtcTransport])

  // Terminal 挂载条件：曾经连接成功后永远挂载
  const shouldMountTerminal = hasEverConnected

  const isMobile = useIsMobile()
  const isDesktopApp = isWailsApp()
  const showTerminalControls = isMobile || isDesktopApp

  // 点击 FnPanel 外部区域时自动关闭面板
  useEffect(() => {
    if (!fnPanelOpen) return
    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('[data-fn-panel]') || target.closest('[data-key-id="Fn"]')) return
      setFnPanelOpen(false)
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [fnPanelOpen])

  // 点击设置面板外部区域时自动关闭
  useEffect(() => {
    if (!settingsOpen) return
    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      if (settingsPanelRef.current?.contains(target) || settingsBtnRef.current?.contains(target)) return
      setSettingsOpen(false)
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [settingsOpen])

  // 点击三点菜单外部区域时自动关闭
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      if (menuRef.current?.contains(target) || menuBtnRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [menuOpen])

  // Reset state when paneId changes (e.g. pane switch)
  const isOpaqueTerminal = location.pathname.includes('/terminal-ref/') ||
    /\/s\/[^/]+\/terminal\//.test(location.pathname) ||
    new URLSearchParams(location.search).get('terminal') === '1'
  const paneId = rawId
    ? (isOpaqueTerminal ? rawId : (rawId.startsWith('%') ? rawId : `%${rawId}`))
    : ''
  const terminalPath = useMemo(() => {
    if (!paneInfo?.terminal_id) return null
    const provider = terminalTopology.topologies.find(item => item.provider.id === paneInfo.provider_id)
    return provider ? findTerminalPath(provider.nodes, paneInfo.terminal_id) : null
  }, [paneInfo?.provider_id, paneInfo?.terminal_id, terminalTopology.topologies])

  // 收藏面板 + 多指滑动
  const { favorites, isFavorited, toggleFavorite, removeFromFavorites, navigateToNext, navigateToPrev, navigateToFavorite } = useFavoritePanes(serverId, paneId)
  useMultiFingerSwipe({
    ref: containerRef,
    onSwipeLeft: navigateToNext,
    onSwipeRight: navigateToPrev,
    enabled: favorites.length > 0,
  })
  useEffect(() => {
    setPaneInfo(null)
    setSwitcherOpen(false)
    setFnPanelOpen(false)
    setFilesOpen(false)
    fileOpenRequestRef.current++
    setPageReady(false)
    setPaneClosed(false)
    setTermStage('')
  }, [paneId])

  // 监听 window/session 关闭事件，匹配当前 pane 所在的 window/session
  useEffect(() => {
    if (!webrtcTransport) return
    const handler = (event: { type: string; session_id?: string; window_id?: string; pane_id?: string; name?: string }) => {
      const info = paneInfoRef.current
      if (!info) return
      if (event.type === 'window_closed' && event.session_id === info.session_id && event.window_id === info.window_id) {
        setPaneClosed(true)
      }
      if (event.type === 'session_closed' && event.session_id === info.session_id) {
        setPaneClosed(true)
      }
    }
    const unsub = webrtcTransport.subscribeEvent(handler)
    return () => { unsub() }
  }, [webrtcTransport])

  // 检测重连完成（phase 变为 connected 或 transport 引用变化）→ 触发终端重建
  useEffect(() => {
    const prevPhase = prevPhaseRef.current
    const prevTransport = prevTransportRef.current
    prevPhaseRef.current = phase
    prevTransportRef.current = webrtcTransport

    if (!hasEverConnectedRef.current) return

    const reconnected =
      // phase 从非 connected 变为 connected（重连完成）
      (phase === 'connected' && prevPhase !== 'connected' && webrtcTransport) ||
      // transport 引用变化（JS WebRTC 模式）
      (phase === 'connected' && webrtcTransport && webrtcTransport !== prevTransport)

    if (reconnected) {
      // verify 恢复：WebRTC 没断，终端数据没变，只需恢复 bridge channel 映射
      const isVerifyRecovery = prevPhase === 'verifying'
      if (isVerifyRecovery) {
        termRef.current?.reattach()
        splitTermRef.current?.reattach()
      } else {
        // 真正重连：清屏 + 重载 snapshot
        flushSync(() => { setBridgeOverlay(true); setTermStage('') })
        requestAnimationFrame(() => {
          termRef.current?.reconnect()
          splitTermRef.current?.reconnect()
        })
      }
    }
  }, [phase, webrtcTransport])

  // Bridge WS 重连后恢复 — 覆盖 SYNC_RESPONSE 中 phase 已是 connected 的情况
  // （此时 React 不会感知 phase 变化，但 bridge channel 需要刷新）
  useEffect(() => {
    if (!hasEverConnectedRef.current) return
    return eventBus.on('bridge:recovered', () => {
      termRef.current?.reattach()
      splitTermRef.current?.reattach()
    })
  }, [])

  // 遮罩超时保护：防止 WebRTC 连接失败时永远黑屏
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!pageReady) setPageReady(true)
    }, 3000)
    return () => clearTimeout(timer)
  }, [pageReady])

  // termOverlay 超时保护：防止终端快照加载失败时永远显示 spinner
  useEffect(() => {
    if (!effectiveTermOverlay) return
    const timer = setTimeout(() => {
      setTermOverlay(false)
      setBridgeOverlay(false)
    }, 15000)
    return () => clearTimeout(timer)
  }, [effectiveTermOverlay])

  const handleToggleKeyboard = useCallback(() => {
    const ref = activeSlot === 0 ? termRef : splitTermRef
    if (keyboardVisible) ref.current?.blur()
    else ref.current?.focus()
    setKeyboardLocked(false)
  }, [keyboardVisible, activeSlot])

  const handleLockKeyboard = useCallback(() => {
    setKeyboardLocked(true)
    const ref = activeSlot === 0 ? termRef : splitTermRef
    ref.current?.blur()
  }, [activeSlot])

  const updateSetting = useCallback((patch: Partial<TerminalSettings>) => {
    setTermSettings(prev => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      termRef.current?.updateOptions(patch)
      saveTerminalSettings(next)
      if (patch.keyboardMode) keyboardModeRef.current = patch.keyboardMode
      return next
    })
  }, [])

  const handleConnStatusChange = useCallback((status: ConnStatus, _attempt?: number) => {
    // 重连 rebind 时触发 connecting，立即显示遮罩防止 Terminal 清屏闪烁
    if (status === 'connecting') {
      flushSync(() => { setTermOverlay(true); setTermStage('') })
    }
  }, [])

  const handlePaneInfo = useCallback((info: PaneInfo) => {
    paneInfoRef.current = info
    setPaneInfo(info)
    if (isWailsApp() && serverId && !isOpaqueTerminal) {
      void rememberDesktopTerminal(serverId, info.pane_id || paneId, info.session_name)
    }
  }, [isOpaqueTerminal, paneId, serverId])

  const handleReady = useCallback(() => {
    setPageReady(true); setTermOverlay(false); setBridgeOverlay(false)
  }, [])

  const handleStageChange = useCallback((stage: LoadingStage) => { setTermStage(stage) }, [])

  // 黑屏遮罩上显示的加载阶段文本（首次加载 + 重连共用）
  const loadingText = useMemo(() => {
    if (!hasEverConnected) {
      return statusText || '正在建立连接...'
    }
    switch (termStage) {
      case 'dc-creating': return '正在打开数据通道...'
      case 'dc-opened': return '正在加载终端快照...'
      case 'snapshot-received': return '正在渲染终端...'
      default: return '正在初始化终端...'
    }
  }, [hasEverConnected, statusText, termStage])

  const handlePaneClosed = useCallback(() => {
    setPaneClosed(true)
  }, [])

  if (!rawId) return <div>No pane ID</div>

  // 状态灯
  const indicator = getIndicator(phase, needLogin)

  // 返回按钮导航
  const parentPath = useMemo(() => {
    if (isWailsApp()) return '/'
    if (serverId) return `/s/${serverId}`
    return '/'
  }, [serverId])

  const handleCloseFiles = useCallback(() => {
    fileOpenRequestRef.current++
    setFilesOpen(false)
  }, [])

  const handleOpenFiles = useCallback(() => {
    if (!conn.isConnected || !webrtcTransport) {
      eventBus.emit('toast:show', { message: '需要连接后才能访问文件', type: 'info', duration: 1500 })
      return
    }

    const requestId = ++fileOpenRequestRef.current
    const fallbackPath = normalizePanePath(paneInfoRef.current?.current_path)
    setFileInitialPath(fallbackPath)
    setFileContextKey(`${paneId}:${requestId}:${fallbackPath}`)
    setFilesOpen(true)
    setMenuOpen(false)
    setSettingsOpen(false)
    setToolbarOpen(false)
    setFnPanelOpen(false)
    setSnippetPanelOpen(false)
    termRef.current?.blur()

    // Generic terminals already publish cwd in PaneInfo. Their opaque ID must
    // never be sent to the legacy tmux pane-context endpoint.
    if (isOpaqueTerminal) return

    // 打开瞬间查询 tmux 的实时 cwd；旧 daemon 未返回该字段时安全落到根目录。
    const contextPath = `/panes/${encodeURIComponent(paneId)}/context`
    void webrtcTransport.sendApiRequest('GET', contextPath).then(resp => {
      if (fileOpenRequestRef.current !== requestId) return
      if (resp.status >= 400) {
        eventBus.emit('toast:show', { message: '无法获取终端当前目录，已打开根目录', type: 'info', duration: 1800 })
        return
      }
      const body = resp.body as { current_path?: unknown } | null
      const currentPath = normalizePanePath(body?.current_path)
      setFileInitialPath(currentPath)
      setFileContextKey(`${paneId}:${requestId}:${currentPath}`)
    }).catch(() => {
      if (fileOpenRequestRef.current !== requestId) return
      eventBus.emit('toast:show', { message: '无法获取终端当前目录，已打开根目录', type: 'info', duration: 1800 })
    })
  }, [conn.isConnected, isOpaqueTerminal, paneId, webrtcTransport])

  const handleBack = useAppBack(parentPath, {
    onBack: () => {
      if (filesOpen) {
        if (fileDrawerRef.current?.handleBack()) return true
        handleCloseFiles()
        return true
      }
      if (isDesktopApp) {
        navigate('/', { replace: true, state: { desktopHome: true } })
        return true
      }
      return false
    },
  })

  // 刷新终端连接
  const handleRefresh = useCallback(() => {
    flushSync(() => {
      setTermOverlay(true)
    })
    termRef.current?.reconnect()
  }, [])

  // 手动重试（FAILED 状态下）
  const handleRetry = useCallback(() => {
    const id = serverId || '__direct__'
    storeManager.retryConnection(
      serverType === 'direct' ? 'local' : serverType,
      id,
    )
  }, [serverId, serverType, storeManager])

  // 工具栏模式切换
  const handleToolbarModeChange = useCallback((mode: ToolbarMode) => {
    setToolbarMode(mode)
    if (mode === 'selection') {
      setSelectionMode(true)
      setSearchActive(false)
      termRef.current?.clearSearch()
      termRef.current?.clearSelection()
      setHasSelection(false)
    } else if (mode === 'search') {
      setSelectionMode(false)
      setSearchActive(true)
      termRef.current?.clearSelection()
      setHasSelection(false)
    } else {
      setSelectionMode(false)
      setSearchActive(false)
      termRef.current?.clearSelection()
      termRef.current?.clearSearch()
      setHasSelection(false)
    }
  }, [])

  // 定期检查选区（选择模式中使用）
  useEffect(() => {
    if (!selectionMode) return
    const iv = setInterval(() => {
      setHasSelection(termRef.current?.hasSelection() ?? false)
    }, 200)
    return () => clearInterval(iv)
  }, [selectionMode])

  // 选择模式操作
  const handleSelectAll = useCallback(() => {
    termRef.current?.selectAll()
    setHasSelection(true)
  }, [])

  const handleSelectVisible = useCallback(() => {
    termRef.current?.selectVisible()
    setHasSelection(true)
  }, [])

  const handleCopy = useCallback(async () => {
    const text = termRef.current?.getSelection() ?? ''
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      eventBus.emit('toast:show', { message: '已复制到剪贴板', type: 'success', duration: 1500 })
      handleToolbarModeChange('default')
      setToolbarOpen(false)
    } catch {
      eventBus.emit('toast:show', { message: '复制失败', type: 'error' })
    }
  }, [handleToolbarModeChange])

  const handleSaveSnippetFromSelection = useCallback(() => {
    const text = termRef.current?.getSelection() ?? ''
    if (!text) return
    setSnippetPrefill(text)
    setSnippetPanelOpen(true)
    handleToolbarModeChange('default')
  }, [handleToolbarModeChange])

  // 粘贴操作
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text) {
        eventBus.emit('toast:show', { message: '剪贴板为空', type: 'info', duration: 1500 })
        return
      }
      const isMultiline = text.includes('\n') || text.includes('\r')
      if (!isMultiline && text.length < 200) {
        termRef.current?.pasteText(text)
        eventBus.emit('toast:show', { message: '已粘贴', type: 'success', duration: 1000 })
        setToolbarOpen(false)
        handleToolbarModeChange('default')
      } else {
        setPasteText(text)
        setPasteDialogOpen(true)
      }
    } catch {
      eventBus.emit('toast:show', { message: '无法读取剪贴板', type: 'error' })
    }
  }, [handleToolbarModeChange])

  const handlePasteConfirm = useCallback(() => {
    termRef.current?.pasteText(pasteText)
    setPasteDialogOpen(false)
    setPasteText('')
    setToolbarOpen(false)
    handleToolbarModeChange('default')
    eventBus.emit('toast:show', { message: '已粘贴', type: 'success', duration: 1000 })
  }, [pasteText, handleToolbarModeChange])

  const handlePasteCancel = useCallback(() => {
    setPasteDialogOpen(false)
    setPasteText('')
  }, [])

  // 搜索操作
  const handleSearchNext = useCallback((query: string) => {
    termRef.current?.searchNext(query)
  }, [])

  const handleSearchPrev = useCallback((query: string) => {
    termRef.current?.searchPrevious(query)
  }, [])

  const handleSearchClear = useCallback(() => {
    termRef.current?.clearSearch()
  }, [])

  // 片段操作
  const handleSnippetSend = useCallback((text: string) => {
    termRef.current?.pasteText(text)
    eventBus.emit('toast:show', { message: '已发送', type: 'success', duration: 1000 })
  }, [])

  const handleSnippetPrefillConsumed = useCallback(() => {
    setSnippetPrefill('')
  }, [])


  // 更多按钮切换
  const handleToggleToolbar = useCallback(() => {
    if (toolbarOpen) {
      setToolbarOpen(false)
      handleToolbarModeChange('default')
    } else {
      setToolbarOpen(true)
      setSettingsOpen(false) // 关闭设置面板
    }
  }, [toolbarOpen, handleToolbarModeChange])

  // Pane 切换导航
  const handleSelectPane = (id: string) => {
    const urlId = id.replace('%', '')
    if (serverId) {
      navigate(`/s/${serverId}/t/${urlId}`)
    } else {
      navigate(`/terminal/${urlId}`)
    }
  }

  const handleSelectTerminal = (id: string) => {
    const encodedId = encodeURIComponent(id)
    if (serverId) {
      navigate(`/s/${serverId}/terminal/${encodedId}`)
    } else {
      navigate(`/terminal-ref/${encodedId}`)
    }
  }

  // 判断覆盖层显示条件
  const showReconnectingOverlay = hasEverConnected && (
    phase === 'reconnecting' || phase === 'verifying' || phase === 'waiting_network' ||
    phase === 'idle' || phase === 'probing' || phase === 'connecting'
  )
  const showFailedOverlay = hasEverConnected && phase === 'failed' && !needLogin

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 flex flex-col bg-surface ${isDesktopApp ? 'tgent-desktop-terminal' : ''}`}
    >
      <header className={`shrink-0 bg-surface border-b border-t-border px-3 py-2 flex items-center justify-between gap-2 min-h-0 safe-top safe-x relative z-20 ${isDesktopApp ? 'tgent-desktop-terminal-header' : ''}`}>
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => { haptic(); handleBack() }} className="w-9 h-9 flex items-center justify-center rounded-lg text-t-secondary active:bg-[var(--color-border-subtle)] active:text-t-primary shrink-0 -ml-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          </button>
          {paneInfo ? (
            <div
              className={`flex items-center gap-1 min-w-0 font-mono text-xs ${(paneInfo.session_name || isOpaqueTerminal) ? 'cursor-pointer active:opacity-70' : ''}`}
              onClick={() => { if (paneInfo.session_name || isOpaqueTerminal) { haptic(); setSwitcherOpen(true) } }}
            >
              {paneInfo.session_name && (
                <>
                  <span className="text-blue-400 shrink-0">S</span>
                  <span className="text-blue-300 truncate">{paneInfo.session_name}</span>
                  <span className="text-t-muted shrink-0">/</span>
                </>
              )}
              {paneInfo.window_name && (
                <>
                  <span className="text-purple-400 shrink-0">W</span>
                  <span className="text-purple-300 truncate">{paneInfo.window_name}</span>
                  <span className="text-t-muted shrink-0">/</span>
                </>
              )}
              <span className="text-teal-400 shrink-0">{paneInfo.provider_kind ? paneInfo.provider_kind.slice(0, 1).toUpperCase() : 'P'}</span>
              <span className="text-teal-300 truncate">
                {terminalPath?.map(node => node.name).filter(Boolean).join(' / ') || paneInfo.title || paneInfo.command}
              </span>
              {(paneInfo.session_name || isOpaqueTerminal) && (
                <svg className="w-4 h-4 text-t-muted shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
                </svg>
              )}
            </div>
          ) : (
            <span className="text-t-muted font-mono text-xs">{paneId}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!isSplit && hasEverConnected && (
            <button
              type="button"
              onClick={() => { haptic(); handleOpenFiles() }}
              className={`w-7 h-7 flex items-center justify-center rounded-md ${conn.isConnected ? 'text-blue-400' : 'text-t-muted'} active:bg-[var(--color-border-subtle)]`}
              aria-label="文件管理"
              title="文件管理"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75A2.25 2.25 0 0 1 6 4.5h3.129c.597 0 1.169.237 1.591.659l1.121 1.121c.422.422.994.659 1.591.659H18A2.25 2.25 0 0 1 20.25 9.19v7.56A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25v-10Z" />
              </svg>
            </button>
          )}
          {/* 收藏按钮 - 始终可见 */}
          {isMobile && !isSplit && paneInfo?.session_name && serverId && serverType !== 'direct' && (
            <button
              onClick={() => {
                haptic()
                toggleFavorite({
                  paneId,
                    sessionName: paneInfo.session_name || '',
                    windowName: paneInfo.window_name || '',
                  paneCommand: paneInfo.command,
                  serverId,
                  serverType: serverType as 'local' | 'hub',
                  serverName: serverName || serverId,
                })
              }}
              className={`w-7 h-7 flex items-center justify-center rounded-md ${isFavorited ? 'text-yellow-400' : 'text-t-secondary'} active:bg-[var(--color-border-subtle)]`}
              aria-label="收藏"
            >
              {isFavorited ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                </svg>
              )}
            </button>
          )}
          {/* 工具栏按钮 - 直接可见 */}
          {showTerminalControls && !isSplit && (
            <button
              onClick={() => { haptic(); handleToggleToolbar() }}
              className={`w-7 h-7 flex items-center justify-center rounded-md ${toolbarOpen ? 'bg-blue-500/20 text-blue-400' : 'text-t-secondary'} active:bg-[var(--color-border-subtle)]`}
              aria-label="工具栏"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
          )}
          {/* 分屏模式的专属按钮 */}
          {showTerminalControls && isSplit && (
            <>
              <button
                onClick={() => { haptic(); setSyncInput(v => !v) }}
                className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
                  syncInput
                    ? 'bg-blue-500/15 text-blue-400'
                    : 'text-t-secondary active:bg-[var(--color-border-subtle)]'
                }`}
                aria-label="同步输入"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                </svg>
              </button>
              <button
                onClick={handleExitSplit}
                className="w-7 h-7 flex items-center justify-center rounded-md text-t-secondary active:bg-[var(--color-border-subtle)]"
                aria-label="退出分屏"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </>
          )}
          {/* 三点菜单按钮（非分屏模式） */}
          {showTerminalControls && !isSplit && (
            <div className="relative">
              <button
                ref={menuBtnRef}
                onClick={() => { haptic(); setMenuOpen(v => !v) }}
                className={`w-7 h-7 flex items-center justify-center rounded-md ${menuOpen ? 'bg-blue-500/20 text-blue-400' : 'text-t-secondary'} active:bg-[var(--color-border-subtle)]`}
                aria-label="菜单"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </button>
              {menuOpen && (
                <div ref={menuRef} className="absolute right-0 top-full mt-1 w-36 rounded-lg bg-elevated border border-t-border shadow-lg z-50 py-1 overflow-hidden">
                  {!isOpaqueTerminal && (
                    <button
                      onClick={() => { haptic(); setMenuOpen(false); setShowSplitSelector(true) }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-t-primary active:bg-[var(--color-border-subtle)]"
                    >
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v16.5h16.5V3.75H3.75ZM3.75 12h16.5" />
                      </svg>
                      分屏
                    </button>
                  )}
                  <button
                    onClick={() => { haptic(); setMenuOpen(false); handleRefresh() }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-t-primary active:bg-[var(--color-border-subtle)]"
                  >
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M20.015 4.652v4.993" />
                    </svg>
                    刷新
                  </button>
                  <button
                    ref={settingsBtnRef}
                    onClick={() => { haptic(); setMenuOpen(false); setSettingsOpen(v => !v); if (!settingsOpen) setToolbarOpen(false) }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm ${settingsOpen ? 'text-blue-400' : 'text-t-primary'} active:bg-[var(--color-border-subtle)]`}
                  >
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.248a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.248a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                    设置
                  </button>
                </div>
              )}
            </div>
          )}
          <span
            className={`w-2.5 h-2.5 rounded-full mr-1 ${indicator.color}${indicator.pulse ? ' animate-pulse' : ''}`}
            title={indicator.label}
          />
        </div>
        {/* 设置面板 - 浮动覆盖，不影响 terminal 大小 */}
        {showTerminalControls && settingsOpen && termSettings && (
          <div ref={settingsPanelRef} className="absolute left-0 right-0 top-full bg-surface border-b border-t-border px-2 py-2.5 space-y-3 shadow-lg">
            {/* 字体大小 */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-t-secondary">字体大小</span>
              <div className="flex items-center gap-2">
                <button
                  onPointerDown={e => { e.preventDefault(); haptic(); updateSetting({ fontSize: Math.max(6, termSettings.fontSize - 1) }) }}
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--color-border-subtle)] text-t-secondary active:bg-[var(--color-border-subtle)]/80"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" d="M5 12h14" />
                  </svg>
                </button>
                <span className="text-xs text-t-primary font-mono tabular-nums w-10 text-center">{termSettings.fontSize}px</span>
                <button
                  onPointerDown={e => { e.preventDefault(); haptic(); updateSetting({ fontSize: Math.min(32, termSettings.fontSize + 1) }) }}
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--color-border-subtle)] text-t-secondary active:bg-[var(--color-border-subtle)]/80"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>
            </div>
            {/* 字体选择 */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-t-secondary">字体</span>
              <select
                value={termSettings.fontFamily}
                onChange={e => updateSetting({ fontFamily: e.target.value })}
                className="px-2 py-1 rounded-md bg-[var(--color-border-subtle)] border-none text-t-primary text-xs focus:outline-none max-w-[160px]"
              >
                {FONT_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {/* 滚动缓冲区 */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-t-secondary">缓冲区行数</span>
              <div className="flex items-center gap-2">
                <button
                  onPointerDown={e => { e.preventDefault(); haptic(); updateSetting({ scrollback: Math.max(500, termSettings.scrollback - 500) }) }}
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--color-border-subtle)] text-t-secondary active:bg-[var(--color-border-subtle)]/80"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" d="M5 12h14" />
                  </svg>
                </button>
                <span className="text-xs text-t-primary font-mono tabular-nums w-12 text-center">{termSettings.scrollback}</span>
                <button
                  onPointerDown={e => { e.preventDefault(); haptic(); updateSetting({ scrollback: Math.min(50000, termSettings.scrollback + 500) }) }}
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--color-border-subtle)] text-t-secondary active:bg-[var(--color-border-subtle)]/80"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>
            </div>
            {/* 光标闪烁 */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-t-secondary">光标闪烁</span>
              <button
                onClick={() => { haptic(); updateSetting({ cursorBlink: !termSettings.cursorBlink }) }}
                className={`w-9 h-5 rounded-full relative transition-colors ${
                  termSettings.cursorBlink ? 'bg-blue-600' : 'bg-[var(--color-text-muted)]'
                }`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  termSettings.cursorBlink ? 'left-[18px]' : 'left-0.5'
                }`} />
              </button>
            </div>
            {/* 键盘模式 */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-t-secondary">键盘适配</span>
              <select
                value={termSettings.keyboardMode}
                onChange={e => { haptic(); updateSetting({ keyboardMode: e.target.value as 'auto' | 'resize' | 'shift' }); reapplyKeyboardLayout() }}
                className="px-2 py-1 rounded-md bg-[var(--color-border-subtle)] border-none text-t-primary text-xs focus:outline-none"
              >
                <option value="auto">自动</option>
                <option value="resize">始终 Resize</option>
                <option value="shift">始终上移</option>
              </select>
            </div>
          </div>
        )}
        {/* 工具栏 - 浮动覆盖，不影响 terminal 大小 */}
        {showTerminalControls && toolbarOpen && (
          <div className="absolute left-0 right-0 top-full shadow-lg z-30">
            <TerminalToolbar
              mode={toolbarMode}
              onModeChange={handleToolbarModeChange}
              onSelectAll={handleSelectAll}
              onSelectVisible={handleSelectVisible}
              onCopy={handleCopy}
              onSaveSnippet={handleSaveSnippetFromSelection}
              hasSelection={hasSelection}
              onPaste={handlePaste}
              onSearchNext={handleSearchNext}
              onSearchPrev={handleSearchPrev}
              onSearchClear={handleSearchClear}
              onOpenSnippets={() => { setSnippetPanelOpen(true); setToolbarOpen(false); handleToolbarModeChange('default') }}
            />
          </div>
        )}
      </header>
      <main ref={mainRef} className="flex-1 min-h-0 overflow-hidden relative" style={{ backgroundColor: 'var(--color-term-bg)' }}>
        {isMobile && (
          <FnPanel
            open={fnPanelOpen}
            onClose={() => setFnPanelOpen(false)}
            onSend={handleFnSend}
            paneCommand={(activeSlot === 0 ? paneInfo : splitPaneInfo)?.command}
          />
        )}
        <SnippetPanel
          open={snippetPanelOpen}
          onClose={() => setSnippetPanelOpen(false)}
          onSend={handleSnippetSend}
          prefillContent={snippetPrefill}
          onPrefillConsumed={handleSnippetPrefillConsumed}
        />
        {/* SplitPaneSelector 浮层 */}
        {showSplitSelector && (
          <SplitPaneSelector
            existingTransport={webrtcTransport}
            existingServerId={serverId}
            onSelect={handleSplitSelect}
            onCancel={() => setShowSplitSelector(false)}
          />
        )}
        {/* 统一布局：始终用 flex column，Terminal 保持在同一 React 树位置 */}
        <div className="absolute inset-0">
          <div ref={contentRef} className="flex flex-col h-full">
            {/* Slot 0: 当前终端（始终存在） */}
            <div
              className="relative overflow-hidden min-h-0"
              style={{ flex: isSplit ? splitRatio : 1 }}
              onPointerDown={isSplit && activeSlot !== 0 ? () => { haptic(); setActiveSlot(0) } : undefined}
            >
              {/* 首次连接遮罩（渐隐） */}
              {!isSplit && (
                <div
                  className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center"
                  style={{
                    backgroundColor: 'var(--color-term-bg)',
                    opacity: pageReady ? 0 : 1,
                  }}
                >
                  {!pageReady && (
                    <div className="flex flex-col items-center gap-3">
                      <svg className="w-5 h-5 text-t-muted animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span className="text-xs text-t-muted">{loadingText}</span>
                    </div>
                  )}
                </div>
              )}
              {/* Terminal：首次 connected 后挂载，之后不卸载 */}
              {shouldMountTerminal && (
                <>
                  <div ref={termWrapperRef} className="absolute inset-0">
                    <Terminal
                      ref={termRef}
                      paneId={paneId}
                      webrtcTransport={webrtcTransport}
                      ctrlActive={ctrlState !== 'off'}
                      altActive={altState !== 'off'}
                      preventFocus={keyboardLocked}
                      selectionMode={!isSplit && selectionMode}
                      searchActive={!isSplit && searchActive}
                      onCursorMove={handleCursorMove}
                      onModifierUsed={handleModifierUsed}
                      onConnStatusChange={handleConnStatusChange}
                      onPaneInfo={handlePaneInfo}
                      onReady={handleReady}
                      onPaneClosed={handlePaneClosed}
                      onStageChange={handleStageChange}
                      onBufferChange={handleBufferChange}
                      onInput={isSplit ? handleInput0 : undefined}
                    />
                  </div>
                  {/* 刷新时的遮罩（仅单终端模式） */}
                  {!isSplit && (
                    <div
                      className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center"
                      style={{
                        backgroundColor: 'var(--color-term-bg)',
                        opacity: effectiveTermOverlay ? 1 : 0,
                      }}
                    >
                      {effectiveTermOverlay && (
                        <div className="flex flex-col items-center gap-3">
                          <svg className="w-5 h-5 text-t-muted animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          <span className="text-xs text-t-muted">{loadingText}</span>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              {/* RECONNECTING / WAITING_NETWORK 覆盖层（仅单终端模式） */}
              {!isSplit && showReconnectingOverlay && (
                <div className="absolute inset-0 z-25 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                  <div className="flex flex-col items-center gap-3">
                    {phase === 'waiting_network' ? (
                      <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 text-t-muted animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    <span className="text-sm text-t-secondary">{statusText}</span>
                    {phase === 'waiting_network' ? (
                      <span className="mt-1 text-xs text-t-muted">网络恢复后将自动重连</span>
                    ) : (phase === 'reconnecting' || phase === 'verifying') ? (
                      <span className="mt-1 text-xs text-t-muted">自动重连中...</span>
                    ) : null}
                  </div>
                </div>
              )}
              {/* FAILED 覆盖层（仅单终端模式） */}
              {!isSplit && showFailedOverlay && (
                <div className="absolute inset-0 z-30 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                  <div className="flex flex-col items-center gap-4">
                    <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                    </svg>
                    <span className="text-sm text-red-400">{statusText || '连接失败'}</span>
                    <button
                      onClick={() => { haptic(); handleRetry() }}
                      className="px-5 py-2 rounded-xl bg-red-500/20 text-red-400 text-sm font-medium active:bg-red-500/30 transition-colors"
                    >
                      点击重试
                    </button>
                  </div>
                </div>
              )}
              {/* Pane 已关闭覆盖层（仅单终端模式） */}
              {!isSplit && paneClosed && (
                <div className="absolute inset-0 z-30 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
                  <div className="flex flex-col items-center gap-4">
                    <svg className="w-8 h-8 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                    </svg>
                    <span className="text-sm text-t-secondary">Pane 已关闭</span>
                    <button
                      onClick={() => { haptic(); handleBack() }}
                      className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm active:bg-blue-700"
                    >
                      返回
                    </button>
                  </div>
                </div>
              )}
              {/* 首次连接中（仅单终端模式） */}
              {!isSplit && !hasEverConnected && (
                <div className="absolute inset-0 flex items-center justify-center">
                  {!conn.isFailed && !needLogin && (
                    <div className="flex flex-col items-center gap-3">
                      <svg className="w-5 h-5 text-t-muted animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span className="text-xs text-t-muted">{statusText}</span>
                    </div>
                  )}
                  {conn.isFailed && !needLogin && (
                    <div className="flex flex-col items-center gap-3">
                      <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                      </svg>
                      <span className="text-xs text-red-400">{statusText || '连接失败'}</span>
                      <button
                        onClick={() => { haptic(); handleRetry() }}
                        className="mt-2 px-4 py-2 rounded-lg bg-red-500/20 text-red-400 text-sm active:bg-red-500/30"
                      >
                        重试
                      </button>
                    </div>
                  )}
                  {needLogin && (
                    <div className="flex flex-col items-center gap-3">
                      <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                      </svg>
                      <span className="text-sm text-purple-400 mb-2">本地网络不可达，请登录 Hub 远程连接</span>
                      <button
                        onClick={() => { haptic(); navigate('/login', { state: { returnTo: location.pathname + location.search } }) }}
                        className="px-5 py-2 rounded-xl bg-purple-500/20 text-purple-400 text-sm font-medium active:bg-purple-500/30 transition-colors"
                      >
                        去登录
                      </button>
                    </div>
                  )}
                </div>
              )}
              {/* 分屏模式下非活跃暗化层 */}
              {isSplit && activeSlot !== 0 && (
                <div className="absolute inset-0 z-40 pointer-events-none" style={{ backgroundColor: 'rgba(0,0,0,0.25)' }} />
              )}
            </div>

            {/* 分割线 + Slot 1（仅分屏模式） */}
            {isSplit && splitSlot && (
              <>
                <div className="shrink-0">
                  <SplitDivider
                    ratio={splitRatio}
                    containerHeight={contentHeight}
                    onRatioChange={setSplitRatio}
                  />
                </div>
                <div
                  className="relative overflow-hidden min-h-0"
                  style={{ flex: 1 - splitRatio }}
                  onPointerDown={activeSlot !== 1 ? () => { haptic(); setActiveSlot(1) } : undefined}
                >
                  <SplitTerminalSlot
                    serverId={splitSlot.serverId}
                    paneId={splitSlot.paneId}
                    isActive={activeSlot === 1}
                    onTap={() => { haptic(); setActiveSlot(1) }}
                    onPaneInfo={handleSplitPaneInfo}
                    termRef={splitTermRef}
                    ctrlActive={ctrlState !== 'off'}
                    altActive={altState !== 'off'}
                    preventFocus={keyboardLocked}
                    onModifierUsed={handleModifierUsed}
                    onInput={handleInput1}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </main>
      <TerminalFileDrawer
        ref={fileDrawerRef}
        open={filesOpen}
        transport={lastTransportRef.current}
        initialPath={fileInitialPath}
        contextKey={fileContextKey}
        isRelay={isRelay}
        allowRelayTransfer={conn.allowRelayTransfer}
        disconnected={!conn.isConnected || conn.connectionMode === null}
        reconnecting={phase === 'reconnecting' || phase === 'verifying' || phase === 'waiting_network' || phase === 'connecting'}
        statusText={statusText}
        serverId={serverId}
        transferProps={transferProps}
        transfers={fileTransfer.transfers}
        hasActiveTransfers={fileTransfer.hasActiveTransfers}
        onCancelTransfer={fileTransfer.cancelTransfer}
        onDismissTransfer={fileTransfer.dismissTransfer}
        onRetryTransfer={fileTransfer.retryTransfer}
        onClose={handleCloseFiles}
      />
      {!isOpaqueTerminal && paneInfo?.session_name && (
        <PaneSwitcher
          open={switcherOpen}
          sessionName={paneInfo.session_name}
          currentPaneId={paneId}
          webrtcTransport={webrtcTransport}
          onClose={() => setSwitcherOpen(false)}
          onSelectPane={handleSelectPane}
          serverId={serverId}
          serverName={serverName}
          serverType={serverType as 'local' | 'hub'}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onRemoveFavorite={removeFromFavorites}
          onNavigateToFavorite={navigateToFavorite}
        />
      )}
      {isOpaqueTerminal && paneInfo?.provider_id && (
        <TerminalTopologySwitcher
          open={switcherOpen}
          providerId={paneInfo.provider_id}
          topologies={terminalTopology.topologies}
          currentTerminalId={paneInfo.terminal_id}
          onClose={() => setSwitcherOpen(false)}
          onSelectTerminal={handleSelectTerminal}
        />
      )}
      {isMobile && (
        <VirtualKeybar
          onKey={handleKey}
          onToggleKeyboard={handleToggleKeyboard}
          onLockKeyboard={handleLockKeyboard}
          keyboardVisible={keyboardVisible}
          keyboardLocked={keyboardLocked}
          ctrlState={ctrlState}
          setCtrlState={setCtrlState}
          altState={altState}
          setAltState={setAltState}
          fnOpen={fnPanelOpen}
          onFnToggle={() => setFnPanelOpen(v => !v)}
        />
      )}
      <PasteConfirmDialog
        open={pasteDialogOpen}
        text={pasteText}
        onConfirm={handlePasteConfirm}
        onCancel={handlePasteCancel}
      />
    </div>
  )
}
