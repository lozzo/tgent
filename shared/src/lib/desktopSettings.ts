import { storage } from './storage'

export type DesktopShortcutAction =
  | 'openSettings'
  | 'terminalPicker'
  | 'newTab'
  | 'closeView'
  | 'closeTab'
  | 'previousTab'
  | 'nextTab'
  | 'selectTab1'
  | 'selectTab2'
  | 'selectTab3'
  | 'selectTab4'
  | 'selectTab5'
  | 'selectTab6'
  | 'selectTab7'
  | 'selectTab8'
  | 'selectTab9'
  | 'splitRight'
  | 'splitBelow'
  | 'toggleMaximize'
  | 'previousPane'
  | 'nextPane'
  | 'focusPaneLeft'
  | 'focusPaneRight'
  | 'focusPaneUp'
  | 'focusPaneDown'
  | 'terminalSearch'
  | 'findNext'
  | 'findPrevious'
  | 'fontIncrease'
  | 'fontDecrease'
  | 'fontReset'
  | 'reconnectTerminal'
  | 'clearScrollback'
  | 'takeSizeControl'
  | 'renameTerminal'
  | 'renameWindow'
  | 'renameSession'
  | 'killTerminal'
  | 'killWindow'
  | 'killSession'
  | 'toggleFiles'
  | 'refreshFiles'
  | 'newFolder'
  | 'uploadFile'
  | 'downloadFile'
  | 'copyFile'
  | 'cutFile'
  | 'pasteFile'
  | 'renameFile'
  | 'deleteFile'
  | 'toggleTopology'
  | 'topologyCreate'
  | 'topologyRename'
  | 'topologyDelete'
  | 'topologyRefresh'
  | 'broadcastInput'
  | 'hideWindow'

export type DesktopShortcutGroup = 'General' | 'Tabs' | 'Panels' | 'Terminal' | 'Files' | 'Topology'

export type DesktopChromeTone = 'obsidian' | 'graphite' | 'midnight' | 'evergreen'
export type DesktopBackgroundFit = 'cover' | 'contain'

export interface DesktopAppearanceSettings {
  chromeTone: DesktopChromeTone
  accent: string
  windowOpacity: number
  backgroundImageEnabled: boolean
  backgroundImageOpacity: number
  backgroundImageFit: DesktopBackgroundFit
}

export interface DesktopQuakeSettings {
  enabled: boolean
  shortcut: string
  heightRatio: number
  alwaysOnTop: boolean
}

export type DesktopShortcutSettings = Record<DesktopShortcutAction, string>

export interface DesktopSettings {
  appearance: DesktopAppearanceSettings
  quake: DesktopQuakeSettings
  shortcuts: DesktopShortcutSettings
}

