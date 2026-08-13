import { useState, useEffect, useCallback, useRef } from 'react'
import { eventBus } from '../state/EventBus'

interface ToastItem {
  id: number
  message: string
  type: 'info' | 'success' | 'error'
  leaving: boolean
}

let nextId = 0

export default function Toast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const removeToast = useCallback((id: number) => {
    // 先标记为 leaving 触发淡出动画
    setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t))
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 200)
  }, [])

  useEffect(() => {
    const off = eventBus.on('toast:show', ({ message, type, duration }) => {
      const id = nextId++
      const toastType = type || 'info'
      const toastDuration = duration || 3000

      setToasts(prev => [...prev, { id, message, type: toastType, leaving: false }])

      const timer = setTimeout(() => {
        removeToast(id)
        timersRef.current.delete(id)
      }, toastDuration)
      timersRef.current.set(id, timer)
    })

    return () => {
      off()
      timersRef.current.forEach(t => clearTimeout(t))
      timersRef.current.clear()
    }
  }, [removeToast])

  if (toasts.length === 0) return null

  const typeStyles = {
    info: 'bg-[var(--color-bg-elevated)] text-t-primary border border-t-border',
    success: 'bg-green-600 text-white',
    error: 'bg-red-600 text-white',
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9998] flex flex-col items-center gap-2 pointer-events-none"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
    >
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg pointer-events-auto
            ${typeStyles[toast.type]}
            ${toast.leaving ? 'animate-toast-out' : 'animate-toast-in'}`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  )
}
