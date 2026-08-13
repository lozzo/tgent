import { useState, useEffect } from 'react'
import { loadTerminalSettings, saveTerminalSettings, FONT_OPTIONS, type TerminalSettings } from '../../lib/terminalSettings'
import { haptic, setHapticEnabled } from '../../lib/platform'

export default function TerminalTab() {
  const [termSettings, setTermSettings] = useState<TerminalSettings | null>(null)

  useEffect(() => {
    loadTerminalSettings().then(setTermSettings)
  }, [])

  const updateTermSettings = (patch: Partial<TerminalSettings>) => {
    setTermSettings(prev => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      saveTerminalSettings(next)
      if (patch.haptic !== undefined) {
        setHapticEnabled(patch.haptic)
      }
      return next
    })
  }

  if (!termSettings) return <div className="text-center py-10 text-t-muted text-sm">加载中...</div>

  return (
    <div className="space-y-5">
      <div>
        <label className="text-sm text-t-secondary block mb-2">字体大小</label>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { haptic(); updateTermSettings({ fontSize: Math.max(8, termSettings.fontSize - 1) }) }}
            className="w-9 h-9 rounded-lg bg-elevated flex items-center justify-center text-t-primary active:opacity-70 border border-t-border"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
            </svg>
          </button>
          <span className="text-t-primary text-lg font-mono w-10 text-center">{termSettings.fontSize}</span>
          <button
            onClick={() => { haptic(); updateTermSettings({ fontSize: Math.min(32, termSettings.fontSize + 1) }) }}
            className="w-9 h-9 rounded-lg bg-elevated flex items-center justify-center text-t-primary active:opacity-70 border border-t-border"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </div>
      </div>

      <div>
        <label className="text-sm text-t-secondary block mb-2">字体</label>
        <select
          value={termSettings.fontFamily}
          onChange={e => updateTermSettings({ fontFamily: e.target.value })}
          className="w-full px-3 py-2.5 rounded-lg bg-elevated border border-t-border text-t-primary text-sm focus:outline-none focus:border-blue-500"
        >
          {FONT_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-sm text-t-secondary block mb-2">滚动缓冲区行数</label>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { haptic(); updateTermSettings({ scrollback: Math.max(500, termSettings.scrollback - 500) }) }}
            className="w-9 h-9 rounded-lg bg-elevated flex items-center justify-center text-t-primary active:opacity-70 border border-t-border"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
            </svg>
          </button>
          <span className="text-t-primary text-lg font-mono w-16 text-center">{termSettings.scrollback}</span>
          <button
            onClick={() => { haptic(); updateTermSettings({ scrollback: Math.min(50000, termSettings.scrollback + 500) }) }}
            className="w-9 h-9 rounded-lg bg-elevated flex items-center justify-center text-t-primary active:opacity-70 border border-t-border"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-sm text-t-secondary">光标闪烁</label>
        <button
          onClick={() => { haptic(); updateTermSettings({ cursorBlink: !termSettings.cursorBlink }) }}
          className={`w-11 h-6 rounded-full relative transition-colors ${
            termSettings.cursorBlink ? 'bg-blue-600' : 'bg-[var(--color-text-muted)]'
          }`}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            termSettings.cursorBlink ? 'left-[22px]' : 'left-0.5'
          }`} />
        </button>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-sm text-t-secondary">触觉反馈</label>
        <button
          onClick={() => {
            const next = !termSettings.haptic
            updateTermSettings({ haptic: next })
            if (next) {
              setHapticEnabled(true)
              haptic()
            }
          }}
          className={`w-11 h-6 rounded-full relative transition-colors ${
            termSettings.haptic ? 'bg-blue-600' : 'bg-[var(--color-text-muted)]'
          }`}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            termSettings.haptic ? 'left-[22px]' : 'left-0.5'
          }`} />
        </button>
      </div>

      <div>
        <label className="text-sm text-t-secondary block mb-2">键盘适配模式</label>
        <select
          value={termSettings.keyboardMode}
          onChange={e => updateTermSettings({ keyboardMode: e.target.value as 'auto' | 'resize' | 'shift' })}
          className="w-full px-3 py-2.5 rounded-lg bg-elevated border border-t-border text-t-primary text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="auto">自动（根据程序类型切换）</option>
          <option value="resize">始终 Resize（缩小终端行数）</option>
          <option value="shift">始终上移（CSS 平移保留历史）</option>
        </select>
      </div>

      <div>
        <label className="text-sm text-t-secondary block mb-2">渲染器</label>
        <select
          value={termSettings.renderer}
          onChange={e => updateTermSettings({ renderer: e.target.value as 'auto' | 'webgl' | 'canvas' })}
          className="w-full px-3 py-2.5 rounded-lg bg-elevated border border-t-border text-t-primary text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="auto">自动（WebGL，不可用时降级 Canvas）</option>
          <option value="webgl">WebGL（高性能，部分设备可能有渲染问题）</option>
          <option value="canvas">Canvas（兼容性好，推荐 WebGL 有问题时使用）</option>
        </select>
      </div>
    </div>
  )
}
