/**
 * useTerminalInput — 按键/FN 处理逻辑
 * 从 TerminalPage 提取，处理 TMUX 键名映射、modifier 状态、
 * 键盘可见性相关的 focus 管理。
 */

import { useState, useCallback } from 'react'
import type { TerminalHandle } from '../components/Terminal'
import type { ModifierState } from '../components/VirtualKeybar'

const TMUX_KEY_NAMES: Record<string, string> = {
  '\x1b[A': 'Up', '\x1b[B': 'Down',
  '\x1b[C': 'Right', '\x1b[D': 'Left',
  '\x1b[H': 'Home', '\x1b[F': 'End',
  '\x1b[5~': 'PgUp', '\x1b[6~': 'PgDn',
}

export interface UseTerminalInputOptions {
  /** 返回所有需要接收输入的终端 ref（单终端 [ref]，sync 模式 [ref1, ref2]） */
  getTermRefs: () => (TerminalHandle | null)[]
  /** 返回键盘是否可见 */
  getKeyboardVisible: () => boolean
  /** 返回键盘是否锁定 */
  getKeyboardLocked: () => boolean
}

export interface UseTerminalInputReturn {
  ctrlState: ModifierState
  setCtrlState: React.Dispatch<React.SetStateAction<ModifierState>>
  altState: ModifierState
  setAltState: React.Dispatch<React.SetStateAction<ModifierState>>
  handleKey: (data: string) => void
  handleFnSend: (data: string) => void
  handleModifierUsed: () => void
}

export function useTerminalInput(opts: UseTerminalInputOptions): UseTerminalInputReturn {
  const { getTermRefs, getKeyboardVisible, getKeyboardLocked } = opts
  const [ctrlState, setCtrlState] = useState<ModifierState>('off')
  const [altState, setAltState] = useState<ModifierState>('off')

  const handleKey = useCallback((data: string) => {
    const refs = getTermRefs()
    const tmuxKey = TMUX_KEY_NAMES[data]
    for (const ref of refs) {
      if (!ref) continue
      if (tmuxKey) ref.sendKeys(tmuxKey)
      else ref.sendInput(data)
    }
    // 仅在键盘已可见且未锁定时 focus 第一个终端
    if (getKeyboardVisible() && !getKeyboardLocked()) {
      refs[0]?.focus()
    }
  }, [getTermRefs, getKeyboardVisible, getKeyboardLocked])

  const handleFnSend = useCallback((data: string) => {
    const refs = getTermRefs()
    const tmuxKey = TMUX_KEY_NAMES[data]
    for (const ref of refs) {
      if (!ref) continue
      if (tmuxKey) ref.sendKeys(tmuxKey)
      else ref.sendInput(data)
    }
  }, [getTermRefs])

  const handleModifierUsed = useCallback(() => {
    setCtrlState(s => s === 'once' ? 'off' : s)
    setAltState(s => s === 'once' ? 'off' : s)
  }, [])

  return {
    ctrlState, setCtrlState,
    altState, setAltState,
    handleKey, handleFnSend,
    handleModifierUsed,
  }
}
