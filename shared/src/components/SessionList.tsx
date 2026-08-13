import { useState, forwardRef, useImperativeHandle, useEffect, useRef, useCallback } from 'react'
import { DndContext, DragOverlay, useDroppable, useDraggable, type DragEndEvent, type DragStartEvent, type DragOverEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ServerApi } from '../api/client'
import type { Pane } from '../api/types'
import type { AgentDataStore, SessionNode, WindowNode } from '../state/AgentDataStore'
import type { WebRTCTransport } from '../api/transport'
import { createFileApi } from '../api/fileClient'
import { translateError } from '../lib/errors'
import { haptic } from '../lib/platform'
import { useDragSensors } from '../hooks/useDragSensors'
import ConfirmDialog from './common/ConfirmDialog'
import DirectoryPicker from './files/DirectoryPicker'

interface Props {
  sessions: SessionNode[]
  status: { tmux_running: boolean; sessions: number } | null
  serverApi: ServerApi
  agentStore: AgentDataStore
  onSelectPane: (paneId: string) => void
  transport?: WebRTCTransport | null
  initialCwd?: string
}

export interface SessionListHandle {
  refresh: () => Promise<void>
  openNewSession: (cwd?: string) => void
}

// ========== Drag item data types ==========
interface WindowDragData { type: 'window'; windowId: string; sessionId: string; sessionName: string; windowName: string }
interface PaneDragData { type: 'pane'; paneId: string; windowId: string; sessionId: string; command: string }
type DragData = WindowDragData | PaneDragData

