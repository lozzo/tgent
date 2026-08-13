import { useEffect, useRef } from 'react'
import { haptic } from '../lib/platform'

interface Options {
  ref: React.RefObject<HTMLElement | null>
  onSwipeLeft: () => void
  onSwipeRight: () => void
  enabled?: boolean
  minFingers?: number
  minDistance?: number
  maxVertical?: number
}

export function useMultiFingerSwipe({
  ref,
  onSwipeLeft,
  onSwipeRight,
  enabled = true,
  minFingers = 2,
  minDistance = 50,
  maxVertical = 30,
}: Options) {
  const startRef = useRef<{ x: number; y: number; fingers: number } | null>(null)
  const firedRef = useRef(false)

  // Keep callbacks fresh without re-registering listeners
  const cbRef = useRef({ onSwipeLeft, onSwipeRight })
  cbRef.current = { onSwipeLeft, onSwipeRight }

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    function handleTouchStart(e: TouchEvent) {
      if (e.touches.length >= minFingers) {
        startRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          fingers: e.touches.length,
        }
        firedRef.current = false
      }
    }

    function handleTouchMove(e: TouchEvent) {
      const start = startRef.current
      if (!start || firedRef.current) return
      if (e.touches.length < minFingers) {
        startRef.current = null
        return
      }

      const dx = e.touches[0].clientX - start.x
      const dy = e.touches[0].clientY - start.y
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)

      // 只在水平距离 > 垂直距离时触发
      if (absDx > absDy && absDx >= minDistance && absDy <= maxVertical) {
        firedRef.current = true
        haptic()
        if (dx > 0) {
          cbRef.current.onSwipeRight()
        } else {
          cbRef.current.onSwipeLeft()
        }
      }
    }

    function handleTouchEnd() {
      startRef.current = null
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: true })
    el.addEventListener('touchend', handleTouchEnd, { passive: true })
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
      el.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [ref, enabled, minFingers, minDistance, maxVertical])
}
