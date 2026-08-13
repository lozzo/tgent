/**
 * 网络状态 Hook（单一数据源）
 *
 * 替代原来的 useNetworkStatus + useAppResume，
 * 所有 UI 组件通过这个 Hook 获取网络状态。
 */

import { useSyncExternalStore, useCallback } from 'react'
import { useAppContext } from '../contexts/AppContext'
import type { NetworkState } from '../state/NetworkStateManager'

/**
 * 订阅全局网络状态
 * @returns NetworkState 快照（每次状态变化时触发 re-render）
 */
export function useNetworkState(): NetworkState {
  const { networkStateManager } = useAppContext()

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return networkStateManager.subscribe(() => onStoreChange())
    },
    [networkStateManager],
  )

  const getSnapshot = useCallback(
    () => networkStateManager.state,
    [networkStateManager],
  )

  return useSyncExternalStore(subscribe, getSnapshot)
}
