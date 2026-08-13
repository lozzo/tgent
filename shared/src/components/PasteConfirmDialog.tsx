import { useEffect, useRef } from 'react'
import { haptic } from '../lib/platform'

interface Props {
  open: boolean
  text: string
  onConfirm: () => void
  onCancel: () => void
}

export default function PasteConfirmDialog({ open, text, onConfirm, onCancel }: Props) {
  // 防止打开瞬间的 click 穿透关闭对话框
  const readyRef = useRef(false)

  useEffect(() => {
    if (open) {
      readyRef.current = false
      requestAnimationFrame(() => { readyRef.current = true })
    }
  }, [open])

  if (!open) return null

  const lines = text.split('\n')
  const lineCount = lines.length
  const charCount = text.length
  const previewLines = lines.slice(0, 6)
  const hasMore = lines.length > 6

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => { if (readyRef.current) onCancel() }}>
      <div className="absolute inset-0" style={{ backgroundColor: 'var(--color-bg-overlay)' }} />
      <div
        className="relative w-[90%] max-w-md bg-surface rounded-2xl overflow-hidden shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2">
          <h3 className="text-sm font-medium text-t-primary">确认粘贴</h3>
          <p className="text-xs text-t-muted mt-1">
            {lineCount} 行，{charCount} 字符
          </p>
        </div>
        <div className="px-4 pb-3">
          <pre className="text-xs text-t-secondary bg-[var(--color-border-subtle)] rounded-lg p-2.5 overflow-x-auto max-h-40 whitespace-pre-wrap break-all font-mono">
            {previewLines.join('\n')}
            {hasMore && '\n...'}
          </pre>
        </div>
        <div className="flex border-t border-t-border">
          <button
            onClick={() => { haptic(); onCancel() }}
            className="flex-1 py-3 text-sm text-t-secondary active:bg-[var(--color-border-subtle)] transition-colors"
          >
            取消
          </button>
          <div className="w-px bg-t-border" />
          <button
            onClick={() => { haptic(); onConfirm() }}
            className="flex-1 py-3 text-sm text-blue-400 font-medium active:bg-blue-500/10 transition-colors"
          >
            粘贴
          </button>
        </div>
      </div>
    </div>
  )
}