export const DESKTOP_SHORTCUTS: Array<{
  action: DesktopShortcutAction
  group: DesktopShortcutGroup
  label: string
  description: string
}> = [
  { action: 'openSettings', group: 'General', label: 'Open settings', description: 'Open the desktop settings center' },
  { action: 'terminalPicker', group: 'General', label: 'Terminal picker', description: 'Replace the active view with another terminal' },
  { action: 'broadcastInput', group: 'General', label: 'Broadcast input', description: 'Choose terminals that receive synchronized input' },
  { action: 'hideWindow', group: 'General', label: 'Hide window', description: 'Hide TGent while keeping Quake Mode available' },
  { action: 'newTab', group: 'Tabs', label: 'New tab', description: 'Create a local tab and open Terminal Picker' },
  { action: 'closeTab', group: 'Tabs', label: 'Close tab', description: 'Close the active tab without ending its tmux terminals' },
  { action: 'previousTab', group: 'Tabs', label: 'Previous tab', description: 'Activate the tab to the left' },
  { action: 'nextTab', group: 'Tabs', label: 'Next tab', description: 'Activate the tab to the right' },
  ...Array.from({ length: 9 }, (_, index) => ({
    action: `selectTab${index + 1}` as DesktopShortcutAction,
    group: 'Tabs' as const,
    label: `Select tab ${index + 1}`,
    description: `Activate tab ${index + 1}`,
  })),
  { action: 'closeView', group: 'Panels', label: 'Close panel view', description: 'Close the active desktop panel without ending its tmux terminal' },
  { action: 'splitRight', group: 'Panels', label: 'Split right', description: 'Create a tmux pane to the right' },
  { action: 'splitBelow', group: 'Panels', label: 'Split below', description: 'Create a tmux pane below' },
  { action: 'toggleMaximize', group: 'Panels', label: 'Maximize view', description: 'Toggle the active pane between focused and tiled' },
  { action: 'previousPane', group: 'Panels', label: 'Previous panel', description: 'Focus the previous panel in layout order' },
  { action: 'nextPane', group: 'Panels', label: 'Next panel', description: 'Focus the next panel in layout order' },
  { action: 'focusPaneLeft', group: 'Panels', label: 'Focus panel left', description: 'Focus the nearest panel to the left' },
  { action: 'focusPaneRight', group: 'Panels', label: 'Focus panel right', description: 'Focus the nearest panel to the right' },
  { action: 'focusPaneUp', group: 'Panels', label: 'Focus panel above', description: 'Focus the nearest panel above' },
  { action: 'focusPaneDown', group: 'Panels', label: 'Focus panel below', description: 'Focus the nearest panel below' },
  { action: 'terminalSearch', group: 'Terminal', label: 'Find in terminal', description: 'Open search for the active terminal buffer' },
  { action: 'findNext', group: 'Terminal', label: 'Find next', description: 'Move to the next terminal search match' },
  { action: 'findPrevious', group: 'Terminal', label: 'Find previous', description: 'Move to the previous terminal search match' },
  { action: 'fontIncrease', group: 'Terminal', label: 'Increase font size', description: 'Increase the font size for every terminal view' },
  { action: 'fontDecrease', group: 'Terminal', label: 'Decrease font size', description: 'Decrease the font size for every terminal view' },
  { action: 'fontReset', group: 'Terminal', label: 'Reset font size', description: 'Restore the default terminal font size' },
  { action: 'reconnectTerminal', group: 'Terminal', label: 'Reconnect terminal', description: 'Reconnect the active PTY stream and reload its snapshot' },
  { action: 'clearScrollback', group: 'Terminal', label: 'Clear scrollback', description: 'Clear the active local terminal buffer' },
  { action: 'takeSizeControl', group: 'Terminal', label: 'Take size control', description: 'Make this view the tmux pane size owner' },
  { action: 'renameTerminal', group: 'Terminal', label: 'Rename terminal', description: 'Rename the active tmux pane title' },
  { action: 'renameWindow', group: 'Terminal', label: 'Rename tmux window', description: 'Rename the window containing the active terminal' },
  { action: 'renameSession', group: 'Terminal', label: 'Rename tmux session', description: 'Rename the session containing the active terminal' },
  { action: 'killTerminal', group: 'Terminal', label: 'Kill terminal', description: 'Open confirmation to end the active tmux pane' },
  { action: 'killWindow', group: 'Terminal', label: 'Kill tmux window', description: 'Open confirmation to end the active tmux window' },
  { action: 'killSession', group: 'Terminal', label: 'Kill tmux session', description: 'Open confirmation to end the active tmux session' },
  { action: 'toggleFiles', group: 'Files', label: 'File browser', description: 'Show or hide files for the active endpoint' },
  { action: 'refreshFiles', group: 'Files', label: 'Refresh files', description: 'Reload the current file directory' },
  { action: 'newFolder', group: 'Files', label: 'New folder', description: 'Start creating a folder in the current directory' },
  { action: 'uploadFile', group: 'Files', label: 'Upload file', description: 'Open the native file picker for the current directory' },
  { action: 'downloadFile', group: 'Files', label: 'Download file', description: 'Download the selected remote file' },
  { action: 'copyFile', group: 'Files', label: 'Copy file', description: 'Copy the selected remote file or folder' },
  { action: 'cutFile', group: 'Files', label: 'Cut file', description: 'Move the selected item when it is pasted' },
  { action: 'pasteFile', group: 'Files', label: 'Paste file', description: 'Paste copied remote items into the current directory' },
  { action: 'renameFile', group: 'Files', label: 'Rename file', description: 'Rename the selected file or folder' },
  { action: 'deleteFile', group: 'Files', label: 'Delete file', description: 'Open confirmation for the selected file or folder' },
  { action: 'toggleTopology', group: 'Topology', label: 'Tmux topology', description: 'Open the session, window, and pane tree' },
  { action: 'topologyCreate', group: 'Topology', label: 'Create topology node', description: 'Create beneath the selected endpoint, session, or window' },
  { action: 'topologyRename', group: 'Topology', label: 'Rename topology node', description: 'Rename the selected session, window, or pane' },
  { action: 'topologyDelete', group: 'Topology', label: 'Delete topology node', description: 'Open confirmation for the selected tmux node' },
  { action: 'topologyRefresh', group: 'Topology', label: 'Refresh topology', description: 'Reload every available tmux hierarchy' },
]

