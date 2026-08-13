export interface FnItem {
  label: string    // 显示文本
  data: string     // 发送的数据
  desc?: string    // 描述
}

export interface FnGroup {
  name: string
  items: FnItem[]
}

export interface FnPreset {
  id: string
  name: string
  match: string[]        // pane_command 匹配模式
  groups: FnGroup[]
}

// 程序专属预设（根据 pane_command 匹配）
// DEFAULT_PROGRAM_PRESETS 供设置页面重置时使用
export const PROGRAM_PRESETS: FnPreset[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    match: ['claude'],
    groups: [
      {
        name: '指令',
        items: [
          { label: '/clear', data: '/clear\n', desc: '清除上下文' },
          { label: '/compact', data: '/compact\n', desc: '压缩上下文' },
          { label: '/cost', data: '/cost\n', desc: '查看费用' },
          { label: '/help', data: '/help\n', desc: '帮助' },
          { label: '/review', data: '/review\n', desc: '代码审查' },
          { label: '/init', data: '/init\n', desc: '初始化' },
        ],
      },
      {
        name: '常用',
        items: [
          { label: 'yes', data: 'yes\n', desc: '确认' },
          { label: 'no', data: 'no\n', desc: '拒绝' },
          { label: 'exit', data: 'exit\n', desc: '退出' },
        ],
      },
      {
        name: '控制',
        items: [
          { label: 'Ctrl+C', data: '\x03', desc: '中断' },
          { label: 'Ctrl+D', data: '\x04', desc: 'EOF' },
          { label: 'Ctrl+L', data: '\x0c', desc: '清屏' },
        ],
      },
    ],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    match: ['opencode'],
    groups: [
      {
        name: '指令',
        items: [
          { label: '/clear', data: '/clear\n', desc: '清除上下文' },
          { label: '/compact', data: '/compact\n', desc: '压缩上下文' },
          { label: '/cost', data: '/cost\n', desc: '查看费用' },
          { label: '/help', data: '/help\n', desc: '帮助' },
        ],
      },
      {
        name: '常用',
        items: [
          { label: 'yes', data: 'yes\n', desc: '确认' },
          { label: 'no', data: 'no\n', desc: '拒绝' },
        ],
      },
      {
        name: '控制',
        items: [
          { label: 'Ctrl+C', data: '\x03', desc: '中断' },
          { label: 'Ctrl+D', data: '\x04', desc: 'EOF' },
          { label: 'Ctrl+L', data: '\x0c', desc: '清屏' },
        ],
      },
    ],
  },
]

// 系统内置快捷键（始终存在）
export const SYSTEM_PRESET: FnPreset = {
  id: 'system',
  name: '系统',
  match: [],
  groups: [
    {
      name: '进程控制',
      items: [
        { label: 'Ctrl+C', data: '\x03', desc: '中断' },
        { label: 'Ctrl+D', data: '\x04', desc: 'EOF' },
        { label: 'Ctrl+Z', data: '\x1a', desc: '挂起' },
        { label: 'Ctrl+\\', data: '\x1c', desc: 'QUIT' },
        { label: 'Ctrl+L', data: '\x0c', desc: '清屏' },
        { label: 'Ctrl+R', data: '\x12', desc: '搜索' },
      ],
    },
    {
      name: '编辑',
      items: [
        { label: 'Ctrl+A', data: '\x01', desc: '行首' },
        { label: 'Ctrl+E', data: '\x05', desc: '行尾' },
        { label: 'Ctrl+W', data: '\x17', desc: '删词' },
        { label: 'Ctrl+U', data: '\x15', desc: '删行' },
        { label: 'Ctrl+K', data: '\x0b', desc: '删至行尾' },
        { label: 'Ctrl+]', data: '\x1d', desc: 'telnet' },
      ],
    },
  ],
}

export const DEFAULT_PROGRAM_PRESETS = PROGRAM_PRESETS

// 根据 pane_command 匹配程序预设，未匹配返回 null
export function matchProgramPreset(paneCommand: string | undefined): FnPreset | null {
  if (paneCommand) {
    const cmd = paneCommand.toLowerCase()
    for (const preset of PROGRAM_PRESETS) {
      if (preset.match.some(m => cmd.includes(m))) {
        return preset
      }
    }
  }
  return null
}
