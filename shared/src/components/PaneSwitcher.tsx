import { useState, useEffect, useCallback, useMemo } from 'react'
import { api as defaultApi, createP2PServerApi, Session, Window, Pane } from '../api/client'
import type { WebRTCTransport } from '../api/transport'
import { isFavorite, type FavoritePane } from '../lib/favoritePanes'
import { haptic } from '../lib/platform'

interface Props {
  open: boolean
  sessionName: string
  currentPaneId: string
  webrtcTransport?: WebRTCTransport
  onClose: () => void
  onSelectPane: (paneId: string) => void
  serverId?: string
  serverName?: string
  serverType?: 'local' | 'hub'
  favorites?: FavoritePane[]
  onToggleFavorite?: (info: {
    paneId: string
    sessionName: string
    windowName: string
    paneCommand: string
    serverId: string
    serverType: 'local' | 'hub'
    serverName: string
  }) => void
  onRemoveFavorite?: (fav: FavoritePane) => void
  onNavigateToFavorite?: (fav: FavoritePane) => void
}

interface WindowWithPanes {
  window: Window
  panes: Pane[]
}

export default function PaneSwitcher({ open, sessionName, currentPaneId, webrtcTransport, onClose, onSelectPane, serverId, serverName, serverType, favorites = [], onToggleFavorite, onRemoveFavorite, onNavigateToFavorite }: Props) {
  const [currentWindows, setCurrentWindows] = useState<WindowWithPanes[]>([])
  const [otherSessions, setOtherSessions] = useState<Session[]>([])
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())
  const [sessionWindows, setSessionWindows] = useState<Map<string, WindowWithPanes[]>>(new Map())
  const [loadingSessions, setLoadingSessions] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  const api = useMemo(() => {
    if (webrtcTransport) return createP2PServerApi(webrtcTransport)
    return defaultApi
  }, [webrtcTransport])

  const load = useCallback(async () => {
    if (!sessionName) return
    setLoading(true)
    try {
      const [wins, allPanes, sessions] = await Promise.all([
        api.listWindows(sessionName),
        api.listPanes(sessionName),
        api.listSessions(),
      ])
      // 当前 session 的 windows
      if (!wins || !allPanes) { setCurrentWindows([]); return }
      const panesByWindow = new Map<string, Pane[]>()
      for (const p of allPanes) {
        const wid = p.window_id || ''
        if (!panesByWindow.has(wid)) panesByWindow.set(wid, [])
        panesByWindow.get(wid)!.push(p)
      }
      setCurrentWindows(wins.map(w => ({
        window: w,
        panes: panesByWindow.get(w.id) || [],
      })))
      // 其他 sessions
      if (sessions) {
        setOtherSessions(sessions.filter(s => s.name !== sessionName))
      }
    } catch {
      setCurrentWindows([])
    } finally {
      setLoading(false)
    }
  }, [sessionName, api])

  useEffect(() => {
    if (open) {
      load()
      // 重置展开状态
      setExpandedSessions(new Set())
      setSessionWindows(new Map())
    }
  }, [open, load])

  const toggleSession = useCallback(async (session: Session) => {
    const sid = session.name
    setExpandedSessions(prev => {
      const next = new Set(prev)
      if (next.has(sid)) {
        next.delete(sid)
      } else {
        next.add(sid)
      }
      return next
    })
    // 如果已经加载过，不再重复请求
    if (sessionWindows.has(sid)) return
    setLoadingSessions(prev => new Set(prev).add(sid))
    try {
      const [wins, allPanes] = await Promise.all([
        api.listWindows(sid),
        api.listPanes(sid),
      ])
      if (wins && allPanes) {
        const panesByWindow = new Map<string, Pane[]>()
        for (const p of allPanes) {
          const wid = p.window_id || ''
          if (!panesByWindow.has(wid)) panesByWindow.set(wid, [])
          panesByWindow.get(wid)!.push(p)
        }
        setSessionWindows(prev => {
          const next = new Map(prev)
          next.set(sid, wins.map(w => ({
            window: w,
            panes: panesByWindow.get(w.id) || [],
          })))
          return next
        })
      }
    } catch { /* ignore */ } finally {
      setLoadingSessions(prev => {
        const next = new Set(prev)
        next.delete(sid)
        return next
      })
    }
  }, [api, sessionWindows])

  if (!open) return null

  const renderPaneList = (panes: Pane[], winSessionName: string, windowName: string) => panes.map(pane => {
    const isCurrent = pane.id === currentPaneId
    const starred = serverId ? isFavorite(favorites, serverId, pane.id) : false
    return (
      <div
        key={pane.id}
        onClick={() => { if (!isCurrent) { onSelectPane(pane.id); onClose() } }}
        className={`flex items-center gap-3 pl-10 pr-4 py-2.5 transition-colors ${
          isCurrent
            ? 'bg-blue-500/10'
            : 'active:bg-[var(--color-border-subtle)] cursor-pointer'
        }`}
      >
        <div className="w-5 h-5 rounded bg-amber-500/10 flex items-center justify-center shrink-0">
          <svg className="w-3 h-3 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <span className={`text-sm ${isCurrent ? 'text-blue-300' : 'text-t-primary'}`}>
            {pane.command || pane.title || pane.id}
          </span>
          <span className="text-t-muted text-xs ml-2 font-mono">{pane.id.replace('%', '#')}</span>
        </div>
        {isCurrent && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 shrink-0">当前</span>
        )}
        {serverId && serverType && onToggleFavorite && (
          <button
            onClick={e => {
              e.stopPropagation()
              haptic()
              onToggleFavorite({
                paneId: pane.id,
                sessionName: winSessionName,
                windowName,
                paneCommand: pane.command || pane.title || pane.id,
                serverId,
                serverType,
                serverName: serverName || serverId,
              })
            }}
            className={`w-6 h-6 flex items-center justify-center shrink-0 ${starred ? 'text-yellow-400' : 'text-t-muted/50'}`}
          >
            {starred ? (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
              </svg>
            )}
          </button>
        )}
      </div>
    )
  })

  const renderWindowList = (windows: WindowWithPanes[], winSessionName: string) => windows.map(({ window: w, panes }) => (
    <div key={w.id}>
      <div className="px-4 py-2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-cyan-500/10 flex items-center justify-center shrink-0">
          <svg className="w-3.5 h-3.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.25V18a2.25 2.25 0 002.25 2.25h13.5A2.25 2.25 0 0021 18V8.25m-18 0V6a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 6v2.25m-18 0h18" />
          </svg>
        </div>
        <span className="text-t-secondary text-sm font-medium">{w.name}</span>
      </div>
      {renderPaneList(panes, winSessionName, w.name)}
    </div>
  ))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0" style={{ backgroundColor: 'var(--color-bg-overlay)' }} />
      <div
        className="relative w-full max-w-lg bg-surface rounded-t-2xl overflow-hidden animate-slide-up"
        style={{ maxHeight: '60vh', paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface z-10 px-4 pt-3 pb-2 border-b border-t-border-subtle">
          <div className="w-10 h-1 rounded-full bg-t-border mx-auto mb-2" />
          <div className="flex items-center gap-2">
            <span className="text-indigo-400 text-sm font-medium">{sessionName}</span>
            {loading && <span className="text-t-muted text-xs">loading...</span>}
          </div>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: 'calc(60vh - 4rem)' }}>
          {/* 收藏的 pane */}
          {favorites.length > 0 && onNavigateToFavorite && (
            <>
              <div className="px-4 pt-3 pb-1">
                <span className="text-t-muted text-xs uppercase tracking-wider">收藏</span>
              </div>
              {favorites.map(fav => {
                const isCurrent = serverId === fav.serverId && currentPaneId === fav.paneId
                const isCrossAgent = serverId !== fav.serverId
                return (
                  <div
                    key={fav.id}
                    onClick={() => {
                      if (!isCurrent) {
                        if (isCrossAgent) {
                          onNavigateToFavorite(fav)
                        } else {
                          onSelectPane(fav.paneId)
                        }
                        onClose()
                      }
                    }}
                    className={`flex items-center gap-3 pl-4 pr-4 py-2.5 transition-colors ${
                      isCurrent
                        ? 'bg-blue-500/10'
                        : 'active:bg-[var(--color-border-subtle)] cursor-pointer'
                    }`}
                  >
                    <svg className="w-4 h-4 text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm ${isCurrent ? 'text-blue-300' : 'text-t-primary'}`}>
                        {fav.paneCommand}
                      </span>
                      {isCrossAgent && (
                        <span className="text-t-muted text-xs ml-2">{fav.serverName}</span>
                      )}
                    </div>
                    <span className="text-t-muted text-xs font-mono shrink-0">
                      {fav.sessionName}/{fav.windowName}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 shrink-0">当前</span>
                    )}
                    {onRemoveFavorite && (
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          haptic()
                          onRemoveFavorite(fav)
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-t-muted active:bg-[var(--color-border-subtle)] active:text-t-primary shrink-0"
                        aria-label="取消收藏"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                )
              })}
              <div className="border-b border-t-border-subtle mx-4 mt-1" />
            </>
          )}

          {/* 当前 session 的 windows */}
          {renderWindowList(currentWindows, sessionName)}

          {/* 其他 sessions */}
          {otherSessions.length > 0 && (
            <>
              <div className="px-4 pt-4 pb-1">
                <span className="text-t-muted text-xs uppercase tracking-wider">其他会话</span>
              </div>
              {otherSessions.map(session => {
                const expanded = expandedSessions.has(session.name)
                const wins = sessionWindows.get(session.name)
                const isLoading = loadingSessions.has(session.name)
                return (
                  <div key={session.id}>
                    <div
                      className="px-4 py-2.5 flex items-center gap-2 cursor-pointer active:bg-[var(--color-border-subtle)]"
                      onClick={() => toggleSession(session)}
                    >
                      <svg
                        className={`w-3.5 h-3.5 text-t-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                      <div className="w-6 h-6 rounded-md bg-indigo-500/10 flex items-center justify-center shrink-0">
                        <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L12 12.75 6.429 9.75m11.142 0l4.179 2.25L12 17.25 2.25 12l4.179-2.25" />
                        </svg>
                      </div>
                      <span className="text-indigo-300 text-sm font-medium flex-1">{session.name}</span>
                      <span className="text-t-muted text-xs">{session.windows} 窗口</span>
                      {isLoading && <span className="text-t-muted text-xs">...</span>}
                    </div>
                    {expanded && wins && renderWindowList(wins, session.name)}
                    {expanded && !wins && isLoading && (
                      <div className="pl-10 py-2 text-t-muted text-xs">加载中...</div>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {!loading && currentWindows.length === 0 && otherSessions.length === 0 && (
            <div className="text-center py-8 text-t-muted text-sm">无数据</div>
          )}
        </div>
      </div>
    </div>
  )
}
