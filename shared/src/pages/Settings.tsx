import { useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FnSettingsContent } from './FnSettings'
import { useAppBack } from '../hooks/useAppBack'
import { haptic } from '../lib/platform'
import AppearanceTab from '../components/settings/AppearanceTab'
import TerminalTab from '../components/settings/TerminalTab'
import SystemTab from '../components/settings/SystemTab'

type SettingsTab = 'main' | 'appearance' | 'terminal' | 'shortcuts' | 'system'

interface MenuItem {
  id: SettingsTab
  label: string
  desc: string
  icon: React.ReactNode
}

const PaletteIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 0 0 5.304 0l6.401-6.402M6.75 21A3.75 3.75 0 0 1 3 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 0 0 3.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008Z" />
  </svg>
)

const TerminalIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z" />
  </svg>
)

const KeyboardIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
  </svg>
)

const SystemIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.248a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.248a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
  </svg>
)

const ChevronRight = () => (
  <svg className="w-4 h-4 text-t-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
)

export default function Settings() {
  const [searchParams] = useSearchParams()
  const initialTab = (['appearance', 'terminal', 'shortcuts', 'system'] as const).includes(
    searchParams.get('tab') as any
  ) ? searchParams.get('tab') as SettingsTab : 'main'
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)

  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab

  const goBack = useAppBack('/', {
    onBack: () => {
      if (activeTabRef.current !== 'main') {
        setActiveTab('main')
        return true
      }
      return false
    }
  })

  const menuItems: MenuItem[] = [
    { id: 'appearance', label: '外观', desc: '主题和配色方案', icon: <PaletteIcon /> },
    { id: 'terminal', label: '终端', desc: '字体、缓冲区和光标', icon: <TerminalIcon /> },
    { id: 'shortcuts', label: '快捷键', desc: '功能键和快捷操作', icon: <KeyboardIcon /> },
    { id: 'system' as SettingsTab, label: '账号与系统', desc: '登录、版本更新和后台保活', icon: <SystemIcon /> },
  ]

  const tabLabels: Record<string, string> = {
    appearance: '外观',
    terminal: '终端',
    shortcuts: '快捷键',
    system: '账号与系统',
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'appearance': return <AppearanceTab />
      case 'terminal': return <TerminalTab />
      case 'shortcuts': return <FnSettingsContent />
      case 'system': return <SystemTab />
      default: return null
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-page safe-top safe-x safe-bottom">
      <div className="shrink-0 flex items-center gap-2 px-2 py-2 bg-surface border-b border-t-border">
        <button
          onClick={() => { haptic(); goBack() }}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-t-secondary active:bg-[var(--color-border-subtle)] active:text-t-primary shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className="text-base font-medium text-t-primary">
          {activeTab === 'main' ? '设置' : tabLabels[activeTab]}
        </h1>
      </div>

      {activeTab === 'main' ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="py-2">
            {menuItems.map((item, idx) => (
              <button
                key={item.id}
                onClick={() => { haptic(); setActiveTab(item.id) }}
                className={`w-full flex items-center gap-4 px-4 py-3.5 active:bg-elevated transition-colors ${
                  idx < menuItems.length - 1 ? '' : ''
                }`}
              >
                <div className="w-9 h-9 rounded-xl bg-elevated flex items-center justify-center text-t-secondary shrink-0">
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-sm font-medium text-t-primary">{item.label}</div>
                  <div className="text-xs text-t-muted mt-0.5">{item.desc}</div>
                </div>
                <ChevronRight />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 pb-8">
          {renderContent()}
        </div>
      )}
    </div>
  )
}
