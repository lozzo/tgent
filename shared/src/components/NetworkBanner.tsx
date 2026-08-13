import { useState, useEffect, useRef } from 'react'
import { eventBus } from '../state/EventBus'

type BannerState = 'hidden' | 'disconnected' | 'recovered'

export default function NetworkBanner() {
  const [state, setState] = useState<BannerState>('hidden')
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const offDisconnected = eventBus.on('connection:disconnected', () => {
      clearTimeout(timerRef.current)
      setState('disconnected')
      // 兜底：15s 后自动隐藏（避免重连成功但事件丢失导致 banner 永驻）
      timerRef.current = setTimeout(() => setState('hidden'), 15000)
    })

    const offConnected = eventBus.on('connection:connected', () => {
      setState(prev => {
        if (prev === 'hidden') return prev
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setState('hidden'), 1500)
        return 'recovered'
      })
    })

    return () => {
      offDisconnected()
      offConnected()
      clearTimeout(timerRef.current)
    }
  }, [])

  if (state === 'hidden') return null

  const config = {
    disconnected: {
      bg: 'bg-yellow-600',
      text: '连接已断开，正在重连...',
      spinner: true,
    },
    recovered: {
      bg: 'bg-green-600',
      text: '连接已恢复',
      spinner: false,
    },
  }[state]

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] safe-top animate-banner-in"
    >
      <div
        className={`${config.bg} px-4 py-2 flex items-center justify-center gap-2`}
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}
      >
        {config.spinner && (
          <svg
            className="w-4 h-4 text-white animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12" cy="12" r="10"
              stroke="currentColor" strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        <span className="text-white text-sm font-medium">{config.text}</span>
      </div>
    </div>
  )
}
