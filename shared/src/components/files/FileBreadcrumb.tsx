import { useState, useEffect } from 'react'
import { haptic } from '../../lib/platform'

interface Props {
  path: string
  onNavigate: (path: string) => void
}

export default function FileBreadcrumb({ path, onNavigate }: Props) {
  const parts = path.split('/').filter(Boolean)
  const [expanded, setExpanded] = useState(false)

  // 路径变化时自动收起
  useEffect(() => {
    setExpanded(false)
  }, [path])

  const needCollapse = parts.length > 3

  // 构建要显示的段
  let displayParts: { name: string; fullPath: string; isEllipsis?: boolean }[]

  if (!needCollapse || expanded) {
    displayParts = parts.map((part, i) => ({
      name: part,
      fullPath: '/' + parts.slice(0, i + 1).join('/'),
    }))
  } else {
    // 根 + 第一段 + ... + 最后两段
    const first = { name: parts[0], fullPath: '/' + parts[0] }
    const lastTwo = parts.slice(-2).map((part, i) => ({
      name: part,
      fullPath: '/' + parts.slice(0, parts.length - 2 + i + 1).join('/'),
    }))
    displayParts = [first, { name: '...', fullPath: '', isEllipsis: true }, ...lastTwo]
  }

  return (
    <nav className="flex items-center gap-1 text-sm text-t-secondary overflow-x-auto scrollbar-hide py-1">
      <button
        onClick={() => { haptic(); onNavigate('/') }}
        className="shrink-0 px-1.5 py-0.5 rounded hover:bg-[var(--color-border-subtle)] text-t-muted"
      >
        /
      </button>
      {displayParts.map((item, i) => (
        <span key={item.isEllipsis ? '__ellipsis' : item.fullPath} className="flex items-center gap-1 shrink-0">
          <svg className="w-3.5 h-3.5 text-t-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          {item.isEllipsis ? (
            <button
              onClick={() => { haptic(); setExpanded(!expanded) }}
              className="px-1.5 py-0.5 rounded hover:bg-[var(--color-border-subtle)] text-t-muted"
            >
              ...
            </button>
          ) : (
            <button
              onClick={() => { haptic(); onNavigate(item.fullPath) }}
              className={`px-1.5 py-0.5 rounded truncate max-w-[120px] ${
                i === displayParts.length - 1
                  ? 'text-t-primary font-medium'
                  : 'hover:bg-[var(--color-border-subtle)] text-t-secondary'
              }`}
            >
              {item.name}
            </button>
          )}
        </span>
      ))}
    </nav>
  )
}
