/**
 * NativeConnection Capacitor Plugin — TS 类型声明
 */

import { registerPlugin } from '@capacitor/core'
import type { Plugin } from '@capacitor/core'

export interface NativeConnectionPlugin extends Plugin {
  connect(opts: { serverType: string; serverId: string; localServer?: string }): Promise<void>
  retry(opts: { serverType: string; serverId: string }): Promise<void>
  release(opts: { serverType: string; serverId: string }): Promise<void>
  releaseAll(): Promise<void>
  releaseHubStores(): Promise<void>
  releaseStores(opts: { keys: string[] }): Promise<void>
  getSnapshot(opts: { serverType: string; serverId: string }): Promise<NativeSnapshot>
  getBridgePort(): Promise<{ port: number }>
  getConnectionInfo(opts?: { storeKey?: string }): Promise<NativeConnectionInfo>
  network(opts: { up: boolean }): Promise<void>
  setEnabled(opts: { enabled: boolean }): Promise<void>
  isEnabled(): Promise<{ enabled: boolean }>
}

/** Native 侧推送的状态快照 */
export interface NativeSnapshot {
  storeKey: string
  phase: string
  statusText: string
  connectionMode: 'local' | 'p2p' | null
  reconnectAttempt: number
  isRecovering: boolean
  needLogin: boolean
  needSubscription?: boolean
  allowRelayTransfer: boolean
  version?: number
}

export const NativeConnection = registerPlugin<NativeConnectionPlugin>('NativeConnection')

/** Native 侧返回的连接信息 */
export interface NativeConnectionInfo {
  type: 'p2p' | 'relay' | 'unknown'
  localAddr?: string
  remoteAddr?: string
  candidateType?: string
  remoteCandidateType?: string
  rtt?: number
}
