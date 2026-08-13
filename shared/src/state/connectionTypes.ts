import type { WebRTCTransport } from '../api/transport'
import type { ServerApi } from '../api/client'
import type { AgentDataStore } from './AgentDataStore'

export type ConnectionPhase =
  | 'idle'
  | 'probing'
  | 'connecting'
  | 'connected'
  | 'verifying'
  | 'reconnecting'
  | 'waiting_network'
  | 'failed'

export interface ConnectionSnapshot {
  phase: ConnectionPhase
  transport: WebRTCTransport | undefined
  serverApi: ServerApi
  statusText: string
  connectionMode: 'local' | 'p2p' | null
  isConnected: boolean
  isRecovering: boolean
  isFailed: boolean
  needLogin: boolean
  needSubscription: boolean
  reconnectAttempt: number
  agentStore: AgentDataStore
  allowRelayTransfer: boolean
}
