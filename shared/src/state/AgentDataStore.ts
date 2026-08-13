/**
 * Per-agent 数据存储
 * 管理 session/window/pane 数据的全生命周期，独立于组件挂载状态
 */

import type { ServerApi, Session, Window, Pane } from '../api/client'
import type { WebRTCTransport } from '../api/transport'
import { translateError } from '../lib/errors'
import { TerminalTopologyStore } from './TerminalTopologyStore'

const STRUCTURE_REFRESH_DELAY_MS = 300

export interface SessionNode {
  session: Session
  windows?: WindowNode[]
  expanded: boolean
}

export interface WindowNode {
  window: Window
  panes?: Pane[]
  expanded: boolean
}

export type ServerEvent = {
  type: string
  session_id?: string
  window_id?: string
  pane_id?: string
  provider_id?: string
  name?: string
}

function sameSession(a: Session, b: Session): boolean {
  return a.id === b.id && a.name === b.name && a.windows === b.windows && a.created === b.created
}

function sameWindow(a: Window, b: Window): boolean {
  return a.id === b.id && a.index === b.index && a.name === b.name && a.panes === b.panes
}

function samePane(a: Pane, b: Pane): boolean {
  return a.id === b.id && a.index === b.index && a.title === b.title && a.command === b.command &&
    a.width === b.width && a.height === b.height && a.window_id === b.window_id
}

function sameStatus(
  a: { tmux_running: boolean; sessions: number } | null,
  b: { tmux_running: boolean; sessions: number },
): boolean {
  return !!a && a.tmux_running === b.tmux_running && a.sessions === b.sessions
}

export class AgentDataStore {
  readonly topologyStore = new TerminalTopologyStore()
  // 数据
  private _status: { tmux_running: boolean; sessions: number } | null = null
  private _sessions: SessionNode[] = []
  private _loading = false
  private _lastUpdatedAt = 0

  // 关联的 API 和 transport
  private _serverApi: ServerApi | null = null
  private _transport: WebRTCTransport | null = null
  private eventUnsub: (() => void) | null = null

  // 高频 tmux hook 只在事件安静一小段时间后做一次结构对账。
  private structureRefreshTimer: ReturnType<typeof setTimeout> | null = null
  private pendingSessionIds = new Set<string>()
  private pendingPaneTargets = new Map<string, Set<string>>()
  private refreshAllExpanded = false

  // 同一连接内的 session 快照请求串行执行，避免旧响应覆盖新状态。
  private loadPromise: Promise<void> | null = null
  private loadAgain = false

  // 订阅者
  private dataListeners = new Set<() => void>()
  private eventListeners = new Set<(event: ServerEvent) => void>()

  // Getters
  get sessions(): SessionNode[] { return this._sessions }
  get status(): { tmux_running: boolean; sessions: number } | null { return this._status }
  get loading(): boolean { return this._loading }
  get lastUpdatedAt(): number { return this._lastUpdatedAt }
  get serverApi(): ServerApi | null { return this._serverApi }
  get isBound(): boolean { return this._serverApi !== null && this._transport !== null }

  /** 连接成功时绑定 API 和 transport */
  bind(serverApi: ServerApi, transport: WebRTCTransport): void {
    // 解绑旧的事件订阅
    this.eventUnsub?.()
    this.eventUnsub = null
    this.resetPendingRefresh()
    this.loadPromise = null
    this.loadAgain = false

    this._serverApi = serverApi
    this._transport = transport
    this.topologyStore.bind(serverApi)

    // 订阅事件
    this.eventUnsub = transport.subscribeEvent((event) => {
      this.handleServerEvent(event)
      // 转发给 event listeners
      this.eventListeners.forEach(cb => cb(event))
    })

    // 自动加载旧版 tmux 数据和通用 terminal topology。
    void this.refresh()
  }

  /** 断连时解绑（保留数据） */
  unbind(): void {
    this.eventUnsub?.()
    this.eventUnsub = null
    this.resetPendingRefresh()
    this.loadPromise = null
    this.loadAgain = false
    this._serverApi = null
    this._transport = null
    this.topologyStore.unbind()
    this.notifyDataListeners()
  }