const STORAGE_KEY = 'tgent_desktop_settings'

const defaults: DesktopSettings = {
  appearance: {
    chromeTone: 'obsidian',
    accent: '#78a9ff',
    windowOpacity: 1,
    backgroundImageEnabled: false,
    backgroundImageOpacity: 0.72,
    backgroundImageFit: 'cover',
  },
  quake: {
    enabled: true,
    shortcut: 'Control+`',
    heightRatio: 0.45,
    alwaysOnTop: true,
  },
  shortcuts: {
    openSettings: 'Mod+Comma',
    terminalPicker: 'Mod+P',
    newTab: 'Mod+T',
    closeView: 'Mod+W',
    closeTab: '',
    previousTab: 'Mod+Shift+[',
    nextTab: 'Mod+Shift+]',
    selectTab1: 'Mod+1',
    selectTab2: 'Mod+2',
    selectTab3: 'Mod+3',
    selectTab4: 'Mod+4',
    selectTab5: 'Mod+5',
    selectTab6: 'Mod+6',
    selectTab7: 'Mod+7',
    selectTab8: 'Mod+8',
    selectTab9: 'Mod+9',
    splitRight: 'Mod+D',
    splitBelow: 'Mod+Shift+D',
    toggleMaximize: 'Mod+Shift+Enter',
    previousPane: 'Mod+[',
    nextPane: 'Mod+]',
    focusPaneLeft: 'Mod+Alt+ArrowLeft',
    focusPaneRight: 'Mod+Alt+ArrowRight',
    focusPaneUp: 'Mod+Alt+ArrowUp',
    focusPaneDown: 'Mod+Alt+ArrowDown',
    terminalSearch: 'Mod+F',
    findNext: 'Mod+G',
    findPrevious: 'Mod+Shift+G',
    fontIncrease: 'Mod+Shift+=',
    fontDecrease: 'Mod+-',
    fontReset: 'Mod+0',
    reconnectTerminal: 'Mod+Shift+R',
    clearScrollback: 'Mod+K',
    takeSizeControl: '',
    renameTerminal: '',
    renameWindow: '',
    renameSession: '',
    killTerminal: '',
    killWindow: '',
    killSession: '',
    toggleFiles: 'Mod+Shift+E',
    refreshFiles: '',
    newFolder: '',
    uploadFile: '',
    downloadFile: '',
    copyFile: '',
    cutFile: '',
    pasteFile: '',
    renameFile: '',
    deleteFile: '',
    toggleTopology: 'Mod+Shift+O',
    topologyCreate: '',
    topologyRename: '',
    topologyDelete: '',
    topologyRefresh: '',
    broadcastInput: 'Mod+Shift+B',
    hideWindow: '',
  },
}

function isChromeTone(value: unknown): value is DesktopChromeTone {
  return value === 'obsidian' || value === 'graphite' || value === 'midnight' || value === 'evergreen'
}

function boundedRatio(value: unknown, fallback: number, minimum = 0, maximum = 1): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback
}

