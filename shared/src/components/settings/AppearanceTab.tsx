import { getAllThemes, getTheme, loadThemeId, saveThemeId, applyTheme } from '../../lib/themes'
import { useState, useEffect } from 'react'
import { haptic } from '../../lib/platform'

export default function AppearanceTab() {
  const [currentThemeId, setCurrentThemeId] = useState('tokyo-night')

  useEffect(() => {
    loadThemeId().then(setCurrentThemeId)
  }, [])

  const allThemes = getAllThemes()

  const handleSelectTheme = (id: string) => {
    haptic()
    setCurrentThemeId(id)
    saveThemeId(id)
    applyTheme(getTheme(id))
  }

  const darkThemes = allThemes.filter(t => t.group === 'dark')
  const lightThemes = allThemes.filter(t => t.group === 'light')

  const renderGrid = (themes: typeof allThemes) => (
    <div className="grid grid-cols-2 gap-3">
      {themes.map(theme => {
        const selected = theme.id === currentThemeId
        return (
          <button
            key={theme.id}
            onClick={() => handleSelectTheme(theme.id)}
            className={`rounded-xl p-3 text-left transition-all border-2 ${
              selected
                ? 'border-blue-500 ring-1 ring-blue-500/30'
                : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
            }`}
            style={{ backgroundColor: theme.ui['--color-bg-surface'] }}
          >
            <div
              className="rounded-lg p-2 mb-2 flex flex-wrap gap-1"
              style={{ backgroundColor: theme.terminal.background }}
            >
              {[
                theme.terminal.red, theme.terminal.green, theme.terminal.yellow,
                theme.terminal.blue, theme.terminal.magenta, theme.terminal.cyan,
              ].map((color, i) => (
                <div
                  key={i}
                  className="w-4 h-4 rounded-sm"
                  style={{ backgroundColor: color as string }}
                />
              ))}
              <div className="w-full mt-1">
                <div className="h-1.5 rounded-full w-3/4" style={{ backgroundColor: theme.terminal.foreground as string, opacity: 0.6 }} />
                <div className="h-1.5 rounded-full w-1/2 mt-1" style={{ backgroundColor: theme.terminal.foreground as string, opacity: 0.4 }} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="text-sm font-medium"
                style={{ color: theme.ui['--color-text-primary'] }}
              >
                {theme.name}
              </span>
              {selected && (
                <svg className="w-4 h-4 text-blue-500 shrink-0 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-medium text-t-secondary mb-3">暗色主题</h3>
        {renderGrid(darkThemes)}
      </div>
      <div>
        <h3 className="text-sm font-medium text-t-secondary mb-3">亮色主题</h3>
        {renderGrid(lightThemes)}
      </div>
    </div>
  )
}
