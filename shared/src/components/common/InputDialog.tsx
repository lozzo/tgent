import { useState, useEffect } from 'react'
import { haptic } from '../../lib/platform'

interface InputDialogProps {
  open: boolean
  title: string
  label?: string
  placeholder?: string
  defaultValue?: string
  confirmText?: string
  cancelText?: string
  validate?: (value: string) => string | null
  onConfirm: (value: string) => void
  onCancel: () => void
}

export default function InputDialog({
  open,
  title,
  label,
  placeholder,
  defaultValue = '',
  confirmText = '确认',
  cancelText = '取消',
  validate,
  onConfirm,
  onCancel,
}: InputDialogProps) {
  const [value, setValue] = useState(defaultValue)
  const [error, setError] = useState<string | null>(null)

  // 每次打开时重置
  useEffect(() => {
    if (open) {
      setValue(defaultValue)
      setError(null)
    }
  }, [open, defaultValue])

  if (!open) return null

  const handleConfirm = () => {
    if (validate) {
      const err = validate(value)
      if (err) {
        setError(err)
        return
      }
    }
    onConfirm(value)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0" style={{ backgroundColor: 'var(--color-bg-overlay)' }} />
      <div
        className="relative w-[90%] max-w-sm bg-surface rounded-2xl px-5 py-6 animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-t-primary text-[18px] font-semibold mb-4">{title}</h3>
        {label && (
          <label className="text-t-secondary text-[14px] block mb-2">{label}</label>
        )}
        <input
          autoFocus
          type="text"
          value={value}
          onChange={e => { setValue(e.target.value); setError(null) }}
          onKeyDown={e => e.key === 'Enter' && handleConfirm()}
          placeholder={placeholder}
          className="w-full bg-[var(--color-border-subtle)] rounded-xl px-4 py-3.5 text-[17px] text-t-primary placeholder-t-muted focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
        {error && (
          <p className="text-red-400 text-[13px] mt-1.5">{error}</p>
        )}
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => { haptic(); onCancel() }}
            className="flex-1 py-3 rounded-xl bg-elevated text-t-secondary text-[15px] font-medium active:bg-[var(--color-border)] transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={() => { haptic(); handleConfirm() }}
            className="flex-1 py-3 rounded-xl bg-blue-600 text-white text-[15px] font-medium active:bg-blue-700 transition-colors"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