// 拖拽悬停上下文：判断是否跨容器
interface DragOverInfo {
  /** 当前悬停的目标容器 ID（sessionId for window drag, windowId for pane drag） */
  overContainerId: string | null
  /** 是否跨容器（跨 session / 跨 window） */
  isCrossContainer: boolean
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg className={`w-5 h-5 text-t-muted shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
    <path d="M6.293 4.293a1 1 0 011.414 0L14 10.586l-6.293 6.293a1 1 0 01-1.414-1.414L11.172 10.5 6.293 5.707a1 1 0 010-1.414z" />
  </svg>
)

// ========== Droppable Session Header ==========
function DroppableSessionHeader({ sessionId, children }: { sessionId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `sess:${sessionId}`, data: { type: 'session', sessionId } })
  return (
    <div ref={setNodeRef} className={`transition-all duration-150 rounded-2xl ${isOver ? 'ring-2 ring-emerald-500/60 scale-[1.01]' : ''}`}>
      {children}
    </div>
  )
}

// ========== Sortable Window Row ==========
function SortableWindowRow({ wd, sd, isDragging: globalDragging, activeDragData, onToggle, onLoadPanes, editingWindow, editName, setEditName, onRename, onKill, setEditingWindow, children }: {
  wd: WindowNode
  sd: SessionNode
  isDragging: boolean
  activeDragData: DragData | null
  onToggle: () => void
  onLoadPanes: () => void
  editingWindow: string | null
  editName: string
  setEditName: (v: string) => void
  onRename: (windowId: string, name: string, sessionName: string) => void
  onKill: (windowId: string, sessionName: string) => void
  setEditingWindow: (id: string | null) => void
  children?: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: itemDragging } = useSortable({
    id: `win:${wd.window.id}`,
    data: { type: 'window', windowId: wd.window.id, sessionId: sd.session.id, sessionName: sd.session.name, windowName: wd.window.name } satisfies WindowDragData,
  })
  // Also accept pane drops
  const { setNodeRef: dropRef, isOver: paneIsOver } = useDroppable({
    id: `windrop:${wd.window.id}`,
    data: { type: 'window-drop', windowId: wd.window.id, sessionId: sd.session.id },
  })

  // 判断 pane 拖到当前 window 是否跨 window
  const isPaneCrossWindow = paneIsOver && activeDragData?.type === 'pane' && activeDragData.windowId !== wd.window.id

  // 拖拽中完全隐藏原始元素（DragOverlay 负责显示预览）
  if (itemDragging) {
    return <div ref={(node) => { setNodeRef(node); dropRef(node) }} style={{ height: 0, overflow: 'hidden' }} />
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={(node) => { setNodeRef(node); dropRef(node) }} style={style}>
      <div className="ml-[4.25rem] h-px bg-t-border-subtle" />
      <div
        className={`flex items-center gap-3 pl-8 pr-4 py-3 transition-all duration-150 cursor-pointer
          ${!globalDragging ? 'active:bg-[var(--color-border-subtle)]' : ''}
          ${isPaneCrossWindow ? 'bg-emerald-500/10 ring-2 ring-emerald-500/50 ring-inset rounded-lg mx-1' : ''}
        `}
        onClick={() => { if (globalDragging) return; haptic(); if (!wd.expanded) onLoadPanes(); else onToggle() }}
        {...attributes} {...listeners}
      >
        <div className="w-8 h-8 shrink-0 rounded-lg bg-cyan-500/10 flex items-center justify-center">
          <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8.25V18a2.25 2.25 0 002.25 2.25h13.5A2.25 2.25 0 0021 18V8.25m-18 0V6a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 6v2.25m-18 0h18" /></svg>
        </div>
        <div className="flex-1 min-w-0">
          {editingWindow === wd.window.id ? (
            <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') onRename(wd.window.id, editName, sd.session.name); if (e.key === 'Escape') setEditingWindow(null) }}
              onClick={e => e.stopPropagation()} onBlur={() => setEditingWindow(null)}
              className="bg-[var(--color-border-subtle)] rounded-lg px-3 py-1 text-[16px] text-t-primary w-full focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
          ) : (<>
            <div className="text-t-primary text-[16px] truncate">{wd.window.name}</div>
            <div className="text-t-muted text-[13px]">{wd.window.panes} pane{wd.window.panes !== 1 ? 's' : ''}</div>
          </>)}
        </div>
        <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
          <button onClick={() => { haptic(); setEditingWindow(wd.window.id); setEditName(wd.window.name) }}
            className="w-8 h-8 flex items-center justify-center rounded-full text-t-muted active:bg-[var(--color-border-subtle)] transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" /></svg>
          </button>
          <button onClick={() => { haptic(); onKill(wd.window.id, sd.session.name) }}
            className="w-8 h-8 flex items-center justify-center rounded-full text-t-muted active:bg-red-500/15 active:text-red-400 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <Chevron open={wd.expanded} />
      </div>
      {children}
    </div>
  )
}

// ========== Draggable Pane Row ==========
function DraggablePaneRow({ pane, sd, wd, isDragging: globalDragging, onSelectPane, onSplitPane, onKillPane }: {
  pane: Pane
  sd: SessionNode
  wd: WindowNode
  isDragging: boolean
  onSelectPane: (paneId: string) => void
  onSplitPane: (paneId: string, horizontal: boolean, sessionId: string, windowId: string) => void
  onKillPane: (paneId: string, sessionId: string, windowId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging: itemDragging } = useDraggable({
    id: `pane:${pane.id}`,
    data: { type: 'pane', paneId: pane.id, windowId: wd.window.id, sessionId: sd.session.id, command: pane.command || pane.title || pane.id } satisfies PaneDragData,
  })

  // 拖拽中完全隐藏原始元素（DragOverlay 负责显示预览）
  if (itemDragging) {
    return <div ref={setNodeRef} style={{ height: 0, overflow: 'hidden' }} />
  }

  const style = {
    transform: CSS.Transform.toString(transform),
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div className="ml-[5.5rem] h-px bg-t-border-subtle" />
      <div
        className={`flex items-center gap-3 pl-14 pr-4 py-3 transition-colors cursor-pointer ${!globalDragging ? 'active:bg-blue-500/10' : ''}`}
        onClick={() => { if (globalDragging) return; haptic(); onSelectPane(pane.id) }}
        {...attributes} {...listeners}
      >
        <div className="w-7 h-7 shrink-0 rounded-lg bg-amber-500/10 flex items-center justify-center">
          <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" /></svg>
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-t-primary text-[15px]">{pane.command || pane.title || pane.id}</span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-t-muted text-[13px] font-mono">{pane.id.replace('%', '')}</span>
            <span className="text-t-muted text-[12px] tabular-nums">{pane.width}×{pane.height}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          <button onClick={() => { haptic(); onSplitPane(pane.id, false, sd.session.id, wd.window.id) }} className="px-2 py-1.5 rounded-lg text-[12px] text-t-muted active:bg-[var(--color-border-subtle)] active:text-t-primary transition-colors">V</button>
          <button onClick={() => { haptic(); onSplitPane(pane.id, true, sd.session.id, wd.window.id) }} className="px-2 py-1.5 rounded-lg text-[12px] text-t-muted active:bg-[var(--color-border-subtle)] active:text-t-primary transition-colors">H</button>
          <button onClick={() => { haptic(); onKillPane(pane.id, sd.session.id, wd.window.id) }} className="w-8 h-8 flex items-center justify-center rounded-full text-t-muted active:bg-red-500/15 active:text-red-400 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <svg className="w-4 h-4 text-t-muted shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M6.293 4.293a1 1 0 011.414 0L14 10.586l-6.293 6.293a1 1 0 01-1.414-1.414L11.172 10.5 6.293 5.707a1 1 0 010-1.414z" /></svg>
      </div>
    </div>
  )
}

// ========== Main Component ==========
export default forwardRef<SessionListHandle, Props>(function SessionList(
  { sessions, status, serverApi, agentStore, onSelectPane, transport, initialCwd },
  ref,
) {
  const [newSessionName, setNewSessionName] = useState('')
  const [newWindowName, setNewWindowName] = useState<Record<string, string>>({})
  const [editingSession, setEditingSession] = useState<string | null>(null)
  const [editingWindow, setEditingWindow] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [error, setError] = useState('')
  const [showNewSession, setShowNewSession] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [sessionCwd, setSessionCwd] = useState('')
  const [showDirPicker, setShowDirPicker] = useState(false)
  const [cwdError, setCwdError] = useState('')
  const [cwdValidating, setCwdValidating] = useState(false)
  const cwdValidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [activeDragData, setActiveDragData] = useState<DragData | null>(null)
  const [dragOverInfo, setDragOverInfo] = useState<DragOverInfo>({ overContainerId: null, isCrossContainer: false })

  const sensors = useDragSensors()

  // 从外部传入的 initialCwd 初始化
  useEffect(() => {
    if (initialCwd) {
      setSessionCwd(initialCwd)
      setCwdError('')
    }
  }, [initialCwd])

  // 验证 cwd 是否存在（debounce 500ms）
  const validateCwd = useCallback((path: string) => {
    if (cwdValidateTimer.current) clearTimeout(cwdValidateTimer.current)
    setCwdError('')
    if (!path.trim() || !transport) {
      setCwdValidating(false)
      return
    }
    setCwdValidating(true)
    cwdValidateTimer.current = setTimeout(async () => {
      try {
        const fileApi = createFileApi(transport)
        const stat = await fileApi.stat(path.trim())
        if (stat.type !== 'dir' && stat.type !== 'symlink-dir') {
          setCwdError('路径不是目录')
        } else {
          setCwdError('')
        }
      } catch {
        setCwdError('目录不存在')
      } finally {
        setCwdValidating(false)
      }
    }, 500)
  }, [transport])

  const handleCwdChange = (value: string) => {
    setSessionCwd(value)
    validateCwd(value)
  }

  const showError = (msg: string) => {
    setError(msg)
    setTimeout(() => setError(''), 4000)
  }

  useImperativeHandle(ref, () => ({
    refresh: () => agentStore.loadSessions(),
    openNewSession: (cwd?: string) => {
      if (cwd) setSessionCwd(cwd)
      setShowNewSession(true)
    },
  }), [agentStore])

  const toggleSession = (sessionId: string) => {
    if (isDragging) return
    agentStore.toggleSession(sessionId)
  }

  const toggleWindow = (sessionId: string, windowId: string) => {
    agentStore.toggleWindow(sessionId, windowId)
  }

  const loadWindowPanes = (sessionId: string, windowId: string) => {
    agentStore.loadWindowPanes(sessionId, windowId)
  }

  const createSession = async () => {
    const name = newSessionName.trim()
    if (!name || cwdError || cwdValidating) return
    try {
      const created = await serverApi.createSession(name, sessionCwd.trim() || undefined)
      setNewSessionName('')
      setSessionCwd('')
      setCwdError('')
      setShowNewSession(false)
      agentStore.updateSessions(prev => [...prev, { session: created, expanded: false }])
      agentStore.updateStatus(st => st ? { ...st, sessions: st.sessions + 1 } : st)
    } catch (e) { showError(translateError((e as Error).message)) }
  }

  const deleteSession = async (name: string) => {
    const prev = sessions
    agentStore.updateSessions(s => s.filter(sd => sd.session.name !== name))
    agentStore.updateStatus(st => st ? { ...st, sessions: Math.max(0, st.sessions - 1) } : st)
    try {
      await serverApi.deleteSession(name)
    } catch (e) {
      agentStore.updateSessions(() => prev)
      showError(translateError((e as Error).message))
    }
  }

  const renameSession = async (target: string, newName: string) => {
    setEditingSession(null)
    agentStore.updateSessions(prev => prev.map(sd =>
      sd.session.name === target ? { ...sd, session: { ...sd.session, name: newName } } : sd
    ))
    try {
      await serverApi.renameSession(target, newName)
    } catch (e) {
      agentStore.updateSessions(prev => prev.map(sd =>
        sd.session.name === newName ? { ...sd, session: { ...sd.session, name: target } } : sd
      ))
      showError(translateError((e as Error).message))
    }
  }

  const createWindow = async (sessionName: string) => {
    const name = (newWindowName[sessionName] || '').trim()
    if (!name) return
    try {
      const created = await serverApi.createWindow(sessionName, name)
      setNewWindowName(prev => ({ ...prev, [sessionName]: '' }))
      agentStore.updateSessions(prev => prev.map(sd => {
        if (sd.session.name !== sessionName) return sd
        return {
          ...sd,
          session: { ...sd.session, windows: sd.session.windows + 1 },
          windows: [...(sd.windows || []), { window: created, expanded: false }],
        }
      }))
    } catch (e) { showError(translateError((e as Error).message)) }
  }

  const requestKillWindow = (windowId: string, sessionName: string) => {
    setConfirmAction({
      title: 'Kill Window',
      message: `Kill window "${sessions.find(sd => sd.session.name === sessionName)?.windows?.find(wd => wd.window.id === windowId)?.window.name || windowId}"?`,
      onConfirm: () => { killWindow(windowId, sessionName); setConfirmAction(null) },
    })
  }

  const killWindow = async (windowId: string, sessionName: string) => {
    const prev = sessions
    agentStore.updateSessions(s => s.map(sd => {
      if (sd.session.name !== sessionName) return sd
      return {
        ...sd,
        session: { ...sd.session, windows: Math.max(0, sd.session.windows - 1) },
        windows: sd.windows?.filter(wd => wd.window.id !== windowId),
      }
    }))
    try {
      await serverApi.killWindow(windowId)
    } catch (e) {
      agentStore.updateSessions(() => prev)
      showError(translateError((e as Error).message))
    }
  }

  const renameWindow = async (windowId: string, newName: string, sessionName: string) => {
    const oldName = sessions.find(sd => sd.session.name === sessionName)
      ?.windows?.find(wd => wd.window.id === windowId)?.window.name || ''
    setEditingWindow(null)
    agentStore.updateSessions(prev => prev.map(sd => {
      if (sd.session.name !== sessionName) return sd
      return {
        ...sd,
        windows: sd.windows?.map(wd =>
          wd.window.id === windowId ? { ...wd, window: { ...wd.window, name: newName } } : wd
        ),
      }
    }))
    try {
      await serverApi.renameWindow(windowId, newName)
    } catch (e) {
      agentStore.updateSessions(prev => prev.map(sd => {
        if (sd.session.name !== sessionName) return sd
        return {
          ...sd,
          windows: sd.windows?.map(wd =>
            wd.window.id === windowId ? { ...wd, window: { ...wd.window, name: oldName } } : wd
          ),
        }
      }))
      showError(translateError((e as Error).message))
    }
  }

  const splitPane = async (paneId: string, horizontal: boolean, sessionId: string, windowId: string) => {
    try {
      const newPane = await serverApi.splitPane(paneId, horizontal)
      agentStore.updateSessions(prev => prev.map(sd => {
        if (sd.session.id !== sessionId) return sd
        return {
          ...sd,
          windows: sd.windows?.map(wd => {
            if (wd.window.id !== windowId) return wd
            return {
              ...wd,
              window: { ...wd.window, panes: wd.window.panes + 1 },
              panes: wd.panes ? [...wd.panes, newPane] : [newPane],
            }
          }),
        }
      }))
    } catch (e) { showError(translateError((e as Error).message)) }
  }

  const requestKillPane = (paneId: string, sessionId: string, windowId: string) => {
    setConfirmAction({
      title: 'Kill Pane',
      message: `Kill pane ${paneId}?`,
      onConfirm: () => { killPane(paneId, sessionId, windowId); setConfirmAction(null) },
    })
  }

  const killPane = async (paneId: string, sessionId: string, windowId: string) => {
    const prev = sessions
    agentStore.updateSessions(s => s.map(sd => {
      if (sd.session.id !== sessionId) return sd
      return {
        ...sd,
        windows: sd.windows?.map(wd => {
          if (wd.window.id !== windowId) return wd
          return {
            ...wd,
            window: { ...wd.window, panes: Math.max(0, wd.window.panes - 1) },
            panes: wd.panes?.filter(p => p.id !== paneId),
          }
        }),
      }
    }))
    try {
      await serverApi.killPane(paneId)
    } catch (e) {
      agentStore.updateSessions(() => prev)
      showError(translateError((e as Error).message))
    }
  }

  // ========== Drag handlers ==========

  const handleDragStart = (event: DragStartEvent) => {
    setIsDragging(true)
    setActiveDragData(event.active.data.current as DragData)
    setDragOverInfo({ overContainerId: null, isCrossContainer: false })
    haptic()
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over || !active.data.current) {
      setDragOverInfo({ overContainerId: null, isCrossContainer: false })
      return
    }

    const activeData = active.data.current as DragData
    const overData = over.data.current as Record<string, any> | undefined
    if (!overData) {
      setDragOverInfo({ overContainerId: null, isCrossContainer: false })
      return
    }

    if (activeData.type === 'window') {
      const overSessionId = overData.sessionId as string | undefined
      setDragOverInfo({
        overContainerId: overSessionId || null,
        isCrossContainer: !!overSessionId && overSessionId !== activeData.sessionId,
      })
    } else if (activeData.type === 'pane') {
      const overWindowId = (overData.windowId || null) as string | null
      setDragOverInfo({
        overContainerId: overWindowId,
        isCrossContainer: !!overWindowId && overWindowId !== activeData.windowId,
      })
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setIsDragging(false)
    setActiveDragData(null)
    setDragOverInfo({ overContainerId: null, isCrossContainer: false })

    const { active, over } = event
    if (!over || active.id === over.id) return

    const activeData = active.data.current as DragData
    const overData = over.data.current as Record<string, any> | undefined
    if (!activeData || !overData) return

    // 所有 tmux 操作完成后，后端会通过 events DataChannel 推送结构变化事件
    // AgentDataStore.handleServerEvent 会自动 loadSessions + refreshSessionWindows
    // 只有 swap-window 不会触发 tmux hook（它只交换 index），需要手动刷新

    try {
      if (activeData.type === 'window') {
        if (overData.type === 'session' && overData.sessionId !== activeData.sessionId) {
          // Window → 另一个 Session（触发 window-unlinked + window-linked hook，自动刷新）
          const targetSession = sessions.find(sd => sd.session.id === overData.sessionId)
          if (!targetSession) return
          await serverApi.moveWindow(activeData.windowId, targetSession.session.name)
          return
        }

        if (overData.type === 'window') {
          if (overData.sessionId === activeData.sessionId) {
            // 同 session 重排（swap-window 不触发 tmux hook，需手动刷新）
            await serverApi.swapWindow(activeData.windowId, overData.windowId as string)
            // swap 只交换 index，乐观更新本地顺序
            agentStore.updateSessions(s => s.map(sd => {
              if (sd.session.id !== activeData.sessionId || !sd.windows) return sd
              const srcIdx = sd.windows.findIndex(wd => wd.window.id === activeData.windowId)
              const dstIdx = sd.windows.findIndex(wd => wd.window.id === (overData.windowId as string))
              if (srcIdx < 0 || dstIdx < 0) return sd
              const newWindows = [...sd.windows]
              ;[newWindows[srcIdx], newWindows[dstIdx]] = [newWindows[dstIdx], newWindows[srcIdx]]
              return { ...sd, windows: newWindows }
            }))
          } else {
            // 跨 session 移动（触发 hook，自动刷新）
            const targetSession = sessions.find(sd => sd.session.id === overData.sessionId)
            if (!targetSession) return
            await serverApi.moveWindow(activeData.windowId, targetSession.session.name)
          }
          return
        }
      }

      if (activeData.type === 'pane') {
        // Pane → 另一个 Window（join-pane 触发 pane hook，自动刷新）
        const targetWindowId = overData.type === 'window-drop' ? overData.windowId
          : overData.type === 'window' ? overData.windowId
          : null
        if (targetWindowId && targetWindowId !== activeData.windowId) {
          await serverApi.movePane(activeData.paneId, targetWindowId as string)
          return
        }
      }
    } catch (e) {
      showError(translateError((e as Error).message))
    }
  }

  const handleDragCancel = () => {
    setIsDragging(false)
    setActiveDragData(null)
    setDragOverInfo({ overContainerId: null, isCrossContainer: false })
  }

  // DragOverlay 根据跨/不跨容器显示不同样式
  const overlayIsCross = dragOverInfo.isCrossContainer

  return (
    <div className="space-y-6">
      {status && (
        <span className={`inline-flex items-center gap-2 text-[13px] ${status.tmux_running ? 'text-t-secondary' : 'text-red-400'}`}>
          <span className={`w-2 h-2 rounded-full ${status.tmux_running ? 'bg-emerald-400' : 'bg-red-400'}`} />
          {status.tmux_running ? `${status.sessions} session${status.sessions !== 1 ? 's' : ''}` : 'tmux not running'}
        </span>
      )}

      {error && (
        <div className="bg-red-500/10 text-red-400 px-4 py-3 rounded-2xl text-[14px] flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-500 active:text-red-300 ml-3 p-1">✕</button>
        </div>
      )}

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
        <div className="space-y-4">
          {sessions.map((sd) => (
            <DroppableSessionHeader key={sd.session.id} sessionId={sd.session.id}>
              <div className="rounded-2xl bg-[var(--color-border-subtle)] overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3.5 active:bg-[var(--color-border-subtle)] transition-colors cursor-pointer" onClick={() => { haptic(); toggleSession(sd.session.id) }}>
                  <div className="w-10 h-10 shrink-0 rounded-xl bg-indigo-500/15 flex items-center justify-center">
                    <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L12 12.75 6.429 9.75m11.142 0l4.179 2.25-9.75 5.25-9.75-5.25 4.179-2.25" /></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    {editingSession === sd.session.id ? (
                      <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') renameSession(sd.session.name, editName); if (e.key === 'Escape') setEditingSession(null) }}
                        onClick={e => e.stopPropagation()} onBlur={() => setEditingSession(null)}
                        className="bg-[var(--color-border-subtle)] rounded-lg px-3 py-1.5 text-[17px] text-t-primary w-full focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
                    ) : (
                      <>
                        <div className="text-t-primary text-[17px] font-medium truncate">{sd.session.name}</div>
                        <div className="text-t-muted text-[13px] mt-0.5">{sd.session.windows} window{sd.session.windows !== 1 ? 's' : ''}</div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                    <button onClick={() => { haptic(); setEditingSession(sd.session.id); setEditName(sd.session.name) }}
                      className="w-9 h-9 flex items-center justify-center rounded-full text-t-muted active:bg-[var(--color-border-subtle)] transition-colors">
                      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" /></svg>
                    </button>
                    <button onClick={() => { haptic(); setConfirmAction({ title: 'Kill Session', message: `Kill session "${sd.session.name}"?`, onConfirm: () => { deleteSession(sd.session.name); setConfirmAction(null) } }) }}
                      className="w-9 h-9 flex items-center justify-center rounded-full text-t-muted active:bg-red-500/15 active:text-red-400 transition-colors">
                      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                    </button>
                  </div>
                  <Chevron open={sd.expanded} />
                </div>

                {sd.expanded && (<div>
                  <SortableContext items={(sd.windows || []).map(wd => `win:${wd.window.id}`)} strategy={verticalListSortingStrategy}>
                    {sd.windows?.map((wd) => (
                      <SortableWindowRow key={wd.window.id} wd={wd} sd={sd} isDragging={isDragging}
                        activeDragData={activeDragData}
                        onToggle={() => toggleWindow(sd.session.id, wd.window.id)}
                        onLoadPanes={() => loadWindowPanes(sd.session.id, wd.window.id)}
                        editingWindow={editingWindow} editName={editName} setEditName={setEditName}
                        onRename={renameWindow} onKill={requestKillWindow} setEditingWindow={setEditingWindow}
                      >
                        {wd.expanded && wd.panes && wd.panes.map(pane => (
                          <DraggablePaneRow key={pane.id} pane={pane} sd={sd} wd={wd} isDragging={isDragging}
                            onSelectPane={onSelectPane} onSplitPane={splitPane} onKillPane={requestKillPane}
                          />
                        ))}
                      </SortableWindowRow>
                    ))}
                  </SortableContext>

                  <div className="ml-[4.25rem] h-px bg-t-border-subtle" />
                  <div className="flex items-center gap-2 pl-8 pr-4 py-2.5">
                    <input type="text" value={newWindowName[sd.session.name] || ''}
                      onChange={e => setNewWindowName(prev => ({ ...prev, [sd.session.name]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && createWindow(sd.session.name)}
                      placeholder="New window..." className="flex-1 min-w-0 bg-transparent text-[15px] text-t-primary placeholder-t-muted focus:outline-none py-1.5" />
                    <button onClick={() => { haptic(); createWindow(sd.session.name) }} disabled={!(newWindowName[sd.session.name] || '').trim()}
                      className="shrink-0 px-4 py-2 text-[14px] text-blue-400 active:text-blue-300 disabled:text-t-muted font-medium rounded-lg active:bg-blue-500/10 transition-colors">Add</button>
                  </div>
                </div>)}
              </div>
            </DroppableSessionHeader>
          ))}

          {sessions.length === 0 && (
            <div className="text-center py-20">
              <div className="w-16 h-16 rounded-2xl bg-[var(--color-border-subtle)] flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-t-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" /></svg>
              </div>
              <p className="text-t-secondary text-[17px] font-medium">No Sessions</p>
              <p className="text-t-muted text-[14px] mt-1">Tap + to create one</p>
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDragData?.type === 'window' && (
            <div className={`rounded-2xl px-4 py-3.5 flex items-center gap-3 shadow-2xl transition-colors duration-150 ${
              overlayIsCross
                ? 'bg-emerald-950/90 border-2 border-emerald-500/60'
                : 'bg-[var(--color-bg-elevated)] border-2 border-blue-500/50'
            }`}>
              <div className="w-8 h-8 shrink-0 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8.25V18a2.25 2.25 0 002.25 2.25h13.5A2.25 2.25 0 0021 18V8.25m-18 0V6a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 6v2.25m-18 0h18" /></svg>
              </div>
              <span className="text-t-primary text-[16px] font-medium truncate flex-1">{activeDragData.windowName}</span>
              {overlayIsCross && (
                <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              )}
            </div>
          )}
          {activeDragData?.type === 'pane' && (
            <div className={`rounded-2xl px-4 py-3 flex items-center gap-3 shadow-2xl transition-colors duration-150 ${
              overlayIsCross
                ? 'bg-emerald-950/90 border-2 border-emerald-500/60'
                : 'bg-[var(--color-bg-elevated)] border-2 border-amber-500/50'
            }`}>
              <div className="w-7 h-7 shrink-0 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" /></svg>
              </div>
              <span className="text-t-primary text-[15px] font-medium truncate flex-1">{activeDragData.command}</span>
              {overlayIsCross && (
                <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              )}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {showNewSession && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => { setShowNewSession(false); setSessionCwd(''); setCwdError('') }}>
          <div className="absolute inset-0" style={{ backgroundColor: 'var(--color-bg-overlay)' }} />
          <div className="relative w-full max-w-lg bg-surface rounded-t-3xl px-5 pt-4 pb-8 animate-slide-up"
            onClick={e => e.stopPropagation()} style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}>
            <div className="w-10 h-1 rounded-full bg-t-border mx-auto mb-5" />
            <h3 className="text-t-primary text-[18px] font-semibold mb-4">New Session</h3>
            <input autoFocus type="text" value={newSessionName} onChange={e => setNewSessionName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createSession()} placeholder="Session name"
              className="w-full bg-[var(--color-border-subtle)] rounded-xl px-4 py-3.5 text-[17px] text-t-primary placeholder-t-muted focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
            {/* 工作目录：输入框 + 浏览按钮 */}
            <div className="mt-3">
              <div className={`flex items-center bg-[var(--color-border-subtle)] rounded-xl overflow-hidden ${cwdError ? 'ring-2 ring-red-500/40' : ''}`}>
                <input
                  type="text"
                  value={sessionCwd}
                  onChange={e => handleCwdChange(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createSession()}
                  placeholder="工作目录（留空使用 Home）"
                  className="flex-1 min-w-0 bg-transparent px-4 py-3 text-[15px] text-t-primary placeholder-t-muted focus:outline-none"
                />
                {transport && (
                  <button
                    onClick={() => { haptic(); setShowDirPicker(true) }}
                    className="shrink-0 px-3 py-3 text-t-muted active:text-blue-500 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                    </svg>
                  </button>
                )}
              </div>
              {cwdError && (
                <p className="text-red-400 text-[13px] mt-1.5 px-1">{cwdError}</p>
              )}
            </div>
            <button onClick={createSession} disabled={!newSessionName.trim() || !!cwdError || cwdValidating}
              className="w-full mt-4 py-3.5 bg-blue-600 active:bg-blue-700 disabled:bg-elevated disabled:text-t-muted rounded-xl text-[17px] text-white font-semibold transition-colors">Create</button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.title || ''}
        message={confirmAction?.message || ''}
        confirmText="Kill"
        cancelText="Cancel"
        danger
        onConfirm={() => confirmAction?.onConfirm()}
        onCancel={() => setConfirmAction(null)}
      />

      {!showNewSession && (
        <button onClick={() => { haptic(); setShowNewSession(true) }}
          className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 active:bg-blue-700 rounded-full flex items-center justify-center shadow-lg shadow-blue-600/25 transition-colors z-40"
          style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
        </button>
      )}

      {transport && (
        <DirectoryPicker
          transport={transport}
          isOpen={showDirPicker}
          onSelect={(path) => { setSessionCwd(path); setCwdError(''); setShowDirPicker(false) }}
          onCancel={() => setShowDirPicker(false)}
        />
      )}
    </div>
  )
})
