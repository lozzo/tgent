import { storage } from './storage'

export type KeyboardMode = 'auto' | 'resize' | 'shift'
export type RendererMode = 'auto' | 'webgl' | 'canvas'

export interface TerminalSettings {
  fontSize: number
  fontFamily: string
  scrollback: number
  cursorBlink: boolean
  haptic: boolean
  keyboardMode: KeyboardMode
  renderer: RendererMode
}

const STORAGE_KEY = 'tgent_terminal_settings'

const defaults: TerminalSettings = {
  fontSize: 14,
  fontFamily: '"JetBrainsMono NF", monospace',
  scrollback: 5000,
  cursorBlink: true,
  haptic: true,
  keyboardMode: 'auto',
  renderer: 'auto',
}

export async function loadTerminalSettings(): Promise<TerminalSettings> {
  try {
    const raw = await storage.get(STORAGE_KEY)
    if (!raw) return { ...defaults }
    const parsed = JSON.parse(raw)
    return {
      fontSize: typeof parsed.fontSize === 'number' ? parsed.fontSize : defaults.fontSize,
      fontFamily: typeof parsed.fontFamily === 'string' ? parsed.fontFamily : defaults.fontFamily,
      scrollback: typeof parsed.scrollback === 'number' ? parsed.scrollback : defaults.scrollback,
      cursorBlink: typeof parsed.cursorBlink === 'boolean' ? parsed.cursorBlink : defaults.cursorBlink,
      haptic: typeof parsed.haptic === 'boolean' ? parsed.haptic : defaults.haptic,
      keyboardMode: ['auto', 'resize', 'shift'].includes(parsed.keyboardMode) ? parsed.keyboardMode : defaults.keyboardMode,
      renderer: ['auto', 'webgl', 'canvas'].includes(parsed.renderer) ? parsed.renderer : defaults.renderer,
    }
  } catch {
    return { ...defaults }
  }
}

export async function saveTerminalSettings(settings: TerminalSettings): Promise<void> {
  try {
    await storage.set(STORAGE_KEY, JSON.stringify(settings))
    window.dispatchEvent(new CustomEvent<TerminalSettings>('tgent-terminal-settings-change', { detail: settings }))
  } catch {}
}

export function getDefaultTerminalSettings(): TerminalSettings {
  return { ...defaults }
}

export const FONT_OPTIONS = [
  // —— 内嵌 Nerd Font（移动端可用） ——
  { label: 'JetBrains Mono NF', value: '"JetBrainsMono NF", monospace' },
  { label: 'FiraCode NF', value: '"FiraCode NF", monospace' },
  { label: 'Cascadia Code NF', value: '"CascadiaCode NF", monospace' },
  { label: 'Hack NF', value: '"Hack NF", monospace' },
  { label: 'Iosevka NF', value: '"Iosevka NF", monospace' },
  // —— 系统字体回退 ——
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Menlo', value: 'Menlo, Monaco, "Courier New", monospace' },
]
