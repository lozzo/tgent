/**
 * SplitPaneSelector — 选择服务器和 Pane 的 UI
 * 用于分屏模式下选择第二个终端的目标。
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useServerList, type ServerCard, getConnType, CONN_STYLE } from '../hooks/useServerList'
import { createP2PServerApi, type Session, type Window, type Pane, type ServerApi } from '../api/client'
import type { WebRTCTransport } from '../api/transport'
import { useAppContext } from '../contexts/AppContext'
import { resolveServerType } from '../lib/resolveServerType'
import { haptic, isWailsApp } from '../lib/platform'

function SelectorShell({ children }: { children: ReactNode }) {
  const desktop = isWailsApp()
  return (
    <div
      className={`absolute inset-0 z-50 flex ${desktop ? 'items-center justify-center p-6 split-pane-selector-layer' : ''}`}
      style={{ backgroundColor: desktop ? 'rgba(0, 0, 0, 0.58)' : 'var(--color-term-bg)' }}
    >
      <div className={desktop ? 'split-pane-selector-dialog' : 'flex h-full w-full flex-col'}>
        {children}
      </div>
    </div>
  )
}

interface WindowWithPanes {
  window: Window
  panes: Pane[]
}

interface SplitPaneSelectorProps {
  /** 已有 transport 用于获取 session 列表（如果选择同一服务器） */
  existingTransport?: WebRTCTransport
  existingServerId?: string
  onSelect: (serverId: string, paneId: string) => void
  onCancel: () => void
}