export function getDefaultDesktopSettings(): DesktopSettings {
  return {
    appearance: { ...defaults.appearance },
    quake: { ...defaults.quake },
    shortcuts: { ...defaults.shortcuts },
  }
}

function hydrateShortcutSettings(
  stored: Partial<DesktopShortcutSettings>,
  quakeShortcut: string,
): DesktopShortcutSettings {
  const result = {} as DesktopShortcutSettings
  const used = new Set<string>(quakeShortcut ? [quakeShortcut] : [])

  // Preserve explicit user choices first. New defaults never displace an
  // existing binding when settings from an older desktop build are loaded.
  DESKTOP_SHORTCUTS.forEach(({ action }) => {
    if (!Object.prototype.hasOwnProperty.call(stored, action) || typeof stored[action] !== 'string') return
    const shortcut = stored[action]!
    result[action] = shortcut && used.has(shortcut) ? '' : shortcut
    if (result[action]) used.add(result[action])
  })
  DESKTOP_SHORTCUTS.forEach(({ action }) => {
    if (Object.prototype.hasOwnProperty.call(result, action)) return
    const shortcut = defaults.shortcuts[action]
    result[action] = shortcut && used.has(shortcut) ? '' : shortcut
    if (result[action]) used.add(result[action])
  })
  return result
}

export async function loadDesktopSettings(): Promise<DesktopSettings> {
  try {
    const raw = await storage.get(STORAGE_KEY)
    if (!raw) return getDefaultDesktopSettings()
    const parsed = JSON.parse(raw) as Partial<DesktopSettings>
    const appearance = parsed.appearance ?? defaults.appearance
    const quake = parsed.quake ?? defaults.quake
    const shortcuts = parsed.shortcuts ?? defaults.shortcuts
    const heightRatio = typeof quake.heightRatio === 'number' && quake.heightRatio >= 0.3 && quake.heightRatio <= 0.9
      ? quake.heightRatio
      : defaults.quake.heightRatio
    const quakeShortcut = typeof quake.shortcut === 'string' && quake.shortcut ? quake.shortcut : defaults.quake.shortcut
    return {
      appearance: {
        chromeTone: isChromeTone(appearance.chromeTone) ? appearance.chromeTone : defaults.appearance.chromeTone,
        accent: typeof appearance.accent === 'string' && /^#[0-9a-f]{6}$/i.test(appearance.accent)
          ? appearance.accent
          : defaults.appearance.accent,
        windowOpacity: boundedRatio(appearance.windowOpacity, defaults.appearance.windowOpacity, 0.55),
        backgroundImageEnabled: typeof appearance.backgroundImageEnabled === 'boolean'
          ? appearance.backgroundImageEnabled
          : defaults.appearance.backgroundImageEnabled,
        backgroundImageOpacity: boundedRatio(appearance.backgroundImageOpacity, defaults.appearance.backgroundImageOpacity, 0.1),
        backgroundImageFit: appearance.backgroundImageFit === 'contain' ? 'contain' : defaults.appearance.backgroundImageFit,
      },
      quake: {
        enabled: typeof quake.enabled === 'boolean' ? quake.enabled : defaults.quake.enabled,
        shortcut: quakeShortcut,
        heightRatio,
        alwaysOnTop: typeof quake.alwaysOnTop === 'boolean' ? quake.alwaysOnTop : defaults.quake.alwaysOnTop,
      },
      shortcuts: hydrateShortcutSettings(shortcuts, quakeShortcut),
    }
  } catch {
    return getDefaultDesktopSettings()
  }
}

export async function saveDesktopSettings(settings: DesktopSettings): Promise<void> {
  await storage.set(STORAGE_KEY, JSON.stringify(settings))
  window.dispatchEvent(new CustomEvent<DesktopSettings>('tgent-desktop-settings-change', { detail: settings }))
}

export async function saveDesktopQuakeHeightRatio(heightRatio: number): Promise<void> {
  if (!Number.isFinite(heightRatio) || heightRatio <= 0 || heightRatio > 1) return
  const current = await loadDesktopSettings()
  if (Math.abs(current.quake.heightRatio - heightRatio) < 0.0001) return
  await saveDesktopSettings({
    ...current,
    quake: { ...current.quake, heightRatio },
  })
}

