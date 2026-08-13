import { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import SessionList, { type SessionListHandle } from '../components/SessionList'
import TopologyList from '../components/TopologyList'
import FileManager, { type FileManagerHandle } from '../components/files/FileManager'
import FileTransferPanel from '../components/files/FileTransferPanel'
import PathBookmarkPanel from '../components/files/PathBookmarkPanel'
import ConnectionInfoDialog from '../components/ConnectionInfoDialog'
import PullToRefresh from '../components/PullToRefresh'
import Skeleton from '../components/Skeleton'
import ActionSheet from '../components/common/ActionSheet'
import { haptic, isWailsApp } from '../lib/platform'
import { useConnectionStore } from '../hooks/useConnectionStore'
import { useFileTransferStore } from '../hooks/useFileTransferStore'
import { useAgentSessions, useAgentTopology } from '../hooks/useAgentData'
import { useAppContext } from '../contexts/AppContext'
import { useAppBack } from '../hooks/useAppBack'
import { resolveServerType } from '../lib/resolveServerType'
import { eventBus } from '../state/EventBus'

type DashboardTab = 'sessions' | 'files'

export default function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const { serverId } = useParams<{ serverId?: string }>()
  const sessionListRef = useRef<SessionListHandle>(null)

  const [serverType, setServerType] = useState<'local' | 'hub' | 'direct'>('direct')

  useEffect(() => {
    resolveServerType(serverId).then(setServerType)
  }, [serverId])

  const conn = useConnectionStore(serverId)
  const { sessions, status, refresh } = useAgentSessions(conn.agentStore)
  const topology = useAgentTopology(conn.agentStore)
  const additionalTopologies = isWailsApp()
    ? []
    : topology.topologies.filter(item =>
      item.provider.kind !== 'tmux' && (item.provider.running || item.nodes.length > 0 || !!item.error),
    )
  const hasTmuxCategory = sessions.length > 0 || !!status?.tmux_running
  const providerCategoryCount = (hasTmuxCategory ? 1 : 0) + additionalTopologies.length
  const groupProviders = providerCategoryCount > 1
  const [tmuxExpanded, setTmuxExpanded] = useState(true)

  // 保留最后一次有效的 transport，断线后 FileManager 继续用它保持挂载
  const lastTransportRef = useRef(conn.transport)
  if (conn.transport) lastTransportRef.current = conn.transport

  const [activeTab, setActiveTab] = useState<DashboardTab>('sessions')
  // 从终端路径点击跳转来时，记录返回路径
  const returnToRef = useRef<string | null>(null)
  const [netInfo, setNetInfo] = useState<{
    type: 'p2p' | 'relay' | 'unknown'
    localAddr?: string
    remoteAddr?: string
    candidateType?: string
    remoteCandidateType?: string
    rtt?: number
  } | null>(null)
  const [showNetInfo, setShowNetInfo] = useState(false)
  const [isRelay, setIsRelay] = useState<boolean | null>(null)

  const hasData = sessions.length > 0 || additionalTopologies.some(item => item.nodes.length > 0)
  const showBack = serverType !== 'direct'

  // 连接建立后检测是否 relay
  useEffect(() => {
    if (!conn.isConnected || !conn.transport) {
      setIsRelay(null)
      return
    }
    conn.transport.getConnectionInfo().then(info => {
      setIsRelay(info.type === 'relay')
    })
  }, [conn.isConnected, conn.transport])

  // Files Tab 可见条件：已连接，或曾经连接过（断开时保留 tab）
  const [hasEverConnected, setHasEverConnected] = useState(false)
  useEffect(() => {
    if (conn.isConnected && conn.connectionMode !== null) {
      setHasEverConnected(true)
    }
  }, [conn.isConnected, conn.connectionMode])
  const showFilesTab = hasEverConnected
  const filesDisabled = !conn.isConnected || conn.connectionMode === null

  // 文件传输状态（全局 Store，不随组件卸载丢失）
  const fileTransfer = useFileTransferStore(serverId)
  const fileManagerRef = useRef<FileManagerHandle>(null)

  // 传输完成时刷新文件列表
  const { storeManager } = useAppContext()
  useEffect(() => {
    const resolvedId = serverId || '__direct__'
    const ftStore = storeManager.getFileTransferStore(
      serverType === 'direct' ? 'local' : serverType as 'local' | 'hub',
      resolvedId,
    )
    ftStore.onTransferComplete = () => {
      fileManagerRef.current?.refresh()
    }
    return () => { ftStore.onTransferComplete = undefined }
  }, [storeManager, serverId, serverType])

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

  // 从终端跳转来的路径：切换到 files tab 并导航到目标路径
  useEffect(() => {
    const state = location.state as any
    const filesPath = state?.filesPath
    if (!filesPath) return
    // 记录返回路径
    if (state?.returnTo) returnToRef.current = state.returnTo
    // 清除 state 防止重复触发
    window.history.replaceState({}, '')
    setActiveTab('files')
    // 延迟等待 FileManager 挂载后再导航
    const timer = setTimeout(() => {
      fileManagerRef.current?.navigateTo(filesPath)
    }, 100)
    return () => clearTimeout(timer)
  }, [location.state])

  const handleSelectPane = (paneId: string) => {
    const urlId = paneId.startsWith('%') ? paneId.slice(1) : paneId
    if (serverId) {
      navigate(`/s/${serverId}/t/${urlId}`)
    } else {
      navigate(`/terminal/${urlId}`)
    }
  }

  const handleSelectTerminal = async (terminalId: string) => {
    const topologyApi = conn.serverApi?.topology
    try {
      const info = await topologyApi?.getTerminal(terminalId)
      const versions = topology.capabilities?.datachannel_versions || []
      const supportsRaw = versions.includes(1) && info?.capabilities.raw_stream
      const supportsFrame = versions.includes(2) && info?.capabilities.frame_stream
      if (!info || !info.capabilities.snapshot || (!supportsRaw && !supportsFrame)) {
        eventBus.emit('toast:show', { message: '当前客户端暂不支持这种终端连接', type: 'info', duration: 2200 })
        return
      }
    } catch {
      eventBus.emit('toast:show', { message: '无法读取终端能力，请稍后重试', type: 'error', duration: 2200 })
      return
    }
    const encodedId = encodeURIComponent(terminalId)
    if (serverId) {
      navigate(`/s/${serverId}/terminal/${encodedId}`)
    } else {
      navigate(`/terminal-ref/${encodedId}`)
    }
  }

  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab

  useAppBack('/', {
    onBack: () => {
      if (activeTabRef.current === 'files') {
        const handled = fileManagerRef.current?.handleBack()
        if (handled) return true  // 返回上一级目录或关闭预览
        // 已在根目录：如果是从终端跳转来的，返回终端
        if (returnToRef.current) {
          const to = returnToRef.current
          returnToRef.current = null
          navigate(to, { replace: true })
          return true
        }
        // 否则导航回机器列表
        return false
      }
      if (!showBack) return true  // direct 模式吞掉事件
      return false
    }
  })

  const handleNetInfo = async () => {
    haptic()
    if (!conn.transport) return
    const info = await conn.transport.getConnectionInfo()
    setNetInfo(info)
    setShowNetInfo(true)
  }

  const handleRetryConnection = () => {
    haptic()
    storeManager.retryConnection(
      serverType === 'direct' ? 'local' : serverType,
      serverId || '__direct__',
    )
  }

  const handleTabSwitch = (tab: DashboardTab) => {
    if (tab === 'files' && filesDisabled) {
      eventBus.emit('toast:show', { message: '需要连接后才能访问文件', type: 'info', duration: 1500 })
      return
    }
    haptic()
    setActiveTab(tab)
  }

  // Files tab 更多菜单
  const [showFilesMore, setShowFilesMore] = useState(false)
  // 跟踪 FileManager 的多选模式状态
  const [fmSelectionMode, setFmSelectionMode] = useState(false)
  // 路径收藏面板
  const [bookmarkPanelOpen, setBookmarkPanelOpen] = useState(false)
  // 从文件管理器"在此目录新建 Session"传入的 cwd
  const [pendingSessionCwd, setPendingSessionCwd] = useState('')

  const handleCreateSessionInDir = useCallback((dirPath: string) => {
    haptic()
    setPendingSessionCwd(dirPath)
    setActiveTab('sessions')
    // 延迟打开弹窗，等 tab 切换完成
    setTimeout(() => {
      sessionListRef.current?.openNewSession(dirPath)
    }, 100)
  }, [])

  // App resume 时刷新数据（冻结期间事件可能丢失导致数据过时）
  useEffect(() => {
    return eventBus.on('app:resume', () => {
      if (!conn.isConnected) return
      refresh()
      if (activeTabRef.current === 'files') {
        fileManagerRef.current?.refresh()
      }
    })
  }, [conn.isConnected, refresh])

  // ========== 状态条 ==========
  const statusBar = useMemo(() => renderStatusBar(
    conn.phase, conn.statusText, conn.reconnectAttempt, conn.needLogin,
    handleRetryConnection, () => navigate('/login'),
  ), [conn.phase, conn.statusText, conn.reconnectAttempt, conn.needLogin])

  // SessionList 公共 props
  const sessionListProps = {
    ref: sessionListRef,
    sessions,
    status,
    serverApi: conn.serverApi,
    agentStore: conn.agentStore,
    onSelectPane: handleSelectPane,
    transport: conn.transport,
    initialCwd: pendingSessionCwd,
  }

  // ========== 主内容区渲染策略 ==========
  // FileManager 在曾经连接过后保持挂载，断开时加遮罩
  const canShowFiles = hasEverConnected
  const isReconnecting = conn.phase === 'reconnecting' || conn.phase === 'verifying'

  const renderSessionsContent = () => {
    const tmuxSessions = <SessionList {...sessionListProps} />
    const tmuxSection = hasTmuxCategory && (groupProviders ? (
      <section aria-label="tmux 终端">
        <button
          type="button"
          onClick={() => { haptic(); setTmuxExpanded(value => !value) }}
          className="w-full min-h-11 flex items-center gap-3 mb-2 text-left active:opacity-70"
          aria-expanded={tmuxExpanded}
        >
          <span className="w-9 h-9 rounded-lg bg-sky-500/15 text-sky-300 flex items-center justify-center font-mono text-xs font-semibold shrink-0">
            TM
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-t-primary">tmux</span>
            <span className="block text-xs text-t-muted">
              {status?.tmux_running ? `${sessions.length} 个会话` : '未运行'}
            </span>
          </span>
          <svg className={`w-4 h-4 shrink-0 text-t-muted transition-transform duration-200 ${tmuxExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
          </svg>
        </button>
        {tmuxExpanded && tmuxSessions}
      </section>
    ) : tmuxSessions)
    const topologySection = (
      <>
        {topology.error && (
          <button
            type="button"
            onClick={() => { void refresh() }}
            className="w-full min-h-11 px-3 text-sm text-amber-300 border-t border-t-border-subtle text-left active:bg-[var(--color-border-subtle)]"
          >
            其他终端来源加载失败，点此重试
          </button>
        )}
        <TopologyList topologies={additionalTopologies} onSelectTerminal={handleSelectTerminal} groupProviders={groupProviders} />
      </>
    )
    // CONNECTED 或正在连接中有数据: 正常渲染 SessionList
    if (conn.isConnected || (!isReconnecting && !conn.needLogin && !conn.isFailed && hasData)) {
      return (
        <div className="space-y-6">
          {tmuxSection}
          {topologySection}
        </div>
      )
    }

    // 断开状态下有数据：半透明显示 SessionList
    if (hasData) {
      const opacity = isReconnecting ? 'opacity-50' : 'opacity-40'
      return (
        <div className="relative">
          <div className={`${opacity} pointer-events-none`}>
            {tmuxSection}
            {topologySection}
          </div>
        </div>
      )
    }

    // 无数据时的空状态提示
    const emptyMsg = conn.needLogin
      ? '当前网络下无法直连，请登录 Hub 后再试'
      : conn.isFailed
        ? (conn.statusText || '连接失败，无法获取会话列表')
        : null
    if (emptyMsg) {
      return <div className="text-center py-20 text-t-muted text-sm">{emptyMsg}</div>
    }

    // 连接中无数据：骨架屏
    return renderSkeleton()
  }

  return (
    <div className="h-screen flex flex-col bg-page safe-x">
      <header className="shrink-0 z-10 bg-page/80 backdrop-blur-xl border-b border-t-border-subtle safe-top">
        <div className="max-w-lg mx-auto px-5 sm:px-6 pt-3 pb-2.5 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {showBack && (
              <button
                onClick={() => { haptic(); navigate('/') }}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-t-secondary active:bg-[var(--color-border-subtle)] active:text-t-primary shrink-0 -ml-1"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
            )}
            {/* Tab 切换 */}
            {showFilesTab ? (
              <div className="flex items-center gap-0.5 bg-[var(--color-border-subtle)]/50 rounded-lg p-0.5">
                <button
                  onClick={() => handleTabSwitch('sessions')}
                  className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                    activeTab === 'sessions'
                      ? 'bg-[var(--color-bg-card,#2c2c2e)] text-t-primary shadow-sm'
                      : 'text-t-muted hover:text-t-secondary'
                  }`}
                >
                  Sessions
                </button>
                <button
                  onClick={() => handleTabSwitch('files')}
                  className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                    filesDisabled
                      ? 'text-t-muted/50 cursor-not-allowed'
                      : activeTab === 'files'
                        ? 'bg-[var(--color-bg-card,#2c2c2e)] text-t-primary shadow-sm'
                        : 'text-t-muted hover:text-t-secondary'
                  }`}
                >
                  Files
                </button>
              </div>
            ) : (
              <h1 className="text-[28px] sm:text-xl font-bold text-t-primary tracking-tight leading-tight">Sessions</h1>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Files tab 操作按钮（非多选模式时显示） */}
            {activeTab === 'files' && showFilesTab && !fmSelectionMode && (
              <>
                <button
                  onClick={() => { haptic(); setBookmarkPanelOpen(true) }}
                  className="p-2 text-yellow-500 active:opacity-70 transition-colors"
                  aria-label="路径收藏"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                </button>
                <button
                  onClick={() => { haptic(); fileManagerRef.current?.enterSelectionMode() }}
                  className="p-2 text-blue-500 active:opacity-70 transition-colors"
                  aria-label="多选"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
                <button
                  onClick={() => { haptic(); setShowFilesMore(true) }}
                  className="p-2 text-t-secondary hover:text-t-primary active:text-t-primary transition-colors"
                  aria-label="更多"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                  </svg>
                </button>
              </>
            )}
            {conn.isConnected && conn.transport && (
              <button
                onClick={handleNetInfo}
                className="p-2 text-t-secondary hover:text-t-primary active:text-t-primary transition-colors"
                aria-label="网络信息"
              >
                <div className="relative">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path d="M16.364 3.636a.75.75 0 00-1.06 1.06 7.5 7.5 0 010 10.608.75.75 0 001.06 1.06 9 9 0 000-12.728zM4.697 4.697a.75.75 0 00-1.061-1.06 9 9 0 000 12.727.75.75 0 101.06-1.06 7.5 7.5 0 010-10.607zM13.657 6.343a.75.75 0 00-1.06 1.06 4.5 4.5 0 010 6.364.75.75 0 001.06 1.06 6 6 0 000-8.484zM6.343 7.404a.75.75 0 00-1.06-1.06 6 6 0 000 8.484.75.75 0 101.06-1.06 4.5 4.5 0 010-6.364zM10 11.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
                  </svg>
                  <span className="absolute -bottom-1 -right-1 text-[8px] font-bold leading-none">{isRelay ? 'R' : 'P'}</span>
                </div>
              </button>
            )}
            <button
              onClick={() => { haptic(); navigate('/settings') }}
              className="p-2 -mr-2 text-t-secondary hover:text-t-primary active:text-t-primary transition-colors"
              aria-label="设置"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* 连接状态条（非 CONNECTED 时显示） */}
      {statusBar}

      {/* 网络信息弹窗 */}
      {showNetInfo && netInfo && (
        <ConnectionInfoDialog
          netInfo={netInfo}
          onClose={() => setShowNetInfo(false)}
          onReconnect={handleRetryConnection}
        />
      )}

      {activeTab === 'sessions' && (
        <PullToRefresh onRefresh={async () => {
          if (conn.isFailed || conn.needLogin || isReconnecting) {
            handleRetryConnection()
            return
          }
          await refresh()
        }}>
          <main className="max-w-lg mx-auto px-4 sm:px-6 py-5 sm:py-6 pb-24">
            {renderSessionsContent()}
          </main>
        </PullToRefresh>
      )}

      {/* FileManager 始终挂载以保持路径状态 */}
      {canShowFiles && lastTransportRef.current && (
        <div className={`flex-1 flex flex-col overflow-hidden relative ${activeTab !== 'files' ? 'hidden' : ''}`}>
          <PullToRefresh onRefresh={async () => { fileManagerRef.current?.refresh() }}>
            <main className="max-w-lg mx-auto px-4 sm:px-6 pb-24">
              <FileManager ref={fileManagerRef} transport={lastTransportRef.current} isRelay={isRelay === true} allowRelayTransfer={conn.allowRelayTransfer} onSelectionModeChange={setFmSelectionMode} transferProps={transferProps} onCreateSessionInDir={handleCreateSessionInDir} />
            </main>
          </PullToRefresh>
          {/* 断线遮罩 */}
          {filesDisabled && (
            <div className="absolute inset-0 bg-page/60 backdrop-blur-sm flex items-center justify-center z-10">
              <div className="text-center space-y-2">
                {isReconnecting ? (
                  <>
                    <svg className="w-5 h-5 text-yellow-400 animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <p className="text-sm text-t-muted">{conn.statusText || '正在重连...'}</p>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 text-t-muted mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                    <p className="text-sm text-t-muted">连接已断开</p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 传输进度面板（仅 Files tab 显示，避免遮挡 Sessions 的加号按钮） */}
      {activeTab === 'files' && (
        <FileTransferPanel
          transfers={fileTransfer.transfers}
          hasActiveTransfers={fileTransfer.hasActiveTransfers}
          onCancel={fileTransfer.cancelTransfer}
          onDismiss={fileTransfer.dismissTransfer}
          onRetry={fileTransfer.retryTransfer}
        />
      )}

      {/* Files tab 更多操作菜单 */}
      <ActionSheet
        visible={showFilesMore}
        title="更多操作"
        actions={[
          {
            label: '上传文件',
            disabled: fileManagerRef.current?.isRelayNoTransfer,
            disabledLabel: '上传文件（中转不可用）',
            onPress: () => {
              setShowFilesMore(false)
              setTimeout(() => fileManagerRef.current?.triggerUpload(), 50)
            },
          },
          {
            label: '新建目录',
            onPress: () => {
              setShowFilesMore(false)
              setTimeout(() => fileManagerRef.current?.triggerNewDir(), 50)
            },
          },
          {
            label: fileManagerRef.current?.showHidden ? '隐藏隐藏文件' : '显示隐藏文件',
            onPress: () => fileManagerRef.current?.toggleShowHidden(),
          },
          {
            label: '刷新目录',
            onPress: () => fileManagerRef.current?.refresh(),
          },
        ]}
        onClose={() => setShowFilesMore(false)}
      />

      {/* 路径收藏面板 */}
      {canShowFiles && serverId && (
        <PathBookmarkPanel
          open={bookmarkPanelOpen}
          onClose={() => setBookmarkPanelOpen(false)}
          onNavigate={(path) => { fileManagerRef.current?.navigateTo(path) }}
          currentPath={fileManagerRef.current?.currentPath ?? '/'}
          serverId={serverId}
        />
      )}
    </div>
  )
}

// ========== 辅助组件 ==========

/** 骨架屏：3 个 Session 占位条 */
function renderSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="rounded-2xl bg-[var(--color-border-subtle)] overflow-hidden px-4 py-3.5">
          <div className="flex items-center gap-3">
            <Skeleton width={40} height={40} className="rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton width="60%" height={17} />
              <Skeleton width="30%" height={13} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** 状态条渲染（非 CONNECTED 时显示在 header 下方） */
function renderStatusBar(
  phase: string,
  statusText: string,
  _reconnectAttempt: number,
  needLogin: boolean,
  onRetry: () => void,
  onLogin: () => void,
) {
  if (phase === 'connected') return null

  const warningIcon = (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
    </svg>
  )
  const spinner = (color: string) => (
    <svg className={`w-4 h-4 shrink-0 animate-spin ${color}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
  const retryBtn = (color: string) => (
    <button onClick={onRetry} className={`ml-auto ${color} font-medium active:opacity-75 shrink-0`}>重试</button>
  )

  // needLogin 特殊处理
  if (needLogin) {
    return (
      <div className="max-w-lg mx-auto px-4 sm:px-6">
        <div className="mt-2 rounded-xl border px-3 py-2 text-sm flex items-center gap-2 bg-purple-500/10 border-purple-500/20 text-purple-400">
          {warningIcon}
          <span>{statusText}</span>
          <button onClick={() => { haptic(); onLogin() }} className="ml-auto text-purple-300 font-medium active:opacity-75 shrink-0">去登录</button>
        </div>
      </div>
    )
  }

  type PhaseConfig = { bg: string; text: string; icon: React.ReactNode; action?: React.ReactNode }
  const configs: Record<string, PhaseConfig> = {
    idle:            { bg: 'bg-blue-500/10 border-blue-500/20', text: 'text-blue-400', icon: spinner('text-blue-400') },
    probing:         { bg: 'bg-blue-500/10 border-blue-500/20', text: 'text-blue-400', icon: spinner('text-blue-400') },
    connecting:      { bg: 'bg-blue-500/10 border-blue-500/20', text: 'text-blue-400', icon: spinner('text-blue-400') },
    reconnecting:    { bg: 'bg-yellow-500/10 border-yellow-500/20', text: 'text-yellow-400', icon: spinner('text-yellow-400') },
    verifying:       { bg: 'bg-yellow-500/10 border-yellow-500/20', text: 'text-yellow-400', icon: spinner('text-yellow-400') },
    waiting_network: { bg: 'bg-red-500/10 border-red-500/20', text: 'text-red-400', icon: warningIcon, action: retryBtn('text-red-300') },
    failed:          { bg: 'bg-red-500/10 border-red-500/20', text: 'text-red-400', icon: warningIcon, action: retryBtn('text-red-300') },
  }

  const cfg = configs[phase]
  if (!cfg) return null

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6">
      <div className={`mt-2 rounded-xl border px-3 py-2 text-sm flex items-center gap-2 ${cfg.bg} ${cfg.text}`}>
        {cfg.icon}
        <span>{statusText}</span>
        {cfg.action}
      </div>
    </div>
  )
}
