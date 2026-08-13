import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PROGRAM_PRESETS, type FnItem } from '../lib/fnPresets'
import { haptic } from '../lib/platform'
import {
  loadFnConfig, saveFnConfig, resetPresetOverride, isBuiltinPreset,
  type FnConfig, type CustomProgram,
} from '../lib/fnConfig'

type SettingsTab = 'custom' | string  // 'custom' 或 presetId

// 转义显示：将不可见字符转为可读形式
function escapeForDisplay(s: string): string {
  return s
    .replace(/\x1b/g, '\\x1b')
    .replace(/[\x00-\x1f]/g, c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'))
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

// 解析用户输入：将 \n \x03 等转回真实字符
function unescapeInput(s: string): string {
  return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
}

interface EditingItem {
  label: string
  data: string
  desc: string
}

const emptyItem: EditingItem = { label: '', data: '', desc: '' }

/** 快捷键设置的纯内容组件（无 header），可在 Settings 页面中复用 */
export function FnSettingsContent() {
  const [config, setConfig] = useState<FnConfig>({ customItems: [], programOverrides: {}, customPrograms: [] })
  const [activeTab, setActiveTab] = useState<SettingsTab>('custom')
  const [editing, setEditing] = useState<{ index: number } | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<EditingItem>(emptyItem)
  // 新建程序表单
  const [addingProgram, setAddingProgram] = useState(false)
  const [programForm, setProgramForm] = useState({ name: '', match: '' })
  // 编辑程序信息
  const [editingProgramInfo, setEditingProgramInfo] = useState(false)

  useEffect(() => {
    loadFnConfig().then(setConfig)
  }, [])

  const save = useCallback((next: FnConfig) => {
    setConfig(next)
    saveFnConfig(next)
  }, [])

  const clearEditState = () => {
    setEditing(null)
    setAdding(false)
    setForm(emptyItem)
  }

  // ——— 全局自定义 tab ———
  const handleAddCustom = () => {
    setEditing(null)
    setForm(emptyItem)
    setAdding(true)
  }

  const handleEditCustom = (index: number) => {
    const item = config.customItems[index]
    setForm({ label: item.label, data: escapeForDisplay(item.data), desc: item.desc || '' })
    setEditing({ index })
    setAdding(false)
  }

  const handleDeleteCustom = (index: number) => {
    const next = { ...config, customItems: config.customItems.filter((_, i) => i !== index) }
    save(next)
    if (editing?.index === index) clearEditState()
  }

  const handleSaveCustom = () => {
    const label = form.label.trim()
    const data = unescapeInput(form.data)
    if (!label || !data) return
    const item: FnItem = { label, data, ...(form.desc.trim() ? { desc: form.desc.trim() } : {}) }
    let items: FnItem[]
    if (editing !== null) {
      items = [...config.customItems]
      items[editing.index] = item
    } else {
      items = [...config.customItems, item]
    }
    save({ ...config, customItems: items })
    clearEditState()
  }

  // ——— 内置程序预设 tab ———
  const getOverride = (presetId: string) =>
    config.programOverrides[presetId] || { hiddenLabels: [], addedItems: [] }

  const togglePresetItem = (presetId: string, label: string, visible: boolean) => {
    const ov = getOverride(presetId)
    const hiddenLabels = visible
      ? ov.hiddenLabels.filter(l => l !== label)
      : [...ov.hiddenLabels, label]
    save({
      ...config,
      programOverrides: {
        ...config.programOverrides,
        [presetId]: { ...ov, hiddenLabels },
      },
    })
  }

  const handleAddPresetItem = () => {
    setEditing(null)
    setForm(emptyItem)
    setAdding(true)
  }

  const handleEditPresetItem = (presetId: string, index: number) => {
    const ov = getOverride(presetId)
    const item = ov.addedItems[index]
    setForm({ label: item.label, data: escapeForDisplay(item.data), desc: item.desc || '' })
    setEditing({ index })
    setAdding(false)
  }

  const handleDeletePresetItem = (presetId: string, index: number) => {
    const ov = getOverride(presetId)
    save({
      ...config,
      programOverrides: {
        ...config.programOverrides,
        [presetId]: { ...ov, addedItems: ov.addedItems.filter((_, i) => i !== index) },
      },
    })
    if (editing?.index === index) clearEditState()
  }

  const handleSavePresetItem = (presetId: string) => {
    const label = form.label.trim()
    const data = unescapeInput(form.data)
    if (!label || !data) return
    const item: FnItem = { label, data, ...(form.desc.trim() ? { desc: form.desc.trim() } : {}) }
    const ov = getOverride(presetId)
    let addedItems: FnItem[]
    if (editing !== null) {
      addedItems = [...ov.addedItems]
      addedItems[editing.index] = item
    } else {
      addedItems = [...ov.addedItems, item]
    }
    save({
      ...config,
      programOverrides: {
        ...config.programOverrides,
        [presetId]: { ...ov, addedItems },
      },
    })
    clearEditState()
  }

  const handleResetPreset = async (presetId: string) => {
    await resetPresetOverride(presetId)
    setConfig(await loadFnConfig())
    clearEditState()
  }

  // ——— 自定义程序 ———
  const handleCreateProgram = () => {
    const name = programForm.name.trim()
    const match = programForm.match.trim()
    if (!name || !match) return
    const cp: CustomProgram = {
      id: 'cp_' + Date.now(),
      name,
      match: match.split(',').map(s => s.trim()).filter(Boolean),
      items: [],
    }
    const next = { ...config, customPrograms: [...config.customPrograms, cp] }
    save(next)
    setAddingProgram(false)
    setProgramForm({ name: '', match: '' })
    setActiveTab(cp.id)
  }

  const handleDeleteProgram = (programId: string) => {
    const next = { ...config, customPrograms: config.customPrograms.filter(p => p.id !== programId) }
    save(next)
    setActiveTab('custom')
    clearEditState()
  }

  const findCustomProgram = (id: string) => config.customPrograms.find(p => p.id === id)

  const handleAddProgramItem = () => {
    setEditing(null)
    setForm(emptyItem)
    setAdding(true)
  }

  const handleEditProgramItem = (programId: string, index: number) => {
    const cp = findCustomProgram(programId)
    if (!cp) return
    const item = cp.items[index]
    setForm({ label: item.label, data: escapeForDisplay(item.data), desc: item.desc || '' })
    setEditing({ index })
    setAdding(false)
  }

  const handleDeleteProgramItem = (programId: string, index: number) => {
    const cp = findCustomProgram(programId)
    if (!cp) return
    const next = {
      ...config,
      customPrograms: config.customPrograms.map(p =>
        p.id === programId ? { ...p, items: p.items.filter((_, i) => i !== index) } : p
      ),
    }
    save(next)
    if (editing?.index === index) clearEditState()
  }

  const handleSaveProgramItem = (programId: string) => {
    const label = form.label.trim()
    const data = unescapeInput(form.data)
    if (!label || !data) return
    const item: FnItem = { label, data, ...(form.desc.trim() ? { desc: form.desc.trim() } : {}) }
    const cp = findCustomProgram(programId)
    if (!cp) return
    let items: FnItem[]
    if (editing !== null) {
      items = [...cp.items]
      items[editing.index] = item
    } else {
      items = [...cp.items, item]
    }
    save({
      ...config,
      customPrograms: config.customPrograms.map(p =>
        p.id === programId ? { ...p, items } : p
      ),
    })
    clearEditState()
  }

  const handleSaveProgramInfo = (programId: string) => {
    const name = programForm.name.trim()
    const match = programForm.match.trim()
    if (!name || !match) return
    save({
      ...config,
      customPrograms: config.customPrograms.map(p =>
        p.id === programId
          ? { ...p, name, match: match.split(',').map(s => s.trim()).filter(Boolean) }
          : p
      ),
    })
    setEditingProgramInfo(false)
  }

  // 切换 tab 时清除编辑状态
  const switchTab = (tab: SettingsTab) => {
    haptic()
    setActiveTab(tab)
    clearEditState()
    setEditingProgramInfo(false)
  }

  // ——— 通用渲染 ———
  const renderForm = (onSave: () => void) => (
    <div className="bg-surface rounded-lg p-3 mb-3 space-y-2">
      <input
        type="text"
        value={form.label}
        onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
        placeholder="标签名 (如 /clear)"
        className="w-full px-3 py-2 rounded bg-elevated border border-t-border-subtle text-t-primary text-sm placeholder-t-muted focus:outline-none focus:border-blue-500"
        autoFocus
      />
      <input
        type="text"
        value={form.data}
        onChange={e => setForm(f => ({ ...f, data: e.target.value }))}
        placeholder="发送数据 (如 /clear\n 或 \x03)"
        className="w-full px-3 py-2 rounded bg-elevated border border-t-border-subtle text-t-primary text-sm font-mono placeholder-t-muted focus:outline-none focus:border-blue-500"
      />
      <input
        type="text"
        value={form.desc}
        onChange={e => setForm(f => ({ ...f, desc: e.target.value }))}
        placeholder="描述 (可选)"
        className="w-full px-3 py-2 rounded bg-elevated border border-t-border-subtle text-t-primary text-sm placeholder-t-muted focus:outline-none focus:border-blue-500"
      />
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => { haptic(); onSave() }}
          disabled={!form.label.trim() || !form.data.trim()}
          className="px-4 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-40 active:bg-blue-700"
        >
          保存
        </button>
        <button
          onClick={() => { haptic(); clearEditState() }}
          className="px-4 py-1.5 rounded bg-elevated text-t-secondary text-sm active:opacity-70"
        >
          取消
        </button>
      </div>
    </div>
  )

  const renderItem = (item: FnItem, onEdit: () => void, onDelete: () => void) => (
    <div className="flex items-center justify-between bg-surface rounded-lg px-3 py-2 mb-1.5">
      <div className="min-w-0 flex-1" onClick={() => { haptic(); onEdit() }}>
        <div className="text-sm text-blue-400 font-mono truncate">{item.label}</div>
        {item.desc && <div className="text-xs text-t-muted truncate">{item.desc}</div>}
      </div>
      <button
        onClick={() => { haptic(); onDelete() }}
        className="ml-2 w-7 h-7 flex items-center justify-center rounded text-t-muted active:bg-red-900/50 active:text-red-400 shrink-0"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )

  // ——— 自定义 tab ———
  const renderCustomTab = () => (
    <div>
      {config.customItems.length === 0 && !adding && (
        <div className="text-xs text-t-muted py-6 text-center">
          暂无自定义快捷键，点击下方按钮添加
        </div>
      )}
      {config.customItems.map((item, i) =>
        editing?.index === i && !adding ? (
          <div key={i}>{renderForm(handleSaveCustom)}</div>
        ) : (
          <div key={i}>{renderItem(item, () => handleEditCustom(i), () => handleDeleteCustom(i))}</div>
        )
      )}
      {adding && renderForm(handleSaveCustom)}
      {!adding && editing === null && (
        <button
          onClick={() => { haptic(); handleAddCustom() }}
          className="w-full py-2.5 rounded-lg border border-dashed border-t-border text-t-secondary text-sm active:bg-surface mt-2"
        >
          + 添加快捷键
        </button>
      )}
    </div>
  )

  // ——— 内置预设 tab ———
  const renderBuiltinPresetTab = (presetId: string) => {
    const preset = PROGRAM_PRESETS.find(p => p.id === presetId)
    if (!preset) return null
    const ov = getOverride(presetId)
    const hiddenSet = new Set(ov.hiddenLabels)

    return (
      <div>
        <div className="text-xs text-t-muted font-medium mb-2 uppercase tracking-wider">默认快捷键</div>
        {preset.groups.map(group => (
          <div key={group.name} className="mb-3">
            <div className="text-[10px] text-t-muted mb-1">{group.name}</div>
            {group.items.map(item => (
              <div key={item.label} className="flex items-center justify-between bg-surface rounded-lg px-3 py-2 mb-1">
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-mono truncate ${hiddenSet.has(item.label) ? 'text-t-muted line-through' : 'text-blue-400'}`}>
                    {item.label}
                  </div>
                  {item.desc && <div className="text-xs text-t-muted truncate">{item.desc}</div>}
                </div>
                <button
                  onClick={() => { haptic(); togglePresetItem(presetId, item.label, hiddenSet.has(item.label)) }}
                  className={`ml-2 w-10 h-6 rounded-full relative transition-colors ${
                    hiddenSet.has(item.label) ? 'bg-[var(--color-text-muted)]' : 'bg-blue-600'
                  }`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    hiddenSet.has(item.label) ? 'left-0.5' : 'left-[18px]'
                  }`} />
                </button>
              </div>
            ))}
          </div>
        ))}

        {/* 用户新增项 */}
        {ov.addedItems.length > 0 && (
          <>
            <div className="text-xs text-t-muted font-medium mb-2 uppercase tracking-wider mt-4">自定义新增</div>
            {ov.addedItems.map((item, i) =>
              editing?.index === i && !adding ? (
                <div key={i}>{renderForm(() => handleSavePresetItem(presetId))}</div>
              ) : (
                <div key={i}>{renderItem(
                  item,
                  () => handleEditPresetItem(presetId, i),
                  () => handleDeletePresetItem(presetId, i),
                )}</div>
              )
            )}
          </>
        )}

        {adding && renderForm(() => handleSavePresetItem(presetId))}

        <div className="flex gap-2 mt-3">
          {!adding && editing === null && (
            <button
              onClick={() => { haptic(); handleAddPresetItem() }}
              className="flex-1 py-2.5 rounded-lg border border-dashed border-t-border text-t-secondary text-sm active:bg-surface"
            >
              + 添加快捷键
            </button>
          )}
          {(ov.hiddenLabels.length > 0 || ov.addedItems.length > 0) && !adding && editing === null && (
            <button
              onClick={() => { haptic(); handleResetPreset(presetId) }}
              className="px-4 py-2.5 rounded-lg bg-surface text-orange-400 text-sm active:opacity-70"
            >
              重置为默认
            </button>
          )}
        </div>
      </div>
    )
  }

  // ——— 自定义程序 tab ———
  const renderCustomProgramTab = (programId: string) => {
    const cp = findCustomProgram(programId)
    if (!cp) return null

    return (
      <div>
        {/* 程序信息 */}
        {editingProgramInfo ? (
          <div className="bg-surface rounded-lg p-3 mb-3 space-y-2">
            <input
              type="text"
              value={programForm.name}
              onChange={e => setProgramForm(f => ({ ...f, name: e.target.value }))}
              placeholder="程序名称"
              className="w-full px-3 py-2 rounded bg-elevated border border-t-border-subtle text-t-primary text-sm placeholder-t-muted focus:outline-none focus:border-blue-500"
              autoFocus
            />
            <input
              type="text"
              value={programForm.match}
              onChange={e => setProgramForm(f => ({ ...f, match: e.target.value }))}
              placeholder="匹配关键词 (逗号分隔，如 vim,nvim)"
              className="w-full px-3 py-2 rounded bg-elevated border border-t-border-subtle text-t-primary text-sm font-mono placeholder-t-muted focus:outline-none focus:border-blue-500"
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { haptic(); handleSaveProgramInfo(programId) }}
                disabled={!programForm.name.trim() || !programForm.match.trim()}
                className="px-4 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-40 active:bg-blue-700"
              >
                保存
              </button>
              <button
                onClick={() => { haptic(); setEditingProgramInfo(false) }}
                className="px-4 py-1.5 rounded bg-elevated text-t-secondary text-sm active:opacity-70"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <div
            className="bg-surface rounded-lg px-3 py-2 mb-3 flex items-center justify-between"
            onClick={() => {
              setProgramForm({ name: cp.name, match: cp.match.join(', ') })
              setEditingProgramInfo(true)
            }}
          >
            <div>
              <div className="text-sm text-t-primary">{cp.name}</div>
              <div className="text-xs text-t-muted font-mono">匹配: {cp.match.join(', ')}</div>
            </div>
            <svg className="w-4 h-4 text-t-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
            </svg>
          </div>
        )}

        {/* 快捷键列表 */}
        <div className="text-xs text-t-muted font-medium mb-2 uppercase tracking-wider">快捷键</div>
        {cp.items.length === 0 && !adding && (
          <div className="text-xs text-t-muted py-4 text-center">
            暂无快捷键，点击下方按钮添加
          </div>
        )}
        {cp.items.map((item, i) =>
          editing?.index === i && !adding ? (
            <div key={i}>{renderForm(() => handleSaveProgramItem(programId))}</div>
          ) : (
            <div key={i}>{renderItem(
              item,
              () => handleEditProgramItem(programId, i),
              () => handleDeleteProgramItem(programId, i),
            )}</div>
          )
        )}

        {adding && renderForm(() => handleSaveProgramItem(programId))}

        <div className="flex gap-2 mt-3">
          {!adding && editing === null && (
            <button
              onClick={() => { haptic(); handleAddProgramItem() }}
              className="flex-1 py-2.5 rounded-lg border border-dashed border-t-border text-t-secondary text-sm active:bg-surface"
            >
              + 添加快捷键
            </button>
          )}
          {!adding && editing === null && (
            <button
              onClick={() => { haptic(); handleDeleteProgram(programId) }}
              className="px-4 py-2.5 rounded-lg bg-surface text-red-400 text-sm active:opacity-70"
            >
              删除程序
            </button>
          )}
        </div>
      </div>
    )
  }

  // tab 列表
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'custom', label: '全局自定义' },
    ...PROGRAM_PRESETS.map(p => ({ id: p.id, label: p.name })),
    ...config.customPrograms.map(p => ({ id: p.id, label: p.name })),
  ]

  // 渲染当前 tab 内容
  const renderTabContent = () => {
    if (activeTab === 'custom') return renderCustomTab()
    if (isBuiltinPreset(activeTab)) return renderBuiltinPresetTab(activeTab)
    if (findCustomProgram(activeTab)) return renderCustomProgramTab(activeTab)
    return null
  }

  if (!config) return <div className="text-center py-10 text-t-muted text-sm">加载中...</div>

  return (
    <div className="flex flex-col h-full">
      {/* Tab 栏 */}
      <div className="shrink-0 flex gap-1 px-1 py-2 overflow-x-auto items-center">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className={`px-3 py-1.5 rounded text-xs whitespace-nowrap select-none shrink-0 ${
              activeTab === t.id
                ? 'bg-blue-600 text-white'
                : 'bg-surface text-t-secondary active:bg-elevated'
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => { haptic(); setAddingProgram(true); setProgramForm({ name: '', match: '' }) }}
          className="w-7 h-7 flex items-center justify-center rounded bg-surface text-t-secondary active:bg-elevated active:text-t-primary shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>

      {/* 内容（可滚动） */}
      <div className="flex-1 min-h-0 overflow-y-auto px-1 py-2 pb-6">
        {/* 新建程序表单 */}
        {addingProgram && (
          <div className="bg-surface rounded-lg p-3 mb-3 space-y-2">
            <div className="text-xs text-t-secondary font-medium mb-1">新建程序预设</div>
            <input
              type="text"
              value={programForm.name}
              onChange={e => setProgramForm(f => ({ ...f, name: e.target.value }))}
              placeholder="程序名称 (如 Vim)"
              className="w-full px-3 py-2 rounded bg-elevated border border-t-border-subtle text-t-primary text-sm placeholder-t-muted focus:outline-none focus:border-blue-500"
              autoFocus
            />
            <input
              type="text"
              value={programForm.match}
              onChange={e => setProgramForm(f => ({ ...f, match: e.target.value }))}
              placeholder="匹配关键词 (逗号分隔，如 vim,nvim)"
              className="w-full px-3 py-2 rounded bg-elevated border border-t-border-subtle text-t-primary text-sm font-mono placeholder-t-muted focus:outline-none focus:border-blue-500"
            />
            <div className="text-[10px] text-t-muted">当终端进程名包含关键词时自动匹配</div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { haptic(); handleCreateProgram() }}
                disabled={!programForm.name.trim() || !programForm.match.trim()}
                className="px-4 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-40 active:bg-blue-700"
              >
                创建
              </button>
              <button
                onClick={() => { haptic(); setAddingProgram(false) }}
                className="px-4 py-1.5 rounded bg-elevated text-t-secondary text-sm active:opacity-70"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {renderTabContent()}
      </div>
    </div>
  )
}

/** 独立页面壳（带 header），保留为独立路由 */
export default function FnSettings() {
  const navigate = useNavigate()

  return (
    <div className="fixed inset-0 flex flex-col bg-page safe-top safe-x safe-bottom">
      {/* 顶栏 */}
      <div className="shrink-0 flex items-center gap-2 px-2 py-2 bg-surface border-b border-t-border">
        <button
          onClick={() => { haptic(); navigate(-1) }}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-t-secondary active:bg-[var(--color-border-subtle)] active:text-t-primary shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className="text-base font-medium text-t-primary">快捷键设置</h1>
      </div>

      <div className="flex-1 min-h-0 px-3">
        <FnSettingsContent />
      </div>
    </div>
  )
}
