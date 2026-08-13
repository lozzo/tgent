import { useState, useEffect, useCallback, useRef } from 'react'
import { loadSnippets, saveSnippet, deleteSnippet, createSnippetId, type Snippet } from '../lib/snippets'
import { haptic } from '../lib/platform'

interface Props {
  open: boolean
  onClose: () => void
  onSend: (text: string) => void
  /** 从选择模式保存时预填充的内容 */
  prefillContent?: string
  onPrefillConsumed?: () => void
}

export default function SnippetPanel({ open, onClose, onSend, prefillContent, onPrefillConsumed }: Props) {
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const readyRef = useRef(false)

  // 拖拽底部面板
  const outerRef = useRef<HTMLDivElement>(null)
  const [panelH, setPanelH] = useState(0)
  const [transition, setTransition] = useState(false)
  const dragRef = useRef({ active: false, startY: 0, startH: 0, lastY: 0, lastT: 0, v: 0 })

  useEffect(() => {
    if (open) {
      readyRef.current = false
      const timer = setTimeout(() => { readyRef.current = true }, 300)
      loadSnippets().then(setSnippets)
      setDeleteConfirm(null)
      const hasPrefill = !!prefillContent
      if (hasPrefill) {
        setCreating(true)
        setNewTitle('')
        setNewContent(prefillContent!)
        onPrefillConsumed?.()
      } else {
        setCreating(false)
        setNewTitle('')
        setNewContent('')
      }
      // 入场动画：从 0 过渡到初始高度
      setPanelH(0)
      setTransition(true)
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (outerRef.current) {
            setPanelH(outerRef.current.clientHeight * (hasPrefill ? 0.6 : 0.5))
          }
        })
      })
      return () => { clearTimeout(timer); cancelAnimationFrame(raf) }
    }
  }, [open])

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
    const dy = dragRef.current.startY - t.clientY // 正值=上拉
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
    // 极小移动视为点击（如点 +新建 按钮），不做吸附
    if (Math.abs(panelH - dragRef.current.startH) < 5) return
    const outer = outerRef.current
    if (!outer) return
    const ch = outer.clientHeight
    const v = dragRef.current.v
    setTransition(true)
    // 快速向下 → 关闭
    if (v < -400) { onClose(); return }
    // 快速向上 → 展开
    if (v > 400) { setPanelH(ch * 0.85); return }
    // 按位置吸附
    const r = panelH / ch
    if (r < 0.2) onClose()
    else if (r < 0.6) setPanelH(ch * 0.5)
    else setPanelH(ch * 0.85)
  }, [panelH, onClose])

  const handleSave = useCallback(async () => {
    if (!newContent.trim()) return
    const snippet: Snippet = {
      id: createSnippetId(),
      title: newTitle.trim() || '未命名片段',
      content: newContent,
      createdAt: Date.now(),
    }
    await saveSnippet(snippet)
    setSnippets(await loadSnippets())
    setCreating(false)
    setNewTitle('')
    setNewContent('')
  }, [newTitle, newContent])

  const handleDelete = useCallback(async (id: string) => {
    await deleteSnippet(id)
    setSnippets(await loadSnippets())
    setDeleteConfirm(null)
  }, [])

  const handleSend = useCallback((text: string) => {
    onSend(text)
    onClose()
  }, [onSend, onClose])

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${mm}/${dd} ${hh}:${mi}`
  }

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
            <span className="text-sm font-medium text-t-primary">代码片段</span>
            <button
              onClick={() => { haptic(); setCreating(true); setNewTitle(''); setNewContent('') }}
              className="text-xs text-blue-400 active:text-blue-300"
            >
              + 新建
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0">
          {/* 新建/编辑表单 */}
          {creating && (
            <div className="px-4 py-3 border-b border-t-border-subtle space-y-2">
              <input
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="标题（可选）"
                className="w-full px-2.5 py-1.5 rounded-md bg-[var(--color-border-subtle)] text-t-primary text-xs placeholder:text-t-muted focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                autoFocus
              />
              <textarea
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                placeholder="输入片段内容..."
                rows={4}
                className="w-full px-2.5 py-1.5 rounded-md bg-[var(--color-border-subtle)] text-t-primary text-xs placeholder:text-t-muted focus:outline-none focus:ring-1 focus:ring-blue-500/50 resize-none font-mono"
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => { haptic(); setCreating(false); setNewTitle(''); setNewContent('') }}
                  className="px-3 py-1.5 rounded-md text-xs text-t-secondary active:bg-[var(--color-border-subtle)]"
                >
                  取消
                </button>
                <button
                  onClick={() => { haptic(); handleSave() }}
                  disabled={!newContent.trim()}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                    newContent.trim()
                      ? 'bg-blue-500/20 text-blue-400 active:bg-blue-500/30'
                      : 'bg-[var(--color-border-subtle)] text-t-muted'
                  }`}
                >
                  保存
                </button>
              </div>
            </div>
          )}

          {/* 片段列表 */}
          {snippets.map(snippet => (
            <div
              key={snippet.id}
              className="px-4 py-2.5 border-b border-t-border-subtle active:bg-[var(--color-border-subtle)] transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => { haptic(); handleSend(snippet.content) }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-t-primary truncate">{snippet.title}</span>
                    <span className="text-[10px] text-t-muted shrink-0">{formatTime(snippet.createdAt)}</span>
                  </div>
                  <pre className="text-[11px] text-t-muted font-mono truncate whitespace-pre overflow-hidden">
                    {snippet.content.slice(0, 120)}
                  </pre>
                </div>
                <div className="shrink-0 flex items-center">
                  {deleteConfirm === snippet.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { haptic(); handleDelete(snippet.id) }}
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
                      onClick={() => { haptic(); setDeleteConfirm(snippet.id) }}
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
          ))}

          {snippets.length === 0 && !creating && (
            <div className="text-center py-10 text-t-muted text-xs">
              暂无保存的代码片段
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
