import { PROGRAM_PRESETS, type FnItem, type FnGroup, type FnPreset } from './fnPresets'
import { storage } from './storage'
import { webApi } from '../api/client'
import { AuthManager } from '../state/AuthManager'

const STORAGE_KEY = 'tgent_fn_config'

// 用户自定义的程序预设
export interface CustomProgram {
  id: string       // 唯一 ID
  name: string     // 显示名称
  match: string[]  // pane_command 匹配模式
  items: FnItem[]  // 快捷键列表
}

export interface FnConfig {
  // 全局自定义快捷键
  customItems: FnItem[]
  // 内置程序预设覆盖
  programOverrides: {
    [presetId: string]: {
      hiddenLabels: string[]   // 要隐藏的默认项 label
      addedItems: FnItem[]     // 用户新增的项
    }
  }
  // 用户自定义的程序预设
  customPrograms: CustomProgram[]
}

function defaultConfig(): FnConfig {
  return { customItems: [], programOverrides: {}, customPrograms: [] }
}

function parseConfig(parsed: any): FnConfig {
  return {
    customItems: Array.isArray(parsed.customItems) ? parsed.customItems : [],
    programOverrides: parsed.programOverrides && typeof parsed.programOverrides === 'object'
      ? parsed.programOverrides
      : {},
    customPrograms: Array.isArray(parsed.customPrograms) ? parsed.customPrograms : [],
  }
}

function isEmptyConfig(config: FnConfig): boolean {
  return config.customItems.length === 0
    && Object.keys(config.programOverrides).length === 0
    && config.customPrograms.length === 0
}

export async function loadFnConfig(): Promise<FnConfig> {
  // 已登录时优先从远程拉取
  const loggedIn = await AuthManager.getInstance().checkLoggedIn()
  if (loggedIn) {
    try {
      const result = await webApi.getFnConfig()
      const remote = parseConfig(result.config)

      // 首次同步：远程为空且本地有数据时，上传本地数据
      if (isEmptyConfig(remote)) {
        const localRaw = await storage.get(STORAGE_KEY)
        if (localRaw) {
          const local = parseConfig(JSON.parse(localRaw))
          if (!isEmptyConfig(local)) {
            webApi.saveFnConfig(local).catch(() => {})
            return local
          }
        }
      }

      // 缓存到本地
      await storage.set(STORAGE_KEY, JSON.stringify(remote))
      return remote
    } catch {
      // 远程失败，降级本地
    }
  }

  try {
    const raw = await storage.get(STORAGE_KEY)
    if (!raw) return defaultConfig()
    return parseConfig(JSON.parse(raw))
  } catch {
    return defaultConfig()
  }
}

export async function saveFnConfig(config: FnConfig): Promise<void> {
  await storage.set(STORAGE_KEY, JSON.stringify(config))

  // 已登录时异步同步到远程
  const loggedIn = await AuthManager.getInstance().checkLoggedIn()
  if (loggedIn) {
    webApi.saveFnConfig(config).catch(() => {})
  }
}

// 合并内置预设 + 用户覆盖，返回最终分组
export async function getEffectivePreset(presetId: string): Promise<FnGroup[]> {
  const preset = PROGRAM_PRESETS.find(p => p.id === presetId)
  if (!preset) return []

  const config = await loadFnConfig()
  const override = config.programOverrides[presetId]
  if (!override) return preset.groups

  const hiddenSet = new Set(override.hiddenLabels)

  // 过滤隐藏项
  const filtered = preset.groups.map(g => ({
    ...g,
    items: g.items.filter(item => !hiddenSet.has(item.label)),
  })).filter(g => g.items.length > 0)

  // 追加用户新增项
  if (override.addedItems.length > 0) {
    filtered.push({
      name: '自定义',
      items: override.addedItems,
    })
  }

  return filtered
}

// 删除指定内置程序的覆盖，恢复默认
export async function resetPresetOverride(presetId: string): Promise<void> {
  const config = await loadFnConfig()
  delete config.programOverrides[presetId]
  await saveFnConfig(config)
}

// 匹配程序预设（内置 + 自定义），返回 FnPreset 兼容对象
export async function matchProgram(paneCommand: string | undefined): Promise<FnPreset | null> {
  if (!paneCommand) return null
  const cmd = paneCommand.toLowerCase()

  // 先匹配内置预设
  for (const preset of PROGRAM_PRESETS) {
    if (preset.match.some(m => cmd.includes(m))) {
      return preset
    }
  }

  // 再匹配自定义程序
  const config = await loadFnConfig()
  for (const cp of config.customPrograms) {
    if (cp.match.some(m => cmd.includes(m.toLowerCase()))) {
      return {
        id: cp.id,
        name: cp.name,
        match: cp.match,
        groups: cp.items.length > 0 ? [{ name: '快捷键', items: cp.items }] : [],
      }
    }
  }

  return null
}

// 判断一个 presetId 是否是内置预设
export function isBuiltinPreset(presetId: string): boolean {
  return PROGRAM_PRESETS.some(p => p.id === presetId)
}
