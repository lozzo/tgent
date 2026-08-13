/**
 * SplitTerminalSlot — 分屏模式下的单个终端槽位
 * 封装 Terminal 组件 + 所有 overlay + 连接管理。
 */

import { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import Terminal, { TerminalHandle, type ConnStatus, type LoadingStage } from './Terminal'
import type { PaneInfo } from '../api/terminalClient'
import { useConnectionStore } from '../hooks/useConnectionStore'
import { useAppContext } from '../contexts/AppContext'
import { resolveServerType } from '../lib/resolveServerType'
import { haptic } from '../lib/platform'

function getIndicator(phase: string, needLogin: boolean): { color: string; pulse: boolean; label: string } {
  if (phase === 'connected') return { color: 'bg-green-500', pulse: false, label: '已连接' }
  if (phase === 'reconnecting' || phase === 'verifying') return { color: 'bg-yellow-500', pulse: true, label: '重连中' }
  if (phase === 'failed' || phase === 'waiting_network') return { color: 'bg-red-500', pulse: false, label: '已断开' }
  if (needLogin) return { color: 'bg-red-500', pulse: false, label: '需登录' }
  return { color: 'bg-yellow-500', pulse: true, label: '连接中' }
}

export interface SlotProps {
  serverId: string
  paneId: string
  isActive: boolean
  onTap: () => void
  onPaneInfo: (info: PaneInfo) => void
  termRef: React.RefObject<TerminalHandle | null>
  ctrlActive?: boolean
  altActive?: boolean
  preventFocus?: boolean
  onModifierUsed?: () => void
  onBufferChange?: (isAlternate: boolean) => void
  onCursorMove?: () => void
  /** 系统键盘输入回调（用于分屏同步输入） */
  onInput?: (data: string) => void
}

export interface SlotIndicator {
  color: string
  pulse: boolean
  label: string
}

export default function SplitTerminalSlot({
  serverId,
  paneId,
  isActive,
  onTap,
  onPaneInfo,
  termRef,
  ctrlActive,
  altActive,
  preventFocus,
  onModifierUsed,
  onBufferChange,
  onCursorMove,
  onInput,
}: SlotProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { storeManager } = useAppContext()
  const termWrapperRef = useRef<HTMLDivElement>(null)
  const paneInfoRef = useRef<PaneInfo | null>(null)

  const [hasEverConnected, setHasEverConnected] = useState(false)
  const hasEverConnectedRef = useRef(false)
  const [pageReady, setPageReady] = useState(false)
  const [termOverlay, setTermOverlay] = useState(false)
  const [bridgeOverlay, setBridgeOverlay] = useState(false)
  const [paneClosed, setPaneClosed] = useState(false)
  const [termStage, setTermStage] = useState<LoadingStage>('')
  const [serverType, setServerType] = useState<'local' | 'hub' | 'direct'>('direct')

  const conn = useConnectionStore(serverId)
  const { transport: webrtcTransport, statusText, phase, needLogin } = conn

  useEffect(() => {
    resolveServerType(serverId).then(setServerType)
  }, [serverId])

  // 首次 connected 后标记
  const prevPhaseRef = useRef(phase)
  const prevTransportRef = useRef(webrtcTransport)
  if (prevPhaseRef.current !== phase || prevTransportRef.current !== webrtcTransport) {
    const prevPhase = prevPhaseRef.current
    const prevTransport = prevTransportRef.current
    prevPhaseRef.current = phase
    prevTransportRef.current = webrtcTransport
    if (
      hasEverConnectedRef.current &&
      phase === 'connected' &&
      prevPhase !== 'connected' &&
      webrtcTransport && webrtcTransport !== prevTransport
    ) {
      if (!bridgeOverlay) setBridgeOverlay(true)
    }
  }
  const effectiveTermOverlay = termOverlay || bridgeOverlay

  useEffect(() => {
    if (phase === 'connected' && webrtcTransport && !hasEverConnectedRef.current) {
      hasEverConnectedRef.current = true
      setHasEverConnected(true)
    }
  }, [phase, webrtcTransport])

  const shouldMountTerminal = hasEverConnected

  // Reset state when paneId changes
  useEffect(() => {
    paneInfoRef.current = null
    setPageReady(false)
    setPaneClosed(false)
    setTermStage('')
  }, [paneId])

  // 监听 window/session 关闭事件
  useEffect(() => {
    if (!webrtcTransport) return
    const handler = (event: { type: string; session_id?: string; window_id?: string; pane_id?: string }) => {
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

  // 遮罩超时保护
  useEffect(() => {
    const timer = setTimeout(() => { if (!pageReady) setPageReady(true) }, 3000)
    return () => clearTimeout(timer)
  }, [pageReady])

  useEffect(() => {
    if (!effectiveTermOverlay) return
    const timer = setTimeout(() => { setTermOverlay(false); setBridgeOverlay(false) }, 15000)
    return () => clearTimeout(timer)
  }, [effectiveTermOverlay])

  const handleConnStatusChange = useCallback((status: ConnStatus) => {
    if (status === 'connecting') {
      flushSync(() => { setTermOverlay(true); setTermStage('') })
    }
  }, [])

  const handlePaneInfo = useCallback((info: PaneInfo) => {
    paneInfoRef.current = info
    onPaneInfo(info)
  }, [onPaneInfo])

  const handleReady = useCallback(() => {
    setPageReady(true); setTermOverlay(false); setBridgeOverlay(false)
  }, [])

  const handleStageChange = useCallback((stage: LoadingStage) => { setTermStage(stage) }, [])
  const handlePaneClosed = useCallback(() => { setPaneClosed(true) }, [])

  const handleRetry = useCallback(() => {
    storeManager.retryConnection(
      serverType === 'direct' ? 'local' : serverType,
      serverId,
    )
  }, [serverId, serverType, storeManager])

  const loadingText = useMemo(() => {
    if (!hasEverConnected) return statusText || '正在建立连接...'
    switch (termStage) {
      case 'dc-creating': return '正在打开数据通道...'
      case 'dc-opened': return '正在加载终端快照...'
      case 'snapshot-received': return '正在渲染终端...'
      default: return '正在初始化终端...'
    }
  }, [hasEverConnected, statusText, termStage])

  const showReconnectingOverlay = hasEverConnected && (
    phase === 'reconnecting' || phase === 'verifying' || phase === 'waiting_network' ||
    phase === 'idle' || phase === 'probing' || phase === 'connecting'
  )
  const showFailedOverlay = hasEverConnected && phase === 'failed' && !needLogin

  const indicator = getIndicator(phase, needLogin)

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      onPointerDown={isActive ? undefined : (e) => { e.stopPropagation(); onTap() }}
    >
      {/* 首次连接遮罩 */}
      <div
        className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center"
        style={{
          backgroundColor: 'var(--color-term-bg)',
          opacity: pageReady ? 0 : 1,
        }}
      >
        {!pageReady && (
          <div className="flex flex-col items-center gap-2">
            <svg className="w-4 h-4 text-t-muted animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-[10px] text-t-muted">{loadingText}</span>
          </div>
        )}
      </div>

      {/* Terminal */}
      {shouldMountTerminal && (
        <>
          <div ref={termWrapperRef} className="absolute inset-0">
            <Terminal
              ref={termRef as React.Ref<TerminalHandle>}
              paneId={paneId}
              webrtcTransport={webrtcTransport}
              ctrlActive={ctrlActive}
              altActive={altActive}
              preventFocus={preventFocus}
              onCursorMove={onCursorMove}
              onModifierUsed={onModifierUsed}
              onConnStatusChange={handleConnStatusChange}
              onPaneInfo={handlePaneInfo}
              onReady={handleReady}
              onPaneClosed={handlePaneClosed}
              onStageChange={handleStageChange}
              onBufferChange={onBufferChange}
              onInput={onInput}
            />
          </div>
          {/* 刷新遮罩 */}
          <div
            className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center"
            style={{
              backgroundColor: 'var(--color-term-bg)',
              opacity: effectiveTermOverlay ? 1 : 0,
            }}
          >
            {effectiveTermOverlay && (
              <div className="flex flex-col items-center gap-2">
                <svg className="w-4 h-4 text-t-muted animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-[10px] text-t-muted">{loadingText}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Reconnecting overlay */}
      {showReconnectingOverlay && (
        <div className="absolute inset-0 z-25 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="flex flex-col items-center gap-2">
            {phase === 'waiting_network' ? (
              <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-t-muted animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            <span className="text-[10px] text-t-secondary">{statusText}</span>
          </div>
        </div>
      )}

      {/* Failed overlay */}
      {showFailedOverlay && (
        <div className="absolute inset-0 z-30 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <div className="flex flex-col items-center gap-3">
            <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <span className="text-xs text-red-400">{statusText || '连接失败'}</span>
            <button
              onClick={() => { haptic(); handleRetry() }}
              className="px-4 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs active:bg-red-500/30"
            >
              重试
            </button>
          </div>
        </div>
      )}

      {/* Pane closed overlay */}
      {paneClosed && (
        <div className="absolute inset-0 z-30 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <div className="flex flex-col items-center gap-3">
            <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <span className="text-xs text-t-secondary">Pane 已关闭</span>
          </div>
        </div>
      )}

      {/* 首次连接中 */}
      {!hasEverConnected && (
        <div className="absolute inset-0 flex items-center justify-center">
          {!conn.isFailed && !needLogin && (
            <div className="flex flex-col items-center gap-2">
              <svg className="w-4 h-4 text-t-muted animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-[10px] text-t-muted">{statusText}</span>
            </div>
          )}
          {conn.isFailed && !needLogin && (
            <div className="flex flex-col items-center gap-2">
              <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              <span className="text-[10px] text-red-400">{statusText || '连接失败'}</span>
              <button
                onClick={() => { haptic(); handleRetry() }}
                className="mt-1 px-3 py-1 rounded-lg bg-red-500/20 text-red-400 text-xs active:bg-red-500/30"
              >
                重试
              </button>
            </div>
          )}
          {needLogin && (
            <div className="flex flex-col items-center gap-2">
              <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
              <span className="text-xs text-purple-400">需要登录</span>
              <button
                onClick={() => { haptic(); navigate('/login', { state: { returnTo: location.pathname } }) }}
                className="px-4 py-1.5 rounded-lg bg-purple-500/20 text-purple-400 text-xs active:bg-purple-500/30"
              >
                登录
              </button>
            </div>
          )}
        </div>
      )}

      {/* 非活跃暗化层 */}
      {!isActive && (
        <div className="absolute inset-0 z-40 pointer-events-none" style={{ backgroundColor: 'rgba(0,0,0,0.25)' }} />
      )}

      {/* 状态指示灯（角落） */}
      <div className="absolute top-1 right-1 z-50">
        <span
          className={`block w-2 h-2 rounded-full ${indicator.color}${indicator.pulse ? ' animate-pulse' : ''}`}
          title={indicator.label}
        />
      </div>
    </div>
  )
}
