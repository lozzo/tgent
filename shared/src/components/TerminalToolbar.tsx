import { useState, useRef, useEffect, useCallback } from 'react'

export type ToolbarMode = 'default' | 'selection' | 'search'

interface Props {
  mode: ToolbarMode
  onModeChange: (mode: ToolbarMode) => void
  // 选择模式
  onSelectAll: () => void
  onSelectVisible: () => void
  onCopy: () => void
  onSaveSnippet: () => void
  hasSelection: boolean
  // 粘贴
  onPaste: () => void
  // 搜索
  onSearchNext: (query: string) => void
  onSearchPrev: (query: string) => void
  onSearchClear: () => void
  // 片段
  onOpenSnippets: () => void
}

export default function TerminalToolbar({
  mode,
  onModeChange,
  onSelectAll,
  onSelectVisible,
  onCopy,
  onSaveSnippet,
  hasSelection,
  onPaste,
  onSearchNext,
  onSearchPrev,
  onSearchClear,
  onOpenSnippets,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (mode === 'search') {
      // 聚焦搜索输入框
      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
    if (mode !== 'search') {
      setSearchQuery('')
      onSearchClear()
    }
  }, [mode])

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
    if (value) onSearchNext(value)
    else onSearchClear()
  }, [onSearchNext, onSearchClear])

  const btnBase = 'px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap'
  const btnPrimary = `${btnBase} bg-blue-500/20 text-blue-400 active:bg-blue-500/30`
  const btnDefault = `${btnBase} bg-[var(--color-border-subtle)] text-t-secondary active:bg-[var(--color-border-subtle)]/80`
  const btnDanger = `${btnBase} bg-red-500/15 text-red-400 active:bg-red-500/25`

  if (mode === 'selection') {
    return (
      <div className="shrink-0 bg-surface border-b border-t-border px-2 py-1.5 z-20 relative">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button onPointerDown={e => { e.preventDefault(); onSelectAll() }} className={btnDefault}>
            全选
          </button>
          <button onPointerDown={e => { e.preventDefault(); onSelectVisible() }} className={btnDefault}>
            可见区域
          </button>
          <div className="w-px h-5 bg-t-border shrink-0" />
          <button
            onPointerDown={e => { e.preventDefault(); onCopy() }}
            className={hasSelection ? btnPrimary : `${btnBase} bg-[var(--color-border-subtle)] text-t-muted`}
            disabled={!hasSelection}
          >
            复制
          </button>
          <button
            onPointerDown={e => { e.preventDefault(); onSaveSnippet() }}
            className={hasSelection ? btnDefault : `${btnBase} bg-[var(--color-border-subtle)] text-t-muted`}
            disabled={!hasSelection}
          >
            保存片段
          </button>
          <div className="flex-1" />
          <button onPointerDown={e => { e.preventDefault(); onModeChange('default') }} className={btnDanger}>
            取消
          </button>
        </div>
      </div>
    )
  }

  if (mode === 'search') {
    return (
      <div className="shrink-0 bg-surface border-b border-t-border px-2 py-1.5 z-20 relative">
        <div className="flex items-center gap-2">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (e.shiftKey) onSearchPrev(searchQuery)
                else onSearchNext(searchQuery)
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                onModeChange('default')
              }
            }}
            placeholder="搜索..."
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-[var(--color-border-subtle)] text-t-primary text-xs placeholder:text-t-muted focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          />
          <button
            onPointerDown={e => { e.preventDefault(); onSearchPrev(searchQuery) }}
            className={`w-7 h-7 flex items-center justify-center rounded-md ${searchQuery ? 'text-t-secondary' : 'text-t-muted'} active:bg-[var(--color-border-subtle)]`}
            disabled={!searchQuery}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
            </svg>
          </button>
          <button
            onPointerDown={e => { e.preventDefault(); onSearchNext(searchQuery) }}
            className={`w-7 h-7 flex items-center justify-center rounded-md ${searchQuery ? 'text-t-secondary' : 'text-t-muted'} active:bg-[var(--color-border-subtle)]`}
            disabled={!searchQuery}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          <button
            onPointerDown={e => { e.preventDefault(); onModeChange('default') }}
            className="w-7 h-7 flex items-center justify-center rounded-md text-t-secondary active:bg-[var(--color-border-subtle)]"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  // 默认模式：四个功能按钮
  return (
    <div className="shrink-0 bg-surface border-b border-t-border px-2 py-1.5 z-20 relative">
      <div className="flex items-center gap-2">
        <button onPointerDown={e => { e.preventDefault(); onModeChange('selection') }} className={btnDefault}>
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
            </svg>
            选择
          </span>
        </button>
        <button onPointerDown={e => { e.preventDefault(); onPaste() }} className={btnDefault}>
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
            </svg>
            粘贴
          </span>
        </button>
        <button onPointerDown={e => { e.preventDefault(); onModeChange('search') }} className={btnDefault}>
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            搜索
          </span>
        </button>
        <button onPointerDown={e => { e.preventDefault(); onOpenSnippets() }} className={btnDefault}>
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
            </svg>
            片段
          </span>
        </button>
      </div>
    </div>
  )
}
