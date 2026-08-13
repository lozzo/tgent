/**
 * useTerminalKeyboard — 键盘适配逻辑
 * 从 TerminalPage 提取，处理 visualViewport resize/scroll、键盘可见状态、
 * resize vs shift 策略选择、光标跟随偏移等。
 */

import { useRef, useCallback, useEffect, useState } from 'react'
import type { TerminalHandle } from '../components/Terminal'

export interface UseTerminalKeyboardOptions {
  containerRef: React.RefObject<HTMLDivElement | null>
  mainRef: React.RefObject<HTMLDivElement | null>
  termWrapperRef: React.RefObject<HTMLDivElement | null>
  getTermRef: () => TerminalHandle | null
  /** 返回 true 使用 resize 策略，false 使用 shift 策略 */
  shouldResize: () => boolean
}

export interface UseTerminalKeyboardReturn {
  keyboardVisible: boolean
  fullMainHeightRef: React.MutableRefObject<number>
  reapplyKeyboardLayout: () => void
  handleBufferChange: (isAlternate: boolean) => void
  handleCursorMove: () => void
}

export function useTerminalKeyboard(opts: UseTerminalKeyboardOptions): UseTerminalKeyboardReturn {
  const { containerRef, mainRef, termWrapperRef, getTermRef, shouldResize } = opts
  const fullMainHeightRef = useRef(0)
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const shiftRafRef = useRef(0)

  // 根据光标位置调整终端偏移（键盘打开时 shift 模式使用）
  const adjustShift = useCallback(() => {
    if (shouldResize()) return
    if (!termWrapperRef.current || fullMainHeightRef.current <= 0) return
    const vv = window.visualViewport
    if (!vv) return
    const kbH = window.innerHeight - vv.height
    if (kbH <= 1) return
    const termRef = getTermRef()
    const cursorInfo = termRef?.getCursorInfo()
    let shift = 0
    if (cursorInfo) {
      const cursorPxFromTop = cursorInfo.cursorY * cursorInfo.lineHeight
      const visibleMainHeight = fullMainHeightRef.current - kbH
      if (cursorPxFromTop >= visibleMainHeight) {
        shift = Math.min(kbH, cursorPxFromTop - visibleMainHeight + cursorInfo.lineHeight * 2)
      }
    }
    termWrapperRef.current.style.transform = `translateY(${-shift}px)`
    termRef?.adjustInputPosition(kbH - shift)
  }, [shouldResize, termWrapperRef, getTermRef])

  // 重新评估键盘布局策略
  const reapplyKeyboardLayout = useCallback(() => {
    if (!termWrapperRef.current || fullMainHeightRef.current <= 0) return
    const vv = window.visualViewport
    if (!vv) return
    const kbH = window.innerHeight - vv.height
    if (kbH <= 1) return
    if (shouldResize()) {
      termWrapperRef.current.style.height = ''
      termWrapperRef.current.style.transform = ''
      getTermRef()?.adjustInputPosition(0)
    } else {
      termWrapperRef.current.style.height = `${fullMainHeightRef.current}px`
      adjustShift()
    }
  }, [shouldResize, termWrapperRef, getTermRef, adjustShift])

  const handleBufferChange = useCallback((_isAlternate: boolean) => {
    reapplyKeyboardLayout()
  }, [reapplyKeyboardLayout])

  const handleCursorMove = useCallback(() => {
    if (shiftRafRef.current) return
    shiftRafRef.current = requestAnimationFrame(() => {
      shiftRafRef.current = 0
      adjustShift()
    })
  }, [adjustShift])

  // visualViewport 监听
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    let kbDebounce: ReturnType<typeof setTimeout> | undefined
    let scrollRafId = 0
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined

    const update = () => {
      if (!containerRef.current) return
      const kbH = window.innerHeight - vv.height
      // 只在键盘可见时约束容器高度，键盘隐藏时清除让 inset-0 自然生效，
      // 避免 vv.height 在设备旋转/多任务切换时返回过时值导致尺寸错误
      if (kbH > 100) {
        containerRef.current.style.height = `${vv.height}px`
      } else {
        containerRef.current.style.height = ''
      }
      if (kbH <= 1 && mainRef.current) {
        fullMainHeightRef.current = mainRef.current.clientHeight
      }
      if (kbH > 1 && fullMainHeightRef.current > 0 && termWrapperRef.current) {
        if (shouldResize()) {
          termWrapperRef.current.style.height = ''
          termWrapperRef.current.style.transform = ''
          getTermRef()?.adjustInputPosition(0)
        } else {
          termWrapperRef.current.style.height = `${fullMainHeightRef.current}px`
          adjustShift()
        }
      } else if (termWrapperRef.current) {
        termWrapperRef.current.style.height = ''
        termWrapperRef.current.style.transform = ''
        getTermRef()?.adjustInputPosition(0)
      }
      const isKb = kbH > 100
      clearTimeout(kbDebounce)
      kbDebounce = setTimeout(() => setKeyboardVisible(isKb), 120)
    }

    update()

    const preventScroll = () => {
      if (scrollRafId) return
      scrollRafId = requestAnimationFrame(() => {
        scrollRafId = 0
        window.scrollTo(0, 0)
        document.documentElement.scrollTop = 0
        document.body.scrollTop = 0
        document.documentElement.scrollLeft = 0
        document.body.scrollLeft = 0
      })
    }

    const onFocusChange = () => {
      clearTimeout(fallbackTimer)
      fallbackTimer = setTimeout(update, 300)
    }

    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    window.addEventListener('scroll', preventScroll, { passive: false })
    document.addEventListener('focusin', onFocusChange)
    document.addEventListener('focusout', onFocusChange)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      window.removeEventListener('scroll', preventScroll)
      document.removeEventListener('focusin', onFocusChange)
      document.removeEventListener('focusout', onFocusChange)
      clearTimeout(kbDebounce)
      clearTimeout(fallbackTimer)
      if (scrollRafId) cancelAnimationFrame(scrollRafId)
    }
  }, [])

  return {
    keyboardVisible,
    fullMainHeightRef,
    reapplyKeyboardLayout,
    handleBufferChange,
    handleCursorMove,
  }
}