  /** 完全销毁 */
  destroy(): void {
    this.unbind()
    this._sessions = []
    this._status = null
    this._loading = false
    this._lastUpdatedAt = 0
    this.topologyStore.destroy()
    this.dataListeners.clear()
    this.eventListeners.clear()
  }

  /** 订阅数据变更 */
  subscribeData(listener: () => void): () => void {
    this.dataListeners.add(listener)
    return () => { this.dataListeners.delete(listener) }
  }

  /** 订阅服务端事件 */
  subscribeEvents(listener: (event: ServerEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  // ========== 数据操作 ==========

  refresh(): Promise<void> {
    return Promise.all([this.loadSessions(), this.topologyStore.refresh()]).then(() => undefined)
  }

  /** 加载 sessions + status。已有数据时静默对账，不切换整个列表的 loading 状态。 */
  loadSessions(): Promise<void> {
    if (!this._serverApi) return Promise.resolve()

    if (this.loadPromise) {
      this.loadAgain = true
      return this.loadPromise
    }

    if (this._sessions.length === 0 && !this._status && !this._loading) {
      this._loading = true
      this.notifyDataListeners()
    }

    const run = async () => {
      do {
        this.loadAgain = false
        const api = this._serverApi
        if (!api) break
        await this.loadSessionSnapshot(api)
      } while (this.loadAgain && this._serverApi)
    }

    const promise = run().finally(() => {
      // bind/unbind 可能已经启动了新一轮请求，旧请求不能改动新连接的 loading 状态。
      if (this.loadPromise === promise) {
        this.loadPromise = null
        if (this._loading) {
          this._loading = false
          this.notifyDataListeners()
        }
      }
    })
    this.loadPromise = promise
    return promise
  }

  private async loadSessionSnapshot(api: ServerApi): Promise<void> {
    try {
      const [list, st] = await Promise.all([api.listSessions(), api.status()])
      if (this._serverApi !== api) return

      const prevSessions = this._sessions
      const prevMap = new Map(prevSessions.map(s => [s.session.id, s]))
      const nextSessions = (list || []).map<SessionNode>(session => {
        const existing = prevMap.get(session.id)
        if (!existing) return { session, expanded: false }
        return sameSession(existing.session, session)
          ? existing
          : { ...existing, session }
      })
      const sessionsChanged = nextSessions.length !== prevSessions.length ||
        nextSessions.some((item, index) => item !== prevSessions[index])
      const statusChanged = !sameStatus(this._status, st)

      if (sessionsChanged) this._sessions = nextSessions
      if (statusChanged) this._status = st
      this._lastUpdatedAt = Date.now()
      this._loading = false

      if (sessionsChanged || statusChanged) this.notifyDataListeners()
    } catch (e) {
      if (this._serverApi === api) {
        console.warn('[AgentDataStore] loadSessions error:', translateError((e as Error).message))
      }
    }
  }

  /** 加载指定 session 的 windows */
  async loadWindows(sessionName: string): Promise<Window[] | null> {
    const api = this._serverApi
    if (!api) return null
    try {
      const windows = await api.listWindows(sessionName)
      return this._serverApi === api ? windows : null
    } catch {
      return null
    }
  }

  /** 加载指定 session 的 panes */
  async loadPanes(sessionName: string): Promise<Pane[] | null> {
    const api = this._serverApi
    if (!api) return null
    try {
      const panes = await api.listPanes(sessionName)
      return this._serverApi === api ? panes : null
    } catch {
      return null
    }
  }

  /** 展开 session（加载 windows） */
  async toggleSession(sessionId: string): Promise<void> {
    const s = this._sessions.find(sd => sd.session.id === sessionId)
    if (!s) return

    if (!s.expanded && !s.windows) {
      const wins = await this.loadWindows(s.session.name)
      if (!wins) return
      this._sessions = this._sessions.map(item =>
        item.session.id === sessionId
          ? { ...item, expanded: true, windows: wins.map(w => ({ window: w, expanded: false })) }
          : item
      )
    } else {
      this._sessions = this._sessions.map(item =>
        item.session.id === sessionId ? { ...item, expanded: !item.expanded } : item
      )
    }
    this.notifyDataListeners()
  }

  /** 展开/折叠 window */
  toggleWindow(sessionId: string, windowId: string): void {
    this._sessions = this._sessions.map(item =>
      item.session.id === sessionId ? {
        ...item,
        windows: item.windows?.map(wd =>
          wd.window.id === windowId ? { ...wd, expanded: !wd.expanded } : wd
        ),
      } : item
    )
    this.notifyDataListeners()
  }

  /** 加载 window panes 并展开 */
  async loadWindowPanes(sessionId: string, windowId: string): Promise<void> {
    const s = this._sessions.find(sd => sd.session.id === sessionId)
    if (!s) return
    const panes = await this.loadPanes(s.session.name)
    if (!panes) return
    const windowPanes = panes.filter(p => p.window_id === windowId)
    this._sessions = this._sessions.map(item =>
      item.session.id === sessionId ? {
        ...item,
        windows: item.windows?.map(wd =>
          wd.window.id === windowId ? { ...wd, panes: windowPanes, expanded: true } : wd
        ),
      } : item
    )
    this.notifyDataListeners()
  }

  /** 刷新指定 session 的 windows 列表，并保留未变化节点和展开状态。 */
  private async refreshSessionWindows(sessionId: string, notify = true): Promise<boolean> {
    const sd = this._sessions.find(s => s.session.id === sessionId)
    if (!sd) return false
    const wins = await this.loadWindows(sd.session.name)
    if (!wins) return false
    let changed = false
    this._sessions = this._sessions.map(item => {
      if (item.session.id !== sessionId) return item
      const prevWindowMap = new Map(item.windows?.map(w => [w.window.id, w]) || [])
      const nextWindows = wins.map<WindowNode>(window => {
        const existing = prevWindowMap.get(window.id)
        if (!existing) return { window, expanded: false }
        return sameWindow(existing.window, window) ? existing : { ...existing, window }
      })
      changed = nextWindows.length !== (item.windows?.length || 0) ||
        nextWindows.some((window, index) => window !== item.windows?.[index])
      return changed ? { ...item, windows: nextWindows } : item
    })
    if (changed && notify) this.notifyDataListeners()
    return changed
  }

  private async refreshSessionTree(
    sessionId: string,
    paneTargets: Set<string> | undefined,
    refreshAllPanes: boolean,
  ): Promise<void> {
    const before = this._sessions.find(s => s.session.id === sessionId)
    if (!before?.expanded) return

    let changed = await this.refreshSessionWindows(sessionId, false)
    const current = this._sessions.find(s => s.session.id === sessionId)
    if (!current?.windows) {
      if (changed) this.notifyDataListeners()
      return
    }

    const expandedWindowIds = new Set(current.windows
      .filter(w => w.expanded && (refreshAllPanes || paneTargets?.has(w.window.id)))
      .map(w => w.window.id))
    if (expandedWindowIds.size > 0) {
      const panes = await this.loadPanes(current.session.name)
      if (panes) {
        this._sessions = this._sessions.map(item => {
          if (item.session.id !== sessionId || !item.windows) return item
          let windowsChanged = false
          const nextWindows = item.windows.map(wd => {
            if (!expandedWindowIds.has(wd.window.id)) return wd
            const previousPanes = wd.panes || []
            const previousPaneMap = new Map(previousPanes.map(pane => [pane.id, pane]))
            const nextPanes = panes
              .filter(pane => pane.window_id === wd.window.id)
              .map(pane => {
                const existing = previousPaneMap.get(pane.id)
                return existing && samePane(existing, pane) ? existing : pane
              })
            const panesChanged = nextPanes.length !== previousPanes.length ||
              nextPanes.some((pane, index) => pane !== previousPanes[index])
            if (!panesChanged) return wd
            windowsChanged = true
            return { ...wd, panes: nextPanes }
          })
          if (!windowsChanged) return item
          changed = true
          return { ...item, windows: nextWindows }
        })
      }
    }

    if (changed) this.notifyDataListeners()
  }

  /** 直接更新 sessions（供组件乐观更新使用） */
  updateSessions(updater: (sessions: SessionNode[]) => SessionNode[]): void {
    this._sessions = updater(this._sessions)
    this.notifyDataListeners()
  }

  /** 更新 status */
  updateStatus(updater: (status: { tmux_running: boolean; sessions: number } | null) => { tmux_running: boolean; sessions: number } | null): void {
    this._status = updater(this._status)
    this.notifyDataListeners()
  }

  // ========== 内部事件处理 ==========

  private handleServerEvent(event: ServerEvent): void {
    if (event.type === 'topology.changed' || event.type === 'terminal.closed' || event.type === 'provider.state_changed') {
      this.scheduleStructureRefresh(event)
      return
    }
    switch (event.type) {
      case 'session_created':
      case 'session_closed':
        this.scheduleStructureRefresh(event)
        break
      case 'window_created':
      case 'window_closed':
        this.scheduleStructureRefresh(event)
        break
      case 'pane_created':
      case 'pane_closed':
        this.scheduleStructureRefresh(event)
        break
      case 'session_renamed':
        if (event.session_id && event.name) {
          this._sessions = this._sessions.map(sd =>
            sd.session.id === event.session_id
              ? { ...sd, session: { ...sd.session, name: event.name! } }
              : sd
          )
          this.notifyDataListeners()
        }
        break
      case 'window_renamed':
        if (event.session_id && event.window_id && event.name) {
          this._sessions = this._sessions.map(sd =>
            sd.session.id === event.session_id && sd.windows
              ? {
                  ...sd,
                  windows: sd.windows.map(wd =>
                    wd.window.id === event.window_id
                      ? { ...wd, window: { ...wd.window, name: event.name! } }
                      : wd
                  ),
                }
              : sd
          )
          this.notifyDataListeners()
        }
        break
      case 'layout_changed':
        this.scheduleStructureRefresh(event)
        break
    }
  }

  private scheduleStructureRefresh(event: ServerEvent): void {
    if (event.session_id) this.pendingSessionIds.add(event.session_id)
    if (event.session_id && event.window_id && (event.type === 'pane_created' || event.type === 'pane_closed')) {
      let targets = this.pendingPaneTargets.get(event.session_id)
      if (!targets) {
        targets = new Set<string>()
        this.pendingPaneTargets.set(event.session_id, targets)
      }
      targets.add(event.window_id)
    }
    if (event.type === 'layout_changed') this.refreshAllExpanded = true

    if (this.structureRefreshTimer) clearTimeout(this.structureRefreshTimer)
    this.structureRefreshTimer = setTimeout(() => {
      this.structureRefreshTimer = null
      void this.flushStructureRefresh()
    }, STRUCTURE_REFRESH_DELAY_MS)
  }

  private async flushStructureRefresh(): Promise<void> {
    const sessionIds = new Set(this.pendingSessionIds)
    const paneTargets = new Map(this.pendingPaneTargets)
    const refreshAll = this.refreshAllExpanded
    this.pendingSessionIds.clear()
    this.pendingPaneTargets.clear()
    this.refreshAllExpanded = false

    await Promise.all([this.loadSessions(), this.topologyStore.refresh()])
    if (!this._serverApi) return

    const expandedIds = refreshAll
      ? this._sessions.filter(session => session.expanded).map(session => session.session.id)
      : [...sessionIds]
    await Promise.all(expandedIds.map(sessionId =>
      this.refreshSessionTree(sessionId, paneTargets.get(sessionId), refreshAll),
    ))
  }

  private resetPendingRefresh(): void {
    if (this.structureRefreshTimer) clearTimeout(this.structureRefreshTimer)
    this.structureRefreshTimer = null
    this.pendingSessionIds.clear()
    this.pendingPaneTargets.clear()
    this.refreshAllExpanded = false
  }

  private notifyDataListeners(): void {
    this.dataListeners.forEach(fn => fn())
  }
}
