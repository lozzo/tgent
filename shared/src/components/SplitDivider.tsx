/**
 * SplitDivider — 拖拽分割线组件
 * 2 触摸区域，中间 1px 可见线 + 居中三圆点抓手。
 * pointer 事件挂在 document 上（比 touch 更可靠）。
 * 支持拖拽调整 ratio (0.2 ~ 0.8)，双击恢复 50/50。
 */

import { useRef, useCallback, useEffect, useState } from 'react'
import { haptic } from '../lib/platform'

interface SplitDividerProps {
  onRatioChange: (ratio: number) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  /** 容器总高度（用于计算 ratio） */
  containerHeight: number
  /** 当前 ratio */
  ratio: number
}

export default function SplitDivider({
  onRatioChange,
  onDragStart,
  onDragEnd,
  containerHeight,
  ratio,
}: SplitDividerProps) {
  const draggingRef = useRef(false)
  const startYRef = useRef(0)
  const startRatioRef = useRef(0)
  const lastTapRef = useRef(0)
  const onRatioChangeRef = useRef(onRatioChange)
  onRatioChangeRef.current = onRatioChange
  const onDragEndRef = useRef(onDragEnd)
  onDragEndRef.current = onDragEnd

  const containerHeightRef = useRef(containerHeight)
  containerHeightRef.current = containerHeight

  const [dragging, setDragging] = useState(false)

  // document 级别的 pointermove / pointerup 监听
  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!draggingRef.current || containerHeightRef.current <= 0) return
      e.preventDefault()
      const dy = e.clientY - startYRef.current
      const deltaRatio = dy / containerHeightRef.current
      const newRatio = Math.min(0.8, Math.max(0.2, startRatioRef.current + deltaRatio))
      onRatioChangeRef.current(newRatio)
    }
    const handleEnd = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      setDragging(false)
      onDragEndRef.current?.()
    }
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleEnd)
    document.addEventListener('pointercancel', handleEnd)
    return () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleEnd)
      document.removeEventListener('pointercancel', handleEnd)
    }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const now = Date.now()
    if (now - lastTapRef.current < 300) {
      onRatioChange(0.5)
      lastTapRef.current = 0
      return
    }
    lastTapRef.current = now

    draggingRef.current = true
    setDragging(true)
    haptic()
    startYRef.current = e.clientY
    startRatioRef.current = ratio
    onDragStart?.()
  }, [ratio, onRatioChange, onDragStart])

  const lineStyle = (active: boolean): React.CSSProperties => ({
    width: 16,
    height: 1,
    borderRadius: 0.5,
    background: active
      ? 'linear-gradient(90deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.5) 30%, rgba(255,255,255,0.5) 70%, rgba(255,255,255,0.15) 100%)'
      : 'linear-gradient(90deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.25) 30%, rgba(255,255,255,0.25) 70%, rgba(255,255,255,0.05) 100%)',
    transition: 'background 150ms',
  })

  return (
    <div
      className="split-divider shrink-0 relative flex items-center justify-center select-none"
      style={{ height: 2, touchAction: 'none', zIndex: 10 }}
      onPointerDown={handlePointerDown}
    >
      {/* 左右两段横线，中间给 Badge 留空 */}
      <div className="absolute inset-x-0 top-1/2 flex items-center" style={{ height: 0, transform: 'translateY(-0.5px)' }}>
        <div className="flex-1 bg-t-border" style={{ height: 1, marginRight: 20 }} />
        <div className="flex-1 bg-t-border" style={{ height: 1, marginLeft: 20 }} />
      </div>
      {/* 胶囊 Badge + 两条玻璃横线 */}
      <div
        className="relative flex flex-col items-center justify-center gap-[3px]"
        style={{
          width: 32,
          height: 14,
          borderRadius: 7,
          background: dragging
            ? 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 100%)'
            : 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)',
          boxShadow: dragging
            ? 'inset 0 0.5px 0 rgba(255,255,255,0.2), 0 0.5px 2px rgba(0,0,0,0.4)'
            : 'inset 0 0.5px 0 rgba(255,255,255,0.1), 0 0.5px 1px rgba(0,0,0,0.3)',
          border: '0.5px solid rgba(255,255,255,0.06)',
          transition: 'background 150ms, box-shadow 150ms',
        }}
      >
        <div style={lineStyle(dragging)} />
        <div style={lineStyle(dragging)} />
      </div>
    </div>
  )
}
