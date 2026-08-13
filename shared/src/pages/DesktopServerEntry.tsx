import { useEffect, useState } from 'react'
import { ArrowLeft, LoaderCircle, RotateCw } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Pane, ServerApi, Session } from '../api/client'
import { useAppContext } from '../contexts/AppContext'
import { useConnectionStore } from '../hooks/useConnectionStore'
import { getDesktopTerminalHistory } from '../lib/desktopTerminalHistory'
import { translateError } from '../lib/errors'
import { resolveServerType } from '../lib/resolveServerType'

const pendingPaneResolutions = new Map<string, Promise<Pane>>()

function paneRoute(serverId: string, paneId: string): string {
  const routeId = paneId.startsWith('%') ? paneId.slice(1) : paneId
  return `/s/${serverId}/t/${encodeURIComponent(routeId)}`
}

function sessionCreatedAt(session: Session): number {
  if (!session.created) return 0
  const numeric = Number(session.created)
  if (Number.isFinite(numeric)) return numeric
  const parsed = Date.parse(session.created)
  return Number.isFinite(parsed) ? parsed : 0
}

function newestSessions(sessions: Session[]): Session[] {
  return sessions
    .map((session, index) => ({ session, index }))
    .sort((left, right) => sessionCreatedAt(right.session) - sessionCreatedAt(left.session) || right.index - left.index)
    .map(item => item.session)
}

function findPane(panes: Pane[], paneId: string): Pane | undefined {
  const normalized = paneId.startsWith('%') ? paneId : `%${paneId}`
  return panes.find(pane => pane.id === paneId || pane.id === normalized)
}

async function waitForFirstPane(api: ServerApi, sessionName: string): Promise<Pane | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const panes = await api.listPanes(sessionName)
    if (panes.length > 0) {
      return [...panes].sort((left, right) => left.index - right.index)[0]
    }
    await new Promise(resolve => window.setTimeout(resolve, 80 * (attempt + 1)))
  }
  return null
}

async function resolveDesktopPane(api: ServerApi, serverId: string): Promise<Pane> {
  const history = await getDesktopTerminalHistory(serverId)
  if (history?.sessionName) {
    try {
      const panes = await api.listPanes(history.sessionName)
      const recentPane = findPane(panes, history.paneId)
      if (recentPane) return recentPane
    } catch {}
  }

  const sessions = newestSessions(await api.listSessions())
  if (sessions.length === 0) {
    const created = await api.createSession('main')
    const pane = await waitForFirstPane(api, created.name)
    if (pane) return pane
    throw new Error('new_session_has_no_pane')
  }

  for (const session of sessions) {
    const panes = await api.listPanes(session.name)
    if (history) {
      const recentPane = findPane(panes, history.paneId)
      if (recentPane) return recentPane
    }
    if (panes.length > 0) {
      return [...panes].sort((left, right) => left.index - right.index)[0]
    }
  }

  const session = sessions[0]
  await api.createWindow(session.name, 'shell')
  const pane = await waitForFirstPane(api, session.name)
  if (pane) return pane
  throw new Error('no_terminal_available')
}

function resolveDesktopPaneOnce(api: ServerApi, serverId: string): Promise<Pane> {
  const pending = pendingPaneResolutions.get(serverId)
  if (pending) return pending

  const task = resolveDesktopPane(api, serverId)
  pendingPaneResolutions.set(serverId, task)
  const clear = () => {
    if (pendingPaneResolutions.get(serverId) === task) {
      pendingPaneResolutions.delete(serverId)
    }
  }
  task.then(clear, clear)
  return task
}

export default function DesktopServerEntry() {
  const { serverId = '' } = useParams<{ serverId: string }>()
  const navigate = useNavigate()
  const { storeManager } = useAppContext()
  const conn = useConnectionStore(serverId)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!serverId || !conn.isConnected || !conn.serverApi) return
    let cancelled = false
    setError('')
    resolveDesktopPaneOnce(conn.serverApi, serverId)
      .then(pane => {
        if (!cancelled) navigate(paneRoute(serverId, pane.id), { replace: true })
      })
      .catch(reason => {
        if (!cancelled) setError(translateError(reason instanceof Error ? reason.message : String(reason)))
      })
    return () => { cancelled = true }
  }, [attempt, conn.isConnected, conn.serverApi, navigate, serverId])

  const retry = async () => {
    setError('')
    if (!conn.isConnected) {
      const type = await resolveServerType(serverId)
      storeManager.retryConnection(type === 'direct' ? 'local' : type, serverId)
    }
    setAttempt(value => value + 1)
  }

  const connectionError = error || (
    conn.needLogin
      ? '这个远程连接需要先登录或重新授权。'
      : conn.needSubscription
        ? '这个远程连接需要有效订阅。'
        : conn.phase === 'failed' || conn.phase === 'waiting_network'
          ? conn.statusText || '连接失败'
          : ''
  )

  return (
    <main className="relative flex min-h-screen flex-col bg-base text-t-primary">
      <header className="tgent-desktop-terminal-header flex h-12 shrink-0 items-center border-b border-t-border-subtle px-3">
        <button
          type="button"
          onClick={() => navigate('/', { replace: true, state: { desktopHome: true } })}
          className="flex h-8 w-8 items-center justify-center rounded-md text-t-muted transition-colors hover:bg-white/5 hover:text-t-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="返回设备"
          title="返回设备"
        >
          <ArrowLeft size={17} />
        </button>
      </header>

      <div className="flex flex-1 items-center justify-center px-6">
        <div className="flex max-w-sm flex-col items-center text-center">
          {connectionError ? (
            <>
              <p className="text-sm font-medium text-t-primary">无法打开终端</p>
              <p className="mt-1 text-xs leading-relaxed text-t-muted">{connectionError}</p>
              <button
                type="button"
                onClick={() => { void retry() }}
                className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-t-border px-3 text-sm text-t-secondary transition-colors hover:bg-white/5 hover:text-t-primary"
              >
                <RotateCw size={15} />
                重试
              </button>
            </>
          ) : (
            <>
              <LoaderCircle className="h-5 w-5 animate-spin text-t-secondary" aria-hidden="true" />
              <p className="mt-3 text-sm text-t-secondary">
                {conn.isConnected ? '正在恢复终端...' : conn.statusText || '正在连接本机 TGent...'}
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