export function desktopAppearanceStyle(settings: DesktopAppearanceSettings): Record<string, string> {
  const opacity = boundedRatio(settings.windowOpacity, defaults.appearance.windowOpacity, 0.55)
  const percentage = `${Math.round(opacity * 100)}%`
  return {
    '--dt-bg': `color-mix(in srgb, var(--color-bg-page) ${percentage}, transparent)`,
    '--dt-terminal': `color-mix(in srgb, var(--color-term-bg) ${percentage}, transparent)`,
    '--dt-chrome': `color-mix(in srgb, var(--color-bg-surface) ${percentage}, transparent)`,
    '--dt-raised': `color-mix(in srgb, var(--color-bg-elevated) ${percentage}, transparent)`,
    '--dt-accent': settings.accent,
    '--dt-surface-opacity': String(opacity),
    '--terminal-surface-background': 'transparent',
  }
}

export function colorWithOpacity(color: string | undefined, opacity: number): string | undefined {
  if (!color || opacity >= 0.999) return color
  const normalized = color.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(normalized)
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(normalized)
  const channels = short
    ? short.slice(1).map(value => Number.parseInt(`${value}${value}`, 16))
    : full?.slice(1).map(value => Number.parseInt(value, 16))
  if (!channels) return color
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${Math.max(0, Math.min(1, opacity))})`
}

function normalizedKey(key: string): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return null
  if (key === ' ') return 'Space'
  if (key === ',') return 'Comma'
  if (key === '.') return 'Period'
  if (key === '+') return '='
  if (key === '{') return '['
  if (key === '}') return ']'
  if (key === '_') return '-'
  if (key === 'Escape') return 'Escape'
  if (key === 'Enter') return 'Enter'
  if (key === 'Backspace') return 'Backspace'
  if (key === 'Tab') return 'Tab'
  if (/^Arrow(Up|Down|Left|Right)$/.test(key)) return key
  if (/^F\d{1,2}$/.test(key)) return key.toUpperCase()
  return key.length === 1 ? key.toUpperCase() : key
}

function isApplePlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
  const key = normalizedKey(event.key)
  if (!key) return null
  const parts: string[] = []
  const apple = isApplePlatform()
  if (apple ? event.metaKey : event.ctrlKey) parts.push('Mod')
  if (apple && event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (parts.length === 0 && !/^F\d{1,2}$/.test(key)) return null
  parts.push(key)
  return parts.join('+')
}

export function matchesDesktopShortcut(event: KeyboardEvent, shortcut: string): boolean {
  if (!shortcut) return false
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1]
  if (!key || normalizedKey(event.key) !== key) return false
  const usesMod = parts.includes('Mod')
  const usesControl = parts.includes('Control')
  const apple = isApplePlatform()
  const expectsMeta = apple && usesMod
  const expectsControl = apple ? usesControl : usesMod || usesControl
  if (expectsMeta !== event.metaKey || expectsControl !== event.ctrlKey) return false
  if (parts.includes('Alt') !== event.altKey) return false
  if (parts.includes('Shift') !== event.shiftKey) return false
  return true
}

export function formatDesktopShortcut(shortcut: string): string {
  if (!shortcut) return 'Not set'
  const apple = isApplePlatform()
  const labels: Record<string, string> = apple
    ? { Mod: '⌘', Alt: '⌥', Shift: '⇧', Control: '⌃', Comma: ',', Period: '.', Enter: '↩', Space: 'Space' }
    : { Mod: 'Ctrl+', Alt: 'Alt+', Shift: 'Shift+', Control: 'Ctrl+', Comma: ',', Period: '.', Enter: 'Enter', Space: 'Space' }
  const parts = shortcut.split('+')
  if (parts.includes('Shift') && parts[parts.length - 1] === '=') {
    return parts.filter(part => part !== 'Shift' && part !== '=').map(part => labels[part] ?? part).join(apple ? '' : '') + '+'
  }
  return parts.map(part => labels[part] ?? part).join(apple ? '' : '')
}
