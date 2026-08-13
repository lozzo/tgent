/**
 * State Layer 统一导出
 */

export { eventBus, type EventMap, type ConnectionState } from './EventBus'
export { NetworkStateManager, type NetworkState, type ResumeType } from './NetworkStateManager'
export { AuthManager } from './AuthManager'
export type { ConnectionPhase, ConnectionSnapshot } from './connectionTypes'
