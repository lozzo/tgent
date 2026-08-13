import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { SYSTEM_PRESET, type FnGroup, type FnPreset } from '../lib/fnPresets'
import { loadFnConfig, getEffectivePreset, matchProgram, isBuiltinPreset } from '../lib/fnConfig'
import { haptic } from '../lib/platform'

type TabId = 'program' | 'custom' | 'system'

interface FnPanelProps {
  open: boolean
  onClose: () => void
  onSend: (data: string) => void
  paneCommand?: string
}

export default function FnPanel({ open, onClose, onSend, paneCommand }: FnPanelProps) {
  const navigate = useNavigate()
  const [programPreset, setProgramPreset] = useState<FnPreset | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('system')
  const [groups, setGroups] = useState<FnGroup[]>(SYSTEM_PRESET.groups)

  // paneCommand 变化时，匹配程序预设
  useEffect(() => {
    matchProgram(paneCommand).then(preset => {
      setProgramPreset(preset)
      setActiveTab(preset ? 'program' : 'system')
    })
  }, [paneCommand])

  // 当前 tab 变化时，加载对应内容
  useEffect(() => {
    ;(async () => {
      if (activeTab === 'program' && programPreset) {
        if (isBuiltinPreset(programPreset.id)) {
          setGroups(await getEffectivePreset(programPreset.id))
        } else {
          setGroups(programPreset.groups)
        }
      } else if (activeTab === 'custom') {
        const fnConfig = await loadFnConfig()
        if (fnConfig.customItems.length > 0) {
          setGroups([{ name: '自定义', items: fnConfig.customItems }])
        } else {
          setGroups([])
        }
      } else if (activeTab === 'system') {
        setGroups(SYSTEM_PRESET.groups)
      }
    })()
  }, [activeTab, programPreset])

  const handleSend = useCallback((data: string) => {
    haptic()
    onSend(data)
  }, [onSend])

  // 构建 tab 列表
  const tabs: { id: TabId; label: string }[] = []
  if (programPreset) {
    tabs.push({ id: 'program', label: programPreset.name })
  }
  tabs.push({ id: 'custom', label: '自定义' })
  tabs.push({ id: 'system', label: '系统' })

  const currentTab = tabs.some(t => t.id === activeTab) ? activeTab : tabs[0].id

  return (
    <>
      {/* 面板 */}
      <div
        data-fn-panel
        className="absolute left-0 right-0 z-20 bg-surface border-b border-t-border shadow-lg transition-all duration-200 ease-out overflow-hidden safe-x"
        style={{
          maxHeight: open ? '70vh' : '0',
          opacity: open ? 1 : 0,
        }}
      >
        <div className="px-3 py-2 overflow-y-auto" style={{ maxHeight: '70vh' }}>
          {/* Tab 栏 */}
          <div className="flex gap-1 mb-2 items-center">
            {tabs.map(t => (
              <button
                key={t.id}
                onMouseDown={e => e.preventDefault()}
                onClick={() => { haptic(); setActiveTab(t.id) }}
                className={`px-3 py-1 rounded text-xs select-none touch-manipulation ${
                  currentTab === t.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-elevated text-t-secondary active:opacity-70'
                }`}
              >
                {t.label}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => { haptic(); onClose(); navigate('/settings?tab=shortcuts') }}
              className="w-7 h-7 flex items-center justify-center rounded text-t-secondary active:bg-elevated active:text-t-primary select-none touch-manipulation"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>

          {/* 内容 */}
          {currentTab === 'custom' && groups.length === 0 ? (
            <div className="text-xs text-t-muted py-4 text-center">
              暂无自定义快捷键，点击 <span className="inline-block align-middle"><svg className="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg></span> 添加
            </div>
          ) : (
            groups.map(group => (
              <div key={group.name} className="mb-2">
                <div className="text-[10px] text-t-muted font-medium mb-1 uppercase tracking-wider">
                  {group.name}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {group.items.map(item => (
                    <button
                      key={item.label}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => handleSend(item.data)}
                      className="px-2 py-2 rounded text-xs font-mono bg-elevated text-t-primary active:opacity-70 select-none touch-manipulation text-left"
                    >
                      <div className="text-blue-400 truncate">{item.label}</div>
                      {item.desc && (
                        <div className="text-t-muted text-[10px] truncate">{item.desc}</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 遮罩层 */}
      {open && (
        <div
          className="absolute left-0 right-0 bottom-0 z-10"
          style={{ top: 0, backgroundColor: 'var(--color-bg-overlay)' }}
          onPointerDown={(e) => { e.preventDefault(); onClose() }}
        />
      )}
    </>
  )
}
