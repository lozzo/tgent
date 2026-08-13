import { useRef, useCallback, useEffect } from 'react'

interface Props {
  onRefresh: () => Promise<void>
  children: React.ReactNode
}

const THRESHOLD = 60
const MIN_REFRESH_MS = 500

export default function PullToRefresh({ onRefresh, children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const iconRef = useRef<HTMLDivElement>(null)
  const touchStartY = useRef(0)
  const pulling = useRef(false)
  const pullDist = useRef(0)
  const refreshingRef = useRef(false)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  // 直接操作 DOM，不走 React 渲染
  const applyPull = (dist: number) => {
    pullDist.current = dist
    const indicator = indicatorRef.current
    const icon = iconRef.current
    if (!indicator || !icon) return
    indicator.style.height = dist > 2 ? `${dist}px` : '0px'
    const ratio = Math.min(dist / THRESHOLD, 1)
    icon.style.transform = `rotate(${ratio * 360}deg)`
    icon.style.opacity = `${ratio}`
  }

  const collapse = () => {
    const indicator = indicatorRef.current
    const icon = iconRef.current
    if (icon) icon.classList.remove('pull-refresh-spin')
    if (indicator) {
      indicator.style.transition = 'height 0.2s ease-out'
      indicator.style.height = '0px'
      setTimeout(() => {
        if (indicator) indicator.style.transition = ''
      }, 200)
    }
    pullDist.current = 0
    refreshingRef.current = false
  }

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const el = containerRef.current
    if (!el || refreshingRef.current) return
    if (el.scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY
      pulling.current = true
    }
  }, [])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!pulling.current || refreshingRef.current) return
    const el = containerRef.current
    if (!el) return
    if (el.scrollTop > 0) {
      pulling.current = false
      applyPull(0)
      return
    }
    const dy = e.touches[0].clientY - touchStartY.current
    if (dy > 0) {
      const dampened = dy * 0.4
      applyPull(dampened)
      e.preventDefault()
    }
  }, [])

  const handleTouchEnd = useCallback(async () => {
    if (!pulling.current) return
    pulling.current = false
    const dist = pullDist.current
    if (dist >= THRESHOLD && !refreshingRef.current) {
      refreshingRef.current = true
      applyPull(THRESHOLD)
      const icon = iconRef.current
      if (icon) icon.classList.add('pull-refresh-spin')
      // 确保最少展示 500ms 旋转动画
      const start = Date.now()
      try {
        await onRefreshRef.current()
      } finally {
        const elapsed = Date.now() - start
        const remaining = Math.max(0, MIN_REFRESH_MS - elapsed)
        if (remaining > 0) {
          setTimeout(collapse, remaining)
        } else {
          collapse()
        }
      }
    } else {
      // 回弹
      const indicator = indicatorRef.current
      if (indicator) {
        indicator.style.transition = 'height 0.15s ease-out'
        indicator.style.height = '0px'
        setTimeout(() => {
          if (indicator) indicator.style.transition = ''
        }, 150)
      }
      pullDist.current = 0
    }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: false })
    el.addEventListener('touchend', handleTouchEnd, { passive: true })
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
      el.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd])

  return (
    <div ref={containerRef} className="relative flex-1 overflow-auto" style={{ overscrollBehavior: 'contain' }}>
      <div
        ref={indicatorRef}
        className="flex items-center justify-center overflow-hidden"
        style={{ height: '0px' }}
      >
        <div
          ref={iconRef}
          className="w-6 h-6 text-t-muted"
          style={{ opacity: 0 }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M20.015 4.652v4.993" />
          </svg>
        </div>
      </div>
      {children}
    </div>
  )
}
