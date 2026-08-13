import { useState, useCallback, useEffect, useRef } from 'react'
import { haptic } from '../../lib/platform'

export interface ActionSheetAction {
  label: string
  icon?: React.ReactNode
  destructive?: boolean
  disabled?: boolean
  disabledLabel?: string
  onPress: () => void
}

interface Props {
  visible: boolean
  title?: string
  message?: string
  actions: ActionSheetAction[]
  onClose: () => void
}

export default function ActionSheet({ visible, title, message, actions, onClose }: Props) {
  const [leaving, setLeaving] = useState(false)

  // 下滑关闭手势
  const [dragY, setDragY] = useState(0)
  const dragging = useRef(false)
  const touchStartY = useRef(0)

  const handleClose = useCallback(() => {
    setLeaving(true)
    setDragY(0)
    setTimeout(() => {
      setLeaving(false)
      onClose()
    }, 250)
  }, [onClose])

  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, handleClose])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
    dragging.current = false
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dy = e.touches[0].clientY - touchStartY.current
    if (dy > 8) dragging.current = true
    if (dragging.current) {
      setDragY(Math.max(0, dy))
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (dragging.current && dragY > 80) {
      handleClose()
    } else {
      setDragY(0)
    }
    dragging.current = false
  }, [dragY, handleClose])

  if (!visible && !leaving) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* 遮罩 */}
      <div
        className={`absolute inset-0 bg-black/50 ${leaving ? 'animate-overlay-out' : 'animate-overlay-in'}`}
        onClick={handleClose}
      />
      {/* Bottom Sheet */}
      <div
        className={`relative z-10 ${leaving ? 'animate-action-sheet-out' : 'animate-action-sheet-in'}`}
        style={{
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragging.current ? 'none' : undefined,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="bg-[var(--color-bg-elevated,#1c1c1e)] rounded-t-2xl overflow-hidden safe-bottom">
          {/* 拖拽指示条 */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-9 h-1 rounded-full bg-t-muted/30" />
          </div>

          {/* 标题区 */}
          {(title || message) && (
            <div className="px-5 pt-1 pb-3">
              {title && <div className="text-sm font-medium text-t-primary">{title}</div>}
              {message && <div className="text-xs text-t-muted mt-0.5">{message}</div>}
            </div>
          )}

          {/* 操作列表 */}
          <div className="pb-2">
            {actions.map((action, i) => (
              <button
                key={i}
                disabled={action.disabled}
                className={`w-full px-5 py-3 text-[15px] flex items-center gap-3 transition-colors
                  ${action.destructive ? 'text-red-400' : 'text-t-primary'}
                  ${action.disabled ? 'opacity-40 cursor-not-allowed' : 'active:bg-[var(--color-border-subtle)]'}
                `}
                onClick={() => {
                  if (action.disabled) return
                  haptic()
                  action.onPress()
                  handleClose()
                }}
              >
                {action.icon && <span className="w-5 h-5 shrink-0">{action.icon}</span>}
                <span>{action.disabled && action.disabledLabel ? action.disabledLabel : action.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