export default function SplitPaneSelector({
  existingTransport,
  existingServerId,
  onSelect,
  onCancel,
}: SplitPaneSelectorProps) {
  const { servers, loading } = useServerList()
  const { storeManager } = useAppContext()
  const [selectedServer, setSelectedServer] = useState<ServerCard | null>(null)
  const [sessions, setSessions] = useState<{ session: Session; windows: WindowWithPanes[] }[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [connecting, setConnecting] = useState(false)

  // 获取目标 server 的 API（优先用已有 transport，否则通过 storeManager 获取）
  const [resolvedApi, setResolvedApi] = useState<ServerApi | null>(null)

  useEffect(() => {
    if (!selectedServer) {
      setResolvedApi(null)
      setConnecting(false)
      return
    }

    // 同一个 server，直接用 existingTransport
    if (existingTransport && selectedServer.id === existingServerId) {
      setResolvedApi(createP2PServerApi(existingTransport))
      return
    }

    // 不同 server，通过 storeManager 获取连接
    let cancelled = false
    setConnecting(true)

    ;(async () => {
      const sType = await resolveServerType(selectedServer.id)
      if (cancelled) return
      const serverType = sType === 'direct' ? 'local' : sType

      // ensureStore 会触发连接（如果还没连的话）
      storeManager.ensureStore(serverType, selectedServer.id)

      // 订阅状态变化，等待连接就绪
      const unsub = storeManager.subscribe(serverType, selectedServer.id, () => {
        if (cancelled) return
        const snap = storeManager.getSnapshot(serverType, selectedServer.id)
        if (snap.isConnected && snap.transport) {
          setResolvedApi(snap.serverApi)
          setConnecting(false)
        }
      })

      // 检查是否已经连接
      const snap = storeManager.getSnapshot(serverType, selectedServer.id)
      if (snap.isConnected && snap.transport) {
        setResolvedApi(snap.serverApi)
        setConnecting(false)
      }

      // 清理函数保存到外层
      return () => { unsub() }
    })().then(cleanup => {
      if (cancelled && cleanup) cleanup()
    })

    return () => { cancelled = true }
  }, [selectedServer, existingTransport, existingServerId, storeManager])

  // resolvedApi 就绪后加载 sessions
  useEffect(() => {
    if (!selectedServer || !resolvedApi) return
    setLoadingSessions(true)
    let cancelled = false
    ;(async () => {
      try {
        const allSessions = await resolvedApi.listSessions()
        if (cancelled) return
        if (!allSessions) { setSessions([]); return }
        const result: { session: Session; windows: WindowWithPanes[] }[] = []
        for (const session of allSessions) {
          const [wins, allPanes] = await Promise.all([
            resolvedApi.listWindows(session.name),
            resolvedApi.listPanes(session.name),
          ])
          if (cancelled) return
          if (!wins || !allPanes) continue
          const panesByWindow = new Map<string, Pane[]>()
          for (const p of allPanes) {
            const wid = p.window_id || ''
            if (!panesByWindow.has(wid)) panesByWindow.set(wid, [])
            panesByWindow.get(wid)!.push(p)
          }
          result.push({
            session,
            windows: wins.map(w => ({ window: w, panes: panesByWindow.get(w.id) || [] })),
          })
        }
        if (!cancelled) setSessions(result)
      } catch {
        if (!cancelled) setSessions([])
      } finally {
        if (!cancelled) setLoadingSessions(false)
      }
    })()
    return () => { cancelled = true }
  }, [selectedServer, resolvedApi])

  const handleServerSelect = useCallback((card: ServerCard) => {
    haptic()
    if (card.online === 'offline') return
    setSelectedServer(card)
    setSessions([])
  }, [])

  const handlePaneSelect = useCallback((paneId: string) => {
    haptic()
    if (selectedServer) {
      onSelect(selectedServer.id, paneId)
    }
  }, [selectedServer, onSelect])

  // 服务器列表视图
  if (!selectedServer) {
    return (
      <SelectorShell>
        <div className="flex items-center justify-between px-3 py-2 border-b border-t-border">
          <span className="text-sm text-t-primary font-medium">选择终端</span>
          <button
            onClick={() => { haptic(); onCancel() }}
            className="w-7 h-7 flex items-center justify-center rounded-md text-t-secondary active:bg-[var(--color-border-subtle)]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto p-3 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <svg className="w-5 h-5 text-t-muted animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : servers.length === 0 ? (
            <div className="text-center py-8 text-t-muted text-sm">无可用服务器</div>
          ) : (
            servers.map(card => {
              const connType = getConnType(card)
              const style = CONN_STYLE[connType]
              const isOffline = card.online === 'offline'
              return (
                <button
                  key={card.id}
                  onClick={() => handleServerSelect(card)}
                  disabled={isOffline}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
                    isOffline ? 'opacity-40' : 'active:bg-[var(--color-border-subtle)]'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${style.bg}`}>
                    <svg className={`w-4 h-4 ${style.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-sm text-t-primary truncate">{card.name}</div>
                    <div className="text-[10px] text-t-muted">{style.label}</div>
                  </div>
                  <span className={`w-2 h-2 rounded-full ${
                    card.online === 'online' ? 'bg-green-500' :
                    card.online === 'checking' ? 'bg-yellow-500 animate-pulse' :
                    'bg-red-500'
                  }`} />
                </button>
              )
            })
          )}
        </div>
      </SelectorShell>
    )
  }

  // Session/Pane 列表视图
  return (
    <SelectorShell>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-t-border">
        <button
          onClick={() => { haptic(); setSelectedServer(null) }}
          className="w-7 h-7 flex items-center justify-center rounded-md text-t-secondary active:bg-[var(--color-border-subtle)]"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <span className="text-sm text-t-primary font-medium truncate">{selectedServer.name}</span>
        <div className="flex-1" />
        <button
          onClick={() => { haptic(); onCancel() }}
          className="w-7 h-7 flex items-center justify-center rounded-md text-t-secondary active:bg-[var(--color-border-subtle)]"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {(connecting || loadingSessions) ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <svg className="w-5 h-5 text-t-muted animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-xs text-t-muted">{connecting ? '正在连接...' : '加载中...'}</span>
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-8 text-t-muted text-sm">无可用 session</div>
        ) : (
          <div className="space-y-3">
            {sessions.map(({ session, windows }) => (
              <div key={session.id}>
                <div className="text-[10px] text-t-muted uppercase tracking-wider mb-1 px-1">
                  {session.name}
                </div>
                {windows.map(({ window: w, panes }) => (
                  <div key={w.id} className="mb-2">
                    <div className="text-xs text-t-secondary px-1 mb-1">{w.name}</div>
                    {panes.map(pane => (
                      <button
                        key={pane.id}
                        onClick={() => handlePaneSelect(pane.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left active:bg-[var(--color-border-subtle)]"
                      >
                        <span className="text-xs text-teal-400 font-mono">{pane.id.replace('%', '#')}</span>
                        <span className="text-xs text-t-primary truncate">{pane.command || pane.title || pane.id}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </SelectorShell>
  )
}
