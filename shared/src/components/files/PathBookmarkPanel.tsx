import { useState, useEffect, useCallback, useRef } from 'react'
import { loadPathBookmarks, savePathBookmark, deletePathBookmark, createBookmarkId, type PathBookmark } from '../../lib/pathBookmarks'
import { haptic } from '../../lib/platform'

interface Props {
  open: boolean
  onClose: () => void
  onNavigate: (path: string) => void
  currentPath: string
  serverId: string
}

export default function PathBookmarkPanel({ open, onClose, onNavigate, currentPath, serverId }: Props) {
  const [bookmarks, setBookmarks] = useState<PathBookmark[]>([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPath, setNewPath] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const readyRef = useRef(false)

  // 拖拽底部面板
  const outerRef = useRef<HTMLDivElement>(null)
  const [panelH, setPanelH] = useState(0)
  const [transition, setTransition] = useState(false)
  const dragRef = useRef({ active: false, startY: 0, startH: 0, lastY: 0, lastT: 0, v: 0 })

  const refresh = useCallback(async () => {
    const list = await loadPathBookmarks(serverId)
    setBookmarks(list)
  }, [serverId])

  useEffect(() => {
    if (open) {
      readyRef.current = false
      const timer = setTimeout(() => { readyRef.current = true }, 300)
      refresh()
      setDeleteConfirm(null)
      setCreating(false)
      setNewName('')
      setNewPath('')
      // 入场动画
      setPanelH(0)
      setTransition(true)
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (outerRef.current) {
            setPanelH(outerRef.current.clientHeight * 0.5)
          }
        })
      })
      return () => { clearTimeout(timer); cancelAnimationFrame(raf) }
    }
  }, [open, refresh])

  const onDragStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0]
    dragRef.current = { active: true, startY: t.clientY, startH: panelH, lastY: t.clientY, lastT: Date.now(), v: 0 }
    setTransition(false)
  }, [panelH])

  const onDragMove = useCallback((e: React.TouchEvent) => {
    if (!dragRef.current.active) return
    const t = e.touches[0]
    const outer = outerRef.current
    if (!outer) return
    const dy = dragRef.current.startY - t.clientY
    const maxH = outer.clientHeight * 0.92
    const newH = Math.max(60, Math.min(maxH, dragRef.current.startH + dy))
    const now = Date.now()
    const dt = now - dragRef.current.lastT
    if (dt > 0) {
      const iv = (dragRef.current.lastY - t.clientY) / dt * 1000
      dragRef.current.v = dragRef.current.v * 0.3 + iv * 0.7
    }
    dragRef.current.lastY = t.clientY
    dragRef.current.lastT = now
    setPanelH(newH)
  }, [])

  const onDragEnd = useCallback(() => {
    if (!dragRef.current.active) return
    dragRef.current.active = false
    if (Math.abs(panelH - dragRef.current.startH) < 5) return
    const outer = outerRef.current
    if (!outer) return
    const ch = outer.clientHeight
    const v = dragRef.current.v
    setTransition(true)
    if (v < -400) { onClose(); return }
    if (v > 400) { setPanelH(ch * 0.85); return }
    const r = panelH / ch
    if (r < 0.2) onClose()
    else if (r < 0.6) setPanelH(ch * 0.5)
    else setPanelH(ch * 0.85)
  }, [panelH, onClose])

  const handleSave = useCallback(async () => {
    const path = newPath.trim() || currentPath
    if (!path) return
    const name = newName.trim() || extractDirName(path)
    const bookmark: PathBookmark = {
      id: createBookmarkId(),
      path,
      name,
      createdAt: Date.now(),
    }
    await savePathBookmark(serverId, bookmark)
    await refresh()
    setCreating(false)
    setNewName('')
    setNewPath('')
  }, [newName, newPath, currentPath, serverId, refresh])

  const handleBookmarkCurrent = useCallback(async () => {
    const name = extractDirName(currentPath)
    const bookmark: PathBookmark = {
      id: createBookmarkId(),
      path: currentPath,
      name,
      createdAt: Date.now(),
    }
    await savePathBookmark(serverId, bookmark)
    await refresh()
  }, [currentPath, serverId, refresh])

  const handleDelete = useCallback(async (id: string) => {
    await deletePathBookmark(serverId, id)
    await refresh()
    setDeleteConfirm(null)
  }, [serverId, refresh])

  const handleNavigate = useCallback((path: string) => {
    onNavigate(path)
    onClose()
  }, [onNavigate, onClose])

  const isCurrentBookmarked = bookmarks.some(b => b.path === currentPath)

  if (!open) return null

  return (
    <div
      ref={outerRef}
      className="absolute inset-0 z-50 flex items-end justify-center"
      onClick={() => { if (readyRef.current) onClose() }}
    >
      <div className="absolute inset-0" style={{ backgroundColor: 'var(--color-bg-overlay)' }} />
      <div
        className="relative w-full max-w-lg bg-surface rounded-t-2xl overflow-hidden flex flex-col"
        style={{
          height: `${panelH}px`,
          transition: transition ? 'height 0.25s ease-out' : 'none',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* 拖拽手柄 + Header */}
        <div
          className="shrink-0 bg-surface z-10 px-4 pt-3 pb-2 border-b border-t-border-subtle"
          onTouchStart={onDragStart}
          onTouchMove={onDragMove}
          onTouchEnd={onDragEnd}
          style={{ touchAction: 'none' }}
        >
          <div className="w-10 h-1 rounded-full bg-t-border mx-auto mb-2" />
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-t-primary">路径收藏</span>
            <div className="flex items-center gap-2">
              {!isCurrentBookmarked && (
                <button
                  onClick={() => { haptic(); handleBookmarkCurrent() }}
                  className="text-xs text-yellow-500 active:text-yellow-400 flex items-center gap-0.5"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                  收藏当前
                </button>
              )}
              <button
                onClick={() => { haptic(); setCreating(true); setNewName(''); setNewPath(currentPath) }}
                className="text-xs text-blue-400 active:text-blue-300"
              >
                + 新建
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0">
          {/* 新建表单 */}
          {creating && (
            <div className="px-4 py-3 border-b border-t-border-subtle space-y-2">
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="名称（可选，默认用目录名）"
                className="w-full px-2.5 py-1.5 rounded-md bg-[var(--color-border-subtle)] text-t-primary text-xs placeholder:text-t-muted focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                autoFocus
              />
              <input
                type="text"
                value={newPath}
                onChange={e => setNewPath(e.target.value)}
                placeholder="路径，如 /home/user/project"
                className="w-full px-2.5 py-1.5 rounded-md bg-[var(--color-border-subtle)] text-t-primary text-xs placeholder:text-t-muted focus:outline-none focus:ring-1 focus:ring-blue-500/50 font-mono"
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => { haptic(); setCreating(false); setNewName(''); setNewPath('') }}
                  className="px-3 py-1.5 rounded-md text-xs text-t-secondary active:bg-[var(--color-border-subtle)]"
                >
                  取消
                </button>
                <button
                  onClick={() => { haptic(); handleSave() }}
                  disabled={!newPath.trim() && !currentPath}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                    (newPath.trim() || currentPath)
                      ? 'bg-blue-500/20 text-blue-400 active:bg-blue-500/30'
                      : 'bg-[var(--color-border-subtle)] text-t-muted'
                  }`}
                >
                  保存
                </button>
              </div>
            </div>
          )}

          {/* 收藏列表 */}
          {bookmarks.map(b => {
            const isActive = b.path === currentPath
            return (
              <div
                key={b.id}
                className={`px-4 py-2.5 border-b border-t-border-subtle active:bg-[var(--color-border-subtle)] transition-colors ${
                  isActive ? 'bg-blue-500/5' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => { haptic(); handleNavigate(b.path) }}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      {isActive && (
                        <svg className="w-3 h-3 text-yellow-500 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" />
                        </svg>
                      )}
                      <span className="text-xs font-medium text-t-primary truncate">{b.name}</span>
                    </div>
                    <p className="text-[11px] text-t-muted font-mono truncate">{b.path}</p>
                  </div>
                  <div className="shrink-0 flex items-center">
                    {deleteConfirm === b.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { haptic(); handleDelete(b.id) }}
                          className="px-2 py-1 rounded text-[10px] bg-red-500/20 text-red-400 active:bg-red-500/30"
                        >
                          确认
                        </button>
                        <button
                          onClick={() => { haptic(); setDeleteConfirm(null) }}
                          className="px-2 py-1 rounded text-[10px] text-t-muted active:bg-[var(--color-border-subtle)]"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { haptic(); setDeleteConfirm(b.id) }}
                        className="w-6 h-6 flex items-center justify-center rounded text-t-muted active:bg-[var(--color-border-subtle)]"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {bookmarks.length === 0 && !creating && (
            <div className="text-center py-10 text-t-muted text-xs">
              暂无保存的路径收藏
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function extractDirName(path: string): string {
  if (path === '/') return '/'
  return path.split('/').filter(Boolean).pop() || '/'
}
