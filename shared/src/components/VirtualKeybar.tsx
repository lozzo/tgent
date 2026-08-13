import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { haptic } from '../lib/platform'

export type ModifierState = 'off' | 'once' | 'locked'

interface VirtualKeybarProps {
  onKey: (data: string) => void
  onToggleKeyboard?: () => void
  onLockKeyboard?: () => void
  keyboardVisible?: boolean
  keyboardLocked?: boolean
  ctrlState: ModifierState
  setCtrlState: (v: ModifierState) => void
  altState: ModifierState
  setAltState: (v: ModifierState) => void
  fnOpen?: boolean
  onFnToggle?: () => void
}

const DOUBLE_TAP_MS = 300
const LONG_PRESS_MS = 400

function useModifierToggle(state: ModifierState, setState: (v: ModifierState) => void) {
  const lastTapRef = useRef(0)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggered = useRef(false)

  const clearLP = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    longPressTriggered.current = false
    clearLP()
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true
      setState('locked')
    }, LONG_PRESS_MS)
  }, [setState, clearLP])

  const handlePointerUp = useCallback(() => { clearLP() }, [clearLP])

  const handleClick = useCallback(() => {
    if (longPressTriggered.current) { longPressTriggered.current = false; return }
    const now = Date.now()
    if (state === 'off') {
      setState('once')
      lastTapRef.current = now
    } else if (state === 'once') {
      if (now - lastTapRef.current < DOUBLE_TAP_MS) {
        setState('locked')
      } else {
        setState('off')
      }
    } else {
      setState('off')
    }
  }, [state, setState])

  return { handlePointerDown, handlePointerUp, handleClick }
}

// Magnified key popup that clamps itself within the viewport
function KeyPopup({ label }: { label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pad = 4
    if (rect.left < pad) {
      el.style.transform = `translateX(${pad - rect.left}px)`
    } else if (rect.right > window.innerWidth - pad) {
      el.style.transform = `translateX(${window.innerWidth - pad - rect.right}px)`
    }
  })
  return (
    <div
      ref={ref}
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-0.5 pointer-events-none z-50 animate-key-pop"
    >
      <div className="bg-elevated text-t-primary font-mono text-base font-bold px-4 py-2 rounded-lg shadow-xl min-w-[2.5rem] text-center border border-t-border whitespace-nowrap">
        {label}
      </div>
      <div className="w-0 h-0 mx-auto border-l-[7px] border-r-[7px] border-t-[7px] border-l-transparent border-r-transparent border-t-elevated" />
    </div>
  )
}

