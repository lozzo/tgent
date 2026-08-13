/**
 * 从 AgentDataStore 获取响应式数据的 hooks
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import type { AgentDataStore, SessionNode, ServerEvent } from '../state/AgentDataStore'
import type { TerminalTopologySnapshot } from '../state/TerminalTopologyStore'

/** 获取指定 agent 的 session 数据（响应式） */
export function useAgentSessions(agentStore: AgentDataStore): {
  sessions: SessionNode[]
  status: { tmux_running: boolean; sessions: number } | null
  loading: boolean
  stale: boolean
  refresh: () => Promise<void>
} {
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    return agentStore.subscribeData(() => forceUpdate(n => n + 1))
  }, [agentStore])

  const refresh = useCallback(
    () => agentStore.refresh(),
    [agentStore],
  )

  return {
    sessions: agentStore.sessions,
    status: agentStore.status,
    loading: agentStore.loading,
    stale: !agentStore.isBound && agentStore.sessions.length > 0,
    refresh,
  }
}

export function useAgentTopology(agentStore: AgentDataStore): TerminalTopologySnapshot {
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    return agentStore.topologyStore.subscribe(() => forceUpdate(value => value + 1))
  }, [agentStore])

  return agentStore.topologyStore.snapshot
}

/** 订阅指定 agent 的服务端事件 */
export function useAgentEvents(
  agentStore: AgentDataStore | undefined,
  handler: (event: ServerEvent) => void,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!agentStore) return
    return agentStore.subscribeEvents((event) => {
      handlerRef.current(event)
    })
  }, [agentStore])
}
