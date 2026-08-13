import type React from 'react'
import { haptic } from '../../lib/platform'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string | React.ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0" style={{ backgroundColor: 'var(--color-bg-overlay)' }} />
      <div
        className="relative w-[90%] max-w-sm bg-surface rounded-2xl px-5 py-6 animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-t-primary text-[18px] font-semibold mb-2">{title}</h3>
        <div className="text-t-secondary text-[14px] mb-5">{message}</div>
        <div className="flex gap-3">
          <button
            onClick={() => { haptic(); onCancel() }}
            disabled={loading}
            className="flex-1 py-3 rounded-xl bg-elevated text-t-secondary text-[15px] font-medium active:bg-[var(--color-border)] disabled:opacity-50 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={() => { haptic(); onConfirm() }}
            disabled={loading}
            className={`flex-1 py-3 rounded-xl text-white text-[15px] font-medium transition-colors disabled:opacity-50 ${
              danger
                ? 'bg-red-600 active:bg-red-700'
                : 'bg-blue-600 active:bg-blue-700'
            }`}
          >
            {loading ? (
              <svg className="w-5 h-5 mx-auto animate-spin text-white/70" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