export default function VirtualKeybar({ onKey, onToggleKeyboard, onLockKeyboard, keyboardVisible, keyboardLocked, ctrlState, setCtrlState, altState, setAltState, fnOpen, onFnToggle }: VirtualKeybarProps) {
  const [pressedKey, setPressedKey] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const kbLastTapRef = useRef(0)
  const kbLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const kbLongPressTriggered = useRef(false)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchingRef = useRef(false)

  const ctrlToggle = useModifierToggle(ctrlState, setCtrlState)
  const altToggle = useModifierToggle(altState, setAltState)

  const showPress = useCallback((key: string) => {
    setPressedKey(key)
    haptic()
    if (pressTimer.current) clearTimeout(pressTimer.current)
    pressTimer.current = setTimeout(() => setPressedKey(null), 400)
  }, [])

  // Swipe-across detection: track finger movement over buttons
  useEffect(() => {
    const bar = barRef.current
    if (!bar) return

    const onTouchStart = () => { touchingRef.current = true }
    const onTouchEnd = () => { touchingRef.current = false }
    const onTouchMove = (e: TouchEvent) => {
      if (!touchingRef.current || e.touches.length < 1) return
      const touch = e.touches[0]
      const el = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null
      const btn = el?.closest('[data-key-id]') as HTMLElement | null
      if (btn) {
        const id = btn.getAttribute('data-key-id')!
        setPressedKey(id)
        if (pressTimer.current) clearTimeout(pressTimer.current)
        pressTimer.current = setTimeout(() => setPressedKey(null), 400)
      }
    }

    bar.addEventListener('touchstart', onTouchStart, { passive: true })
    bar.addEventListener('touchmove', onTouchMove, { passive: true })
    bar.addEventListener('touchend', onTouchEnd, { passive: true })
    bar.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      bar.removeEventListener('touchstart', onTouchStart)
      bar.removeEventListener('touchmove', onTouchMove)
      bar.removeEventListener('touchend', onTouchEnd)
      bar.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  const isCtrlOn = ctrlState !== 'off'
  const isAltOn = altState !== 'off'

  const send = useCallback((data: string) => {
    let out = data
    if (isCtrlOn) {
      if (out.length === 1 && out >= '@' && out <= '_') {
        out = String.fromCharCode(out.charCodeAt(0) - 64)
      } else if (out.length === 1 && out >= 'a' && out <= 'z') {
        out = String.fromCharCode(out.charCodeAt(0) - 96)
      }
      if (ctrlState === 'once') setCtrlState('off')
    }
    if (isAltOn) {
      out = '\x1b' + out
      if (altState === 'once') setAltState('off')
    }
    onKey(out)
  }, [onKey, ctrlState, altState, isCtrlOn, isAltOn, setCtrlState, setAltState])

  const cls = "flex-1 min-w-0 py-1.5 rounded text-xs font-mono text-center select-none touch-manipulation relative overflow-visible"

  const btn = (label: string, data: string) => {
    const id = label + data
    return (
      <button
        key={id}
        data-key-id={id}
        data-key-label={label}
        onPointerDown={(e) => { e.preventDefault(); showPress(id) }}
        onClick={() => send(data)}
        className={`${cls} bg-elevated text-t-primary active:opacity-70`}
      >
        {label}
        {pressedKey === id && <KeyPopup label={label} />}
      </button>
    )
  }

  const modBtn = (label: string, state: ModifierState, toggle: ReturnType<typeof useModifierToggle>) => {
    const stateClass = state === 'locked'
      ? 'bg-amber-600 text-white modifier-locked'
      : state === 'once'
        ? 'bg-blue-600 text-white'
        : 'bg-elevated text-t-primary active:opacity-70'
    return (
      <button
        key={label}
        data-key-id={label}
        data-key-label={label}
        onPointerDown={(e) => { toggle.handlePointerDown(e); showPress(label) }}
        onPointerUp={toggle.handlePointerUp}
        onPointerCancel={toggle.handlePointerUp}
        onClick={toggle.handleClick}
        className={`${cls} ${stateClass}`}
      >
        {label}
        {state === 'locked' && (
          <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3 h-0.5 bg-white rounded-full" />
        )}
        {pressedKey === label && <KeyPopup label={label} />}
      </button>
    )
  }

  return (
    <div ref={barRef} className="shrink-0 bg-surface border-t border-t-border relative safe-bottom safe-x" style={{ overflow: 'visible' }}>
      <div className="px-1.5 py-1 flex flex-col gap-1" style={{ overflow: 'visible' }}>
        <div className="flex gap-1" style={{ overflow: 'visible' }}>
          {btn('Esc', '\x1b')}
          {btn('/', '/')}
          {btn('|', '|')}
          {btn('-', '-')}
          {btn('Home', '\x1b[H')}
          {btn('↑', '\x1b[A')}
          {btn('End', '\x1b[F')}
          {btn('PgU', '\x1b[5~')}
          <button
            data-key-id="⌨"
            data-key-label="⌨"
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              e.preventDefault()
              showPress('⌨')
              kbLongPressTriggered.current = false
              if (kbLongPressTimer.current) clearTimeout(kbLongPressTimer.current)
              kbLongPressTimer.current = setTimeout(() => {
                kbLongPressTriggered.current = true
                onLockKeyboard?.()
              }, LONG_PRESS_MS)
            }}
            onPointerUp={() => {
              if (kbLongPressTimer.current) { clearTimeout(kbLongPressTimer.current); kbLongPressTimer.current = null }
            }}
            onPointerCancel={() => {
              if (kbLongPressTimer.current) { clearTimeout(kbLongPressTimer.current); kbLongPressTimer.current = null }
            }}
            onClick={() => {
              if (kbLongPressTriggered.current) { kbLongPressTriggered.current = false; return }
              const now = Date.now()
              if (now - kbLastTapRef.current < DOUBLE_TAP_MS) {
                onLockKeyboard?.()
                kbLastTapRef.current = 0
              } else {
                onToggleKeyboard?.()
                kbLastTapRef.current = now
              }
            }}
            className={`${cls} ${
              keyboardLocked
                ? 'bg-red-600 text-white modifier-locked'
                : keyboardVisible
                  ? 'bg-blue-600 text-white'
                  : 'bg-surface text-t-secondary active:opacity-70'
            }`}
          >
            ⌨
            {keyboardLocked && (
              <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3 h-0.5 bg-white rounded-full" />
            )}
            {pressedKey === '⌨' && <KeyPopup label="⌨" />}
          </button>
        </div>
        <div className="flex gap-1" style={{ overflow: 'visible' }}>
          {btn('Tab', '\t')}
          {modBtn('Ctrl', ctrlState, ctrlToggle)}
          {modBtn('Alt', altState, altToggle)}
          {btn('\\', '\\')}
          {btn('←', '\x1b[D')}
          {btn('↓', '\x1b[B')}
          {btn('→', '\x1b[C')}
          {btn('PgD', '\x1b[6~')}
          <button
            data-key-id="Fn"
            data-key-label="Fn"
            onPointerDown={(e) => { e.preventDefault(); showPress('Fn') }}
            onClick={() => onFnToggle?.()}
            className={`${cls} ${fnOpen ? 'bg-blue-600 text-white' : 'bg-surface text-t-secondary active:opacity-70'}`}
          >
            Fn
            {pressedKey === 'Fn' && <KeyPopup label="Fn" />}
          </button>
        </div>
      </div>
    </div>
  )
}
